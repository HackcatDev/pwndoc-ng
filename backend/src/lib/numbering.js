/*
 * List numbering definitions for HTML lists converted by html2ooxml.
 *
 * Historically the converter referenced numId 1 (bullets) and numId 2
 * (ordered) and expected the template author to wire those ids in
 * word/numbering.xml by hand. Most templates do not have them (or have them
 * pointing at unrelated definitions), which renders ordered lists as bullets
 * and nested bullets as numbers.
 *
 * prepare(zip) adds two self-contained abstract definitions to the template
 * (9-level bullets and 9-level decimal) plus one concrete <w:num> for
 * bullets, and returns a context used to allocate one <w:num> per ordered
 * list so that every list restarts at 1.
 *
 * Must be called before docxtemplater parses the package when numbering.xml
 * (or its relationship / content type) has to be created.
 */

const NUMBERING_PATH = 'word/numbering.xml'
const RELS_PATH = 'word/_rels/document.xml.rels'
const CONTENT_TYPES_PATH = '[Content_Types].xml'
const NUMBERING_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml'
const NUMBERING_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering'

const EMPTY_NUMBERING = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:numbering>'

const BULLET_GLYPHS = ['•', '◦', '▪'] // • ◦ ▪

function maxAttr(xml, regex) {
    let max = 0
    let m
    while ((m = regex.exec(xml)) !== null) {
        const v = parseInt(m[1], 10)
        if (v > max) max = v
    }
    return max
}

function bulletAbstract(id) {
    let xml = `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>`
    for (let lvl = 0; lvl < 9; lvl++) {
        const glyph = BULLET_GLYPHS[lvl % BULLET_GLYPHS.length]
        xml += `<w:lvl w:ilvl="${lvl}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${glyph}"/><w:lvlJc w:val="left"/>` +
            `<w:pPr><w:ind w:left="${720 * (lvl + 1)}" w:hanging="360"/></w:pPr></w:lvl>`
    }
    return xml + '</w:abstractNum>'
}

function decimalAbstract(id) {
    let xml = `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>`
    const formats = ['decimal', 'lowerLetter', 'lowerRoman']
    for (let lvl = 0; lvl < 9; lvl++) {
        xml += `<w:lvl w:ilvl="${lvl}"><w:start w:val="1"/><w:numFmt w:val="${formats[lvl % 3]}"/><w:lvlText w:val="%${lvl + 1}."/><w:lvlJc w:val="left"/>` +
            `<w:pPr><w:ind w:left="${720 * (lvl + 1)}" w:hanging="360"/></w:pPr></w:lvl>`
    }
    return xml + '</w:abstractNum>'
}

// Inserts abstractNum definitions before the first <w:num> (schema order)
function insertAbstract(xml, abstractXml) {
    const idx = xml.search(/<w:num\b[^>]*w:numId=/)
    if (idx !== -1) return xml.substring(0, idx) + abstractXml + xml.substring(idx)
    return insertNum(xml, abstractXml)
}

// Inserts <w:num> definitions at the end of the numbering part
function insertNum(xml, numXml) {
    const cleanup = xml.indexOf('<w:numIdMacAtCleanup')
    if (cleanup !== -1) return xml.substring(0, cleanup) + numXml + xml.substring(cleanup)
    const end = xml.lastIndexOf('</w:numbering>')
    if (end === -1) throw new Error('numbering.xml: closing tag not found')
    return xml.substring(0, end) + numXml + xml.substring(end)
}

function ensureNumberingPart(zip) {
    if (zip.files[NUMBERING_PATH]) return
    zip.file(NUMBERING_PATH, EMPTY_NUMBERING)

    let rels = zip.files[RELS_PATH].asText()
    if (rels.indexOf(NUMBERING_REL_TYPE) === -1) {
        const ids = rels.match(/Id="rId(\d+)"/g) || []
        const next = ids.reduce((max, s) => Math.max(max, parseInt(s.match(/\d+/)[0], 10)), 0) + 1
        rels = rels.replace('</Relationships>', `<Relationship Id="rId${next}" Type="${NUMBERING_REL_TYPE}" Target="numbering.xml"/></Relationships>`)
        zip.file(RELS_PATH, rels)
    }

    let types = zip.files[CONTENT_TYPES_PATH].asText()
    if (types.indexOf('/word/numbering.xml') === -1) {
        types = types.replace('</Types>', `<Override PartName="/word/numbering.xml" ContentType="${NUMBERING_CONTENT_TYPE}"/></Types>`)
        zip.file(CONTENT_TYPES_PATH, types)
    }
}

/*
 * Adds the pwndoc list definitions to the template and returns the context:
 * { bulletNumId, decimalAbstractId, nextNumId }
 */
function prepare(zip) {
    ensureNumberingPart(zip)
    let xml = zip.files[NUMBERING_PATH].asText()

    const abstractBase = maxAttr(xml, /<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"/g) + 1
    const numBase = maxAttr(xml, /<w:num\b[^>]*w:numId="(\d+)"/g) + 1
    const ctx = {
        bulletAbstractId: abstractBase,
        decimalAbstractId: abstractBase + 1,
        bulletNumId: numBase,
        nextNumId: numBase + 1,
    }

    xml = insertAbstract(xml, bulletAbstract(ctx.bulletAbstractId) + decimalAbstract(ctx.decimalAbstractId))
    xml = insertNum(xml, `<w:num w:numId="${ctx.bulletNumId}"><w:abstractNumId w:val="${ctx.bulletAbstractId}"/></w:num>`)
    zip.file(NUMBERING_PATH, xml)
    return ctx
}

// Allocates a numId for an ordered list restarting at 1
function allocateOrderedList(zip, ctx) {
    const numId = ctx.nextNumId++
    let xml = zip.files[NUMBERING_PATH].asText()
    xml = insertNum(xml, `<w:num w:numId="${numId}"><w:abstractNumId w:val="${ctx.decimalAbstractId}"/>` +
        `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`)
    zip.file(NUMBERING_PATH, xml)
    return numId
}

module.exports = { prepare, allocateOrderedList, NUMBERING_PATH }
