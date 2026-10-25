package erp.core.logic

// Ported from ERPCore's PNG.swift = src/lib/png-decode.ts (tests: LabelBitmapTests).
//
// A PNG's pixels without Android's BitmapFactory (a JVM test has none): zlib's inflate (after Mark Adler's puff.c) and the
// five scanline filters, written out so a damaged file answers null the same way on every platform. Every colour type and
// bit depth of a plain (not interlaced) PNG; anything else is null, and the app can supply its own decoder to the Label
// LIVE import.

/** A picture's pixels, four bytes each (red, green, blue, alpha, each 0-255), row by row. */
class DecodedImage(val width: Int, val height: Int, val rgba: IntArray)

object PNG {
    private val lbase = intArrayOf(3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258)
    private val lext = intArrayOf(0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0)
    private val dbase = intArrayOf(1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577)
    private val dext = intArrayOf(0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13)
    private val clorder = intArrayOf(16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15)

    /** The most a picture may unpack to. */
    private const val maxOut = 64 * 1024 * 1024

    private class Huffman(val count: IntArray, val symbol: IntArray)

    private fun construct(lengths: IntArray, n: Int): Huffman? {
        val count = IntArray(16)
        for (i in 0 until n) count[lengths[i]] += 1
        var left = 1
        for (len in 1 until 16) {
            left = left shl 1
            left -= count[len]
            if (left < 0) return null
        }
        val offs = IntArray(16)
        for (len in 1 until 15) offs[len + 1] = offs[len] + count[len]
        val symbol = IntArray(n)
        for (s in 0 until n) if (lengths[s] != 0) { symbol[offs[lengths[s]]] = s; offs[lengths[s]] += 1 }
        return Huffman(count, symbol)
    }

    private val fixed: Pair<Huffman, Huffman>? by lazy {
        val l = IntArray(288) { 8 }
        for (i in 144 until 256) l[i] = 9
        for (i in 256 until 280) l[i] = 7
        val lit = construct(l, 288)
        val dist = construct(IntArray(30) { 5 }, 30)
        if (lit == null || dist == null) null else lit to dist
    }

    /** A growable run of bytes (0-255) that stops at `maxOut`. */
    private class Out {
        var data = ByteArray(1024)
        var size = 0
        fun add(v: Int) {
            if (size == data.size) data = data.copyOf(data.size * 2)
            data[size++] = v.toByte()
        }
        operator fun get(i: Int): Int = data[i].toInt() and 255
    }

    private class Inflater(val src: IntArray) {
        var pos = 2
        var bitBuf = 0
        var bitCnt = 0
        val out = Out()

        fun bits(need: Int): Int {
            var v = bitBuf
            while (bitCnt < need) {
                if (pos >= src.size) return -1
                v = v or (src[pos] shl bitCnt)
                pos += 1
                bitCnt += 8
            }
            bitBuf = v shr need
            bitCnt -= need
            return v and ((1 shl need) - 1)
        }

        fun decode(h: Huffman): Int {
            var code = 0
            var first = 0
            var index = 0
            for (len in 1 until 16) {
                val b = bits(1)
                if (b < 0) return -1
                code = code or b
                val count = h.count[len]
                if (code - count < first) return h.symbol[index + (code - first)]
                index += count; first += count; first = first shl 1; code = code shl 1
            }
            return -1
        }

        fun codes(lit: Huffman, dist: Huffman): Boolean {
            while (true) {
                var sym = decode(lit)
                if (sym < 0) return false
                if (sym < 256) {
                    if (out.size + 1 > maxOut) return false
                    out.add(sym)
                    continue
                }
                if (sym == 256) return true
                sym -= 257
                if (sym >= 29) return false
                val eb = bits(lext[sym])
                if (eb < 0) return false
                val len = lbase[sym] + eb
                val ds = decode(dist)
                if (ds < 0 || ds >= 30) return false
                val db = bits(dext[ds])
                if (db < 0) return false
                val d = dbase[ds] + db
                if (d > out.size || out.size + len > maxOut) return false
                for (k in 0 until len) out.add(out[out.size - d])
            }
        }
    }

    /** The bytes inside a zlib stream (its 2-byte header skipped, its checksum not checked); null when it is damaged. */
    fun inflate(src: IntArray): IntArray? {
        if (src.size < 2 || (src[0] and 15) != 8) return null
        val s = Inflater(src)
        while (true) {
            val last = s.bits(1)
            val type = s.bits(2)
            if (last < 0 || type < 0) return null
            if (type == 0) {
                s.bitBuf = 0; s.bitCnt = 0
                if (s.pos + 4 > src.size) return null
                val len = src[s.pos] or (src[s.pos + 1] shl 8)
                if ((len xor 0xffff) != (src[s.pos + 2] or (src[s.pos + 3] shl 8))) return null
                s.pos += 4
                if (s.pos + len > src.size || s.out.size + len > maxOut) return null
                for (k in 0 until len) s.out.add(src[s.pos + k])
                s.pos += len
            } else if (type == 1) {
                val f = fixed ?: return null
                if (!s.codes(f.first, f.second)) return null
            } else if (type == 2) {
                val nlen = s.bits(5) + 257
                val ndist = s.bits(5) + 1
                val ncode = s.bits(4) + 4
                if (nlen < 257 || ndist < 1 || ncode < 4 || nlen > 286 || ndist > 30) return null
                var lengths = IntArray(320)
                for (i in 0 until ncode) {
                    val v = s.bits(3)
                    if (v < 0) return null
                    lengths[clorder[i]] = v
                }
                val lencode = construct(lengths, 19) ?: return null
                var index = 0
                lengths = IntArray(320)
                while (index < nlen + ndist) {
                    val sym = s.decode(lencode)
                    if (sym < 0) return null
                    if (sym < 16) {
                        lengths[index] = sym
                        index += 1
                    } else {
                        var len = 0
                        var rep: Int
                        if (sym == 16) {
                            if (index == 0) return null
                            len = lengths[index - 1]
                            rep = 3 + s.bits(2)
                        } else if (sym == 17) {
                            rep = 3 + s.bits(3)
                        } else {
                            rep = 11 + s.bits(7)
                        }
                        if (rep < 3 || index + rep > nlen + ndist) return null
                        while (rep > 0) { lengths[index] = len; index += 1; rep -= 1 }
                    }
                }
                if (lengths[256] == 0) return null
                val lit = construct(lengths, nlen) ?: return null
                val dist = construct(lengths.copyOfRange(nlen, lengths.size), ndist) ?: return null
                if (!s.codes(lit, dist)) return null
            } else {
                return null
            }
            if (last == 1) break
        }
        return IntArray(s.out.size) { s.out[it] }
    }

    private fun u32(b: IntArray, i: Int): Int = (b[i] shl 24) or (b[i + 1] shl 16) or (b[i + 2] shl 8) or b[i + 3]

    /** A plain PNG as RGBA; null for anything this does not read (interlaced, damaged, not a PNG). */
    fun decode(png: IntArray): DecodedImage? {
        val sig = intArrayOf(137, 80, 78, 71, 13, 10, 26, 10)
        if (png.size < 33 || !png.copyOfRange(0, 8).contentEquals(sig)) return null
        var width = 0
        var height = 0
        var depth = 0
        var ctype = -1
        var interlace = 0
        var palette = IntArray(0)
        var trns = IntArray(0)
        val idat = ArrayList<Int>()
        var pos = 8
        while (pos + 8 <= png.size) {
            val len = u32(png, pos)
            if (len < 0) return null
            val name = String(CharArray(4) { png[pos + 4 + it].toChar() })
            if (pos + 8 + len > png.size) return null
            val body = png.copyOfRange(pos + 8, pos + 8 + len)
            when (name) {
                "IHDR" -> {
                    if (body.size < 13) return null
                    width = u32(body, 0); height = u32(body, 4); depth = body[8]; ctype = body[9]; interlace = body[12]
                }
                "PLTE" -> palette = body
                "tRNS" -> trns = body
                "IDAT" -> for (v in body) idat.add(v)
            }
            if (name == "IEND") break
            pos += 12 + len
        }
        val channels = when (ctype) { 0 -> 1; 2 -> 3; 3 -> 1; 4 -> 2; 6 -> 4; else -> return null }
        if (interlace != 0 || depth !in listOf(1, 2, 4, 8, 16) || width < 1 || height < 1 || width.toLong() * height > 16_000_000) return null
        if (ctype == 3 && (depth == 16 || palette.size < 3)) return null
        if ((ctype == 2 || ctype == 4 || ctype == 6) && depth < 8) return null
        val raw = inflate(idat.toIntArray()) ?: return null
        val bitsPerPixel = channels * depth
        val rowBytes = (width * bitsPerPixel + 7) / 8
        val bpp = maxOf(1, bitsPerPixel shr 3)
        if (raw.size < (rowBytes + 1) * height) return null
        // Undo the filters, row by row.
        val pix = IntArray(rowBytes * height)
        for (y in 0 until height) {
            val ft = raw[y * (rowBytes + 1)]
            val src = y * (rowBytes + 1) + 1
            val dst = y * rowBytes
            val up = dst - rowBytes
            for (i in 0 until rowBytes) {
                val a = if (i >= bpp) pix[dst + i - bpp] else 0
                val b = if (y > 0) pix[up + i] else 0
                val c = if (y > 0 && i >= bpp) pix[up + i - bpp] else 0
                var v = raw[src + i]
                when (ft) {
                    0 -> {}
                    1 -> v += a
                    2 -> v += b
                    3 -> v += (a + b) shr 1
                    4 -> {
                        val p = a + b - c
                        val pa = Math.abs(p - a)
                        val pb = Math.abs(p - b)
                        val pc = Math.abs(p - c)
                        v += if (pa <= pb && pa <= pc) a else if (pb <= pc) b else c
                    }
                    else -> return null
                }
                pix[dst + i] = v and 255
            }
        }
        fun sample(row: Int, n: Int): Int {
            val base = row * rowBytes
            if (depth == 8) return pix[base + n]
            if (depth == 16) return (pix[base + n * 2] shl 8) or pix[base + n * 2 + 1]
            val per = 8 / depth
            val shift = 8 - depth * ((n % per) + 1)
            return (pix[base + n / per] shr shift) and ((1 shl depth) - 1)
        }
        val maxSample = (1 shl depth) - 1
        fun to8(v: Int): Int = if (depth == 8) v else if (depth == 16) v shr 8 else (v * 255) / maxSample
        val rgba = IntArray(width * height * 4)
        for (y in 0 until height) {
            for (x in 0 until width) {
                val o = (y * width + x) * 4
                var r = 0
                var g = 0
                var b = 0
                var a = 255
                when (ctype) {
                    0 -> {
                        val v = sample(y, x)
                        r = to8(v); g = r; b = r
                        if (trns.size >= 2 && v == ((trns[0] shl 8) or trns[1])) a = 0
                    }
                    2 -> {
                        val sr = sample(y, x * 3)
                        val sg = sample(y, x * 3 + 1)
                        val sb = sample(y, x * 3 + 2)
                        r = to8(sr); g = to8(sg); b = to8(sb)
                        if (trns.size >= 6 && sr == ((trns[0] shl 8) or trns[1]) && sg == ((trns[2] shl 8) or trns[3]) && sb == ((trns[4] shl 8) or trns[5])) a = 0
                    }
                    3 -> {
                        val i = sample(y, x)
                        r = if (i * 3 < palette.size) palette[i * 3] else 0
                        g = if (i * 3 + 1 < palette.size) palette[i * 3 + 1] else 0
                        b = if (i * 3 + 2 < palette.size) palette[i * 3 + 2] else 0
                        if (i < trns.size) a = trns[i]
                    }
                    4 -> {
                        r = to8(sample(y, x * 2)); g = r; b = r
                        a = to8(sample(y, x * 2 + 1))
                    }
                    else -> {
                        r = to8(sample(y, x * 4)); g = to8(sample(y, x * 4 + 1)); b = to8(sample(y, x * 4 + 2)); a = to8(sample(y, x * 4 + 3))
                    }
                }
                rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a
            }
        }
        return DecodedImage(width, height, rgba)
    }

    /** The bytes of `data:image/...;base64,...`; null when it is not one. */
    fun dataURLBytes(url: String): IntArray? {
        val chars = url.codePoints().toArray()
        val prefix = "data:image/".length
        if (chars.size <= prefix || String(chars, 0, prefix).lowercase() != "data:image/") return null
        var i = prefix
        while (i < chars.size && chars[i] != ';'.code && chars[i] != ','.code) i += 1
        val marker = ";base64,".length
        if (i + marker > chars.size || String(chars, i, marker).lowercase() != ";base64,") return null
        return LabelBitmap.base64Decode(String(chars, i + marker, chars.size - i - marker))
    }

    /** `data:image/png;base64,...` (any image type in the header) -> the PNG it holds; null when it is not one. */
    fun decodeDataURL(url: String): DecodedImage? = dataURLBytes(url)?.let { decode(it) }
}
