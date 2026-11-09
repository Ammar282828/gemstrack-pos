package erp.app.screens.analytics

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import erp.app.config.House
import erp.app.data.ErpApi
import erp.app.nav.ScreenActions
import erp.app.screens.money.MoneySheet
import erp.app.screens.money.PickerRow
import erp.app.ui.AppClock
import erp.app.ui.Button
import erp.app.ui.IconButton
import erp.app.ui.PdfDocumentScreen
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.icons.Symbols
import erp.app.ui.ledgerCard
import erp.core.ERPDate
import erp.core.logic.Money
import java.time.LocalDate
import kotlin.math.roundToInt

/**
 * Analytics → Overview (components/analytics/pages/overview.tsx): how is the shop doing, in one glance. Four headline
 * figures against the period before (Revenue, Net profit, Net cash, Still to collect), then one picture per question
 * (sales over time, revenue to profit, money in and out, what sold, who bought, the metal sold, where the money went, the
 * best pieces), each with one computed sentence. A whole card is a door to the page that answers it in depth; a card with
 * nothing to show is left out rather than drawn empty. The month's PDF stays here.
 */
@Composable
fun AnaOverviewPage(l: AnaLedger, period: AnaPeriodState) {
    var monthlyPdf by remember { mutableStateOf(false) }
    // The month's PDF is the ERP's own: any month, drawn by the server, the same document the 1st's WhatsApp report carries.
    ScreenActions {
        IconButton(onClick = { monthlyPdf = true }) { Icon(Symbols.PictureAsPdf, contentDescription = "Monthly PDF") }
    }
    val open = rememberAnaOpen()
    val b = l.books
    val prev = l.prev
    val against = l.previous?.label ?: "the period before"

    // Revenue per day, week or month (whichever suits the range), the period before on the same axis.
    val trend = remember(l) {
        val bucket = erp.core.logic.autoBucket(l.range, l.now)
        val cur = erp.core.logic.bucketSeries(b.salesOverTime, bucket, l.range, l.now)
        val before = if (l.previous != null && prev != null) erp.core.logic.bucketSeries(prev.salesOverTime, bucket, l.previous.range, l.now) else null
        erp.core.logic.compareSeries(cur, before) to cur.map { it.sales }
    }

    AnaPage(period) {
        AnaTiles(l, trend.second, against, open)
        AnaCardGrid(overviewCards(l, trend.first, open))
    }
    if (monthlyPdf) MonthlyReportSheet(onDismiss = { monthlyPdf = false })
}

// MARK: The four figures

@Composable
private fun AnaTiles(l: AnaLedger, spark: List<Double>, against: String, open: (String) -> Unit) {
    val b = l.books
    val prev = l.prev
    erp.app.ui.FigureGrid {
        AnaKpiTile(
            "Revenue", Money.pkrLac(b.totalSales), b.totalSales, delta = anaDelta(b.totalSales, prev?.totalSales), against = against,
            sub = l.split?.tileLines, spark = spark, onOpen = { open("/analytics/sales") },
        )
        AnaKpiTile(
            "Net profit", Money.pkrLac(b.netProfit), b.netProfit, delta = anaDelta(b.netProfit, prev?.netProfit), against = against,
            sub = "${AnaFormat.fixed(b.netMargin, 0)}% margin", onOpen = { open("/analytics/profit") },
        )
        AnaKpiTile(
            "Net cash", Money.pkrLac(b.netCashFlow), b.netCashFlow, delta = anaDelta(b.netCashFlow, prev?.netCashFlow), against = against,
            sub = "in ${Money.pkrLac(b.cashIn)} · out ${Money.pkrLac(b.cashOut)}", onOpen = { open("/analytics/cash") },
        )
        AnaKpiTile(
            "Still to collect", Money.pkrLac(b.totalUnpaid), b.totalUnpaid, tint = Tone.owed.color(), onOpen = { open("/analytics/cash") },
        )
    }
}

// MARK: One picture per question

/** The Overview's cards in the web's order; a card with nothing to say is not in the list. */
private fun overviewCards(l: AnaLedger, trendRows: List<erp.core.logic.ComparedRow>, open: (String) -> Unit): List<@Composable () -> Unit> {
    val b = l.books
    val metalWord = anaMetalWord()
    val cards = ArrayList<@Composable () -> Unit>()

    // Sales over time
    if (b.salesOverTime.isNotEmpty()) cards.add {
        val bestDay = b.salesOverTime.fold(null as erp.core.logic.SalesDay?) { m, d -> if (d.sales > (m?.sales ?: 0.0)) d else m }
        AnaChartCard(
            "Sales over time", takeaway = bestDay?.let { "Best day ${AnaDate.weekdayDayMonth(it.date)} · ${Money.pkrLac(it.sales)}" } ?: "No sales in this period",
            open = { open("/analytics/sales") },
        ) {
            AnaTrendChart(trendRows, showPrev = l.previous != null, prevName = l.previous?.let { "Compared with ${it.label}" })
            // Gold apart (Mina): the revenue's two metals, gold with its estimated margin.
            l.split?.let { AnaMetalRevenue(it) }
        }
    }

    // Revenue to profit
    if (b.totalSales > 0) cards.add {
        AnaChartCard(
            "From revenue to profit",
            takeaway = if (b.netProfit >= 0) "Kept PKR ${b.netMargin.roundToInt()} of every PKR 100" else "A loss of ${Money.pkrLac(-b.netProfit)} after running costs",
            open = { open("/analytics/profit") },
        ) { AnaWaterfall(profitSteps(l, short = true)) }
    }

    // Money in and out
    if (b.cashIn > 0 || b.cashOut > 0) cards.add {
        AnaChartCard(
            "Money in and out",
            takeaway = "${Money.pkrLac(b.cashIn)} in, ${Money.pkrLac(b.cashOut)} out: net ${if (b.netCashFlow < 0) "−" else ""}${Money.pkrLac(kotlin.math.abs(b.netCashFlow))}",
            open = { open("/analytics/cash") },
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                AnaLabelledStack("In", anaCashInParts(l))
                AnaLabelledStack("Out", anaCashOutParts(l))
            }
        }
    }

    // What sold
    val cats = b.salesByCategory.sortedByDescending { it.sales }.take(5)
    val catTotal = b.salesByCategory.sumOf { it.sales }
    if (cats.isNotEmpty() && catTotal > 0) cards.add {
        AnaChartCard("What sold", takeaway = "${cats[0].categoryName} were ${anaPercent(cats[0].sales, catTotal)}% of sales", open = { open("/analytics/categories") }) {
            AnaHBars(cats.map { AnaHBar(it.categoryName, it.sales) })
        }
    }

    // Who bought
    val buyers = b.newCustomers + b.returningCustomers
    if (buyers > 0) cards.add {
        val topSource = b.sourceBreakdown.filter { it.key != "unclassified" && it.revenue > 0 }.maxByOrNull { it.revenue }
        AnaChartCard(
            "Who bought",
            takeaway = if (b.newCustomers > 0) "${anaPlural(b.newCustomers, "new customer")} brought ${Money.pkrLac(b.revenueFromNew)}"
            else "${anaPlural(b.returningCustomers, "returning customer")} brought ${Money.pkrLac(b.revenueFromReturning)}, none new",
            open = { open("/analytics/customers") },
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                AnaLabelledStack("Customers", listOf(AnaPartSpec("New", b.newCustomers.toDouble(), 1), AnaPartSpec("Returning", b.returningCustomers.toDouble(), 2))) { it.roundToInt().toString() }
                AnaLabelledStack("Revenue", listOf(AnaPartSpec("New", b.revenueFromNew, 1), AnaPartSpec("Returning", b.revenueFromReturning, 2)))
                if (topSource != null) AnaMuted("Most came through ${topSource.label} · ${Money.pkrLac(topSource.revenue)}")
            }
        }
    }

    // Metal sold (hidden when nothing was weighed and no coins)
    val coins = b.coinSummary
    if (b.metalGrams > 0 || coins.coins > 0) cards.add {
        val topKarat = b.metalByKarat.maxByOrNull { it.grams }
        AnaChartCard(
            "$metalWord sold",
            takeaway = if (b.metalGrams > 0) "${anaTola(b.metalGrams)} left the shop${topKarat?.let { ", mostly ${it.karat}" } ?: ""}"
            else "${anaPlural(coins.coins.roundToInt(), "coin")} sold, no jewellery weighed",
            open = { open("/analytics/metal") },
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (b.metalGrams > 0) AnaLabelledStack(null, b.metalByKarat.map { AnaPartSpec(it.karat, it.grams, karat = it.karat) }) { anaTola(it) }
                if (coins.coins > 0) AnaMuted("$metalWord coins, apart: ${anaPlural(coins.coins.roundToInt(), "coin")} · ${anaTola(coins.grams)} · ${Money.pkrLac(coins.revenue)}")
            }
        }
    }

    // Where the money went
    val spend = b.expensesByCategory.sortedByDescending { it.amount }.take(5)
    if (b.totalExpenses > 0 && spend.isNotEmpty()) cards.add {
        AnaChartCard(
            "Where the money went",
            takeaway = "${Money.pkrLac(b.totalExpenses)} spent, ${anaPercent(spend[0].amount, b.totalExpenses)}% on ${spend[0].category}",
            open = { open("/analytics/spending") },
        ) {
            AnaHBars(spend.map { AnaHBar(it.category, it.amount, anaKindColor(it.kind), anaKindLabel(it.kind).lowercase()) })
        }
    }

    // Best pieces
    val pieces = b.topProductsByRevenue.take(5)
    if (pieces.isNotEmpty()) cards.add {
        AnaChartCard("Best pieces", takeaway = "${pieces[0].name} led with ${Money.pkrLac(pieces[0].revenue)}", open = { open("/analytics/products") }) {
            AnaHBars(pieces.map { AnaHBar(it.name, it.revenue) })
        }
    }
    return cards
}

/** Revenue to profit as the web's two waterfalls draw it: the Overview's short words, Profit's long ones. */
internal fun profitSteps(l: AnaLedger, short: Boolean): List<AnaStep> {
    val b = l.books
    val goods = l.recordsGoods
    val profitWord = if (goods) "Gross profit" else if (short) "Profit" else "Est. profit"
    return listOf(
        AnaStep("Revenue", AnaStepKind.total, b.totalSales),
        AnaStep(if (goods) (if (short) "Goods" else "Goods bought") else (if (short) "Pieces cost" else "Cost of pieces (est.)"), AnaStepKind.change, -maxOf(0.0, b.costOfPieces)),
        AnaStep(profitWord, AnaStepKind.total, b.estProfitAdj),
        AnaStep(if (short) "Running" else "Running costs", AnaStepKind.change, -b.runningExpenses),
        AnaStep("Net profit", AnaStepKind.total, b.netProfit),
    )
}

/** Where the cash came from (`inParts` of the web's Overview and Cash). */
internal fun anaCashInParts(l: AnaLedger): List<AnaPartSpec> {
    val b = l.books
    return listOf(
        AnaPartSpec("Invoice payments", b.cashInFromInvoicePayments, 1),
        AnaPartSpec("Order advances", b.cashInFromOrderAdvances, 2),
        AnaPartSpec("Exchange", b.cashInFromExchange, 3),
        AnaPartSpec("Extra revenue", b.cashInFromExtraRevenue, 4),
    )
}

/** Where the cash went: running costs, goods, drawings, and credit handed back. */
internal fun anaCashOutParts(l: AnaLedger): List<AnaPartSpec> {
    val b = l.books
    return listOf(
        AnaPartSpec(anaKindLabel(erp.core.logic.ExpenseKind.running), b.cashOutRunning, kind = erp.core.logic.ExpenseKind.running),
        AnaPartSpec(anaKindLabel(erp.core.logic.ExpenseKind.goods), b.cashOutGoods, kind = erp.core.logic.ExpenseKind.goods),
        AnaPartSpec(anaKindLabel(erp.core.logic.ExpenseKind.drawings), b.cashOutDrawings, kind = erp.core.logic.ExpenseKind.drawings),
        AnaPartSpec("Credit paid back", b.creditPaidBack, 4),
    )
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
