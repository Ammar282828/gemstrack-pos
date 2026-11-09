package erp.app.screens.analytics

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import erp.app.nav.LocalNavigator
import erp.app.screens.home.DashDisclosure
import erp.app.ui.FigureGrid
import erp.app.ui.FigureTile
import erp.app.ui.NumericText
import erp.app.ui.Pill
import erp.app.ui.Radius
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.icons.Symbols
import erp.app.ui.ledgerCard
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.ErpType
import erp.core.logic.Money
import erp.core.logic.Period
import java.time.Instant
import kotlin.math.abs

// The pieces the redesigned Analytics pages are built from (components/analytics/kit.tsx): a headline figure that opens
// the page answering it, a picture with its one sentence (a whole card is a door on the Overview), a row of small
// figures, and the folded "how this is worked out".

/** The books of a page in the shape the redesign reads them: this period, the one before, and the rows by month. */
class AnaLedger(
    val books: erp.core.logic.Books,
    /** The period before ([previous]'s range), null for all time. */
    val prev: erp.core.logic.Books?,
    val previous: erp.core.logic.PreviousPeriod?,
    /** The last twelve calendar months, whatever the period (Profit, Cash, Spending and the metal page). */
    val months: List<erp.core.logic.MonthRow>,
    val years: List<erp.core.logic.YearRow>,
    val monthly: erp.core.logic.MonthlyRevenue?,
    val range: Period?,
    val now: Instant,
    /** The house files its goods as expenses (Mina): its middle step is Gross profit, not an estimate. */
    val recordsGoods: Boolean,
    /** Gold apart from silver (the descriptor's `goldApartMargin`, a percent); null: one revenue, as Taheri keeps. */
    val goldApartMargin: Double? = null,
)

/** The change from the period before, signed, in percent; [better] says whether that move is the good one. */
class AnaDelta(val pct: Double, val better: Boolean)

/**
 * The change from [previous] to [current], or null where there is nothing to compare with (the period before was empty).
 * [upIsGood] false for a figure where less is better.
 */
fun anaDelta(current: Double, previous: Double?, upIsGood: Boolean = true): AnaDelta? {
    if (previous == null || !(abs(previous) > 0)) return null
    val pct = (current - previous) / abs(previous) * 100
    return AnaDelta(pct, if (upIsGood) pct >= 0 else pct <= 0)
}

/** "▲ 12% vs last month": the arrow says the direction, the tone says whether it is good; neither is the colour alone. */
fun anaDeltaWords(d: AnaDelta, against: String): String {
    val flat = abs(d.pct) < 0.5
    val shown = if (abs(d.pct) >= 1000) "999+" else if (abs(d.pct) < 10) AnaFormat.fixed(abs(d.pct), 1) else Math.round(abs(d.pct)).toString()
    return (if (flat) "▬ No change" else (if (d.pct > 0) "▲ " else "▼ ") + "$shown%") + " vs $against"
}

@Composable
private fun DeltaPill(d: AnaDelta, against: String) {
    val flat = abs(d.pct) < 0.5
    Pill(anaDeltaWords(d, against), tone = if (flat) Tone.quiet else if (d.better) Tone.settled else Tone.late)
}

/** A 2 dp line of the period's values under a number, in the house colour. */
@Composable
private fun MiniSpark(values: List<Double>) {
    if (values.size < 2) return
    val accent = ErpColors.accent
    val lo = values.min()
    val hi = values.max()
    val span = if (hi - lo > 0) hi - lo else 1.0
    Canvas(Modifier.fillMaxWidth().height(28.dp).clearAndSetSemantics {}) {
        val pad = 2.dp.toPx()
        val xs = values.indices.map { it * (size.width / (values.size - 1)) }
        val ys = values.map { size.height - pad - ((it - lo) / span).toFloat() * (size.height - 2 * pad) }
        val p = Path().apply { moveTo(xs[0], ys[0]); for (i in 1 until xs.size) lineTo(xs[i], ys[i]) }
        drawPath(p, accent, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round))
    }
}

/**
 * A headline figure. The whole tile opens the page that answers it. [delta] is against the period before (none when it
 * was empty); [sub] one quiet line; [spark] the period's values, drawn under the number.
 */
@Composable
fun AnaKpiTile(
    label: String,
    value: String,
    number: Double,
    modifier: Modifier = Modifier,
    delta: AnaDelta? = null,
    against: String = "the period before",
    sub: String? = null,
    spark: List<Double> = emptyList(),
    tint: Color = Color.Unspecified,
    onOpen: () -> Unit,
) {
    Column(
        modifier.clip(Radius.cardShape).clickable(role = Role.Button, onClickLabel = "Open $label", onClick = onOpen).ledgerCard(glass = true),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            Icon(Symbols.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f))
        }
        NumericText(value, number, style = ErpType.tileValue, color = tint, maxLines = Int.MAX_VALUE)
        if (delta != null) DeltaPill(delta, against)
        if (!sub.isNullOrEmpty()) Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        MiniSpark(spark)
    }
}

/**
 * A picture with its one-sentence takeaway. With [open] the whole card is a door to the page that goes deeper (the
 * Overview: its charts are pictures); [action] is a control in the header and stays tappable. A card on a deep page has
 * neither.
 */
@Composable
fun AnaChartCard(
    title: String,
    modifier: Modifier = Modifier,
    takeaway: String? = null,
    open: (() -> Unit)? = null,
    action: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val door = if (open != null) Modifier.clip(Radius.cardShape).clickable(role = Role.Button, onClickLabel = "$title: see more", onClick = open) else Modifier
    Column(modifier.then(door).ledgerCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, style = ErpType.heading, color = MaterialTheme.colorScheme.onSurface)
                if (!takeaway.isNullOrEmpty()) Text(takeaway, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (action != null) action()
            else if (open != null) Text("See more ›", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        content()
    }
}

/** One small figure of [AnaFigureRow]. */
class AnaFig(val label: String, val value: String, val detail: String? = null, val tone: Tone? = null, val number: Double = 0.0)

/** A set of small figures (the ledger's FigureTile), two across on a phone and more where the window is wide. */
@Composable
fun AnaFigureRow(items: List<AnaFig>) {
    FigureGrid {
        for (i in items) FigureTile(i.label, i.value, detail = i.detail, tint = i.tone?.color() ?: Color.Unspecified, number = i.number)
    }
}

/** "How this is worked out": folded, small and muted, never a paragraph above the numbers. */
@Composable
fun AnaExplain(title: String = "How this is worked out", content: @Composable ColumnScope.() -> Unit) {
    DashDisclosure(title) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp), content = content)
    }
}

@Composable
fun AnaMuted(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** Opens another Analytics page (the period is kept by [AnaPeriodStore]: every tab reads the same one). */
@Composable
fun rememberAnaOpen(): (String) -> Unit {
    val navigator = LocalNavigator.current
    return { path -> navigator.open(path) }
}

/** `pkrLac`, signed: "+PKR 2 lac" / "−PKR 2 lac". */
fun anaSignedLac(n: Double): String = (if (n < 0) "−" else "+") + Money.pkrLac(abs(n))

/** "1 new customer", "3 customers". */
fun anaPlural(n: Int, one: String, many: String = one + "s"): String = "$n " + (if (n == 1) one else many)

/** A whole-number percent of a whole (0 when there is none). */
fun anaPercent(part: Double, whole: Double): Int = if (whole > 0) Math.round(part / whole * 100).toInt() else 0

/** `tola()` of the pages: "12.5 tola". */
fun anaTola(grams: Double): String = AnaFormat.number(AnaFormat.tola(grams), 1) + " tola"
