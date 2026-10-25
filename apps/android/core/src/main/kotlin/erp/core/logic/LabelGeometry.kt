package erp.core.logic

import erp.core.models.LabelFieldType
import erp.core.models.LabelLayoutField
import erp.core.swiftDescription
import erp.core.swiftRounded
import java.text.BreakIterator

// Ported from ERPCore's LabelGeometry.swift. Where a tag's field sits on the canvas, and how big it is, in the printer's
// dots. Pure arithmetic (no drawing), so the designer's canvas, its handles, its alignment and its tests all read the one
// answer.
//
// The rules are Zpl.kt's: a field's x, y is the top-left of its ROTATED box (^FO); text, QR codes and barcodes turn about
// their own centre and their box swaps width and height at 90 and 270 degrees; boxes, lines and ellipses never turn; a
// picture only turns half way (180), in the same box. Text stacked without a width runs down at 0, to the left at 90, up at
// 180 and to the right at 270, which is what turning the lines' own frame gives.
//
// What needs a real font or a bar code generator (the width of a word, the modules of a QR) is asked of `LabelMeasure`: the
// app supplies Android's paint and ZXing-free estimates of its own; `LabelMeasure.estimate` stands in for tests.

/** A rectangle in dots, from the label's top-left. */
data class LabelBox(val x: Double, val y: Double, val w: Double, val h: Double) {
    val maxX: Double get() = x + w
    val maxY: Double get() = y + h
    val midX: Double get() = x + w / 2
    val midY: Double get() = y + h / 2

    fun union(o: LabelBox): LabelBox {
        val nx = minOf(x, o.x)
        val ny = minOf(y, o.y)
        return LabelBox(nx, ny, maxOf(maxX, o.maxX) - nx, maxOf(maxY, o.maxY) - ny)
    }

    fun intersects(o: LabelBox): Boolean = x < o.maxX && o.x < maxX && y < o.maxY && o.y < maxY

    fun contains(px: Double, py: Double): Boolean = px >= x && px <= maxX && py >= y && py <= maxY

    fun offset(dx: Double, dy: Double): LabelBox = LabelBox(x + dx, y + dy, w, h)

    /** The box with a margin added on every side (a hit area around a thin line). */
    fun inset(d: Double): LabelBox = LabelBox(x + d, y + d, w - 2 * d, h - 2 * d)

    companion object {
        /** The rectangle two corners make, whichever way they were dragged. */
        fun between(ax: Double, ay: Double, bx: Double, by: Double): LabelBox =
            LabelBox(minOf(ax, bx), minOf(ay, by), Math.abs(ax - bx), Math.abs(ay - by))
    }
}

/** A bar code's size in modules: columns and rows (rows is 1 for a one-dimensional symbol). */
data class SymbolSize(val cols: Int, val rows: Int)

/** What the geometry cannot know without a font or a bar code generator. */
class LabelMeasure(
    /** The width of a line of text in dots at a font height in dots (bold included). */
    val advance: (text: String, fontDots: Double, bold: Boolean) -> Double,
    /** A QR code's modules a side for this data at this correction level (L, M, Q, H). */
    val qrModules: (data: String, correction: String) -> Int,
    val symbol: (symbology: String, data: String) -> SymbolSize,
) {
    companion object {
        /** Good enough to lay a tag out without a font: ZPL's font 0 is about half as wide as it is tall. */
        val estimate: LabelMeasure = LabelMeasure(
            advance = { text, fontDots, bold -> graphemes(text).size * fontDots * (if (bold) 0.54 else 0.5) },
            qrModules = { data, correction -> LabelGeometry.estimatedQRModules(data.toByteArray(Charsets.UTF_8).size, correction) },
            symbol = { symbology, data -> LabelGeometry.estimatedSymbol(symbology, data.toByteArray(Charsets.UTF_8).size) },
        )
    }
}

/** Swift's `Character`s of a string: its grapheme clusters. */
internal fun graphemes(s: String): List<String> {
    if (s.isEmpty()) return emptyList()
    val it = BreakIterator.getCharacterInstance()
    it.setText(s)
    val out = ArrayList<String>()
    var start = 0
    var end = it.next()
    while (end != BreakIterator.DONE) {
        out.add(s.substring(start, end))
        start = end
        end = it.next()
    }
    return out
}

/** One line of text in its field's own (unturned) frame. */
data class LabelTextLine(val text: String, val x: Double, val y: Double, val width: Double)

/** The lines a text field prints, and the block's size. */
class LabelTextBlock(val lines: List<LabelTextLine>, val width: Double, val height: Double)

/** Where a field is and how it is drawn: its content's size in its own frame, its box on the canvas, and the turn. */
data class LabelPlacement(
    /** The content before turning, from (0, 0). */
    val local: LabelBox,
    /** The box on the label (the rotated box, whose corner is the field's x, y). */
    val bounds: LabelBox,
    /** Degrees clockwise the content is turned about its centre before it sits in `bounds`. */
    val turn: Int,
)

class LabelSize(val w: Double, val h: Double)

object LabelGeometry {
    /** Dots under a one-dimensional bar code that its readable line takes (^BC ... Y). */
    const val barcodeTextBand: Double = 20.0

    /** ZPL's font 0 is narrower than Helvetica at the same height: the drawing squeezes the real font by this. */
    const val condense: Double = 0.86

    /** The drawing's point size for a font height in dots (the cell holds ascent and descent; the letters are smaller). */
    const val pointPerDot: Double = 0.8

    // MARK: Sizes a field has

    /** A text's font height in dots (20 when unset, as Zpl does). */
    fun fontDots(f: LabelLayoutField): Double {
        val v = f.fontSize
        if (v == null || v < 1) return 20.0
        return minOf(32000, v).toDouble()
    }

    fun symbology(f: LabelLayoutField): String = when (f.symbology) {
        "code39", "ean13", "upca", "datamatrix", "pdf417" -> f.symbology
        else -> "code128"
    }

    fun isLinear(symbology: String): Boolean = symbology in listOf("code128", "code39", "ean13", "upca")

    fun qrMagnification(f: LabelLayoutField): Int = if (f.qrMagnification == null) 2 else minOf(10, maxOf(1, f.qrMagnification))

    fun moduleWidth(f: LabelLayoutField): Int = minOf(10, maxOf(1, f.moduleWidth ?: 2))

    fun barHeight(f: LabelLayoutField): Int = if ((f.height ?: 0) >= 1) minOf(32000, f.height!!) else 40

    fun correction(f: LabelLayoutField): String =
        if (f.errorCorrection == "L" || f.errorCorrection == "Q" || f.errorCorrection == "H") f.errorCorrection else "M"

    /** The size of a box, line, ellipse or picture (1 at the least). */
    fun shapeSize(f: LabelLayoutField): LabelSize =
        LabelSize(maxOf(1, minOf(32000, f.width ?: 1)).toDouble(), maxOf(1, minOf(32000, f.height ?: 1)).toDouble())

    /** A QR code's version-by-capacity estimate (byte mode), used only where nothing can generate one. */
    fun estimatedQRModules(bytes: Int, correction: String): Int {
        // Byte-mode capacity of versions 1...10 at L, M, Q, H.
        val caps = mapOf(
            "L" to listOf(17, 32, 53, 78, 106, 134, 154, 192, 230, 271),
            "M" to listOf(14, 26, 42, 62, 84, 106, 122, 152, 180, 213),
            "Q" to listOf(11, 20, 32, 46, 60, 74, 86, 108, 130, 151),
            "H" to listOf(7, 14, 24, 34, 44, 58, 64, 84, 98, 119),
        )
        val row = caps[correction] ?: caps["M"]!!
        val i = row.indexOfFirst { bytes <= it }
        val version = (if (i < 0) 9 else i) + 1
        return 17 + 4 * version
    }

    /** A bar code's size in modules without a generator: Code 128 is 11 modules a character and 35 over, and so on. */
    fun estimatedSymbol(symbology: String, bytes: Int): SymbolSize {
        val n = maxOf(1, bytes)
        return when (symbology) {
            "code39" -> SymbolSize(13 * (n + 2) - 1, 1)
            "ean13" -> SymbolSize(95, 1)
            "upca" -> SymbolSize(95, 1)
            "datamatrix" -> {
                val side = maxOf(10, 2 * Math.ceil(Math.sqrt(n.toDouble())).toInt() + 8)
                SymbolSize(side, side)
            }
            "pdf417" -> SymbolSize(99 + 17 * Math.ceil(n / 6.0).toInt(), maxOf(3, n / 12 + 3))
            else -> SymbolSize(11 * n + 35, 1)
        }
    }

    // MARK: Text

    /**
     * The lines a text field prints: wrapped to its width (and held to its lines) or one to a new line, laid out in the
     * field's own frame. `width` and `height` are the block's.
     */
    fun textLines(f: LabelLayoutField, measure: LabelMeasure): LabelTextBlock {
        val fs = fontDots(f)
        val bold = f.bold == true
        val spacing = minOf(9999, maxOf(-9999, f.lineSpacing ?: 0)).toDouble()
        val pitch = fs + spacing
        val raw = (f.data ?: "").replace("\r\n", "\n").replace("\r", "\n")
        val paragraphs = raw.split("\n")
        fun adv(s: String): Double = measure.advance(s, fs, bold)

        val w = f.width
        if (w != null && w >= 1) {
            val blockW = minOf(32000, w).toDouble()
            val wrapped = ArrayList<String>()
            for (p in paragraphs) wrapped.addAll(wrap(p, blockW, ::adv))
            val limit = if ((f.lines ?: 0) >= 1) minOf(9999, f.lines!!) else paragraphs.size
            val shown = wrapped.take(maxOf(1, limit))
            val out = ArrayList<LabelTextLine>()
            for ((i, s) in shown.withIndex()) {
                val lw = adv(s)
                val x = if (f.align == "C") (blockW - lw) / 2 else if (f.align == "R") blockW - lw else 0.0
                out.add(LabelTextLine(s, x, i * pitch, lw))
            }
            val rows = maxOf(1, limit)
            return LabelTextBlock(out, blockW, fs + (rows - 1) * maxOf(0.0, pitch))
        }
        val out = ArrayList<LabelTextLine>()
        var widest = 0.0
        for ((i, s) in paragraphs.withIndex()) {
            val lw = adv(s)
            widest = maxOf(widest, lw)
            out.add(LabelTextLine(s, 0.0, i * pitch, lw))
        }
        return LabelTextBlock(out, widest, fs + maxOf(0, paragraphs.size - 1) * maxOf(0.0, pitch))
    }

    /** Greedy word wrap; a word wider than the block is broken by letters. */
    internal fun wrap(paragraph: String, width: Double, advance: (String) -> Double): List<String> {
        if (paragraph.isEmpty()) return listOf("")
        val lines = ArrayList<String>()
        var current = ""
        fun flush() { lines.add(current); current = "" }
        for (word in paragraph.split(" ")) {
            val trial = if (current.isEmpty()) word else "$current $word"
            if (advance(trial) <= width) { current = trial; continue }
            if (current.isNotEmpty()) flush()
            if (advance(word) <= width) { current = word; continue }
            // A single word too wide for the block: letters until it would overflow.
            for (ch in graphemes(word)) {
                val next = current + ch
                if (advance(next) > width && current.isNotEmpty()) { flush(); current = ch } else current = next
            }
        }
        if (current.isNotEmpty() || lines.isEmpty()) lines.add(current)
        return lines
    }

    // MARK: Placement

    /** The field's content size in its own frame. */
    fun contentSize(f: LabelLayoutField, measure: LabelMeasure): LabelSize {
        when (f.type) {
            LabelFieldType.text -> {
                val t = textLines(f, measure)
                return LabelSize(maxOf(t.width, 4.0), maxOf(t.height, 4.0))
            }
            LabelFieldType.qr -> {
                val modules = measure.qrModules(f.data ?: "", correction(f))
                val side = (maxOf(1, modules) * qrMagnification(f)).toDouble()
                return LabelSize(side, side)
            }
            LabelFieldType.barcode -> {
                val sym = symbology(f)
                val s = measure.symbol(sym, f.data ?: "")
                val m = moduleWidth(f).toDouble()
                val h = barHeight(f).toDouble()
                if (isLinear(sym)) return LabelSize(maxOf(1, s.cols) * m, h + (if (f.showText == true) barcodeTextBand else 0.0))
                if (sym == "pdf417") return LabelSize(maxOf(1, s.cols) * m, maxOf(1, s.rows) * h)
                return LabelSize(maxOf(1, s.cols) * m, maxOf(1, s.rows) * m)
            }
            LabelFieldType.line, LabelFieldType.box, LabelFieldType.ellipse, LabelFieldType.image -> return shapeSize(f)
        }
    }

    /** Whether the field's rotation turns its box (text, QR and bar codes). */
    fun turnsBox(type: LabelFieldType): Boolean = type == LabelFieldType.text || type == LabelFieldType.qr || type == LabelFieldType.barcode

    fun placement(f: LabelLayoutField, measure: LabelMeasure): LabelPlacement {
        val c = contentSize(f, measure)
        val local = LabelBox(0.0, 0.0, c.w, c.h)
        val x = f.x.toDouble()
        val y = f.y.toDouble()
        return when (f.type) {
            LabelFieldType.text, LabelFieldType.qr, LabelFieldType.barcode -> {
                val sideways = f.rotation == 90 || f.rotation == 270
                val turn = if (f.rotation == 90 || f.rotation == 180 || f.rotation == 270) f.rotation else 0
                LabelPlacement(local, LabelBox(x, y, if (sideways) c.h else c.w, if (sideways) c.w else c.h), turn)
            }
            // Only half a turn is printed (Zpl rotates the bitmap, never the box).
            LabelFieldType.image -> LabelPlacement(local, LabelBox(x, y, c.w, c.h), if (f.rotation == 180) 180 else 0)
            LabelFieldType.line, LabelFieldType.box, LabelFieldType.ellipse -> LabelPlacement(local, LabelBox(x, y, c.w, c.h), 0)
        }
    }

    fun bounds(f: LabelLayoutField, measure: LabelMeasure): LabelBox = placement(f, measure).bounds

    /** The box all of these fields cover, null for none. */
    fun union(fields: List<LabelLayoutField>, measure: LabelMeasure): LabelBox? =
        fields.map { bounds(it, measure) }.reduceOrNull { acc, b -> acc.union(b) }

    /** A text's line cell: the drawing's font point size for the field. */
    fun pointSize(f: LabelLayoutField): Double = fontDots(f) * pointPerDot
}

object LabelUnits {
    fun dotsPerMM(dpi: Int?): Double = (dpi ?: 203).toDouble() / 25.4

    /** 84 mm at 203 dpi -> 671 dots (whole dots, halves up). */
    fun dots(mm: Double, dpi: Int?): Int = swiftRounded(mm * dotsPerMM(dpi)).toInt()

    fun mm(dots: Double, dpi: Int?): Double = dots / dotsPerMM(dpi)

    /** "84.0" / "3.25": a millimetre figure to one place, no needless noughts past it. */
    fun mmText(dots: Double, dpi: Int?): String {
        val v = swiftRounded(mm(dots, dpi) * 10) / 10
        return if (v == swiftRounded(v)) v.toInt().toString() else swiftDescription(v)
    }

    val dpiChoices = listOf(203, 300, 600)
}
