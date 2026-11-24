/*
 * Paragraph level tags of the report templates, rendered in two steps.
 *
 * 1. While docxtemplater renders the template, the module below turns the tags
 *    into invisible markers (U+2063 ... U+2063) in the text:
 *
 *      {h1} .. {h6}     the paragraph holding the tag becomes a heading of that
 *                       level (HeadingN style, outline level for the table of
 *                       contents). Inside a finding loop the heading is also
 *                       the target of the links to that finding.
 *      {anchor}         target of the links to the current finding, without
 *                       changing the paragraph (templates without headings)
 *      {link}...{/link} the text in between becomes a link to the heading (or
 *                       anchor) of the current finding, e.g. in a summary table:
 *                       {#findings}{link}{title}{/link}{/findings}
 *
 *    The tags can be anywhere in the paragraph and keep the formatting of the
 *    template text around them. {link} and {/link} must be in the same
 *    paragraph.
 *
 * 2. After rendering, processDocument() applies them to word/document.xml:
 *    paragraph style and heading formatting, bookmarks, hyperlinks with the
 *    finding link formatting. It also paints the Legendary findings (cells
 *    shaded by {@cvss.cellColor} and the word "Legendary") in rainbow colors.
 */

const dom = require('./ooxml-dom')

const MARK = '⁣'
const MARKER_REGEX = /⁣PWD\|([A-Z])\|([^⁣]*)⁣/g
const PWD_NS = 'urn:pwndoc'
const MODULE_NAME = 'pwndoc-markers'
const TAG_REGEX = /^\s*(h[1-6]|anchor|link|\/link)\s*$/

function marker(type, arg) {
    return `${MARK}PWD|${type}|${arg || ''}${MARK}`
}

// Bookmark name of a finding: letters, digits and underscores, 40 characters at most
function anchorName(id) {
    if (id === undefined || id === null || id === '') return ''
    return ('Finding_' + String(id).replace(/[^A-Za-z0-9_]/g, '_')).substring(0, 40)
}

/*
 * docxtemplater module: {h1}..{h6}, {anchor}, {link}, {/link}. The finding is
 * found in the current scope (identifier, else unique_id).
 */
class MarkerModule {
    constructor() {
        this.name = 'PwndocMarkerModule'
    }

    matchers() {
        return [[TAG_REGEX, MODULE_NAME, { priority: 1000 }]]
    }

    render(part, options) {
        if (part.module !== MODULE_NAME) return null
        const tag = String(part.value).trim()
        let anchor = ''
        if (tag !== '/link') {
            const lookup = (name) => {
                // the parsers are cached by part index: a distinct one per lookup
                const lookupPart = Object.assign({}, part, { lIndex: `pwd-${name}-${part.lIndex}` })
                try { return options.scopeManager.getValue(name, { part: lookupPart }) } catch (err) { return undefined }
            }
            let id = lookup('identifier')
            if (id === undefined || id === null || id === '' || id === 'undefined') id = lookup('unique_id')
            if (typeof id === 'string' || typeof id === 'number') anchor = anchorName(id)
        }
        if (/^h[1-6]$/.test(tag)) return { value: marker('H', tag[1] + ':' + anchor) }
        if (tag === 'anchor') return { value: marker('A', anchor) }
        if (tag === 'link') return { value: marker('L', anchor) }
        return { value: marker('E', '') }
    }
}

/*
 * *** Post-processing ***
 */

function textOf(node) {
    let text = ''
    const ts = node.getElementsByTagNameNS(dom.W_NS, 't')
    for (let i = 0; i < ts.length; i++) text += ts[i].textContent || ''
    return text
}

function ancestor(node, name) {
    let n = node.parentNode
    while (n && n.nodeType === 1) {
        if (dom.localName(n) === name) return n
        n = n.parentNode
    }
    return null
}

function newRun(doc, rPr, children) {
    const r = dom.wElement(doc, 'r')
    if (rPr) r.appendChild(rPr.cloneNode(true))
    for (const c of children) r.appendChild(c)
    return r
}

function textElement(doc, text) {
    const t = dom.wElement(doc, 't')
    t.setAttribute('xml:space', 'preserve')
    t.appendChild(doc.createTextNode(text))
    return t
}

// Replaces the markers of a <w:t> by <pwd:marker> elements placed between
// runs that keep the formatting of the original run
function splitMarkers(doc, t) {
    const r = t.parentNode
    const text = t.textContent || ''
    const pieces = text.split(/(⁣PWD\|[A-Z]\|[^⁣]*⁣)/)
    if (!r || dom.localName(r) !== 'r') {
        // not in a run: drop the markers
        while (t.firstChild) t.removeChild(t.firstChild)
        t.appendChild(doc.createTextNode(text.replace(MARKER_REGEX, '')))
        return
    }
    const parent = r.parentNode
    const rPr = dom.firstChild(r, 'rPr')
    const content = dom.elementChildren(r).filter((c) => dom.localName(c) !== 'rPr')
    const index = content.indexOf(t)
    const before = content.slice(0, index)
    const after = content.slice(index + 1)

    if (before.length) parent.insertBefore(newRun(doc, rPr, before), r)
    for (const piece of pieces) {
        if (piece === '') continue
        const m = /^⁣PWD\|([A-Z])\|([^⁣]*)⁣$/.exec(piece)
        if (m) {
            const el = doc.createElementNS(PWD_NS, 'pwd:marker')
            el.setAttribute('type', m[1])
            el.setAttribute('arg', m[2])
            parent.insertBefore(el, r)
        } else {
            parent.insertBefore(newRun(doc, rPr, [textElement(doc, piece)]), r)
        }
    }
    if (after.length) parent.insertBefore(newRun(doc, rPr, after), r)
    parent.removeChild(r)
}

function runsOf(node) {
    return Array.prototype.slice.call(node.getElementsByTagNameNS(dom.W_NS, 'r'))
}

function ensureRunProps(run) {
    let rPr = dom.firstChild(run, 'rPr')
    if (!rPr) {
        rPr = dom.wElement(run.ownerDocument, 'rPr')
        run.insertBefore(rPr, run.firstChild)
    }
    return rPr
}

function ensureParagraphProps(p) {
    let pPr = dom.firstChild(p, 'pPr')
    if (!pPr) {
        pPr = dom.wElement(p.ownerDocument, 'pPr')
        p.insertBefore(pPr, p.firstChild)
    }
    return pPr
}

function headingProps(cfg) {
    if (!cfg) return null
    const props = { font: cfg.font, size: cfg.size, color: cfg.color }
    if (typeof cfg.bold === 'boolean') props.bold = cfg.bold
    if (typeof cfg.italic === 'boolean') props.italic = cfg.italic
    return props
}

function makeHeading(p, level, cfg) {
    const doc = p.ownerDocument
    const pPr = ensureParagraphProps(p)
    dom.placeChild(pPr, dom.wElement(doc, 'pStyle', { val: 'Heading' + level }), dom.PPR_ORDER)
    dom.placeChild(pPr, dom.wElement(doc, 'outlineLvl', { val: level - 1 }), dom.PPR_ORDER)
    const props = headingProps(cfg)
    if (!props) return
    dom.applySpacing(pPr, cfg.spacingBefore, cfg.spacingAfter)
    const markRPr = dom.firstChild(pPr, 'rPr')
    if (markRPr) dom.applyRunProps(markRPr, props)
    for (const run of runsOf(p)) dom.applyRunProps(ensureRunProps(run), props)
}

function addBookmark(p, name, id) {
    const doc = p.ownerDocument
    const start = dom.wElement(doc, 'bookmarkStart', { id, name })
    const end = dom.wElement(doc, 'bookmarkEnd', { id })
    const pPr = dom.firstChild(p, 'pPr')
    p.insertBefore(start, pPr ? pPr.nextSibling : p.firstChild)
    p.appendChild(end)
}

function maxBookmarkId(doc) {
    let max = 0
    const starts = doc.getElementsByTagNameNS(dom.W_NS, 'bookmarkStart')
    for (let i = 0; i < starts.length; i++) {
        const v = parseInt(dom.getVal(starts[i], 'id'), 10)
        if (v > max) max = v
    }
    return max
}

function linkProps(cfg) {
    const props = { color: cfg.color, rStyle: cfg.rStyle }
    if (typeof cfg.underline === 'boolean') props.underline = cfg.underline
    if (typeof cfg.bold === 'boolean') props.bold = cfg.bold
    if (typeof cfg.italic === 'boolean') props.italic = cfg.italic
    return props
}

function processMarkers(doc, options) {
    const ts = Array.prototype.slice.call(doc.getElementsByTagNameNS(dom.W_NS, 't'))
    for (const t of ts) {
        if ((t.textContent || '').indexOf(MARK + 'PWD|') !== -1) splitMarkers(doc, t)
    }
    const markers = () => Array.prototype.slice.call(doc.getElementsByTagNameNS(PWD_NS, 'marker'))

    // Headings and anchors: the first paragraph of a finding is its link target
    const anchors = new Set()
    let bookmarkId = Math.max(maxBookmarkId(doc), 900000)
    for (const m of markers()) {
        const type = m.getAttribute('type')
        if (type !== 'H' && type !== 'A') continue
        const p = ancestor(m, 'p')
        let name = m.getAttribute('arg') || ''
        if (type === 'H') {
            const [level, anchor] = name.split(':')
            name = anchor || ''
            if (p) makeHeading(p, parseInt(level, 10), (options.headings || {})[level])
        }
        if (p && name && !anchors.has(name)) {
            anchors.add(name)
            addBookmark(p, name, ++bookmarkId)
        }
        m.parentNode.removeChild(m)
    }

    // Links: the nodes between {link} and {/link} (same parent) move into a hyperlink
    const props = linkProps(options.findingLink || {})
    for (const m of markers()) {
        if (!m.parentNode || m.getAttribute('type') !== 'L') continue
        const parent = m.parentNode
        const name = m.getAttribute('arg') || ''
        let end = m.nextSibling
        const between = []
        while (end && !(end.nodeType === 1 && end.namespaceURI === PWD_NS && end.getAttribute('type') === 'E')) {
            between.push(end)
            end = end.nextSibling
        }
        if (name && anchors.has(name) && dom.localName(parent) !== 'hyperlink') {
            const link = dom.wElement(doc, 'hyperlink', { anchor: name, history: '1' })
            parent.insertBefore(link, m)
            for (const node of between) {
                if (node.nodeType === 1 && node.namespaceURI === PWD_NS) { parent.removeChild(node); continue }
                link.appendChild(node)
                if (node.nodeType === 1) {
                    const runs = dom.localName(node) === 'r' ? [node] : runsOf(node)
                    for (const run of runs) dom.applyRunProps(ensureRunProps(run), props)
                }
            }
        }
        parent.removeChild(m)
        if (end) parent.removeChild(end)
    }

    for (const m of markers()) m.parentNode.removeChild(m)
}

/*
 * *** Legendary ***
 */

function hslToHex(h, s, l) {
    s /= 100; l /= 100
    const k = (n) => (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    return [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('').toUpperCase()
}

function luminance(hex) {
    const c = [0, 2, 4].map((i) => parseInt(hex.substring(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

function contrast(a, b) {
    const la = luminance(a)
    const lb = luminance(b)
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const MIN_CONTRAST = 4.5

/*
 * Colors of the letters of a text of `count` characters, red to violet,
 * readable on `background`: each hue is made lighter (dark background) or
 * darker (light background) until it contrasts enough with it.
 */
function rainbow(count, background = null) {
    const bg = /^[0-9A-F]{6}$/i.test(background || '') ? background.toUpperCase() : null
    const colors = []
    for (let i = 0; i < count; i++) {
        const hue = count > 1 ? (285 * i) / (count - 1) : 0
        let lightness = 50
        let color = hslToHex(hue, 100, lightness)
        if (bg) {
            const step = luminance(bg) < 0.18 ? 2 : -2
            while (contrast(color, bg) < MIN_CONTRAST && lightness > 0 && lightness < 100) {
                lightness += step
                color = hslToHex(hue, 100, lightness)
            }
        }
        colors.push(color)
    }
    return colors
}

// Fill of the cell holding a run (white when not shaded)
function backgroundOf(run) {
    const tc = ancestor(run, 'tc')
    const tcPr = tc ? dom.firstChild(tc, 'tcPr') : null
    const shd = tcPr ? dom.firstChild(tcPr, 'shd') : null
    const fill = shd ? dom.getVal(shd, 'fill') : null
    return fill && /^[0-9A-F]{6}$/i.test(fill) ? fill : 'FFFFFF'
}

// Splits a run holding only text into one run per character, in rainbow colors
function rainbowRun(run) {
    const content = dom.elementChildren(run).filter((c) => dom.localName(c) !== 'rPr')
    if (content.length !== 1 || dom.localName(content[0]) !== 't') return false
    const chars = Array.from(content[0].textContent || '')
    if (!chars.length) return false
    const doc = run.ownerDocument
    const rPr = dom.firstChild(run, 'rPr')
    const colors = rainbow(chars.filter((c) => c.trim() !== '').length, backgroundOf(run))
    let i = 0
    for (const c of chars) {
        const r = newRun(doc, rPr, [textElement(doc, c)])
        if (c.trim() !== '') dom.applyRunProps(ensureRunProps(r), { color: colors[i++] })
        run.parentNode.insertBefore(r, run)
    }
    run.parentNode.removeChild(run)
    return true
}

function processLegendary(doc, options) {
    const cells = new Set()
    const flags = Array.prototype.slice.call(doc.getElementsByTagNameNS(PWD_NS, 'legendary'))
    for (const flag of flags) {
        const tc = ancestor(flag, 'tc')
        if (tc) cells.add(tc)
        flag.parentNode.removeChild(flag)
    }
    if (!options.legendary) return
    const runs = new Set()
    for (const tc of cells) for (const run of runsOf(tc)) runs.add(run)
    const label = options.legendaryLabel || 'Legendary'
    for (const run of runsOf(doc)) {
        if (textOf(run).trim() === label) runs.add(run)
    }
    for (const run of runs) if (run.parentNode) rainbowRun(run)
}

/*
 * Applies the markers and the Legendary colors to an XML part. options:
 * {headings, findingLink, legendary (bool), legendaryLabel}
 */
function processDocument(xml, options = {}) {
    const hasMarkers = xml.indexOf(MARK + 'PWD|') !== -1
    const hasLegendary = xml.indexOf(PWD_NS) !== -1 || (options.legendary && xml.indexOf('>' + (options.legendaryLabel || 'Legendary') + '<') !== -1)
    if (!hasMarkers && !hasLegendary) return xml
    const { doc, error } = dom.parse(xml)
    if (!doc) {
        console.log('report-markers: cannot parse part, markers removed', error)
        return stripMarkers(xml)
    }
    if (hasMarkers) processMarkers(doc, options)
    processLegendary(doc, options)
    return dom.serialize(doc, xml)
}

// Removes the markers left in a part that is not post-processed (headers...)
function stripMarkers(xml) {
    if (xml.indexOf(MARK) === -1 && xml.indexOf(PWD_NS) === -1) return xml
    return xml.replace(MARKER_REGEX, '').replace(/<pwd:legendary[^>]*\/>/g, '')
}

// Raw OOXML fragment flagging a cell of a Legendary finding (see cellColor)
const LEGENDARY_FLAG = `<pwd:legendary xmlns:pwd="${PWD_NS}"/>`

module.exports = {
    MarkerModule,
    processDocument,
    stripMarkers,
    anchorName,
    marker,
    rainbow,
    LEGENDARY_FLAG,
    PWD_NS,
    TAG_REGEX,
}
