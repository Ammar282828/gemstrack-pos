package erp.app.screens.analytics

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import erp.app.ui.ActionRow
import erp.app.ui.DividedColumn
import erp.app.ui.FullScreenSheet
import erp.app.ui.LedgerSection
import erp.app.ui.SegmentedButton
import erp.app.ui.SegmentedButtonDefaults
import erp.app.ui.ShopDate
import erp.app.ui.SingleChoiceSegmentedButtonRow
import erp.app.ui.Switch
import erp.app.ui.TwoLine
import erp.app.ui.ValueRow
import erp.app.ui.ledgerRow
import erp.app.ui.readableColumn
import erp.app.ui.theme.TabularDigits
import erp.core.logic.Bucket
import erp.core.logic.Money
import erp.core.logic.autoBucket
import erp.core.logic.bucketSeries
import erp.core.logic.compareSeries
import erp.core.models.Invoice
import erp.core.models.InvoiceItem
import erp.core.logic.invoiceSaleValue

/**
 * Analytics → Sales (components/analytics/pages/sales.tsx): when did the money come in? The hero is revenue over time
 * (day, week or month) with the period before dashed on the same axis; under it the figures, what the revenue is made
 * of, which weekdays are busy, every month on record, and every day (a row opens that day's invoices and pieces). The
 * years are on Profit.
 */
@Composable
fun AnaSalesPage(l: AnaLedger, period: AnaPeriodState) {
    var day by remember { mutableStateOf<AnaDay?>(null) }
    var showDays by rememberSaveable { mutableStateOf(false) }
    val b = l.books
    val days = remember(b) { b.salesOverTime.map { AnaDay(it.date, it.sales, it.orders, it.itemsSold) } }
    AnaPage(period) {
        TrendCard(l, period)
        AnaFigureRow(
            listOf(
                AnaFig("Sales", b.totalOrders.toString(), "Invoices and booked orders"),
                AnaFig("Average sale", Money.pkrLac(b.averageOrderValue)),
                AnaFig("Pieces sold", AnaFormat.count(b.totalItemsSold), "${AnaFormat.fixed(b.averageItemsPerOrder, 1)} per sale"),
                AnaFig("Discounts given", Money.pkrLac(b.totalDiscounts)),
            ),
        )
        AnaColumns(
            left = {
                MixCard(l)
                WeekdayCard(l)
            },
            right = {
                MonthsCard(l)
                DailySection(days, showDays, { showDays = !showDays }) { day = it }
            },
        )
    }
    day?.let { d -> AnaDaySheet(d, b.invoicesByDay[d.date] ?: emptyList(), onDismiss = { day = null }) }
}

// MARK: Revenue over time

@Composable
private fun TrendCard(l: AnaLedger, period: AnaPeriodState) {
    val b = l.books
    // The grain suits the period until the person picks one; a new period starts over.
    var picked by remember(period) { mutableStateOf<Bucket?>(null) }
    val bucket = picked ?: autoBucket(l.range, l.now)
    var compare by rememberSaveable { mutableStateOf(true) }

    fun rowsFor(grain: Bucket): List<erp.core.logic.ComparedRow> {
        val cur = bucketSeries(b.salesOverTime, grain, l.range, l.now)
        val before = if (l.previous != null && l.prev != null) bucketSeries(l.prev.salesOverTime, grain, l.previous.range, l.now) else null
        return compareSeries(cur, before)
    }
    val rows = remember(l, bucket) { rowsFor(bucket) }
    val best = rows.fold(null as erp.core.logic.ComparedRow?) { m, r -> if (r.value > (m?.value ?: 0.0)) r else m }
    val canCompare = l.previous != null && l.prev != null && l.prev.totalSales > 0
    val grain = bucket.name
    val takeaway = best?.let {
        "Best $grain: ${it.tip} · ${Money.pkrLac(it.value)}" +
            if (canCompare && compare && l.prev != null) " · ${Money.pkrLac(l.prev.totalSales)} ${l.previous?.label}" else ""
    } ?: "No sales in this period"

    AnaChartCard("Revenue over time", takeaway = takeaway) {
        // Under the title, not beside it: on a phone the controls do not fit in the header.
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            val options = listOf(Bucket.day to "Day", Bucket.week to "Week", Bucket.month to "Month")
            options.forEachIndexed { i, (value, label) ->
                SegmentedButton(selected = bucket == value, onClick = { picked = value }, shape = SegmentedButtonDefaults.itemShape(i, options.size), label = { Text(label) })
            }
        }
        if (canCompare) {
            Row(
                Modifier.fillMaxWidth().clickable(role = Role.Switch, onClickLabel = "Compare with ${l.previous?.label}") { compare = !compare },
                horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Compare with ${l.previous?.label}", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Switch(compare, null)
            }
        }
        // The chart swaps along the axis as the grain changes (Reduce Motion: it just changes).
        erp.app.ui.AxisSwap(bucket, forward = { from, to -> to.ordinal >= from.ordinal }) { shown ->
            val shownRows = if (shown == bucket) rows else remember(l, shown) { rowsFor(shown) }
            AnaTrendChart(shownRows, showPrev = canCompare && compare, prevName = l.previous?.let { "Compared with ${it.label}" }, height = 240.dp)
        }
    }
}

// MARK: What the revenue is made of

@Composable
private fun MixCard(l: AnaLedger) {
    val mix = l.books.revenueMix
    val total = mix.sumOf { it.value }
    val top = mix.maxByOrNull { it.value }
    AnaChartCard(
        "Revenue mix",
        takeaway = if (total > 0 && top != null) "${top.label} made ${anaPercent(top.value, total)}% of ${Money.pkrLac(total)}" else "No revenue in this period",
    ) {
        AnaStackBar100(mix.mapIndexed { i, m -> AnaPart(m.label, m.value, anaColor(i + 1)) }, height = 18.dp)
    }
}

// MARK: By weekday

@Composable
private fun WeekdayCard(l: AnaLedger) {
    val days = l.books.byWeekday
    val best = days.fold(null as erp.core.logic.WeekdayRow?) { m, d -> if (d.avg > (m?.avg ?: 0.0)) d else m }
    val groups = remember(days) { days.map { AnaGroup(it.label, listOf(it.avg)) } }
    AnaChartCard(
        "By weekday",
        takeaway = if (best != null && best.avg > 0) "${best.label} is busiest: ${Money.pkrLac(best.avg)} on an average one" else "No sales in this period",
    ) {
        AnaBarsChart(
            groups, listOf(AnaSeries("Average a day", anaColor(1))), height = 160.dp,
            readout = { i ->
                val d = days[i]
                "${d.label}: ${Money.pkrLac(d.avg)} a day · ${Money.pkrLac(d.revenue)} over ${anaPlural(d.days, "day")} · ${anaPlural(d.count, "sale")}"
            },
        )
    }
}

// MARK: Revenue by month

@Composable
private fun MonthsCard(l: AnaLedger) {
    val m = l.monthly ?: return
    if (m.data.isEmpty()) return
    val bestMonth = m.data.firstOrNull { it.key == m.best }
    val rows = remember(m) { m.data.map { AnaMonth(it.key, it.month, it.revenue, it.sales) } }
    AnaChartCard(
        "Every month",
        takeaway = bestMonth?.let { "Best month ${it.month} · ${Money.pkrLac(it.revenue)}; the dashed line is the ${Money.pkrLac(m.average)} average" },
    ) {
        AnaMonthlyChart(rows, m.average, m.best)
    }
}

// MARK: Daily summary

@Composable
private fun DailySection(days: List<AnaDay>, showAll: Boolean, toggle: () -> Unit, open: (AnaDay) -> Unit) {
    LedgerSection("Every day", footer = { Text("${anaPlural(days.size, "day")} with sales. Tap a day for its report.") }) {
        if (days.isEmpty()) {
            Text("No daily data available for the selected period.", Modifier.ledgerRow(), color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            // Newest first: the first five are the latest days, not the oldest.
            val shown = days.asReversed().take(if (showAll) days.size else 5)
            DividedColumn {
                for (d in shown) DayRow(d) { open(d) }
                if (days.size > 5) ActionRow(if (showAll) "Show fewer days" else "Show all days · ${days.size}", onClick = toggle)
            }
        }
    }
}

@Composable
private fun DayRow(d: AnaDay, onClick: () -> Unit) {
    // "Today", "Yesterday", "Tue 6 Oct", "6 Oct 2025": the shop's way of saying a day.
    val said = ShopDate.say(d.date)
    val orders = d.orders.toString() + " " + AnaFormat.plural(d.orders, "order", "orders")
    val items = AnaFormat.count(d.itemsSold) + if (d.itemsSold == 1.0) " item" else " items"
    TwoLine(
        title = said.ifEmpty { d.date },
        modifier = Modifier.clickable(role = Role.Button, onClick = onClick).ledgerRow(),
        subtitle = "$orders · $items",
        trailing = Money.lacCrore(d.sales),
    )
}

/** One day's report: its revenue, the invoices written, and the pieces on them. The web's dialog. */
@Composable
fun AnaDaySheet(day: AnaDay, invoices: List<Invoice>, onDismiss: () -> Unit) {
    val lines: List<InvoiceItem> = invoices.flatMap { it.items }
    FullScreenSheet(title = "Daily report", onCancel = onDismiss, confirmText = "Done", onConfirm = onDismiss, cancelText = "Close") {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(bottom = 32.dp)) {
            Column(Modifier.readableColumn().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                LedgerSection(
                    AnaDate.parseISO(day.date)?.let { AnaDate.longDay(it) } ?: day.date,
                    footer = { Text("Orders and extra revenue are in the totals; the lists are the invoices written this day.") },
                ) {
                    DividedColumn {
                        ValueRow("Total revenue") { Text(Money.pkrLac(day.sales), style = MaterialTheme.typography.bodyLarge.copy(fontFeatureSettings = TabularDigits)) }
                        ValueRow("Total orders") { Text(day.orders.toString(), style = MaterialTheme.typography.bodyLarge) }
                        ValueRow("Pieces sold") { Text(AnaFormat.count(day.itemsSold), style = MaterialTheme.typography.bodyLarge) }
                    }
                }
                LedgerSection("Invoices") {
                    if (invoices.isEmpty()) {
                        Text("No invoices on this day.", Modifier.ledgerRow(), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else {
                        DividedColumn {
                            for (inv in invoices) TwoLine(inv.id, Modifier.ledgerRow(), subtitle = inv.customerName, trailing = Money.lacCrore(invoiceSaleValue(inv)))
                        }
                    }
                }
                LedgerSection("Products sold") {
                    if (lines.isEmpty()) {
                        Text("No pieces sold on this day.", Modifier.ledgerRow(), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else {
                        DividedColumn {
                            for (item in lines) TwoLine(item.name, Modifier.ledgerRow(), subtitle = item.sku, trailing = Money.lacCrore(item.itemTotal))
                        }
                    }
                }
            }
        }
    }
}
