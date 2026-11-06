package erp.app.ui

import androidx.compose.foundation.shape.CornerSize
import androidx.compose.foundation.shape.CornerBasedShape
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection

/**
 * A rounded rectangle with continuous curvature (the iOS "squircle" corner): the curve eases out of the straight edge instead of
 * jumping into a circular arc, so a big corner reads softer. Each corner is three cubic Béziers that reach 1.528665 × radius along
 * each edge (Apple's corner, as drawn by PaintCode and Figma at 60 % smoothing). A [CornerBasedShape], so Material's `Shapes`,
 * `.copy(bottomStart = …)` and every component that takes a shape keep working; the outline's path is cached per size.
 */
class ContinuousRoundedShape(
    topStart: CornerSize,
    topEnd: CornerSize,
    bottomEnd: CornerSize,
    bottomStart: CornerSize,
) : CornerBasedShape(topStart, topEnd, bottomEnd, bottomStart) {

    constructor(radius: Dp) : this(CornerSize(radius), CornerSize(radius), CornerSize(radius), CornerSize(radius))

    override fun copy(topStart: CornerSize, topEnd: CornerSize, bottomEnd: CornerSize, bottomStart: CornerSize): CornerBasedShape =
        ContinuousRoundedShape(topStart, topEnd, bottomEnd, bottomStart)

    override fun createOutline(size: Size, topStart: Float, topEnd: Float, bottomEnd: Float, bottomStart: Float, layoutDirection: LayoutDirection): Outline {
        if (topStart + topEnd + bottomEnd + bottomStart == 0f) return Outline.Rectangle(androidx.compose.ui.geometry.Rect(0f, 0f, size.width, size.height))
        val ltr = layoutDirection == LayoutDirection.Ltr
        val tl = if (ltr) topStart else topEnd
        val tr = if (ltr) topEnd else topStart
        val br = if (ltr) bottomEnd else bottomStart
        val bl = if (ltr) bottomStart else bottomEnd
        return Outline.Generic(ContinuousPaths.of(size.width, size.height, tl, tr, br, bl))
    }

    override fun toString(): String = "ContinuousRoundedShape(topStart = $topStart, topEnd = $topEnd, bottomEnd = $bottomEnd, bottomStart = $bottomStart)"
}

/** Builds and keeps the outline paths. A path is never changed after it is made, so one may be shared by every box of a size. */
object ContinuousPaths {
    /** How far a corner of radius 1 reaches along an edge. */
    const val EXTENT = 1.528665f

    private const val KEEP = 48

    private data class Key(val w: Float, val h: Float, val tl: Float, val tr: Float, val br: Float, val bl: Float)

    private val kept = object : LinkedHashMap<Key, Path>(KEEP, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Key, Path>?): Boolean = size > KEEP
    }

    fun of(w: Float, h: Float, tl: Float, tr: Float, br: Float, bl: Float): Path {
        val key = Key(w, h, tl, tr, br, bl)
        synchronized(kept) { kept[key]?.let { return it } }
        val path = build(w, h, tl, tr, br, bl)
        synchronized(kept) { kept[key] = path }
        return path
    }

    /** Radii (px, in the order top-left, top-right, bottom-right, bottom-left) shrunk together until each edge holds its two corners' reach. */
    internal fun fitted(w: Float, h: Float, tl: Float, tr: Float, br: Float, bl: Float): FloatArray {
        val r = floatArrayOf(tl.coerceAtLeast(0f), tr.coerceAtLeast(0f), br.coerceAtLeast(0f), bl.coerceAtLeast(0f))
        var scale = 1f
        fun side(len: Float, a: Float, b: Float) { val need = (a + b) * EXTENT; if (need > len && need > 0f) scale = minOf(scale, len / need) }
        side(w, r[0], r[1]); side(w, r[3], r[2]); side(h, r[0], r[3]); side(h, r[1], r[2])
        if (scale < 1f) for (i in r.indices) r[i] *= scale
        return r
    }

    internal fun build(w: Float, h: Float, tl: Float, tr: Float, br: Float, bl: Float): Path {
        val r = fitted(w, h, tl, tr, br, bl)
        val path = Path()
        // Clockwise from the top edge, just after the top-left corner. `x`, `y` are the corner's outer point; (dx, dy) point along
        // the two edges so one routine draws all four corners.
        path.moveTo(r[0] * EXTENT, 0f)
        path.lineTo(w - r[1] * EXTENT, 0f)
        corner(path, w, 0f, r[1], -1f, 1f, horizontalFirst = true)
        path.lineTo(w, h - r[2] * EXTENT)
        corner(path, w, h, r[2], -1f, -1f, horizontalFirst = false)
        path.lineTo(r[3] * EXTENT, h)
        corner(path, 0f, h, r[3], 1f, -1f, horizontalFirst = true)
        path.lineTo(0f, r[0] * EXTENT)
        corner(path, 0f, 0f, r[0], 1f, 1f, horizontalFirst = false)
        path.close()
        return path
    }

    /**
     * One corner at the outer point ([x], [y]) with radius [r]; [sx], [sy] are +1/-1 toward the inside of the box along x and y.
     * Starts where the previous straight edge ends: along x when [horizontalFirst] (arriving on a horizontal edge), else along y.
     */
    private fun corner(path: Path, x: Float, y: Float, r: Float, sx: Float, sy: Float, horizontalFirst: Boolean) {
        if (r <= 0f) { path.lineTo(x, y); return }
        // The corner's points in the frame where the edge being left runs along the first axis, measured from the corner.
        fun pt(a: Float, b: Float): Pair<Float, Float> = if (horizontalFirst) (x + sx * a * r) to (y + sy * b * r) else (x + sx * b * r) to (y + sy * a * r)
        fun c(a1: Float, b1: Float, a2: Float, b2: Float, a3: Float, b3: Float) {
            val p1 = pt(a1, b1); val p2 = pt(a2, b2); val p3 = pt(a3, b3)
            path.cubicTo(p1.first, p1.second, p2.first, p2.second, p3.first, p3.second)
        }
        c(1.08849296f, 0f, 0.86840694f, 0f, 0.63149399f, 0.07491100f)
        c(0.37282383f, 0.16905956f, 0.16905956f, 0.37282383f, 0.07491100f, 0.63149399f)
        c(0f, 0.86840694f, 0f, 1.08849296f, 0f, EXTENT)
    }
}
