package erp.app.screens.marketing

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import erp.app.screens.ads.AdsFormat
import erp.app.screens.ads.adsDayWord
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import kotlin.math.max

// Insights' three charts, Compose Canvas like the Ads day bars (Insights.swift: BarMark for reach, views and the hours,
// LineMark for followers). The exact figure is one touch away and spoken to TalkBack.

/** One bar or point: what it is called ("14 Oct", "5pm") and its figure. */
class InsightPoint(val label: String, val value: Double)

fun insightDayPoints(days: List<InsightDay>): List<InsightPoint> = days.map { InsightPoint(adsDayWord(it.date), it.value) }

/** Bars from zero in the house's accent; touching or dragging reads one. [what] is the figure's name ("Reached"). */
@Composable
fun InsightBars(points: List<InsightPoint>, what: String, spoken: String, modifier: Modifier = Modifier, height: Dp = 160.dp, hint: String = "Touch the chart to read a day.") {
    val accent = ErpColors.accent
    val base = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.2f)
    val top = points.maxOfOrNull { it.value } ?: 0.0
    var picked by remember(points) { mutableIntStateOf(-1) }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Canvas(
            Modifier.fillMaxWidth().height(height).semantics { contentDescription = spoken }
                .pointerInput(points.size) { detectTapGestures { p -> if (points.isNotEmpty()) picked = ((p.x / size.width) * points.size).toInt().coerceIn(0, points.size - 1) } }
                .pointerInput(points.size) {
                    detectHorizontalDragGestures { change, _ -> if (points.isNotEmpty()) picked = ((change.position.x / size.width) * points.size).toInt().coerceIn(0, points.size - 1) }
                },
        ) {
            val slot = size.width / max(points.size, 1)
            val bar = (slot * 0.7f).coerceIn(2.dp.toPx(), 28.dp.toPx())
            val floor = size.height - 0.5.dp.toPx()
            points.forEachIndexed { i, p ->
                val h = if (top > 0) ((p.value / top).toFloat() * (floor - 2.dp.toPx())).coerceAtLeast(0f) else 0f
                if (h > 0f) {
                    val color = if (picked == i) accent else accent.copy(alpha = if (picked < 0) 0.85f else 0.45f)
                    drawRoundRect(color, Offset(slot * i + (slot - bar) / 2, floor - h), Size(bar, h), CornerRadius(minOf(bar / 2, 3.dp.toPx())))
                }
            }
            drawLine(base, Offset(0f, floor), Offset(size.width, floor), strokeWidth = 1.dp.toPx())
        }
        Ends(points)
        ReadOut(points.getOrNull(picked), what, hint)
    }
}

/** A line that does not start at zero (a follower count moves by a few): the lowest and highest set the frame. */
@Composable
fun InsightLine(points: List<InsightPoint>, what: String, spoken: String, modifier: Modifier = Modifier, height: Dp = 160.dp) {
    val accent = ErpColors.accent
    val base = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.2f)
    val low = points.minOfOrNull { it.value } ?: 0.0
    val high = points.maxOfOrNull { it.value } ?: 0.0
    val span = if (high > low) high - low else 1.0
    var picked by remember(points) { mutableIntStateOf(-1) }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Canvas(
            Modifier.fillMaxWidth().height(height).semantics { contentDescription = spoken }
                .pointerInput(points.size) { detectTapGestures { p -> if (points.isNotEmpty()) picked = ((p.x / size.width) * points.size).toInt().coerceIn(0, points.size - 1) } }
                .pointerInput(points.size) {
                    detectHorizontalDragGestures { change, _ -> if (points.isNotEmpty()) picked = ((change.position.x / size.width) * points.size).toInt().coerceIn(0, points.size - 1) }
                },
        ) {
            val pad = 8.dp.toPx()
            fun at(i: Int, v: Double): Offset {
                val x = if (points.size > 1) pad + (size.width - 2 * pad) * i / (points.size - 1) else size.width / 2
                val y = pad + (size.height - 2 * pad) * (1 - ((v - low) / span).toFloat())
                return Offset(x, y)
            }
            drawLine(base, Offset(0f, size.height - 0.5.dp.toPx()), Offset(size.width, size.height - 0.5.dp.toPx()), strokeWidth = 1.dp.toPx())
            val path = Path()
            points.forEachIndexed { i, p -> at(i, p.value).let { if (i == 0) path.moveTo(it.x, it.y) else path.lineTo(it.x, it.y) } }
            drawPath(path, accent, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
            if (picked in points.indices) drawCircle(accent, 4.dp.toPx(), at(picked, points[picked].value))
        }
        Ends(points)
        ReadOut(points.getOrNull(picked), what, "Touch the chart to read a day.")
    }
}

@Composable
private fun Ends(points: List<InsightPoint>) {
    Row(Modifier.fillMaxWidth().clearAndSetSemantics {}) {
        Text(points.firstOrNull()?.label ?: "", Modifier.weight(1f), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(points.lastOrNull()?.label ?: "", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ReadOut(p: InsightPoint?, what: String, hint: String) {
    Text(
        if (p != null) "${p.label}: ${AdsFormat.count(p.value)} ${what.lowercase()}" else hint,
        Modifier.padding(top = 2.dp),
        style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits, fontWeight = if (p == null) FontWeight.Normal else FontWeight.Medium),
        color = if (p == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
    )
}
