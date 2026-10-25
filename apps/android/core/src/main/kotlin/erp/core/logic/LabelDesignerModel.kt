package erp.core.logic

import erp.core.models.LabelFieldType
import erp.core.models.LabelLayout
import erp.core.models.LabelLayoutField
import erp.core.models.Product
import erp.core.models.Settings
import java.time.Instant

// The tag designer's state and every change it makes (the iPhone's LabelDesignerModel.swift, which is @Observable; here the
// screen watches `revision`). The arithmetic is LabelEditing's and LabelGeometry's, tested; this holds the layout being
// edited, the selection, the undo stack, the view's zoom and the piece the preview is filled from. Every change goes through
// `edit`, which records undo, marks the layout changed and tells the screen to save it a second later.

class LabelDesignerModel(layout: LabelLayout, val measure: LabelMeasure) {
    var layout: LabelLayout = layout
        private set
    var selection: Set<String> = emptySet()
        private set
    val history = LabelHistory()

    /** Staff read the tag; only owners change it. */
    var readOnly = false
    var edited = false

    /** Counts every change of anything the screen shows: a Compose screen reads it to redraw. */
    var revision = 0
        private set

    // The view
    var gridOn = false

    /** Dots: 8 is a millimetre at 203 dpi. */
    var gridDots = 8
    var showRulers = true

    /** Pixels a dot; null fits the label to the window. */
    var zoom: Double? = null
        private set
    var panX = 0.0
        private set
    var panY = 0.0
        private set

    /** A drag on the background pans (instead of drawing a marquee). */
    var panMode = false

    /** Taps add to the selection (a keyboard uses shift). */
    var multiSelect = false

    var stageW = 0.0
    var stageH = 0.0

    /** Pixels of room kept round the label when it is fitted to the window (the screen sets it from its rulers). */
    var stageMargin = 44.0

    // The preview
    var previewValues: List<LabelValues> = emptyList()
    var previewNames: List<String> = emptyList()
    var previewNow: Instant = Instant.now()

    /** The pieces chosen for the preview (one a tag), and the number a `{counter}` starts at. */
    var previewProducts: List<Product> = emptyList()
    var previewCounter: Int? = null

    var onChange: ((LabelLayout) -> Unit)? = null

    /** Told after anything the screen shows has changed (the screen bumps its own observable state). */
    var onRevision: (() -> Unit)? = null

    private fun touched() { revision += 1; onRevision?.invoke() }

    /** A change of what is shown that is not a change of the tag (the view, the preview piece). */
    fun redraw() = touched()

    // MARK: Reading

    /** The values the preview fills the tag from: the chosen pieces, else made-up ones. */
    val pieces: List<LabelValues>
        get() = if (previewValues.isEmpty()) (1..layout.tagsPerLabel).map { LabelPlaceholders.sampleValues(it) } else previewValues

    /** The fields with their text filled, as they print: what the canvas draws and measures. */
    val resolved: List<LabelLayoutField>
        get() = Zpl.resolveFields(layout, pieces, 0, previewNow, previewCounter)

    /** Choose the pieces the preview is filled from (none: made-up values). */
    fun setPreview(products: List<Product>, settings: Settings?) {
        previewProducts = products.take(layout.tagsPerLabel)
        if (settings != null && previewProducts.isNotEmpty()) {
            previewValues = TagPrint.values(previewProducts, settings)
            previewNames = previewProducts.map { it.name }
        } else {
            previewValues = emptyList()
            previewNames = emptyList()
        }
        touched()
    }

    val selectedFields: List<LabelLayoutField> get() = layout.fields.filter { selection.contains(it.id) }
    val primary: LabelLayoutField? get() = selectedFields.lastOrNull()
    val canEditSelection: Boolean get() = !readOnly && selection.isNotEmpty()
    val canUndo: Boolean get() = !readOnly && history.canUndo
    val canRedo: Boolean get() = !readOnly && history.canRedo

    fun resolvedField(id: String): LabelLayoutField? = resolved.firstOrNull { it.id == id }

    val labelBox: LabelBox get() = LabelBox(0.0, 0.0, layout.widthDots.toDouble(), layout.heightDots.toDouble())

    fun effectiveZoom(): Double {
        zoom?.let { return it }
        val m = stageMargin
        val w = maxOf(1.0, layout.widthDots.toDouble())
        val h = maxOf(1.0, layout.heightDots.toDouble())
        return maxOf(0.05, minOf((stageW - 2 * m) / w, (stageH - 2 * m) / h))
    }

    // MARK: Changing

    /**
     * One change to the layout: undoable, drawn at once, saved a second later. A run of changes with the same `key` within a
     * second (a drag, a nudge, typing) is one undo step.
     */
    fun edit(key: String? = null, now: Instant = Instant.now(), change: (LabelLayout) -> LabelLayout) {
        if (readOnly) return
        val next = change(layout)
        if (next == layout) return
        history.record(layout, key, now)
        layout = next
        edited = true
        touched()
        onChange?.invoke(next)
    }

    private fun editFields(key: String? = null, change: (List<LabelLayoutField>) -> List<LabelLayoutField>) =
        edit(key) { it.copy(fields = change(it.fields)) }

    /**
     * An arithmetic change (move, resize, turn, align): done on the filled fields, so what is measured is what is drawn, then
     * written back with each field's own text.
     */
    fun geometryEdit(key: String? = null, op: (List<LabelLayoutField>) -> List<LabelLayoutField>) {
        val out = op(resolved).associateBy { it.id }
        edit(key) { l ->
            l.copy(fields = l.fields.map { f -> out[f.id]?.copy(data = f.data) ?: f })
        }
    }

    /** A layout from the books (another device, the printer screen): no undo step, and the selection kept where it can be. */
    fun adopt(l: LabelLayout) {
        layout = l
        edited = false
        selection = selection.filter { id -> l.fields.any { it.id == id } }.toSet()
        touched()
    }

    fun undo() {
        if (readOnly) return
        val previous = history.undo(layout) ?: return
        layout = previous
        edited = true
        selection = selection.filter { id -> previous.fields.any { it.id == id } }.toSet()
        touched()
        onChange?.invoke(previous)
    }

    fun redo() {
        if (readOnly) return
        val next = history.redo(layout) ?: return
        layout = next
        edited = true
        selection = selection.filter { id -> next.fields.any { it.id == id } }.toSet()
        touched()
        onChange?.invoke(next)
    }

    fun resetHistory() = history.clear()

    /** The printer options from the latest copy of the shop's tag (the Printer screen's), taken without an undo step. */
    fun adoptPrinter(printer: erp.core.models.LabelPrinterSettings?) {
        if (layout.printer == printer) return
        layout = layout.copy(printer = printer)
        touched()
    }

    // MARK: Selecting

    fun select(ids: Set<String>) { selection = ids; touched() }
    fun selectAll() = select(layout.fields.map { it.id }.toSet())
    fun clearSelection() = select(emptySet())

    fun toggleSelected(id: String) = select(if (selection.contains(id)) selection - id else selection + id)

    // MARK: Adding and removing

    fun add(kind: LabelNewKind, now: Instant = Instant.now()) {
        val f = LabelEditing.make(kind, layout, measure, now)
        edit { it.copy(fields = it.fields + f) }
        select(setOf(f.id))
    }

    fun addPicture(f: LabelLayoutField) {
        edit { it.copy(fields = it.fields + f) }
        select(setOf(f.id))
    }

    fun deleteSelection() {
        val ids = selection
        editFields { LabelEditing.removed(it, ids) }
        select(selection.filter { id -> layout.fields.any { it.id == id } }.toSet())
    }

    fun duplicateSelection(now: Instant = Instant.now()) {
        if (!canEditSelection) return
        var made: List<String> = emptyList()
        edit { l ->
            val r = LabelEditing.duplicated(l.fields, selection, now = now)
            made = r.ids
            l.copy(fields = r.fields)
        }
        if (made.isNotEmpty()) select(made.toSet())
    }

    /** The selection as the text a clipboard holds (null for none). */
    fun copyText(): String? = LabelEditing.clipboardText(selectedFields)

    fun canPaste(clipboard: String?): Boolean = !readOnly && LabelEditing.fields(clipboard).isNotEmpty()

    fun paste(clipboard: String?, now: Instant = Instant.now()) {
        val copies = LabelEditing.fields(clipboard)
        if (copies.isEmpty() || readOnly) return
        var made: List<String> = emptyList()
        edit { l ->
            val r = LabelEditing.inserting(copies, l.fields, now = now)
            made = r.ids
            l.copy(fields = r.fields)
        }
        select(made.toSet())
    }

    // MARK: Moving, turning, arranging

    /** Arrow keys and the nudge buttons: whole dots. */
    fun nudge(dx: Int, dy: Int) {
        if (!canEditSelection) return
        val ids = selection
        editFields("nudge") { LabelEditing.moved(it, ids, dx, dy) }
    }

    /** A drag's position: every dragged field at its start plus the offset. */
    fun place(origins: Map<String, Pair<Int, Int>>, dx: Int, dy: Int, key: String) {
        editFields(key) { LabelEditing.placed(it, origins, dx, dy) }
    }

    /** A handle's drag: the field as it was when the drag began, resized to the box. */
    fun resize(start: LabelLayoutField, handle: LabelHandle, box: LabelBox, key: String) {
        val one = LabelLayout(id = "", name = "", widthDots = 1, heightDots = 1, fields = listOf(start))
        val startResolved = Zpl.resolveFields(one, pieces, 0, previewNow, previewCounter)[0]
        var out = LabelEditing.resized(startResolved, handle, box, measure).copy(data = start.data)
        val bmp = start.bitmap
        val ow = start.width
        val oh = start.height
        val nw = out.width
        val nh = out.height
        if (start.type == LabelFieldType.image && bmp != null && ow != null && oh != null && nw != null && nh != null) {
            out = out.copy(bitmap = LabelEditing.resampledBitmap(bmp, ow, oh, nw, nh) ?: bmp)
        }
        edit(key) { l -> l.copy(fields = l.fields.map { if (it.id == start.id) out else it }) }
    }

    fun rotateSelection(degrees: Int = 90) {
        if (!canEditSelection) return
        val ids = selection
        geometryEdit { fields -> fields.map { if (ids.contains(it.id)) LabelEditing.rotated(it, degrees, measure) else it } }
    }

    fun align(edge: LabelAlign) {
        if (!canEditSelection) return
        val ids = selection
        val within: LabelBox? = if (ids.size == 1) labelBox else null
        geometryEdit { LabelEditing.aligned(it, ids, edge, within, measure) }
    }

    fun distribute(axis: LabelAxis) {
        if (selection.size < 3) return
        val ids = selection
        geometryEdit { LabelEditing.distributed(it, ids, axis, measure) }
    }

    fun order(o: LabelOrder) {
        if (!canEditSelection) return
        val ids = selection
        editFields { LabelEditing.reordered(it, ids, o) }
    }

    fun moveLayers(from: Set<Int>, to: Int) = editFields { LabelEditing.reorderedByLayerList(it, from, to) }

    fun setHidden(id: String, v: Boolean) = editFields { fs -> fs.map { if (it.id == id) it.copy(hidden = v) else it } }
    fun setLocked(id: String, v: Boolean) = editFields { fs -> fs.map { if (it.id == id) it.copy(locked = v) else it } }

    // MARK: What the inspector changes

    /**
     * A property of the selected fields of the same kind as the last one picked (a run of changes to one property is one undo
     * step).
     */
    fun setProperty(key: String, change: (LabelLayoutField) -> LabelLayoutField) {
        val type = primary?.type ?: return
        val ids = selection
        editFields("prop-$key-${ids.sorted().joinToString(",")}") { fs ->
            fs.map { if (ids.contains(it.id) && it.type == type) change(it) else it }
        }
    }

    /** The field's box on the label (x, y, w, h in dots), read from the filled field. */
    fun boxOfPrimary(): LabelBox? {
        val id = primary?.id ?: return null
        val f = resolvedField(id) ?: return null
        return LabelGeometry.bounds(f, measure)
    }

    fun setX(v: Int) = setCorner(v, null)
    fun setY(v: Int) = setCorner(null, v)

    private fun setCorner(x: Int?, y: Int?) {
        val ids = selection
        editFields("pos-${ids.sorted().joinToString(",")}") { fs ->
            fs.map { f -> if (ids.contains(f.id) && !f.locked) f.copy(x = x ?: f.x, y = y ?: f.y) else f }
        }
    }

    /**
     * Width or height typed in dots: a text's block width, a QR's magnification, a bar code's modules and height, a shape's
     * size (the handle that would change it).
     */
    fun setBoxSize(w: Int? = null, h: Int? = null) {
        val id = primary?.id ?: return
        val f = layout.fields.firstOrNull { it.id == id } ?: return
        val b = boxOfPrimary() ?: return
        val nb = LabelBox(b.x, b.y, (w ?: Math.round(b.w).toInt()).toDouble(), (h ?: Math.round(b.h).toInt()).toDouble())
        resize(f, if (w != null && h != null) LabelHandle.bottomRight else if (w != null) LabelHandle.right else LabelHandle.bottom, nb, "size-$id")
    }

    // MARK: Zoom

    fun currentZoom(): Double = effectiveZoom()

    /** Zoom to `z` pixels a dot, keeping the point (px, py) of the view (the middle if none) over the same dot. */
    fun setZoom(z: Double, aroundX: Double? = null, aroundY: Double? = null) {
        val old = currentZoom()
        val nz = minOf(16.0, maxOf(0.1, z))
        val w = layout.widthDots.toDouble()
        val h = layout.heightDots.toDouble()
        val cx = aroundX ?: (stageW / 2)
        val cy = aroundY ?: (stageH / 2)
        val ox = (stageW - w * old) / 2 + panX
        val oy = (stageH - h * old) / 2 + panY
        val dx = (cx - ox) / old
        val dy = (cy - oy) / old
        zoom = nz
        panX = cx - dx * nz - (stageW - w * nz) / 2
        panY = cy - dy * nz - (stageH - h * nz) / 2
        touched()
    }

    fun panTo(x: Double, y: Double) { panX = x; panY = y; touched() }

    fun zoomIn() = setZoom(currentZoom() * 1.25)
    fun zoomOut() = setZoom(currentZoom() / 1.25)
    fun zoomFit() { zoom = null; panX = 0.0; panY = 0.0; touched() }
    fun zoomPercent(pct: Int) = setZoom(pct / 100.0)
    val zoomText: String get() = "${Math.round(currentZoom() * 100)}%"
}
