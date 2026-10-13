package erp.app.screens.ads

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import erp.app.ui.Motion
import erp.app.ui.reduceMotion
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.max

// The Overview's one chart (AdsOverview.swift dailySection): spend each day as bars in the house's accent, Compose
// Canvas, no axes to read; the exact figure is one touch away and spoken to TalkBack.

private val dayMonth = DateTimeFormatter.ofPattern("d MMM", Locale.UK)

/** "2026-10-01" as "1 Oct"; the text itself where it isn't a day. */
fun adsDayWord(ymd: String): String = runCatching { dayMonth.format(LocalDate.parse(ymd)) }.getOrDefault(ymd)

@Composable
fun AdsDayBars(days: List<AdDay>, currency: String, modifier: Modifier = Modifier) {
    val reduce = reduceMotion()
    var target by remember { mutableFloatStateOf(if (reduce) 1f else 0f) }
    LaunchedEffect(Unit) { target = 1f }
    val reveal by animateFloatAsState(target, Motion.travel(reduce), label = "adsBars")
    val accent = ErpColors.accent
    val base = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.2f)
    val top = days.maxOfOrNull { it.metrics.spend } ?: 0.0
    var picked by remember(days) { mutableIntStateOf(-1) }
    val spoken = if (days.isEmpty()) "No spend to chart." else
        "Spend each day over the range in $currency: ${adsDayWord(days.first().date)} to ${adsDayWord(days.last().date)}, " +
            "total ${AdsFormat.money(days.sumOf { it.metrics.spend }, currency)}, most in a day ${AdsFormat.money(top, currency)}"
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Canvas(
            Modifier.fillMaxWidth().height(180.dp).semantics { contentDescription = spoken }
                .pointerInput(days.size) {
                    detectTapGestures { p -> if (days.isNotEmpty()) picked = ((p.x / size.width) * days.size).toInt().coerceIn(0, days.size - 1) }
                }
                .pointerInput(days.size) {
                    detectHorizontalDragGestures { change, _ ->
                        if (days.isNotEmpty()) picked = ((change.position.x / size.width) * days.size).toInt().coerceIn(0, days.size - 1)
                    }
                },
        ) {
            val slot = size.width / max(days.size, 1)
            val bar = (slot * 0.7f).coerceIn(2.dp.toPx(), 28.dp.toPx())
            val floor = size.height - 0.5.dp.toPx()
            days.forEachIndexed { i, d ->
                val h = if (top > 0) ((d.metrics.spend / top).toFloat() * (floor - 2.dp.toPx()) * reveal).coerceAtLeast(0f) else 0f
                if (h > 0f) {
                    val color = if (picked == i) accent else accent.copy(alpha = if (picked < 0) 0.85f else 0.45f)
                    drawRoundRect(color, Offset(slot * i + (slot - bar) / 2, floor - h), Size(bar, h), CornerRadius(minOf(bar / 2, 3.dp.toPx())))
                }
            }
            drawLine(base, Offset(0f, floor), Offset(size.width, floor), strokeWidth = 1.dp.toPx())
        }
        Row(Modifier.fillMaxWidth().clearAndSetSemantics {}) {
            Text(days.firstOrNull()?.let { adsDayWord(it.date) } ?: "", Modifier.weight(1f), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(days.lastOrNull()?.let { adsDayWord(it.date) } ?: "", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        val d = days.getOrNull(picked)
        Text(
            if (d != null) "${adsDayWord(d.date)}: ${AdsFormat.money(d.metrics.spend, currency)}" else "Touch the chart to read a day.",
            style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits, fontWeight = if (d == null) FontWeight.Normal else FontWeight.Medium),
            color = if (d == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
        )
    }
}
