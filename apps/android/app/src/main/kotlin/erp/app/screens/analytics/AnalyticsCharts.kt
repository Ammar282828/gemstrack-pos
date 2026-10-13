package erp.app.screens.analytics

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import erp.app.ui.Motion
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.fill
import erp.app.ui.reduceMotion
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import erp.core.logic.Money
import kotlin.math.max

// The charts, kept simple (AnalyticsCharts.swift): Compose Canvas, no axes to read, the amounts said in lac and every
// exact figure also a row on its page. Each chart carries a spoken summary (TalkBack reads the numbers, not a picture)
// and draws in once unless the person asked for less motion. The web's dual axis (sales against orders) is two charts.

/** 0 to 1 as a chart arrives; already 1 when animations are off. */
@Composable
private fun rememberReveal(): Float {
    val reduce = reduceMotion()
    var target by remember { mutableFloatStateOf(if (reduce) 1f else 0f) }
    LaunchedEffect(Unit) { target = 1f }
    val shown by animateFloatAsState(target, Motion.travel(reduce), label = "chartReveal")
    return shown
}

/** The colours a chart's series take, in a fixed order so a source keeps its colour from one day to the next. */
@Composable
internal fun chartPalette(): List<Color> = listOf(
    ErpColors.accent,
    Tone.settled.fill(),
    Tone.working.fill(),
    Tone.owed.fill(),
    Tone.credit.fill(),
    Tone.late.fill(),
    MaterialTheme.colorScheme.onSurfaceVariant,
)

@Composable
private fun hairline(): Color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.2f)

@Composable
private fun CaptionLine(left: String, right: String? = null) {
    Row(Modifier.fillMaxWidth().clearAndSetSemantics {}) {
        Text(left, Modifier.weight(1f), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (right != null) Text(right, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** What a touch on the chart picked out, said under it. */
@Composable
private fun Readout(text: String?) {
    Text(
        text ?: "Touch the chart to read a day.",
        style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits, fontWeight = if (text == null) FontWeight.Normal else FontWeight.Medium),
        color = if (text == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
    )
}

/** Taps and drags along a chart pick the nearest of [count] slots. */
private fun Modifier.pickSlot(count: Int, onPick: (Int) -> Unit): Modifier =
    pointerInput(count) {
        detectTapGestures { p -> if (count > 0) onPick(((p.x / size.width) * count).toInt().coerceIn(0, count - 1)) }
    }.pointerInput(count) {
        detectHorizontalDragGestures { change, _ -> if (count > 0) onPick(((change.position.x / size.width) * count).toInt().coerceIn(0, count - 1)) }
    }

// MARK: Bars lying down

/** One bar of a horizontal bar chart; [value] is in rupees. */
class AnaBar(val id: String, val label: String, val value: Double)

/** A category against its amount, bars lying down (expenses by category, sales by category). */
@Composable
fun AnaBarChart(bars: List<AnaBar>, modifier: Modifier = Modifier, tint: Color = ErpColors.accent) {
    val top = bars.maxOfOrNull { it.value } ?: 0.0
    val reveal = rememberReveal()
    val spoken = "Amounts by name in PKR lac: " + bars.joinToString(", ") { it.label + " " + Money.lacCrore(it.value) }
    Column(modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = spoken }, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        for (b in bars) {
            val share = if (top > 0) (b.value / top).toFloat().coerceIn(0f, 1f) else 0f
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                    Text(b.label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                    Text(
                        Money.lacCrore(b.value),
                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits),
                    )
                }
                val track = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.1f)
                Canvas(Modifier.fillMaxWidth().height(8.dp).clearAndSetSemantics {}) {
                    drawRoundRect(track, size = size, cornerRadius = CornerRadius(size.height / 2))
                    if (share > 0f) {
                        drawRoundRect(tint, size = Size(max(size.height, size.width * share * reveal), size.height), cornerRadius = CornerRadius(size.height / 2))
                    }
                }
            }
        }
    }
}

// MARK: Revenue each day

/** The same quiet bar treatment as Home, with daily figures still available in Sales. */
@Composable
fun AnaRevenueBars(days: List<AnaDay>, modifier: Modifier = Modifier) {
    val accent = ErpColors.accent
    val base = hairline()
    val reveal = rememberReveal()
    val top = days.maxOfOrNull { it.sales } ?: 0.0
    var picked by remember(days) { mutableIntStateOf(-1) }
    val best = days.maxByOrNull { it.sales }
    val spoken = if (days.isEmpty()) "No revenue to chart." else
        "Revenue each day in PKR lac, ${dayWord(days.first().date)} to ${dayWord(days.last().date)}: total ${Money.lacCrore(days.sumOf { it.sales })}" +
            (best?.let { ", best day ${dayWord(it.date)} with ${Money.lacCrore(it.sales)}" } ?: "")
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        CaptionLine("Revenue each day, PKR lac", "Peak " + Money.lacCrore(top))
        Canvas(
            Modifier.fillMaxWidth().height(170.dp).semantics { contentDescription = spoken }.pickSlot(days.size) { picked = it },
        ) {
            val slot = size.width / max(days.size, 1)
            val bar = (slot * 0.7f).coerceIn(2.dp.toPx(), 28.dp.toPx())
            val floor = size.height - 0.5.dp.toPx()
            days.forEachIndexed { i, d ->
                val h = if (top > 0) ((d.sales / top).toFloat() * (floor - 2.dp.toPx()) * reveal).coerceAtLeast(0f) else 0f
                if (h > 0f) {
                    val color = if (picked == i) accent else accent.copy(alpha = if (picked < 0) 0.85f else 0.45f)
                    drawRoundRect(color, Offset(slot * i + (slot - bar) / 2, floor - h), Size(bar, h), CornerRadius(min3(bar / 2, 3.dp.toPx())))
                }
            }
            drawLine(base, Offset(0f, floor), Offset(size.width, floor), strokeWidth = 1.dp.toPx())
        }
        CaptionLine(days.firstOrNull()?.let { dayWord(it.date) } ?: "", days.lastOrNull()?.let { dayWord(it.date) })
        if (days.size > 1) Readout(picked.takeIf { it in days.indices }?.let { dayWord(days[it].date) + ": " + Money.pkrLac(days[it].sales) })
    }
}

private fun min3(a: Float, b: Float): Float = if (a < b) a else b

private fun dayWord(key: String): String = AnaDate.parseISO(key)?.let { AnaDate.dayMonth(it) } ?: key

// MARK: Sales day by day

/** A smooth line over a soft area, the way Home draws its month. */
@Composable
fun AnaSalesChart(days: List<AnaDay>, modifier: Modifier = Modifier) {
    val accent = ErpColors.accent
    val base = hairline()
    val reveal = rememberReveal()
    val top = days.maxOfOrNull { it.sales } ?: 0.0
    var picked by remember(days) { mutableIntStateOf(-1) }
    val spoken = if (days.isEmpty()) "No sales to chart." else
        "Sales each day in PKR lac, ${dayWord(days.first().date)} to ${dayWord(days.last().date)}: peak ${Money.lacCrore(top)}, total ${Money.lacCrore(days.sumOf { it.sales })}"
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        CaptionLine("Sales, PKR lac", "Peak " + Money.lacCrore(top))
        Canvas(Modifier.fillMaxWidth().height(180.dp).semantics { contentDescription = spoken }.pickSlot(days.size) { picked = it }) {
            if (days.isEmpty() || top <= 0) {
                drawLine(base, Offset(0f, size.height - 1f), Offset(size.width, size.height - 1f), strokeWidth = 1.dp.toPx())
                return@Canvas
            }
            val pad = 6.dp.toPx()
            val xs = days.indices.map { if (days.size == 1) size.width / 2 else it * (size.width / (days.size - 1)) }
            val ys = days.map { size.height - pad - (it.sales / top).toFloat() * (size.height - 2 * pad) * reveal }
            if (days.size > 1) {
                val line = smooth(xs, ys)
                val area = Path().apply {
                    addPath(line)
                    lineTo(xs.last(), size.height)
                    lineTo(xs.first(), size.height)
                    close()
                }
                drawPath(area, accent.copy(alpha = 0.18f))
                drawPath(line, accent, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round))
            }
            if (days.size < 3) days.indices.forEach { drawCircle(accent, 4.dp.toPx(), Offset(xs[it], ys[it])) }
            if (picked in days.indices) {
                drawLine(accent.copy(alpha = 0.4f), Offset(xs[picked], 0f), Offset(xs[picked], size.height), strokeWidth = 1.dp.toPx())
                drawCircle(accent, 5.dp.toPx(), Offset(xs[picked], ys[picked]))
            }
        }
        CaptionLine(days.firstOrNull()?.let { dayWord(it.date) } ?: "", days.lastOrNull()?.let { dayWord(it.date) })
        if (days.size > 1) Readout(picked.takeIf { it in days.indices }?.let { dayWord(days[it].date) + ": " + Money.pkrLac(days[it].sales) })
    }
}

/** A smooth line that never overshoots a day: each segment eases flat into its points. */
private fun smooth(xs: List<Float>, ys: List<Float>): Path = Path().apply {
    moveTo(xs[0], ys[0])
    for (i in 1 until xs.size) {
        val mid = (xs[i - 1] + xs[i]) / 2
        cubicTo(mid, ys[i - 1], mid, ys[i], xs[i], ys[i])
    }
}

/** The number of sales each day, under the sales line. */
@Composable
fun AnaOrdersChart(days: List<AnaDay>, modifier: Modifier = Modifier) {
    val tone = Tone.settled.fill()
    val base = hairline()
    val reveal = rememberReveal()
    val top = days.maxOfOrNull { it.orders } ?: 0
    val spoken = "Orders each day, ${days.sumOf { it.orders }} in all, at most $top in a day"
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        CaptionLine("Orders each day", "Most $top")
        Canvas(Modifier.fillMaxWidth().height(100.dp).semantics { contentDescription = spoken }) {
            val slot = size.width / max(days.size, 1)
            val bar = (slot * 0.7f).coerceIn(2.dp.toPx(), 28.dp.toPx())
            val floor = size.height - 0.5.dp.toPx()
            days.forEachIndexed { i, d ->
                val h = if (top > 0) (d.orders.toFloat() / top) * (floor - 2.dp.toPx()) * reveal else 0f
                if (h > 0f) drawRoundRect(tone, Offset(slot * i + (slot - bar) / 2, floor - h), Size(bar, h), CornerRadius(min3(bar / 2, 3.dp.toPx())))
            }
            drawLine(base, Offset(0f, floor), Offset(size.width, floor), strokeWidth = 1.dp.toPx())
        }
    }
}

// MARK: Revenue each month

/** Revenue for every month on record; the best month is picked out, the average is the dashed line. */
@Composable
fun AnaMonthlyChart(months: List<AnaMonth>, average: Double, best: String?, modifier: Modifier = Modifier) {
    val accent = ErpColors.accent
    val bestTone = Tone.settled.fill()
    val base = hairline()
    val dash = MaterialTheme.colorScheme.onSurfaceVariant
    val reveal = rememberReveal()
    val top = max(months.maxOfOrNull { it.revenue } ?: 0.0, average)
    var picked by remember(months) { mutableIntStateOf(-1) }
    val bestMonth = months.firstOrNull { it.key == best }
    val spoken = if (months.isEmpty()) "No months to chart." else
        "Revenue for each month on record in PKR lac, ${months.first().label} to ${months.last().label}, average ${Money.lacCrore(average)}" +
            (bestMonth?.let { ", best month ${it.label} with ${Money.lacCrore(it.revenue)}" } ?: "")
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        CaptionLine("Revenue, PKR lac", "Peak " + Money.lacCrore(top))
        Canvas(Modifier.fillMaxWidth().height(200.dp).semantics { contentDescription = spoken }.pickSlot(months.size) { picked = it }) {
            val slot = size.width / max(months.size, 1)
            val bar = (slot * 0.7f).coerceIn(2.dp.toPx(), 30.dp.toPx())
            val floor = size.height - 0.5.dp.toPx()
            val usable = floor - 2.dp.toPx()
            months.forEachIndexed { i, m ->
                val h = if (top > 0) (m.revenue / top).toFloat() * usable * reveal else 0f
                if (h > 0f) {
                    val color = if (m.key == best) bestTone else accent
                    drawRoundRect(color.copy(alpha = if (picked < 0 || picked == i) 1f else 0.5f), Offset(slot * i + (slot - bar) / 2, floor - h), Size(bar, h), CornerRadius(min3(bar / 2, 3.dp.toPx())))
                }
            }
            drawLine(base, Offset(0f, floor), Offset(size.width, floor), strokeWidth = 1.dp.toPx())
            if (average > 0 && top > 0) {
                val y = floor - (average / top).toFloat() * usable
                drawLine(dash, Offset(0f, y), Offset(size.width, y), strokeWidth = 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx())))
            }
        }
        CaptionLine(months.firstOrNull()?.label ?: "", months.lastOrNull()?.label)
        Readout(picked.takeIf { it in months.indices }?.let { months[it].label + ": " + Money.pkrLac(months[it].revenue) + ", " + months[it].sales + " " + AnaFormat.plural(months[it].sales, "sale", "sales") })
    }
}

// MARK: Where revenue comes from

/** Where revenue comes from, one line per source, day by day. */
@Composable
fun AnaSourceTrendChart(points: List<AnaSourcePoint>, modifier: Modifier = Modifier) {
    val palette = chartPalette()
    val base = hairline()
    val reveal = rememberReveal()
    val labels = points.map { it.label }.distinct()
    val dates = points.map { it.date }.distinct()
    val top = points.maxOfOrNull { it.amount } ?: 0.0
    val series = labels.map { l -> points.filter { it.label == l } }
    val spoken = "Revenue by source each day in PKR lac: " + labels.zip(series).joinToString(", ") { (l, s) -> l + " " + Money.lacCrore(s.sumOf { it.amount }) + " in all" }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        CaptionLine("Revenue by source, PKR lac", "Peak " + Money.lacCrore(top))
        Canvas(Modifier.fillMaxWidth().height(200.dp).semantics { contentDescription = spoken }) {
            val floor = size.height - 0.5.dp.toPx()
            drawLine(base, Offset(0f, floor), Offset(size.width, floor), strokeWidth = 1.dp.toPx())
            if (top <= 0 || dates.isEmpty()) return@Canvas
            val pad = 6.dp.toPx()
            val xs = dates.indices.map { if (dates.size == 1) size.width / 2 else it * (size.width / (dates.size - 1)) }
            series.forEachIndexed { si, s ->
                val color = palette[si % palette.size]
                val ys = s.map { floor - pad - (it.amount / top).toFloat() * (floor - 2 * pad) * reveal }
                if (s.size > 1) drawPath(smooth(xs.take(s.size), ys), color, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round))
                else drawCircle(color, 4.dp.toPx(), Offset(xs[0], ys[0]))
            }
        }
        CaptionLine(dates.firstOrNull()?.let { dayWord(it) } ?: "", dates.lastOrNull()?.let { dayWord(it) })
        Legend(labels.mapIndexed { i, l -> l to palette[i % palette.size] })
    }
}

@Composable
private fun Legend(entries: List<Pair<String, Color>>) {
    // Wraps on a narrow screen: a row per two names is plenty, and the colours are never the only clue (the names are).
    Column(Modifier.clearAndSetSemantics {}, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        entries.chunked(2).forEach { pair ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                pair.forEach { (name, color) ->
                    Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(10.dp).clip(CircleShape).background(color))
                        Text(name, style = MaterialTheme.typography.bodySmall, maxLines = 1)
                    }
                }
                if (pair.size == 1) Box(Modifier.weight(1f))
            }
        }
    }
}

// MARK: Share of revenue

/** Each category's share of revenue. */
@Composable
fun AnaShareChart(rows: List<AnaBreakdown.CategoryRow>, modifier: Modifier = Modifier) {
    // A share is of what came in: a category at nothing (or below, after returns) has no slice.
    val slices = rows.filter { it.revenue > 0 }
    if (slices.isEmpty()) {
        Box(modifier.fillMaxWidth().height(80.dp), contentAlignment = Alignment.Center) {
            Text("No category revenue in this period.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        return
    }
    val palette = chartPalette()
    val reveal = rememberReveal()
    // Seven colours can be told apart; the rest are one slice, "Other" (the table below lists every category).
    val shown: List<Pair<String, Double>> = if (slices.size <= 7) slices.map { it.name to it.revenue }
    else slices.take(6).map { it.name to it.revenue } + ("Other" to slices.drop(6).sumOf { it.revenue })
    val total = shown.sumOf { it.second }
    val spoken = "Share of revenue by category: " + shown.joinToString(", ") { it.first + " " + AnaFormat.fixed(it.second / total * 100, 1) + " percent" }
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Canvas(Modifier.size(200.dp).semantics { contentDescription = spoken }) {
            val stroke = 38.dp.toPx()
            val inset = stroke / 2
            val arc = Size(size.width - stroke, size.height - stroke)
            var start = -90f
            shown.forEachIndexed { i, (_, value) ->
                val sweep = (value / total).toFloat() * 360f * reveal
                // A hairline gap between slices, as the Swift's angularInset.
                val gap = if (shown.size > 1) 1.5f else 0f
                drawArc(palette[i % palette.size], start + gap / 2, max(sweep - gap, 0.1f), false, Offset(inset, inset), arc, style = Stroke(stroke))
                start += (value / total).toFloat() * 360f * reveal
            }
        }
        Column(Modifier.fillMaxWidth().clearAndSetSemantics {}, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            shown.forEachIndexed { i, (name, value) ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(10.dp).clip(CircleShape).background(palette[i % palette.size]))
                    Text(name, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                    Text(
                        AnaFormat.fixed(value / total * 100, 1) + "%",
                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits),
                    )
                }
            }
        }
    }
}
