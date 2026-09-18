module.exports = function () {
  var PizZip = require('pizzip')
  var numbering = require('../src/lib/numbering')

  function makeZip(withNumbering) {
    var zip = new PizZip()
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    zip.file('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
    if (withNumbering) {
      zip.file('word/numbering.xml', '<?xml version="1.0"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="3"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="3"/></w:num></w:numbering>')
    }
    return zip
  }

  describe('List numbering definitions', () => {
    it('adds definitions after the existing ones and allocates restarting ordered lists', () => {
      var zip = makeZip(true)
      var ctx = numbering.prepare(zip)
      expect(ctx.bulletAbstractId).toBe(4)
      expect(ctx.decimalAbstractId).toBe(5)
      expect(ctx.bulletNumId).toBe(8)
      var id1 = numbering.allocateOrderedList(zip, ctx)
      var id2 = numbering.allocateOrderedList(zip, ctx)
      expect([id1, id2]).toEqual([9, 10])
      var xml = zip.files['word/numbering.xml'].asText()
      // abstractNum definitions precede the <w:num> elements
      expect(xml.indexOf('<w:abstractNum w:abstractNumId="5">')).toBeLessThan(xml.indexOf('<w:num w:numId="7">'))
      expect(xml).toContain('<w:num w:numId="8"><w:abstractNumId w:val="4"/></w:num>')
      expect(xml).toContain('<w:num w:numId="10"><w:abstractNumId w:val="5"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>')
      expect((xml.match(/<w:lvl w:ilvl=/g) || []).length).toBe(1 + 18)
    })

    it('creates numbering.xml with its relationship and content type when missing', () => {
      var zip = makeZip(false)
      var ctx = numbering.prepare(zip)
      expect(ctx.bulletNumId).toBe(1)
      expect(zip.files['word/numbering.xml']).toBeDefined()
      expect(zip.files['word/_rels/document.xml.rels'].asText()).toContain('Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"')
      expect(zip.files['[Content_Types].xml'].asText()).toContain('PartName="/word/numbering.xml"')
    })
  })
}
