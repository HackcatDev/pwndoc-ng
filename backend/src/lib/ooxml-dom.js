/*
 * Small DOM helpers to edit WordprocessingML parts (document.xml, styles.xml)
 * with @xmldom/xmldom while keeping the element order the schema requires.
 */

const { DOMParser, XMLSerializer } = require('@xmldom/xmldom')

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

// ECMA-376 CT_RPr element order
const RPR_ORDER = [
    'rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow',
    'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern',
    'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs',
    'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath',
]

// ECMA-376 CT_PPr element order
const PPR_ORDER = [
    'pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr',
    'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap',
    'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid',
    'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection',
    'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange',
]

// ECMA-376 CT_Style element order
const STYLE_ORDER = [
    'name', 'aliases', 'basedOn', 'next', 'link', 'autoRedefine', 'hidden', 'uiPriority', 'semiHidden',
    'unhideWhenUsed', 'qFormat', 'locked', 'personal', 'personalCompose', 'personalReply', 'rsid', 'pPr',
    'rPr', 'tblPr', 'trPr', 'tcPr', 'tblStylePr',
]

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

function firstChild(node, name) {
    return elementChildren(node, name)[0] || null
}

function parse(xml) {
    const errors = []
    const doc = new DOMParser({ onError: (level, msg) => { if (level === 'fatalError' || level === 'error') errors.push(msg) } })
        .parseFromString(xml, 'text/xml')
    if (errors.length || !doc || !doc.documentElement) return { doc: null, error: errors[0] || 'parse error' }
    return { doc, error: null }
}

function serialize(doc, original) {
    let out = new XMLSerializer().serializeToString(doc)
    if (original && original.startsWith('<?xml') && !out.startsWith('<?xml')) {
        out = original.substring(0, original.indexOf('?>') + 2) + out
    }
    return out
}

function wElement(doc, name, attrs) {
    const el = doc.createElementNS(W_NS, 'w:' + name)
    for (const key of Object.keys(attrs || {})) {
        if (attrs[key] === undefined || attrs[key] === null) continue
        el.setAttributeNS(W_NS, 'w:' + key, String(attrs[key]))
    }
    return el
}

function getVal(el, attr = 'val') {
    if (!el) return null
    return el.getAttributeNS(W_NS, attr) || el.getAttribute('w:' + attr) || null
}

// Inserts `el` in `parent` at the position given by `order`, replacing the
// elements of the same name
function placeChild(parent, el, order) {
    const name = localName(el)
    const existing = elementChildren(parent, name)
    if (existing.length) {
        parent.replaceChild(el, existing[0])
        for (let i = 1; i < existing.length; i++) parent.removeChild(existing[i])
        return el
    }
    const rank = order.indexOf(name)
    if (rank !== -1) {
        for (const child of elementChildren(parent)) {
            const childRank = order.indexOf(localName(child))
            if (childRank === -1 || childRank > rank) { parent.insertBefore(el, child); return el }
        }
    }
    parent.appendChild(el)
    return el
}

function removeChildren(parent, name) {
    for (const el of elementChildren(parent, name)) parent.removeChild(el)
}

// Returns the child `name` of `parent`, created at its schema position
function ensureChild(parent, name, order) {
    const found = firstChild(parent, name)
    if (found) return found
    return placeChild(parent, wElement(parent.ownerDocument, name), order)
}

/*
 * Applies run formatting to a <w:rPr> element. props: {font, size (pt),
 * color (hex), bold, italic, underline, rStyle}; undefined / null values are
 * left as they are, false removes bold / italic / underline explicitly.
 */
function applyRunProps(rPr, props) {
    const doc = rPr.ownerDocument
    if (!props) return
    if (props.rStyle) placeChild(rPr, wElement(doc, 'rStyle', { val: props.rStyle }), RPR_ORDER)
    if (props.font) {
        removeChildren(rPr, 'rFonts')
        placeChild(rPr, wElement(doc, 'rFonts', { ascii: props.font, hAnsi: props.font, eastAsia: props.font, cs: props.font }), RPR_ORDER)
    }
    if (props.bold === true) {
        placeChild(rPr, wElement(doc, 'b'), RPR_ORDER)
        placeChild(rPr, wElement(doc, 'bCs'), RPR_ORDER)
    } else if (props.bold === false) {
        placeChild(rPr, wElement(doc, 'b', { val: '0' }), RPR_ORDER)
        placeChild(rPr, wElement(doc, 'bCs', { val: '0' }), RPR_ORDER)
    }
    if (props.italic === true) {
        placeChild(rPr, wElement(doc, 'i'), RPR_ORDER)
        placeChild(rPr, wElement(doc, 'iCs'), RPR_ORDER)
    } else if (props.italic === false) {
        placeChild(rPr, wElement(doc, 'i', { val: '0' }), RPR_ORDER)
        placeChild(rPr, wElement(doc, 'iCs', { val: '0' }), RPR_ORDER)
    }
    if (props.color) placeChild(rPr, wElement(doc, 'color', { val: props.color }), RPR_ORDER)
    if (props.size) {
        const half = Math.round(Number(props.size) * 2)
        placeChild(rPr, wElement(doc, 'sz', { val: half }), RPR_ORDER)
        placeChild(rPr, wElement(doc, 'szCs', { val: half }), RPR_ORDER)
    }
    if (props.underline === true) placeChild(rPr, wElement(doc, 'u', { val: 'single' }), RPR_ORDER)
    else if (props.underline === false) placeChild(rPr, wElement(doc, 'u', { val: 'none' }), RPR_ORDER)
}

// Applies paragraph spacing (pt) to a <w:pPr> element
function applySpacing(pPr, spacingBefore, spacingAfter) {
    const has = (v) => v !== undefined && v !== null && v !== ''
    if (!has(spacingBefore) && !has(spacingAfter)) return
    const spacing = ensureChild(pPr, 'spacing', PPR_ORDER)
    if (has(spacingBefore)) {
        spacing.setAttributeNS(W_NS, 'w:before', String(Math.round(Number(spacingBefore) * 20)))
        spacing.removeAttribute('w:beforeLines'); spacing.removeAttribute('w:beforeAutospacing')
    }
    if (has(spacingAfter)) {
        spacing.setAttributeNS(W_NS, 'w:after', String(Math.round(Number(spacingAfter) * 20)))
        spacing.removeAttribute('w:afterLines'); spacing.removeAttribute('w:afterAutospacing')
    }
}

module.exports = {
    W_NS,
    RPR_ORDER,
    PPR_ORDER,
    STYLE_ORDER,
    localName,
    elementChildren,
    firstChild,
    parse,
    serialize,
    wElement,
    getVal,
    placeChild,
    removeChildren,
    ensureChild,
    applyRunProps,
    applySpacing,
}
