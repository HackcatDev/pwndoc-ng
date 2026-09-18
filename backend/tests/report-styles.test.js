module.exports = function () {
  var reportStyles = require("../src/lib/report-styles")

  describe('Report styles configuration', () => {
    it('sanitize drops unknown keys and invalid values', () => {
      var out = reportStyles.sanitize({
        profiles: { text: { font: "Helvetica", size: "12", color: "#zzzzzz", bogus: 1 }, "bad name!": { font: "X" } },
        inlineCode: { size: 500, shading: "#f2f2f2" },
        codeBlock: { lineSpacing: 1.15 },
        link: { underline: "yes" },
        highlightSyntax: 1,
        other: {}
      })
      expect(out).toEqual({
        profiles: { text: { font: "Helvetica", size: 12 } },
        inlineCode: { shading: "F2F2F2" },
        codeBlock: { lineSpacing: 1.15 },
        link: { underline: true },
        highlightSyntax: true
      })
    })

    it('resolve overlays template styles over defaults and empty values keep the base', () => {
      var base = reportStyles.resolve()
      var out = reportStyles.resolve({ profiles: { text: { size: 9, font: "" } }, codeBlock: { font: null } })
      expect(out.profiles.text.size).toEqual(9)
      expect(out.profiles.text.font).toEqual(base.profiles.text.font)
      expect(out.codeBlock.font).toEqual(base.codeBlock.font)
      expect(out.profiles.caption.alignment).toEqual("center")
    })
  })
}
