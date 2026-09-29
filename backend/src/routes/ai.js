/*
 * AI assistant of the finding editor (see lib/ai.js).
 *
 *   GET  /api/ai/status                                  can the assistant be used, fields, prompts, placeholders
 *   GET  /api/ai/config                                  global configuration (never the API key)
 *   PUT  /api/ai/config                                  update it
 *   POST /api/ai/test                                    send a short prompt with the given (unsaved) configuration
 *   POST /api/audits/:auditId/findings/:findingId/ai     write a field of a finding
 */

module.exports = function(app) {

    var Response = require('../lib/httpResponse')
    var acl = require('../lib/auth').acl
    var mongoose = require('mongoose')
    var ai = require('../lib/ai')

    var AiConfig = mongoose.model('AiConfig')
    var Audit = mongoose.model('Audit')
    var CustomField = mongoose.model('CustomField')
    var Language = mongoose.model('Language')
    var Settings = mongoose.model('Settings')

    function fail(res, err) {
        if (err instanceof ai.AiError) Response.Custom(res, 'error', err.status, err.message)
        else Response.Internal(res, err)
    }

    // Everything the prompt editors show: fields, their prompts, placeholders
    async function promptsInfo(config) {
        var customFields = await CustomField.getAll()
        var fields = ai.availableFields(customFields)
        var defaults = {}
        fields.forEach(f => { defaults[f.key] = ai.defaultPrompt(f.key) })
        var placeholders = ai.PLACEHOLDERS.concat(
            fields.filter(f => !ai.BUILTIN_FIELDS[f.key]).map(f => ({name: f.key, description: `Custom field "${f.label}"`}))
        )
        return {
            fields: fields,
            defaultPrompts: defaults,
            prompts: (config && config.prompts) || {},
            placeholders: placeholders,
            customPlaceholderHelp: ai.CUSTOM_PLACEHOLDER_HELP,
        }
    }

    app.get("/api/ai/status", acl.hasPermission('ai:generate'), async function(req, res) {
        // #swagger.tags = ['AI']
        try {
            var config = await AiConfig.getPublicConfig()
            var info = await promptsInfo(config)
            info.configured = AiConfig.isConfigured(config)
            info.provider = config.provider
            info.model = config.model
            Response.Ok(res, info)
        } catch (err) { fail(res, err) }
    })

    app.get("/api/ai/config", acl.hasPermission('ai:update'), async function(req, res) {
        // #swagger.tags = ['AI']
        try {
            var config = await AiConfig.getPublicConfig()
            var info = await promptsInfo(config)
            Response.Ok(res, Object.assign({}, info, {config: config}))
        } catch (err) { fail(res, err) }
    })

    app.put("/api/ai/config", acl.hasPermission('ai:update'), async function(req, res) {
        // #swagger.tags = ['AI']
        try {
            var parsed = ai.parseConfigUpdate(req.body)
            if (parsed.errors.length) {
                Response.BadParameters(res, parsed.errors.join(', '))
                return
            }
            var config = await AiConfig.updateConfig(parsed.update)
            Response.Ok(res, config)
        } catch (err) { fail(res, err) }
    })

    // Test with the values of the form, saved or not. The saved key is only
    // reused for the saved host, so that it cannot be sent to another server.
    app.post("/api/ai/test", acl.hasPermission('ai:update'), async function(req, res) {
        // #swagger.tags = ['AI']
        try {
            var parsed = ai.parseConfigUpdate(Object.assign({}, req.body, {prompts: undefined}))
            if (parsed.errors.length) {
                Response.BadParameters(res, parsed.errors.join(', '))
                return
            }
            var saved = await AiConfig.getFullConfig()
            var config = Object.assign({}, saved, parsed.update)
            if (!parsed.update.apiKey && config.apiHost !== saved.apiHost) config.apiKey = ''
            if (req.body && req.body.clearApiKey === true) config.apiKey = ''
            config.timeout = Math.min(Number(config.timeout) || 120, 120)

            var start = Date.now()
            var text = await ai.complete(config, 'This is a connection test. Reply with the single word OK.')
            Response.Ok(res, {answer: ai.cleanAnswer(text).slice(0, 200), model: config.model, ms: Date.now() - start})
        } catch (err) { fail(res, err) }
    })

    // Fields of the editor taken from the request (what the user sees, saved or not)
    var EDITOR_FIELDS = ['title', 'vulnType', 'category', 'description', 'observation', 'poc', 'scope', 'remediation', 'cvssv3', 'remediationComplexity', 'priority']

    function mergeFinding(stored, fromEditor) {
        var finding = Object.assign({}, stored)
        if (!fromEditor || typeof fromEditor !== 'object') return finding
        EDITOR_FIELDS.forEach(name => {
            var value = fromEditor[name]
            if (value === undefined) return
            if (value === null || typeof value === 'string' || typeof value === 'number') finding[name] = value
        })
        if (Array.isArray(fromEditor.references))
            finding.references = fromEditor.references.filter(r => typeof r === 'string')
        if (Array.isArray(fromEditor.customFields)) {
            finding.customFields = fromEditor.customFields
                .filter(e => e && e.customField && typeof e.customField === 'object' && e.customField.label)
                .map(e => ({customField: {label: String(e.customField.label), fieldType: e.customField.fieldType}, text: e.text}))
        }
        return finding
    }

    app.post("/api/audits/:auditId/findings/:findingId/ai", acl.hasPermission('ai:generate'), async function(req, res) {
        // #swagger.tags = ['AI']
        try {
            var role = req.decodedToken.role
            if (!acl.isAllowed(role, 'audits:update')) {
                Response.Forbidden(res, 'Insufficient privileges to edit this audit')
                return
            }
            var field = req.body && req.body.field
            if (!field || typeof field !== 'string') {
                Response.BadParameters(res, 'Missing field')
                return
            }

            var config = await AiConfig.getFullConfig()
            if (!AiConfig.isConfigured(config)) {
                Response.BadParameters(res, 'The AI integration is not configured (Data > AI integration)')
                return
            }

            var audit = await Audit.getAiContext(acl.isAllowed(role, 'audits:update-all'), req.params.auditId, req.decodedToken.id)
            if (!audit.aiEnabled) {
                Response.Forbidden(res, 'AI features are disabled for this audit')
                return
            }
            var settings = await Settings.getAll()
            if (settings && settings.reviews && settings.reviews.enabled && audit.state !== 'EDIT') {
                Response.Forbidden(res, 'The audit is not in the EDIT state and therefore cannot be edited.')
                return
            }
            var stored = (audit.findings || []).find(f => String(f._id) === String(req.params.findingId))
            if (!stored) {
                Response.NotFound(res, 'Finding not found')
                return
            }

            var result = await ai.generate({
                config: config,
                audit: audit,
                finding: mergeFinding(stored, req.body.finding),
                fieldKey: field,
                languages: await Language.getAll(),
                customFields: await CustomField.getAll(),
            })
            Response.Ok(res, result)
        } catch (err) { fail(res, err) }
    })
}
