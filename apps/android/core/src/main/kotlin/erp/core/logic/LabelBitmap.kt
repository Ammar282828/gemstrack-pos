package erp.core.logic

// Ported from ERPCore's LabelBitmap.swift = src/lib/label-bitmap.ts (tests: LabelBitmapTests).
//
// Pictures on a tag, the way ZPL's ^GFA takes them: 1 bit a pixel, rows padded to whole bytes, 1 = black, kept in the
// layout as base64. Plain integer and Double arithmetic in the TypeScript's order, so the bits are the same ones the web
// makes. Bytes are 0...255 in an IntArray here (Kotlin's Byte is signed), as the rest of the label code reads them.
// No java.util.Base64: its rules for padding and spaces differ from the TypeScript's.

/** A bitmap's rotated copy. */
class RotatedBitmap(val bytes: IntArray, val width: Int, val height: Int)

/** What a field's ^GFA needs: the hex, the byte count and the bytes in a row. */
class GfaHex(val hex: String, val total: Int, val bytesPerRow: Int)

enum class Dither(val raw: String) { threshold("threshold"), atkinson("atkinson"), floyd("floyd") }

object LabelBitmap {
    private const val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

    fun base64Encode(bytes: IntArray): String {
        val out = StringBuilder()
        var i = 0
        while (i < bytes.size) {
            val a = bytes[i]
            val b = if (i + 1 < bytes.size) bytes[i + 1] else 0
            val c = if (i + 2 < bytes.size) bytes[i + 2] else 0
            out.append(alphabet[a shr 2])
            out.append(alphabet[((a and 3) shl 4) or (b shr 4)])
            out.append(if (i + 1 < bytes.size) alphabet[((b and 15) shl 2) or (c shr 6)] else '=')
            out.append(if (i + 2 < bytes.size) alphabet[c and 63] else '=')
            i += 3
        }
        return out.toString()
    }

    /** The bytes of base64 text (white space ignored, padding optional); null when anything else is in it. */
    fun base64Decode(text: String): IntArray? {
        val out = ArrayList<Int>()
        var acc = 0
        var bits = 0
        var pad = 0
        for (ch in text) {
            if (ch == ' ' || ch == '\n' || ch == '\r' || ch == '\t') continue
            if (ch == '=') { pad += 1; continue }
            if (pad > 0) return null
            val v = alphabet.indexOf(ch)
            if (v < 0) return null
            acc = (acc shl 6) or v
            bits += 6
            if (bits >= 8) {
                bits -= 8
                out.add((acc shr bits) and 255)
                acc = acc and ((1 shl bits) - 1)
            }
        }
        return if (pad > 2) null else out.toIntArray()
    }

    fun bytesPerRow(width: Int): Int = (width + 7) / 8

    /** The bitmap's bytes, padded with white or cut to exactly the size the picture needs; null when it is not base64. */
    fun bytes(bitmap: String, width: Int, height: Int): IntArray? {
        val raw = base64Decode(bitmap) ?: return null
        val total = bytesPerRow(width) * height
        val out = IntArray(maxOf(0, total))
        for (i in 0 until minOf(raw.size, out.size)) out[i] = raw[i]
        return out
    }

    fun hex(bytes: IntArray): String {
        val digits = "0123456789ABCDEF"
        val s = StringBuilder()
        for (b in bytes) { s.append(digits[b shr 4]); s.append(digits[b and 15]) }
        return s.toString()
    }

    private fun bit(bytes: IntArray, bpr: Int, x: Int, y: Int): Boolean = (bytes[y * bpr + (x shr 3)] shr (7 - (x and 7))) and 1 == 1

    /** The picture turned a quarter turn clockwise `turns` times (0-3). */
    fun rotate(bytes: IntArray, width: Int, height: Int, turns: Int): RotatedBitmap {
        val t = ((turns % 4) + 4) % 4
        if (t == 0) return RotatedBitmap(bytes, width, height)
        val bpr = bytesPerRow(width)
        val nw = if (t == 2) width else height
        val nh = if (t == 2) height else width
        val nbpr = bytesPerRow(nw)
        val out = IntArray(nbpr * nh)
        for (y in 0 until height) {
            for (x in 0 until width) {
                if (!bit(bytes, bpr, x, y)) continue
                val nx = if (t == 1) height - 1 - y else if (t == 2) width - 1 - x else y
                val ny = if (t == 1) x else if (t == 2) height - 1 - y else width - 1 - x
                out[ny * nbpr + (nx shr 3)] = out[ny * nbpr + (nx shr 3)] or (0x80 shr (nx and 7))
            }
        }
        return RotatedBitmap(out, nw, nh)
    }

    /** The ^GFA hex of a field's bitmap, turned half way when the field is; null when it cannot be read. */
    fun hex(bitmap: String, width: Int, height: Int, rotate180: Boolean): GfaHex? {
        val b = bytes(bitmap, width, height) ?: return null
        val r = if (rotate180) rotate(b, width, height, 2).bytes else b
        return GfaHex(hex(r), r.size, bytesPerRow(width))
    }

    /**
     * RGBA pixels -> the bitmap (base64) at width x height dots. A pixel's grey is its luminance laid on white (alpha
     * counts as white); a dot takes the average grey of the source pixels it covers.
     */
    fun fromRaster(
        rgba: IntArray, sourceWidth: Int, sourceHeight: Int, width: Int, height: Int,
        dither: Dither = Dither.threshold, threshold: Double? = null, brightness: Double? = null,
    ): String {
        val sw = sourceWidth
        val sh = sourceHeight
        val grey = DoubleArray(maxOf(0, width * height)) { 1.0 }
        val lift = brightness?.takeIf { it.isFinite() } ?: 0.0
        for (ty in 0 until maxOf(0, height)) {
            val y0 = (ty * sh) / height
            val y1 = ((ty + 1) * sh + height - 1) / height
            for (tx in 0 until maxOf(0, width)) {
                val x0 = (tx * sw) / width
                val x1 = ((tx + 1) * sw + width - 1) / width
                var sum = 0L
                var count = 0
                var y = y0
                while (y < y1 && y < sh) {
                    var x = x0
                    while (x < x1 && x < sw) {
                        val i = (y * sw + x) * 4
                        val a = rgba[i + 3]
                        val r = rgba[i] * a + 255 * (255 - a)
                        val g = rgba[i + 1] * a + 255 * (255 - a)
                        val b = rgba[i + 2] * a + 255 * (255 - a)
                        sum += 299L * r + 587L * g + 114L * b
                        count += 1
                        x += 1
                    }
                    y += 1
                }
                val g = if (count > 0) sum.toDouble() / (count.toDouble() * 65025000) else 1.0
                grey[ty * width + tx] = minOf(1.0, maxOf(0.0, g + lift))
            }
        }
        val limit = threshold?.takeIf { it.isFinite() } ?: 0.5
        val bpr = bytesPerRow(width)
        val out = IntArray(bpr * maxOf(0, height))
        val spread: List<Triple<Int, Int, Double>> = when (dither) {
            Dither.atkinson -> listOf(
                Triple(1, 0, 1.0 / 8), Triple(2, 0, 1.0 / 8), Triple(-1, 1, 1.0 / 8),
                Triple(0, 1, 1.0 / 8), Triple(1, 1, 1.0 / 8), Triple(0, 2, 1.0 / 8),
            )
            Dither.floyd -> listOf(Triple(1, 0, 7.0 / 16), Triple(-1, 1, 3.0 / 16), Triple(0, 1, 5.0 / 16), Triple(1, 1, 1.0 / 16))
            Dither.threshold -> emptyList()
        }
        for (y in 0 until maxOf(0, height)) {
            for (x in 0 until maxOf(0, width)) {
                val old = grey[y * width + x]
                val black = old < limit
                if (black) out[y * bpr + (x shr 3)] = out[y * bpr + (x shr 3)] or (0x80 shr (x and 7))
                if (spread.isNotEmpty()) {
                    val err = old - (if (black) 0.0 else 1.0)
                    for ((dx, dy, w) in spread) {
                        val nx = x + dx
                        val ny = y + dy
                        if (nx in 0 until width && ny < height) grey[ny * width + nx] += err * w
                    }
                }
            }
        }
        return base64Encode(out)
    }
}
