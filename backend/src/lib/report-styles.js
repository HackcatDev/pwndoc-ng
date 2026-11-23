/*
 * Report formatting configuration.
 *
 * The formatting applied to HTML fields converted by {@x | convertHTML} is
 * resolved from three layers (each one overriding the previous):
 *
 *   1. built-in defaults (no direct formatting: rely on the Word template)
 *   2. config/report-styles.json  - deployment wide defaults, editable on
 *      the bind-mounted config folder, re-read when the file changes
 *   3. the `styles` object stored on the report template (per template,
 *      editable from the Templates page of the WebUI)
 *
 * Structure:
 * {
 *   "profiles": {
 *     "text":        { font, size, color, bold, italic, alignment, shading,
 *                      spacingBefore, spacingAfter, lineSpacing, pStyle },
 *     "caption":     { ... },
 *     "<any name>":  { ... }      // used with {@x | convertHTML:'<name>'}
 *   },
 *   "inlineCode": { font, size, color, shading, rStyle },
 *   "codeBlock":  { font, size, color, shading, spacingBefore, spacingAfter,
 *                   lineSpacing, pStyle },
 *   "link":       { color, underline, rStyle },
 *   "highlightSyntax": false,
 *   "syntaxColors": { "hljs-keyword": "0000FF", ... },
 *   "listNumbering": "auto"      // "auto": self-contained list definitions added
 *                                // to the template; "template": use numId 1 (bullets)
 *                                // and 2 (ordered) of the template's numbering.xml
 *   "imageSpacing": true,        // blank line between text and an image and after
 *                                // its caption (lib/ooxml-postprocess.js)
 *   "toc":        { font, size, color },   // TOC1..TOC9 styles (page numbers
 *                                // included); font defaults to the text profile
 *   "headings":   { "1": { font, size, color, bold, italic, spacingBefore,
 *                          spacingAfter }, ... "6": {...} }  // Heading1..6
 *                                // styles and the {h1}..{h6} paragraphs
 *   "findingLink": { color, underline, bold, italic, rStyle }, // {link}...{/link}
 *   "severityColors": { none, low, medium, high, critical, legendary },
 *                                // cell colors ({@cvss.cellColor}), default:
 *                                // the CVSS colors of the settings
 *   "legendary": false           // findings scored 9.5 or more are "Legendary"
 * }
 *
 * Sizes are in points, colors are hex RGB (with or without '#'), spacing in
 * points, lineSpacing is a multiple (1 = single).
 */

const fs = require('fs')
const path = require('path')
const _ = require('lodash')

const DEFAULTS = {
    profiles: {
        text: {},
        caption: { alignment: 'center' },
    },
    inlineCode: {},
    codeBlock: {},
    link: {},
    highlightSyntax: false,
    listNumbering: 'auto',
    imageSpacing: true,
    toc: {},
    headings: {},
    findingLink: { color: '0563C1', underline: true },
    severityColors: { legendary: '2D0A4E' },
    legendary: false,
    syntaxColors: {
        'hljs-keyword': '0000FF',
        'hljs-built_in': '795E26',
        'hljs-type': '267F99',
        'hljs-literal': '0000FF',
        'hljs-number': '098658',
        'hljs-regexp': '811F3F',
        'hljs-string': 'A31515',
        'hljs-symbol': '0000FF',
        'hljs-class': '267F99',
        'hljs-function': '795E26',
        'hljs-title': '795E26',
        'hljs-params': '001080',
        'hljs-comment': '008000',
        'hljs-doctag': '800000',
        'hljs-meta': '0000FF',
        'hljs-section': '800000',
        'hljs-tag': '800000',
        'hljs-name': '800000',
        'hljs-attribute': 'E50000',
        'hljs-attr': 'E50000',
        'hljs-variable': '001080',
        'hljs-template-variable': '001080',
        'hljs-bullet': '0451A5',
        'hljs-addition': '098658',
        'hljs-deletion': 'A31515',
        'hljs-selector-tag': '800000',
        'hljs-selector-id': '800000',
        'hljs-selector-class': '800000',
        'hljs-selector-attr': 'E50000',
        'hljs-selector-pseudo': 'E50000',
    },
}

const PROFILE_FIELDS = ['font', 'size', 'color', 'bold', 'italic', 'alignment', 'shading', 'spacingBefore', 'spacingAfter', 'lineSpacing', 'pStyle']
const INLINE_CODE_FIELDS = ['font', 'size', 'color', 'shading', 'rStyle']
const CODE_BLOCK_FIELDS = ['font', 'size', 'color', 'shading', 'spacingBefore', 'spacingAfter', 'lineSpacing', 'pStyle']
const LINK_FIELDS = ['color', 'underline', 'rStyle']
const TOC_FIELDS = ['font', 'size', 'color']
const HEADING_FIELDS = ['font', 'size', 'color', 'bold', 'italic', 'spacingBefore', 'spacingAfter']
const FINDING_LINK_FIELDS = ['color', 'underline', 'bold', 'italic', 'rStyle']
const SEVERITIES = ['none', 'low', 'medium', 'high', 'critical', 'legendary']
const HEADING_LEVELS = ['1', '2', '3', '4', '5', '6']
const ALIGNMENTS = ['left', 'center', 'right', 'justify']

function configPath() {
    const base = global.__basedir || path.join(__dirname, '..')
    return path.join(base, 'config', 'report-styles.json')
}

let cache = { path: null, mtimeMs: null, data: {} }

// Reads config/report-styles.json (cached, re-read when modified)
function loadGlobal() {
    const file = configPath()
    try {
        const stat = fs.statSync(file)
        if (cache.path === file && cache.mtimeMs === stat.mtimeMs) return cache.data
        const data = JSON.parse(fs.readFileSync(file, 'utf8'))
        cache = { path: file, mtimeMs: stat.mtimeMs, data: sanitize(data) }
        return cache.data
    } catch (err) {
        if (err.code !== 'ENOENT') console.log(`report-styles: cannot read ${file}: ${err.message}`)
        cache = { path: file, mtimeMs: null, data: {} }
        return cache.data
    }
}

// Overlay merge: null / "" / undefined in the source keep the base value
function overlay(base, src) {
    return _.mergeWith({}, base, src, (objValue, srcValue) => {
        if (srcValue === null || srcValue === undefined || srcValue === '') return objValue
        if (Array.isArray(srcValue)) return srcValue
        return undefined
    })
}

// Resolves the effective configuration for a template
function resolve(templateStyles) {
    let result = overlay(DEFAULTS, loadGlobal())
    if (templateStyles && typeof templateStyles === 'object') result = overlay(result, sanitize(templateStyles))
    return result
}

function cleanHex(value) {
    if (value === null || value === undefined || value === '') return null
    const v = String(value).trim().replace(/^#/, '').toUpperCase()
    return /^[0-9A-F]{6}$/.test(v) ? v : null
}

function cleanNumber(value, min, max) {
    if (value === null || value === undefined || value === '') return null
    const n = Number(value)
    if (!isFinite(n) || n < min || n > max) return null
    return n
}

function cleanString(value, max = 64) {
    if (value === null || value === undefined) return null
    const s = String(value).trim()
    if (!s) return null
    return s.substring(0, max).replace(/[<>"&]/g, '')
}

function cleanFields(obj, fields) {
    const out = {}
    if (!obj || typeof obj !== 'object') return out
    for (const f of fields) {
        if (!(f in obj)) continue
        let v = obj[f]
        switch (f) {
            case 'font': case 'pStyle': case 'rStyle': v = cleanString(v); break
            case 'size': v = cleanNumber(v, 4, 72); break
            case 'color': case 'shading': v = cleanHex(v); break
            case 'bold': case 'italic': case 'underline': v = (v === null || v === undefined || v === '') ? null : !!v; break
            case 'alignment': v = ALIGNMENTS.includes(v) ? v : null; break
            case 'spacingBefore': case 'spacingAfter': v = cleanNumber(v, 0, 200); break
            case 'lineSpacing': v = cleanNumber(v, 0.5, 5); break
            default: v = null
        }
        if (v !== null) out[f] = v
    }
    return out
}

// Validates / normalizes a styles object coming from a file or from the API.
// Unknown keys are dropped, invalid values ignored.
function sanitize(input) {
    const out = {}
    if (!input || typeof input !== 'object') return out
    if (input.profiles && typeof input.profiles === 'object') {
        out.profiles = {}
        for (const name of Object.keys(input.profiles)) {
            if (!/^[a-zA-Z0-9_-]{1,32}$/.test(name)) continue
            out.profiles[name] = cleanFields(input.profiles[name], PROFILE_FIELDS)
        }
    }
    if (input.inlineCode) out.inlineCode = cleanFields(input.inlineCode, INLINE_CODE_FIELDS)
    if (input.codeBlock) out.codeBlock = cleanFields(input.codeBlock, CODE_BLOCK_FIELDS)
    if (input.link) out.link = cleanFields(input.link, LINK_FIELDS)
    if (input.highlightSyntax !== undefined && input.highlightSyntax !== null && input.highlightSyntax !== '') out.highlightSyntax = !!input.highlightSyntax
    if (input.listNumbering === 'auto' || input.listNumbering === 'template') out.listNumbering = input.listNumbering
    if (input.imageSpacing !== undefined && input.imageSpacing !== null && input.imageSpacing !== '') out.imageSpacing = !!input.imageSpacing
    if (input.toc) out.toc = cleanFields(input.toc, TOC_FIELDS)
    if (input.findingLink) out.findingLink = cleanFields(input.findingLink, FINDING_LINK_FIELDS)
    if (input.headings && typeof input.headings === 'object') {
        out.headings = {}
        for (const level of HEADING_LEVELS) {
            if (input.headings[level]) out.headings[level] = cleanFields(input.headings[level], HEADING_FIELDS)
        }
    }
    if (input.severityColors && typeof input.severityColors === 'object') {
        out.severityColors = {}
        for (const severity of SEVERITIES) {
            const c = cleanHex(input.severityColors[severity])
            if (c) out.severityColors[severity] = c
        }
    }
    if (input.legendary !== undefined && input.legendary !== null && input.legendary !== '') out.legendary = !!input.legendary
    if (input.syntaxColors && typeof input.syntaxColors === 'object') {
        out.syntaxColors = {}
        for (const cls of Object.keys(input.syntaxColors)) {
            if (!/^[a-zA-Z0-9_-]{1,40}$/.test(cls)) continue
            const c = cleanHex(input.syntaxColors[cls])
            if (c) out.syntaxColors[cls] = c
        }
    }
    return out
}

// Severity colors of the settings (Settings > Report > CVSS colors), without '#'
function severityColorsFromSettings(settings) {
    const out = {}
    const colors = settings && settings.report && settings.report.public && settings.report.public.cvssColors
    if (!colors) return out
    for (const severity of ['none', 'low', 'medium', 'high', 'critical']) {
        const c = cleanHex(colors[severity + 'Color'])
        if (c) out[severity] = c
    }
    return out
}

module.exports = {
    DEFAULTS,
    PROFILE_FIELDS,
    INLINE_CODE_FIELDS,
    CODE_BLOCK_FIELDS,
    LINK_FIELDS,
    TOC_FIELDS,
    HEADING_FIELDS,
    FINDING_LINK_FIELDS,
    SEVERITIES,
    HEADING_LEVELS,
    loadGlobal,
    resolve,
    sanitize,
    severityColorsFromSettings,
}
