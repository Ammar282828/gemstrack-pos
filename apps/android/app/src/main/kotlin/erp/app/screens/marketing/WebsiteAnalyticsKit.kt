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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.TrendingDown
import androidx.compose.material.icons.automirrored.filled.TrendingUp
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DateRangePicker
import androidx.compose.material3.DateRangePickerState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDateRangePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.layout
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import erp.app.screens.ads.AdsRow
import erp.app.screens.ads.AdsSection
import erp.app.ui.LedgerHeading
import erp.app.ui.NumericText
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.ErpType
import erp.app.ui.theme.TabularDigits
import erp.core.ERPDate
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import kotlin.math.max

// The report's pieces that Interest and Live share (WebsiteAnalyticsKit.swift, WebsiteInterestParts.swift): a figure
// with its change, ranked lists with a small switch in the header and no rows that open, the chart, the funnel, the
// sources table and the custom-period dialog. The words are in WebsiteAnalyticsModels.kt.

/** A chip row's own 16 dp edge lies over the page's, so the row reaches the screen's edge instead of being doubly inset. */
fun Modifier.fullBleed(by: Dp = 16.dp): Modifier = layout { measurable, constraints ->
    val edge = by.roundToPx()
    val wider = if (constraints.hasBoundedWidth) constraints.copy(maxWidth = constraints.maxWidth + 2 * edge) else constraints
    val placeable = measurable.measure(wider)
    layout(constraints.maxWidth, placeable.height) { placeable.place(-edge, 0) }
}

// MARK: Delta and tile

/** Against the period before: up green, down red; [invert] where down is good (bounce rate). Nothing without a before. */
@Composable
fun SiteDelta(now: Double, before: Double, invert: Boolean = false, modifier: Modifier = Modifier) {
    if (before <= 0) return
    if (SiteDeltaLogic.same(now, before)) {
        Text("same as before", modifier, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    val c = SiteDeltaLogic.change(now, before, invert) ?: return
    val tone = if (c.good) Tone.settled else Tone.problem
    Row(
        modifier.clearAndSetSemantics { contentDescription = c.spoken },
        horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(if (c.up) Icons.AutoMirrored.Filled.TrendingUp else Icons.AutoMirrored.Filled.TrendingDown, contentDescription = null, Modifier.size(14.dp), tint = tone.color())
        Text(c.text, style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits), color = tone.color())
    }
}

/** A figure with its change against the period before and a line of detail. */
@Composable
fun SiteTile(
    label: String, value: String, modifier: Modifier = Modifier, now: Double? = null, before: Double? = null, invert: Boolean = false, detail: String? = null,
) {
    Column(modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        NumericText(value, now ?: 0.0, style = ErpType.tileValue, maxLines = Int.MAX_VALUE)
        if (now != null && before != null) SiteDelta(now, before, invert)
        if (!detail.isNullOrEmpty()) Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// MARK: One block

/**
 * A titled card of the report. [options] (two names) put a small segmented switch beside the title, bound to [choice]
 * (the web's header switch: Sources | Kinds, Cities | Countries); no row opens into others.
 */
@Composable
fun SiteBlock(
    title: String, modifier: Modifier = Modifier, note: String? = null, options: List<String> = emptyList(), choice: Int = 0, onChoice: (Int) -> Unit = {},
    divided: Boolean = true, content: @Composable () -> Unit,
) {
    AdsSection(
        title = if (options.size > 1) null else title, modifier = modifier, divided = divided,
        header = if (options.size > 1) ({
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box1(Modifier.weight(1f)) { LedgerHeading(title) }
                SingleChoiceSegmentedButtonRow(Modifier.widthIn(max = 220.dp)) {
                    options.forEachIndexed { i, name ->
                        SegmentedButton(
                            selected = choice == i, onClick = { onChoice(i) }, shape = SegmentedButtonDefaults.itemShape(i, options.size),
                            label = { Text(name, maxLines = 1) }, icon = {},
                        )
                    }
                }
            }
        }) else null,
        footer = if (note != null) ({ Text(note) }) else null,
        content = content,
    )
}

/** A weighted slot (a Box with no look of its own). */
@Composable
private fun Box1(modifier: Modifier, content: @Composable () -> Unit) = androidx.compose.foundation.layout.Box(modifier) { content() }

// MARK: Ranked lists

/**
 * A card of ranked rows: the first few, then "Show all". With [alt] and two [picks], a small switch in the header
 * changes the list between the two. Hidden when it has no rows and no [empty] words.
 */
@Composable
fun SiteRankSection(
    title: String, rows: List<SiteRankRow>, modifier: Modifier = Modifier, total: Int? = null, empty: String? = null, note: String? = null,
    show: Int = 5, alt: List<SiteRankRow>? = null, picks: List<String> = emptyList(),
) {
    if (rows.isEmpty() && alt.isNullOrEmpty() && empty == null) return
    var all by remember { mutableStateOf(false) }
    var second by remember { mutableIntStateOf(0) }
    val switchable = alt != null && picks.size > 1
    val list = if (second == 1 && switchable) alt.orEmpty() else rows
    SiteBlock(
        title, modifier, note, if (switchable) picks else emptyList(), second, { all = false; second = it },
    ) {
        if (list.isEmpty()) {
            AdsRow { Text(empty ?: "", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        } else {
            val parentTotal = total ?: list.sumOf { it.value }
            val top = max(1, list.maxOf { it.value })
            for (r in if (all) list else list.take(show)) SiteRankLine(r, parentTotal, top)
            if (list.size > show) {
                AdsRow(onClick = { all = !all }) {
                    Text(if (all) "Show fewer" else "Show all ${list.size}", style = MaterialTheme.typography.bodyLarge, color = ErpColors.accent)
                }
            }
        }
    }
}

@Composable
private fun SiteRankLine(row: SiteRankRow, parentTotal: Int, top: Int) {
    val share = if (parentTotal > 0) row.value.toDouble() / parentTotal else 0.0
    AdsRow(Modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (row.lead != null) Text(row.lead, Modifier.clearAndSetSemantics {})
            Column(Modifier.weight(1f)) {
                Text(row.label, style = MaterialTheme.typography.bodyLarge)
                if (row.sub != null) Text(row.sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(SiteWords.number(row.value), style = MaterialTheme.typography.bodyLarge.copy(fontFeatureSettings = TabularDigits))
            Text(SiteWords.pct(share), style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        SiteBar(row.value.toDouble() / top)
    }
}

/** The thin bar under a row or a funnel step, in the accent. */
@Composable
private fun SiteBar(fraction: Double) {
    LinearProgressIndicator(
        progress = { fraction.coerceIn(0.0, 1.0).toFloat() },
        modifier = Modifier.fillMaxWidth().height(4.dp).clearAndSetSemantics {},
        color = ErpColors.accent,
        trackColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.18f),
        gapSize = 0.dp,
        drawStopIndicator = {},
    )
}

// MARK: Chart

/**
 * Sessions day by day with visitors and WhatsApp enquiries; for a one-day period, by the hour with the day before faint.
 * One accent family: sessions pale, WhatsApp full, visitors grey.
 */
@Composable
fun SiteChartSection(report: SiteReport, modifier: Modifier = Modifier) {
    val hours = report.hours
    if (hours != null) {
        SiteBlock("Sessions by the hour", modifier, note = "Karachi time; the faint shape is the day before", divided = false) {
            AdsRow { SiteHoursChart(hours) }
        }
    } else if (report.series.size > 1) {
        SiteBlock("Sessions, day by day", modifier, divided = false) {
            AdsRow { SiteDaysChart(report.series) }
        }
    }
}

@Composable
private fun SiteDaysChart(days: List<SiteDay>) {
    val accent = ErpColors.accent
    val grey = MaterialTheme.colorScheme.onSurfaceVariant
    val base = grey.copy(alpha = 0.2f)
    val top = max(1, days.maxOf { max(it.sessions, max(it.visitors, it.enquiries)) }).toFloat()
    var picked by remember(days) { mutableIntStateOf(-1) }
    val spoken = "Sessions each day, with visitors and WhatsApp enquiries. " + days.joinToString(", ") { "${SiteWords.shortDay(it.day)} ${it.sessions}" }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Canvas(
            Modifier.fillMaxWidth().height(200.dp).semantics { contentDescription = spoken }
                .pointerInput(days.size) { detectTapGestures { p -> picked = ((p.x / size.width) * days.size).toInt().coerceIn(0, days.size - 1) } }
                .pointerInput(days.size) { detectHorizontalDragGestures { c, _ -> picked = ((c.position.x / size.width) * days.size).toInt().coerceIn(0, days.size - 1) } },
        ) {
            val slot = size.width / days.size
            val bar = (slot * 0.7f).coerceIn(2.dp.toPx(), 28.dp.toPx())
            val floor = size.height - 0.5.dp.toPx()
            val span = floor - 4.dp.toPx()
            days.forEachIndexed { i, d ->
                val h = d.sessions / top * span
                if (h > 0f) {
                    val a = if (picked == i || picked < 0) 0.35f else 0.2f
                    drawRoundRect(accent.copy(alpha = a), Offset(slot * i + (slot - bar) / 2, floor - h), Size(bar, h), CornerRadius(minOf(bar / 2, 3.dp.toPx())))
                }
            }
            drawLine(base, Offset(0f, floor), Offset(size.width, floor), strokeWidth = 1.dp.toPx())
            fun line(color: androidx.compose.ui.graphics.Color, pick: (SiteDay) -> Int) {
                val path = Path()
                days.forEachIndexed { i, d ->
                    val x = slot * i + slot / 2
                    val y = floor - pick(d) / top * span
                    if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
                }
                drawPath(path, color, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
            }
            line(grey) { it.visitors }
            line(accent) { it.enquiries }
        }
        Row(Modifier.fillMaxWidth().clearAndSetSemantics {}) {
            Text(SiteWords.shortDay(days.first().day), Modifier.weight(1f), style = MaterialTheme.typography.labelSmall, color = grey)
            Text(SiteWords.shortDay(days.last().day), style = MaterialTheme.typography.labelSmall, color = grey)
        }
        val p = days.getOrNull(picked)
        Text(
            if (p != null) "${SiteWords.shortDay(p.day)}: ${p.sessions} sessions · ${p.visitors} visitors · ${p.enquiries} on WhatsApp" else "Touch the chart to read a day.",
            style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits, fontWeight = if (p == null) FontWeight.Normal else FontWeight.Medium),
            color = if (p == null) grey else MaterialTheme.colorScheme.onSurface,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Legend("Sessions", accent.copy(alpha = 0.35f))
            Legend("Visitors", grey)
            Legend("WhatsApp", accent)
        }
    }
}

@Composable
private fun Legend(name: String, color: androidx.compose.ui.graphics.Color) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Canvas(Modifier.size(10.dp)) { drawCircle(color) }
        Text(name, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun SiteHoursChart(hours: List<SiteHour>) {
    val accent = ErpColors.accent
    val grey = MaterialTheme.colorScheme.onSurfaceVariant
    val top = max(1, hours.maxOf { max(it.sessions, it.before) }).toFloat()
    var picked by remember(hours) { mutableIntStateOf(-1) }
    val spoken = "Sessions each hour of the day, Karachi time. " + hours.filter { it.sessions > 0 }.joinToString(", ") { "%02d:00 ${it.sessions}".format(it.hour) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Canvas(
            Modifier.fillMaxWidth().height(200.dp).semantics { contentDescription = spoken }
                .pointerInput(hours.size) { detectTapGestures { p -> picked = ((p.x / size.width) * hours.size).toInt().coerceIn(0, hours.size - 1) } }
                .pointerInput(hours.size) { detectHorizontalDragGestures { c, _ -> picked = ((c.position.x / size.width) * hours.size).toInt().coerceIn(0, hours.size - 1) } },
        ) {
            val slot = size.width / hours.size
            val bar = (slot * 0.7f).coerceAtLeast(2.dp.toPx())
            val floor = size.height - 0.5.dp.toPx()
            val span = floor - 4.dp.toPx()
            // The day before: a faint area behind the bars.
            val area = Path()
            area.moveTo(0f, floor)
            hours.forEachIndexed { i, h -> area.lineTo(slot * i + slot / 2, floor - h.before / top * span) }
            area.lineTo(size.width, floor)
            area.close()
            drawPath(area, grey.copy(alpha = 0.2f))
            hours.forEachIndexed { i, h ->
                val ht = h.sessions / top * span
                if (ht > 0f) drawRoundRect(if (picked == i || picked < 0) accent else accent.copy(alpha = 0.45f), Offset(slot * i + (slot - bar) / 2, floor - ht), Size(bar, ht), CornerRadius(minOf(bar / 2, 3.dp.toPx())))
            }
            drawLine(grey.copy(alpha = 0.2f), Offset(0f, floor), Offset(size.width, floor), strokeWidth = 1.dp.toPx())
        }
        Row(Modifier.fillMaxWidth().clearAndSetSemantics {}, horizontalArrangement = Arrangement.SpaceBetween) {
            for (h in listOf("00", "06", "12", "18")) Text(h, style = MaterialTheme.typography.labelSmall, color = grey)
        }
        val p = hours.getOrNull(picked)
        Text(
            if (p != null) "%02d:00: ${p.sessions} sessions (the day before ${p.before})".format(p.hour) else "Touch the chart to read an hour.",
            style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits, fontWeight = if (p == null) FontWeight.Normal else FontWeight.Medium),
            color = if (p == null) grey else MaterialTheme.colorScheme.onSurface,
        )
    }
}

// MARK: Funnel

/** Visited -> opened a piece -> saved -> asked on WhatsApp: each step's share of all visits and of the step before. */
@Composable
fun SiteFunnelSection(now: SiteSummary, before: SiteSummary, modifier: Modifier = Modifier) {
    class Step(val label: String, val n: Int, val b: Int)
    val steps = listOf(
        Step("Visited", now.funnel.sessions, before.funnel.sessions),
        Step("Opened a piece", now.funnel.piece, before.funnel.piece),
        Step("Saved a piece", now.funnel.save, before.funnel.save),
        Step("Asked on WhatsApp", now.funnel.enquire, before.funnel.enquire),
    )
    val top = max(1, steps[0].n)
    SiteBlock("From a visit to a WhatsApp message", modifier) {
        steps.forEachIndexed { i, s ->
            val ofVisits = if (steps[0].n > 0) s.n.toDouble() / steps[0].n else 0.0
            AdsRow(Modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(s.label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                    Text(SiteWords.number(s.n), style = MaterialTheme.typography.bodyLarge.copy(fontFeatureSettings = TabularDigits))
                    if (i > 0) Text(SiteWords.pct(ofVisits, 1) + " of visits", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    SiteDelta(s.n.toDouble(), s.b.toDouble())
                }
                SiteBar(s.n.toDouble() / top)
                if (i > 0 && steps[i - 1].n > 0) {
                    Text(
                        SiteWords.pct(s.n.toDouble() / steps[i - 1].n, 1) + " of those who " + steps[i - 1].label.lowercase(),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

// MARK: Sources that bring enquiries

/** Each source's sessions and how far they got: Shopify's "conversion by source". */
@Composable
fun SiteSourcesSection(sources: List<SiteSource>, modifier: Modifier = Modifier) {
    if (sources.isEmpty()) return
    var all by remember { mutableStateOf(false) }
    val top = sources.take(15)
    fun share(n: Int, of: Int) = if (of > 0) SiteWords.pct(n.toDouble() / of) else "—"
    SiteBlock("Which sources bring enquiries", modifier, note = "Of each source's sessions, the share that reached each step") {
        for (s in if (all) top else top.take(5)) {
            AdsRow(Modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(SiteWords.source(s.key), Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                    Text(SiteWords.number(s.sessions) + if (s.sessions == 1) " session" else " sessions", style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text("Opened a piece ${share(s.piece, s.sessions)} · Saved ${share(s.save, s.sessions)}", style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
                // WhatsApp is the one coloured thing on the row, and only when someone asked.
                val pct = if (s.sessions > 0) " · " + SiteWords.pct(s.enquire.toDouble() / s.sessions, 1) else ""
                Text(
                    "${s.enquire} on WhatsApp$pct",
                    style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits, fontWeight = if (s.enquire > 0) FontWeight.SemiBold else FontWeight.Normal),
                    color = if (s.enquire > 0) Tone.settled.color() else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (top.size > 5) AdsRow(onClick = { all = !all }) { Text(if (all) "Show fewer" else "Show all ${top.size}", style = MaterialTheme.typography.bodyLarge, color = ErpColors.accent) }
    }
}

// MARK: Custom period

/** Two days, in Karachi time as the site counts them (SiteCustomRangeSheet). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SiteCustomRangeDialog(from: String, to: String, onDismiss: () -> Unit, onApply: (String, String) -> Unit) {
    fun utc(d: LocalDate) = d.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
    fun day(s: String): LocalDate? = runCatching { LocalDate.parse(s) }.getOrNull()
    val today = LocalDate.parse(ERPDate.karachiDay(erp.app.ui.AppClock.now()))
    val state: DateRangePickerState = rememberDateRangePickerState(
        initialSelectedStartDateMillis = utc(day(from) ?: today.minusDays(29)),
        initialSelectedEndDateMillis = utc(day(to) ?: today),
        selectableDates = object : SelectableDates {
            override fun isSelectableDate(utcTimeMillis: Long): Boolean = utcTimeMillis <= utc(today)
        },
    )
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = {
                val a = state.selectedStartDateMillis?.let { Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate() }
                val b = state.selectedEndDateMillis?.let { Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate() } ?: a
                if (a != null && b != null) onApply(minOf(a, b).toString(), maxOf(a, b).toString())
                onDismiss()
            }) { Text("Apply") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    ) {
        DateRangePicker(
            state, Modifier.height(500.dp),
            title = { Text("Custom period", Modifier.padding(start = 24.dp, top = 16.dp), style = MaterialTheme.typography.titleMedium) },
            headline = { Text("Days are Karachi days, as the website counts them.", Modifier.padding(horizontal = 24.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) },
        )
    }
}
