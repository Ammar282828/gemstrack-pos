package erp.core.logic

import erp.core.Json
import erp.core.models.LabelFieldType
import erp.core.models.LabelLayout
import erp.core.models.LabelLayoutField
import erp.core.swiftRounded
import java.time.Instant

// Ported from ERPCore's LabelEditing.swift. What the tag designer does to a layout, as pure functions on its fields, so each
// one is tested and the iPhone's, the Mac's and Android's designers share the rules: move, resize by a handle, turn, align,
// distribute, stack order, duplicate and paste, snap to the grid and to other fields, and the undo stack.
//
// Positions stay whole dots. A locked field is never moved, resized, turned or aligned. The list order of
// `LabelLayout.fields` is the paint order: the last one is on top.

enum class LabelHandle {
    topLeft, top, topRight, right, bottomRight, bottom, bottomLeft, left;

    val movesLeft: Boolean get() = this == topLeft || this == left || this == bottomLeft
    val movesRight: Boolean get() = this == topRight || this == right || this == bottomRight
    val movesTop: Boolean get() = this == topLeft || this == top || this == topRight
    val movesBottom: Boolean get() = this == bottomLeft || this == bottom || this == bottomRight
    val horizontal: Boolean get() = movesLeft || movesRight
    val vertical: Boolean get() = movesTop || movesBottom

    /** The box this handle drags to when the pointer is at (px, py): the opposite edges stay. */
    fun dragged(b: LabelBox, px: Double, py: Double): LabelBox {
        var l = b.x
        var r = b.maxX
        var t = b.y
        var bt = b.maxY
        if (movesLeft) l = minOf(px, r - 1)
        if (movesRight) r = maxOf(px, l + 1)
        if (movesTop) t = minOf(py, bt - 1)
        if (movesBottom) bt = maxOf(py, t + 1)
        return LabelBox(l, t, r - l, bt - t)
    }
}

enum class LabelAlign { left, centre, right, top, middle, bottom }
enum class LabelOrder { forward, backward, front, back }
enum class LabelAxis { horizontal, vertical }

/** What the Add menu makes. */
sealed class LabelNewKind {
    object Text : LabelNewKind()

    /** A text holding a placeholder token such as `{sku}`. */
    data class Variable(val token: String) : LabelNewKind()
    object Qr : LabelNewKind()
    data class Barcode(val symbology: String) : LabelNewKind()
    object Line : LabelNewKind()
    object Box : LabelNewKind()
    object Ellipse : LabelNewKind()

    /** `{date:FORMAT}` as a text. */
    data class Date(val format: String) : LabelNewKind()

    /** `{counter:START:STEP:PAD}` as a text. */
    data class Counter(val start: Int, val step: Int, val pad: Int) : LabelNewKind()
}

/** How a snap moved a box, and the lines the designer draws to say what it caught. */
data class LabelSnap(val dx: Double = 0.0, val dy: Double = 0.0, val guideX: Double? = null, val guideY: Double? = null)

object LabelEditing {
    internal fun dot(v: Double): Int = minOf(32000.0, maxOf(-32000.0, if (v.isFinite()) swiftRounded(v) else 0.0)).toInt()

    // MARK: Ids and new fields

    /** `field-<ms>` as the web names them, with a number after it when that one is taken. */
    fun newId(existing: Set<String>, now: Instant = Instant.now()): String {
        val base = "field-${now.toEpochMilli()}"
        if (!existing.contains(base)) return base
        var n = 2
        while (existing.contains("$base-$n")) n += 1
        return "$base-$n"
    }

    /** A new field of this kind, centred on the label. */
    fun make(kind: LabelNewKind, layout: LabelLayout, measure: LabelMeasure, now: Instant = Instant.now()): LabelLayoutField {
        val id = newId(layout.fields.map { it.id }.toSet(), now)
        val f = when (kind) {
            LabelNewKind.Text -> LabelLayoutField(id = id, type = LabelFieldType.text, data = "New text", fontSize = 24)
            is LabelNewKind.Variable -> LabelLayoutField(id = id, type = LabelFieldType.text, data = kind.token, fontSize = 24)
            is LabelNewKind.Date -> LabelLayoutField(id = id, type = LabelFieldType.text, data = if (kind.format.isEmpty()) "{date}" else "{date:${kind.format}}", fontSize = 24)
            is LabelNewKind.Counter -> LabelLayoutField(id = id, type = LabelFieldType.text, data = "{counter:${kind.start}:${kind.step}:${kind.pad}}", fontSize = 24)
            LabelNewKind.Qr -> LabelLayoutField(id = id, type = LabelFieldType.qr, data = "{sku}", qrMagnification = 3, errorCorrection = "M")
            is LabelNewKind.Barcode -> LabelLayoutField(id = id, type = LabelFieldType.barcode, data = "{sku}", symbology = kind.symbology, height = 60, moduleWidth = 2, showText = true)
            LabelNewKind.Line -> LabelLayoutField(id = id, type = LabelFieldType.line, width = 120, height = 2)
            LabelNewKind.Box -> LabelLayoutField(id = id, type = LabelFieldType.box, width = 100, height = 60, thickness = 2, rounding = 0, fill = false)
            LabelNewKind.Ellipse -> LabelLayoutField(id = id, type = LabelFieldType.ellipse, width = 100, height = 60, thickness = 2, fill = false)
        }
        return centred(f, layout, measure)
    }

    /** A picture field (the bitmap is made by the app from the chosen file), centred. */
    fun makePicture(
        bitmap: String, width: Int, height: Int, dither: String, threshold: Double, source: String?,
        layout: LabelLayout, measure: LabelMeasure, now: Instant = Instant.now(),
    ): LabelLayoutField {
        val id = newId(layout.fields.map { it.id }.toSet(), now)
        val f = LabelLayoutField(id = id, type = LabelFieldType.image, width = width, height = height, bitmap = bitmap, dither = dither, threshold = threshold, source = source)
        return centred(f, layout, measure)
    }

    internal fun centred(f: LabelLayoutField, layout: LabelLayout, measure: LabelMeasure): LabelLayoutField {
        val zero = f.copy(x = 0, y = 0)
        val b = LabelGeometry.bounds(zero, measure)
        return zero.copy(
            x = maxOf(0, dot((layout.widthDots - b.w) / 2)),
            y = maxOf(0, dot((layout.heightDots - b.h) / 2)),
        )
    }

    // MARK: Moving

    /** These fields moved by whole dots; a locked one stays. */
    fun moved(fields: List<LabelLayoutField>, ids: Set<String>, dx: Int, dy: Int): List<LabelLayoutField> =
        fields.map { f -> if (!ids.contains(f.id) || f.locked) f else f.copy(x = f.x + dx, y = f.y + dy) }

    /** The fields set to a new corner (a drag's result); `origins` is where each started. */
    fun placed(fields: List<LabelLayoutField>, origins: Map<String, Pair<Int, Int>>, dx: Int, dy: Int): List<LabelLayoutField> =
        fields.map { f ->
            val o = origins[f.id]
            if (o == null || f.locked) f else f.copy(x = o.first + dx, y = o.second + dy)
        }

    // MARK: Resizing

    /**
     * The field after its handle was dragged so the box became `nb`. A text takes a width (sideways) and a font size (up and
     * down); a QR code its magnification; a bar code its module width and height; a box, line, ellipse and picture their
     * width and height. The opposite edge stays where it was.
     */
    fun resized(f: LabelLayoutField, handle: LabelHandle, nb: LabelBox, measure: LabelMeasure): LabelLayoutField {
        if (f.locked) return f
        var r = f
        val sideways = LabelGeometry.turnsBox(f.type) && (f.rotation == 90 || f.rotation == 270)
        val localW = if (sideways) nb.h else nb.w
        val localH = if (sideways) nb.w else nb.h
        // The handle's sides in the field's own frame (a turned field's top is another side of the label).
        val content = LabelGeometry.contentSize(f, measure)

        when (f.type) {
            LabelFieldType.line, LabelFieldType.box, LabelFieldType.ellipse, LabelFieldType.image ->
                r = r.copy(width = maxOf(1, dot(nb.w)), height = maxOf(1, dot(nb.h)))
            LabelFieldType.text -> {
                val fs = LabelGeometry.fontDots(f)
                val ratio = if (content.h > 0) localH / content.h else 1.0
                val verticalInFrame = if (sideways) handle.horizontal else handle.vertical
                val horizontalInFrame = if (sideways) handle.vertical else handle.horizontal
                if (verticalInFrame && Math.abs(ratio - 1) > 0.02) r = r.copy(fontSize = minOf(600, maxOf(4, dot(fs * ratio))))
                if (horizontalInFrame) {
                    val w = maxOf(8, dot(localW))
                    // Still as wide as the text itself and no width set: it stays a free-running line.
                    if (!(f.width == null && Math.abs(w.toDouble() - content.w) < 1.5)) r = r.copy(width = w)
                }
            }
            LabelFieldType.qr -> {
                val modules = maxOf(1, measure.qrModules(f.data ?: "", LabelGeometry.correction(f)))
                val side = maxOf(localW, localH)
                r = r.copy(qrMagnification = minOf(10, maxOf(1, dot(side / modules))))
            }
            LabelFieldType.barcode -> {
                val sym = LabelGeometry.symbology(f)
                val s = measure.symbol(sym, f.data ?: "")
                val horizontalInFrame = if (sideways) handle.vertical else handle.horizontal
                val verticalInFrame = if (sideways) handle.horizontal else handle.vertical
                if (horizontalInFrame) r = r.copy(moduleWidth = minOf(10, maxOf(1, dot(localW / maxOf(1, s.cols)))))
                if (verticalInFrame) {
                    if (LabelGeometry.isLinear(sym)) {
                        val bar = localH - (if (f.showText == true) LabelGeometry.barcodeTextBand else 0.0)
                        r = r.copy(height = maxOf(4, dot(bar)))
                    } else if (sym == "pdf417") {
                        r = r.copy(height = maxOf(1, dot(localH / maxOf(1, s.rows))))
                    } else if (!horizontalInFrame) {
                        r = r.copy(moduleWidth = minOf(10, maxOf(1, dot(localH / maxOf(1, s.rows)))))
                    }
                }
            }
        }
        val after = LabelGeometry.bounds(r, measure)
        return r.copy(
            x = dot(if (handle.movesLeft) nb.maxX - after.w else nb.x),
            y = dot(if (handle.movesTop) nb.maxY - after.h else nb.y),
        )
    }

    // MARK: Turning

    /**
     * A quarter turn (90 clockwise, -90 back) about the box's centre. Boxes, lines and ellipses swap width and height (they
     * never turn on the printer); a picture goes between 0 and half a turn.
     */
    fun rotated(f: LabelLayoutField, degrees: Int = 90, measure: LabelMeasure): LabelLayoutField {
        if (f.locked) return f
        val old = LabelGeometry.bounds(f, measure)
        return when (f.type) {
            LabelFieldType.text, LabelFieldType.qr, LabelFieldType.barcode -> {
                val turned = f.copy(rotation = (((f.rotation + degrees) % 360) + 360) % 360)
                val nb = LabelGeometry.bounds(turned, measure)
                turned.copy(x = dot(old.midX - nb.w / 2), y = dot(old.midY - nb.h / 2))
            }
            LabelFieldType.image -> f.copy(rotation = if (f.rotation == 180) 0 else 180)
            LabelFieldType.line, LabelFieldType.box, LabelFieldType.ellipse -> {
                val s = LabelGeometry.shapeSize(f)
                f.copy(width = s.h.toInt(), height = s.w.toInt(), x = dot(old.midX - s.h / 2), y = dot(old.midY - s.w / 2))
            }
        }
    }

    // MARK: Aligning

    /** The selected fields lined up to the selection's edge (or `within`, the label, for a lone field). */
    fun aligned(fields: List<LabelLayoutField>, ids: Set<String>, edge: LabelAlign, within: LabelBox? = null, measure: LabelMeasure): List<LabelLayoutField> {
        val chosen = fields.filter { ids.contains(it.id) }
        val reference = within ?: LabelGeometry.union(chosen, measure) ?: return fields
        return fields.map { f ->
            if (!ids.contains(f.id) || f.locked) return@map f
            val b = LabelGeometry.bounds(f, measure)
            when (edge) {
                LabelAlign.left -> f.copy(x = f.x + dot(reference.x - b.x))
                LabelAlign.centre -> f.copy(x = f.x + dot(reference.midX - b.midX))
                LabelAlign.right -> f.copy(x = f.x + dot(reference.maxX - b.maxX))
                LabelAlign.top -> f.copy(y = f.y + dot(reference.y - b.y))
                LabelAlign.middle -> f.copy(y = f.y + dot(reference.midY - b.midY))
                LabelAlign.bottom -> f.copy(y = f.y + dot(reference.maxY - b.maxY))
            }
        }
    }

    /** Three or more fields spaced so the gaps between them are equal, the outer two staying. */
    fun distributed(fields: List<LabelLayoutField>, ids: Set<String>, axis: LabelAxis, measure: LabelMeasure): List<LabelLayoutField> {
        val chosen = fields.filter { ids.contains(it.id) }
        if (chosen.size < 3) return fields
        val boxes = chosen.map { it.id to LabelGeometry.bounds(it, measure) }
        val sorted = boxes.sortedBy { if (axis == LabelAxis.horizontal) it.second.midX else it.second.midY }
        val first = sorted.first().second
        val last = sorted.last().second
        val span = if (axis == LabelAxis.horizontal) last.maxX - first.x else last.maxY - first.y
        val total = sorted.fold(0.0) { acc, item -> acc + (if (axis == LabelAxis.horizontal) item.second.w else item.second.h) }
        val gap = (span - total) / (sorted.size - 1)
        val target = HashMap<String, Double>()
        var cursor = if (axis == LabelAxis.horizontal) first.x else first.y
        for (item in sorted) {
            target[item.first] = cursor
            cursor += (if (axis == LabelAxis.horizontal) item.second.w else item.second.h) + gap
        }
        val current = boxes.toMap()
        return fields.map { f ->
            val to = target[f.id]
            val b = current[f.id]
            if (to == null || b == null || f.locked) f
            else if (axis == LabelAxis.horizontal) f.copy(x = f.x + dot(to - b.x)) else f.copy(y = f.y + dot(to - b.y))
        }
    }

    // MARK: Stack order

    fun reordered(fields: List<LabelLayoutField>, ids: Set<String>, order: LabelOrder): List<LabelLayoutField> {
        val a = fields.toMutableList()
        when (order) {
            LabelOrder.front -> return a.filter { !ids.contains(it.id) } + a.filter { ids.contains(it.id) }
            LabelOrder.back -> return a.filter { ids.contains(it.id) } + a.filter { !ids.contains(it.id) }
            LabelOrder.forward -> {
                if (a.size <= 1) return a
                var i = a.size - 2
                while (i >= 0) {
                    if (ids.contains(a[i].id) && !ids.contains(a[i + 1].id)) java.util.Collections.swap(a, i, i + 1)
                    i -= 1
                }
                return a
            }
            LabelOrder.backward -> {
                if (a.size <= 1) return a
                for (i in 1 until a.size) if (ids.contains(a[i].id) && !ids.contains(a[i - 1].id)) java.util.Collections.swap(a, i, i - 1)
                return a
            }
        }
    }

    /** A list with these positions moved to `destination` (the offset in the list as it was, as a drag gives it). */
    fun <T> moveItems(items: List<T>, from: Set<Int>, destination: Int): List<T> {
        val moving = from.sorted().filter { it >= 0 && it < items.size }.map { items[it] }
        val rest = ArrayList<T>()
        for ((i, item) in items.withIndex()) if (!from.contains(i)) rest.add(item)
        val before = from.count { it < destination }
        val at = minOf(rest.size, maxOf(0, destination - before))
        rest.addAll(at, moving)
        return rest
    }

    /** The layers list shows the top field first; this applies its drag to the paint order. */
    fun reorderedByLayerList(fields: List<LabelLayoutField>, from: Set<Int>, destination: Int): List<LabelLayoutField> =
        moveItems(fields.reversed(), from, destination).reversed()

    // MARK: Copies

    /** The new list and the new ids. */
    class Inserted(val fields: List<LabelLayoutField>, val ids: List<String>)

    /** Copies of these fields placed on top, moved by `offset` dots, with new ids; returns the new ids. */
    fun inserting(copies: List<LabelLayoutField>, into: List<LabelLayoutField>, offset: Int = 10, now: Instant = Instant.now()): Inserted {
        val all = into.toMutableList()
        val taken = into.map { it.id }.toMutableSet()
        val ids = ArrayList<String>()
        for (c in copies) {
            val id = newId(taken, now)
            taken.add(id)
            all.add(c.copy(id = id, x = c.x + offset, y = c.y + offset, locked = false))
            ids.add(id)
        }
        return Inserted(all, ids)
    }

    fun duplicated(fields: List<LabelLayoutField>, ids: Set<String>, offset: Int = 10, now: Instant = Instant.now()): Inserted =
        inserting(fields.filter { ids.contains(it.id) }, fields, offset, now)

    fun removed(fields: List<LabelLayoutField>, ids: Set<String>): List<LabelLayoutField> =
        fields.filter { !ids.contains(it.id) || it.locked }

    // MARK: Clipboard

    const val clipboardPrefix = "erp-label-fields:"

    /** Fields as text for the clipboard (so a paste works across windows and devices). */
    fun clipboardText(fields: List<LabelLayoutField>): String? {
        if (fields.isEmpty()) return null
        return clipboardPrefix + jsonText(fields.map { it.json })
    }

    fun fields(fromClipboard: String?): List<LabelLayoutField> {
        val text = fromClipboard ?: return emptyList()
        if (!text.startsWith(clipboardPrefix)) return emptyList()
        val list = Json.parse(text.substring(clipboardPrefix.length)) as? List<*> ?: return emptyList()
        val out = list.map { LabelLayoutField.decode(it) }
        // The whole list fails to read when one field does, as a decoded array does.
        return if (out.any { it == null }) emptyList() else out.filterNotNull()
    }

    private fun jsonText(v: Any?): String = when (v) {
        null -> "null"
        is String -> LabelLive.jsonString(v)
        is Boolean -> v.toString()
        is Number -> if (v is Double || v is Float) JS.number(v.toDouble()) else v.toString()
        is Map<*, *> -> "{" + v.entries.joinToString(",") { LabelLive.jsonString(it.key.toString()) + ":" + jsonText(it.value) } + "}"
        is List<*> -> "[" + v.joinToString(",") { jsonText(it) } + "]"
        else -> "null"
    }

    // MARK: Snapping

    /**
     * How far a box being dragged must move to sit on the grid, or else on the label's edges and centre and on the other
     * fields' edges and centres (within `threshold` dots).
     */
    fun snap(box: LabelBox, others: List<LabelBox>, label: LabelBox, grid: Int?, threshold: Double): LabelSnap {
        if (grid != null && grid > 1) {
            val gd = grid.toDouble()
            return LabelSnap(dx = swiftRounded(box.x / gd) * gd - box.x, dy = swiftRounded(box.y / gd) * gd - box.y)
        }
        val xs = arrayListOf(label.x, label.midX, label.maxX)
        val ys = arrayListOf(label.y, label.midY, label.maxY)
        for (o in others) { xs += listOf(o.x, o.midX, o.maxX); ys += listOf(o.y, o.midY, o.maxY) }
        var bestX = threshold + 1
        var bestY = threshold + 1
        var dx = 0.0
        var dy = 0.0
        var guideX: Double? = null
        var guideY: Double? = null
        for (mine in listOf(box.x, box.midX, box.maxX)) {
            for (t in xs) if (Math.abs(t - mine) < bestX && Math.abs(t - mine) <= threshold) {
                bestX = Math.abs(t - mine); dx = t - mine; guideX = t
            }
        }
        for (mine in listOf(box.y, box.midY, box.maxY)) {
            for (t in ys) if (Math.abs(t - mine) < bestY && Math.abs(t - mine) <= threshold) {
                bestY = Math.abs(t - mine); dy = t - mine; guideY = t
            }
        }
        return LabelSnap(dx, dy, guideX, guideY)
    }

    /** A value held to the grid (a size or a typed number); no grid leaves it. */
    fun snapped(v: Int, grid: Int?): Int {
        if (grid == null || grid <= 1) return v
        return swiftRounded(v.toDouble() / grid.toDouble()).toInt() * grid
    }

    // MARK: Pictures

    /** A bitmap (1 bit a pixel, base64) scaled to another size by nearest dots; null when it cannot be read. */
    fun resampledBitmap(bitmap: String, fromWidth: Int, fromHeight: Int, toWidth: Int, toHeight: Int): String? {
        val fw = fromWidth
        val fh = fromHeight
        val tw = toWidth
        val th = toHeight
        if (fw <= 0 || fh <= 0 || tw <= 0 || th <= 0) return null
        val src = LabelBitmap.bytes(bitmap, fw, fh) ?: return null
        val sb = LabelBitmap.bytesPerRow(fw)
        val tb = LabelBitmap.bytesPerRow(tw)
        val out = IntArray(tb * th)
        for (y in 0 until th) {
            val sy = minOf(fh - 1, y * fh / th)
            for (x in 0 until tw) {
                val sx = minOf(fw - 1, x * fw / tw)
                if ((src[sy * sb + (sx shr 3)] shr (7 - (sx and 7))) and 1 == 1) out[y * tb + (x shr 3)] = out[y * tb + (x shr 3)] or (0x80 shr (x and 7))
            }
        }
        return LabelBitmap.base64Encode(out)
    }

    /** The pixels of a bitmap, row by row, true where black. */
    fun pixels(bitmap: String, width: Int, height: Int): BooleanArray? {
        if (width <= 0 || height <= 0) return null
        val src = LabelBitmap.bytes(bitmap, width, height) ?: return null
        val bpr = LabelBitmap.bytesPerRow(width)
        val out = BooleanArray(width * height)
        for (y in 0 until height) for (x in 0 until width) out[y * width + x] = (src[y * bpr + (x shr 3)] shr (7 - (x and 7))) and 1 == 1
        return out
    }
}

/**
 * A simple stack of layouts. A run of the same kind of change (a drag, a nudge, typing in one box) within a second of the
 * last is one step.
 */
class LabelHistory {
    private val pastList = ArrayList<LabelLayout>()
    private val futureList = ArrayList<LabelLayout>()
    private var lastKey: String? = null
    private var lastAtMs: Long? = null

    val past: List<LabelLayout> get() = pastList
    val future: List<LabelLayout> get() = futureList

    val canUndo: Boolean get() = pastList.isNotEmpty()
    val canRedo: Boolean get() = futureList.isNotEmpty()

    /** Note that `before` is about to change. */
    fun record(before: LabelLayout, key: String? = null, now: Instant = Instant.now()) {
        val at = lastAtMs
        val ms = now.toEpochMilli()
        if (key != null && key == lastKey && at != null && ms - at < 1000 && pastList.isNotEmpty()) {
            lastAtMs = ms
            futureList.clear()
            return
        }
        pastList.add(before)
        if (pastList.size > limit) while (pastList.size > limit) pastList.removeAt(0)
        futureList.clear()
        lastKey = key
        lastAtMs = ms
    }

    fun undo(current: LabelLayout): LabelLayout? {
        val previous = pastList.removeLastOrNull() ?: return null
        futureList.add(current)
        lastKey = null
        return previous
    }

    fun redo(current: LabelLayout): LabelLayout? {
        val next = futureList.removeLastOrNull() ?: return null
        pastList.add(current)
        lastKey = null
        return next
    }

    fun clear() {
        pastList.clear(); futureList.clear(); lastKey = null
    }

    companion object {
        const val limit = 100
    }
}
