package erp.app.screens.analytics

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import erp.app.nav.LocalNavigator
import erp.app.screens.home.DashDisclosure
import erp.app.screens.money.Footnote
import erp.app.screens.money.MoneySearchField
import erp.app.ui.ActionRow
import erp.app.ui.DividedColumn
import erp.app.ui.LedgerSection
import erp.app.ui.SectionCard
import erp.app.ui.TwoLine
import erp.app.ui.ledgerRow
import erp.core.logic.Money

/**
 * Analytics → Customers (analytics-view.tsx section "customers" and customer-breakdown.tsx): the ten who spent most in
 * the period, where revenue comes from by how the customer found the shop, then everyone who bought, searchable and
 * sorted by spending, number of sales or average sale. Every walk-in is the one row (walk-in.ts).
 */
@Composable
fun AnaCustomersPage(figures: AnaFigures, rows: List<AnaBreakdown.CustomerRow>, period: AnaPeriodState, ledger: AnaLedger) {
    var search by rememberSaveable { mutableStateOf("") }
    var sort by rememberSaveable { mutableIntStateOf(0) }
    var showAll by rememberSaveable { mutableStateOf(false) }
    var showTop by rememberSaveable { mutableStateOf(false) }
    AnaPage(period) {
        FlowCard(ledger)
        CustomerFigures(ledger)
        AnaColumns(
            left = {
                TopChart(ledger)
                TopSection(figures, showTop) { showTop = !showTop }
                SourceSection(figures, ledger)
            },
            right = {
                MoneySearchField(search, { search = it }, "Search everyone by name")
                AllSection(rows, search, sort, { sort = it }, showAll) { showAll = !showAll }
            },
        )
    }
}

// MARK: New and returning

/** New against returning customers per day, week or month (a customer is new in the bucket of their first-ever sale; walk-ins are in neither). */
@Composable
private fun FlowCard(l: AnaLedger) {
    val b = l.books
    val named = b.newCustomers + b.returningCustomers
    val flow = remember(l) { erp.core.logic.bucketCustomerFlow(b.customerDays, erp.core.logic.autoBucket(l.range, l.now), l.range, l.now) }
    val groups = remember(flow) { flow.map { AnaGroup(it.label, listOf(it.newCustomers.toDouble(), it.returningCustomers.toDouble())) } }
    val takeaway = if (named == 0) "No named customers bought in this period."
    else "${anaPlural(b.newCustomers, "new customer")} brought ${Money.pkrLac(b.revenueFromNew)}; ${b.returningCustomers} returning brought ${Money.pkrLac(b.revenueFromReturning)}."
    AnaChartCard("New and returning customers", takeaway = takeaway) {
        if (named > 0) {
            AnaBarsChart(
                groups, listOf(AnaSeries("New", anaColor(1)), AnaSeries("Returning", anaColor(2))), stacked = true, height = 200.dp,
                format = { v -> anaPlural(Math.round(v).toInt(), "customer") },
            )
        }
    }
}

@Composable
private fun CustomerFigures(l: AnaLedger) {
    val b = l.books
    val named = b.newCustomers + b.returningCustomers
    val revenue = b.revenueFromNew + b.revenueFromReturning
    val returnShare = if (revenue > 0) Math.round(b.revenueFromReturning / revenue * 100).toInt() else 0
    AnaFigureRow(
        listOf(
            AnaFig("Customers", named.toString(), "named, walk-ins left out"),
            AnaFig("New", b.newCustomers.toString(), Money.pkrLac(b.revenueFromNew)),
            AnaFig("Returning", b.returningCustomers.toString(), Money.pkrLac(b.revenueFromReturning)),
            AnaFig("Revenue from returning", "$returnShare%", "of named customers’ sales"),
        ),
    )
}

/** The ten who spent most, as bars; the row list below opens each customer. */
@Composable
private fun TopChart(l: AnaLedger) {
    val top = l.books.topCustomers.take(10)
    AnaChartCard(
        "Top 10 customers",
        takeaway = if (top.isNotEmpty()) "${top[0].customerName} spent most: ${Money.pkrLac(top[0].totalSpent)} in ${anaPlural(top[0].orderCount, "sale")}." else "No customers bought in this period.",
    ) {
        if (top.isNotEmpty()) AnaHBars(top.map { AnaHBar(it.customerName, it.totalSpent) })
    }
}

// MARK: Top ten

@Composable
private fun TopSection(f: AnaFigures, showTop: Boolean, toggle: () -> Unit) {
    val navigator = LocalNavigator.current
    LedgerSection("Top customers by sales") {
        if (f.topCustomers.isEmpty()) {
            Text("No customer sales in this period.", Modifier.ledgerRow(), color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            DividedColumn {
                for (c in f.topCustomers.take(if (showTop) f.topCustomers.size else 3)) {
                    val subtitle = c.orderCount.toString() + " " + AnaFormat.plural(c.orderCount, "order", "orders")
                    val open = c.customerId?.let { id -> Modifier.clickable(role = Role.Button, onClickLabel = "Open ${c.name}") { navigator.open(AnaPath.customer(id)) } } ?: Modifier
                    TwoLine(c.name, open.ledgerRow(), subtitle = subtitle, trailing = Money.lacCrore(c.totalSpent))
                }
                if (f.topCustomers.size > 3) ActionRow(if (showTop) "Show fewer" else "Show top 10", onClick = toggle)
            }
        }
    }
}

// MARK: Acquisition source

/**
 * Where revenue comes from by how the customer found the store. A sale's source is its own override first, then the
 * linked customer's saved one; sales with neither are Unclassified.
 */
@Composable
private fun SourceSection(f: AnaFigures, l: AnaLedger) {
    val sources = f.sourceBreakdown
    val lead = l.books.sourceBreakdown.maxByOrNull { it.revenue }
    val sourceTotal = l.books.sourceBreakdown.sumOf { it.revenue }
    AnaChartCard(
        "Revenue by source",
        takeaway = if (lead != null && sourceTotal > 0) "${lead.label} brought the most: ${anaPercent(lead.revenue, sourceTotal)}% of revenue." else "No sales with a source in this period.",
    ) {
        if (l.books.sourceBreakdown.isNotEmpty()) {
            AnaStackBar100(l.books.sourceBreakdown.map { AnaPart(it.label, it.revenue, anaSourceColor(it.key)) }, format = { Money.lacCrore(it) })
        }
    }
    SectionCard("Acquisition source insights") {
        if (sources.isEmpty()) {
            Text("No acquisition-source data available for the selected period.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else if (f.sourceTrend.isNotEmpty()) {
            AnaSourceTrendChart(f.sourceTrend)
        }
    }
    if (sources.isNotEmpty()) {
        // Share is of the source-attributed revenue (not of the total, which also holds extra revenue that has no
        // source), so the column adds up to 100%.
        val total = sources.sumOf { it.revenue }
        DashDisclosure("Source breakdown") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                for (s in sources) TwoLine(s.label, subtitle = sourceLine(s, total), trailing = Money.lacCrore(s.revenue))
                Footnote("A sale’s source comes from the sale, then the customer. Missing sources are Unclassified.")
            }
        }
    }
}

/** "4 sales · 38.2% · avg 1.1 lac". */
internal fun sourceLine(s: AnaSourceRow, total: Double): String {
    val share = if (total > 0) s.revenue / total * 100 else 0.0
    val sales = s.orderCount.toString() + " " + AnaFormat.plural(s.orderCount, "sale", "sales")
    return sales + " · " + AnaFormat.fixed(share, 1) + "% · avg " + Money.lacCrore(s.avgOrderValue)
}

// MARK: Everyone

internal val customerSorts = listOf("Spending", "Number of sales", "Average sale")

internal fun shownCustomers(rows: List<AnaBreakdown.CustomerRow>, search: String, sort: Int): List<AnaBreakdown.CustomerRow> {
    val term = search.trim().lowercase()
    val matched = if (term.isEmpty()) rows else rows.filter { it.name.lowercase().contains(term) }
    return when (sort) {
        1 -> AnaSort.descending(matched) { it.orderCount.toDouble() }
        2 -> AnaSort.descending(matched) { it.averageSpent }
        else -> AnaSort.descending(matched) { it.totalSpent }
    }
}

/** "3 sales · 7 pieces · average 1.2 lac". */
internal fun customerLine(c: AnaBreakdown.CustomerRow): String {
    val sales = c.orderCount.toString() + " " + AnaFormat.plural(c.orderCount, "sale", "sales")
    val pieces = AnaFormat.count(c.itemsPurchased) + " " + (if (c.itemsPurchased == 1.0) "piece" else "pieces")
    return sales + " · " + pieces + " · average " + Money.lacCrore(c.averageSpent)
}

@Composable
private fun AllSection(rows: List<AnaBreakdown.CustomerRow>, search: String, sort: Int, setSort: (Int) -> Unit, showAll: Boolean, toggle: () -> Unit) {
    val navigator = LocalNavigator.current
    val list = shownCustomers(rows, search, sort)
    AnaSortChips(customerSorts, sort, setSort)
    LedgerSection("Everyone who bought") {
        if (list.isEmpty()) {
            Text("No customer data for this period.", Modifier.ledgerRow(), color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            val everything = showAll || search.isNotEmpty()
            DividedColumn {
                for (c in list.take(if (everything) list.size else 5)) {
                    val open = c.customerId?.let { id -> Modifier.clickable(role = Role.Button, onClickLabel = "Open ${c.name}") { navigator.open(AnaPath.customer(id)) } } ?: Modifier
                    TwoLine(c.name, open.ledgerRow(), subtitle = customerLine(c), trailing = Money.lacCrore(c.totalSpent))
                }
                if (list.size > 5 && search.isEmpty()) ActionRow(if (showAll) "Show fewer" else "Show all · ${list.size}", onClick = toggle)
            }
        }
    }
}

@Suppress("unused")
private val padding0 = Modifier.padding(0.dp)
