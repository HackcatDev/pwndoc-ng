/*
 * Quality advisor of the findings: runs lib/ai.review on a saved finding and
 * stores its answer with the finding.
 *
 * - Saving a finding from the editor runs it in the background (routes/audit.js)
 *   when the audit enables it; nothing runs when the inputs did not change
 *   since the last analysis (same fingerprint), the button of the editor
 *   forces it (routes/ai.js).
 * - The answer is stored in finding.aiReview; the low-quality flag follows
 *   ai.flagUpdate. The room of the audit gets 'aiReviewStarted' and
 *   'aiReview' ({findingId}) and 'updateAudit' when the flag changed.
 * - Only the last analysis started for a finding is stored.
 * - The context is strictly the audit: the other findings are those of the
 *   same audit, titles only.
 */

const mongoose = require('mongoose')
const ai = require('./ai')
const aiImages = require('./ai-images')

const latest = new Map() // findingId -> token of the last analysis started

// Rich text fields of a finding holding images, in their order
function imageFields(finding) {
    const fields = [
        { label: 'Description', html: finding.description },
        { label: 'Observation', html: finding.observation },
        { label: 'Proofs', html: finding.poc },
        { label: 'Remediation', html: finding.remediation },
    ]
    for (const entry of finding.customFields || []) {
        const definition = entry && entry.customField && entry.customField.label ? entry.customField : entry
        if (definition && definition.fieldType === 'text' && typeof entry.text === 'string')
            fields.push({ label: definition.label, html: entry.text })
    }
    return fields
}

// Models used here: given by the routes (tests stub them), else mongoose
function modelsOf(models) {
    const get = (name) => (models && models[name]) || mongoose.model(name)
    return { AiConfig: get('AiConfig'), Audit: get('Audit'), CustomField: get('CustomField'), Language: get('Language'), Image: get('Image') }
}

function imageLoader(Image) {
    return (id) => Image.getOne(id).then((row) => (row ? row.value : null))
}

// Images of a finding for the model, within the limits of lib/ai-images
async function findingImages(finding, models) {
    const refs = aiImages.collect(imageFields(finding))
    const images = await aiImages.load(refs, imageLoader(modelsOf(models).Image))
    return { refs, images }
}

function emit(io, auditId, event, data) {
    if (io) io.to(String(auditId)).emit(event, data)
}

/*
 * Runs the advisor on a finding. lowered: a user has just lowered the flag. Returns the stored review, or null when it
 * was not run (disabled, not configured, unchanged inputs, superseded).
 * Throws an AiError when force is set and the advisor cannot run.
 */
async function runReview({ auditId, findingId, isAdmin, userId, force = false, io = null, lowered = false, recordOnly = false, models = null }) {
    const { AiConfig, Audit, CustomField, Language, Image } = modelsOf(models)

    const config = await AiConfig.getFullConfig()
    if (!AiConfig.isConfigured(config)) {
        if (force) throw new ai.AiError('The AI integration is not configured (Data > AI integration)', 400)
        return null
    }
    const audit = await Audit.getAiContext(isAdmin, auditId, userId)
    if (!audit.aiEnabled || !audit.aiAdvisorEnabled) {
        if (force) throw new ai.AiError('The quality advisor is disabled for this audit', 403)
        return null
    }
    const finding = (audit.findings || []).find((f) => String(f._id) === String(findingId))
    if (!finding) throw new ai.AiError('Finding not found', 404)

    const customFields = await CustomField.getAll()
    const languages = await Language.getAll()
    const sendImages = !!(config.supportsImages && audit.aiImagesAdvisor)
    const refs = aiImages.collect(imageFields(finding))
    const { hash } = ai.reviewPrompt({ config, audit, finding, languages, customFields, refs, sendImages })
    // a user lowered the flag: the advisor does not raise it again for this content
    if (lowered) {
        finding.lowQualityDismissedHash = hash
        await Audit.updateOne({ _id: auditId, 'findings._id': findingId }, { $set: { 'findings.$.lowQualityDismissedHash': hash } })
    }
    if (recordOnly) return null
    const previous = finding.aiReview || null
    if (!force && previous && previous.hash === hash && !previous.error) return null

    const token = Symbol(String(findingId))
    latest.set(String(findingId), token)
    emit(io, auditId, 'aiReviewStarted', { findingId: String(findingId) })

    let review
    try {
        const images = sendImages ? await aiImages.load(refs, imageLoader(Image)) : []
        review = await ai.review({ config, audit, finding, languages, customFields, refs, images, sendImages })
    } catch (err) {
        if (latest.get(String(findingId)) === token) {
            latest.delete(String(findingId))
            const failed = Object.assign({}, previous || {}, {
                error: err && err.message ? err.message : String(err),
                errorDate: new Date().toISOString(),
            })
            await Audit.updateOne({ _id: auditId, 'findings._id': findingId }, { $set: { 'findings.$.aiReview': failed } })
            emit(io, auditId, 'aiReview', { findingId: String(findingId) })
        }
        throw err
    }
    if (latest.get(String(findingId)) !== token) return null // a newer analysis is running
    latest.delete(String(findingId))

    // flag from the current state (a user may have changed it meanwhile)
    const current = await Audit.findOne({ _id: auditId, 'findings._id': findingId }, { 'findings.$': 1 }).lean()
    const currentFinding = current && current.findings && current.findings[0]
    if (!currentFinding) return null
    const flags = ai.flagUpdate(currentFinding, review)
    const set = { 'findings.$.aiReview': review }
    for (const key of Object.keys(flags)) set[`findings.$.${key}`] = flags[key]
    await Audit.updateOne({ _id: auditId, 'findings._id': findingId }, { $set: set })

    emit(io, auditId, 'aiReview', { findingId: String(findingId) })
    if (Object.keys(flags).length) emit(io, auditId, 'updateAudit')
    return Object.assign({}, review, { flags })
}

// Background run after a save: errors are logged and stored, never thrown
function runInBackground(options) {
    runReview(options).catch((err) => {
        if (!(err instanceof ai.AiError)) console.log('ai-advisor:', err)
    })
}

module.exports = { runReview, runInBackground, findingImages, imageFields }
