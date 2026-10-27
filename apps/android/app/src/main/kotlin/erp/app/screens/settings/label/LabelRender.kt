package erp.app.screens.settings.label

import erp.app.ui.icons.Symbols
import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.google.zxing.BarcodeFormat
import com.google.zxing.datamatrix.DataMatrixWriter
import com.google.zxing.oned.Code128Writer
import com.google.zxing.oned.Code39Writer
import com.google.zxing.oned.EAN13Writer
import com.google.zxing.pdf417.encoder.PDF417
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import com.google.zxing.qrcode.encoder.Encoder
import erp.core.logic.LabelEditing
import erp.core.logic.LabelGeometry
import erp.core.logic.LabelMeasure
import erp.core.logic.SymbolSize
import erp.core.logic.Zpl
import erp.core.logic.LabelValues
import erp.core.models.LabelFieldType
import erp.core.models.LabelLayout
import erp.core.models.LabelLayoutField
import java.time.Instant

// How the tag designer draws a field as it will print (the canvas and every preview share this file; the iPhone's
// LabelRender.swift).
//
// Sizes come from core's `LabelGeometry`; this file only supplies what needs the system: real text widths (a condensed
// system font stands in for ZPL's font 0), and the modules of QR, Code 128, Code 39, EAN-13, UPC-A, Data Matrix and PDF417 from
// ZXing, the symbols as the printer will lay them out within a module or two. A symbol ZXing cannot make for that text (an
// EAN-13 of letters) is drawn as a labelled pattern of the estimated size: the printer makes the real one.

// MARK: Symbols

/** A bar code as a grid of modules, true where dark. */
class SymbolMatrix(val cols: Int, val rows: Int, val dark: BooleanArray, val isPlaceholder: Boolean = false) {
    fun isDark(c: Int, r: Int): Boolean = dark[r * cols + c]
}

object LabelSymbols {
    private val cache = HashMap<String, SymbolMatrix>()
    private val misses = HashSet<String>()

    private fun cached(key: String, make: () -> SymbolMatrix?): SymbolMatrix? {
        cache[key]?.let { return it }
        if (misses.contains(key)) return null
        val m = try { make() } catch (e: Exception) { null }
        if (m != null) {
            if (cache.size > 300) cache.clear()
            cache[key] = m
            return m
        }
        if (misses.size > 300) misses.clear()
        misses.add(key)
        return null
    }

    private fun fromRow(bits: BooleanArray) = SymbolMatrix(bits.size, 1, bits)

    fun qr(data: String, correction: String): SymbolMatrix? {
        if (data.isEmpty()) return null
        return cached("qr|$correction|$data") {
            val level = when (correction) { "L" -> ErrorCorrectionLevel.L; "Q" -> ErrorCorrectionLevel.Q; "H" -> ErrorCorrectionLevel.H; else -> ErrorCorrectionLevel.M }
            val m = Encoder.encode(data, level, mapOf(com.google.zxing.EncodeHintType.CHARACTER_SET to "UTF-8")).matrix
            val dark = BooleanArray(m.width * m.height) { m.get(it % m.width, it / m.width).toInt() == 1 }
            SymbolMatrix(m.width, m.height, dark)
        }
    }

    fun code128(data: String): SymbolMatrix? = if (data.isEmpty()) null else cached("c128|$data") { fromRow(Code128Writer().encode(data)) }

    private fun code39(data: String): SymbolMatrix? = if (data.isEmpty()) null else cached("c39|$data") { fromRow(Code39Writer().encode(data)) }

    private fun ean13(data: String): SymbolMatrix? = if (data.isEmpty()) null else cached("ean|$data") { fromRow(EAN13Writer().encode(data)) }

    /** UPC-A is EAN-13 with a leading zero. */
    private fun upca(data: String): SymbolMatrix? = if (data.length != 11 && data.length != 12) null else cached("upc|$data") { fromRow(EAN13Writer().encode("0$data")) }

    private fun dataMatrix(data: String): SymbolMatrix? = if (data.isEmpty()) null else cached("dm|$data") {
        val m = DataMatrixWriter().encode(data, BarcodeFormat.DATA_MATRIX, 0, 0)
        SymbolMatrix(m.width, m.height, BooleanArray(m.width * m.height) { m.get(it % m.width, it / m.width) })
    }

    fun pdf417(data: String): SymbolMatrix? = if (data.isEmpty()) null else cached("pdf|$data") {
        val p = PDF417()
        p.generateBarcodeLogic(data, 2)
        val rows = p.barcodeMatrix.getScaledMatrix(1, 1)
        val cols = rows[0].size
        SymbolMatrix(cols, rows.size, BooleanArray(cols * rows.size) { rows[it / cols][it % cols].toInt() == 1 })
    }

    /** The matrix of whatever the field is, real where ZXing can make it and a pattern otherwise. */
    fun matrixFor(f: LabelLayoutField): SymbolMatrix {
        val data = f.data ?: ""
        if (f.type == LabelFieldType.qr) {
            qr(data, LabelGeometry.correction(f))?.let { return it }
            return pattern("qr", data.toByteArray().size, data, LabelGeometry.correction(f))
        }
        val sym = LabelGeometry.symbology(f)
        val real = when (sym) {
            "code128" -> code128(data)
            "code39" -> code39(data)
            "ean13" -> ean13(data)
            "upca" -> upca(data)
            "datamatrix" -> dataMatrix(data)
            "pdf417" -> pdf417(data)
            else -> null
        }
        return real ?: pattern(sym, data.toByteArray().size, data, "M")
    }

    /** A deterministic pattern of the symbology's estimated size. */
    fun pattern(symbology: String, bytes: Int, seed: String, correction: String): SymbolMatrix {
        val cols: Int
        val rows: Int
        if (symbology == "qr") {
            cols = LabelGeometry.estimatedQRModules(bytes, correction); rows = cols
        } else {
            val s = LabelGeometry.estimatedSymbol(symbology, bytes)
            cols = s.cols; rows = s.rows
        }
        var state = 2166136261L.toInt()
        for (b in seed.toByteArray()) state = (state xor (b.toInt() and 255)) * 16777619
        fun next(): Int { state = state * 1664525 + 1013904223; return (state ushr 16) and 0xFFFF }
        val dark = BooleanArray(cols * rows)
        if (rows == 1) {
            var c = 0
            var on = true
            while (c < cols) {
                val run = 1 + next() % 3
                for (k in 0 until run) if (c + k < cols) dark[c + k] = on
                c += run; on = !on
            }
        } else {
            for (r in 0 until rows) for (c in 0 until cols) dark[r * cols + c] = next() % 2 == 0
            if (symbology == "datamatrix") {
                for (i in 0 until cols) { dark[(rows - 1) * cols + i] = true; dark[i] = i % 2 == 0 }
                for (i in 0 until rows) { dark[i * cols] = true; dark[i * cols + cols - 1] = i % 2 == 1 }
            }
        }
        return SymbolMatrix(cols, rows, dark, isPlaceholder = symbology != "qr")
    }
}

// MARK: Measuring

object LabelMeasurer {
    private val widths = HashMap<String, Double>()

    private fun paint(fontDots: Double, bold: Boolean): Paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        textSize = (fontDots * LabelGeometry.pointPerDot).toFloat()
        textScaleX = LabelGeometry.condense.toFloat()
        // Figures all one width, as the iPhone's monospaced digits: a price does not shift as it counts.
        fontFeatureSettings = "tnum"
    }

    private fun advance(text: String, fontDots: Double, bold: Boolean): Double {
        if (text.isEmpty()) return 0.0
        val key = "$fontDots|$bold|$text"
        widths[key]?.let { return it }
        val w = paint(fontDots, bold).measureText(text).toDouble()
        if (widths.size > 6000) widths.clear()
        widths[key] = w
        return w
    }

    /** Real text widths and ZXing symbol sizes; the estimate where a symbol cannot be made. */
    val measure = LabelMeasure(
        advance = { text, fontDots, bold -> advance(text, fontDots, bold) },
        qrModules = { data, correction -> LabelSymbols.qr(data, correction)?.cols ?: LabelGeometry.estimatedQRModules(data.toByteArray().size, correction) },
        symbol = { symbology, data ->
            val field = LabelLayoutField(id = "", type = LabelFieldType.barcode, symbology = symbology, data = data)
            val m = LabelSymbols.matrixFor(field)
            if (m.isPlaceholder) LabelGeometry.estimatedSymbol(symbology, data.toByteArray().size) else SymbolSize(m.cols, m.rows)
        },
    )

    fun paintFor(fontDots: Double, bold: Boolean): Paint = paint(fontDots, bold)
}

// MARK: Pictures

object LabelBitmapImage {
    private val cache = HashMap<String, ImageBitmap>()

    /** The 1-bit bitmap as a picture whose black dots are black and whose white dots are clear. */
    fun make(bitmap: String, width: Int, height: Int): ImageBitmap? {
        if (width <= 0 || height <= 0 || width.toLong() * height > 4_000_000) return null
        val key = "${width}x$height|${bitmap.length}|${bitmap.hashCode()}"
        cache[key]?.let { return it }
        val px = LabelEditing.pixels(bitmap, width, height) ?: return null
        val argb = IntArray(width * height) { if (px[it]) 0xFF000000.toInt() else 0 }
        val out = android.graphics.Bitmap.createBitmap(argb, width, height, android.graphics.Bitmap.Config.ARGB_8888).asImageBitmap()
        if (cache.size > 40) cache.clear()
        cache[key] = out
        return out
    }
}

// MARK: One field

fun symbologyName(s: String): String = when (s) {
    "code39" -> "Code 39"
    "ean13" -> "EAN-13"
    "upca" -> "UPC-A"
    "datamatrix" -> "Data Matrix"
    "pdf417" -> "PDF417"
    else -> "Code 128"
}

private val ink = Color.Black

/**
 * A field drawn as it prints, its rotated box's corner at [origin] plus its dots times [scale] (pixels a dot). White is not
 * ink: the label under it shows through. A hidden field is drawn faintly (the designer shows it; the printer skips it).
 */
fun DrawScope.drawLabelField(field: LabelLayoutField, scale: Float, origin: Offset, faint: Boolean = false) {
    val p = LabelGeometry.placement(field, LabelMeasurer.measure)
    val cx = origin.x + ((p.bounds.x + p.bounds.w / 2) * scale).toFloat()
    val cy = origin.y + ((p.bounds.y + p.bounds.h / 2) * scale).toFloat()
    val lw = (p.local.w * scale).toFloat()
    val lh = (p.local.h * scale).toFloat()
    val alpha = if (faint) 0.3f else 1f
    withTransform({
        translate(cx, cy)
        rotate(p.turn.toFloat(), Offset.Zero)
        translate(-lw / 2, -lh / 2)
    }) {
        when (field.type) {
            LabelFieldType.text -> drawText(field, scale, alpha)
            LabelFieldType.qr, LabelFieldType.barcode -> drawSymbol(field, lw, lh, scale, alpha)
            LabelFieldType.line, LabelFieldType.box, LabelFieldType.ellipse -> drawShape(field, p.local.w, p.local.h, scale, alpha)
            LabelFieldType.image -> drawPicture(field, p.local.w.toInt(), p.local.h.toInt(), lw, lh, alpha)
        }
    }
}

private fun DrawScope.drawText(field: LabelLayoutField, scale: Float, alpha: Float) {
    val t = LabelGeometry.textLines(field, LabelMeasurer.measure)
    val paint = LabelMeasurer.paintFor(LabelGeometry.fontDots(field), field.bold == true).apply {
        textSize = (LabelGeometry.pointSize(field) * scale).toFloat().coerceAtLeast(1f)
        color = ink.copy(alpha = alpha).toArgb()
    }
    // The line box's top sits at the line's y, as a text view's does: the baseline is one ascent below it.
    val ascent = -paint.fontMetrics.ascent
    drawIntoCanvas { c ->
        for (line in t.lines) {
            c.nativeCanvas.drawText(line.text, (line.x * scale).toFloat(), (line.y * scale).toFloat() + ascent, paint)
        }
    }
}

private fun DrawScope.drawSymbol(field: LabelLayoutField, w: Float, h: Float, scale: Float, alpha: Float) {
    val m = LabelSymbols.matrixFor(field)
    val sym = if (field.type == LabelFieldType.qr) "qr" else LabelGeometry.symbology(field)
    val linear = field.type == LabelFieldType.barcode && LabelGeometry.isLinear(sym)
    val band = if (linear && field.showText == true) LabelGeometry.barcodeTextBand else 0.0
    val barsH = ((h / scale - band) * scale).toFloat()
    val cw = w / m.cols
    val ch = barsH / m.rows
    val color = ink.copy(alpha = alpha)
    for (r in 0 until m.rows) {
        var c = 0
        while (c < m.cols) {
            if (m.isDark(c, r)) {
                var end = c
                while (end < m.cols && m.isDark(end, r)) end += 1
                // A quarter pixel over, so adjacent modules leave no hairline.
                drawRect(color, Offset(c * cw, r * ch), Size((end - c) * cw + 0.25f, ch + 0.25f))
                c = end
            } else c += 1
        }
    }
    if (band > 0) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = Typeface.MONOSPACE
            textSize = (band * 0.7 * scale).toFloat().coerceAtLeast(1f)
            this.color = color.toArgb()
        }
        val text = field.data ?: ""
        // Shrunk to fit the bars' width, as the iPhone's minimum scale factor does.
        val natural = paint.measureText(text)
        if (natural > w && natural > 0) paint.textSize = paint.textSize * (w / natural).coerceAtLeast(0.2f)
        drawIntoCanvas { c ->
            val x = ((w - paint.measureText(text)) / 2).coerceAtLeast(0f)
            c.nativeCanvas.drawText(text, x, barsH + (band * scale).toFloat() / 2 - (paint.fontMetrics.ascent + paint.fontMetrics.descent) / 2, paint)
        }
    }
    if (m.isPlaceholder) {
        val name = symbologyName(sym)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = Typeface.DEFAULT_BOLD
            textSize = (w / 8).coerceIn(5f, 11f * density)
            this.color = Color.Black.toArgb()
        }
        val tw = paint.measureText(name)
        val pad = 3f * density
        val y = barsH / 2
        drawRoundRect(Color.White.copy(alpha = 0.85f), Offset((w - tw) / 2 - pad, y - paint.textSize), Size(tw + 2 * pad, paint.textSize * 1.4f), CornerRadius(paint.textSize))
        drawIntoCanvas { c -> c.nativeCanvas.drawText(name, (w - tw) / 2, y + paint.textSize * 0.1f, paint) }
    }
}

private fun DrawScope.drawShape(f: LabelLayoutField, localW: Double, localH: Double, scale: Float, alpha: Float) {
    val w = (localW * scale).toFloat()
    val h = (localH * scale).toFloat()
    val edge = minOf(localW, localH)
    val t = if (f.type == LabelFieldType.line || f.fill == true) edge else maxOf(1, f.thickness ?: 2).toDouble()
    val solid = t * 2 >= edge
    val radius = if (f.type == LabelFieldType.box) (minOf(8, maxOf(0, f.rounding ?: 0)).toFloat() / 8 * edge.toFloat() / 2 * scale) else 0f
    val color = ink.copy(alpha = alpha)
    fun fillShape(x: Float, y: Float, sw: Float, sh: Float, rad: Float) {
        if (f.type == LabelFieldType.ellipse) drawOval(color, Offset(x, y), Size(sw, sh))
        else drawRoundRect(color, Offset(x, y), Size(sw, sh), CornerRadius(maxOf(0f, rad)))
    }
    if (solid) {
        fillShape(0f, 0f, w, h, radius)
    } else {
        val inset = (t * scale / 2).toFloat()
        val style = Stroke(width = (t * scale).toFloat())
        if (f.type == LabelFieldType.ellipse) drawOval(color, Offset(inset, inset), Size(w - 2 * inset, h - 2 * inset), style = style)
        else drawRoundRect(color, Offset(inset, inset), Size(w - 2 * inset, h - 2 * inset), CornerRadius(maxOf(0f, radius - inset)), style = style)
    }
}

private fun DrawScope.drawPicture(f: LabelLayoutField, w: Int, h: Int, pw: Float, ph: Float, alpha: Float) {
    val bmp = f.bitmap
    val image = if (!bmp.isNullOrEmpty()) LabelBitmapImage.make(bmp, w, h) else null
    if (image != null) {
        drawImage(
            image, dstSize = androidx.compose.ui.unit.IntSize(pw.toInt().coerceAtLeast(1), ph.toInt().coerceAtLeast(1)),
            alpha = alpha, filterQuality = androidx.compose.ui.graphics.FilterQuality.None,
        )
    } else {
        drawRect(Color.Gray, Offset.Zero, Size(pw, ph), style = Stroke(1f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 4f))))
        drawLine(Color.Gray, Offset.Zero, Offset(pw, ph), 1f)
        drawLine(Color.Gray, Offset(pw, 0f), Offset(0f, ph), 1f)
    }
}

// MARK: The whole tag

/**
 * The label drawn small and still: a white tag with every visible field where its dots put it. Used by the print job sheet and
 * the designer's preview. [fields] are already filled (`Zpl.resolveFields`).
 */
@Composable
fun LabelTagPreview(layout: LabelLayout, fields: List<LabelLayoutField>, modifier: Modifier = Modifier) {
    val w = maxOf(1, layout.widthDots).toFloat()
    val h = maxOf(1, layout.heightDots).toFloat()
    Canvas(
        modifier.fillMaxWidth().widthIn(max = 420.dp).aspectRatio(w / h)
            .semantics { contentDescription = "Preview of the tag" },
    ) {
        val k = size.width / w
        drawRoundRect(Color.White, Offset.Zero, size, CornerRadius(6.dp.toPx()))
        for (f in fields) if (!f.hidden) drawLabelField(f, k, Offset.Zero)
        drawRoundRect(Color.Gray.copy(alpha = 0.4f), Offset.Zero, size, CornerRadius(6.dp.toPx()), style = Stroke(1f))
    }
}

/** The tag with the pieces' values worked into its fields, as label [labelIndex] of a job prints. */
@Composable
fun LabelTagPreview(
    layout: LabelLayout, pieces: List<LabelValues>, modifier: Modifier = Modifier,
    labelIndex: Int = 0, now: Instant = Instant.now(), counterStart: Int? = null,
) {
    val fields = remember(layout, pieces, labelIndex, now, counterStart) { Zpl.resolveFields(layout, pieces, labelIndex, now, counterStart) }
    LabelTagPreview(layout, fields, modifier)
}
