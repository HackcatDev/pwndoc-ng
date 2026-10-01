/*
 * List fields in the report: cleanLines and the convertLines filter
 * (lib/report-generator.js), with the models stubbed (no database).
 */
module.exports = function () {
  describe('Report list fields', () => {
    var gen, expressions
    beforeAll(() => {
      jest.isolateModules(() => {
        var mongoose = require("mongoose")
        var realModel = mongoose.model
        mongoose.model = (name) => ({Image: {}, Settings: {}})[name] || realModel.call(mongoose, name)
        try {
          gen = require("../src/lib/report-generator")
          expressions = require("angular-expressions")
        } finally {
          mongoose.model = realModel
        }
      })
    })

    it('cleanLines trims and drops empty lines', () => {
      expect(gen.cleanLines(['', ' https://a ', '\t', 'b', ''])).toEqual(['https://a', 'b'])
      expect(gen.cleanLines('a\r\n\r\nb\n')).toEqual(['a', 'b'])
      expect(gen.cleanLines(undefined)).toEqual([])
      expect(gen.cleanLines([null, 'x'])).toEqual(['x'])
    })

    it('convertLines: one paragraph per line, no blank line, escaped', () => {
      var ooxml = expressions.filters.convertLines(['', 'https://owasp.org', 'A <b> & C', ''])
      var paragraphs = ooxml.match(/<w:p>|<w:p /g) || []
      expect(paragraphs.length).toBe(2)
      expect(ooxml).not.toContain('<w:br/>')
      expect(ooxml).toContain('https://owasp.org')
      expect(ooxml).toContain('A &lt;b&gt; &amp; C')
      expect(expressions.filters.convertLines([])).toBe('')
      expect(expressions.filters.convertLines(['', ' '])).toBe('')
    })
  })
}
