module.exports = function () {
  var markdown = require("../src/lib/markdown")

  describe('Markdown to editor HTML', () => {
    it('Empty values', () => {
      expect(markdown.toHtml("")).toEqual("")
      expect(markdown.toHtml(null)).toEqual("")
      expect(markdown.toHtml(undefined)).toEqual("")
      expect(markdown.toHtml("   \n  ")).toEqual("")
    })

    it('Inline marks and inline code', () => {
      expect(markdown.toHtml("A **bold** and *italic* value with `code`."))
        .toEqual("<p>A <strong>bold</strong> and <em>italic</em> value with <code>code</code>.</p>")
    })

    it('Code block keeps its language', () => {
      expect(markdown.toHtml("```bash\nid -u\n```"))
        .toEqual('<pre><code class="language-bash">id -u\n</code></pre>')
    })

    it('Single newlines become line breaks', () => {
      expect(markdown.toHtml("first\nsecond")).toEqual("<p>first<br/>second</p>")
    })

    it('List items and nested lists are wrapped in paragraphs (editor shape)', () => {
      expect(markdown.toHtml("- a\n  - b\n- c"))
        .toEqual("<ul>\n<li><p>a</p><ul>\n<li><p>b</p></li>\n</ul></li>\n<li><p>c</p></li>\n</ul>")
    })

    it('Ordered list keeps its start attribute', () => {
      expect(markdown.toHtml("3. third\n4. fourth"))
        .toEqual('<ol start="3">\n<li><p>third</p></li>\n<li><p>fourth</p></li>\n</ol>')
    })

    it('Table cells are wrapped in paragraphs', () => {
      expect(markdown.toHtml("| a | b |\n|---|---|\n| 1 | 2 |"))
        .toEqual("<table>\n<thead>\n<tr>\n<th><p>a</p></th>\n<th><p>b</p></th>\n</tr>\n</thead>\n<tbody><tr>\n<td><p>1</p></td>\n<td><p>2</p></td>\n</tr>\n</tbody></table>")
    })

    it('Blockquote content is wrapped in a paragraph', () => {
      expect(markdown.toHtml("> quoted")).toEqual("<blockquote><p>quoted</p></blockquote>")
    })

    it('Images keep the editor image id', () => {
      expect(markdown.toHtml("![caption](66037a1b2c3d4e5f60718293)"))
        .toEqual('<p><img src="66037a1b2c3d4e5f60718293" alt="caption"></p>')
    })

    it('Links are kept, unsafe schemes are not', () => {
      expect(markdown.toHtml("[x](https://example.com/a?b=1&c=2)"))
        .toEqual('<p><a href="https://example.com/a?b=1&amp;c=2">x</a></p>')
      expect(markdown.toHtml('<p><a href="javascript:evil()">x</a></p>')).toEqual("<p>x</p>")
    })

    it('Scripts, styles and event handlers are dropped', () => {
      expect(markdown.toHtml('<script>alert(1)</script><p onclick="evil()">text</p>')).toEqual("<p>text</p>")
      expect(markdown.toHtml('<style>p{}</style><p>text</p>')).toEqual("<p>text</p>")
      expect(markdown.toHtml('<p><img src="javascript:evil()" alt="a"></p>')).toEqual('<p><img alt="a"></p>')
    })

    it('Unknown elements are dropped but their content is kept', () => {
      expect(markdown.toHtml('<div><section>text</section></div>')).toEqual("<p>text</p>")
    })

    it('Editor elements without Markdown syntax survive as HTML', () => {
      expect(markdown.toHtml('<p><u>under</u> and <mark data-color="yellow">marked</mark></p>'))
        .toEqual('<p><u>under</u> and <mark data-color="yellow">marked</mark></p>')
    })
  })

  describe('Editor HTML to Markdown', () => {
    it('Empty values', () => {
      expect(markdown.toMarkdown("")).toEqual("")
      expect(markdown.toMarkdown(null)).toEqual("")
    })

    it('Paragraphs, marks and inline code', () => {
      expect(markdown.toMarkdown("<p>A <strong>bold</strong> value with <code>code</code>.</p>"))
        .toEqual("A **bold** value with `code`.")
    })

    it('Code block language comes from the code class', () => {
      expect(markdown.toMarkdown('<pre><code class="language-bash">id -u\n</code></pre>'))
        .toEqual("```bash\nid -u\n```")
    })

    it('Highlighting spans inside a code block are reduced to text', () => {
      expect(markdown.toMarkdown('<pre><code class="language-bash"><span class="hljs-built_in">echo</span> hi</code></pre>'))
        .toEqual("```bash\necho hi\n```")
    })

    it('List items in editor shape do not produce blank lines', () => {
      expect(markdown.toMarkdown("<ul><li><p>a</p><ul><li><p>b</p></li></ul></li><li><p>c</p></li></ul>"))
        .toEqual("- a\n  - b\n- c")
    })

    it('Ordered lists are numbered from the start attribute', () => {
      expect(markdown.toMarkdown('<ol start="3"><li><p>third</p></li><li><p>fourth</p></li></ol>'))
        .toEqual("3. third\n4. fourth")
    })

    it('Images keep the editor image id', () => {
      expect(markdown.toMarkdown('<p><img src="66037a1b2c3d4e5f60718293" class="custom-image" alt="caption"></p>'))
        .toEqual("![caption](66037a1b2c3d4e5f60718293)")
    })

    it('Marks with no Markdown syntax keep their text', () => {
      expect(markdown.toMarkdown('<p><u>under</u> and <mark data-color="yellow">marked</mark></p>'))
        .toEqual("under and marked")
    })

    it('Round trip of a realistic finding body is stable', () => {
      var source = [
        "The endpoint `/api/users` is vulnerable to **SQL injection**.",
        "",
        "## Steps",
        "",
        "1. Log in as a low privileged user",
        "2. Send the request below:",
        "",
        "```http",
        "GET /api/users?id=1' OR 1=1-- HTTP/1.1",
        "```",
        "",
        "- first item",
        "  - nested item",
        "- second with [a link](https://example.com/a?b=1)",
        "",
        "> Note: the database user is `root`.",
        "",
        "| Host | Port |",
        "| --- | --- |",
        "| a.example.com | 443 |",
        "",
        "![shot](66037a1b2c3d4e5f60718293)",
      ].join("\n")

      var html = markdown.toHtml(source)
      expect(markdown.toMarkdown(html)).toEqual(source)
      // and converting the Markdown back gives the same HTML
      expect(markdown.toHtml(markdown.toMarkdown(html))).toEqual(html)
    })

    it('Tables the editor produced are returned as HTML and accepted back unchanged', () => {
      var table = '<table><tbody><tr><td><p>a.example.com</p></td><td><p>443</p></td></tr></tbody></table>'
      expect(markdown.toMarkdown(table)).toEqual(table)
      expect(markdown.toHtml(table)).toEqual(table)
    })
  })

  describe('Markdown lines to array', () => {
    it('Accepts an array', () => {
      expect(markdown.toLines(["https://a", " https://b ", ""])).toEqual(["https://a", "https://b"])
    })

    it('Accepts a Markdown list or plain lines', () => {
      expect(markdown.toLines("- https://a\n* https://b\n1. https://c\n\nhttps://d"))
        .toEqual(["https://a", "https://b", "https://c", "https://d"])
    })

    it('Empty values', () => {
      expect(markdown.toLines(null)).toEqual([])
      expect(markdown.toLines("")).toEqual([])
    })
  })
}
