package erp.app.screens.analytics

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.fill
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import erp.core.logic.ComparedRow
import erp.core.logic.ExpenseKind
import erp.core.logic.Money
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

// The analytics redesign's chart kit (components/analytics/charts.tsx), added to AnalyticsCharts.kt's: the same Compose
// Canvas, the same drawn-in-once reveal (Reduce Motion: already drawn), the same tap-to-read line under every chart and
// the same spoken summary for TalkBack. The web's rules hold here: one measure per chart and never a second axis; colours
// follow the thing they stand for in a fixed order (22k is always the same colour; running costs, goods and drawings
// each have theirs); good and bad only in the tones; thin marks.

// MARK: Colours that follow the entity

/** `ana(n)`: the nth series colour, 1 to 6, in the fixed order of [chartPalette]. */
@Composable
internal fun anaColor(n: Int): Color = chartPalette()[(n - 1).mod(6)]

/** A karat is always the same colour: 24k first, 22k second, 21k third, 18k fourth, 12k fifth, anything else sixth (colors.ts). */
@Composable
internal fun anaKaratColor(karat: String): Color = anaColor(karatSlot(karat))

/** Which of the six series colours a karat takes (24k 1 ... 12k 5, anything else 6). */
internal fun karatSlot(karat: String): Int = when (karat.lowercase()) { "24k" -> 1; "22k" -> 2; "21k" -> 3; "18k" -> 4; "12k" -> 5; else -> 6 }

/** Running costs, the goods, the owners' drawings (`KIND_COLORS`). */
@Composable
internal fun anaKindColor(kind: ExpenseKind): Color = anaColor(
    when (kind) { ExpenseKind.running -> 1; ExpenseKind.goods -> 2; ExpenseKind.drawings -> 3 },
)

/** `KIND_LABELS`. */
internal fun anaKindLabel(kind: ExpenseKind): String = when (kind) {
    ExpenseKind.running -> "Running cost"
    ExpenseKind.goods -> "Goods"
    ExpenseKind.drawings -> "Drawings"
}

/** An acquisition source is always the same colour; Unclassified is the neutral (`SOURCE_COLORS`). */
@Composable
internal fun anaSourceColor(key: String): Color = when (key) {
    "taheri_spillover" -> anaColor(1)
    "referral" -> anaColor(2)
    "walkin" -> anaColor(3)
    "social_media" -> anaColor(4)
    "website" -> anaColor(5)
    "other" -> anaColor(6)
    else -> MaterialTheme.colorScheme.onSurfaceVariant
}

private fun signed(n: Double): String = (if (n < 0) "−" else "") + Money.pkrLac(abs(n))

// MARK: Revenue over time, the period before dashed beside it

/**
 * One measure over day, week or month buckets: a smooth line over a soft area, and, when asked, the period before as a
 * dashed line on the same axis (first bucket with first, `compareSeries`). A touch reads a bucket.
 */
@Composable
fun AnaTrendChart(rows: List<ComparedRow>, showPrev: Boolean, prevName: String?, modifier: Modifier = Modifier, height: Dp = 180.dp) {
    val accent = ErpColors.accent
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val base = hairline()
    val reveal = rememberReveal()
    val prevShown = showPrev && rows.any { it.prev != null }
    val top = max(rows.maxOfOrNull { it.value } ?: 0.0, if (prevShown) rows.maxOfOrNull { it.prev ?: 0.0 } ?: 0.0 else 0.0)
    var picked by remember(rows) { mutableIntStateOf(-1) }
    val best = rows.maxByOrNull { it.value }
    val spoken = if (rows.isEmpty()) "No sales to chart." else
        "Sales in PKR lac, ${rows.first().tip} to ${rows.last().tip}: total ${Money.lacCrore(rows.sumOf { it.value })}" +
            (best?.let { ", best ${it.tip} with ${Money.lacCrore(it.value)}" } ?: "") +
            (if (prevShown) ", with the period before drawn dashed" else "")
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Canvas(Modifier.fillMaxWidth().height(height).semantics { contentDescription = spoken }.pickSlot(rows.size) { picked = it }) {
            val floor = size.height - 0.5.dp.toPx()
            drawLine(base, Offset(0f, floor), Offset(size.width, floor), strokeWidth = 1.dp.toPx())
            if (rows.isEmpty() || top <= 0) return@Canvas
            val pad = 6.dp.toPx()
            val xs = rows.indices.map { if (rows.size == 1) size.width / 2 else it * (size.width / (rows.size - 1)) }
            fun y(v: Double) = floor - pad - (v / top).toFloat() * (floor - 2 * pad) * reveal
            if (prevShown && rows.size > 1) {
                drawPath(
                    smooth(xs, rows.map { y(it.prev ?: 0.0) }), muted.copy(alpha = 0.7f),
                    style = Stroke(width = 1.5.dp.toPx(), cap = StrokeCap.Round, pathEffect = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 4.dp.toPx()))),
                )
            }
            val ys = rows.map { y(it.value) }
            if (rows.size > 1) {
                val line = smooth(xs, ys)
                val area = Path().apply {
                    addPath(line)
                    lineTo(xs.last(), floor)
                    lineTo(xs.first(), floor)
                    close()
                }
                drawPath(area, accent.copy(alpha = 0.18f))
                drawPath(line, accent, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round))
            }
            if (rows.size < 3) rows.indices.forEach { drawCircle(accent, 4.dp.toPx(), Offset(xs[it], ys[it])) }
            if (picked in rows.indices) {
                drawLine(accent.copy(alpha = 0.4f), Offset(xs[picked], 0f), Offset(xs[picked], floor), strokeWidth = 1.dp.toPx())
                drawCircle(accent, 5.dp.toPx(), Offset(xs[picked], ys[picked]))
            }
        }
        CaptionLine(rows.firstOrNull()?.label ?: "", rows.lastOrNull()?.label)
        if (rows.size > 1) {
            val r = rows.getOrNull(picked)
            Readout(
                r?.let {
                    it.tip + ": " + Money.pkrLac(it.value) + if (prevShown && it.prev != null) " · " + (it.prevLabel ?: "before") + ": " + Money.pkrLac(it.prev!!) else ""
                },
                hint = "Touch the chart to read it.",
            )
        }
        if (prevShown) Legend(listOf("This period" to accent, (prevName ?: "The period before") to muted))
    }
}

// MARK: Waterfall

enum class AnaStepKind { total, change }

/** One step of a waterfall: a total stands on the floor, a change floats from where the last one ended. */
class AnaStep(val label: String, val kind: AnaStepKind, val value: Double)

/**
 * Revenue to profit (and any other run of totals and changes): each bar is one step, the figure under it, the loss
 * steps in the owed tone, a total that is below zero in the late one. Bars below the line are losses.
 */
@Composable
fun AnaWaterfall(steps: List<AnaStep>, modifier: Modifier = Modifier, height: Dp = 180.dp) {
    val reveal = rememberReveal()
    val base = hairline()
    val accent = ErpColors.accent
    val gain = Tone.settled.fill()
    val loss = Tone.owed.fill()
    val bad = Tone.late.fill()
    val link = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)

    // Where each bar starts and ends.
    val from = ArrayList<Double>()
    val to = ArrayList<Double>()
    var running = 0.0
    for (s in steps) {
        if (s.kind == AnaStepKind.total) { from.add(0.0); to.add(s.value); running = s.value } else { from.add(running); running += s.value; to.add(running) }
    }
    val lo = min(0.0, min(from.minOrNull() ?: 0.0, to.minOrNull() ?: 0.0))
    val hi = max(0.0, max(from.maxOrNull() ?: 0.0, to.maxOrNull() ?: 0.0))
    val span = if (hi - lo > 0) hi - lo else 1.0
    val spoken = "From revenue to profit in PKR lac: " + steps.joinToString(", ") { it.label + " " + signed(it.value) }

    Column(modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = spoken }, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Canvas(Modifier.fillMaxWidth().height(height).clearAndSetSemantics {}) {
            val padTop = 6.dp.toPx()
            val h = size.height - padTop - 6.dp.toPx()
            fun y(v: Double) = padTop + ((hi - v) / span).toFloat() * h
            val slot = size.width / max(steps.size, 1)
            val bar = (slot * 0.56f).coerceAtMost(48.dp.toPx())
            val zero = y(0.0)
            drawLine(base, Offset(0f, zero), Offset(size.width, zero), strokeWidth = 1.dp.toPx())
            steps.forEachIndexed { i, s ->
                val a = y(from[i])
                val b = y(to[i])
                val full = max(abs(a - b), 2.dp.toPx())
                // The bar grows out of where it starts (the zero line, or where the last step ended) as the chart arrives.
                val shown = full * reveal
                val rectTop = if (b <= a) a - shown else a
                val color = when {
                    s.kind == AnaStepKind.total && s.value < 0 -> bad
                    s.kind == AnaStepKind.total -> accent
                    s.value < 0 -> loss
                    else -> gain
                }
                drawRoundRect(color, Offset(slot * i + (slot - bar) / 2, rectTop), Size(bar, shown), CornerRadius(min3(bar / 2, 4.dp.toPx())))
                if (i < steps.lastIndex) {
                    val endY = y(to[i])
                    drawLine(link, Offset(slot * i + (slot + bar) / 2, endY), Offset(slot * (i + 1) + (slot - bar) / 2, endY), strokeWidth = 1.dp.toPx())
                }
            }
        }
        Row(Modifier.fillMaxWidth().clearAndSetSemantics {}) {
            for (s in steps) {
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        signed(s.value).removePrefix("PKR ").let { if (s.kind == AnaStepKind.change && s.value > 0) "+$it" else it },
                        style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = TabularDigits, fontWeight = FontWeight.SemiBold),
                        textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Clip,
                    )
                    Text(
                        s.label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center, maxLines = 3, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

// MARK: Grouped and stacked bars, month by month

/** One group of bars: a month, a weekday. [values] go with the chart's series in order; [line] is the one extra measure drawn over them. */
class AnaGroup(val label: String, val values: List<Double>, val line: Double? = null)

/** What a series is called and coloured. */
class AnaSeries(val label: String, val color: Color)

/**
 * Bars by group, one per series beside each other ([stacked] false: In and Out, Est. profit and Running costs) or piled
 * (true: the karats of a month, running costs, goods and drawings). A [line] series (Net) is drawn over grouped bars. Bars
 * and the line may go below zero. [readout] says what a touch picked; the default names every figure.
 */
@Composable
fun AnaBarsChart(
    groups: List<AnaGroup>,
    series: List<AnaSeries>,
    modifier: Modifier = Modifier,
    stacked: Boolean = false,
    lineName: String? = null,
    height: Dp = 200.dp,
    format: (Double) -> String = { Money.pkrLac(it) },
    readout: ((Int) -> String)? = null,
    hint: String = "Touch a bar to read it.",
) {
    val reveal = rememberReveal()
    val base = hairline()
    val ink = MaterialTheme.colorScheme.onSurface
    var picked by remember(groups) { mutableIntStateOf(-1) }
    val lines = groups.map { it.line }
    val hasLine = lineName != null && lines.any { it != null }
    // The scale: a stack is its total; grouped bars their largest and smallest; the line is on the same axis.
    val tops = groups.map { g -> if (stacked) g.values.sumOf { max(0.0, it) } else (g.values.maxOrNull() ?: 0.0) }
    val bottoms = groups.map { g -> if (stacked) 0.0 else (g.values.minOrNull() ?: 0.0) }
    val hi = max(0.0, max(tops.maxOrNull() ?: 0.0, if (hasLine) lines.filterNotNull().maxOrNull() ?: 0.0 else 0.0))
    val lo = min(0.0, min(bottoms.minOrNull() ?: 0.0, if (hasLine) lines.filterNotNull().minOrNull() ?: 0.0 else 0.0))
    val span = if (hi - lo > 0) hi - lo else 1.0
    val spoken = if (groups.isEmpty()) "No bars to chart." else
        "${series.joinToString(" and ") { it.label }} in ${groups.first().label} to ${groups.last().label}: " +
            groups.joinToString("; ") { g -> g.label + " " + g.values.mapIndexed { i, v -> series.getOrNull(i)?.label + " " + format(v) }.joinToString(", ") }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Canvas(Modifier.fillMaxWidth().height(height).semantics { contentDescription = spoken }.pickSlot(groups.size) { picked = it }) {
            val padTop = 6.dp.toPx()
            val h = size.height - padTop - 2.dp.toPx()
            fun y(v: Double) = padTop + ((hi - v) / span).toFloat() * h
            val zero = y(0.0)
            val slot = size.width / max(groups.size, 1)
            val groupWidth = (slot * 0.78f).coerceAtMost(if (stacked) 36.dp.toPx() else 18.dp.toPx() * max(series.size, 1))
            groups.forEachIndexed { gi, g ->
                val dim = if (picked < 0 || picked == gi) 1f else 0.45f
                val left = slot * gi + (slot - groupWidth) / 2
                if (stacked) {
                    var acc = 0.0
                    g.values.forEachIndexed { si, v ->
                        val vv = max(0.0, v)
                        if (vv > 0) {
                            val a = y(acc)
                            val b = y(acc + vv)
                            val bh = (a - b) * reveal
                            drawRect(series[si].color.copy(alpha = dim), Offset(left, a - bh), Size(groupWidth, max(bh, 0f)))
                        }
                        acc += vv
                    }
                } else {
                    val bw = groupWidth / max(series.size, 1)
                    g.values.forEachIndexed { si, v ->
                        if (v != 0.0) {
                            val top = if (v > 0) y(v) else zero
                            val bottom = if (v > 0) zero else y(v)
                            val bh = (bottom - top) * reveal
                            val topShown = if (v > 0) zero - bh else zero
                            drawRoundRect(
                                series[si].color.copy(alpha = dim), Offset(left + bw * si + 1.dp.toPx(), topShown), Size(max(bw - 2.dp.toPx(), 1f), max(bh, 0f)),
                                CornerRadius(min3(bw / 2, 3.dp.toPx())),
                            )
                        }
                    }
                }
            }
            drawLine(base, Offset(0f, zero), Offset(size.width, zero), strokeWidth = 1.dp.toPx())
            if (hasLine) {
                val pts = groups.mapIndexedNotNull { i, g -> g.line?.let { Offset(slot * i + slot / 2, zero + (y(it) - zero) * reveal) } }
                if (pts.size > 1) {
                    val p = Path().apply { moveTo(pts[0].x, pts[0].y); for (k in 1 until pts.size) lineTo(pts[k].x, pts[k].y) }
                    drawPath(p, ink.copy(alpha = 0.8f), style = Stroke(width = 1.5.dp.toPx(), cap = StrokeCap.Round))
                }
                pts.forEach { drawCircle(ink.copy(alpha = 0.9f), 2.5.dp.toPx(), it) }
            }
        }
        CaptionLine(groups.firstOrNull()?.label ?: "", groups.lastOrNull()?.label)
        val g = groups.getOrNull(picked)
        Readout(
            g?.let {
                readout?.invoke(picked) ?: (
                    it.label + ": " + it.values.mapIndexed { i, v -> series.getOrNull(i)?.label + " " + format(v) }.joinToString(" · ") +
                        (if (hasLine && it.line != null) " · $lineName ${format(it.line)}" else "")
                    )
            },
            hint = hint,
        )
        Legend(series.map { it.label to it.color } + (if (hasLine) listOf((lineName ?: "") to ink.copy(alpha = 0.8f)) else emptyList()))
    }
}

// MARK: One bar split into parts

/** One slice of a [AnaStackBar100]. */
class AnaPart(val label: String, val value: Double, val color: Color)

/**
 * The parts of one whole (where the cash came from, new against returning, the karats): a single bar split by share, and
 * under it each part with its figure and percentage. A part of nothing is left out of the bar and the list.
 */
@Composable
fun AnaStackBar100(parts: List<AnaPart>, modifier: Modifier = Modifier, format: (Double) -> String = { Money.pkrLac(it) }, legend: Boolean = true, height: Dp = 14.dp) {
    val shown = parts.filter { it.value > 0 }
    val total = shown.sumOf { it.value }
    val reveal = rememberReveal()
    val track = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.1f)
    val spoken = shown.joinToString(", ") { it.label + " " + format(it.value) + ", " + percentOf(it.value, total) + " percent" }
    Column(modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = spoken }, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Canvas(Modifier.fillMaxWidth().height(height).clearAndSetSemantics {}) {
            drawRoundRect(track, size = size, cornerRadius = CornerRadius(size.height / 2))
            if (total <= 0) return@Canvas
            val gap = 2.dp.toPx()
            val usable = size.width - gap * (shown.size - 1)
            var x = 0f
            shown.forEach { p ->
                val w = (p.value / total).toFloat() * usable
                drawRoundRect(p.color, Offset(x, 0f), Size(max(w * reveal, 0f), size.height), CornerRadius(size.height / 2))
                x += w + gap
            }
        }
        if (legend) {
            Column(Modifier.clearAndSetSemantics {}, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for (p in shown) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(10.dp).clip(CircleShape).background(p.color))
                        Text(p.label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            format(p.value), style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits),
                        )
                        Text(
                            "${percentOf(p.value, total)}%", Modifier.size(width = 40.dp, height = 20.dp), textAlign = TextAlign.End,
                            style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

private fun percentOf(part: Double, whole: Double): Int = if (whole > 0) Math.round(part / whole * 100).toInt() else 0

// MARK: Bars lying down, with a colour and a chip

/** One row of [AnaHBars]: [value] drawn as the bar, [chip] a small word beside the name ("running", "32%"). */
class AnaHBar(val label: String, val value: Double, val color: Color? = null, val chip: String? = null)

/** Names with amounts, bars lying down in the same hue unless a row has its own colour; the biggest fills the track. */
@Composable
fun AnaHBars(rows: List<AnaHBar>, modifier: Modifier = Modifier, format: (Double) -> String = { Money.lacCrore(it) }, spokenFormat: (Double) -> String = { Money.pkrLac(it) }) {
    val top = max(rows.maxOfOrNull { it.value } ?: 0.0, 0.0)
    val reveal = rememberReveal()
    val track = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.1f)
    val accent = ErpColors.accent
    val spoken = rows.joinToString(", ") { it.label + " " + spokenFormat(it.value) + (it.chip?.let { c -> ", $c" } ?: "") }
    Column(modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = spoken }, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        for (b in rows) {
            val share = if (top > 0) (b.value / top).toFloat().coerceIn(0f, 1f) else 0f
            val tint = b.color ?: accent
            Column(Modifier.clearAndSetSemantics {}, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(b.label, Modifier.weight(1f, fill = false), style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (!b.chip.isNullOrEmpty()) {
                        Text(
                            b.chip, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerHighest).padding(horizontal = 8.dp, vertical = 2.dp),
                        )
                    }
                    Box(Modifier.weight(1f))
                    Text(format(b.value), style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits))
                }
                Canvas(Modifier.fillMaxWidth().height(8.dp)) {
                    drawRoundRect(track, size = size, cornerRadius = CornerRadius(size.height / 2))
                    if (share > 0f) drawRoundRect(tint, size = Size(max(size.height, size.width * share * reveal), size.height), cornerRadius = CornerRadius(size.height / 2))
                }
            }
        }
    }
}
