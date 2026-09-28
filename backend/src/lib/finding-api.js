/*
 * Field mapping of the findings API (routes/audit-api.js).
 *
 * The API speaks Markdown and snake_case, the audit documents hold HTML and
 * the internal field names, so every request goes through `parse` and every
 * response through `serialize` / `serializeSummary`.
 *
 * Custom fields are addressed by their slug, which is how the docx template
 * refers to them too: the label lowercased, without spaces, with anything but
 * a letter, a digit or an underscore replaced by an underscore. A finding of
 * the deployment this was written for exposes `business_impact` and
 * `access_level` that way.
 */

const _ = require('lodash')
const CVSS31 = require('./cvsscalc31')
const markdown = require('./markdown')

// API name -> {field, kind} of the audit document
const FIELDS = {
    title: { field: 'title', kind: 'text' },
    cvss_string: { field: 'cvssv3', kind: 'cvss' },
    description: { field: 'description', kind: 'html' },
    observation: { field: 'observation', kind: 'html' },
    remediation: { field: 'remediation', kind: 'html' },
    poc: { field: 'poc', kind: 'html' },
    affected_assets: { field: 'scope', kind: 'html' },
    references: { field: 'references', kind: 'lines' },
    vuln_type: { field: 'vulnType', kind: 'text' },
    category: { field: 'category', kind: 'text' },
    priority: { field: 'priority', kind: 'enum', values: [1, 2, 3, 4] },
    remediation_complexity: { field: 'remediationComplexity', kind: 'enum', values: [1, 2, 3] },
    status: { field: 'status', kind: 'status' },
}

const STATUS_NAMES = { 0: 'done', 1: 'redacting' }

// Same slug as the one the report generator builds for the template
function slugify(label) {
    return _.deburr(String(label).toLowerCase()).replace(/\s/g, '').replace(/[^\w]/g, '_')
}

function statusToNumber(value) {
    if (value === 0 || value === 1) return value
    if (value === '0' || value === '1') return Number(value)
    const name = String(value).toLowerCase()
    if (name === 'done') return 0
    if (name === 'redacting') return 1
    return null
}

/*
 * Custom fields available on a finding, as {slug: field} (the CustomField
 * documents of display "finding" or "vulnerability").
 */
function findingCustomFields(customFields) {
    const result = {}
    for (const field of customFields || []) {
        if (!['finding', 'vulnerability'].includes(field.display)) continue
        if (field.fieldType === 'space') continue
        if (!field.label) continue
        result[slugify(field.label)] = field
    }
    return result
}

function customFieldValue(field, value) {
    switch (field.fieldType) {
        case 'text': // rich text
            return markdown.toHtml(value)
        case 'checkbox': case 'select-multiple':
            return Array.isArray(value) ? value.map((item) => String(item)) : markdown.toLines(value)
        case 'date':
            return value === null || value === undefined || value === '' ? '' : String(value)
        default: // input, select, radio, ...
            return value === null || value === undefined ? '' : String(value)
    }
}

function readCustomFieldValue(field, value) {
    if (field.fieldType === 'text') return markdown.toMarkdown(value)
    return value === undefined ? null : value
}

/*
 * Turns an API payload into the fields of a finding document.
 *
 * partial: when true (update), only the keys present in the body are
 * returned, so the other fields of the finding keep their value. When false
 * (create), `title` and `cvss_string` are required.
 *
 * Returns {finding, customFields, errors}: `finding` holds the plain fields,
 * `customFields` the [{slug, field, value}] to merge into finding.customFields
 * and `errors` the reasons to answer 422.
 */
function parse(body, availableCustomFields, { partial = false } = {}) {
    const finding = {}
    const customFields = []
    const errors = []
    const input = body && typeof body === 'object' ? body : {}
    const known = findingCustomFields(availableCustomFields)

    if (!partial) {
        if (!input.title || !String(input.title).trim()) errors.push('title is required')
        if (!input.cvss_string || !String(input.cvss_string).trim()) errors.push('cvss_string is required')
    }

    for (const name of Object.keys(input)) {
        const value = input[name]

        if (name === 'custom_fields') {
            if (value === null || typeof value !== 'object' || Array.isArray(value)) {
                errors.push('custom_fields must be an object')
                continue
            }
            for (const key of Object.keys(value)) {
                const field = known[slugify(key)]
                if (!field) { errors.push(`unknown custom field: ${key}`); continue }
                customFields.push({ slug: slugify(key), field: field, value: customFieldValue(field, value[key]) })
            }
            continue
        }

        const definition = FIELDS[name]
        if (!definition) {
            // a custom field can also be given at the top level, by slug
            const field = known[slugify(name)]
            if (field) {
                customFields.push({ slug: slugify(name), field: field, value: customFieldValue(field, value) })
                continue
            }
            errors.push(`unknown field: ${name}`)
            continue
        }

        switch (definition.kind) {
            case 'text': {
                const text = value === null || value === undefined ? '' : String(value).trim()
                if (name === 'title' && !text) { errors.push('title cannot be empty'); break }
                finding[definition.field] = text
                break
            }
            case 'html':
                finding[definition.field] = markdown.toHtml(value)
                break
            case 'lines':
                finding[definition.field] = markdown.toLines(value)
                break
            case 'cvss': {
                const vector = value === null || value === undefined ? '' : String(value).trim()
                if (!vector) {
                    if (partial) errors.push('cvss_string cannot be empty')
                    else finding[definition.field] = ''
                    break
                }
                const cvss = CVSS31.calculateCVSSFromVector(vector)
                if (!cvss.success) {
                    errors.push(`cvss_string is not a valid CVSS 3.x vector (${cvss.errorType})`)
                    break
                }
                finding[definition.field] = vector
                break
            }
            case 'enum': {
                if (value === null || value === undefined || value === '') { finding[definition.field] = undefined; break }
                const number = Number(value)
                if (!definition.values.includes(number)) {
                    errors.push(`${name} must be one of ${definition.values.join(', ')}`)
                    break
                }
                finding[definition.field] = number
                break
            }
            case 'status': {
                const status = statusToNumber(value)
                if (status === null) { errors.push('status must be "done" or "redacting"'); break }
                finding[definition.field] = status
                break
            }
        }
    }

    return { finding: finding, customFields: customFields, errors: errors }
}

/*
 * Merges parsed custom field values into the finding's customFields array,
 * leaving the values that were not part of the request untouched.
 */
function mergeCustomFields(existing, parsedCustomFields) {
    const result = (existing || []).map((entry) => ({ customField: entry.customField, text: entry.text }))

    for (const parsed of parsedCustomFields) {
        const fieldId = String(parsed.field._id)
        const found = result.find((entry) => {
            const id = entry.customField && entry.customField._id ? entry.customField._id : entry.customField
            return id && String(id) === fieldId
        })
        if (found) found.text = parsed.value
        else result.push({ customField: _.omit(fieldDocument(parsed.field), ['text']), text: parsed.value })
    }
    return result
}

// The editor stores the definition of the custom field along with the value
function fieldDocument(field) {
    const plain = typeof field.toObject === 'function' ? field.toObject() : field
    return _.pick(plain, ['_id', 'label', 'fieldType', 'display', 'displaySub', 'size', 'offset', 'required', 'description', 'options', 'position'])
}

function cvssOf(finding) {
    const vector = finding.cvssv3 || ''
    if (!vector) return { score: null, severity: 'None' }
    const cvss = CVSS31.calculateCVSSFromVector(vector)
    if (!cvss.success) return { score: null, severity: 'None' }
    return { score: Number(cvss.baseMetricScore), severity: cvss.baseSeverity }
}

/*
 * Full representation of a finding, with the rich text fields as Markdown.
 */
function serialize(finding, availableCustomFields) {
    const plain = typeof finding.toObject === 'function' ? finding.toObject() : finding
    const result = {
        id: String(plain._id),
        identifier: plain.identifier === undefined ? null : plain.identifier,
        title: plain.title || '',
        cvss_string: plain.cvssv3 || '',
        cvss: cvssOf(plain),
        vuln_type: plain.vulnType || '',
        category: plain.category || null,
        status: STATUS_NAMES[plain.status] || 'redacting',
        priority: plain.priority || null,
        remediation_complexity: plain.remediationComplexity || null,
        description: markdown.toMarkdown(plain.description),
        observation: markdown.toMarkdown(plain.observation),
        poc: markdown.toMarkdown(plain.poc),
        affected_assets: markdown.toMarkdown(plain.scope),
        remediation: markdown.toMarkdown(plain.remediation),
        references: plain.references || [],
        custom_fields: {},
    }

    const known = findingCustomFields(availableCustomFields)
    // the values held by the finding, then the fields it has no value for yet
    for (const entry of plain.customFields || []) {
        const definition = entry.customField && entry.customField.label ? entry.customField : entry
        if (!definition.label) continue
        const slug = slugify(definition.label)
        result.custom_fields[slug] = readCustomFieldValue(definition, entry.text)
    }
    for (const slug of Object.keys(known)) {
        if (!(slug in result.custom_fields)) result.custom_fields[slug] = null
    }

    return result
}

/*
 * Short representation used by the list endpoint: no bodies, so that listing
 * an audit with many findings stays small.
 */
function serializeSummary(finding) {
    const plain = typeof finding.toObject === 'function' ? finding.toObject() : finding
    return {
        id: String(plain._id),
        identifier: plain.identifier === undefined ? null : plain.identifier,
        title: plain.title || '',
        cvss_string: plain.cvssv3 || '',
        cvss: cvssOf(plain),
        vuln_type: plain.vulnType || '',
        category: plain.category || null,
        status: STATUS_NAMES[plain.status] || 'redacting',
    }
}

module.exports = {
    FIELDS,
    parse,
    mergeCustomFields,
    serialize,
    serializeSummary,
    findingCustomFields,
    slugify,
}
