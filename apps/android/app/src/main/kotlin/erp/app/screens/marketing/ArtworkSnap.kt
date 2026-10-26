package erp.app.screens.marketing

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import erp.app.config.Prefs
import erp.app.ui.FilterChip
import erp.app.ui.PickerRow
import erp.app.ui.ToggleRow
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.theme.ErpColors
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

// Designer v2 snapping, guides, the grid and "match the first one picked" (ArtworkSnap.swift; src/lib/social/design.ts snapLines /
// snapBox, guides.ts, panels/guides.tsx, position.tsx). Guides and the grid belong to the document (`meta.guides.x / y`, `meta.grid`),
// so they are saved with it and snap on the web too; whether snapping is on belongs to this device. Equal-spacing chips (spacingSnap)
// are not drawn natively.

class ArtworkBox(val x: Double, val y: Double, val w: Double, val h: Double) {
    constructor(v: MarketingValue) : this(v.n("x"), v.n("y"), v.n("w"), v.n("h"))

    companion object {
        fun union(boxes: List<ArtworkBox>): ArtworkBox? {
            if (boxes.isEmpty()) return null
            val x0 = boxes.minOf { it.x }
            val y0 = boxes.minOf { it.y }
            val x1 = boxes.maxOf { it.x + it.w }
            val y1 = boxes.maxOf { it.y + it.h }
            return ArtworkBox(x0, y0, x1 - x0, y1 - y0)
        }
    }
}

object ArtworkSnap {
    class Lines(val xs: List<Double>, val ys: List<Double>)

    /** The nudge a drag takes, and the lines it snapped to (`v` is the vertical line's x, `h` the horizontal line's y). */
    class Nudge(val dx: Double = 0.0, val dy: Double = 0.0, val v: Double? = null, val h: Double? = null)

    /** snapLines: the page's centre and margins, the edges and centres of everything else, a grid, the user's guides. */
    fun lines(width: Double, height: Double, margin: Double, others: List<ArtworkBox>, grid: Double, guideX: List<Double>, guideY: List<Double>): Lines {
        val xs = arrayListOf(width / 2, margin, width - margin)
        val ys = arrayListOf(height / 2, margin, height - margin)
        for (b in others) { xs += listOf(b.x, b.x + b.w / 2, b.x + b.w); ys += listOf(b.y, b.y + b.h / 2, b.y + b.h) }
        if (grid >= 4) {
            var x = grid
            while (x < width && xs.size < 600) { xs.add(x); x += grid }
            var y = grid
            while (y < height && ys.size < 600) { ys.add(y); y += grid }
        }
        xs += guideX
        ys += guideY
        return Lines(xs, ys)
    }

    /** snapBox: the nudge that brings the nearest of a box's edges or centre onto a line within [threshold], per axis. */
    fun snap(b: ArtworkBox, lines: Lines, threshold: Double): Nudge {
        fun best(edges: List<Double>, targets: List<Double>): Pair<Double, Double?> {
            var d = Double.POSITIVE_INFINITY
            var at: Double? = null
            for (e in edges) for (t in targets) if (abs(t - e) < abs(d) && abs(t - e) <= threshold) { d = t - e; at = t }
            return (if (at == null) 0.0 else d) to at
        }
        val x = best(listOf(b.x, b.x + b.w / 2, b.x + b.w), lines.xs)
        val y = best(listOf(b.y, b.y + b.h / 2, b.y + b.h), lines.ys)
        return Nudge(x.first, y.first, x.second, y.second)
    }

    /** The page's margin for snapping: 96 on a story, 45 on a square (story-editor.tsx). */
    fun margin(height: Double): Double = if (height < 1400) 45.0 else 96.0

    val gridSizes = listOf(10, 20, 30, 40, 60, 90, 120)
    const val MAX_GUIDES = 40

    fun guides(doc: MarketingValue, axis: String): List<Double> {
        val length = doc["frame"].n(if (axis == "x") "w" else "h", if (axis == "x") 1080.0 else 1920.0)
        return doc["meta"]["guides"][axis].array.map { Math.round(it.number).toDouble() }.filter { it > 0 && it < length }.toSortedSet().toList()
    }

    fun grid(doc: MarketingValue): Double = doc["meta"].n("grid")

    /** Whether snapping is on belongs to this device. */
    const val SNAP_KEY = "artwork.snap"
    var snapping: Boolean
        get() = Prefs.bool(SNAP_KEY) ?: true
        set(v) { Prefs.putBool(SNAP_KEY, v) }

    fun withGuides(doc: MarketingValue, axis: String, values: List<Double>): MarketingValue =
        doc.withPath(listOf("meta", "guides", axis), MarketingValue.array(values.map { MarketingValue.number(it) }))

    fun withGrid(doc: MarketingValue, size: Double?): MarketingValue =
        if (size == null) doc.with("meta", doc["meta"].without("grid")) else doc.withPath(listOf("meta", "grid"), MarketingValue.number(size))
}

/** The user's guides and the grid, drawn over the page, and the line a drag has snapped to. */
@Composable
fun ArtworkGuideOverlay(scale: Float, guideX: List<Double>, guideY: List<Double>, grid: Double, snapX: Double?, snapY: Double?, modifier: Modifier = Modifier) {
    // The user's guides and grid are the house accent; the snapped line stays pink: a guide laid over any photograph must stand out from
    // it, and pink is the one hue the shop's photographs and accent never use.
    val guide = ErpColors.accent
    val pink = Color(0xFFFF2D6F)
    Canvas(modifier) {
        fun line(a: Offset, b: Offset, color: Color, w: Float = 1f) = drawLine(color, a, b, strokeWidth = w)
        if (grid * scale >= 3) {
            var x = grid
            while (x * scale < size.width) { line(Offset((x * scale).toFloat(), 0f), Offset((x * scale).toFloat(), size.height), guide.copy(alpha = 0.28f), 0.5f); x += grid }
            var y = grid
            while (y * scale < size.height) { line(Offset(0f, (y * scale).toFloat()), Offset(size.width, (y * scale).toFloat()), guide.copy(alpha = 0.28f), 0.5f); y += grid }
        }
        for (x in guideX) line(Offset((x * scale).toFloat(), 0f), Offset((x * scale).toFloat(), size.height), guide)
        for (y in guideY) line(Offset(0f, (y * scale).toFloat()), Offset(size.width, (y * scale).toFloat()), guide)
        snapX?.let { line(Offset((it * scale).toFloat(), 0f), Offset((it * scale).toFloat(), size.height), pink, 3f) }
        snapY?.let { line(Offset(0f, (it * scale).toFloat()), Offset(size.width, (it * scale).toFloat()), pink, 3f) }
    }
}

/** Guides and grid controls (panels/guides.tsx): snapping on or off, the grid and its size, and the guide lines. */
@Composable
fun ArtworkGuideRows(doc: MarketingValue, change: (MarketingValue) -> Unit) {
    var snapping by remember { mutableStateOf(ArtworkSnap.snapping) }
    var position by remember { mutableStateOf("") }
    var axis by remember { mutableStateOf("x") }
    ToggleRow("Snap while moving", snapping, onChange = { snapping = it; ArtworkSnap.snapping = it })
    ToggleRow("Grid that things snap to", ArtworkSnap.grid(doc) > 0, onChange = { on -> change(ArtworkSnap.withGrid(doc, if (on) 60.0 else null)) })
    if (ArtworkSnap.grid(doc) > 0) {
        val current = ArtworkSnap.grid(doc).toInt()
        PickerRow("Grid every", current.toString(), (ArtworkSnap.gridSizes + (if (current in ArtworkSnap.gridSizes) emptyList() else listOf(current))).map { it.toString() to "$it px" }) {
            change(ArtworkSnap.withGrid(doc, it.toDouble()))
        }
    }
    for (a in listOf("x", "y")) {
        val values = ArtworkSnap.guides(doc, a)
        for (v in values) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(if (a == "x") Icons.Filled.SwapHoriz else Icons.Filled.SwapVert, null)
                Text(if (a == "x") "Across ${v.toInt()}" else "Down ${v.toInt()}", Modifier.weight(1f))
                IconButton(onClick = { change(ArtworkSnap.withGuides(doc, a, values.filter { it != v })) }, Modifier.semantics { contentDescription = "Remove this guide" }) { Icon(Icons.Filled.Delete, null, tint = Tone.problem.color()) }
            }
        }
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterChip("Across", axis == "x", { axis = "x" })
        FilterChip("Down", axis == "y", { axis = "y" })
        OutlinedTextField(
            position, { position = it.filter { c -> c.isDigit() }.take(5) }, Modifier.widthIn(max = 90.dp), singleLine = true, placeholder = { Text("px") },
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Number),
        )
        TextButton(onClick = {
            val length = doc["frame"].n(if (axis == "x") "w" else "h", if (axis == "x") 1080.0 else 1920.0)
            val v = position.toDoubleOrNull()?.let { Math.round(it).toDouble() }
            if (v == null || v <= 0 || v >= length) return@TextButton
            val all = ArtworkSnap.guides(doc, "x") + ArtworkSnap.guides(doc, "y")
            if (all.size >= ArtworkSnap.MAX_GUIDES) return@TextButton
            change(ArtworkSnap.withGuides(doc, axis, (ArtworkSnap.guides(doc, axis) + v).toSortedSet().toList()))
            position = ""
        }) { Text("Add") }
    }
    Text(
        "Things you move snap to the guides, the grid, the page’s middle and margins and each other. Guides are for you: they are not in the picture you post.",
        Modifier.padding(horizontal = 16.dp, vertical = 4.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** "Match the first one picked" (position.tsx): the others take its size or its place. */
object ArtworkMatch {
    val hows: List<Pair<String, String>> = listOf("width" to "Width", "height" to "Height", "both" to "Size", "x" to "Left edge", "y" to "Top edge", "position" to "Place")

    fun apply(how: String, reference: String, layers: List<MarketingValue>, selected: Set<String>, boxes: Map<String, ArtworkBox>): List<MarketingValue> {
        val ref = boxes[reference] ?: return layers
        return layers.map { l ->
            val id = l.s("id")
            val b = boxes[id]
            if (id == reference || id !in selected || l["locked"].bool || b == null) return@map l
            var n = l
            if (how == "x" || how == "position") n = n.with("x", MarketingValue.number(l.n("x") + ref.x - b.x))
            if (how == "y" || how == "position") n = n.with("y", MarketingValue.number(l.n("y") + ref.y - b.y))
            if ((how == "x" || how == "y" || how == "position") && l.s("kind") == "text") n = n.without("flow")
            val kx = if ((how == "width" || how == "both") && b.w > 0) ref.w / b.w else 1.0
            val ky = if ((how == "height" || how == "both") && b.h > 0) ref.h / b.h else 1.0
            if (kx == 1.0 && ky == 1.0) return@map n
            fun r(v: Double) = if (v < 0) -Math.floor(-v + 0.5) else Math.floor(v + 0.5)
            fun num(v: Double) = MarketingValue.number(v)
            fun sized(lo: Double, hi: Double, v: Double) = num(min(hi, max(lo, r(v))))
            val k = if (abs(kx - 1) >= abs(ky - 1)) kx else ky
            when (l.s("kind")) {
                // The web sizes a text by its line width (and by its height, scaling the letters).
                "text" -> {
                    if (kx != 1.0) n = n.with("width", sized(80.0, 2400.0, l.n("width") * kx))
                    n = n.without("flow")
                }
                "wordmark" -> n = n.with("width", sized(20.0, 1080.0, l.n("width") * (if (kx != 1.0) kx else ky)))
                "qr" -> n = n.with("w", sized(20.0, 2400.0, l.n("w") * k))
                "image" -> {
                    n = if (!l["h"].isNull) n.with("w", sized(20.0, 2400.0, l.n("w") * kx)).with("h", sized(20.0, 3000.0, l.n("h") * ky))
                    else n.with("w", sized(20.0, 2400.0, l.n("w") * k))
                }
                // Shapes and lines keep their direction (a negative width or height).
                else -> n = n.with("w", num(r(l.n("w") * kx))).with("h", num(r(l.n("h") * ky)))
            }
            n
        }
    }
}
