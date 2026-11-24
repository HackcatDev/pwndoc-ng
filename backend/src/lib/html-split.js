/*
 * Splits the HTML of a rich text field at its images.
 *
 * The templates render a field as a loop over its parts: the text before an
 * image ({@text | convertHTML}), then the image and its caption ({%image}).
 * Cutting the HTML string at the <img> tags left the elements open around the
 * image unbalanced: the text after an image inside a list item started with
 * "</p></li><li>..." without its <ol>, which rendered the next items as
 * bullets and restarted the numbering.
 *
 * split() closes the elements open at an image at the end of the part before
 * it and opens them again at the start of the part after it:
 *  - an ordered list gets data-pwd-list="Ln" where it opens and
 *    data-pwd-resume="Ln" where it is opened again, so that html2ooxml
 *    continues its numbering instead of starting a new list;
 *  - a list item opened again (the item the image is in) gets
 *    data-pwd-continued="1": its text is aligned with the item text, without
 *    a new number or bullet;
 *  - every ordered list of the field gets data-pwd-field="Fn", so that a list
 *    continuing a previous one ("4." after a code block) is found across parts.
 *
 * Returns [{text: html} | {image: <img> tag}] in document order.
 */

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const TOKEN_REGEX = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>|[^<]+|</g

function createContext() {
    return { lists: 0, fields: 0 }
}

function addAttributes(tag, attrs) {
    return tag.replace(/\s*\/?>$/, (end) => attrs + end)
}

function split(html, context = createContext()) {
    const parts = []
    const stack = [] // {name, reopen}
    const field = 'F' + (++context.fields)
    let current = ''

    const flush = () => {
        if (current !== '') parts.push({ text: current })
        current = ''
    }

    let m
    TOKEN_REGEX.lastIndex = 0
    while ((m = TOKEN_REGEX.exec(String(html))) !== null) {
        const token = m[0]
        const name = m[1] ? m[1].toLowerCase() : null
        if (!name || token.startsWith('<!--')) { current += token; continue }

        if (token.startsWith('</')) {
            current += token
            const index = stack.map((e) => e.name).lastIndexOf(name)
            if (index !== -1) stack.splice(index)
            continue
        }

        if (name === 'img' && /\ssrc="/.test(token)) {
            for (let i = stack.length - 1; i >= 0; i--) current += `</${stack[i].name}>`
            flush()
            parts.push({ image: token })
            for (const entry of stack) current += entry.reopen
            continue
        }

        let open = token
        let reopen = token
        if (name === 'ol') {
            const id = 'L' + (++context.lists)
            open = addAttributes(token, ` data-pwd-list="${id}" data-pwd-field="${field}"`)
            reopen = `<ol data-pwd-resume="${id}" data-pwd-field="${field}">`
        } else if (name === 'li') {
            reopen = '<li data-pwd-continued="1">'
        }
        current += open
        if (!VOID_TAGS.has(name) && !/\/>$/.test(token)) stack.push({ name, reopen })
    }
    flush()
    return parts
}

// A part without any text, line or rule only holds tags (closed / reopened elements)
function isEmptyPart(html) {
    if (/<(hr|br|table)\b/i.test(html)) return false
    return html.replace(/<[^>]*>/g, '').replace(/&nbsp;| /g, ' ').trim() === ''
}

module.exports = { split, createContext, isEmptyPart }
