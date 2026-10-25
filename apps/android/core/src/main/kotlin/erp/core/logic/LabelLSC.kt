package erp.core.logic

import erp.core.Json
import erp.core.models.LabelFieldType
import erp.core.models.LabelLayout
import erp.core.models.LabelLayoutField
import erp.core.models.LabelPrinterSettings

// Ported from ERPCore's LabelLSC.swift = src/lib/label-lsc.ts (tests: LabelLSCTests, label-lsc.test.ts).
//
// Label LIVE (label.live) designs -> the ERP's tag layout. A design is a `.lsc` file (JSON): `labelConfig` has the label's
// size and dpi, `canvasRecord.objects[i]` what each object is (its type, and for text and barcodes the text with its
// `{VARIABLES}`), `canvasRecord.fabricRep.objects[i]` where it sits (fabric.js 5: dots from the label's CENTRE, each
// object's own origin, scale and angle).
//
// Only geometry and the variables' NAMES are read: never `dataImport`, a variable's `value`, a path or the window (`ui`).
// What cannot be drawn on a tag (a slanted line, an unknown element) is left out.
//
// Pictures are PNG data URLs, decoded here by `PNG` (the same code gives the same bits as the web). A picture that is not a
// PNG goes to `imageDecoder`, which the app supplies from Android's BitmapFactory; without one it is left out.

object LabelLSC {
    /** A design as a layout; null when the data is not one. */
    fun importDesign(bytes: ByteArray, id: String? = null, name: String? = null, imageDecoder: ((IntArray) -> DecodedImage?)? = null): LabelLayout? =
        importDesign(String(bytes, Charsets.UTF_8), id, name, imageDecoder)

    /** The same from the file's text. */
    fun importDesign(json: String, id: String? = null, name: String? = null, imageDecoder: ((IntArray) -> DecodedImage?)? = null): LabelLayout? {
        val root = Json.parse(json)
        return importDesign(J(root), id, name, imageDecoder)
    }

    // MARK: JSON

    /** A value of the file as JavaScript reads it: missing keys are null, `str` is a string or "". */
    private class J(val v: Any?) {
        @Suppress("UNCHECKED_CAST")
        val obj: Map<String, Any?>? get() = v as? Map<String, Any?>
        val array: List<J> get() = (v as? List<*>)?.map { J(it) } ?: emptyList()
        val isNull: Boolean get() = v == null
        val str: String get() = (v as? String) ?: ""
        val isString: Boolean get() = v is String

        fun num(dflt: Double = 0.0): Double = when (v) {
            is Number -> v.toDouble().let { if (it.isFinite()) it else dflt }
            is String -> {
                val t = JS.trim(v)
                if (t.isEmpty()) dflt else JS.toNumber(t).let { if (it.isFinite()) it else dflt }
            }
            else -> dflt
        }

        operator fun get(key: String): J = J(obj?.get(key))
        val isTrue: Boolean get() = v == true
        val isFalse: Boolean get() = v == false
        val isNumber: Double? get() = (v as? Number)?.toDouble()
    }

    // MARK: Geometry

    private class Box(val x: Double, val y: Double, val w: Double, val h: Double, val turn: Int, val cx: Double, val cy: Double)

    private fun ri(d: Double): Int = if (d.isFinite()) minOf(1e9, maxOf(-1e9, JS.round(d))).toInt() else 0
    private fun clamp(v: Double, lo: Double, hi: Double): Double = minOf(hi, maxOf(lo, v))

    /** Where a fabric object sits on the label: the corner of its rotated box, from the label's top-left, and its own size. */
    private fun boxOf(fo: J, bigW: Double, bigH: Double, width: Double, height: Double): Box {
        val w = width * Math.abs(fo["scaleX"].num(1.0))
        val h = height * Math.abs(fo["scaleY"].num(1.0))
        val ox = if (fo["originX"].str == "center") 0.5 else if (fo["originX"].str == "right") 1.0 else 0.0
        val oy = if (fo["originY"].str == "center") 0.5 else if (fo["originY"].str == "bottom") 1.0 else 0.0
        val q = JS.round(clamp(fo["angle"].num(), -1e9, 1e9) / 90).toInt()
        val quarter = ((q % 4) + 4) % 4
        val turn = quarter * 90
        val c = doubleArrayOf(1.0, 0.0, -1.0, 0.0)[quarter]
        val s = doubleArrayOf(0.0, 1.0, 0.0, -1.0)[quarter]
        fun rx(px: Double, py: Double): Double = px * c - py * s
        fun ry(px: Double, py: Double): Double = px * s + py * c
        // Fabric turns an object about its origin point, so the origin stays put: the object's own top-left is found from it.
        val tlx = fo["left"].num() - rx(ox * w, oy * h)
        val tly = fo["top"].num() - ry(ox * w, oy * h)
        val xs = listOf(0.0, rx(w, 0.0), rx(0.0, h), rx(w, h)).map { tlx + it }
        val ys = listOf(0.0, ry(w, 0.0), ry(0.0, h), ry(w, h)).map { tly + it }
        val minX = xs.min()
        val minY = ys.min()
        val maxX = xs.max()
        val maxY = ys.max()
        val sideways = turn == 90 || turn == 270
        return Box(
            minX + bigW / 2, minY + bigH / 2, if (sideways) h else w, if (sideways) w else h, turn,
            (minX + maxX) / 2 + bigW / 2, (minY + maxY) / 2 + bigH / 2,
        )
    }

    private val white = setOf("#fff", "#ffffff", "white", "rgb(255,255,255)", "rgb(255, 255, 255)")

    private fun invisible(color: J, labelFill: String): Boolean {
        if (!color.isString) return true
        val c = JS.trim(color.str).lowercase()
        return c.isEmpty() || c == "transparent" || c == "none" || c == labelFill || white.contains(c)
    }

    private val symbologies = mapOf(
        "code128" to "code128", "gs1128" to "code128", "code39" to "code39", "ean13" to "ean13", "upca" to "upca",
        "datamatrix" to "datamatrix", "pdf417" to "pdf417",
    )
    private val letterTurn = mapOf("N" to 0, "R" to 90, "I" to 180, "B" to 270)

    /** The largest source text a picture may keep (see lib/writes/label-layout.ts). */
    private const val maxSource = 64 * 1024

    /** JavaScript's `a ?? b`: the first unless it is missing or null. */
    private fun coalesce(a: J, b: J): J = if (a.isNull) b else a

    private fun crlf(s: String): String {
        val v = s.codePoints().toArray()
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

    // MARK: The import

    private fun importDesign(root: J, id: String?, name: String?, imageDecoder: ((IntArray) -> DecodedImage?)?): LabelLayout? {
        if (root.obj == null) return null
        val lc = root["labelConfig"].takeIf { it.obj != null } ?: return null
        val cr = root["canvasRecord"].takeIf { it.obj != null } ?: return null

        val dpiRaw = lc["dpi"].num(203.0)
        val dpi = if (dpiRaw > 0) dpiRaw else 203.0
        fun toDots(m: J): Double {
            var v: Double = if (m.isString && m.str.isNotEmpty()) JS.parseFloat(m.str) else JS.parseFloat(JS.number(m.num()))
            if (!v.isFinite()) return Double.NaN
            v = if (lc["metric"].isFalse) v * dpi else (v * dpi) / 25.4
            return maxOf(1.0, JS.round(v))
        }
        val bigW = toDots(lc["widthMeasure"])
        val bigH = toDots(lc["heightMeasure"])
        if (!bigW.isFinite() || !bigH.isFinite()) return null

        val objects = cr["objects"].array
        val fabric = cr["fabricRep"]["objects"].array
        val labelFill = JS.trim(cr["fill"].str).lowercase()
        fun decode(url: String): DecodedImage? {
            PNG.decodeDataURL(url)?.let { return it }
            val decoder = imageDecoder ?: return null
            val bytes = PNG.dataURLBytes(url) ?: return null
            return decoder(bytes)
        }

        val names = HashSet<String>()
        for (v in cr["variables"].array) {
            if (v.obj != null && v["name"].isString) names.add(v["name"].str)
        }

        val fields = ArrayList<LabelLayoutField>()
        val centres = ArrayList<Pair<Double, Double>>()
        for (i in 0 until minOf(objects.size, fabric.size)) {
            val rec = objects[i]
            val fo = fabric[i]
            if (rec.obj == null || fo.obj == null) continue
            val cfg = rec["config"]
            val kind = rec["type"].str
            fun base(b: Box, type: LabelFieldType, label: String): LabelLayoutField {
                val hidden = rec["hideOnPrint"].isTrue || fo["hideOnPrint"].isTrue || fo["visible"].isFalse
                return LabelLayoutField(id = "lsc-${i + 1}", type = type, x = ri(b.x), y = ri(b.y), hidden = hidden, name = label)
            }
            val widthOf = fo["width"].num()
            val heightOf = fo["height"].num()
            fun push(f: LabelLayoutField, b: Box) { fields.add(f); centres.add(b.cx to b.cy) }

            if (kind == "ELEMENT_TEXT") {
                val data = crlf(cfg["text"].str)
                val b = boxOf(fo, bigW, bigH, widthOf, heightOf)
                val scaleY = Math.abs(fo["scaleY"].num(1.0))
                val fs = maxOf(1, ri(fo["fontSize"].num(20.0) * scaleY))
                var f = base(b, LabelFieldType.text, "Text").copy(
                    data = data, fontSize = fs, width = maxOf(1, ri(widthOf * Math.abs(fo["scaleX"].num(1.0)))),
                    lines = Zpl.splitScalars(data, '\n'.code).size,
                )
                val pitch = ri(fo["fontSize"].num(20.0) * fo["lineHeight"].num(1.0) * 1.13 * scaleY)
                if (pitch - fs != 0) f = f.copy(lineSpacing = pitch - fs)
                val own = fo["textAlign"].str
                val align = if (own.isEmpty()) cfg["textAlign"].str else own
                if (align == "center") f = f.copy(align = "C") else if (align == "right") f = f.copy(align = "R")
                if (b.turn != 0) f = f.copy(rotation = b.turn)
                push(f, b)
            } else if (kind == "ELEMENT_BARCODE") {
                val bcid = cfg["bcid"].str.lowercase()
                val b = boxOf(fo, bigW, bigH, widthOf, heightOf)
                val turn = (b.turn + (letterTurn[cfg["rotate"].str] ?: 0)) % 360
                val data = crlf(cfg["text"].str)
                val scale = cfg["scale"].num(0.0)
                val inner = if (cfg["opts"].obj != null) cfg["opts"] else J(emptyMap<String, Any?>())
                if (bcid == "qrcode" || bcid == "microqrcode") {
                    var f = base(b, LabelFieldType.qr, "QR code").copy(
                        data = data,
                        qrMagnification = if (scale >= 1 && scale <= 10) ri(scale) else clamp(JS.round(b.w / 21), 1.0, 10.0).toInt(),
                    )
                    val own = inner["eclevel"].str
                    val ec = (if (own.isEmpty()) cfg["eclevel"].str else own).uppercase()
                    f = f.copy(errorCorrection = if (ec == "L" || ec == "Q" || ec == "H") ec else "M")
                    if (turn != 0) f = f.copy(rotation = turn)
                    push(f, b)
                } else {
                    val symbology = symbologies[bcid] ?: continue
                    var f = base(b, LabelFieldType.barcode, "Barcode").copy(
                        data = data, symbology = symbology,
                        height = maxOf(1, ri(if (turn == 90 || turn == 270) b.w else b.h)),
                        moduleWidth = clamp(JS.round(if (scale != 0.0) scale else 2.0), 1.0, 10.0).toInt(),
                    )
                    if (cfg["includetext"].isTrue || inner["includetext"].isTrue) f = f.copy(showText = true)
                    if (turn != 0) f = f.copy(rotation = turn)
                    push(f, b)
                }
            } else if (kind == "ELEMENT_IMAGE") {
                val src = fo["src"].str
                if (src.isEmpty()) continue
                val img = decode(src) ?: continue
                val b = boxOf(fo, bigW, bigH, widthOf, heightOf)
                // The picture is made at its drawn size in its own orientation, then turned a quarter at a time for 90 and 270.
                val drawnW = maxOf(1, ri(widthOf * Math.abs(fo["scaleX"].num(1.0))))
                val drawnH = maxOf(1, ri(heightOf * Math.abs(fo["scaleY"].num(1.0))))
                val kindId = cfg["kindId"].str
                val dither = if (kindId.contains("ATKINSON")) Dither.atkinson else if (kindId.contains("FLOYD")) Dither.floyd else Dither.threshold
                var bitmap = LabelBitmap.fromRaster(
                    img.rgba, img.width, img.height, drawnW, drawnH, dither = dither, brightness = cfg["brightness"].isNumber ?: 0.0,
                )
                var w = drawnW
                var h = drawnH
                if (b.turn == 90 || b.turn == 270) {
                    LabelBitmap.bytes(bitmap, drawnW, drawnH)?.let { bytes ->
                        val r = LabelBitmap.rotate(bytes, drawnW, drawnH, if (b.turn == 90) 1 else 3)
                        bitmap = LabelBitmap.base64Encode(r.bytes)
                        w = r.width; h = r.height
                    }
                }
                var f = base(b, LabelFieldType.image, "Picture").copy(width = w, height = h, bitmap = bitmap, dither = dither.raw)
                if (b.turn == 180) f = f.copy(rotation = 180)
                if (src.length <= maxSource) f = f.copy(source = src)
                push(f, b)
            } else if (kind == "ELEMENT_SHAPE_LINE") {
                if (invisible(coalesce(cfg["stroke"], fo["stroke"]), labelFill)) continue
                // Straight lines only: a horizontal or a vertical one becomes a filled bar of its stroke's width, around the line's centre.
                val b = boxOf(fo, bigW, bigH, widthOf, heightOf)
                val thick = maxOf(1, ri(cfg["strokeWidth"].num(fo["strokeWidth"].num(1.0))))
                val horizontal = b.h < 0.5
                val vertical = b.w < 0.5
                if (horizontal == vertical) continue
                val bw = maxOf(1, ri(if (horizontal) b.w else thick.toDouble()))
                val bh = maxOf(1, ri(if (horizontal) thick.toDouble() else b.h))
                val f = base(b, LabelFieldType.line, "Line").copy(
                    x = ri(b.cx - bw.toDouble() / 2), y = ri(b.cy - bh.toDouble() / 2), width = bw, height = bh,
                )
                push(f, b)
            } else if (kind == "ELEMENT_SHAPE_RECT" || kind == "ELEMENT_SHAPE_ELLIPSE" || kind == "ELEMENT_SHAPE_CIRCLE") {
                val fillShown = !invisible(coalesce(cfg["fill"], fo["fill"]), labelFill)
                val strokeShown = !invisible(coalesce(cfg["stroke"], fo["stroke"]), labelFill) && cfg["strokeWidth"].num(fo["strokeWidth"].num(0.0)) > 0
                if (!fillShown && !strokeShown) continue
                val rx = fo["rx"].num()
                val ry = fo["ry"].num()
                val radius = fo["radius"].num()
                val isRect = kind == "ELEMENT_SHAPE_RECT"
                val ew = if (isRect) widthOf else (if (widthOf != 0.0) widthOf else (if (rx * 2 != 0.0) rx * 2 else radius * 2))
                val eh = if (isRect) heightOf else (if (heightOf != 0.0) heightOf else (if (ry * 2 != 0.0) ry * 2 else radius * 2))
                val b = boxOf(fo, bigW, bigH, ew, eh)
                var f = base(b, if (isRect) LabelFieldType.box else LabelFieldType.ellipse, if (isRect) "Box" else "Ellipse").copy(
                    width = maxOf(1, ri(b.w)), height = maxOf(1, ri(b.h)),
                )
                f = if (fillShown) f.copy(fill = true) else f.copy(thickness = maxOf(1, ri(cfg["strokeWidth"].num(fo["strokeWidth"].num(1.0)))))
                if (isRect && fo["rx"].num() > 0) {
                    val ratio = JS.round(fo["rx"].num() / (minOf(ew, eh) / 2) * 8)
                    f = f.copy(rounding = if (ratio.isInfinite()) 8 else clamp(ratio, 0.0, 8.0).toInt())
                }
                push(f, b)
            }
        }

        // A design of several tags names its variables `X_1`, `X_2`: the highest number is how many pieces a label takes.
        val tagsSeen = HashSet<Int>()
        for (n in names) {
            val n2 = LabelLive.tagSuffix(n)?.second ?: continue
            if (n2 > 0) tagsSeen.add(n2)
        }
        val tags = if (tagsSeen.size >= 2) minOf(12, tagsSeen.max()) else 1

        // A QR or barcode whose text is one `{name}` that is not a variable of the design is a sample left in the file (it
        // would print the braces): it takes the SKU of the nearest text's tag instead.
        for (k in fields.indices) {
            val f = fields[k]
            val data = f.data
            if ((f.type != LabelFieldType.qr && f.type != LabelFieldType.barcode) || data == null) continue
            val d = data.codePoints().toArray()
            if (d.size < 2 || d.first() != '{'.code || d.last() != '}'.code) continue
            if ((1 until d.size - 1).any { d[it] == '{'.code || d[it] == '}'.code }) continue
            if (names.contains(Zpl.text(d, 1, d.size - 1))) continue
            var tag = 0
            var best = Double.POSITIVE_INFINITY
            for (j in fields.indices) {
                if (fields[j].type != LabelFieldType.text) continue
                val n = firstTagNumber(fields[j].data ?: "") ?: continue
                val dist = Math.pow(centres[j].first - centres[k].first, 2.0) + Math.pow(centres[j].second - centres[k].second, 2.0)
                if (dist < best) { best = dist; tag = n }
            }
            fields[k] = f.copy(data = if (tags > 1 && tag > 0) "{SKU_$tag}" else "{sku}")
        }

        val pc = lc["printerConfig"]
        var printer = LabelPrinterSettings()
        val thermal = pc["THERMAL_MODE"].str.uppercase()
        if (thermal.endsWith("TRANSFER")) printer = printer.copy(thermal = "transfer") else if (thermal.endsWith("DIRECT")) printer = printer.copy(thermal = "direct")
        val dark = JS.round(JS.parseFloat(pc["DARKNESS"].str))
        if (dark.isFinite() && dark >= 0 && dark <= 30) printer = printer.copy(darkness = dark.toInt())
        val speed = JS.round(JS.parseFloat(pc["SPEED"].str))
        if (speed.isFinite() && speed >= 2 && speed <= 14) printer = printer.copy(speed = speed.toInt())

        return LabelLayout(
            id = id ?: "lsc-import", name = name ?: "Imported design", widthDots = ri(bigW), heightDots = ri(bigH),
            dpi = if (dpi == 203.0 || dpi == 300.0 || dpi == 600.0) dpi.toInt() else 203,
            tags = if (tags > 1) tags else null,
            printer = if (!printer.isEmpty) printer else null,
            fields = fields,
        )
    }

    /** The `n` of the first `{..._n}` or `{..._n|...}` in a text (n of one or two digits), as TS `/\{[^{}]*_(\d{1,2})(?:\|[^{}]*)?\}/`. */
    private fun firstTagNumber(text: String): Int? {
        val t = text.codePoints().toArray()
        var i = 0
        while (i < t.size) {
            if (t[i] != '{'.code) { i += 1; continue }
            var j = i + 1
            while (j < t.size && t[j] != '}'.code && t[j] != '{'.code) j += 1
            if (j >= t.size || t[j] != '}'.code) { i += 1; continue }
            val inner = t.copyOfRange(i + 1, j)
            // The last underscore with one or two digits after it that is followed by the end or a pipe.
            var u = inner.size - 1
            while (u >= 0) {
                if (inner[u] == '_'.code) {
                    for (width in intArrayOf(2, 1)) {
                        if (u + 1 + width <= inner.size && (u + 1 until u + 1 + width).all { inner[it] in 48..57 }) {
                            val after = u + 1 + width
                            if (after == inner.size || inner[after] == '|'.code) {
                                return Zpl.text(inner, u + 1, after).toIntOrNull()
                            }
                        }
                    }
                }
                u -= 1
            }
            i = j + 1
        }
        return null
    }
}
