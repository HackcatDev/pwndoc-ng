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
 * Applies the post-processing to every relevant part of the zip
 * (PizZip instance returned by docxtemplater's getZip()).
 */
function processZip(zip) {
    Object.keys(zip.files).forEach((name) => {
        if (!PART_REGEX.test(name)) return
        const file = zip.files[name]
        if (!file || file.dir) return
        const xml = file.asText()
        const fixed = mergeCellProperties(xml)
        if (fixed !== xml) zip.file(name, fixed)
    })
}

module.exports = { mergeCellProperties, processZip, needsCellMerge }
