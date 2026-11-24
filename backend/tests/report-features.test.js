/*
 * Report features without database: plain text affected assets, list
 * continuation, headings / links / Legendary markers, chart data, template
 * styles, image attributes kept by the findings API.
 */
module.exports = function () {
  var PizZip = require('pizzip')
  var html2ooxml = require('../src/lib/html2ooxml')
  var plainText = require('../src/lib/plain-text')
  var markers = require('../src/lib/report-markers')
  var chartData = require('../src/lib/chart-data')
  var templateStyles = require('../src/lib/template-styles')
  var reportStyles = require('../src/lib/report-styles')
  var markdown = require('../src/lib/markdown')
  var pp = require('../src/lib/ooxml-postprocess')

  var W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
  var wrap = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W}><w:body>${body}</w:body></w:document>`
  var M = (type, arg) => markers.marker(type, arg)

  describe('Affected assets (plain text)', () => {
    it('converts the editor HTML of older findings into lines', () => {
      expect(plainText.toPlainText('<p><a href="https://a.test">https://a.test</a></p><p>10.0.0.1 &amp; b</p>')).toBe('https://a.test\n10.0.0.1 & b')
      expect(plainText.toPlainText('https://a.test\r\n\r\n10.0.0.1  ')).toBe('https://a.test\n\n10.0.0.1')
      expect(plainText.toPlainText(['a', 'b'])).toBe('a\nb')
      expect(plainText.toPlainText(null)).toBe('')
      expect(plainText.toPlainText('<not html> a')).toBe('<not html> a')
    })

    it('renders one escaped paragraph per line, never a link', () => {
      expect(plainText.textToHtml('https://a.test\n\n<b> & c')).toBe('<p>https://a.test</p><p>&lt;b&gt; &amp; c</p>')
      var ooxml = html2ooxml(plainText.textToHtml('https://a.test'))
      expect(ooxml).not.toContain('HYPERLINK')
      expect(ooxml).toContain('https://a.test')
    })
  })

  describe('Ordered lists', () => {
    var numIds = (ooxml) => (ooxml.match(/<w:numId w:val="(\d+)"\/>/g) || []).map((m) => m.match(/\d+/)[0])

    it('continues a list interrupted by a code block when it starts after the last item', () => {
      var starts = []
      var next = 10
      var ooxml = html2ooxml(
        '<ol><li><p>a</p></li><li><p>b</p></li><li><p>c</p></li></ol><pre><code>code</code></pre><ol start="4"><li><p>d</p></li><li><p>e</p></li></ol>',
        '', [], { allocateList: (start) => { starts.push(start); return next++ } })
      expect(numIds(ooxml)).toEqual(['10', '10', '10', '10', '10'])
      expect(starts).toEqual([1])
    })

    it('restarts a list starting at 1 and gives its own start to any other list', () => {
      var starts = []
      var next = 10
      var ooxml = html2ooxml(
        '<ol><li><p>a</p></li><li><p>b</p></li></ol><p>x</p><ol><li><p>c</p></li></ol><p>y</p><ol start="7"><li><p>d</p></li></ol>',
        '', [], { allocateList: (start) => { starts.push(start); return next++ } })
      expect(numIds(ooxml)).toEqual(['10', '10', '11', '12'])
      expect(starts).toEqual([1, 1, 7])
    })

    it('keeps a code block inside a list item at the left margin', () => {
      var ooxml = html2ooxml('<ol><li><p>a</p><pre><code>x</code></pre></li></ol>', '', [], { allocateList: () => 5 })
      var code = ooxml.substring(ooxml.lastIndexOf('<w:p>'))
      expect(code).toContain('>x<')
      expect(code).not.toContain('<w:ind')
    })

    it('numbering definitions honour the start number', () => {
      var numbering = require('../src/lib/numbering')
      var zip = new PizZip()
      zip.file('word/numbering.xml', `<w:numbering ${W}></w:numbering>`)
      zip.file('word/_rels/document.xml.rels', '<Relationships></Relationships>')
      zip.file('[Content_Types].xml', '<Types></Types>')
      var ctx = numbering.prepare(zip)
      var id = numbering.allocateOrderedList(zip, ctx, 4)
      expect(zip.files['word/numbering.xml'].asText()).toContain(`<w:num w:numId="${id}"><w:abstractNumId w:val="${ctx.decimalAbstractId}"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="4"/>`)
    })
  })

  describe('Headings, anchors and links', () => {
    it('turns {h2} into a heading with its bookmark and {link} into a hyperlink to it', () => {
      var a = markers.anchorName('IDX-001')
      expect(a).toBe('Finding_IDX_001')
      var xml = wrap(
        `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${M('L', a)}SQL injection${M('E')}</w:t></w:r></w:p>` +
        `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${M('H', '2:' + a)}SQL injection</w:t></w:r></w:p>`)
      var out = markers.processDocument(xml, { headings: { 2: { size: 14, color: '1F3864' } }, findingLink: { color: '0563C1', underline: true } })
      expect(out).toContain(`<w:hyperlink w:anchor="${a}" w:history="1"><w:r><w:rPr><w:b/><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">SQL injection</w:t></w:r></w:hyperlink>`)
      expect(out).toMatch(/<w:pStyle w:val="Heading2"\/>.*<w:outlineLvl w:val="1"\/>/)
      expect(out).toContain(`w:name="${a}"`)
      expect(out).toContain('<w:color w:val="1F3864"/><w:sz w:val="28"/>')
      expect(out).not.toContain('⁣')
    })

    it('leaves the text of a link without target, keeps text around the markers', () => {
      var xml = wrap(`<w:p><w:r><w:t xml:space="preserve">Before ${M('L', 'Finding_X')}title${M('E')} after</w:t></w:r></w:p>`)
      var out = markers.processDocument(xml, {})
      expect(out).not.toContain('w:hyperlink')
      expect(out.replace(/<[^>]+>/g, '')).toContain('Before title after')
    })

    it('strips markers from the other parts', () => {
      expect(markers.stripMarkers(`<w:t>${M('H', '1:')}x</w:t>`)).toBe('<w:t>x</w:t>')
    })
  })

  describe('Legendary', () => {
    it('paints the text of a flagged cell and the word Legendary in rainbow colors', () => {
      var xml = wrap(`<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="100" w:type="dxa"/></w:tcPr><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="2D0A4E"/>${markers.LEGENDARY_FLAG}</w:tcPr><w:p><w:r><w:t>9.8</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>Legendary</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`)
      var zip = new PizZip(); zip.file('word/document.xml', xml)
      pp.processZip(zip, { markers: { legendary: true, legendaryLabel: 'Legendary' } })
      var out = zip.files['word/document.xml'].asText()
      expect(out).not.toContain('pwd:legendary')
      expect(out).toContain('w:fill="2D0A4E"')
      expect((out.match(/<w:color w:val="[0-9A-F]{6}"\/>/g) || []).length).toBe(3 + 9)
      expect(markers.rainbow(3)).toEqual(['FF0000', '00FF60', 'BF00FF'])
    })
  })

  describe('Chart data', () => {
    var chart = '<c:chartSpace xmlns:c="c" xmlns:a="a" xmlns:r="r"><c:chart><c:title><a:t>{title}</a:t></c:title><c:ser>' +
      '<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$3</c:f><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>Critical</c:v></c:pt><c:pt idx="1"><c:v>High</c:v></c:pt></c:strCache></c:strRef></c:cat>' +
      '<c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>0</c:v></c:pt><c:pt idx="1"><c:v>0</c:v></c:pt></c:numCache></c:numRef></c:val>' +
      '</c:ser></c:chart><c:externalData r:id="rId3"/></c:chartSpace>'
    var workbook = () => {
      var x = new PizZip()
      x.file('xl/workbook.xml', '<workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>')
      x.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
      x.file('xl/sharedStrings.xml', `<sst><si><t>Critical</t></si><si><t>High</t></si><si><t>{findings | count:&apos;Critical&apos;}</t></si><si><t>{findings | count:'High'}</t></si></sst>`)
      x.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" s="1" t="s"><v>2</v></c></row><row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" t="s"><v>3</v></c></row></sheetData></worksheet>')
      return x.generate({ type: 'nodebuffer' })
    }

    it('evaluates the tags of the embedded workbook and rebuilds the cached values', () => {
      var zip = new PizZip()
      zip.file('word/charts/chart1.xml', chart)
      zip.file('word/charts/_rels/chart1.xml.rels', '<Relationships><Relationship Id="rId3" Type="package" Target="../embeddings/Book.xlsx"/></Relationships>')
      zip.file('word/embeddings/Book.xlsx', workbook(), { binary: true })
      var values = { "findings | count:'Critical'": 3, "findings | count:'High'": 1, title: 'Summary' }
      chartData.processCharts(zip, (expr) => values[expr])
      var out = zip.files['word/charts/chart1.xml'].asText()
      expect(out).toContain('<c:pt idx="0"><c:v>3</c:v></c:pt><c:pt idx="1"><c:v>1</c:v></c:pt>')
      expect(out).toContain('<c:pt idx="0"><c:v>Critical</c:v></c:pt>')
      expect(out).toContain('<a:t>Summary</a:t>')
      var sheet = new PizZip(zip.files['word/embeddings/Book.xlsx'].asNodeBuffer()).files['xl/worksheets/sheet1.xml'].asText()
      expect(sheet).toContain('<c r="B2" s="1"><v>3</v></c>')
      expect(sheet).toContain('<c r="B3"><v>1</v></c>')
    })

    it('removes the categories without value, with their point formatting and labels', () => {
      var xml = '<c:chartSpace><c:ser><c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Name</c:v></c:pt></c:strCache></c:strRef></c:tx>' +
        '<c:dPt><c:idx val="0"/><c:spPr>P0</c:spPr></c:dPt><c:dPt><c:idx val="1"/><c:spPr>P1</c:spPr></c:dPt><c:dPt><c:idx val="2"/><c:spPr>P2</c:spPr></c:dPt>' +
        '<c:dLbls><c:dLbl><c:idx val="1"/>L1</c:dLbl><c:dLbl><c:idx val="2"/>L2</c:dLbl><c:showVal val="0"/></c:dLbls>' +
        '<c:cat><c:strRef><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>Critical</c:v></c:pt><c:pt idx="1"><c:v>High</c:v></c:pt><c:pt idx="2"><c:v>Low</c:v></c:pt></c:strCache></c:strRef></c:cat>' +
        '<c:val><c:numRef><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>0</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt><c:pt idx="2"><c:v>1</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:chartSpace>'
      var out = chartData.dropEmptyCategories(xml)
      expect(out).toContain('<c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Name</c:v></c:pt></c:strCache>')
      expect(out).toContain('<c:ptCount val="2"/><c:pt idx="0"><c:v>High</c:v></c:pt><c:pt idx="1"><c:v>Low</c:v></c:pt>')
      expect(out).toContain('<c:ptCount val="2"/><c:pt idx="0"><c:v>2</c:v></c:pt><c:pt idx="1"><c:v>1</c:v></c:pt>')
      expect(out).toContain('<c:dPt><c:idx val="0"/><c:spPr>P1</c:spPr></c:dPt><c:dPt><c:idx val="1"/><c:spPr>P2</c:spPr></c:dPt>')
      expect(out).not.toContain('P0')
      expect(out).toContain('<c:dLbl><c:idx val="0"/>L1</c:dLbl><c:dLbl><c:idx val="1"/>L2</c:dLbl>')
      expect(chartData.processChartXml(xml, null, () => 0)).toBe(xml) // no tag: static chart untouched
    })

    it('mixed text stays text', () => {
      expect(chartData.evaluateText('Critical ({n})', () => 2)).toEqual({ value: 'Critical (2)', numeric: false })
      expect(chartData.evaluateText('no tag', () => 2)).toBe(null)
      expect(chartData.parseRange("'My sheet'!$B$2:$C$3")).toEqual({ sheet: 'My sheet', cells: ['B2', 'C2', 'B3', 'C3'] })
    })
  })

  describe('Template styles', () => {
    var stylesXml = `<w:styles ${W}><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
      `<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:pPr><w:spacing w:after="100"/></w:pPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:rFonts w:asciiTheme="majorHAnsi"/><w:sz w:val="28"/></w:rPr></w:style></w:styles>`

    it('gives the TOC styles the font of the text profile and creates the missing ones', () => {
      var zip = new PizZip(); zip.file('word/styles.xml', stylesXml)
      templateStyles.apply(zip, { profiles: { text: { font: 'Helvetica' } } })
      var out = zip.files['word/styles.xml'].asText()
      expect(out).toMatch(/w:styleId="TOC1"><w:name w:val="toc 1"\/><w:pPr><w:spacing w:after="100"\/><\/w:pPr><w:rPr><w:rFonts w:ascii="Helvetica"/)
      for (var level = 2; level <= 9; level++) expect(out).toContain(`w:styleId="TOC${level}"`)
      for (var h = 2; h <= 6; h++) expect(out).toMatch(new RegExp(`w:styleId="Heading${h}".*?<w:outlineLvl w:val="${h - 1}"/>`))
    })

    it('applies the heading formatting, replacing the theme font', () => {
      var zip = new PizZip(); zip.file('word/styles.xml', stylesXml)
      templateStyles.apply(zip, { headings: { 1: { font: 'Arial', size: 16, bold: true, spacingBefore: 12 } } })
      var out = zip.files['word/styles.xml'].asText()
      expect(out).toMatch(/w:styleId="Heading1">.*<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"\/><w:b\/><w:bCs\/><w:sz w:val="32"\/>/)
      expect(out).not.toContain('majorHAnsi')
      expect(out).toMatch(/w:styleId="Heading1">.*<w:spacing w:before="240"\/>/)
    })
  })

  describe('Report styles settings', () => {
    it('sanitizes the new sections', () => {
      var s = reportStyles.sanitize({
        toc: { font: 'Helvetica', size: '11', color: 'zz' },
        headings: { 2: { size: 14, bold: true }, 9: { size: 1 } },
        findingLink: { color: '#0563c1', underline: false },
        severityColors: { critical: '#000000', legendary: 'nope', other: '111111' },
        legendary: 1,
      })
      expect(s.toc).toEqual({ font: 'Helvetica', size: 11 })
      expect(s.headings).toEqual({ 2: { size: 14, bold: true } })
      expect(s.findingLink).toEqual({ color: '0563C1', underline: false })
      expect(s.severityColors).toEqual({ critical: '000000' })
      expect(s.legendary).toBe(true)
      expect(reportStyles.resolve().legendary).toBe(false)
    })
  })

  describe('Fields split at their images', () => {
    var htmlSplit = require('../src/lib/html-split')
    var numIds = (ooxml) => (ooxml.match(/<w:numId w:val="(\d+)"\/>/g) || []).map((m) => m.match(/\d+/)[0])
    var render = (html) => {
      var registry = {}
      var next = 20
      var opts = { listRegistry: registry, allocateList: () => next++ }
      return htmlSplit.split(html).filter((p) => p.text !== undefined && !htmlSplit.isEmptyPart(p.text)).map((p) => html2ooxml(p.text, '', [], opts))
    }

    it('closes and opens again the elements around an image', () => {
      var parts = htmlSplit.split('<ol><li><p>a</p><img src="x" alt="c"><p>b</p></li><li><p>c</p></li></ol>')
      expect(parts.map((p) => p.text || 'IMG')).toEqual([
        '<ol data-pwd-list="L1" data-pwd-field="F1"><li><p>a</p></li></ol>',
        'IMG',
        '<ol data-pwd-resume="L1" data-pwd-field="F1"><li data-pwd-continued="1"><p>b</p></li><li><p>c</p></li></ol>',
      ])
    })

    it('keeps one numbered list around an image, without bullet nor restart', () => {
      var out = render('<ol><li><p>one</p></li><li><p>two</p><img src="x" alt="c"><p>more about two</p></li><li><p>three</p></li></ol>')
      expect(out.length).toBe(2)
      expect(numIds(out[0])).toEqual(['20', '20'])
      expect(numIds(out[1])).toEqual(['20']) // "three" only, "more about two" has no number
      expect(out[1]).toMatch(/<w:ind w:left="720"\/>.*more about two/)
      expect(out.join('')).not.toContain('<w:numId w:val="1"/>') // never the bullet definition
    })

    it('continues a list started before an image ("4." after the image)', () => {
      var out = render('<ol><li><p>a</p></li><li><p>b</p></li><li><p>c</p></li></ol><img src="x" alt="c"><ol start="4"><li><p>d</p></li></ol><p>x</p><ol><li><p>new</p></li></ol>')
      expect(numIds(out[0])).toEqual(['20', '20', '20'])
      expect(numIds(out[1])).toEqual(['20', '21'])
    })

    it('drops the parts holding only tags', () => {
      expect(htmlSplit.isEmptyPart('<ol data-pwd-resume="L1"><li data-pwd-continued="1"></li></ol>')).toBe(true)
      expect(htmlSplit.isEmptyPart('<p>x</p>')).toBe(false)
    })
  })

  describe('Image borders in the pixels', () => {
    var imageBorder = require('../src/lib/image-border')
    var { PNG } = require('pngjs')
    var png = (w, h) => {
      var p = new PNG({ width: w, height: h })
      p.data.fill(255)
      return 'data:image/png;base64,' + PNG.sync.write(p).toString('base64')
    }

    it('draws the border around the image, scaled to its displayed width', () => {
      var out = imageBorder.withBorder(png(10, 5), { width: 2, color: 'FF0000' })
      var img = PNG.sync.read(Buffer.from(out.split(',')[1], 'base64'))
      expect([img.width, img.height]).toEqual([14, 9])
      expect(Array.from(img.data.slice(0, 4))).toEqual([255, 0, 0, 255])
      var center = ((4 * 14) + 7) * 4
      expect(Array.from(img.data.slice(center, center + 4))).toEqual([255, 255, 255, 255])
      var big = PNG.sync.read(Buffer.from(imageBorder.withBorder(png(1200, 10), { width: 2 }).split(',')[1], 'base64'))
      expect(big.width).toBe(1200 + 2 * 4) // 2px at 600px displayed = 4px of the image
    })

    it('leaves the formats it cannot decode', () => {
      expect(imageBorder.withBorder('data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=', { width: 2 })).toBe(null)
      expect(imageBorder.withBorder(png(2, 2), null)).toBe(null)
    })
  })

  describe('Legendary colors', () => {
    it('stay readable on the background of the cell', () => {
      var lum = (hex) => [0, 2, 4].map((i) => parseInt(hex.substr(i, 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0)
      var contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
      for (var bg of ['2D0A4E', 'FFFFFF', '000000', 'FFC000', '7030A0']) {
        for (var color of markers.rainbow(9, bg)) expect(contrast(color, bg)).toBeGreaterThanOrEqual(4.5)
      }
    })
  })

  describe('Identifiers of the findings', () => {
    it('follow the format of the template', () => {
      expect(reportStyles.formatIdentifier('F-{n}', 8)).toBe('F-8')
      expect(reportStyles.formatIdentifier('F-{n}', 12)).toBe('F-12')
      expect(reportStyles.formatIdentifier(undefined, 8)).toBe('IDX-008')
      expect(reportStyles.formatIdentifier('VULN-{n:2}', 3)).toBe('VULN-03')
      expect(reportStyles.sanitize({ identifierFormat: 'no number', findingsOrder: 'random' })).toEqual({})
      expect(reportStyles.resolve().findingsOrder).toBe('score')
    })
  })

  describe('Images of the findings API', () => {
    it('removes the trailing dot of a new caption once', () => {
      var html = markdown.prepareImages(markdown.toHtml('![Login page.](0123456789abcdef01234567)'))
      expect(html).toContain('alt="Login page" data-caption-trimmed="true"')
      expect(markdown.trimCaption('Wait...')).toBe('Wait...')
    })

    it('sets the flag only when a dot was removed', () => {
      expect(markdown.prepareImages('<img src="a" alt="No dot">')).toBe('<img src="a" alt="No dot">')
    })

    it('keeps the caption and the border of an image already in the field', () => {
      var previous = '<p><img src="0123456789abcdef01234567" alt="Login page" data-border-width="2" data-border-color="FF0000" data-caption-trimmed="true"></p>'
      var html = markdown.prepareImages(markdown.toHtml('![Login page.](0123456789abcdef01234567)'), previous)
      expect(html).toContain('alt="Login page."')
      expect(html).toContain('data-border-width="2"')
      expect(html).toContain('data-border-color="FF0000"')
    })
  })
}
