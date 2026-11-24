/*
 * Border of an image drawn into its pixels when the report is generated.
 *
 * The editor stores the border as attributes of the image (data-border-width
 * in CSS pixels of the displayed image, data-border-color), the uploaded
 * image is never modified. A picture outline added in Word is drawn around
 * the picture frame, over the text next to it (the caption); the border is
 * therefore drawn into a copy of the image, around it (the canvas grows by
 * the border width, nothing of the screenshot is covered).
 *
 * withBorder(dataUri, {width, color}) returns a PNG data URI, or null when
 * the format is not supported (PNG and JPEG are).
 */

const { PNG } = require('pngjs')
const jpeg = require('jpeg-js')

// Images wider than this are scaled down to it in the report (and in the
// editor), the width set in the editor is relative to that displayed width
const DISPLAY_WIDTH = 600
const MAX_BORDER = 20

function decode(buffer) {
    if (buffer.length > 8 && buffer.readUInt32BE(0) === 0x89504e47) {
        const png = PNG.sync.read(buffer)
        return { width: png.width, height: png.height, data: png.data }
    }
    if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) {
        const img = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 })
        return { width: img.width, height: img.height, data: img.data }
    }
    return null
}

function parseColor(color) {
    const hex = String(color || '').replace('#', '')
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return [0, 0, 0]
    return [0, 2, 4].map((i) => parseInt(hex.substring(i, i + 2), 16))
}

function withBorder(dataUri, border) {
    if (!border || !(Number(border.width) > 0)) return null
    const m = /^data:image\/[a-z0-9.+-]+;base64,(.*)$/i.exec(String(dataUri || ''))
    if (!m) return null
    let image
    try {
        image = decode(Buffer.from(m[1], 'base64'))
    } catch (err) {
        console.log('image-border: cannot decode the image', err.message || err)
        return null
    }
    if (!image) return null

    const scale = Math.max(1, image.width / DISPLAY_WIDTH)
    const b = Math.max(1, Math.round(Math.min(Number(border.width), MAX_BORDER) * scale))
    const [r, g, bl] = parseColor(border.color)
    const width = image.width + 2 * b
    const height = image.height + 2 * b
    const out = new PNG({ width, height })
    const data = out.data
    for (let i = 0; i < data.length; i += 4) {
        data[i] = r; data[i + 1] = g; data[i + 2] = bl; data[i + 3] = 255
    }
    const src = image.data
    for (let y = 0; y < image.height; y++) {
        const from = y * image.width * 4
        src.copy ? src.copy(data, ((y + b) * width + b) * 4, from, from + image.width * 4)
            : data.set(src.subarray(from, from + image.width * 4), ((y + b) * width + b) * 4)
    }
    return 'data:image/png;base64,' + PNG.sync.write(out).toString('base64')
}

module.exports = { withBorder, decode, DISPLAY_WIDTH }
