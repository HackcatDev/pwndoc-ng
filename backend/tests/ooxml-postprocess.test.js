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
}
