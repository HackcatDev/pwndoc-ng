/*
 * AI assistant of the finding editor.
 *
 * A prompt is chosen for the field being written (the audit's override, else
 * the global prompt, else the built-in default), its {placeholders} are
 * replaced with the values of the finding and of the audit, and the result is
 * sent to the model configured in Data > AI integration (OpenAI-style chat
 * completions or Anthropic-style messages). The answer, in Markdown, is turned
 * into the format of the field (editor HTML, list of lines or plain text).
 *
 * Nothing here touches the database: routes/ai.js loads the documents and
 * passes them in, so this module is tested without MongoDB.
 */

const _ = require('lodash')
const crypto = require('crypto')
const CVSS31 = require('./cvsscalc31')
const markdown = require('./markdown')
const plainText = require('./plain-text')

// Same slug as the report generator and the findings API
function slugify(label) {
    return _.deburr(String(label).toLowerCase()).replace(/\s/g, '').replace(/[^\w]/g, '_')
}

// Built-in fields the assistant can write: key -> {label, kind, path in the finding}
const BUILTIN_FIELDS = {
    title: { label: 'Title', kind: 'text', path: 'title' },
    description: { label: 'Description', kind: 'html', path: 'description' },
    observation: { label: 'Observation', kind: 'html', path: 'observation' },
    references: { label: 'References', kind: 'lines', path: 'references' },
    remediation: { label: 'Remediation', kind: 'html', path: 'remediation' },
}

const FIELD_GUIDELINES = {
    title: '- A short, specific title of the vulnerability (at most about 10 words), without a trailing period.\n- A single line of plain text: no Markdown, no quotes.',
    description: '- A generic description of the vulnerability class: what it is and why it is a risk, independent of this particular target.\n- Markdown is allowed (paragraphs, lists, inline code).',
    observation: '- What was observed on the target: where, how it was found and what it allowed, based on the other fields.\n- Markdown is allowed (paragraphs, lists, inline code, code blocks).',
    references: '- One reference per line: a URL, optionally preceded by a short title.\n- Prefer authoritative sources (OWASP, CWE, CAPEC, NIST, vendor advisories).\n- No bullets, no numbering, no other text.',
    remediation: '- Concrete, actionable remediation steps for this finding, most effective first.\n- Markdown is allowed (paragraphs, lists, inline code, code blocks).',
    custom: '- Write the content expected in this field, consistent with the other fields of the finding.\n- Markdown is allowed (paragraphs, lists, inline code).',
}

const PROMPT_TEMPLATE = `You're a pentester writing a report on a pentest conducted for {company_name} on project {audit_name}. The report language is "{report_language}".

You're currently working on a single finding with the following fields:
<title>
{title}
</title>

<description>
{description}
</description>

<observation>
{observation}
</observation>

<references>
{references}
</references>

<business_impact>
{business_impact}
</business_impact>

<affected_assets>
{affected_assets}
</affected_assets>

<cvss>
{cvss_string}
</cvss>

<remediation>
{remediation}
</remediation>

Notes of the auditors about the project (take them into account, do not question them):
{project_context}

Notes of the auditors about this finding (take them into account, do not question them):
{finding_hints}

{images_note}

Your specific task for now is to rewrite the field {selected_field} or write it from scratch, if empty and understandable based on other finding fields. Strictly follow these guidelines:
__GUIDELINES__

Do not print out anything but the requested field value - no pretext, no helper text or comments, only what should come to the field "{selected_field}".`

// Prompt of the quality advisor (key "advisor")
const ADVISOR_PROMPT = `You are a senior penetration tester reviewing the working notes a colleague took for one finding during the pentest "{audit_name}" ({audit_type}) for {company_name}. The notes were written quickly while testing. The report will be written later, when the target can no longer be tested again: no new screenshot, request or proof can be collected then. Tell whether these notes are enough to write this finding later, and what must be collected NOW, while testing is still possible.

Check in particular:
- Reproducibility: the exact affected host, URL, endpoint or parameter, the steps, the HTTP request and response (e.g. from Burp), the payload or the PoC code, the account or role used.
- Evidence: screenshots or captured output proving the issue AND its exploitation or impact, not only that a request was sent. {images_note}
- The issue itself: what is wrong and why it is a vulnerability and not an intended behaviour.
- Impact: what an attacker gains in this context, consistent with the CVSS vector and the severity.
- Consistency: the title, the CVSS vector, the affected assets and the notes describe the same thing.
- Overlap with the other findings of this audit listed below: when one looks like the same issue, suggest merging them or say what must be documented to tell them apart.

Do not ask for anything the notes of the auditors below declare intended, out of scope or not needed. Do not rewrite the finding and do not comment on style, wording or grammar: only on the substance needed to write it later. Be concrete and short: a list of actionable points, the most important first. When nothing important is missing, say so in one sentence.

Answer in {advice_language}. The first line of the answer must be exactly one of:
VERDICT: ok
VERDICT: weak
VERDICT: insufficient
(ok: enough to write the finding; weak: it can be written but useful material is missing; insufficient: the finding cannot be written or reproduced from these notes). Then the advice in Markdown: paragraphs, lists, bold and inline code only. No links, no images, no HTML, no buttons or forms, nothing to click.

Notes of the auditors about the project:
{project_context}

Notes of the auditors about this finding:
{finding_hints}

Other findings of this audit (titles only):
{other_findings}

The finding:
<title>{title}</title>
<type>{vuln_type}</type>
<category>{category}</category>
<cvss>{cvss_string} (score {cvss_score}, {cvss_severity})</cvss>

<affected_assets>
{affected_assets}
</affected_assets>

<description>
{description}
</description>

<observation>
{observation}
</observation>

<proofs>
{poc}
</proofs>

<remediation>
{remediation}
</remediation>

<references>
{references}
</references>

<custom_fields>
{custom_fields}
</custom_fields>`

function defaultPrompt(fieldKey) {
    if (fieldKey === 'advisor') return ADVISOR_PROMPT
    const guidelines = FIELD_GUIDELINES[fieldKey] || FIELD_GUIDELINES.custom
    return PROMPT_TEMPLATE.replace('__GUIDELINES__', guidelines)
}

// Placeholders of every prompt, shown in the help of the prompt editors
const PLACEHOLDERS = [
    { name: 'audit_name', description: 'Name of the audit' },
    { name: 'audit_type', description: 'Type of the audit' },
    { name: 'company_name', description: 'Company of the audit' },
    { name: 'client_name', description: 'Client contact of the audit (first and last name)' },
    { name: 'report_language', description: 'Language of the audit (name, e.g. English)' },
    { name: 'report_locale', description: 'Language of the audit (code, e.g. en)' },
    { name: 'audit_scope', description: 'Scope of the audit, one item per line' },
    { name: 'date_start', description: 'Start date of the audit' },
    { name: 'date_end', description: 'End date of the audit' },
    { name: 'title', description: 'Title of the finding' },
    { name: 'vuln_type', description: 'Type of the finding' },
    { name: 'category', description: 'Category of the finding' },
    { name: 'description', description: 'Description (Markdown)' },
    { name: 'observation', description: 'Observation (Markdown)' },
    { name: 'poc', description: 'Proofs (Markdown, images as ![alt](id))' },
    { name: 'references', description: 'References, one per line' },
    { name: 'affected_assets', description: 'Affected assets (Markdown)' },
    { name: 'remediation', description: 'Remediation (Markdown)' },
    { name: 'remediation_complexity', description: 'Remediation complexity: Easy, Medium or Complex' },
    { name: 'priority', description: 'Remediation priority: Low, Medium, High or Urgent' },
    { name: 'cvss_string', description: 'CVSS vector' },
    { name: 'cvss_score', description: 'CVSS base score' },
    { name: 'cvss_severity', description: 'CVSS severity (None, Low, Medium, High, Critical)' },
    { name: 'selected_field', description: 'Key of the field being written (e.g. description, business_impact)' },
    { name: 'selected_field_label', description: 'Label of the field being written (e.g. Description)' },
    { name: 'current_value', description: 'Current content of the field being written' },
    { name: 'project_context', description: 'Context for AI of the audit (General Information)' },
    { name: 'finding_hints', description: 'AI hints of the finding' },
    { name: 'other_findings', description: 'The other findings of the audit: severity, title, type (titles only)' },
    { name: 'custom_fields', description: 'Every custom field of the finding: label and value' },
    { name: 'advice_language', description: 'Language of the quality advisor (audit setting, else the global one)' },
    { name: 'images_note', description: 'Whether the images of the finding are attached to the request' },
]

// Fields of the finding the quality advisor reads, as placeholders (see review)
const ADVISOR_KEY = 'advisor'
const DEFAULT_ADVICE_LANGUAGE = 'English'
const CUSTOM_PLACEHOLDER_HELP = 'Each custom field of the findings, by its slug (label in lower case, spaces removed, other characters replaced by _), e.g. {business_impact}'

const COMPLEXITY = { 1: 'Easy', 2: 'Medium', 3: 'Complex' }
const PRIORITY = { 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Urgent' }

/*
 * Custom fields of the findings the assistant can write (rich text only), as
 * [{key, label, kind: 'html', id}]. `customFields` are the CustomField documents.
 */
function customTextFields(customFields) {
    const seen = new Set()
    const result = []
    for (const field of customFields || []) {
        if (!['finding', 'vulnerability'].includes(field.display)) continue
        if (field.fieldType !== 'text' || !field.label) continue
        const key = slugify(field.label)
        if (seen.has(key) || BUILTIN_FIELDS[key]) continue
        seen.add(key)
        result.push({ key: key, label: field.label, kind: 'html', id: String(field._id) })
    }
    return result
}

// Every field the assistant can write: built-in ones, then the custom ones
function availableFields(customFields) {
    const builtin = Object.keys(BUILTIN_FIELDS).map((key) => ({ key: key, label: BUILTIN_FIELDS[key].label, kind: BUILTIN_FIELDS[key].kind }))
    return builtin.concat(customTextFields(customFields))
}

function htmlToText(html) {
    return markdown.toMarkdown(html || '').trim()
}

function customFieldText(entry) {
    const definition = entry.customField && entry.customField.label ? entry.customField : entry
    const value = entry.text
    if (definition.fieldType === 'text') return htmlToText(value)
    if (Array.isArray(value)) return value.map(String).join('\n')
    return value === null || value === undefined ? '' : String(value)
}

function customFieldLabel(entry) {
    const definition = entry && entry.customField && entry.customField.label ? entry.customField : entry
    return definition && definition.label ? definition.label : null
}

// The other findings of the audit, one per line: severity, score, title, type
function otherFindingsText(audit, finding) {
    const lines = []
    for (const other of (audit && audit.findings) || []) {
        if (finding && finding._id && String(other._id) === String(finding._id)) continue
        const cvss = other.cvssv3 ? CVSS31.calculateCVSSFromVector(other.cvssv3) : { success: false }
        const severity = cvss.success ? `${cvss.baseSeverity} ${cvss.baseMetricScore}` : 'no CVSS'
        const type = [other.vulnType, other.category].filter(Boolean).join(', ')
        lines.push(`- [${severity}] ${other.title || '(no title)'}${type ? ` (${type})` : ''}`)
    }
    return lines.length ? lines.join('\n') : '(none)'
}

function customFieldsText(finding) {
    const parts = []
    for (const entry of (finding && finding.customFields) || []) {
        const label = customFieldLabel(entry)
        if (!label) continue
        const value = customFieldText(entry)
        if (value && String(value).trim()) parts.push(`${label}:\n${value}`)
    }
    return parts.join('\n\n')
}

function personName(person) {
    if (!person || typeof person !== 'object') return ''
    return [person.firstname, person.lastname].filter(Boolean).join(' ') || person.email || ''
}

/*
 * Values of the placeholders for a finding of an audit.
 *
 * audit: the audit document (company and client populated), finding: the
 * finding as the editor holds it (HTML fields, customFields entries),
 * fieldKey: the field being written, languages: [{language, locale}],
 * customFields: CustomField documents (every custom field gets a value, empty
 * when the finding has none, so that its placeholder never stays unreplaced).
 */
function buildValues({ audit = {}, finding = {}, fieldKey, languages = [], customFields = [], adviceLanguage = '', imagesNote = '' }) {
    const language = (languages || []).find((l) => l.locale === audit.language)
    const cvss = finding.cvssv3 ? CVSS31.calculateCVSSFromVector(finding.cvssv3) : { success: false }
    const scope = (audit.scope || []).map((item) => (typeof item === 'string' ? item : item && item.name)).filter(Boolean)

    const values = {
        audit_name: audit.name || '',
        audit_type: audit.auditType || '',
        company_name: (audit.company && audit.company.name) || '',
        client_name: personName(audit.client),
        report_language: language ? language.language : (audit.language || ''),
        report_locale: audit.language || '',
        audit_scope: scope.join('\n'),
        date_start: audit.date_start || '',
        date_end: audit.date_end || '',
        title: finding.title || '',
        vuln_type: finding.vulnType || '',
        category: finding.category || '',
        description: htmlToText(finding.description),
        observation: htmlToText(finding.observation),
        poc: htmlToText(finding.poc),
        references: (finding.references || []).join('\n'),
        affected_assets: plainText.toPlainText(finding.scope),
        remediation: htmlToText(finding.remediation),
        remediation_complexity: COMPLEXITY[finding.remediationComplexity] || '',
        priority: PRIORITY[finding.priority] || '',
        cvss_string: finding.cvssv3 || '',
        cvss_score: cvss.success ? String(cvss.baseMetricScore) : '',
        cvss_severity: cvss.success ? cvss.baseSeverity : '',
        project_context: (audit.aiContext || '').trim(),
        finding_hints: (finding.aiHints || '').trim(),
        other_findings: otherFindingsText(audit, finding),
        custom_fields: customFieldsText(finding),
        advice_language: adviceLanguage || (audit.aiAdvisorLanguage || '').trim() || DEFAULT_ADVICE_LANGUAGE,
        images_note: imagesNote,
    }

    for (const field of customFields || []) {
        if (!['finding', 'vulnerability'].includes(field.display) || !field.label || field.fieldType === 'space') continue
        const key = slugify(field.label)
        if (!(key in values)) values[key] = ''
    }
    for (const entry of finding.customFields || []) {
        const label = customFieldLabel(entry)
        if (!label) continue
        const key = slugify(label)
        if (key in BUILTIN_FIELDS || PLACEHOLDERS.some((p) => p.name === key)) continue
        values[key] = customFieldText(entry)
    }

    const field = availableFields(customFields).find((f) => f.key === fieldKey)
    values.selected_field = fieldKey || ''
    values.selected_field_label = field ? field.label : (fieldKey || '')
    values.current_value = fieldKey in values ? values[fieldKey] : ''
    return values
}

// Replaces the known {placeholders}, leaves anything else as it is
function render(template, values) {
    return String(template || '').replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => {
        return Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
    })
}

/*
 * Prompt of a template for the values: exactly the template, nothing is added
 * (a prompt without {project_context} / {finding_hints} / {images_note} does
 * not get them).
 */
function renderPrompt(template, values) {
    return render(template, values)
}

// Placeholders of a prompt that are not known (for the warnings of the editors)
function unknownPlaceholders(template, knownNames) {
    const known = new Set(knownNames)
    const result = new Set()
    const re = /\{([A-Za-z0-9_]+)\}/g
    let match
    while ((match = re.exec(String(template || ''))) !== null) {
        if (!known.has(match[1])) result.add(match[1])
    }
    return Array.from(result)
}

// Prompt of a field: the audit's override, the global one, the built-in default
function selectPrompt(fieldKey, auditPrompts, globalPrompts) {
    const pick = (prompts) => {
        const value = prompts && typeof prompts === 'object' ? prompts[fieldKey] : null
        return typeof value === 'string' && value.trim() ? value : null
    }
    return pick(auditPrompts) || pick(globalPrompts) || defaultPrompt(fieldKey)
}

/*
 * *** Model calls ***
 */

class AiError extends Error {
    constructor(message, status) {
        super(message)
        this.status = status || 502
    }
}

function joinUrl(host, suffix) {
    const base = String(host || '').trim().replace(/\/+$/, '')
    if (base.endsWith(suffix)) return base
    return base + suffix
}

function endpoint(config) {
    const host = String(config.apiHost || '').trim().replace(/\/+$/, '')
    if (config.provider === 'anthropic') {
        if (host.endsWith('/messages')) return host
        return host.endsWith('/v1') ? host + '/messages' : host + '/v1/messages'
    }
    return joinUrl(host, '/chat/completions')
}

function parseExtraBody(value) {
    if (!value) return {}
    if (typeof value === 'object') return value
    try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch (err) {
        throw new AiError('The extra body parameters of the AI integration are not valid JSON', 500)
    }
}

function isNumber(value) {
    return value !== null && value !== undefined && value !== '' && !isNaN(Number(value))
}

// Content of the user message: the prompt, then each image after its caption
function userContent(provider, prompt, images) {
    if (!images || !images.length) return prompt
    const parts = [{ type: 'text', text: prompt }]
    images.forEach((image, index) => {
        const label = `Image ${index + 1}${image.field ? ` (${image.field})` : ''}${image.caption ? `: ${image.caption}` : ''}`
        parts.push({ type: 'text', text: label })
        if (provider === 'anthropic') parts.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } })
        else parts.push({ type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.data}` } })
    })
    return parts
}

// {url, headers, body} of the request for a prompt (and its images)
function buildRequest(config, prompt, images = []) {
    if (!config || !config.apiHost) throw new AiError('The AI integration is not configured (API host)', 500)
    if (!config.model) throw new AiError('The AI integration is not configured (model)', 500)

    const headers = { 'Content-Type': 'application/json' }
    const body = { model: config.model }
    const system = config.systemPrompt && String(config.systemPrompt).trim()

    if (config.provider === 'anthropic') {
        if (config.apiKey) headers['x-api-key'] = config.apiKey
        headers['anthropic-version'] = '2023-06-01'
        body.max_tokens = isNumber(config.maxTokens) ? Number(config.maxTokens) : 4096
        if (system) body.system = system
        body.messages = [{ role: 'user', content: userContent('anthropic', prompt, images) }]
    } else {
        if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`
        body.messages = []
        if (system) body.messages.push({ role: 'system', content: system })
        body.messages.push({ role: 'user', content: userContent('openai', prompt, images) })
        if (isNumber(config.maxTokens)) body.max_tokens = Number(config.maxTokens)
    }
    if (isNumber(config.temperature)) body.temperature = Number(config.temperature)
    Object.assign(body, parseExtraBody(config.extraBody))

    return { url: endpoint(config), headers: headers, body: body }
}

function providerMessage(data, text) {
    if (data && data.error) {
        if (typeof data.error === 'string') return data.error
        if (data.error.message) return data.error.message
    }
    if (data && data.message) return data.message
    return (text || '').slice(0, 300)
}

function statusMessage(status) {
    switch (status) {
        case 400: return 'The model rejected the request'
        case 401: return 'The API key was refused by the model provider'
        case 403: return 'The model provider denied access'
        case 404: return 'Model or endpoint not found (check the API host and the model name)'
        case 408: return 'The model provider timed out'
        case 413: return 'The prompt is too large for the model'
        case 429: return 'Rate limit or quota of the model provider reached'
        default: return status >= 500 ? `The model provider failed (HTTP ${status})` : `The model provider answered HTTP ${status}`
    }
}

// Text of the answer, for both API styles
function extractText(provider, data) {
    if (provider === 'anthropic') {
        const blocks = (data && Array.isArray(data.content)) ? data.content : []
        return blocks.filter((b) => b && b.type === 'text').map((b) => b.text).join('')
    }
    const choice = data && Array.isArray(data.choices) ? data.choices[0] : null
    if (!choice) return ''
    const content = choice.message ? choice.message.content : choice.text
    if (Array.isArray(content)) return content.map((part) => (typeof part === 'string' ? part : part.text || '')).join('')
    return content || ''
}

/*
 * Sends a prompt, returns the text of the answer. Every failure is an AiError
 * with a readable message (never the HTTP status of the provider as is: a 401
 * of the provider must not look like an expired pwndoc session).
 */
async function complete(config, prompt, { fetchImpl = globalThis.fetch, images = [] } = {}) {
    const request = buildRequest(config, prompt, images)
    const timeout = (isNumber(config.timeout) ? Number(config.timeout) : 120) * 1000

    let response
    try {
        response = await fetchImpl(request.url, {
            method: 'POST',
            headers: request.headers,
            body: JSON.stringify(request.body),
            signal: AbortSignal.timeout(timeout),
        })
    } catch (err) {
        if (err && (err.name === 'TimeoutError' || err.name === 'AbortError'))
            throw new AiError(`The model did not answer within ${timeout / 1000} seconds`, 504)
        const cause = err && err.cause ? (err.cause.code || err.cause.message) : null
        throw new AiError(`Cannot reach the model at ${request.url}${cause ? ` (${cause})` : ''}`, 502)
    }

    const raw = await response.text()
    let data = null
    try { data = raw ? JSON.parse(raw) : null } catch (err) { data = null }

    if (!response.ok) {
        const detail = providerMessage(data, raw)
        throw new AiError(`${statusMessage(response.status)}${detail ? ': ' + detail : ''}`, 502)
    }
    if (!data) throw new AiError('The model provider did not answer JSON (check the API host)', 502)

    const text = extractText(config.provider, data)
    if (!text || !text.trim()) {
        const reason = config.provider === 'anthropic' ? data.stop_reason : (data.choices && data.choices[0] && data.choices[0].finish_reason)
        throw new AiError(`The model returned an empty answer${reason ? ` (${reason})` : ''}`, 502)
    }
    return text
}

/*
 * *** Answer -> field value ***
 */

// Drops reasoning blocks and a code fence wrapping the whole answer
function cleanAnswer(text) {
    let result = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    const fence = /^```(?:markdown|md|text|html)?[ \t]*\n([\s\S]*?)\n```$/i.exec(result)
    if (fence) result = fence[1].trim()
    return result
}

/*
 * Value to insert in the field: {kind, value}
 *   text:  a single line
 *   lines: an array of strings
 *   html:  editor HTML (sanitized)
 */
function toFieldValue(kind, text) {
    const answer = cleanAnswer(text)
    if (kind === 'text') {
        const line = answer.split('\n').map((l) => l.trim()).find((l) => l) || ''
        return line.replace(/^#+\s*/, '').replace(/^\*\*(.*)\*\*$/, '$1').replace(/^["'«“](.*)["'»”]$/, '$1').trim()
    }
    if (kind === 'lines') {
        return answer.split('\n')
            .map((l) => l.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, '').trim())
            .filter((l) => l)
    }
    return markdown.toHtml(answer)
}

/*
 * Whole generation: prompt selection, rendering, model call, conversion.
 * Returns {field, kind, value, model}.
 */
async function generate({ config, audit, finding, fieldKey, languages, customFields, fetchImpl, images = [] }) {
    const field = availableFields(customFields).find((f) => f.key === fieldKey)
    if (!field) throw new AiError(`Unknown field: ${fieldKey}`, 422)

    const imagesNote = images.length ? `The ${images.length} image(s) of the finding are attached, in their order of appearance, each after its caption: use what they show.` : ''
    const values = buildValues({ audit, finding, fieldKey, languages, customFields, imagesNote })
    const template = selectPrompt(fieldKey, audit && audit.aiPrompts, config && config.prompts)
    const prompt = renderPrompt(template, values)
    const text = await complete(config, prompt, { fetchImpl, images })
    const value = toFieldValue(field.kind, text)
    if ((Array.isArray(value) && value.length === 0) || (!Array.isArray(value) && !String(value).trim()))
        throw new AiError('The model returned an empty answer', 502)
    return { field: fieldKey, kind: field.kind, value: value, model: config.model }
}

/*
 * *** Quality advisor ***
 */

const VERDICTS = ['ok', 'weak', 'insufficient']

// HTML of the advice: sanitized Markdown, without images nor links (nothing
// in the panel loads a resource or can be clicked)
function adviceHtml(md) {
    return markdown.toHtml(md)
        .replace(/<img\b[^>]*>/gi, '')
        .replace(/<a\b[^>]*>/gi, '')
        .replace(/<\/a>/gi, '')
}

// {verdict, markdown, html} of an answer of the advisor
function parseAdvice(text) {
    let answer = cleanAnswer(text)
    let verdict = 'unknown'
    const m = /^[ \t>*_#-]*VERDICT[ \t*_]*:[ \t*_]*(ok|weak|insufficient)\b.*$/im.exec(answer)
    if (m) {
        verdict = m[1].toLowerCase()
        answer = (answer.slice(0, m.index) + answer.slice(m.index + m[0].length)).trim()
    }
    return { verdict, markdown: answer, html: adviceHtml(answer) }
}

function imagesNoteFor(refs, images) {
    if (images.length) return `The ${images.length} image(s) of the finding are attached to this message, in their order of appearance, each after its caption: check what they actually show.`
    if (refs.length) return `The finding holds ${refs.length} image(s) that are NOT attached: ![caption](id) marks them in the fields, judge them from their captions only.`
    return 'The finding holds no image.'
}

/*
 * Prompt of the advisor and the fingerprint of its inputs: the same
 * fingerprint means the same analysis, which is not run again.
 * refs: the images of the finding, images: those attached (loaded).
 */
function reviewPrompt({ config, audit, finding, languages, customFields, refs = [], images = [], sendImages = false }) {
    const adviceLanguage = (audit && audit.aiAdvisorLanguage || '').trim() || (config && config.advisorLanguage || '').trim() || DEFAULT_ADVICE_LANGUAGE
    const values = buildValues({ audit, finding, fieldKey: ADVISOR_KEY, languages, customFields, adviceLanguage, imagesNote: imagesNoteFor(refs, images) })
    const template = selectPrompt(ADVISOR_KEY, audit && audit.aiPrompts, config && config.prompts)
    const prompt = renderPrompt(template, values)
    // fingerprint of the inputs, not of the images actually loaded
    const inputs = Object.assign({}, values, { images_note: '' })
    const hash = crypto.createHash('sha256')
        .update(JSON.stringify({ template, inputs, images: refs.map((r) => r.src), sendImages: !!sendImages, model: config && config.model }))
        .digest('hex')
    return { prompt, hash }
}

/*
 * Runs the advisor. Returns {verdict, markdown, html, model, hash, date}.
 */
async function review({ config, audit, finding, languages, customFields, refs = [], images = [], sendImages = false, fetchImpl }) {
    const { prompt, hash } = reviewPrompt({ config, audit, finding, languages, customFields, refs, images, sendImages })
    const text = await complete(config, prompt, { fetchImpl, images })
    const advice = parseAdvice(text)
    if (!advice.markdown && advice.verdict === 'unknown') throw new AiError('The model returned an empty answer', 502)
    return Object.assign(advice, { model: config.model, hash, date: new Date().toISOString(), images: images.length })
}

/*
 * Low-quality flag after an analysis: the advisor raises it on an
 * insufficient verdict (unless a user lowered it for this very content) and
 * lowers it on an ok verdict only when it raised it itself.
 * Returns the fields to set: {lowQuality, lowQualitySource} or {}.
 */
function flagUpdate(finding, result) {
    const raised = !!finding.lowQuality
    if (result.verdict === 'insufficient' && !raised && finding.lowQualityDismissedHash !== result.hash)
        return { lowQuality: true, lowQualitySource: 'ai' }
    if (result.verdict === 'ok' && raised && finding.lowQualitySource === 'ai')
        return { lowQuality: false, lowQualitySource: null }
    return {}
}

module.exports = {
    BUILTIN_FIELDS,
    PLACEHOLDERS,
    CUSTOM_PLACEHOLDER_HELP,
    AiError,
    slugify,
    defaultPrompt,
    availableFields,
    buildValues,
    render,
    unknownPlaceholders,
    selectPrompt,
    buildRequest,
    complete,
    cleanAnswer,
    toFieldValue,
    generate,
    renderPrompt,
    userContent,
    ADVISOR_KEY,
    DEFAULT_ADVICE_LANGUAGE,
    VERDICTS,
    adviceHtml,
    parseAdvice,
    reviewPrompt,
    review,
    flagUpdate,
}

/*
 * *** Configuration from the settings page ***
 */

const PROMPT_KEY = /^[A-Za-z0-9_-]{1,64}$/
const MAX_PROMPT = 50000

// Prompts object from a request: {key: string}, unknown shapes dropped
function parsePrompts(value, errors) {
    const result = {}
    if (value === undefined || value === null) return result
    if (typeof value !== 'object' || Array.isArray(value)) { errors.push('prompts must be an object'); return result }
    for (const key of Object.keys(value)) {
        if (!PROMPT_KEY.test(key)) { errors.push(`invalid prompt key: ${key}`); continue }
        const text = value[key]
        if (text === null || text === undefined || text === '') continue
        if (typeof text !== 'string') { errors.push(`prompt ${key} must be a string`); continue }
        if (text.length > MAX_PROMPT) { errors.push(`prompt ${key} is too long`); continue }
        if (text.trim()) result[key] = text
    }
    return result
}

/*
 * Update of the global configuration from PUT /api/ai/config.
 * apiKey: absent or empty keeps the current key, clearApiKey: true removes it.
 * Returns {update, errors}.
 */
function parseConfigUpdate(body) {
    const input = body && typeof body === 'object' ? body : {}
    const update = {}
    const errors = []

    if (input.provider !== undefined) {
        if (!['openai', 'anthropic'].includes(input.provider)) errors.push('provider must be openai or anthropic')
        else update.provider = input.provider
    }
    if (input.apiHost !== undefined) {
        const host = String(input.apiHost || '').trim()
        if (host && !/^https?:\/\/[^\s]+$/i.test(host)) errors.push('apiHost must be an http(s) URL')
        else update.apiHost = host
    }
    if (input.clearApiKey === true) update.apiKey = ''
    else if (typeof input.apiKey === 'string' && input.apiKey.trim()) update.apiKey = input.apiKey.trim()
    if (input.model !== undefined) update.model = String(input.model || '').trim()

    const numbers = { temperature: [0, 2], maxTokens: [1, 1000000], timeout: [5, 3600] }
    for (const name of Object.keys(numbers)) {
        if (input[name] === undefined) continue
        if (input[name] === null || input[name] === '') { update[name] = name === 'timeout' ? 120 : null; continue }
        const number = Number(input[name])
        const [min, max] = numbers[name]
        if (isNaN(number) || number < min || number > max) errors.push(`${name} must be between ${min} and ${max}`)
        else update[name] = name === 'temperature' ? number : Math.round(number)
    }
    if (input.systemPrompt !== undefined) update.systemPrompt = String(input.systemPrompt || '')
    if (input.extraBody !== undefined) {
        const extra = String(input.extraBody || '').trim()
        if (extra) {
            try {
                const parsed = JSON.parse(extra)
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) errors.push('extraBody must be a JSON object')
            } catch (err) {
                errors.push('extraBody is not valid JSON')
            }
        }
        update.extraBody = extra
    }
    if (input.prompts !== undefined) update.prompts = parsePrompts(input.prompts, errors)
    if (input.supportsImages !== undefined) update.supportsImages = input.supportsImages === true
    if (input.advisorLanguage !== undefined) update.advisorLanguage = String(input.advisorLanguage || '').trim().substring(0, 64)
    return { update, errors }
}

module.exports.parsePrompts = parsePrompts
module.exports.parseConfigUpdate = parseConfigUpdate
