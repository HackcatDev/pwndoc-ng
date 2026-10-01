/*
 * Post-processing of the rendered document parts (word/document.xml,
 * headers, footers...) after docxtemplater has rendered the template.
 *
 * Cell shading: pwndoc exposes `{@cvss.cellColor}` (and the remediation
 * variants) as raw OOXML `<w:tcPr><w:shd .../></w:tcPr>` fragments. A raw tag
 * replaces the paragraph that carries it, so the fragment lands *after* the
 * `<w:tcPr>` that the template cell already has, producing a cell with two
 * property blocks (invalid OOXML - Word tolerates it, other consumers do
 * not, and the result depends on which block wins). `mergeCellProperties`
 * merges every extra `<w:tcPr>` of a cell into its first one, respecting the
 * CT_TcPr element order, so the cell is properly shaded.
 *
 * Image spacing: an image inserted by the template ({%image}, usually inside
 * an {#images} loop after the text of a field) sits right under the text and
 * the text that follows sits right under its caption. `spaceImages` adds an
 * empty paragraph between a non-empty paragraph (or a table) and an image,
 * and after the caption of the image (after the image itself when it has no
 * caption), unless an empty paragraph is already there.
 */

const { DOMParser, XMLSerializer } = require('@xmldom/xmldom')

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

// Element order inside <w:tcPr> (ECMA-376 CT_TcPr)
const TCPR_ORDER = [
    'cnfStyle', 'tcW', 'gridSpan', 'hMerge', 'vMerge', 'tcBorders', 'shd', 'noWrap', 'tcMar',
    'textDirection', 'tcFitText', 'vAlign', 'hideMark', 'headers', 'cellIns', 'cellDel', 'cellMerge', 'tcPrChange',
]

// Files of the package that may contain rendered tables
const PART_REGEX = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/

function localName(node) {
    return node.localName || String(node.nodeName).replace(/^.*:/, '')
}

function elementChildren(node, name) {
    const out = []
    for (let n = node.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 1 && (!name || localName(n) === name)) out.push(n)
    }
    return out
}

function firstElementChild(node) {
    for (let n = node.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) return n
    return null
}

// Inserts `el` into `tcPr` at the position required by the schema, replacing
// an element of the same name if present.
function placeInTcPr(tcPr, el) {
    const name = localName(el)
    const existing = elementChildren(tcPr, name)
    if (existing.length) {
        tcPr.replaceChild(el, existing[0])
        for (let i = 1; i < existing.length; i++) tcPr.removeChild(existing[i])
        return
    }
    const rank = TCPR_ORDER.indexOf(name)
    if (rank === -1) { tcPr.appendChild(el); return }
    for (const child of elementChildren(tcPr)) {
        const childRank = TCPR_ORDER.indexOf(localName(child))
        if (childRank === -1 || childRank > rank) { tcPr.insertBefore(el, child); return }
    }
    tcPr.appendChild(el)
}

// Returns true when the xml string looks like it contains a misplaced tcPr
function needsCellMerge(xml) {
    return xml.indexOf('</w:tcPr><w:tcPr>') !== -1
        || xml.indexOf('</w:p><w:tcPr>') !== -1
        || xml.indexOf('</w:tbl><w:tcPr>') !== -1
        || xml.indexOf('</w:sdt><w:tcPr>') !== -1
}

/*
 * Merges duplicated <w:tcPr> elements in every table cell of an XML part.
 * Returns the (possibly unchanged) XML string.
 */
function mergeCellProperties(xml) {
    if (!needsCellMerge(xml)) return xml

    const errors = []
    const doc = new DOMParser({ onError: (level, msg) => { if (level === 'fatalError' || level === 'error') errors.push(msg) } })
        .parseFromString(xml, 'text/xml')
    if (errors.length || !doc || !doc.documentElement) {
        console.log('ooxml-postprocess: cannot parse part, left unchanged', errors[0] || '')
        return xml
    }

    let changed = false
    const cells = Array.prototype.slice.call(doc.getElementsByTagNameNS(W_NS, 'tc'))
    for (const tc of cells) {
        const tcPrs = elementChildren(tc, 'tcPr')
        if (tcPrs.length === 0) continue
        const first = firstElementChild(tc)
        let primary = null
        let extras
        if (first && localName(first) === 'tcPr') {
            primary = first
            extras = tcPrs.slice(1)
        } else {
            // no leading tcPr: promote the first misplaced one
            primary = tcPrs[0]
            extras = tcPrs.slice(1)
            tc.removeChild(primary)
            tc.insertBefore(primary, tc.firstChild)
            changed = true
        }
        for (const extra of extras) {
            for (const el of elementChildren(extra)) {
                extra.removeChild(el)
                placeInTcPr(primary, el)
            }
            tc.removeChild(extra)
            changed = true
        }
    }
    if (!changed) return xml

    let out = new XMLSerializer().serializeToString(doc)
    // xmldom drops nothing but may re-declare empty namespaces; keep the prolog
    if (xml.startsWith('<?xml') && !out.startsWith('<?xml')) {
        out = xml.substring(0, xml.indexOf('?>') + 2) + out
    }
    return out
}

/*
 * *** Image spacing ***
 */

// Elements that do not count as content between two paragraphs
const TRANSPARENT = new Set(['bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd', 'proofErr', 'permStart', 'permEnd'])

function paragraphText(p) {
    let text = ''
    const ts = p.getElementsByTagNameNS(W_NS, 't')
    for (let i = 0; i < ts.length; i++) text += ts[i].textContent || ''
    return text
}

function hasPicture(p) {
    if (p.getElementsByTagNameNS(W_NS, 'drawing').length) return true
    if (p.getElementsByTagNameNS(W_NS, 'pict').length) return true
    return false
}

function isParagraph(node) {
    return !!node && node.nodeType === 1 && localName(node) === 'p'
}

// A paragraph holding a picture and no text
function isImageParagraph(node) {
    return isParagraph(node) && hasPicture(node) && paragraphText(node).trim() === ''
}

// A paragraph or a table with something visible in it
function isContent(node) {
    if (!node || node.nodeType !== 1) return false
    const name = localName(node)
    if (name === 'tbl') return true
    if (name === 'sdt') return paragraphText(node).trim() !== '' || hasPicture(node)
    if (name !== 'p') return false
    return paragraphText(node).trim() !== '' || hasPicture(node)
}

function siblingElement(node, direction) {
    let n = direction < 0 ? node.previousSibling : node.nextSibling
    while (n) {
        if (n.nodeType === 1 && !TRANSPARENT.has(localName(n))) return n
        n = direction < 0 ? n.previousSibling : n.nextSibling
    }
    return null
}

function paragraphProperty(p, name) {
    const pPr = elementChildren(p, 'pPr')[0]
    if (!pPr) return null
    const el = elementChildren(pPr, name)[0]
    return el ? (el.getAttributeNS(W_NS, 'val') || el.getAttribute('w:val')) : null
}

// The paragraph after an image is its caption when it is styled as one, holds
// a SEQ field or shares the centered alignment of the image. An empty one is
// the caption slot of an image without caption ({caption} rendered empty): it
// is part of the figure too, so the text after it gets the same blank line.
function isCaption(node, imageParagraph) {
    if (!isParagraph(node) || hasPicture(node)) return false
    const style = paragraphProperty(node, 'pStyle') || ''
    if (/caption|l[eé]gende|beschriftung/i.test(style)) return true
    const instr = node.getElementsByTagNameNS(W_NS, 'instrText')
    for (let i = 0; i < instr.length; i++) if (/^\s*SEQ\s/i.test(instr[i].textContent || '')) return true
    const jc = paragraphProperty(node, 'jc')
    return jc === 'center' && paragraphProperty(imageParagraph, 'jc') === 'center'
}

// Empty paragraph with the properties of the image paragraph (same font size
// for the blank line), without list, section, alignment or change tracking
function blankParagraph(doc, model) {
    const p = doc.createElementNS(W_NS, 'w:p')
    const pPr = elementChildren(model, 'pPr')[0]
    if (pPr) {
        const copy = pPr.cloneNode(true)
        for (const el of elementChildren(copy)) {
            if (['numPr', 'sectPr', 'pPrChange', 'jc', 'keepNext', 'pageBreakBefore', 'framePr'].includes(localName(el))) copy.removeChild(el)
        }
        p.appendChild(copy)
    }
    return p
}

/*
 * Adds a blank line before the images that follow text and after their
 * caption (or after the image without caption) when text follows.
 * Returns the (possibly unchanged) XML string.
 */
function spaceImages(xml) {
    if (xml.indexOf('<w:drawing') === -1 && xml.indexOf('<w:pict') === -1) return xml

    const errors = []
    const doc = new DOMParser({ onError: (level, msg) => { if (level === 'fatalError' || level === 'error') errors.push(msg) } })
        .parseFromString(xml, 'text/xml')
    if (errors.length || !doc || !doc.documentElement) {
        console.log('ooxml-postprocess: cannot parse part, images left unchanged', errors[0] || '')
        return xml
    }

    let changed = false
    const paragraphs = Array.prototype.slice.call(doc.getElementsByTagNameNS(W_NS, 'p'))
    for (const p of paragraphs) {
        if (!isImageParagraph(p)) continue
        const parent = p.parentNode
        if (!parent) continue

        const previous = siblingElement(p, -1)
        if (previous && isContent(previous) && !isImageParagraph(previous)) {
            parent.insertBefore(blankParagraph(doc, p), p)
            changed = true
        }

        let end = p
        let next = siblingElement(p, 1)
        if (next && isCaption(next, p)) {
            end = next
            next = siblingElement(next, 1)
        }
        if (next && isContent(next)) {
            parent.insertBefore(blankParagraph(doc, p), end.nextSibling)
            changed = true
        }
    }
    if (!changed) return xml

    let out = new XMLSerializer().serializeToString(doc)
    if (xml.startsWith('<?xml') && !out.startsWith('<?xml')) {
        out = xml.substring(0, xml.indexOf('?>') + 2) + out
    }
    return out
}

/*
 * Applies the post-processing to every relevant part of the zip
 * (PizZip instance returned by docxtemplater's getZip()).
 */
function processZip(zip, options = {}) {
    Object.keys(zip.files).forEach((name) => {
        if (!PART_REGEX.test(name)) return
        const file = zip.files[name]
        if (!file || file.dir) return
        const xml = file.asText()
        let fixed = mergeCellProperties(xml)
        if (options.imageSpacing && name === 'word/document.xml') fixed = spaceImages(fixed)
        if (fixed !== xml) zip.file(name, fixed)
    })
}

module.exports = { mergeCellProperties, processZip, needsCellMerge, spaceImages }
