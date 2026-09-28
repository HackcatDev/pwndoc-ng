/*
 * Findings API, authenticated with the API key of one audit.
 *
 *   GET    /api/v1/audit                 the audit the key belongs to
 *   GET    /api/v1/findings              its findings (summary)
 *   POST   /api/v1/findings              create one, returns its id
 *   GET    /api/v1/findings/:findingId   read one, rich text as Markdown
 *   PATCH  /api/v1/findings/:findingId   update the given fields only
 *   PUT    /api/v1/findings/:findingId   same as PATCH
 *
 * The key is sent as `X-API-Key: <key>` or `Authorization: Bearer <key>` and
 * identifies exactly one audit, which is why no audit id is ever part of a
 * request: a key cannot read or write anything outside of its own audit.
 *
 * Bodies and answers use Markdown for the rich text fields, see lib/finding-api.js.
 */

module.exports = function(app, io) {

    var Response = require('../lib/httpResponse')
    var mongoose = require('mongoose')
    var Audit = mongoose.model('Audit')
    var CustomField = mongoose.model('CustomField')
    var Settings = mongoose.model('Settings')
    var findingApi = require('../lib/finding-api')

    function readKey(req) {
        var header = req.get('X-API-Key')
        if (header && header.trim()) return header.trim()
        var authorization = req.get('Authorization') || ''
        var match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
        if (match) return match[1].trim()
        return null
    }

    // Resolves the key into req.audit, or answers 401
    function withApiKey(handler) {
        return async function(req, res) {
            var key = readKey(req)
            if (!key) {
                Response.Unauthorized(res, 'Missing API key, send it as the X-API-Key header')
                return
            }
            try {
                req.audit = await Audit.getByApiKey(key)
            } catch (err) {
                Response.Internal(res, err)
                return
            }
            try {
                await handler(req, res)
            } catch (err) {
                Response.Internal(res, err)
            }
        }
    }

    // The audit must be editable, with the same rule the web interface follows
    async function assertEditable(req, res) {
        var settings = await Settings.getAll()
        if (settings.reviews.enabled && req.audit.state !== 'EDIT') {
            Response.Forbidden(res, 'The audit is not in the EDIT state and therefore cannot be edited.')
            return null
        }
        return settings
    }

    async function auditCustomFields() {
        return await CustomField.getAll()
    }

    // A malformed id is a finding that does not exist, not a server error
    function assertFindingId(req, res) {
        if (!mongoose.Types.ObjectId.isValid(req.params.findingId)) {
            Response.NotFound(res, 'Finding not found')
            return false
        }
        return true
    }

    function findingUpdated(req, settings) {
        if (settings.reviews.enabled && settings.reviews.private.removeApprovalsUponUpdate)
            Audit.updateGeneral(true, req.audit._id, null, {approvals: []})
        io.to(String(req.audit._id)).emit('updateAudit')
    }

    /* ### AUDIT ### */

    // Identify the audit the key belongs to
    app.get("/api/v1/audit", withApiKey(async function(req, res) {
        // #swagger.tags = ['Findings API']

        Response.Ok(res, {
            id: String(req.audit._id),
            name: req.audit.name,
            audit_type: req.audit.auditType || null,
            language: req.audit.language,
            state: req.audit.state,
        })
    }))

    /* ### FINDINGS ### */

    // List the findings of the audit
    app.get("/api/v1/findings", withApiKey(async function(req, res) {
        // #swagger.tags = ['Findings API']

        var audit = await Audit.getFindings(true, req.audit._id, null)
        Response.Ok(res, audit.map(findingApi.serializeSummary))
    }))

    // Create a finding
    app.post("/api/v1/findings", withApiKey(async function(req, res) {
        // #swagger.tags = ['Findings API']

        var settings = await assertEditable(req, res)
        if (!settings) return

        var customFields = await auditCustomFields()
        var parsed = findingApi.parse(req.body, customFields, {partial: false})
        if (parsed.errors.length > 0) {
            Response.BadParameters(res, parsed.errors.join('; '))
            return
        }

        var finding = parsed.finding
        // the id is generated here so that it can be returned to the caller
        finding._id = new mongoose.Types.ObjectId()
        if (parsed.customFields.length > 0)
            finding.customFields = findingApi.mergeCustomFields([], parsed.customFields)

        await Audit.createFinding(true, req.audit._id, null, finding)
        findingUpdated(req, settings)

        var created = await Audit.getFinding(true, req.audit._id, null, finding._id)
        Response.Created(res, findingApi.serialize(created, customFields))
    }))

    // Read a finding
    app.get("/api/v1/findings/:findingId", withApiKey(async function(req, res) {
        // #swagger.tags = ['Findings API']

        if (!assertFindingId(req, res)) return

        var customFields = await auditCustomFields()
        var finding = await Audit.getFinding(true, req.audit._id, null, req.params.findingId)
        Response.Ok(res, findingApi.serialize(finding, customFields))
    }))

    // Update the given fields of a finding, leaving the others untouched
    async function updateFinding(req, res) {
        if (!assertFindingId(req, res)) return

        var settings = await assertEditable(req, res)
        if (!settings) return

        var customFields = await auditCustomFields()
        var parsed = findingApi.parse(req.body, customFields, {partial: true})
        if (parsed.errors.length > 0) {
            Response.BadParameters(res, parsed.errors.join('; '))
            return
        }
        if (Object.keys(parsed.finding).length === 0 && parsed.customFields.length === 0) {
            Response.BadParameters(res, 'No field to update')
            return
        }

        // read first: the finding must exist in THIS audit, and the custom
        // fields that are not part of the request have to keep their value
        var current = await Audit.getFinding(true, req.audit._id, null, req.params.findingId)

        var update = parsed.finding
        if (parsed.customFields.length > 0) {
            var existing = typeof current.toObject === 'function' ? current.toObject().customFields : current.customFields
            update.customFields = findingApi.mergeCustomFields(existing, parsed.customFields)
        }
        // updateFinding sorts the findings of the category the finding belongs to
        if (update.category === undefined) update.category = current.category

        await Audit.updateFinding(true, req.audit._id, null, req.params.findingId, update)
        findingUpdated(req, settings)

        var updated = await Audit.getFinding(true, req.audit._id, null, req.params.findingId)
        Response.Ok(res, findingApi.serialize(updated, customFields))
    }

    app.patch("/api/v1/findings/:findingId", withApiKey(updateFinding))
    app.put("/api/v1/findings/:findingId", withApiKey(updateFinding))
}
