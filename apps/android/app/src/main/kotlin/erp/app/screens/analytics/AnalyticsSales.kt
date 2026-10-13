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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import erp.app.screens.home.DashDisclosure
import erp.app.screens.money.Footnote
import erp.app.ui.ActionRow
import erp.app.ui.DividedColumn
import erp.app.ui.FullScreenSheet
import erp.app.ui.LedgerSection
import erp.app.ui.SectionCard
import erp.app.ui.ShopDate
import erp.app.ui.Tone
import erp.app.ui.TwoLine
import erp.app.ui.ValueRow
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.readableColumn
import erp.app.ui.theme.TabularDigits
import erp.core.logic.Money
import erp.core.logic.invoiceSaleValue
import erp.core.models.Invoice
import erp.core.models.InvoiceItem

/**
 * Analytics → Sales (analytics-view.tsx, section "sales"): when the money came in. Sales over time in the period, then
 * the shape of the whole history (months and years, which the period does not bound), then the days one by one. A
 * year's row sets the period to that year; a day's row opens its report.
 */
@Composable
fun AnaSalesPage(figures: AnaFigures, history: AnaHistory, period: AnaPeriodState, showCosts: Boolean, pick: (String) -> Unit) {
    var day by remember { mutableStateOf<AnaDay?>(null) }
    var showDays by remember { mutableStateOf(false) }
    AnaPage(period) {
        AnaColumns(
            left = {
                OverTimeSection(figures)
                MonthlySection(history)
            },
            right = {
                YearlySection(history, showCosts, pick)
                DailySection(figures, showDays, { showDays = !showDays }) { day = it }
            },
        )
    }
    day?.let { d -> AnaDaySheet(d, figures.invoicesByDay[d.date] ?: emptyList(), onDismiss = { day = null }) }
}

// MARK: Sales over time

@Composable
private fun OverTimeSection(f: AnaFigures) {
    SectionCard("Sales over time") {
        if (f.salesOverTime.isEmpty()) {
            Text("No sales data available to display chart for the selected period.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            AnaSalesChart(f.salesOverTime)
        }
        Footnote("Revenue and order count trend for the selected period.", Modifier)
    }
    if (f.salesOverTime.isNotEmpty()) DashDisclosure("Number of sales") { AnaOrdersChart(f.salesOverTime) }
}

// MARK: Revenue by month

@Composable
private fun MonthlySection(h: AnaHistory) {
    if (h.months.isEmpty()) return
    var note = "Every month on record, regardless of the period above."
    if (h.monthlyAverage > 0) {
        note += " Averaging ${Money.pkrLac(h.monthlyAverage)} across months with sales; the best month is green."
    }
    SectionCard("Revenue by month") {
        AnaMonthlyChart(h.months, h.monthlyAverage, h.bestMonth)
        Footnote(note, Modifier)
    }
}

// MARK: Yearly performance

@Composable
private fun YearlySection(h: AnaHistory, showCosts: Boolean, pick: (String) -> Unit) {
    if (h.yearly.isEmpty()) return
    LedgerSection(
        "Yearly performance",
        footer = {
            Text(
                if (showCosts) "All-time revenue, expenses and profit by year. Tap a year to filter Analytics to it."
                else "All-time revenue by year. Tap a year to filter Analytics to it.",
            )
        },
    ) {
        DividedColumn {
            for (y in h.yearly) YearRow(y, showCosts) { pick("year-${y.year}") }
        }
    }
}

@Composable
private fun YearRow(y: AnaYear, showCosts: Boolean, onClick: () -> Unit) {
    val parts = ArrayList<String>()
    parts.add(if (y.unpaid > 0) "Unpaid ${Money.lacCrore(y.unpaid)}" else "Nothing unpaid")
    if (showCosts) {
        parts.add("Expenses ${Money.lacCrore(y.expenses)}")
        parts.add("Est. profit ${Money.lacCrore(y.profit)}")
    }
    Column(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClickLabel = "Show ${y.year}", onClick = onClick).ledgerRow(),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
            Text(y.year.toString(), Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            Text(
                Money.lacCrore(y.revenue),
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits),
            )
        }
        Text(parts.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (showCosts) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    "Net profit ${Money.lacCrore(y.netProfit)}",
                    style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits),
                    color = if (y.netProfit >= 0) Tone.settled.color() else Tone.owed.color(),
                )
                Text(
                    if (y.revenue > 0) "${AnaFormat.fixed(y.netProfit / y.revenue * 100, 1)}% margin" else "—",
                    style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

// MARK: Daily summary

@Composable
private fun DailySection(f: AnaFigures, showAll: Boolean, toggle: () -> Unit, open: (AnaDay) -> Unit) {
    val days = f.salesOverTime
    LedgerSection("Daily summary", footer = { Text("Tap a day for its report.") }) {
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
