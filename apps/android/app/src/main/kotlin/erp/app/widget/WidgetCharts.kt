package erp.app.widget

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader

/**
 * The week's takings as the widget draws them (ERPSparkline, ERPWeekBars): Glance has no chart, so each is a small bitmap made
 * here, and the preview draws the very same numbers. Seven days, oldest first; today is the last.
 */
object WidgetCharts {
    /** Points of the sparkline, x and y in 0..1 from the top-left; the top of the range is the best day plus 15%, so the line never touches the edge. */
    fun sparkline(days: List<Double>): List<Pair<Float, Float>> {
        if (days.size < 2) return emptyList()
        val top = maxOf((days.max()) * 1.15, 1.0)
        return days.mapIndexed { i, v -> (i.toFloat() / (days.size - 1)) to (1f - (v.coerceAtLeast(0.0) / top).toFloat()) }
    }

    /** Heights of the bars in 0..1; the range tops out at the best day plus 5%. */
    fun bars(days: List<Double>): List<Float> {
        if (days.size < 2) return emptyList()
        val top = maxOf(days.max() * 1.05, 1.0)
        return days.map { (it.coerceAtLeast(0.0) / top).toFloat() }
    }

    /** A line with a soft fill under it and today's point; `color` is ARGB. */
    fun sparklineBitmap(days: List<Double>, widthPx: Int, heightPx: Int, color: Int, stroke: Float = 2f * widthPx / 160f): Bitmap {
        val bitmap = Bitmap.createBitmap(widthPx.coerceAtLeast(1), heightPx.coerceAtLeast(1), Bitmap.Config.ARGB_8888)
        val pts = sparkline(days)
        if (pts.isEmpty()) return bitmap
        val c = Canvas(bitmap)
        val pad = stroke * 1.5f
        val w = widthPx - 2 * pad
        val h = heightPx - 2 * pad
        fun x(p: Pair<Float, Float>) = pad + p.first * w
        fun y(p: Pair<Float, Float>) = pad + p.second * h
        val line = Path().apply {
            moveTo(x(pts[0]), y(pts[0]))
            // Smoothed through the points, as the iPhone's catmull-rom: each segment's controls sit a third of the way along.
            for (i in 1 until pts.size) {
                val p0 = pts[maxOf(i - 2, 0)]
                val p1 = pts[i - 1]
                val p2 = pts[i]
                val p3 = pts[minOf(i + 1, pts.size - 1)]
                cubicTo(
                    x(p1) + (x(p2) - x(p0)) / 6f, y(p1) + (y(p2) - y(p0)) / 6f,
                    x(p2) - (x(p3) - x(p1)) / 6f, y(p2) - (y(p3) - y(p1)) / 6f,
                    x(p2), y(p2),
                )
            }
        }
        val fill = Path(line).apply {
            lineTo(x(pts.last()), heightPx.toFloat())
            lineTo(x(pts.first()), heightPx.toFloat())
            close()
        }
        c.drawPath(
            fill,
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                shader = LinearGradient(0f, 0f, 0f, heightPx.toFloat(), withAlpha(color, 0.32f), withAlpha(color, 0f), Shader.TileMode.CLAMP)
            },
        )
        c.drawPath(
            line,
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                this.color = color
                style = Paint.Style.STROKE
                strokeWidth = stroke
                strokeCap = Paint.Cap.ROUND
                strokeJoin = Paint.Join.ROUND
            },
        )
        c.drawCircle(x(pts.last()), y(pts.last()), stroke * 1.4f, Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color })
        return bitmap
    }

    /** Seven small bars; today's is the accent, the rest are faint. */
    fun barsBitmap(days: List<Double>, widthPx: Int, heightPx: Int, color: Int): Bitmap {
        val bitmap = Bitmap.createBitmap(widthPx.coerceAtLeast(1), heightPx.coerceAtLeast(1), Bitmap.Config.ARGB_8888)
        val hs = bars(days)
        if (hs.isEmpty()) return bitmap
        val c = Canvas(bitmap)
        val slot = widthPx.toFloat() / hs.size
        val bar = slot * 0.62f
        val radius = bar * 0.25f
        hs.forEachIndexed { i, h ->
            val left = i * slot + (slot - bar) / 2f
            val top = heightPx - maxOf(h * heightPx, radius * 2f)
            c.drawRoundRect(
                RectF(left, top, left + bar, heightPx.toFloat()), radius, radius,
                Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = if (i == hs.size - 1) color else withAlpha(color, 0.28f) },
            )
        }
        return bitmap
    }

    fun withAlpha(argb: Int, alpha: Float): Int = (argb and 0x00FFFFFF) or ((alpha.coerceIn(0f, 1f) * 255).toInt() shl 24)
}
