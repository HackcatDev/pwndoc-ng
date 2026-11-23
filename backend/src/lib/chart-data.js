/*
 * Data of the native charts of a template, computed when the report is
 * generated.
 *
 * A chart drawn in Word (word/charts/chartN.xml) keeps its data in an embedded
 * workbook and a copy of the values in the chart part (the cache), which is
 * what Word, LibreOffice and Google Docs display. docxtemplater only renders
 * the document text, so a chart whose workbook holds tags such as
 * {findings | count:'Critical'} used to show the values typed in the template
 * (a placeholder) until someone edited the data in Word, which Google Docs
 * cannot do.
 *
 * processCharts() evaluates the tags of the workbook cells (and of the cached
 * values and titles of the chart part, for charts without workbook) with the
 * report data, writes the results in the workbook (numbers as numbers), then
 * rebuilds the cached values of every series from the cells their formulas
 * point to.
 *
 *   Workbook cell:  {findings | count:'Critical'}       -> 3
 *   Mixed text:     Critical ({findings | count:'Critical'})  -> Critical (3)
 */

const PizZip = require('pizzip')

const TAG_REGEX = /\{([^{}]+)\}/g

function unescapeXml(text) {
    return String(text)
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&amp;/g, '&')
}

function escapeXml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function isNumeric(value) {
    if (typeof value === 'number') return isFinite(value)
    return typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value)
}

/*
 * Evaluates the tags of a text. Returns null when the text has no tag,
 * {value, numeric} otherwise; a text made of a single tag returning a number
 * stays a number.
 */
function evaluateText(text, evaluateTag) {
    if (typeof text !== 'string' || text.indexOf('{') === -1) return null
    const single = /^\s*\{([^{}]+)\}\s*$/.exec(text)
    if (single) {
        const value = safeEvaluate(single[1], evaluateTag)
        if (isNumeric(value)) return { value: Number(value), numeric: true }
        return { value: value === undefined || value === null ? '' : String(value), numeric: false }
    }
    let found = false
    const value = text.replace(TAG_REGEX, (m, expr) => {
        found = true
        const v = safeEvaluate(expr, evaluateTag)
        return v === undefined || v === null ? '' : String(v)
    })
    return found ? { value, numeric: false } : null
}

function safeEvaluate(expr, evaluateTag) {
    try {
        return evaluateTag(expr.replace(/(’|‘)/g, "'").replace(/(“|”)/g, '"').trim())
    } catch (err) {
        console.log(`chart-data: cannot evaluate {${expr}}: ${err.message || err}`)
        return ''
    }
}

/*
 * *** Embedded workbook ***
 */

function sharedStrings(xlsx) {
    const file = xlsx.files['xl/sharedStrings.xml']
    if (!file) return []
    const xml = file.asText()
    const out = []
    const re = /<si>([\s\S]*?)<\/si>/g
    let m
    while ((m = re.exec(xml)) !== null) {
        let text = ''
        const t = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g
        let n
        while ((n = t.exec(m[1])) !== null) text += unescapeXml(n[1])
        out.push(text)
    }
    return out
}

function resolvePath(base, target) {
    if (target.startsWith('/')) return target.substring(1)
    const parts = base.split('/')
    parts.pop()
    for (const piece of target.split('/')) {
        if (piece === '..') parts.pop()
        else if (piece !== '.') parts.push(piece)
    }
    return parts.join('/')
}

// {sheetName: path} of a workbook
function sheetPaths(xlsx) {
    const workbook = xlsx.files['xl/workbook.xml'] ? xlsx.files['xl/workbook.xml'].asText() : ''
    const rels = xlsx.files['xl/_rels/workbook.xml.rels'] ? xlsx.files['xl/_rels/workbook.xml.rels'].asText() : ''
    const targets = {}
    const relRe = /<Relationship\b([^>]*)\/?>/g
    let m
    while ((m = relRe.exec(rels)) !== null) {
        const id = /\bId="([^"]+)"/.exec(m[1])
        const target = /\bTarget="([^"]+)"/.exec(m[1])
        if (id && target) targets[id[1]] = resolvePath('xl/workbook.xml', target[1])
    }
    const sheets = {}
    const sheetRe = /<sheet\b([^>]*)\/?>/g
    while ((m = sheetRe.exec(workbook)) !== null) {
        const name = /\bname="([^"]*)"/.exec(m[1])
        const rid = /\br:id="([^"]+)"/.exec(m[1])
        if (name && rid && targets[rid[1]]) sheets[unescapeXml(name[1])] = targets[rid[1]]
    }
    return sheets
}

function cellAttrs(attrs) {
    const out = {}
    const re = /([\w:]+)="([^"]*)"/g
    let m
    while ((m = re.exec(attrs)) !== null) out[m[1]] = m[2]
    return out
}

function attrsXml(attrs) {
    return Object.keys(attrs).map((k) => ` ${k}="${attrs[k]}"`).join('')
}

/*
 * Evaluates the tags of a worksheet. Returns {xml, values, changed}: values
 * maps a cell reference (B2) to its value (number or string).
 */
function processSheet(xml, strings, evaluateTag) {
    const values = {}
    let changed = false
    const out = xml.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (whole, rawAttrs, inner) => {
        const attrs = cellAttrs(rawAttrs)
        const ref = attrs.r
        if (!ref) return whole
        let current = null
        inner = inner || ''
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)
        if (attrs.t === 's' && v) current = strings[parseInt(v[1], 10)]
        else if (attrs.t === 'inlineStr') {
            current = ''
            const t = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g
            let n
            while ((n = t.exec(inner)) !== null) current += unescapeXml(n[1])
        } else if (attrs.t === 'str' && v) current = unescapeXml(v[1])
        else if (v) current = isNumeric(v[1]) ? Number(v[1]) : unescapeXml(v[1])

        const result = typeof current === 'string' ? evaluateText(current, evaluateTag) : null
        if (!result) {
            if (current !== null) values[ref] = current
            return whole
        }
        changed = true
        values[ref] = result.value
        const kept = Object.assign({}, attrs)
        delete kept.t
        if (result.numeric) return `<c${attrsXml(kept)}><v>${result.value}</v></c>`
        kept.t = 'inlineStr'
        return `<c${attrsXml(kept)}><is><t xml:space="preserve">${escapeXml(result.value)}</t></is></c>`
    })
    return { xml: out, values, changed }
}

// Evaluates an embedded workbook; returns {buffer (null if unchanged), sheets: {name: values}}
function processWorkbook(buffer, evaluateTag) {
    const xlsx = new PizZip(buffer)
    const strings = sharedStrings(xlsx)
    const sheets = {}
    let changed = false
    const paths = sheetPaths(xlsx)
    for (const name of Object.keys(paths)) {
        const file = xlsx.files[paths[name]]
        if (!file) continue
        const result = processSheet(file.asText(), strings, evaluateTag)
        sheets[name] = result.values
        if (result.changed) {
            xlsx.file(paths[name], result.xml)
            changed = true
        }
    }
    if (changed) {
        // values computed by formulas are recalculated when the workbook is opened
        if (xlsx.files['xl/calcChain.xml']) xlsx.remove('xl/calcChain.xml')
    }
    return { buffer: changed ? xlsx.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) : null, sheets }
}

/*
 * *** Chart part ***
 */

function columnIndex(letters) {
    let n = 0
    for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64)
    return n
}

function columnLetters(index) {
    let s = ''
    while (index > 0) {
        const r = (index - 1) % 26
        s = String.fromCharCode(65 + r) + s
        index = Math.floor((index - 1) / 26)
    }
    return s
}

// "Sheet1!$B$2:$B$5" -> {sheet, cells: ['B2', 'B3', ...]}
function parseRange(formula) {
    const m = /^(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(String(formula).trim())
    if (!m) return null
    const sheet = m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2]
    const c1 = columnIndex(m[3]); const r1 = parseInt(m[4], 10)
    const c2 = m[5] ? columnIndex(m[5]) : c1; const r2 = m[6] ? parseInt(m[6], 10) : r1
    const cells = []
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
        for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) cells.push(columnLetters(c) + r)
    }
    return { sheet, cells }
}

function rebuildCache(cacheXml, kind, values) {
    const format = /<c:formatCode>[\s\S]*?<\/c:formatCode>/.exec(cacheXml)
    let pts = ''
    values.forEach((value, idx) => {
        if (value === undefined || value === null || value === '') return
        if (kind === 'num') {
            if (!isNumeric(value)) return
            pts += `<c:pt idx="${idx}"><c:v>${Number(value)}</c:v></c:pt>`
        } else {
            pts += `<c:pt idx="${idx}"><c:v>${escapeXml(value)}</c:v></c:pt>`
        }
    })
    const tag = kind === 'num' ? 'c:numCache' : 'c:strCache'
    return `<${tag}>${format && kind === 'num' ? format[0] : ''}<c:ptCount val="${values.length}"/>${pts}</${tag}>`
}

// Points of a cache: {ptCount, points: {idx: value}} (values unescaped)
function readCache(cacheXml) {
    const count = /<c:ptCount val="(\d+)"\/>/.exec(cacheXml)
    const points = {}
    const re = /<c:pt idx="(\d+)"[^>]*>\s*<c:v>([\s\S]*?)<\/c:v>\s*<\/c:pt>/g
    let m
    while ((m = re.exec(cacheXml)) !== null) points[parseInt(m[1], 10)] = unescapeXml(m[2])
    return { ptCount: count ? parseInt(count[1], 10) : 0, points }
}

// Rewrites the points of a cache keeping the indexes of `mapping` (old -> new)
function filterCache(cacheXml, mapping, newCount) {
    let out = cacheXml.replace(/<c:ptCount val="\d+"\/>/, `<c:ptCount val="${newCount}"/>`)
    out = out.replace(/<c:pt idx="(\d+)"([^>]*)>([\s\S]*?)<\/c:pt>/g, (whole, idx, attrs, inner) => {
        const target = mapping[parseInt(idx, 10)]
        return target === undefined ? '' : `<c:pt idx="${target}"${attrs}>${inner}</c:pt>`
    })
    return out
}

/*
 * Removes the categories whose values are 0 (or empty) in every series, so
 * that a pie chart does not show the labels of empty slices. The per point
 * formatting (colors, labels) follows its category.
 */
function dropEmptyCategories(xml) {
    const series = xml.match(/<c:ser>[\s\S]*?<\/c:ser>/g)
    if (!series) return xml
    const valueCaches = series.map((ser) => {
        const val = /<c:(?:val|yVal)>[\s\S]*?<c:numCache>([\s\S]*?)<\/c:numCache>/.exec(ser)
        return val ? readCache(val[1]) : null
    })
    if (valueCaches.some((c) => c === null)) return xml
    const count = Math.max(...valueCaches.map((c) => c.ptCount))
    if (!count) return xml
    const mapping = {}
    let next = 0
    for (let idx = 0; idx < count; idx++) {
        const empty = valueCaches.every((c) => {
            const v = c.points[idx]
            return v === undefined || v === '' || Number(v) === 0
        })
        if (!empty) mapping[idx] = next++
    }
    if (next === count) return xml

    return xml.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, (ser) => {
        // categories and values (not the series name in c:tx)
        let out = ser.replace(/<c:(cat|val|xVal|yVal)>([\s\S]*?)<\/c:\1>/g, (whole, tag, inner) => {
            const filtered = inner.replace(/<c:(numCache|strCache)>[\s\S]*?<\/c:\1>/g, (cache) => filterCache(cache, mapping, next))
            return `<c:${tag}>${filtered}</c:${tag}>`
        })
        // formatting and labels of single points
        out = out.replace(/<c:(dPt|dLbl)>([\s\S]*?)<\/c:\1>/g, (whole, tag, inner) => {
            const idx = /^\s*<c:idx val="(\d+)"\/>/.exec(inner)
            if (!idx) return whole
            const target = mapping[parseInt(idx[1], 10)]
            if (target === undefined) return ''
            return `<c:${tag}>${inner.replace(/^\s*<c:idx val="\d+"\/>/, `<c:idx val="${target}"/>`)}</c:${tag}>`
        })
        return out
    })
}

/*
 * Rebuilds the caches of the series from the workbook values and evaluates
 * the tags left in the chart part itself (cached values, titles). When the
 * chart holds tags, the categories without value are removed.
 */
function processChartXml(xml, sheets, evaluateTag, hasTags = false) {
    let out = xml
    if (sheets) {
        out = out.replace(/<c:(numRef|strRef)>([\s\S]*?)<\/c:\1>/g, (whole, refType, inner) => {
            const f = /<c:f>([\s\S]*?)<\/c:f>/.exec(inner)
            if (!f) return whole
            const range = parseRange(unescapeXml(f[1]))
            if (!range || !sheets[range.sheet]) return whole
            const kind = refType === 'numRef' ? 'num' : 'str'
            const cacheRe = kind === 'num' ? /<c:numCache>[\s\S]*?<\/c:numCache>/ : /<c:strCache>[\s\S]*?<\/c:strCache>/
            const values = range.cells.map((ref) => sheets[range.sheet][ref])
            const cache = cacheRe.exec(inner)
            const rebuilt = rebuildCache(cache ? cache[0] : '', kind, values)
            const newInner = cache ? inner.replace(cacheRe, rebuilt) : inner + rebuilt
            return `<c:${refType}>${newInner}</c:${refType}>`
        })
    }
    // Tags written directly in the chart part
    out = out.replace(/<(c:v|a:t)>([^<]*)<\/\1>/g, (whole, tag, text) => {
        const result = evaluateText(unescapeXml(text), evaluateTag)
        if (!result) return whole
        hasTags = true
        return `<${tag}>${escapeXml(result.value)}</${tag}>`
    })
    // Charts generated from the report data only: a static chart is left as drawn
    if (hasTags) out = dropEmptyCategories(out)
    return out
}

/*
 * Processes every chart of the document zip (PizZip). evaluateTag(expression)
 * returns the value of a template expression for the report data.
 */
function processCharts(zip, evaluateTag) {
    for (const name of Object.keys(zip.files)) {
        const m = /^word\/charts\/([^/]+\.xml)$/.exec(name)
        if (!m) continue
        const xml = zip.files[name].asText()
        if (xml.indexOf('<c:chartSpace') === -1) continue

        let sheets = null
        let hasTags = false
        const rid = /<c:externalData\b[^>]*\br:id="([^"]+)"/.exec(xml)
        if (rid) {
            const relsPath = `word/charts/_rels/${m[1]}.rels`
            const rels = zip.files[relsPath] ? zip.files[relsPath].asText() : ''
            const rel = new RegExp(`<Relationship\\b[^>]*\\bId="${rid[1]}"[^>]*>`).exec(rels)
            const target = rel && /\bTarget="([^"]+)"/.exec(rel[0])
            const external = rel && /TargetMode="External"/.test(rel[0])
            const path = target && !external ? resolvePath(name, unescapeXml(target[1])) : null
            if (path && zip.files[path] && /\.xlsx$/i.test(path)) {
                try {
                    const result = processWorkbook(zip.files[path].asNodeBuffer(), evaluateTag)
                    sheets = result.sheets
                    if (result.buffer) {
                        zip.file(path, result.buffer, { binary: true })
                        hasTags = true
                    }
                } catch (err) {
                    console.log(`chart-data: cannot process the workbook of ${name}: ${err.message || err}`)
                }
            }
        }
        const out = processChartXml(xml, sheets, evaluateTag, hasTags)
        if (out !== xml) zip.file(name, out)
    }
}

module.exports = { processCharts, processChartXml, processWorkbook, processSheet, evaluateText, parseRange, dropEmptyCategories }
