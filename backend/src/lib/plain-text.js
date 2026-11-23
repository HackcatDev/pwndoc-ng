/*
 * Plain text fields.
 *
 * The affected assets of a finding (`scope`) are plain text: one asset per
 * line, no formatting, no links. Findings written before this field became
 * plain text hold the HTML of the rich text editor (<p>https://...</p>,
 * sometimes with <a> links), so every reader goes through toPlainText, which
 * turns that HTML back into lines of text and leaves plain text untouched.
 *
 *   isHtml(value)       true for the HTML of the editor
 *   toPlainText(value)  plain text (legacy HTML converted), \n line endings,
 *                       trailing spaces and leading / trailing empty lines removed
 *   toLines(value)      non-empty trimmed lines
 *   textToHtml(value)   one escaped <p> per line, for the convertHTML filter
 */

const htmlparser2 = require('htmlparser2')

// The editor output always starts with a block element
const HTML_REGEX = /^\s*<(p|div|ul|ol|li|h[1-6]|pre|blockquote|table|figure|img|br|hr)(\s[^>]*)?\/?>/i

const BLOCK_TAGS = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'blockquote', 'tr', 'figcaption', 'ul', 'ol', 'table'])

function isHtml(value) {
    return typeof value === 'string' && HTML_REGEX.test(value)
}

function htmlToText(html) {
    let out = ''
    let skip = 0
    const newline = () => { if (out && !out.endsWith('\n')) out += '\n' }
    const parser = new htmlparser2.Parser({
        onopentag(name) {
            if (name === 'script' || name === 'style') { skip += 1; return }
            if (name === 'br') { out += '\n'; return }
            if (BLOCK_TAGS.has(name)) newline()
            if (name === 'td' || name === 'th') { if (out && !/[\n\t]$/.test(out)) out += '\t' }
        },
        ontext(text) {
            if (skip) return
            out += text
        },
        onclosetag(name) {
            if (name === 'script' || name === 'style') { skip = Math.max(0, skip - 1); return }
            if (BLOCK_TAGS.has(name)) newline()
        },
    }, { decodeEntities: true })
    parser.write(String(html))
    parser.end()
    return out.replace(/ /g, ' ')
}

function toPlainText(value) {
    if (value === null || value === undefined) return ''
    let text = Array.isArray(value) ? value.map((v) => (v === null || v === undefined ? '' : String(v))).join('\n') : String(value)
    if (isHtml(text)) text = htmlToText(text)
    return text
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/\s+$/, ''))
        .join('\n')
        .replace(/^\n+/, '')
        .replace(/\n+$/, '')
}

function toLines(value) {
    return toPlainText(value)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
}

function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function textToHtml(value) {
    return toLines(value).map((line) => `<p>${escapeHtml(line)}</p>`).join('')
}

module.exports = { isHtml, htmlToText, toPlainText, toLines, textToHtml }
