package erp.app.screens.analytics

import erp.app.ui.icons.Symbols
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import erp.app.nav.LocalNavigator
import erp.app.screens.money.MoneySearchField
import erp.app.ui.ActionRow
import erp.app.ui.ChipRow
import erp.app.ui.DividedColumn
import erp.app.ui.FilterChip
import erp.app.ui.LedgerSection
import erp.app.ui.SectionCard
import erp.app.ui.TwoLine
import erp.app.ui.ledgerRow
import erp.core.logic.Money

/** A row of chips for a sort (Revenue, Quantity sold…): the index of the chosen one. */
@Composable
fun AnaSortChips(titles: List<String>, selected: Int, pick: (Int) -> Unit) {
    ChipRow {
        titles.forEachIndexed { i, t -> FilterChip(t, chosen = i == selected, onClick = { pick(i) }) }
    }
}

/**
 * Analytics → Products (analytics-view.tsx section "products" and product-breakdown.tsx): the ten pieces that earned
 * most in the period, the sales by category, then every piece sold, searchable and sorted by revenue, quantity or
 * number of sales.
 *
 * The breakdown's revenue is each piece's own total, before invoice discounts and trade-ins, so it runs higher than the
 * Overview's net figure.
 */
@Composable
fun AnaProductsPage(figures: AnaFigures, rows: List<AnaBreakdown.ProductRow>, period: AnaPeriodState) {
    var search by rememberSaveable { mutableStateOf("") }
    var sort by rememberSaveable { mutableIntStateOf(0) }
    var showAll by rememberSaveable { mutableStateOf(false) }
    var showTop by rememberSaveable { mutableStateOf(false) }
    AnaPage(period) {
        AnaColumns(
            left = {
                TopSection(figures, showTop) { showTop = !showTop }
                CategorySection(figures)
            },
            right = {
                MoneySearchField(search, { search = it }, "Search every piece by name or SKU")
                AllSection(rows, search, sort, { sort = it }, showAll) { showAll = !showAll }
            },
        )
    }
}

// MARK: Top ten

@Composable
private fun TopSection(f: AnaFigures, showTop: Boolean, toggle: () -> Unit) {
    LedgerSection("Top pieces by revenue") {
        if (f.topProducts.isEmpty()) {
            Text("No pieces sold in this period.", Modifier.ledgerRow(), color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            DividedColumn {
                for (p in f.topProducts.take(if (showTop) f.topProducts.size else 3)) {
                    TwoLine(p.name, Modifier.ledgerRow(), subtitle = topLine(p), trailing = Money.lacCrore(p.revenue))
                }
                if (f.topProducts.size > 3) ActionRow(if (showTop) "Show fewer" else "Show top 10", onClick = toggle)
            }
        }
    }
}

/** "SKU: R-104 · Qty 2", or "Not in stock" for a piece described for one bill. */
internal fun topLine(p: AnaTopProduct): String {
    val sku = if (AnaSku.isStock(p.sku)) "SKU: " + p.sku else "Not in stock"
    return sku + " · Qty " + AnaFormat.count(p.quantity)
}

// MARK: Sales by category

@Composable
private fun CategorySection(f: AnaFigures) {
    val navigator = LocalNavigator.current
    val sold = f.salesByCategory.filter { it.sales > 0 }
    SectionCard("Sales by category") {
        if (sold.isEmpty()) {
            Text("No category sales data available for the selected period.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            AnaBarChart(sold.map { AnaBar(it.categoryId, it.name, it.sales) })
        }
        ActionRow("Sales by category in detail", onClick = { navigator.open("/analytics/categories") }, icon = Symbols.PieChart)
    }
}

// MARK: Every piece

internal val productSorts = listOf("Revenue", "Quantity sold", "Number of sales")

/** The pieces matching [search] (name or SKU), sorted by revenue, quantity or number of sales. */
internal fun shownProducts(rows: List<AnaBreakdown.ProductRow>, search: String, sort: Int): List<AnaBreakdown.ProductRow> {
    val term = search.trim().lowercase()
    val matched = if (term.isEmpty()) rows else rows.filter { it.name.lowercase().contains(term) || it.sku.lowercase().contains(term) }
    return when (sort) {
        1 -> AnaSort.descending(matched) { it.quantity }
        2 -> AnaSort.descending(matched) { it.orders.toDouble() }
        else -> AnaSort.descending(matched) { it.revenue }
    }
}

/** "R-104 · Qty 3 · 2 sales". */
internal fun productLine(p: AnaBreakdown.ProductRow): String =
    p.sku + " · Qty " + AnaFormat.count(p.quantity) + " · " + p.orders + " " + AnaFormat.plural(p.orders, "sale", "sales")

@Composable
private fun AllSection(rows: List<AnaBreakdown.ProductRow>, search: String, sort: Int, setSort: (Int) -> Unit, showAll: Boolean, toggle: () -> Unit) {
    val list = shownProducts(rows, search, sort)
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        AnaSortChips(productSorts, sort, setSort)
    }
    LedgerSection(
        "Every piece sold",
        footer = { Text("Revenue here is each piece’s own total, before invoice discounts and trade-ins, so it runs higher than the Overview’s net figure.") },
    ) {
        if (list.isEmpty()) {
            Text("No pieces sold in this period.", Modifier.ledgerRow(), color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            val everything = showAll || search.isNotEmpty()
            DividedColumn {
                for (p in list.take(if (everything) list.size else 5)) TwoLine(p.name, Modifier.ledgerRow(), subtitle = productLine(p), trailing = Money.lacCrore(p.revenue))
                if (list.size > 5 && search.isEmpty()) ActionRow(if (showAll) "Show fewer" else "Show all · ${list.size}", onClick = toggle)
            }
        }
    }
}
