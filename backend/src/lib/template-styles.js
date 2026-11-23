/*
 * Paragraph styles of the template (word/styles.xml) driven by the report
 * formatting configuration (lib/report-styles.js), applied before rendering.
 *
 * Table of contents: Word builds the entries of a TOC field from the TOC1..TOC9
 * styles. When a template does not give them a font, the page numbers (and
 * the entries of a level whose style does not exist yet) fall back to the
 * theme font (Cambria in the default theme) as soon as the field is updated,
 * while the titles keep the font of the headings. The TOC styles get the font
 * of the `toc` settings, or the one of the `text` profile.
 *
 * Headings: {h1}..{h6} (lib/report-markers.js) give a paragraph the HeadingN
 * style. Heading1..Heading6 are created when the template lacks them (with
 * their outline level, so that they appear in the table of contents) and
 * receive the formatting of the `headings` settings.
 */

const dom = require('./ooxml-dom')

const STYLES_PATH = 'word/styles.xml'

function styleById(doc, id) {
    const styles = doc.getElementsByTagNameNS(dom.W_NS, 'style')
    for (let i = 0; i < styles.length; i++) {
        if (dom.getVal(styles[i], 'styleId') === id) return styles[i]
    }
    return null
}

function appendStyle(doc, id, name, { next = 'Normal', uiPriority, pPr = [], qFormat = false, semiHidden = false } = {}) {
    const style = dom.wElement(doc, 'style', { type: 'paragraph', styleId: id })
    style.appendChild(dom.wElement(doc, 'name', { val: name }))
    if (styleById(doc, 'Normal')) style.appendChild(dom.wElement(doc, 'basedOn', { val: 'Normal' }))
    style.appendChild(dom.wElement(doc, 'next', { val: next }))
    if (uiPriority) style.appendChild(dom.wElement(doc, 'uiPriority', { val: uiPriority }))
    if (semiHidden) style.appendChild(dom.wElement(doc, 'semiHidden'))
    style.appendChild(dom.wElement(doc, 'unhideWhenUsed'))
    if (qFormat) style.appendChild(dom.wElement(doc, 'qFormat'))
    const ppr = dom.wElement(doc, 'pPr')
    for (const el of pPr) ppr.appendChild(el)
    style.appendChild(ppr)
    doc.documentElement.appendChild(style)
    return style
}

function hasProps(props) {
    return !!props && Object.keys(props).some((k) => props[k] !== undefined && props[k] !== null && props[k] !== '')
}

function applyFormatting(style, props) {
    if (!hasProps(props)) return
    const rPr = dom.ensureChild(style, 'rPr', dom.STYLE_ORDER)
    dom.applyRunProps(rPr, { font: props.font, size: props.size, color: props.color, bold: props.bold, italic: props.italic })
    if (props.spacingBefore !== undefined || props.spacingAfter !== undefined) {
        const pPr = dom.ensureChild(style, 'pPr', dom.STYLE_ORDER)
        dom.applySpacing(pPr, props.spacingBefore, props.spacingAfter)
    }
}

// TOC1..TOC9: font of the toc settings (or the text profile), created when missing
function applyTocStyles(doc, styles) {
    const toc = Object.assign({}, styles.toc || {})
    const textFont = styles.profiles && styles.profiles.text && styles.profiles.text.font
    if (!toc.font && textFont) toc.font = textFont
    if (!hasProps(toc)) return false
    for (let level = 1; level <= 9; level++) {
        let style = styleById(doc, 'TOC' + level)
        if (!style) {
            const ind = dom.wElement(doc, 'ind', { left: 220 * (level - 1) })
            style = appendStyle(doc, 'TOC' + level, 'toc ' + level, {
                uiPriority: 39,
                pPr: [dom.wElement(doc, 'spacing', { after: 100 }), ind],
            })
        }
        applyFormatting(style, { font: toc.font, size: toc.size, color: toc.color })
    }
    return true
}

// Heading1..Heading6: created when missing (outline level for the TOC), formatted
function applyHeadingStyles(doc, styles) {
    const headings = styles.headings || {}
    let changed = false
    for (let level = 1; level <= 6; level++) {
        let style = styleById(doc, 'Heading' + level)
        if (!style) {
            style = appendStyle(doc, 'Heading' + level, 'heading ' + level, {
                uiPriority: 9,
                qFormat: true,
                pPr: [dom.wElement(doc, 'keepNext'), dom.wElement(doc, 'keepLines'), dom.wElement(doc, 'outlineLvl', { val: level - 1 })],
            })
            const rPr = dom.ensureChild(style, 'rPr', dom.STYLE_ORDER)
            dom.applyRunProps(rPr, { bold: true })
            changed = true
        }
        if (hasProps(headings[level])) {
            applyFormatting(style, headings[level])
            changed = true
        }
    }
    return changed
}

/*
 * Updates word/styles.xml of the template zip (PizZip) for the resolved report
 * styles. Leaves the part untouched when there is nothing to do or when it
 * cannot be parsed.
 */
function apply(zip, styles) {
    const file = zip.files[STYLES_PATH]
    if (!file) return
    const xml = file.asText()
    const { doc, error } = dom.parse(xml)
    if (!doc) {
        console.log('template-styles: cannot parse styles.xml, left unchanged', error)
        return
    }
    const toc = applyTocStyles(doc, styles || {})
    const headings = applyHeadingStyles(doc, styles || {})
    if (toc || headings) zip.file(STYLES_PATH, dom.serialize(doc, xml))
}

module.exports = { apply, applyTocStyles, applyHeadingStyles, styleById }
