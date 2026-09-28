/*
 * Markdown <-> rich text conversion for the findings API.
 *
 * The rich text fields of a finding (description, observation, remediation,
 * poc, scope and the custom fields of type "text") are stored as the HTML
 * produced by the editor. The findings API speaks Markdown instead, so that
 * a client (an MCP server, a script) does not have to know that shape:
 *
 *   toHtml(markdown)   Markdown -> editor HTML (sanitized, paragraph-wrapped
 *                      list items and table cells, fenced code blocks kept
 *                      with their language)
 *   toMarkdown(html)   editor HTML -> Markdown, for reading a finding back
 *   toLines(value)     a Markdown list (or an array) -> array of strings,
 *                      used for the `references` field
 *
 * The conversion is deliberately lossy in one direction only: everything the
 * editor can store survives toMarkdown -> toHtml, except formatting Markdown
 * has no syntax for (highlight, underline, text alignment, merged table
 * cells). Images are kept as `![alt](<imageId>)`, the id being the one the
 * editor stores in the src attribute; the API never uploads images itself.
 */

const { marked } = require('marked')
const TurndownService = require('turndown')
const turndownGfm = require('turndown-plugin-gfm')
const htmlparser2 = require('htmlparser2')

// Tags kept when sanitizing, with the attributes allowed on each of them.
const ALLOWED_TAGS = {
    p: [], br: [],
    strong: [], b: [], em: [], i: [], u: [], s: [], strike: [], del: [],
    mark: ['data-color'], sup: [], sub: [], span: ['class'],
    h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
    ul: [], ol: ['start'], li: [],
    blockquote: [], hr: [],
    pre: ['class'], code: ['class'],
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'class', 'width', 'height'],
    figure: ['class'], figcaption: [],
    table: [], thead: [], tbody: [], tfoot: [],
    tr: [], td: ['colspan', 'rowspan', 'colwidth'], th: ['colspan', 'rowspan', 'colwidth'],
    colgroup: [], col: ['span', 'style'],
}

// Elements dropped together with their content
const DROPPED_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'svg', 'math', 'noscript', 'template', 'head', 'meta', 'link'])

const VOID_TAGS = new Set(['br', 'img', 'hr', 'col'])

// Elements whose inline content belongs inside a paragraph (editor schema)
const PARAGRAPH_CONTAINERS = new Set(['', 'li', 'td', 'th', 'blockquote', 'figcaption'])

const INLINE_TAGS = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'mark', 'sup', 'sub', 'span', 'code', 'a', 'img', 'br'])

const CLASS_REGEX = /^[A-Za-z0-9 _-]{0,120}$/
const COL_STYLE_REGEX = /^width:\s*\d+(?:\.\d+)?px;?$/
const IMAGE_ID_REGEX = /^[0-9a-fA-F]{24}$/

function escapeText(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttribute(value) {
    return escapeText(value).replace(/"/g, '&quot;')
}

// Links: only http(s), mailto and document relative targets
function safeUrl(url) {
    const value = String(url).trim()
    if (!value) return null
    if (/^(https?:|mailto:|tel:)/i.test(value)) return value
    if (/^[#/]/.test(value)) return value
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null // any other scheme (javascript:, data:, file:...)
    return value // relative reference
}

// Images: the editor stores the id of the uploaded image, base64 is allowed too
function safeImageSrc(src) {
    const value = String(src).trim()
    if (!value) return null
    if (IMAGE_ID_REGEX.test(value)) return value
    if (/^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$/i.test(value)) return value
    return safeUrl(value)
}

function cleanAttributes(tag, attribs) {
    const allowed = ALLOWED_TAGS[tag]
    let out = ''
    for (const name of allowed) {
        let value = attribs[name]
        if (value === undefined || value === null || value === '') continue
        switch (name) {
            case 'href': value = safeUrl(value); break
            case 'src': value = safeImageSrc(value); break
            case 'class': value = CLASS_REGEX.test(value) ? value : null; break
            case 'style': value = COL_STYLE_REGEX.test(String(value).trim()) ? value : null; break
            case 'colspan': case 'rowspan': case 'span': case 'width': case 'height':
                value = /^\d{1,5}$/.test(String(value).trim()) ? String(value).trim() : null
                break
            case 'colwidth': value = /^\[[\d,\s]*\]$|^\d{1,5}$/.test(String(value).trim()) ? value : null; break
            case 'target': value = value === '_blank' ? value : null; break
            default: value = String(value)
        }
        if (value === null) continue
        out += ` ${name}="${escapeAttribute(value)}"`
    }
    return out
}

/*
 * Rebuilds the HTML keeping only the elements and attributes above, and
 * wrapping bare inline content of list items, table cells and quotes in a
 * paragraph so that the result has the same shape as the editor's output.
 */
function sanitize(html) {
    let out = ''
    let dropDepth = 0
    let preDepth = 0
    // Elements emitted so far. `implicit` marks a paragraph we opened ourselves.
    const stack = []

    const innerContainer = () => {
        for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].skipped) continue // dropped element: transparent for its content
            if (stack[i].implicit) return null
            return stack[i].tag
        }
        return ''
    }
    const openImplicitParagraph = () => {
        out += '<p>'
        stack.push({ tag: 'p', implicit: true })
    }
    const closeImplicitParagraph = () => {
        while (stack.length && stack[stack.length - 1].implicit) {
            out += '</p>'
            stack.pop()
        }
    }
    const needsParagraph = () => {
        const container = innerContainer()
        return container !== null && PARAGRAPH_CONTAINERS.has(container)
    }

    const parser = new htmlparser2.Parser({
        onopentag(name, attribs) {
            const tag = String(name).toLowerCase()
            if (dropDepth > 0) { dropDepth += 1; return }
            if (DROPPED_TAGS.has(tag)) { dropDepth = 1; return }
            if (!ALLOWED_TAGS[tag]) { stack.push({ tag, skipped: true }); return }
            // A link whose target was rejected keeps its text, not the tag
            if (tag === 'a' && !safeUrl(attribs.href || '')) { stack.push({ tag, skipped: true }); return }

            if (INLINE_TAGS.has(tag)) {
                if (needsParagraph()) openImplicitParagraph()
            } else {
                closeImplicitParagraph()
            }

            if (tag === 'pre') preDepth += 1
            out += `<${tag}${cleanAttributes(tag, attribs)}>`
            if (VOID_TAGS.has(tag)) {
                if (tag === 'br') out = out.slice(0, -1) + '/>'
                return // htmlparser2 reports the matching close tag, ignored below
            }
            stack.push({ tag })
        },

        ontext(text) {
            if (dropDepth > 0) return
            if (preDepth > 0) {
                if (text) out += escapeText(text)
                return
            }
            if (!text) return
            if (!text.trim() && needsParagraph()) return // layout whitespace between blocks
            if (needsParagraph()) openImplicitParagraph()
            out += escapeText(text)
        },

        onclosetag(name) {
            const tag = String(name).toLowerCase()
            if (dropDepth > 0) { dropDepth -= 1; return }
            if (VOID_TAGS.has(tag)) return
            const entry = stack.length ? stack[stack.length - 1] : null
            if (entry && entry.implicit) closeImplicitParagraph()
            const current = stack.length ? stack[stack.length - 1] : null
            if (!current || current.tag !== tag) return // unbalanced input, nothing emitted
            stack.pop()
            if (current.skipped) return
            if (tag === 'pre') preDepth -= 1
            out += `</${tag}>`
        },
    }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true })

    parser.write(String(html))
    parser.end()

    // Close whatever the input left open
    for (let i = stack.length - 1; i >= 0; i--) {
        if (!stack[i].skipped) out += `</${stack[i].tag}>`
    }
    return out.replace(/<p><\/p>/g, '').trim()
}

/*
 * Markdown -> editor HTML. Returns "" for an empty value so that a field can
 * be cleared by sending an empty string.
 */
function toHtml(markdown) {
    if (markdown === null || markdown === undefined) return ''
    if (typeof markdown !== 'string') markdown = String(markdown)
    if (!markdown.trim()) return ''
    const html = marked.parse(markdown, { gfm: true, breaks: true, async: false })
    return sanitize(html)
}

const turndown = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    blankReplacement: (content, node) => (node.isBlock ? '\n\n' : ''),
})
turndown.use(turndownGfm.gfm)

// Underline and highlight have no Markdown syntax: keep the text only
turndown.addRule('keepTextOnly', {
    filter: ['u', 'mark', 'sup', 'sub', 'span', 'figure', 'figcaption'],
    replacement: (content) => content,
})

// The editor keeps list item and table cell content in paragraphs; they must
// not become blank lines (or, in a table, break the row)
turndown.addRule('paragraphInListItem', {
    filter: (node) => node.nodeName === 'P' && node.parentNode && node.parentNode.nodeName === 'LI',
    replacement: (content) => content,
})

turndown.addRule('paragraphInTableCell', {
    filter: (node) => node.nodeName === 'P' && node.parentNode && ['TD', 'TH'].includes(node.parentNode.nodeName),
    replacement: (content, node) => {
        let next = node.nextSibling
        while (next && next.nodeType === 3 && !next.nodeValue.trim()) next = next.nextSibling
        return content + (next ? '<br>' : '')
    },
})

// Same as turndown's own list items, with a two space indent for sublists
turndown.addRule('listItem', {
    filter: 'li',
    replacement: (content, node, options) => {
        const text = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/gm, '\n  ')
        let prefix = `${options.bulletListMarker} `
        const parent = node.parentNode
        if (parent.nodeName === 'OL') {
            const start = parent.getAttribute('start')
            const index = Array.prototype.indexOf.call(parent.children, node)
            prefix = `${start ? Number(start) + index : index + 1}. `
        }
        return prefix + text + (node.nextSibling && !/\n$/.test(text) ? '\n' : '')
    },
})

// The editor writes the language as a class on <code>
turndown.addRule('codeBlockLanguage', {
    filter: (node) => node.nodeName === 'PRE' && node.firstChild && node.firstChild.nodeName === 'CODE',
    replacement: (content, node) => {
        const code = node.firstChild
        const className = code.getAttribute('class') || ''
        const language = (className.match(/language-([A-Za-z0-9_+-]+)/) || [null, ''])[1]
        const text = code.textContent.replace(/\n+$/, '')
        return `\n\n\`\`\`${language}\n${text}\n\`\`\`\n\n`
    },
})

/*
 * editor HTML -> Markdown
 */
function toMarkdown(html) {
    if (html === null || html === undefined) return ''
    const value = String(html)
    if (!value.trim()) return ''
    return turndown.turndown(value).trim()
}

/*
 * Array of lines for the `references` field: accepts an array, or Markdown /
 * plain text with one entry per line (leading list markers are removed).
 */
function toLines(value) {
    if (value === null || value === undefined) return []
    const items = Array.isArray(value) ? value : String(value).split(/\r?\n/)
    return items
        .map((item) => String(item).replace(/^\s*(?:[-*+]|\d{1,3}[.)])\s+/, '').trim())
        .filter((item) => item !== '')
}

module.exports = { toHtml, toMarkdown, toLines, sanitize }
