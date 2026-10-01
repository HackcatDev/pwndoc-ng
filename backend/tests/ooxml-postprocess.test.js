module.exports = function () {
  var pp = require("../src/lib/ooxml-postprocess")
  var wrap = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`

  describe('OOXML post-processing', () => {
    it('merges a cellColor fragment into the existing tcPr (schema order, replaces shading)', () => {
      var xml = wrap(`<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="100" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="FFFFFF"/><w:vAlign w:val="center"/></w:tcPr><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="FF0000"/></w:tcPr><w:p><w:r><w:t>IDX-001</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`)
      var out = pp.mergeCellProperties(xml)
      expect(out).toContain(`<w:tc><w:tcPr><w:tcW w:w="100" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="FF0000"/><w:vAlign w:val="center"/></w:tcPr><w:p>`)
      expect((out.match(/<w:tcPr>/g) || []).length).toEqual(1)
      expect(out.startsWith('<?xml version="1.0"')).toBe(true)
    })

    it('handles a fragment placed after a paragraph and a cell without tcPr', () => {
      var xml = wrap(`<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="100" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>a</w:t></w:r></w:p><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="00FF00"/></w:tcPr></w:tc><w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="0000FF"/></w:tcPr></w:tc></w:tr></w:tbl>`)
      var out = pp.mergeCellProperties(xml)
      expect(out).toContain(`<w:tc><w:tcPr><w:tcW w:w="100" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="00FF00"/></w:tcPr><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc>`)
      expect(out).toContain(`<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="0000FF"/></w:tcPr><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc>`)
    })

    it('leaves a valid document untouched', () => {
      var xml = wrap(`<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="100" w:type="dxa"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>`)
      expect(pp.mergeCellProperties(xml)).toBe(xml)
    })
  })

  describe('Image spacing', () => {
    var P = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"'
    var text = (t, jc) => `<w:p><w:pPr>${jc ? `<w:jc w:val="${jc}"/>` : ''}<w:rPr><w:sz w:val="16"/></w:rPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`
    var image = `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr><w:jc w:val="center"/><w:rPr><w:sz w:val="24"/></w:rPr></w:pPr><w:r><w:drawing><wp:inline ${P}/></w:drawing></w:r></w:p>`
    var empty = (jc) => `<w:p>${jc ? `<w:pPr><w:jc w:val="${jc}"/></w:pPr>` : ''}</w:p>`
    var blank = `<w:p><w:pPr><w:rPr><w:sz w:val="24"/></w:rPr></w:pPr></w:p>`
    var body = (out) => out.replace(/^[\s\S]*<w:body>/, '').replace(/<\/w:body>[\s\S]*$/, '')

    it('adds a blank line between text and an image, and after the caption', () => {
      var out = pp.spaceImages(wrap(text('before') + image + text('Figure 1', 'center') + text('after')))
      expect(body(out)).toBe(text('before') + blank + image + text('Figure 1', 'center') + blank + text('after'))
    })

    it('an image without caption: blank line after its empty caption slot, or after the image', () => {
      var out = pp.spaceImages(wrap(text('before') + image + empty('center') + text('after')))
      expect(body(out)).toBe(text('before') + blank + image + empty('center') + blank + text('after'))
      out = pp.spaceImages(wrap(image + text('after')))
      expect(body(out)).toBe(image + blank + text('after'))
    })

    it('keeps the blank lines that are already there and spaces consecutive images', () => {
      var xml = wrap(text('before') + empty() + image + empty() + text('after'))
      expect(pp.spaceImages(xml)).toBe(xml)
      var out = pp.spaceImages(wrap(image + image))
      expect(body(out)).toBe(image + blank + image)
    })

    it('a caption is recognized by its style or a SEQ field, other text is not a caption', () => {
      var styled = `<w:p><w:pPr><w:pStyle w:val="Caption"/></w:pPr><w:r><w:t>Fig</w:t></w:r></w:p>`
      expect(body(pp.spaceImages(wrap(image + styled + text('after'))))).toBe(image + styled + blank + text('after'))
      var seq = `<w:p><w:r><w:instrText> SEQ Figure \\* ARABIC </w:instrText></w:r><w:r><w:t>1</w:t></w:r></w:p>`
      expect(body(pp.spaceImages(wrap(image + seq + text('after'))))).toBe(image + seq + blank + text('after'))
      expect(body(pp.spaceImages(wrap(image + text('not centered'))))).toBe(image + blank + text('not centered'))
    })

    it('works inside table cells and ignores text with an inline picture', () => {
      var cell = (c) => `<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="100" w:type="dxa"/></w:tcPr>${c}</w:tc></w:tr></w:tbl>`
      expect(body(pp.spaceImages(wrap(cell(text('a') + image))))).toBe(cell(text('a') + blank + image))
      var inline = `<w:p><w:r><w:t>icon</w:t></w:r><w:r><w:drawing><wp:inline ${P}/></w:drawing></w:r></w:p>`
      var xml = wrap(text('a') + inline + text('b'))
      expect(pp.spaceImages(xml)).toBe(xml)
    })

    it('processZip applies it to the document when enabled only', () => {
      var PizZip = require('pizzip')
      var xml = wrap(text('before') + image)
      var zip = new PizZip(); zip.file('word/document.xml', xml)
      pp.processZip(zip, {imageSpacing: false})
      expect(zip.files['word/document.xml'].asText()).toBe(xml)
      pp.processZip(zip, {imageSpacing: true})
      expect(body(zip.files['word/document.xml'].asText())).toBe(text('before') + blank + image)
    })
  })
}
