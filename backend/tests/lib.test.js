module.exports = function () {
  var html2ooxml = require("../src/lib/html2ooxml")
  var utils = require("../src/lib/utils")

  describe('Lib functions Suite Tests', () => {

    describe('Name format validation tests', () => {
      it('Valid Filename', () => {
        var filename = "Vulnerability 1"
        var result = utils.validFilename(filename)
        expect(result).toEqual(true)
      })

      it('Valid Latin Filename', () => {
        var filename = "Vulnerabilité 1"
        var result = utils.validFilename(filename)
        expect(result).toEqual(true)
      })

      it('Valid Latvian Filename', () => {
        var filename = "Pažeidžiamumas 1"
        var result = utils.validFilename(filename)
        expect(result).toEqual(true)
      })

      it('Valid Filename with special chars', () => {
        var filename = "Vulnerability_1-test"
        var result = utils.validFilename(filename)
        expect(result).toEqual(true)
      })

      it('Invalid Filename', () => {
        var filename = "<Vulnerability> 1"
        var result = utils.validFilename(filename)
        expect(result).toEqual(false)
      })
    })

    describe('html2ooxml tests', () => {
      it('Simple Paragraph', () => {
        var html = "<p>Paragraph Text</p>"
        var expected = `<w:p><w:r><w:t xml:space="preserve">Paragraph Text</w:t></w:r></w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Text without tag', () => {
        var html = "Paragraph Text"
        var expected = `<w:p><w:r><w:t xml:space="preserve">Paragraph Text</w:t></w:r></w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Bold without wrapping paragraph', () => {
        var html = "<b>Paragraph Bold</b>"
        var expected = "<w:p><w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space=\"preserve\">Paragraph Bold</w:t></w:r></w:p>"
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Bold', () => {
        var html = "<p>Paragraph <b>Bold</b></p>"
        var expected =
        `<w:p>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Paragraph </w:t>`+
          `</w:r>`+
          `<w:r>`+
            `<w:rPr>`+
              `<w:b/>`+
              `<w:bCs/>`+
            `</w:rPr>`+
            `<w:t xml:space="preserve">Bold</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Italic', () => {
        var html = "<p>Paragraph <i>Italic</i></p>"
        var expected =
        `<w:p>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Paragraph </w:t>`+
          `</w:r>`+
          `<w:r>`+
            `<w:rPr>`+
              `<w:i/>`+
              `<w:iCs/>`+
            `</w:rPr>`+
            `<w:t xml:space="preserve">Italic</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Underline', () => {
        var html = "<p>Paragraph <u>Underline</u></p>"
        var expected =
        `<w:p>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Paragraph </w:t>`+
          `</w:r>`+
          `<w:r>`+
            `<w:rPr>`+
              `<w:u w:val="single"/>`+
            `</w:rPr>`+
            `<w:t xml:space="preserve">Underline</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Strike', () => {
        var html = "<p>Paragraph <s>Strike</s></p>"
        var expected =
        `<w:p>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Paragraph </w:t>`+
          `</w:r>`+
          `<w:r>`+
            `<w:rPr>`+
              `<w:strike/>`+
            `</w:rPr>`+
            `<w:t xml:space="preserve">Strike</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Bold and Italics', () => {
        var html = "<p>Paragraph <b><i>Mark</i></b></p>"
        var expected =
        `<w:p>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Paragraph </w:t>`+
          `</w:r>`+
          `<w:r>`+
            `<w:rPr>`+
              `<w:b/>`+
              `<w:bCs/>`+
              `<w:i/>`+
              `<w:iCs/>`+
            `</w:rPr>`+
            `<w:t xml:space="preserve">Mark</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('All marks', () => {
        var html = "<p>Paragraph <b><i><u><s>Mark</s></u></i></b></p>"
        var expected =
        `<w:p>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Paragraph </w:t>`+
          `</w:r>`+
          `<w:r>`+
            `<w:rPr>`+
              `<w:b/>`+
              `<w:bCs/>`+
              `<w:i/>`+
              `<w:iCs/>`+
              `<w:strike/>`+
              `<w:u w:val="single"/>`+
            `</w:rPr>`+
            `<w:t xml:space="preserve">Mark</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Heading 1', () => {
        var html = "<h1>Heading</h1>"
        var expected =
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="Heading1"/>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Heading</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Heading 2', () => {
        var html = "<h2>Heading</h2>"
        var expected =
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="Heading2"/>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Heading</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Heading 3', () => {
        var html = "<h3>Heading</h3>"
        var expected =
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="Heading3"/>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Heading</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Heading 4', () => {
        var html = "<h4>Heading</h4>"
        var expected =
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="Heading4"/>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Heading</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Heading 5', () => {
        var html = "<h5>Heading</h5>"
        var expected =
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="Heading5"/>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Heading</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Heading 6', () => {
        var html = "<h6>Heading</h6>"
        var expected =
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="Heading6"/>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Heading</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Simple Bullets', () => {
        var html = 
        `<ul>`+
          `<li>`+
            `<p>Bullet1</p>`+
          `</li>`+
          `<li>`+
            `<p>Bullet2</p>`+
          `</li>`+
        `</ul>`
        var expected =
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="ListParagraph"/>`+
            `<w:numPr>`+
              `<w:ilvl w:val="0"/>`+
              `<w:numId w:val="1"/>`+
            `</w:numPr>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Bullet1</w:t>`+
          `</w:r>`+
        `</w:p>`+
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="ListParagraph"/>`+
            `<w:numPr>`+
              `<w:ilvl w:val="0"/>`+
              `<w:numId w:val="1"/>`+
            `</w:numPr>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Bullet2</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Simple Bullets without ul tag', () => {
        var html = 
        `<li>`+
          `<p>Bullet1</p>`+
        `</li>`+
        `<li>`+
          `<p>Bullet2</p>`+
        `</li>`
        var expected =
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="ListParagraph"/>`+
            `<w:numPr>`+
              `<w:ilvl w:val="0"/>`+
              `<w:numId w:val="1"/>`+
            `</w:numPr>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Bullet1</w:t>`+
          `</w:r>`+
        `</w:p>`+
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="ListParagraph"/>`+
            `<w:numPr>`+
              `<w:ilvl w:val="0"/>`+
              `<w:numId w:val="1"/>`+
            `</w:numPr>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Bullet2</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Nested Bullets', () => {
        var html =
        `<ul>`+
          `<li>`+
            `<p>Bullet1</p>`+
          `</li>`+
          `<ul>`+
            `<li>`+
              `<p>BulletNested</p>`+
            `</li>`+
          `</ul>`+
          `<li>`+
            `<p>Bullet2</p>`+
          `</li>`+
        `</ul>`
        var expected = 
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="ListParagraph"/>`+
            `<w:numPr>`+
              `<w:ilvl w:val="0"/>`+
              `<w:numId w:val="1"/>`+
            `</w:numPr>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Bullet1</w:t>`+
          `</w:r>`+
        `</w:p>`+
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="ListParagraph"/>`+
            `<w:numPr>`+
              `<w:ilvl w:val="1"/>`+
              `<w:numId w:val="1"/>`+
            `</w:numPr>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">BulletNested</w:t>`+
          `</w:r>`+
        `</w:p>`+
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="ListParagraph"/>`+
            `<w:numPr>`+
              `<w:ilvl w:val="0"/>`+
              `<w:numId w:val="1"/>`+
            `</w:numPr>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Bullet2</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Simple Numbering', () => {
        var html =
        `<ol>`+
          `<li>`+
            `<p>Number1</p>`+
          `</li>`+
          `<li>`+
            `<p>Number2</p>`+
          `</li>`+
        `</ol>`
        var expected =
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="ListParagraph"/>`+
            `<w:numPr>`+
              `<w:ilvl w:val="0"/>`+
              `<w:numId w:val="2"/>`+
            `</w:numPr>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Number1</w:t>`+
          `</w:r>`+
        `</w:p>`+
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="ListParagraph"/>`+
            `<w:numPr>`+
              `<w:ilvl w:val="0"/>`+
              `<w:numId w:val="2"/>`+
            `</w:numPr>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Number2</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Nested Numbering', () => {
        var html =
        `<ol>`+
          `<li>`+
            `<p>Number1</p>`+
          `</li>`+
          `<ol>`+
            `<li>`+
              `<p>NumberNested</p>`+
            `</li>`+
          `</ol>`+
          `<li>`+
            `<p>Number2</p>`+
          `</li>`+
        `</ol>`
        var expected =
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="ListParagraph"/>`+
            `<w:numPr>`+
              `<w:ilvl w:val="0"/>`+
              `<w:numId w:val="2"/>`+
            `</w:numPr>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Number1</w:t>`+
          `</w:r>`+
        `</w:p>`+
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="ListParagraph"/>`+
            `<w:numPr>`+
              `<w:ilvl w:val="1"/>`+
              `<w:numId w:val="2"/>`+
            `</w:numPr>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">NumberNested</w:t>`+
          `</w:r>`+
        `</w:p>`+
        `<w:p>`+
          `<w:pPr>`+
            `<w:pStyle w:val="ListParagraph"/>`+
            `<w:numPr>`+
              `<w:ilvl w:val="0"/>`+
              `<w:numId w:val="2"/>`+
            `</w:numPr>`+
          `</w:pPr>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Number2</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Break', () => {
        var html = "<p>Paragraph<br>Break</p>"
        var expected =
        `<w:p>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Paragraph</w:t>`+
          `</w:r>`+
          `<w:r>`+
            `<w:br/>`+
          `</w:r>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Break</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Break with newline', () => {
        var html = "<p>Paragraph\nBreak</p>"
        var expected =
        `<w:p>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Paragraph</w:t>`+
          `</w:r>`+
          `<w:r>`+
            `<w:br/>`+
          `</w:r>`+
          `<w:r>`+
            `<w:t xml:space="preserve">Break</w:t>`+
          `</w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Code', () => {
        var html = "<p>Paragraph <code>Code</code> Paragraph</p>"
        var expected =
        `<w:p><w:r><w:t xml:space=\"preserve\">Paragraph </w:t></w:r><w:r><w:rPr><w:rStyle w:val=\"CodeChar\"/></w:rPr><w:t xml:space=\"preserve\">Code</w:t></w:r><w:r><w:t xml:space=\"preserve\"> Paragraph</w:t></w:r></w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('CodeBlock', () => {
        var html = "<pre><code>Code Block</code></pre>"
        var expected =
        `<w:p><w:pPr><w:pStyle w:val=\"Code\"/></w:pPr><w:r><w:t xml:space=\"preserve\">Code Block</w:t></w:r></w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('CodeBlock with highlight spans and newlines (editor format)', () => {
        var html = `<pre><code class="language-bash"><span class="hljs-built_in">echo</span> <span class="hljs-string">"hi"</span>\nline2</code></pre>`
        var expected =
        `<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr>`+
          `<w:r><w:t xml:space="preserve">echo &quot;hi&quot;</w:t></w:r>`+
          `<w:r><w:br/></w:r>`+
          `<w:r><w:t xml:space="preserve">line2</w:t></w:r>`+
        `</w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Code style does not leak after a code block', () => {
        var html = "<pre><code>Block</code></pre><p>After <code>inline</code> text</p>"
        var expected =
        `<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr><w:r><w:t xml:space="preserve">Block</w:t></w:r></w:p>`+
        `<w:p><w:r><w:t xml:space="preserve">After </w:t></w:r>`+
          `<w:r><w:rPr><w:rStyle w:val="CodeChar"/></w:rPr><w:t xml:space="preserve">inline</w:t></w:r>`+
          `<w:r><w:t xml:space="preserve"> text</w:t></w:r></w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Nested Bullets (editor format: sublist inside li)', () => {
        var html = `<ul><li><p>Bullet1</p><ul><li><p>BulletNested</p></li></ul></li><li><p>Bullet2</p></li></ul>`
        var expected =
        `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">Bullet1</w:t></w:r></w:p>`+
        `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">BulletNested</w:t></w:r></w:p>`+
        `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">Bullet2</w:t></w:r></w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Numbering with provided list ids', () => {
        var html = `<ol><li><p>A</p></li></ol><ol><li><p>B</p></li></ol>`
        var ooxml = html2ooxml(html, "", [10, 11])
        expect(ooxml).toContain('<w:numId w:val="10"/>')
        expect(ooxml).toContain('<w:numId w:val="11"/>')
      })

      it('Highlight mark', () => {
        var html = `<p>A <mark data-color="#ffff00" style="background-color: #ffff00; color: inherit">B</mark></p>`
        var expected =
        `<w:p><w:r><w:t xml:space="preserve">A </w:t></w:r>`+
        `<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t xml:space="preserve">B</w:t></w:r></w:p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toEqual(expected)
      })

      it('Hyperlink', () => {
        var html = `<p>See <a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com/?a=1&amp;b=2">docs</a></p>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toContain(`<w:instrText xml:space="preserve"> HYPERLINK "https://example.com/?a=1&amp;b=2" </w:instrText>`)
        expect(ooxml).toContain(`<w:r><w:rPr><w:rStyle w:val="PwndocLink"/></w:rPr><w:t xml:space="preserve">docs</w:t></w:r>`)
        expect(ooxml).toContain(`<w:fldChar w:fldCharType="end"/>`)
      })

      it('Table (editor format) with colspan and rowspan', () => {
        var html =
        `<table style="min-width: 75px"><colgroup><col><col><col></colgroup><tbody>`+
        `<tr><th colspan="1" rowspan="1"><p>H1</p></th><th colspan="2" rowspan="1"><p>H2</p></th></tr>`+
        `<tr><td colspan="1" rowspan="2"><p>c1</p></td><td colspan="1" rowspan="1"><p>c2</p></td><td colspan="1" rowspan="1"><p>c3</p></td></tr>`+
        `<tr><td colspan="1" rowspan="1"><p>c4</p></td><td colspan="1" rowspan="1"><p>c5</p></td></tr>`+
        `</tbody></table>`
        var ooxml = html2ooxml(html)
        expect(ooxml.startsWith('<w:tbl>')).toBe(true)
        expect(ooxml).toContain('<w:tblGrid><w:gridCol w:w="3213"/><w:gridCol w:w="3213"/><w:gridCol w:w="3213"/></w:tblGrid>')
        expect(ooxml).toContain('<w:tr><w:trPr><w:tblHeader/></w:trPr>')
        expect(ooxml).toContain('<w:gridSpan w:val="2"/>')
        expect(ooxml).toContain('<w:vMerge w:val="restart"/>')
        expect(ooxml).toContain('<w:tcPr><w:tcW w:w="1667" w:type="pct"/><w:vMerge/></w:tcPr>')
        expect((ooxml.match(/<w:tr>/g) || []).length).toEqual(3)
        expect((ooxml.match(/<w:tc>/g) || []).length).toEqual(8)
        // header cells are bold
        expect(ooxml).toContain('<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">H1</w:t></w:r>')
      })

      it('Formatting profiles from configuration', () => {
        var styles = {
          profiles: {
            text: { font: "Helvetica", size: 12 },
            remediation: { font: "Arial", size: 11, color: "#333333" },
          },
          inlineCode: { font: "Consolas", size: 12, shading: "F2F2F2" },
          codeBlock: { font: "Consolas", size: 10, shading: "D9D9D9", spacingAfter: 6 },
          link: { color: "0563C1", underline: true },
        }
        var html = `<p>Text <code>c</code></p><pre><code>block</code></pre>`
        var ooxml = html2ooxml(html, "", [], { styles })
        expect(ooxml).toContain(
          `<w:p><w:pPr><w:rPr><w:rFonts w:ascii="Helvetica" w:hAnsi="Helvetica" w:eastAsia="Helvetica" w:cs="Helvetica"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:pPr>`+
          `<w:r><w:rPr><w:rFonts w:ascii="Helvetica" w:hAnsi="Helvetica" w:eastAsia="Helvetica" w:cs="Helvetica"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t xml:space="preserve">Text </w:t></w:r>`)
        expect(ooxml).toContain(
          `<w:r><w:rPr><w:rStyle w:val="CodeChar"/><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Consolas" w:cs="Consolas"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/></w:rPr><w:t xml:space="preserve">c</w:t></w:r>`)
        expect(ooxml).toContain(
          `<w:p><w:pPr><w:pStyle w:val="Code"/><w:shd w:val="clear" w:color="auto" w:fill="D9D9D9"/><w:spacing w:after="120"/>`)
        expect(ooxml).toContain(`<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Consolas" w:cs="Consolas"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">block</w:t>`)

        // named profile
        var ooxml2 = html2ooxml(`<p>R</p>`, "remediation", [], { styles })
        expect(ooxml2).toContain(`<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:color w:val="333333"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">R</w:t>`)

        // unknown profile name falls back to a Word paragraph style (legacy behaviour)
        var ooxml3 = html2ooxml(`<p>S</p>`, "MyStyle", [], { styles })
        expect(ooxml3).toContain(`<w:pStyle w:val="MyStyle"/>`)
      })

      it('Unsupported elements do not break the output', () => {
        var html = `<p>A</p><img class="custom-image" src="abc" alt="x"><blockquote><p>Q</p></blockquote><hr><figure><img src="a" alt="b"><figcaption>Cap</figcaption></figure>`
        var ooxml = html2ooxml(html)
        expect(ooxml).toContain(`<w:p><w:r><w:t xml:space="preserve">A</w:t></w:r></w:p>`)
        expect(ooxml).toContain(`<w:p><w:pPr><w:ind w:left="720"/></w:pPr><w:r><w:t xml:space="preserve">Q</w:t></w:r></w:p>`)
        expect(ooxml).toContain(`<w:pBdr>`)
        expect(ooxml).toContain(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">Cap</w:t></w:r></w:p>`)
        expect(ooxml).not.toContain('null')
        expect(ooxml).not.toContain('undefined')
      })

      it('Empty input', () => {
        expect(html2ooxml("")).toEqual("")
        expect(html2ooxml("<p></p>")).toEqual("<w:p></w:p>")
      })

    })
  })
}