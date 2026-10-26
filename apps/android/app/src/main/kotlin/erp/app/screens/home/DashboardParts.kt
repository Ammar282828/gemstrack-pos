package erp.app.screens.home

import erp.app.ui.morphCard
import erp.app.ui.zoomSource
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Cake
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Hardware
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.PersonOff
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.automirrored.filled.TrendingUp
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import erp.app.ui.DateLeaf
import erp.app.ui.LedgerHeading
import erp.app.ui.MinTouchTarget
import erp.app.ui.Monogram
import erp.app.ui.Motion
import erp.app.ui.NumericText
import erp.app.ui.Pill
import erp.app.ui.PromiseWords
import erp.app.ui.Radius
import erp.app.ui.RowAmount
import erp.app.ui.ShopDate
import erp.app.ui.HeroAmount
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.fill
import erp.app.ui.SegmentedColumn
import erp.app.ui.heroSheen
import erp.app.ui.ledgerCard
import erp.app.ui.reduceMotion
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import erp.core.logic.BalanceState
import erp.core.logic.Money
import erp.core.logic.PromiseState
import erp.core.logic.balanceLine
import erp.core.logic.invoiceSaleValue
import erp.core.models.Invoice
import erp.core.models.InvoiceStatus
import java.time.Instant
import kotlin.math.max
import kotlin.math.roundToInt

// The dashboard's pieces (src/app/page.tsx: Headline, Panel, TaskRow, DueRow, RecentInvoiceRow, the 30-day link;
// DashboardParts.swift), on the ledger: one hero for today, three small cards under it, and each list a card of
// rows that lead with what they are about (a symbol, a promised day, a person). There are no buttons: every card
// and row is a link to the place it names (an owner's "Set today's rate" opens the rate form instead).

// MARK: Small words

/** A card's name in small capitals: "TAKEN TODAY", "OWED TO YOU". */
@Composable
fun DashLabel(text: String, modifier: Modifier = Modifier, large: Boolean = false) {
    Text(
        text.uppercase(),
        modifier,
        style = (if (large) MaterialTheme.typography.labelMedium else MaterialTheme.typography.labelSmall)
            .copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.6.sp),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** The quiet arrow on whatever opens a place. */
@Composable
fun DashChevron() {
    Icon(Icons.Filled.ChevronRight, contentDescription = null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f))
}

/** A tap target that reads as the one spoken line the iPhone gives it, and lets its words stay out of the reader's way. */
@Composable
internal fun DashLink(
    onClick: (() -> Unit)?,
    spoken: String,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val base = if (onClick != null) modifier.clickable(role = Role.Button, onClick = onClick) else modifier
    Box(base.semantics { contentDescription = spoken }) {
        Box(Modifier.clearAndSetSemantics {}) { content() }
    }
}

// MARK: Today

/**
 * The page's one big figure: what was taken today, how many invoices, when the last sale was rung up, and the
 * week's days as bars with today's in the house's accent. The one hero card of the screen, so it carries the sheen.
 */
@Composable
fun DashHero(amount: Double, invoices: Int, lastSale: String?, week: List<DashDay>, onClick: (() -> Unit)?) {
    val line = heroLine(invoices, lastSale)
    DashLink(onClick, "Taken today, ${Money.pkrLac(amount)}, $line") {
        Column(Modifier.heroSheen(padding = 18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                DashLabel("Taken today", Modifier.weight(1f), large = true)
                if (onClick != null) DashChevron()
            }
            HeroAmount(amount, lac = true)
            Text(
                line,
                style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
            )
            if (week.any { it.amount > 0 }) DashWeekBars(week, Modifier.padding(top = 6.dp))
        }
    }
}

/** "No invoices yet today", or "3 invoices · last sale 3:45 pm". */
fun heroLine(invoices: Int, lastSale: String?): String {
    if (invoices == 0) return "No invoices yet today"
    var s = "$invoices invoice${if (invoices == 1) "" else "s"}"
    if (!lastSale.isNullOrEmpty()) s += " · last sale $lastSale"
    return s
}

/**
 * Seven days as bars, no axes: today's in the accent, the six before it faint, on a hairline so a day with nothing
 * still has its place.
 */
@Composable
fun DashWeekBars(days: List<DashDay>, modifier: Modifier = Modifier) {
    val accent = ErpColors.accent
    val hairline = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.2f)
    val top = days.maxOfOrNull { it.amount } ?: 0.0
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Canvas(
            Modifier.fillMaxWidth().height(44.dp).semantics { contentDescription = "Taken each day over the last 7 days" },
        ) {
            val slot = size.width / max(days.size, 1)
            val bar = slot * 0.6f
            val base = size.height - 0.5.dp.toPx()
            days.forEachIndexed { i, d ->
                val h = if (top > 0) ((d.amount / top).toFloat() * (base - 2.dp.toPx())).coerceAtLeast(0f) else 0f
                if (h > 0f) {
                    drawRoundRect(
                        if (i == days.lastIndex) accent else accent.copy(alpha = 0.25f),
                        Offset(slot * i + (slot - bar) / 2, base - h), Size(bar, h), CornerRadius(3.dp.toPx()),
                    )
                }
            }
            drawLine(hairline, Offset(0f, base), Offset(size.width, base), strokeWidth = 1.dp.toPx())
        }
        Row(Modifier.fillMaxWidth().clearAndSetSemantics {}) {
            val quiet = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
            Text("Last 7 days", Modifier.weight(1f), style = MaterialTheme.typography.labelSmall, color = quiet)
            Text("Today", style = MaterialTheme.typography.labelSmall, color = quiet)
        }
    }
}

// MARK: The three cards

/**
 * One of the three small cards under Today: its name, its figure, a line under it. Cards side by side stand the
 * same height (the row is sized to the tallest).
 */
@Composable
fun DashStat(label: String, onClick: (() -> Unit)?, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val link = onClick != null
    val tile = modifier.fillMaxHeight()
    Column(
        (if (link && onClick != null) tile.morphCard(onClick = onClick).padding(12.dp) else tile.ledgerCard(padding = 12.dp)).semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            DashLabel(label, Modifier.weight(1f))
            if (link) DashChevron()
        }
        content()
    }
}

/** A card's sum: "PKR" small beside the lac. */
@Composable
fun DashStatAmount(amount: Double, tint: Color = Color.Unspecified) {
    Row(
        Modifier.clearAndSetSemantics { contentDescription = Money.pkrLac(amount) },
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        Text("PKR", style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold), color = MaterialTheme.colorScheme.onSurfaceVariant)
        NumericText(
            Money.lacCrore(amount), amount, Modifier.weight(1f, fill = false),
            style = MaterialTheme.typography.titleMedium, color = tint, autoSize = true,
        )
    }
}

/** A card's figure that is not money: "5 pieces", "Nil". */
@Composable
fun DashStatValue(text: String, tint: Color = Color.Unspecified) {
    Text(
        text,
        style = MaterialTheme.typography.titleMedium.copy(fontFeatureSettings = TabularDigits),
        color = if (tint == Color.Unspecified) MaterialTheme.colorScheme.onSurface else tint,
        maxLines = 1,
    )
}

/** The line under a card's figure. */
@Composable
fun DashStatNote(text: String, tint: Color = Color.Unspecified) {
    Text(
        text,
        style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits),
        color = if (tint == Color.Unspecified) MaterialTheme.colorScheme.onSurfaceVariant else tint,
        maxLines = 2,
    )
}

/** What the month's pill says: "+12%" once it has passed the whole of last month, else how far along it is ("62% of Sep"). */
class MonthChange(val text: String, val spoken: String, val up: Boolean)

fun monthChange(ratio: Double, now: Instant): MonthChange {
    val last = DashDate.lastMonth(now)
    if (ratio > 1) {
        val up = max(1, ((ratio - 1) * 100).roundToInt())
        return MonthChange("+$up%", "$up% more than all of ${DashDate.monthName(last)}", true)
    }
    val share = (ratio * 100).roundToInt()
    return MonthChange("$share% of ${DashDate.shortMonth(last)}", "$share% of ${DashDate.monthName(last)}", false)
}

/** This month against last, as a pill; the month's name when there is no last month to compare. */
@Composable
fun DashMonthChange(ratio: Double?, now: Instant) {
    if (ratio == null) {
        DashStatNote(DashDate.monthName(now))
        return
    }
    val c = monthChange(ratio, now)
    Pill(c.text, Modifier.clearAndSetSemantics { contentDescription = c.spoken }, tone = if (c.up) Tone.settled else Tone.quiet)
}

// MARK: Headings and cards of rows

/** A section's heading: its name and count, and the web's "All" when there is a list to open. */
@Composable
fun DashHeader(title: String, count: Int? = null, allLabel: String? = null, onAll: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        LedgerHeading(title, Modifier.weight(1f), count = count)
        if (onAll != null) {
            Row(
                Modifier
                    .defaultMinSize(minHeight = MinTouchTarget)
                    .clickable(role = Role.Button, onClick = onAll)
                    .semantics { contentDescription = allLabel ?: "All" },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("All", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium), color = ErpColors.accent)
                Icon(Icons.Filled.ChevronRight, contentDescription = null, Modifier.size(16.dp), tint = ErpColors.accent)
            }
        }
    }
}

/** A list's rows, each its own tile in one segmented group. */
@Composable
fun <T> DashRowsCard(items: List<T>, inset: Dp, modifier: Modifier = Modifier, row: @Composable (T) -> Unit) {
    val reduce = reduceMotion()
    // Each row its own tile (Android 16's grouped list); the hairline and its inset are gone, the gap is the line.
    SegmentedColumn(modifier.animateContentSize(Motion.enter(reduce))) {
        items.forEach { item -> Box(Modifier.padding(horizontal = 14.dp)) { row(item) } }
    }
}

/** What a section says when it has nothing: one quiet line, on its card. */
@Composable
fun DashEmpty(text: String) {
    Column(Modifier.fillMaxWidth().clip(Radius.cardShape).background(ErpColors.card).padding(horizontal = 14.dp)) {
        Text(
            text,
            Modifier.fillMaxWidth().padding(vertical = 16.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** "Needs you" with nothing in it: calm, in the settled tone. */
@Composable
fun DashAllClear() {
    Row(
        Modifier.fillMaxWidth().clip(Radius.cardShape).background(ErpColors.card).padding(horizontal = 14.dp, vertical = 14.dp)
            .clearAndSetSemantics { contentDescription = "All clear: nothing late, unpaid or waiting" },
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.CheckCircle, contentDescription = null, Modifier.size(24.dp), tint = Tone.settled.color())
        Text("All clear", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold))
        Text("Nothing late, unpaid or waiting", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
    }
}

/** "Show 4 more" / "Show less", under a list that has more than three. */
@Composable
fun DashReveal(expanded: Boolean, count: Int, onToggle: () -> Unit) {
    Text(
        if (expanded) "Show less" else "Show $count more",
        Modifier
            .defaultMinSize(minHeight = MinTouchTarget)
            .clickable(role = Role.Button, onClick = onToggle)
            .padding(horizontal = 4.dp, vertical = 12.dp),
        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
        color = ErpColors.accent,
    )
}

/** The web's `<details>` (a DisclosureGroup): a card whose title folds its content, closed to begin with. */
@Composable
fun DashDisclosure(title: String, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    var open by rememberSaveable(title) { mutableStateOf(false) }
    val reduce = reduceMotion()
    val turn by animateFloatAsState(if (open) 0f else -90f, Motion.enter(reduce), label = "disclosure")
    Column(modifier.ledgerCard().animateContentSize(Motion.enter(reduce))) {
        Row(
            Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = MinTouchTarget)
                .clickable(role = Role.Button) { open = !open }
                .semantics { stateDescription = if (open) "Expanded" else "Collapsed" },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold))
            Icon(Icons.Filled.ExpandMore, contentDescription = null, Modifier.rotate(turn), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (open) Column(Modifier.padding(top = 12.dp)) { content() }
    }
}

// MARK: Needs you

private val NEED_SIDE = 30.dp

/** The rows of "Needs you", their symbols sized with the reader's text. */
@Composable
fun DashNeedList(needs: List<DashNeed>, onOpen: (String) -> Unit, onRates: (() -> Unit)?) {
    DashRowsCard(needs, inset = NEED_SIDE + 12.dp) { n -> DashNeedRow(n, onOpen, onRates) }
}

/** Red for what is late, amber for what is owed or soon, quiet for a date worth knowing. */
internal fun needTone(t: DashNeed.Tone): Tone = when (t) {
    DashNeed.Tone.danger -> Tone.late
    DashNeed.Tone.warn -> Tone.owed
    DashNeed.Tone.plain -> Tone.quiet
}

internal fun needSymbol(k: DashNeed.Kind): ImageVector = when (k) {
    DashNeed.Kind.rate -> Icons.AutoMirrored.Filled.TrendingUp
    DashNeed.Kind.online -> Icons.Filled.Language
    DashNeed.Kind.late -> Icons.Filled.Schedule
    DashNeed.Kind.bench -> Icons.Filled.Hardware
    DashNeed.Kind.unassigned -> Icons.Filled.PersonOff
    DashNeed.Kind.unpaid -> Icons.Filled.Payments
    DashNeed.Kind.repairReady -> Icons.Filled.Build
    DashNeed.Kind.birthday -> Icons.Filled.Cake
    DashNeed.Kind.anniversary -> Icons.Filled.Favorite
    DashNeed.Kind.other -> Icons.Filled.ErrorOutline
}

internal fun needSpoken(n: DashNeed): String {
    var s = "${n.title}. ${n.detail}"
    if (n.amount != null) s += ". ${Money.pkrLac(n.amount)}"
    return s
}

/** One thing waiting on a decision: what it is about (a symbol in its tone), what to know, what it comes to. */
@Composable
fun DashNeedRow(need: DashNeed, onOpen: (String) -> Unit, onRates: (() -> Unit)?) {
    val tone = needTone(need.tone)
    val go: () -> Unit = if (need.opensRates && onRates != null) onRates else ({ onOpen(need.path) })
    DashLink(go, needSpoken(need), Modifier.fillMaxWidth().defaultMinSize(minHeight = MinTouchTarget).let { if (need.opensRates) it else it.zoomSource(need.path, Radius.tile) }) {
        Row(Modifier.padding(vertical = 11.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(NEED_SIDE).clip(RoundedCornerShape(NEED_SIDE * 0.3f)).background(tone.fill().copy(alpha = 0.13f)), contentAlignment = Alignment.Center) {
                Icon(needSymbol(need.kind), contentDescription = null, Modifier.size(18.dp), tint = tone.color())
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(need.title, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold), maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(need.detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            if (need.amount != null) RowAmount(need.amount, lac = true)
            DashChevron()
        }
    }
}

// MARK: Due to customers

val DUE_LEAF = 40.dp

/** The leaf's tone: red when late, amber today, quiet otherwise. */
internal fun dueLeafTone(due: DashDue): Tone = when (due.timing.state) {
    PromiseState.late -> Tone.late
    PromiseState.today -> Tone.owed
    else -> Tone.quiet
}

internal fun duePressing(due: DashDue): Boolean = due.timing.state == PromiseState.late || due.timing.state == PromiseState.today

/** "ORD-000123", "Repair · REP-000045"; with the sum when the right-hand side is taken by how it stands. */
internal fun dueRefText(due: DashDue): String = if (duePressing(due) && due.amount > 0) "${due.refLine} · ${Money.pkr(due.amount)}" else due.refLine

internal fun dueSpoken(due: DashDue): String {
    var s = "${due.customer}, ${if (due.isRepair) "repair" else "order"} ${due.ref}, ${PromiseWords.say(due.timing).text}"
    if (due.amount > 0) s += ", ${Money.pkr(due.amount)}"
    return s
}

/** A promise to a customer, an order or a repair: the promised day as a leaf, who, which, and either how it stands (late or today) or what it comes to. */
@Composable
fun DashDueRow(due: DashDue, onOpen: (String) -> Unit) {
    val words = PromiseWords.say(due.timing)
    DashLink({ onOpen(due.path) }, dueSpoken(due), Modifier.fillMaxWidth().defaultMinSize(minHeight = MinTouchTarget).zoomSource(due.path, Radius.tile)) {
        Row(Modifier.padding(vertical = 9.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            DateLeaf(due.timing.due, tone = dueLeafTone(due), size = DUE_LEAF)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(due.customer, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    dueRefText(due),
                    style = MaterialTheme.typography.labelSmall.copy(fontFeatureSettings = TabularDigits),
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            when {
                duePressing(due) -> Pill(words.text, tone = words.tone)
                due.amount > 0 -> RowAmount(due.amount)
                else -> Pill(words.text, tone = Tone.quiet)
            }
            DashChevron()
        }
    }
}

// MARK: Recent sales

val SALE_MONOGRAM = 34.dp

/** Paid, what is still due, or the customer's credit; a refund says so instead. */
class SaleStanding(val text: String, val tone: Tone)

fun saleStanding(invoice: Invoice): SaleStanding {
    if (invoice.status == InvoiceStatus.refunded) return SaleStanding("Refunded", Tone.quiet)
    val b = balanceLine(invoice.balanceDue)
    return when (b.state) {
        BalanceState.paid -> SaleStanding("Paid", Tone.settled)
        BalanceState.due -> SaleStanding("${Money.pkrLac(b.amount)} due", Tone.owed)
        BalanceState.credit -> SaleStanding("In credit", Tone.credit)
    }
}

/** A recent sale: who (a monogram and the name), when, what it was worth, and whether it is paid. */
@Composable
fun DashSaleRow(invoice: Invoice, now: Instant, onOpen: (String) -> Unit) {
    val name = DashText.name(invoice.customerName)
    val whenText = ShopDate.say(invoice.createdAt, withTime = true, now = now)
    val standing = saleStanding(invoice)
    val worth = invoiceSaleValue(invoice)
    DashLink({ onOpen(DashPath.invoice(invoice.id)) }, "$name, $whenText, ${Money.pkrLac(worth)}, ${standing.text}", Modifier.fillMaxWidth().defaultMinSize(minHeight = MinTouchTarget).zoomSource(DashPath.invoice(invoice.id), Radius.tile)) {
        Row(Modifier.padding(vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Monogram(invoice.customerName, size = SALE_MONOGRAM)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(name, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(whenText, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                RowAmount(worth, lac = true)
                Pill(standing.text, tone = standing.tone)
            }
            DashChevron()
        }
    }
}

// MARK: The last 30 days

/**
 * Revenue, expenses and net over the last 30 days, and the days drawn quietly beneath. Expenses and net are the
 * owners' books, so staff see revenue alone.
 */
@Composable
fun DashMonthCard(figures: DashFigures, showCosts: Boolean, onClick: (() -> Unit)?) {
    val net = figures.net30
    val netTint = when {
        net > 0.5 -> Tone.settled.color()
        net < -0.5 -> Tone.late.color()
        else -> Color.Unspecified
    }
    val base = Modifier.ledgerCard()
    Column(
        (if (onClick != null) base.clickable(role = Role.Button, onClick = onClick) else base),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
            MonthStat("Revenue", figures.revenue30, Color.Unspecified, Modifier.weight(1f))
            if (showCosts) {
                MonthStat("Expenses", figures.expenses30, Color.Unspecified, Modifier.weight(1f))
                MonthStat("Net", net, netTint, Modifier.weight(1f))
            }
            if (onClick != null) DashChevron()
        }
        if (figures.revenue30 > 0) MonthChart(figures)
    }
}

@Composable
private fun MonthStat(label: String, value: Double, tint: Color, modifier: Modifier) {
    Column(modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        DashLabel(label)
        NumericText(
            Money.pkrLac(value), value,
            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold), color = tint, autoSize = true,
        )
    }
}

@Composable
private fun MonthChart(figures: DashFigures) {
    val accent = ErpColors.accent
    val days = figures.days
    val top = days.maxOfOrNull { it.amount } ?: 0.0
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Canvas(Modifier.fillMaxWidth().height(72.dp).semantics { contentDescription = "Taken each day over the last 30 days" }) {
            if (days.size < 2 || top <= 0) return@Canvas
            val pad = 2.dp.toPx()
            val step = size.width / (days.size - 1)
            val xs = days.indices.map { it * step }
            val ys = days.map { size.height - pad - (it.amount / top).toFloat() * (size.height - 2 * pad) }
            // A smooth line that never overshoots a day: each segment eases flat into its points.
            val line = Path().apply {
                moveTo(xs[0], ys[0])
                for (i in 1 until days.size) {
                    val mid = (xs[i - 1] + xs[i]) / 2
                    cubicTo(mid, ys[i - 1], mid, ys[i], xs[i], ys[i])
                }
            }
            val area = Path().apply {
                addPath(line)
                lineTo(xs.last(), size.height)
                lineTo(xs.first(), size.height)
                close()
            }
            drawPath(area, accent.copy(alpha = 0.18f))
            drawPath(line, accent, style = Stroke(width = 2.dp.toPx()))
        }
        Row(Modifier.fillMaxWidth().clearAndSetSemantics {}) {
            val quiet = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
            Text(DashDate.dayMonth(figures.days.firstOrNull()?.day ?: figures.now), Modifier.weight(1f), style = MaterialTheme.typography.labelSmall, color = quiet)
            Text("Today", style = MaterialTheme.typography.labelSmall, color = quiet)
        }
    }
}
