package erp.app.screens.settings.label

import android.graphics.Paint
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import erp.app.ui.theme.ErpColors
import erp.core.logic.LabelBox
import erp.core.logic.LabelEditing
import erp.core.logic.LabelGeometry
import erp.core.logic.LabelHandle
import erp.core.logic.LabelUnits
import erp.core.models.LabelLayoutField
import kotlin.math.hypot
import kotlin.math.max

// The designer's canvas: the label at its true proportions, every field drawn as it prints, with rulers in millimetres, an
// optional grid, and the editing gestures (the iPhone's LabelCanvas.swift).
//
// - A touch selects; with "Select several" on, touches add. A drag on a field moves the selection and snaps to the grid, or
//   to the label's and the other fields' edges and centres. A drag on the background draws a marquee (in "Move the view"
//   mode it pans). The handles resize the one selected field.
// - Two fingers pinch to zoom and drag to pan. A hardware keyboard nudges with the arrows (shift: ten), removes with Delete,
//   selects all with Ctrl-A, undoes with Ctrl-Z.
// - Everything that changes the layout goes through `LabelDesignerModel`.

private sealed interface Drag {
    class Pan(val startX: Double, val startY: Double) : Drag
    class Move(val origins: Map<String, Pair<Int, Int>>, val start: LabelBox, val key: String, val others: List<LabelBox>, val clicked: String, val shift: Boolean, var moved: Boolean) : Drag
    class Resize(val start: LabelLayoutField, val handle: LabelHandle, val box: LabelBox, val key: String) : Drag
    class Marquee(val fromX: Double, val fromY: Double, val additive: Boolean, val base: Set<String>) : Drag
    data object Toggle : Drag
}

private const val RULER_DP = 18f

@Composable
fun LabelCanvas(state: DesignerState, modifier: Modifier = Modifier, requestDelete: () -> Unit = {}) {
    val model = state.model
    val density = LocalDensity.current.density
    val accent = ErpColors.accent
    val ground = MaterialTheme.colorScheme.background
    val ink = MaterialTheme.colorScheme.onSurface
    var marquee by remember { mutableStateOf<LabelBox?>(null) }
    var guideX by remember { mutableStateOf<Double?>(null) }
    var guideY by remember { mutableStateOf<Double?>(null) }
    val focus = remember { FocusRequester() }
    val handleSize = 10f * density
    val handleReach = 18f * density
    val ruler = RULER_DP * density

    /** The zoom and the label's corner on the stage, as they are right now. */
    fun view(): Triple<Double, Double, Double> {
        val z = model.effectiveZoom()
        return Triple(z, (model.stageW - model.layout.widthDots * z) / 2 + model.panX, (model.stageH - model.layout.heightDots * z) / 2 + model.panY)
    }

    fun handlePoints(r: Rect): List<Pair<LabelHandle, Offset>> = listOf(
        LabelHandle.topLeft to Offset(r.left, r.top), LabelHandle.top to Offset(r.center.x, r.top), LabelHandle.topRight to Offset(r.right, r.top),
        LabelHandle.right to Offset(r.right, r.center.y), LabelHandle.bottomRight to Offset(r.right, r.bottom), LabelHandle.bottom to Offset(r.center.x, r.bottom),
        LabelHandle.bottomLeft to Offset(r.left, r.bottom), LabelHandle.left to Offset(r.left, r.center.y),
    )

    fun stageRect(b: LabelBox, z: Double, ox: Double, oy: Double) =
        Rect(Offset((ox + b.x * z).toFloat(), (oy + b.y * z).toFloat()), Size((b.w * z).toFloat(), (b.h * z).toFloat()))

    Box(
        modifier
            .fillMaxSize()
            .clipToBounds()
            .onSizeChanged {
                model.stageW = it.width.toDouble(); model.stageH = it.height.toDouble()
                model.stageMargin = (ruler + 16 * density).toDouble()
                model.redraw()
            }
            .focusRequester(focus)
            .focusable()
            .onKeyEvent { e ->
                if (e.type != KeyEventType.KeyDown) return@onKeyEvent false
                val big = if (e.isShiftPressed) 10 else 1
                when (e.key) {
                    Key.DirectionLeft -> { model.nudge(-big, 0); true }
                    Key.DirectionRight -> { model.nudge(big, 0); true }
                    Key.DirectionUp -> { model.nudge(0, -big); true }
                    Key.DirectionDown -> { model.nudge(0, big); true }
                    Key.Delete, Key.Backspace -> if (model.canEditSelection) { requestDelete(); true } else false
                    Key.Escape -> { model.clearSelection(); true }
                    Key.A -> if (e.isCtrlPressed) { model.selectAll(); true } else false
                    Key.Z -> if (e.isCtrlPressed) { if (e.isShiftPressed) model.redo() else model.undo(); true } else false
                    else -> false
                }
            }
            .semantics { contentDescription = "Tag canvas" }
            .pointerInput(model) {
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    focus.requestFocus()
                    var drag: Drag? = null
                    val startX = down.position.x.toDouble()
                    val startY = down.position.y.toDouble()

                    fun begin() {
                        val (z, ox, oy) = view()
                        val fields = model.resolved
                        val shift = model.multiSelect
                        if (model.panMode) { drag = Drag.Pan(model.panX, model.panY); return }
                        val measure = model.measure
                        // A handle of the one selected field.
                        if (!model.readOnly && model.selection.size == 1) {
                            val f = fields.firstOrNull { model.selection.contains(it.id) }
                            val original = f?.let { r -> model.layout.fields.firstOrNull { it.id == r.id } }
                            if (f != null && !f.locked && original != null) {
                                val r = stageRect(LabelGeometry.bounds(f, measure), z, ox, oy)
                                val hit = handlePoints(r).firstOrNull { hypot(it.second.x - startX, it.second.y - startY) <= handleReach }
                                if (hit != null) {
                                    drag = Drag.Resize(original, hit.first, LabelGeometry.bounds(f, measure), "resize-${System.nanoTime()}")
                                    return
                                }
                            }
                        }
                        val dx = (startX - ox) / z
                        val dy = (startY - oy) / z
                        val slop = 5 * density / z
                        val top = fields.asReversed().firstOrNull { LabelGeometry.bounds(it, measure).inset(-slop).contains(dx, dy) }
                        if (top != null) {
                            if (shift) { model.toggleSelected(top.id); drag = Drag.Toggle; return }
                            if (!model.selection.contains(top.id)) model.select(setOf(top.id))
                            val movers = fields.filter { model.selection.contains(it.id) && !it.locked }
                            val origins = movers.associate { it.id to (it.x to it.y) }
                            val start = LabelGeometry.union(movers, measure) ?: LabelGeometry.bounds(top, measure)
                            val others = fields.filter { !model.selection.contains(it.id) && !it.hidden }.map { LabelGeometry.bounds(it, measure) }
                            drag = Drag.Move(origins, start, "drag-${System.nanoTime()}", others, top.id, shift, false)
                        } else {
                            val base = if (shift) model.selection else emptySet()
                            if (!shift) model.clearSelection()
                            drag = Drag.Marquee(dx, dy, shift, base)
                        }
                    }

                    fun update(px: Double, py: Double) {
                        val (z, ox, oy) = view()
                        when (val d = drag) {
                            null, Drag.Toggle -> {}
                            is Drag.Pan -> model.panTo(d.startX + (px - startX), d.startY + (py - startY))
                            is Drag.Move -> {
                                val tx = px - startX
                                val ty = py - startY
                                if (!d.moved && hypot(tx, ty) < 3 * density) return
                                val dx = tx / z
                                val dy = ty / z
                                val snap = LabelEditing.snap(d.start.offset(dx, dy), d.others, model.labelBox, if (model.gridOn) model.gridDots else null, 6 * density / z)
                                guideX = snap.guideX; guideY = snap.guideY
                                model.place(d.origins, Math.round(dx + snap.dx).toInt(), Math.round(dy + snap.dy).toInt(), d.key)
                                d.moved = true
                            }
                            is Drag.Resize -> {
                                var x = (px - ox) / z
                                var y = (py - oy) / z
                                if (model.gridOn && model.gridDots > 1) {
                                    val g = model.gridDots.toDouble()
                                    x = Math.round(x / g) * g; y = Math.round(y / g) * g
                                }
                                model.resize(d.start, d.handle, d.handle.dragged(d.box, x, y), d.key)
                            }
                            is Drag.Marquee -> {
                                val box = LabelBox.between(d.fromX, d.fromY, (px - ox) / z, (py - oy) / z)
                                marquee = box
                                val hit = model.resolved.filter { LabelGeometry.bounds(it, model.measure).intersects(box) }.map { it.id }.toSet()
                                model.select(if (d.additive) d.base + hit else hit)
                            }
                        }
                    }

                    begin()
                    var pinching = false
                    var lastCx = 0f
                    var lastCy = 0f
                    var lastSpan = 0f
                    while (true) {
                        val event = awaitPointerEvent()
                        val pressed = event.changes.filter { it.pressed }
                        if (pressed.isEmpty()) break
                        if (pressed.size >= 2) {
                            val a = pressed[0].position
                            val b = pressed[1].position
                            val cx = (a.x + b.x) / 2
                            val cy = (a.y + b.y) / 2
                            val span = hypot(a.x - b.x, a.y - b.y)
                            if (!pinching) {
                                // A second finger turns the touch into a pinch: whatever the first began is let go.
                                pinching = true
                                drag = null; marquee = null; guideX = null; guideY = null
                            } else if (lastSpan > 0f) {
                                model.setZoom(model.currentZoom() * (span / lastSpan), cx.toDouble(), cy.toDouble())
                                model.panTo(model.panX + (cx - lastCx), model.panY + (cy - lastCy))
                            }
                            lastCx = cx; lastCy = cy; lastSpan = span
                            event.changes.forEach { it.consume() }
                        } else if (!pinching) {
                            val c = pressed[0]
                            update(c.position.x.toDouble(), c.position.y.toDouble())
                            c.consume()
                        }
                    }
                    // A click on one of several selected fields picks just that one.
                    val d = drag
                    if (d is Drag.Move && !d.moved && !d.shift) model.select(setOf(d.clicked))
                    marquee = null; guideX = null; guideY = null
                }
            },
    ) {
        Canvas(Modifier.fillMaxSize()) {
            state.rev // the canvas is drawn again whenever the model says anything changed
            marquee; guideX; guideY
            val (z, ox, oy) = view()
            val layout = model.layout
            val w = layout.widthDots.toDouble()
            val h = layout.heightDots.toDouble()
            val fields = model.resolved
            val measure = model.measure
            drawRect(ground)
            drawRect(ink.copy(alpha = 0.05f))
            // The paper, with a shadow.
            val paperTop = Offset(ox.toFloat(), oy.toFloat())
            val paperSize = Size((w * z).toFloat(), (h * z).toFloat())
            drawRect(Color.Black.copy(alpha = 0.16f), paperTop + Offset(0f, 2f * density), paperSize)
            drawRect(Color.White, paperTop, paperSize)
            clipRect(paperTop.x, paperTop.y, paperTop.x + paperSize.width, paperTop.y + paperSize.height) {
                if (model.gridOn) {
                    val step = (max(1, model.gridDots) * z).toFloat()
                    if (step >= 4 * density) {
                        var x = paperTop.x
                        while (x <= paperTop.x + paperSize.width) { drawLine(Color.Blue.copy(alpha = 0.18f), Offset(x, paperTop.y), Offset(x, paperTop.y + paperSize.height), 0.5f * density); x += step }
                        var y = paperTop.y
                        while (y <= paperTop.y + paperSize.height) { drawLine(Color.Blue.copy(alpha = 0.18f), Offset(paperTop.x, y), Offset(paperTop.x + paperSize.width, y), 0.5f * density); y += step }
                    }
                }
                for (f in fields) drawLabelField(f, z.toFloat(), paperTop, faint = f.hidden)
            }

            // Selection boxes, handles, snap guides and the marquee.
            val selected = fields.filter { model.selection.contains(it.id) }
            val boxes = fields.map { it to LabelGeometry.bounds(it, measure) }
            val dash = PathEffect.dashPathEffect(floatArrayOf(3f * density, 3f * density))
            for ((f, b) in boxes) if (f.hidden || (f.type == erp.core.models.LabelFieldType.text && (f.data ?: "").isEmpty())) {
                drawRect(Color.Gray.copy(alpha = 0.6f), stageRect(b, z, ox, oy).topLeft, stageRect(b, z, ox, oy).size, style = Stroke(density, pathEffect = dash))
            }
            for ((f, b) in boxes) if (model.selection.contains(f.id)) {
                val r = stageRect(b, z, ox, oy)
                drawRect(
                    if (f.locked) Color(0xFFFF9500) else accent, r.topLeft, r.size,
                    style = Stroke(1.5f * density, pathEffect = if (f.locked) PathEffect.dashPathEffect(floatArrayOf(4f * density, 3f * density)) else null),
                )
            }
            if (selected.size > 1) {
                LabelGeometry.union(selected, measure)?.let { u ->
                    val r = stageRect(u, z, ox, oy)
                    drawRect(accent.copy(alpha = 0.7f), r.topLeft - Offset(3f * density, 3f * density), Size(r.width + 6f * density, r.height + 6f * density),
                        style = Stroke(density, pathEffect = PathEffect.dashPathEffect(floatArrayOf(5f * density, 3f * density))))
                }
            }
            val single = if (selected.size == 1 && !model.readOnly) selected.first() else null
            if (single != null && !single.locked) {
                val r = stageRect(LabelGeometry.bounds(single, measure), z, ox, oy)
                for ((_, p) in handlePoints(r)) {
                    val tl = Offset(p.x - handleSize / 2, p.y - handleSize / 2)
                    drawRoundRect(Color.White, tl, Size(handleSize, handleSize), CornerRadius(2f * density))
                    drawRoundRect(accent, tl, Size(handleSize, handleSize), CornerRadius(2f * density), style = Stroke(1.5f * density))
                }
            }
            guideX?.let { gx ->
                val x = (ox + gx * z).toFloat()
                drawLine(Color(0xFFFF2D55), Offset(x, (oy - 6 * density).toFloat()), Offset(x, (oy + h * z + 6 * density).toFloat()), density)
            }
            guideY?.let { gy ->
                val y = (oy + gy * z).toFloat()
                drawLine(Color(0xFFFF2D55), Offset((ox - 6 * density).toFloat(), y), Offset((ox + w * z + 6 * density).toFloat(), y), density)
            }
            marquee?.let { m ->
                val r = stageRect(m, z, ox, oy)
                drawRect(accent.copy(alpha = 0.12f), r.topLeft, r.size)
                drawRect(accent, r.topLeft, r.size, style = Stroke(density))
            }
            if (model.showRulers) drawRulers(model.layout.dpi, w, h, z, ox, oy, ruler, density, ink, accent, LabelGeometry.union(selected, measure))
        }
    }
}

/** Rulers in millimetres along the top and the left, with the selection lit on both. */
private fun DrawScope.drawRulers(dpi: Int?, w: Double, h: Double, z: Double, ox: Double, oy: Double, r: Float, density: Float, ink: Color, accent: Color, selection: LabelBox?) {
    val perMM = (LabelUnits.dotsPerMM(dpi) * z).toFloat()
    val wMM = Math.ceil(w / LabelUnits.dotsPerMM(dpi)).toInt()
    val hMM = Math.ceil(h / LabelUnits.dotsPerMM(dpi)).toInt()
    val labelStep = listOf(1, 2, 5, 10, 20, 50, 100).firstOrNull { perMM * it >= 28 * density } ?: 100
    val back = ink.copy(alpha = 0.1f)
    drawRect(back, Offset.Zero, Size(size.width, r))
    drawRect(back, Offset.Zero, Size(r, size.height))
    if (selection != null) {
        val tint = accent.copy(alpha = 0.35f)
        val x0 = (ox + selection.x * z).toFloat()
        val x1 = (ox + selection.maxX * z).toFloat()
        val y0 = (oy + selection.y * z).toFloat()
        val y1 = (oy + selection.maxY * z).toFloat()
        drawRect(tint, Offset(x0, 0f), Size(max(1f, x1 - x0), r))
        drawRect(tint, Offset(0f, y0), Size(r, max(1f, y1 - y0)))
    }
    val line = ink.copy(alpha = 0.6f)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 8f * density; color = line.toArgb() }
    for (mm in 0..max(0, wMM)) {
        val x = (ox + mm * perMM).toFloat()
        if (x <= r || x >= size.width) continue
        if (perMM < 4 * density && mm % labelStep != 0) continue
        val len = (if (mm % 10 == 0) 9 else if (mm % 5 == 0) 6 else 3) * density
        drawLine(line, Offset(x, r), Offset(x, r - len), 0.5f * density)
        if (mm % labelStep == 0) drawIntoCanvas { it.nativeCanvas.drawText("$mm", x + 2 * density, 1 * density + paint.textSize, paint) }
    }
    for (mm in 0..max(0, hMM)) {
        val y = (oy + mm * perMM).toFloat()
        if (y <= r || y >= size.height) continue
        if (perMM < 4 * density && mm % labelStep != 0) continue
        val len = (if (mm % 10 == 0) 9 else if (mm % 5 == 0) 6 else 3) * density
        drawLine(line, Offset(r, y), Offset(r - len, y), 0.5f * density)
        if (mm % labelStep == 0) drawIntoCanvas { it.nativeCanvas.drawText("$mm", 1 * density, y + 2 * density + paint.textSize, paint) }
    }
}
