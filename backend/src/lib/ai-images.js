/*
 * Images of a finding sent to a model able to read them (the quality advisor,
 * the generation of the Observation field).
 *
 * The rich text fields hold <img src="<image id>|data:..." alt="caption">.
 * collect() lists them in the order of the fields, load() reads them (the
 * stored images are data URIs), keeps PNG / JPEG / GIF / WebP, scales the
 * large ones down to MAX_SIDE pixels on their longest side (JPEG) and stops at
 * MAX_IMAGES images and MAX_TOTAL bytes. Nothing is fetched from an external
 * URL.
 */

const jpeg = require('jpeg-js')
const imageBorder = require('./image-border')

const MAX_IMAGES = 10
const MAX_SIDE = 1600
const MAX_BYTES = 3.5 * 1024 * 1024 // per image, below the 5 MB of the providers once in base64
const MAX_TOTAL = 15 * 1024 * 1024
const IMAGE_ID_REGEX = /^[0-9a-fA-F]{24}$/

function attribute(tag, name) {
    const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)
    return m ? m[1] : null
}

function unescape(value) {
    return String(value || '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

/*
 * Images of the fields, in their order: fields = [{label, html}].
 * Returns [{src, caption, field}] without duplicates.
 */
function collect(fields) {
    const seen = new Set()
    const result = []
    for (const field of fields || []) {
        const html = String(field.html || '')
        const re = /<img\b[^>]*>/g
        let m
        while ((m = re.exec(html)) !== null) {
            const src = attribute(m[0], 'src')
            if (!src || seen.has(src)) continue
            if (!IMAGE_ID_REGEX.test(src) && !/^data:image\//i.test(src)) continue // never an external URL
            seen.add(src)
            result.push({ src, caption: unescape(attribute(m[0], 'alt') || ''), field: field.label })
        }
    }
    return result
}

// Area average scaling of an RGBA image to fit in maxSide
function scaleDown(image, maxSide) {
    const ratio = Math.max(image.width, image.height) / maxSide
    if (ratio <= 1) return image
    const width = Math.max(1, Math.round(image.width / ratio))
    const height = Math.max(1, Math.round(image.height / ratio))
    const out = Buffer.alloc(width * height * 4)
    const src = image.data
    for (let y = 0; y < height; y++) {
        const y0 = Math.floor(y * ratio)
        const y1 = Math.min(image.height, Math.max(y0 + 1, Math.floor((y + 1) * ratio)))
        for (let x = 0; x < width; x++) {
            const x0 = Math.floor(x * ratio)
            const x1 = Math.min(image.width, Math.max(x0 + 1, Math.floor((x + 1) * ratio)))
            let r = 0, g = 0, b = 0, a = 0, n = 0
            for (let sy = y0; sy < y1; sy++) {
                let i = (sy * image.width + x0) * 4
                for (let sx = x0; sx < x1; sx++, i += 4) {
                    r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; n++
                }
            }
            const o = (y * width + x) * 4
            out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n
        }
    }
    return { width, height, data: out }
}

// JPEG of an RGBA image, transparent pixels on white
function toJpeg(image) {
    const data = Buffer.alloc(image.width * image.height * 4)
    for (let i = 0; i < data.length; i += 4) {
        const alpha = image.data[i + 3] / 255
        data[i] = image.data[i] * alpha + 255 * (1 - alpha)
        data[i + 1] = image.data[i + 1] * alpha + 255 * (1 - alpha)
        data[i + 2] = image.data[i + 2] * alpha + 255 * (1 - alpha)
        data[i + 3] = 255
    }
    return jpeg.encode({ width: image.width, height: image.height, data }, 85).data
}

/*
 * An image ready for the model: {mediaType, data (base64)}, null when it
 * cannot be used.
 */
function prepare(dataUri) {
    const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(String(dataUri || ''))
    if (!m) return null
    const mediaType = m[1].toLowerCase().replace('image/jpg', 'image/jpeg')
    const buffer = Buffer.from(m[2], 'base64')
    let decoded = null
    try { decoded = imageBorder.decode(buffer) } catch (err) { decoded = null }
    if (decoded) {
        if (Math.max(decoded.width, decoded.height) <= MAX_SIDE && buffer.length <= MAX_BYTES)
            return { mediaType, data: buffer.toString('base64') }
        const jpegData = toJpeg(scaleDown(decoded, MAX_SIDE))
        if (jpegData.length > MAX_BYTES) return null
        return { mediaType: 'image/jpeg', data: Buffer.from(jpegData).toString('base64') }
    }
    // formats the providers read but that are not decoded here
    if (['image/gif', 'image/webp'].includes(mediaType) && buffer.length <= MAX_BYTES) return { mediaType, data: m[2] }
    return null
}

/*
 * Loads the images: loader(id) returns the data URI of a stored image.
 * Returns [{caption, field, mediaType, data}] within the limits.
 */
async function load(refs, loader) {
    const result = []
    let total = 0
    for (const ref of refs || []) {
        if (result.length >= MAX_IMAGES) break
        let dataUri = ref.src
        if (IMAGE_ID_REGEX.test(ref.src)) {
            try { dataUri = await loader(ref.src) } catch (err) { dataUri = null }
        }
        const image = prepare(dataUri)
        if (!image) continue
        const size = image.data.length * 3 / 4
        if (total + size > MAX_TOTAL) break
        total += size
        result.push({ caption: ref.caption, field: ref.field, mediaType: image.mediaType, data: image.data })
    }
    return result
}

module.exports = { collect, load, prepare, scaleDown, MAX_IMAGES, MAX_SIDE }
