package erp.app.screens.analytics

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import erp.app.ui.DividedColumn
import erp.app.ui.LedgerSection
import erp.app.ui.SectionCard
import erp.app.ui.TwoLine
import erp.app.ui.ledgerRow
import erp.core.logic.Money

/**
 * Analytics → Categories (category-breakdown.tsx): revenue, pieces and sales per category in the period, and each one's
 * share of the revenue. Revenue is gross line-item revenue, before invoice discounts and trade-ins.
 */
@Composable
fun AnaCategoriesPage(rows: List<AnaBreakdown.CategoryRow>, period: AnaPeriodState) {
    AnaPage(period) {
        if (rows.isEmpty()) {
            LedgerSection("By category") {
                Text("No category sales data for the selected period.", Modifier.ledgerRow(), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            AnaColumns(
                left = { SectionCard("Share of revenue") { AnaShareChart(rows) } },
                right = {
                    LedgerSection("By category") {
                        DividedColumn {
                            for (c in rows) TwoLine(c.name, Modifier.ledgerRow(), subtitle = categoryLine(c), trailing = Money.lacCrore(c.revenue))
                        }
                    }
                },
            )
        }
        LedgerSection("About these figures", collapsible = true) {
            Text(
                "Revenue is before invoice discounts and trade-ins, so it can be higher than Overview.",
                Modifier.ledgerRow(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** "12 pieces · 9 sales". */
internal fun categoryLine(c: AnaBreakdown.CategoryRow): String {
    val pieces = AnaFormat.count(c.itemsSold) + " " + (if (c.itemsSold == 1.0) "piece" else "pieces")
    val sales = c.orders.toString() + " " + AnaFormat.plural(c.orders, "sale", "sales")
    return "$pieces · $sales"
}
