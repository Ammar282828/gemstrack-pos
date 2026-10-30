package erp.app.screens.analytics

import erp.app.ui.icons.Symbols
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import erp.app.ui.Button
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import erp.app.config.House
import erp.app.data.ErpApi
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.screens.home.DashDisclosure
import erp.app.screens.money.Footnote
import erp.app.screens.money.MoneySheet
import erp.app.screens.money.PickerRow
import erp.app.ui.ActionRow
import erp.app.ui.AppClock
import erp.app.ui.DividedColumn
import erp.app.ui.FigureGrid
import erp.app.ui.FigureTile
import erp.app.ui.LedgerSection
import erp.app.ui.MoneyRow
import erp.app.ui.PdfDocumentScreen
import erp.app.ui.RowAmount
import erp.app.ui.SectionCard
import erp.app.ui.Tone
import erp.app.ui.TwoLine
import erp.app.ui.ValueRow
import erp.app.ui.color
import erp.app.ui.fill
import erp.app.ui.ledgerCard
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import erp.core.ERPDate
import erp.core.logic.MarginSettings
import erp.core.logic.Money
import erp.core.logic.NetProfit
import java.time.LocalDate
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Analytics → Overview (analytics-view.tsx, section "overview"): how the shop is doing in the period. The money
 * figures first, the counts beneath, the gold by weight, the coins on their own, the cash that actually moved, and what
 * the expenses were. Est. profit, expenses and the cash out side are the owners' books: a staff account that reaches
 * this page sees the sales side alone.
 */
@Composable
fun AnaOverviewPage(figures: AnaFigures, period: AnaPeriodState, showCosts: Boolean, margin: MarginSettings) {
    var monthlyPdf by remember { mutableStateOf(false) }
    // The month's PDF is the ERP's own: any month, drawn by the server, the same document the 1st's WhatsApp report carries.
    if (showCosts) {
        ScreenActions {
            IconButton(onClick = { monthlyPdf = true }) { Icon(Symbols.PictureAsPdf, contentDescription = "Monthly PDF") }
        }
    }
    AnaPage(period) {
        AnaColumns(
            left = {
                MoneySection(figures, showCosts, margin)
                TrendSection(figures)
                CountsSection(figures)
                if (!showCosts) StaffNote()
            },
            right = {
                GoldSection(figures)
                CoinsSection(figures)
                CashSection(figures, showCosts)
                if (showCosts) ExpensesSection(figures)
            },
        )
    }
    if (monthlyPdf) MonthlyReportSheet(onDismiss = { monthlyPdf = false })
}

// MARK: Money

@Composable
private fun MoneySection(f: AnaFigures, showCosts: Boolean, margin: MarginSettings) {
    val net = NetProfit.of(f.estProfit, f.totalExpenses)
    val netPct = NetProfit.marginPercent(net, f.totalSales)
    val netDetail = if (f.totalSales > 0) "${AnaFormat.fixed(netPct, 1)}% margin" else "No revenue in period"
    val netTint = if (net >= 0) Tone.settled.color() else Tone.owed.color()
    val assumed = (margin.assumedMargin * 100).roundToInt()
    val costedByGold = margin.rattiLess != null && f.salesCosted > 0
    val estDetail = if (!costedByGold || f.totalSales <= 0) "Revenue × $assumed%"
    else AnaFormat.number((f.estProfit / f.totalSales * 1000).let { Math.floor(it + 0.5) } / 10, 1) + "% of revenue"
    val estNote = if (!costedByGold) "Est. profit is revenue × $assumed%, before expenses."
    else "Est. profit: ${f.salesCosted} of ${f.salesCount} sales from their 24k rate, the rest at $assumed%, before expenses."

    FigureGrid {
        FigureTile("Revenue", Money.pkrLac(f.totalSales), detail = "Sales in this period", tint = Tone.settled.color(), number = f.totalSales)
        if (showCosts) {
            FigureTile("Expenses", Money.pkrLac(f.totalExpenses), detail = "Paid out in this period", tint = Tone.owed.color(), number = f.totalExpenses)
            FigureTile("Est. profit", Money.pkrLac(f.estProfit), detail = estDetail, tint = ErpColors.accent, number = f.estProfit)
            FigureTile("Net profit", Money.pkrLac(net), detail = netDetail, tint = netTint, number = net)
        }
    }
    DashDisclosure("Revenue and profit details") {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            MoneyRow("Invoices", f.invoiceSales, lac = true)
            MoneyRow("Orders", f.orderSales, lac = true)
            MoneyRow("Extra revenue", f.extraRevenue, lac = true)
            if (showCosts) Footnote(estNote, Modifier.padding(horizontal = 0.dp))
        }
    }
}

@Composable
private fun TrendSection(f: AnaFigures) {
    if (f.salesOverTime.isEmpty()) return
    val navigator = LocalNavigator.current
    SectionCard("Revenue over time") {
        AnaRevenueBars(f.salesOverTime)
        ActionRow("Sales details", onClick = { navigator.open("/analytics/sales") }, icon = Symbols.BarChart)
    }
}

// MARK: Counts

@Composable
private fun CountsSection(f: AnaFigures) {
    LedgerSection("Orders and pieces", collapsible = true) {
        DividedColumn {
            if (f.totalUnpaid > 0) ValueRow("Outstanding") { RowAmount(f.totalUnpaid, lac = true, tone = Tone.owed.color()) }
            ValueRow("Orders") { Text(f.totalOrders.toString(), style = MaterialTheme.typography.bodyLarge) }
            ValueRow("Avg. order") { RowAmount(f.averageOrderValue, lac = true) }
            ValueRow("Items sold") { Text(AnaFormat.count(f.totalItemsSold), style = MaterialTheme.typography.bodyLarge) }
            ValueRow("Discounts") { RowAmount(f.totalDiscounts, lac = true) }
            ValueRow("Items / order") { Text(AnaFormat.fixed(f.averageItemsPerOrder, 2), style = MaterialTheme.typography.bodyLarge) }
        }
    }
}

// MARK: Gold sold, by weight

/**
 * Rupees move with the rate; grams do not, and grams are what the shop actually parted with. Both units, because the
 * trade quotes in tola and the scale reads in grams.
 */
@Composable
private fun GoldSection(f: AnaFigures) {
    if (f.goldGrams <= 0) return
    val tolaText = AnaFormat.number(AnaFormat.tola(f.goldGrams), 3) + " tola"
    val weighed = AnaFormat.number(f.goldGrams, 2) + " g · " + AnaFormat.count(f.goldPieces) +
        (if (f.goldPieces == 1.0) " piece" else " pieces") + " weighed"
    LedgerSection("Gold sold") {
        ValueRow("Total") {
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(tolaText, style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold))
                Text(weighed, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    DashDisclosure("By karat") {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            for (k in f.goldByKarat) {
                TwoLine(
                    title = k.karat.uppercase(),
                    subtitle = AnaFormat.number(k.grams, 2) + " g · " + AnaFormat.count(k.pieces),
                    trailing = AnaFormat.number(AnaFormat.tola(k.grams), 3) + " tola",
                )
            }
        }
    }
}

// MARK: Gold coins, on their own

/** A coin sells at the metal price plus a sliver; a ring carries making and margin. Nothing in this section is in the figures above. */
@Composable
private fun CoinsSection(f: AnaFigures) {
    if (f.coinInvoiceCount <= 0) return
    val c = f.coin
    LedgerSection("Gold coins") {
        if (c.invoices > 0) {
            val bills = c.invoices.toString() + " " + AnaFormat.plural(c.invoices, "bill", "bills") + " in this period"
            TwoLine("Coin revenue", Modifier.ledgerRow(), subtitle = bills, trailing = Money.pkrLac(c.revenue))
        } else {
            Text("No coin bills in this period.", Modifier.ledgerRow(), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    if (c.invoices > 0) {
        DashDisclosure("Coin details") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                TwoLine(
                    "Coins sold",
                    subtitle = if (c.grams > 0) AnaFormat.weight(c.grams) else "No weight recorded",
                    trailing = AnaFormat.count(c.coins),
                )
                TwoLine(
                    "Realised / gram",
                    subtitle = "Revenue over grams, all-in",
                    trailing = if (c.ratePerGram > 0) Money.pkrLac(c.ratePerGram) else "—",
                )
                if (c.outstanding >= 1) {
                    TwoLine("Outstanding", subtitle = "Still owed on coin bills", trailing = Money.pkrLac(c.outstanding), trailingTint = Tone.owed.color())
                }
                Footnote("Coin figures are separate from jewellery revenue and profit.", Modifier.padding(horizontal = 0.dp))
            }
        }
    }
}

// MARK: Cash flow

/**
 * Actual money in against out during the period. Revenue counts what was earned, including future cash from open orders
 * and unpaid invoices; cash flow counts only what physically moved.
 */
@Composable
private fun CashSection(f: AnaFigures, showCosts: Boolean) {
    val net = f.netCashFlow
    // Gold taken off an invoice's total is in Cash In but was never in revenue.
    val gap = f.totalSales - (f.cashIn - f.creditPaidBack - f.exchangeOffInvoices)
    val netSign = if (net >= 0) "+" else "−"
    val netTint = if (net >= 0) Tone.settled.color() else Tone.owed.color()
    LedgerSection("Cash flow") {
        DividedColumn {
            TwoLine("Cash in", Modifier.ledgerRow(), trailing = Money.pkrLac(f.cashIn), trailingTint = Tone.settled.color())
            if (showCosts) {
                TwoLine("Cash out", Modifier.ledgerRow(), subtitle = "Every expense paid in this period" + if (f.creditPaidBack > 0) " · Credit paid back: ${Money.pkrLac(f.creditPaidBack)}" else "", trailing = Money.pkrLac(f.cashOut), trailingTint = Tone.owed.color())
                TwoLine(
                    "Net cash flow", Modifier.ledgerRow(),
                    subtitle = if (net >= 0) "Business gained cash in this period" else "Business spent more cash than it took in",
                    trailing = netSign + Money.pkrLac(abs(net)), trailingTint = netTint,
                )
            }
        }
    }
    DashDisclosure("Cash breakdown") {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            for ((label, amount) in cashInParts(f)) {
                Column {
                    MoneyRow(label, amount, lac = true)
                }
            }
            if (gap > 0) {
                Footnote(
                    "${Money.pkrLac(gap)} of recognised revenue is not yet collected: it sits as customer receivables and uninvoiced open orders. That gap is the difference between revenue (what was earned) and Cash in, leaving out gold taken off a bill (it is off the revenue too).",
                    Modifier.padding(horizontal = 0.dp), tone = Tone.owed,
                )
            }
            Footnote("Cash flow counts money received and paid. Revenue also includes unpaid sales and open orders.", Modifier.padding(horizontal = 0.dp))
        }
    }
}

/** What the cash in was made of: invoice payments always, the rest when there was any. */
internal fun cashInParts(f: AnaFigures): List<Pair<String, Double>> {
    val cash = f.cash ?: return listOf("Invoice payments" to 0.0)
    val parts = arrayListOf("Invoice payments" to cash.invoicePayments + cash.paidBack)
    if (cash.orderAdvances > 0) parts.add("Order advances" to cash.orderAdvances)
    if (cash.exchange > 0) parts.add("Exchange" to cash.exchange)
    if (cash.extraRevenue > 0) parts.add("Extra revenue" to cash.extraRevenue)
    return parts
}

// MARK: Expenses by category

@Composable
private fun ExpensesSection(f: AnaFigures) {
    val rows = f.expensesByCategory
    SectionCard("Expenses by category") {
        if (rows.isEmpty()) {
            Text("No expenses recorded for the selected period.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            AnaBarChart(rows.map { AnaBar(it.category, it.category, it.amount) }, tint = Tone.owed.fill().copy(alpha = 0.8f))
        }
    }
    if (rows.isNotEmpty()) {
        DashDisclosure("All categories · ${rows.size}") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                for (e in rows) MoneyRow(e.category, e.amount)
            }
        }
    }
}

@Composable
private fun StaffNote() {
    Column(Modifier.fillMaxWidth().ledgerCard()) {
        Footnote("Expenses, extra revenue and what the shop earns are the owners’ books, so these figures are from sales and orders only.", Modifier.padding(horizontal = 0.dp))
    }
}

// MARK: The monthly PDF

/** The server draws the same monthly document used by the ERP’s scheduled report (Analytics → Monthly PDF). */
@Composable
private fun MonthlyReportSheet(onDismiss: () -> Unit) {
    val months = remember { monthChoices() }
    var selected by remember { mutableIntStateOf(1) }
    var opened by remember { mutableStateOf(false) }
    val picked = months[selected.coerceIn(0, months.lastIndex)]
    MoneySheet(title = "Monthly PDF", onDismiss = onDismiss) {
        Column(Modifier.fillMaxWidth().ledgerCard(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            PickerRow(
                "Month",
                months.mapIndexed { i, m -> i to (m.label + if (i == 0) " · so far" else "") },
                selected, { selected = it },
            )
            Button(onClick = { opened = true }, Modifier.fillMaxWidth()) { Text("Open report") }
        }
    }
    if (opened) {
        Dialog(onDismissRequest = { opened = false }, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
            PdfDocumentScreen(
                title = picked.label,
                fileName = "monthly-report-${picked.key}.pdf",
                load = { ErpApi.shared.bytes(monthlyPath(picked.key), timeoutMs = 150_000) },
                onBack = { opened = false },
            )
        }
    }
}

internal class AnaMonthChoice(val key: String, val label: String)

internal fun monthlyPath(key: String): String = "/api/reports/monthly?month=$key"

/** This month and the 23 before it, Karachi's calendar. */
internal fun monthChoices(): List<AnaMonthChoice> {
    val first = AppClock.now().atOffset(ERPDate.karachi).toLocalDate().withDayOfMonth(1)
    return (0 until 24).map { i ->
        val d: LocalDate = first.minusMonths(i.toLong())
        val at = d.atStartOfDay(ERPDate.karachi).toInstant()
        AnaMonthChoice(AnaDate.monthKey(at), AnaDate.monthLong(at))
    }
}
