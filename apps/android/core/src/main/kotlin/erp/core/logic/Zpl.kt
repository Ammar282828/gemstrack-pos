package erp.core.logic

import erp.core.ERPDate
import erp.core.models.LabelFieldType
import erp.core.models.LabelLayout
import erp.core.models.LabelLayoutField
import java.time.Instant

// Ported from ERPCore's Zpl.swift = src/lib/zebra-zpl.ts (tests: ZplTests, zebra-zpl.test.ts, the same expected strings).
//
// The tag layout (models/LabelLayout.kt) as ZPL for a Zebra printer, and the numbers and words that go on it. The string a
// phone sends is the web's and the iPhone's to the last character, so the work is done on Unicode scalars (Kotlin's
// strings are UTF-16) and braces are read by hand, not with a regular expression.
//
// - A label takes `tags` pieces (2 for a double tag); a placeholder `{SKU_2}` reads piece 2 of its label, `{sku}` (no
//   number) piece 1. A tag with no piece (the odd last one) prints blank. A key that means nothing stays as typed, so a
//   typo shows on the tag.
// - `{date}`, `{date:d MMM yyyy}`, `{time}`, `{counter:START:STEP:PAD}`, and after a pipe `{price|prefix:Rs |suffix:/-}`,
//   `{name|upper}`, `{name|lower}`, `{weight|fixed:2}`, `{price|group}`, `{name|max:18}`.
// - Text is sent with ^FH_ (ZPL's own hex escape) so a ^, ~, \ or _ in a name prints as itself, and `\&` stays a block's
//   new line.
// - A field's x, y is the corner of its rotated box (what ^FO means), so a turn never moves the corner.

object Zpl {
    // MARK: Numbers

    /** `Math.round`, then held between lo and hi. */
    internal fun clampInt(v: Double, lo: Int, hi: Int): Int {
        val r = JS.round(if (v.isFinite()) v else 0.0)
        return minOf(hi.toDouble(), maxOf(lo.toDouble(), r)).toInt()
    }

    internal fun clampInt(v: Int?, lo: Int, hi: Int): Int = minOf(hi, maxOf(lo, v ?: 0))

    /** A position or size in dots: whole, never negative (^FO takes no negative), within ZPL's 32000. */
    internal fun dots(v: Int?): Int = clampInt(v, 0, 32000)

    internal fun size(v: Int?, dflt: Int): Int = if ((v ?: 0) >= 1) clampInt(v, 1, 32000) else dflt

    private fun pad(n: Long, width: Int): String {
        val s = n.toString()
        return if (s.length >= width) s else "0".repeat(width - s.length) + s
    }

    private fun pad(n: Int, width: Int): String = pad(n.toLong(), width)

    // MARK: The date and the counter

    private val months = listOf("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")
    private val days = listOf("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")

    internal fun scalars(s: String): IntArray = s.codePoints().toArray()

    internal fun text(cps: List<Int>): String {
        val sb = StringBuilder()
        for (c in cps) sb.appendCodePoint(c)
        return sb.toString()
    }

    internal fun text(cps: IntArray, from: Int = 0, to: Int = cps.size): String {
        val sb = StringBuilder()
        for (i in from until to) sb.appendCodePoint(cps[i])
        return sb.toString()
    }

    /**
     * A moment in Karachi time by a pattern: yyyy yy, MMMM MMM MM M, dd d, EEEE EEE, HH H, hh h, mm m, ss s, a (AM/PM);
     * 'quoted' text and every other character as typed.
     */
    fun formatDate(pattern: String, at: Instant): String {
        val p = at.atOffset(ERPDate.karachi)
        val year = p.year
        val month = p.monthValue - 1
        val day = p.dayOfMonth
        val wd = p.dayOfWeek.value % 7
        val hour = p.hour
        val minute = p.minute
        val second = p.second
        val chars = scalars(pattern)
        val out = StringBuilder()
        var i = 0
        while (i < chars.size) {
            val c = chars[i]
            if (c == '\''.code) {
                // '' is one quote; otherwise everything up to the next quote is text as typed.
                if (i + 1 < chars.size && chars[i + 1] == '\''.code) { out.append('\''); i += 2; continue }
                var j = i + 1
                while (j < chars.size && (chars[j] != '\''.code || (j + 1 < chars.size && chars[j + 1] == '\''.code))) {
                    if (chars[j] == '\''.code) { out.append('\''); j += 2 } else { out.appendCodePoint(chars[j]); j += 1 }
                }
                i = j + 1
                continue
            }
            if ("yMdEHhmsa".indexOf(c.toChar()) < 0 || c > 127) { out.appendCodePoint(c); i += 1; continue }
            var n = 1
            while (i + n < chars.size && chars[i + n] == c) n += 1
            i += n
            when (c.toChar()) {
                'y' -> out.append(if (n == 2) pad(year % 100, 2) else pad(year, n))
                'M' -> out.append(if (n >= 4) months[month] else if (n == 3) months[month].take(3) else pad(month + 1, n))
                'd' -> out.append(pad(day, if (n >= 2) 2 else 1))
                'E' -> out.append(if (n >= 4) days[wd] else days[wd].take(3))
                'H' -> out.append(pad(hour, if (n >= 2) 2 else 1))
                'h' -> out.append(pad(if (hour % 12 == 0) 12 else hour % 12, if (n >= 2) 2 else 1))
                'm' -> out.append(pad(minute, if (n >= 2) 2 else 1))
                's' -> out.append(pad(second, if (n >= 2) 2 else 1))
                else -> out.append(if (hour < 12) "AM" else "PM")
            }
        }
        return out.toString()
    }

    /** `START:STEP:PAD` (each optional) -> the number for label `labelIndex`, zero padded. */
    private fun counterText(arg: String, labelIndex: Int, override: Int?): String {
        val parts = splitScalars(arg, ':'.code)
        fun read(i: Int, dflt: Long): Long {
            val t = if (i < parts.size) JS.trim(parts[i]) else ""
            if (t.isEmpty()) return dflt
            val v = JS.toNumber(t)
            return if (v.isFinite()) minOf(1e12, maxOf(-1e12, if (v < 0) Math.ceil(v) else Math.floor(v))).toLong() else dflt
        }
        val start = override?.let { minOf(1_000_000_000_000L, maxOf(-1_000_000_000_000L, it.toLong())) } ?: read(0, 1)
        val step = read(1, 1)
        val width = minOf(20L, maxOf(0L, read(2, 0))).toInt()
        val value = start + labelIndex.toLong() * step
        return (if (value < 0) "-" else "") + pad(Math.abs(value), width)
    }

    // MARK: Text helpers

    /** `s.split(sep)` on one character, keeping empty pieces. */
    internal fun splitScalars(s: String, sep: Int): List<String> {
        val out = ArrayList<String>()
        val cur = StringBuilder()
        for (c in scalars(s)) {
            if (c == sep) { out.add(cur.toString()); cur.setLength(0) } else cur.appendCodePoint(c)
        }
        out.add(cur.toString())
        return out
    }

    // MARK: Placeholders

    private val pieceKeys: Set<String> by lazy { LabelLive.labelFields.map { it.key }.toSet() }
    private val csvColumns: Set<String> by lazy { LabelCSV.baseHeaders.toSet() }

    private class Context(val pieces: List<LabelValues>, val labelIndex: Int, val now: Instant, val counterStart: Int?)

    /** One key's value from piece n of the label ("" for a known key with no piece), or null for a key that means nothing. */
    private fun lookup(key: String, ctx: Context): String? {
        fun known(k: String, n: Long): String? {
            val piece = if (n >= 1 && n <= ctx.pieces.size) ctx.pieces[(n - 1).toInt()] else null
            piece?.get(k)?.let { return it }
            if (pieceKeys.contains(k)) return ""
            val lower = k.lowercase()
            if (csvColumns.contains(lower)) return piece?.get("csv:$lower") ?: ""
            return null
        }
        known(key, 1)?.let { return it }
        // `NAME_n`: the last underscore with only digits after it.
        val sc = scalars(key)
        val us = sc.lastIndexOf('_'.code)
        if (us >= 0 && us + 1 < sc.size) {
            var allDigits = true
            for (i in us + 1 until sc.size) if (sc[i] < 48 || sc[i] > 57) allDigits = false
            if (allDigits) {
                val n = text(sc, us + 1, sc.size).toLongOrNull() ?: Long.MAX_VALUE
                if (n >= 1) return known(text(sc, 0, us), n)
            }
        }
        return null
    }

    private fun isDigit(c: Int): Boolean = c in 48..57

    /** 12500 -> 12,500 in the first number of the text, the rest as it is. */
    private fun group(value: String): String {
        val v = scalars(value)
        var i = 0
        while (i < v.size && !isDigit(v[i])) i += 1
        if (i == v.size) return value
        var j = i
        while (j < v.size && (isDigit(v[j]) || v[j] == ','.code)) j += 1
        val whole = (i until j).map { v[it] }.filter { it != ','.code }
        var k = j
        if (k < v.size && v[k] == '.'.code && k + 1 < v.size && isDigit(v[k + 1])) {
            k += 1
            while (k < v.size && isDigit(v[k])) k += 1
        }
        val grouped = ArrayList<Int>()
        for ((p, d) in whole.withIndex()) {
            if (p > 0 && (whole.size - p) % 3 == 0) grouped.add(','.code)
            grouped.add(d)
        }
        val out = ArrayList<Int>()
        for (x in 0 until i) out.add(v[x])
        out.addAll(grouped)
        if (j < k) for (x in j until k) out.add(v[x])
        for (x in maxOf(j, k) until v.size) out.add(v[x])
        return text(out)
    }

    private fun transform(value: String, spec: String): String {
        val sc = scalars(spec)
        val colon = sc.indexOf(':'.code)
        val name = if (colon >= 0) text(sc, 0, colon) else spec
        val arg = if (colon >= 0) text(sc, colon + 1, sc.size) else ""
        return when (name) {
            "prefix" -> if (value.isEmpty()) value else arg + value
            "suffix" -> if (value.isEmpty()) value else value + arg
            "upper" -> value.uppercase(java.util.Locale.ROOT)
            "lower" -> value.lowercase(java.util.Locale.ROOT)
            "fixed" -> {
                val n = JS.parseFloat(value)
                val t = JS.trim(arg)
                val digits = JS.toNumber(t)
                if (!n.isFinite() || Math.abs(n) >= 1e21 || !digits.isFinite() || t.isEmpty()) value
                else JS.toFixed(n, clampInt(digits, 0, 20))
            }
            "group" -> group(value)
            "max" -> {
                val t = JS.trim(arg)
                val n = JS.toNumber(t)
                if (!n.isFinite() || t.isEmpty()) value
                else {
                    val keep = minOf(1e9, maxOf(0.0, if (n < 0) Math.ceil(n) else Math.floor(n))).toInt()
                    val v = scalars(value)
                    text(v, 0, minOf(keep, v.size))
                }
            }
            else -> value
        }
    }

    /** The text with every `{...}` worked out. */
    private fun fill(template: String, ctx: Context): String {
        val t = scalars(template)
        val out = StringBuilder()
        var i = 0
        while (i < t.size) {
            if (t[i] != '{'.code) { out.appendCodePoint(t[i]); i += 1; continue }
            var j = i + 1
            while (j < t.size && t[j] != '}'.code && t[j] != '{'.code) j += 1
            if (j >= t.size || t[j] != '}'.code) { out.appendCodePoint(t[i]); i += 1; continue }
            val inner = t.copyOfRange(i + 1, j)
            val bar = inner.indexOf('|'.code)
            val head = if (bar >= 0) inner.copyOfRange(0, bar) else inner
            val colon = head.indexOf(':'.code)
            val name = text(if (colon >= 0) head.copyOfRange(0, colon) else head).lowercase()
            val arg = if (colon >= 0) text(head, colon + 1, head.size) else ""
            val value: String? = when (name) {
                "date" -> formatDate(arg.ifEmpty { "d MMM yyyy" }, ctx.now)
                "time" -> formatDate(arg.ifEmpty { "HH:mm" }, ctx.now)
                "counter" -> counterText(arg, ctx.labelIndex, ctx.counterStart)
                else -> lookup(text(head), ctx)
            }
            if (value != null) {
                var v: String = value
                if (bar >= 0) {
                    for (spec in splitScalars(text(inner, bar + 1, inner.size), '|'.code)) v = transform(v, spec)
                }
                out.append(v)
            } else {
                out.append(text(t, i, j + 1))
            }
            i = j + 1
        }
        return out.toString()
    }

    /** One text with its placeholders filled (what a field's `data` becomes). */
    fun resolveText(template: String, pieces: List<LabelValues>, labelIndex: Int = 0, now: Instant = Instant.now(), counterStart: Int? = null): String =
        fill(template, Context(pieces, labelIndex, now, counterStart))

    /** Labels for this many pieces. */
    fun labelCount(pieces: List<LabelValues>, layout: LabelLayout): Int = labelCount(pieces.size, layout)

    fun labelCount(pieceCount: Int, layout: LabelLayout): Int {
        val n = maxOf(0, pieceCount)
        val per = layout.tagsPerLabel
        return (n + per - 1) / per
    }

    /**
     * The layout's fields for one label with their text, QR and barcode data worked out: what the designer's preview draws
     * and what is printed. A hidden field is still here (the designer shows it faintly); the printer skips it.
     */
    fun resolveFields(layout: LabelLayout, pieces: List<LabelValues>, labelIndex: Int = 0, now: Instant = Instant.now(), counterStart: Int? = null): List<LabelLayoutField> {
        val ctx = Context(pieces, labelIndex, now, counterStart)
        return layout.fields.map { f ->
            val data = f.data
            if ((f.type != LabelFieldType.text && f.type != LabelFieldType.qr && f.type != LabelFieldType.barcode) || data == null) f
            else f.copy(data = fill(data, ctx))
        }
    }

    // MARK: ZPL

    /** ^FH_ sends `_5E` for a ^, `_7E` for a ~, `_5C` for a \, `_5F` for a _; a new line is `\&` in a text block and `_0A` elsewhere. */
    fun escape(s: String, newline: String): String {
        val out = StringBuilder()
        for (c in scalars(s)) {
            when (c) {
                '^'.code -> out.append("_5E")
                '~'.code -> out.append("_7E")
                '\\'.code -> out.append("_5C")
                '_'.code -> out.append("_5F")
                '\n'.code -> out.append(newline)
                else -> out.appendCodePoint(c)
            }
        }
        return out.toString()
    }

    private fun lineBreaks(s: String): String {
        val v = scalars(s)
        val out = StringBuilder()
        var i = 0
        while (i < v.size) {
            if (v[i] == '\r'.code) {
                out.append('\n')
                if (i + 1 < v.size && v[i + 1] == '\n'.code) i += 1
            } else out.appendCodePoint(v[i])
            i += 1
        }
        return out.toString()
    }

    private fun orientation(r: Int): String = if (r == 90) "R" else if (r == 180) "I" else if (r == 270) "B" else "N"

    private fun textZpl(f: LabelLayoutField): List<String> {
        val o = orientation(f.rotation)
        val font = if ((f.fontFamily ?: "").isEmpty()) "0" else f.fontFamily
        val fs = size(f.fontSize, 20)
        val data = lineBreaks(f.data ?: "")
        val spacing = clampInt(f.lineSpacing, -9999, 9999)
        val x = dots(f.x)
        val y = dots(f.y)
        val out = ArrayList<String>()
        fun emit(px: Int, py: Int, block: String, text: String) {
            out.add("^FO$px,$py^A$font$o,$fs,$fs$block^FH_^FD$text^FS")
            if (f.bold == true) out.add("^FO${px + 1},$py^A$font$o,$fs,$fs$block^FH_^FD$text^FS")
        }
        if ((f.width ?: 0) >= 1) {
            val newLines = splitScalars(data, '\n'.code).size - 1
            val lines = if ((f.lines ?: 0) >= 1) clampInt(f.lines, 1, 9999) else clampInt(newLines + 1, 1, 9999)
            val align = if (f.align == "C" || f.align == "R") f.align else "L"
            emit(x, y, "^FB${size(f.width, 1)},$lines,$spacing,$align", escape(data, "\\&"))
            return out
        }
        val parts = splitScalars(data, '\n'.code)
        val n = parts.size
        val pitch = fs + spacing
        val turn = if (f.rotation == 90 || f.rotation == 180 || f.rotation == 270) f.rotation else 0
        for ((i, part) in parts.withIndex()) {
            // Lines run down the text's own frame: down for 0, to the left for 90, up for 180, to the right for 270.
            val back = (n - 1 - i) * pitch
            val fwd = i * pitch
            val px = if (turn == 90) x + back else if (turn == 270) x + fwd else x
            val py = if (turn == 180) y + back else if (turn == 0) y + fwd else y
            emit(dots(px), dots(py), "", escape(part, "_0A"))
        }
        return out
    }

    private fun barcodeZpl(f: LabelLayoutField): List<String> {
        val data = lineBreaks(f.data ?: "")
        if (data.isEmpty()) return emptyList()
        val o = orientation(f.rotation)
        val h = size(f.height, 40)
        val m = clampInt(f.moduleWidth ?: 2, 1, 10)
        val yn = if (f.showText == true) "Y" else "N"
        val command = when (f.symbology) {
            "code39" -> "^BY$m^B3$o,N,$h,$yn,N"
            "ean13" -> "^BY$m^BE$o,$h,$yn,N"
            "upca" -> "^BY$m^BU$o,$h,$yn,N,Y"
            "datamatrix" -> "^BX$o,$m,200"
            "pdf417" -> "^BY$m^B7$o,$h"
            else -> "^BY$m^BC$o,$h,$yn,N,N"
        }
        return listOf("^FO${dots(f.x)},${dots(f.y)}$command^FH_^FD${escape(data, "_0A")}^FS")
    }

    private fun fieldZpl(f: LabelLayoutField): List<String> {
        when (f.type) {
            LabelFieldType.text -> return textZpl(f)
            LabelFieldType.qr -> {
                val data = lineBreaks(f.data ?: "")
                if (data.isEmpty()) return emptyList()
                val mag = if (f.qrMagnification == null) 2 else clampInt(f.qrMagnification, 1, 10)
                val ec = if (f.errorCorrection == "L" || f.errorCorrection == "Q" || f.errorCorrection == "H") f.errorCorrection else "M"
                return listOf("^FO${dots(f.x)},${dots(f.y)}^BQ${orientation(f.rotation)},2,$mag,$ec^FH_^FD${ec}A,${escape(data, "_0A")}^FS")
            }
            LabelFieldType.barcode -> return barcodeZpl(f)
            LabelFieldType.line, LabelFieldType.box -> {
                val w = size(f.width, 1)
                val h = size(f.height, 1)
                val edge = minOf(w, h)
                val t = if (f.type == LabelFieldType.line || f.fill == true) edge else size(f.thickness ?: 2, 1)
                val r = if (f.type == LabelFieldType.line) 0 else clampInt(f.rounding, 0, 8)
                return listOf("^FO${dots(f.x)},${dots(f.y)}^GB$w,$h,$t,B,$r^FS")
            }
            LabelFieldType.ellipse -> {
                val w = size(f.width, 1)
                val h = size(f.height, 1)
                val t = if (f.fill == true) minOf(w, h) else size(f.thickness ?: 2, 1)
                return listOf("^FO${dots(f.x)},${dots(f.y)}^GE$w,$h,$t,B^FS")
            }
            LabelFieldType.image -> {
                val w = size(f.width, 1)
                val h = size(f.height, 1)
                val bitmap = f.bitmap
                if (bitmap.isNullOrEmpty()) return emptyList()
                val g = LabelBitmap.hex(bitmap, w, h, f.rotation == 180) ?: return emptyList()
                return listOf("^FO${dots(f.x)},${dots(f.y)}^GFA,${g.total},${g.total},${g.bytesPerRow},${g.hex}^FS")
            }
        }
    }

    private val thermal = mapOf("transfer" to "T", "direct" to "D")
    private val mode = mapOf("tear" to "T", "peel" to "P", "cutter" to "C", "rewind" to "R", "delayed-cut" to "D")
    private val media = mapOf("gap" to "Y", "mark" to "M", "continuous" to "N")

    /** `^XA^CI28^PW...^LL...` and the printer's options, in a fixed order (^LH ^LT ^LS ^MT ^MM ^MN ^PR ~SD ~TA ^PO ^PM). */
    private fun header(layout: LabelLayout): String {
        val p = layout.effectivePrinter
        var s = "^XA^CI28^PW${size(layout.widthDots, 1)}^LL${size(layout.heightDots, 1)}"
        if (p.homeX != null || p.homeY != null) s += "^LH${dots(p.homeX)},${dots(p.homeY)}"
        p.labelTop?.let { s += "^LT${clampInt(it, -120, 120)}" }
        s += "^LS${p.labelShift?.let { clampInt(it, -9999, 9999) } ?: 0}"
        p.thermal?.let { k -> thermal[k]?.let { s += "^MT$it" } }
        p.mode?.let { k -> mode[k]?.let { s += "^MM$it" } }
        p.media?.let { k -> media[k]?.let { s += "^MN$it" } }
        p.speed?.let { s += "^PR${clampInt(it, 2, 14)}" }
        p.darkness?.let { s += "~SD${pad(clampInt(it, 0, 30), 2)}" }
        p.tearOff?.let {
            val t = clampInt(it, -120, 120)
            s += "~TA${if (t < 0) "-" else "+"}${pad(Math.abs(t), 3)}"
        }
        if (p.orientation == "normal") s += "^PON" else if (p.orientation == "inverted") s += "^POI"
        if (p.mirror == true) s += "^PMY" else if (p.mirror == false) s += "^PMN"
        return s
    }

    /**
     * The ZPL for these pieces: one label to `tags` pieces, each `^XA ... ^XZ` on its own lines, `copies` of each (^PQ).
     * `skip` blank labels come first, for a roll that is part used.
     */
    fun render(layout: LabelLayout, pieces: List<LabelValues>, copies: Int = 1, skip: Int = 0, counterStart: Int? = null, now: Instant = Instant.now()): String {
        val tags = layout.tagsPerLabel
        val copiesN = clampInt(copies, 1, 9999)
        val skipN = clampInt(skip, 0, 999)
        val head = header(layout)
        val out = StringBuilder()
        for (k in 0 until skipN) out.append("$head\n^PQ1,0,1,Y^XZ\n")
        val total = labelCount(pieces, layout)
        for (i in 0 until total) {
            val group = pieces.subList(i * tags, minOf(pieces.size, (i + 1) * tags))
            out.append("$head\n")
            for (f in resolveFields(layout, group, i, now, counterStart)) {
                if (f.hidden) continue
                for (line in fieldZpl(f)) out.append("$line\n")
            }
            out.append("^PQ$copiesN,0,1,Y^XZ\n")
        }
        return out.toString()
    }
}
