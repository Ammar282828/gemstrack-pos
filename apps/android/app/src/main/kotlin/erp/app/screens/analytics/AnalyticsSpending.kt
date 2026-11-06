package erp.app.screens.analytics

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import erp.app.ui.DividedColumn
import erp.app.ui.LedgerSection
import erp.app.ui.TextButton
import erp.app.ui.TwoLine
import erp.app.ui.ledgerRow
import erp.core.logic.ExpenseKind
import erp.core.logic.MonthRow
import erp.core.logic.Money

/**
 * Analytics → Spending (components/analytics/pages/spending.tsx): where did it go? The expenses by category, each tagged
 * with what kind of money it is (running cost, goods for the pieces, or the owners' drawings), because only the running
 * costs come off profit. Entering an expense is Money → Expenses; this is its analysis.
 */
@Composable
fun AnaSpendingPage(l: AnaLedger, period: AnaPeriodState) {
    val b = l.books
    val open = rememberAnaOpen()
    val months = l.months

    val top = b.expensesByCategory.firstOrNull()
    val takeaway = if (top != null && b.totalExpenses > 0) "${top.category} was the biggest at ${Money.pkrLac(top.amount)}, ${anaPercent(top.amount, b.totalExpenses)}% of ${Money.pkrLac(b.totalExpenses)} spent." else "No expenses in this period."

    // Only the kinds this house has to show (a house that records no goods has no Goods line).
    val kinds = ExpenseKind.values().filter { k -> months.any { monthKind(it, k) > 0 } || (b.expenseKinds[k] ?: 0.0) > 0 }
    val monthTotal = { m: MonthRow -> m.running + m.goods + m.drawings }
    val peak = months.fold(null as MonthRow?) { m, x -> if (monthTotal(x) > (if (m != null) monthTotal(m) else 0.0)) x else m }
    val monthTake = if (peak != null) "Most spent in the last 12 months: ${peak.month}, ${Money.pkrLac(monthTotal(peak))}." else "No expenses in the last 12 months."
    val groups = remember(months, kinds) { months.map { m -> AnaGroup(m.month, kinds.map { monthKind(m, it) }) } }

    AnaPage(period) {
        AnaChartCard(
            "Expenses by category", takeaway = takeaway,
            action = { TextButton(onClick = { open("/expenses") }) { Text("Open expenses ›") } },
        ) {
            if (b.expensesByCategory.isNotEmpty()) {
                AnaHBars(b.expensesByCategory.map { AnaHBar(it.category, it.amount, anaKindColor(it.kind), anaKindLabel(it.kind).lowercase()) })
            } else {
                AnaMuted("Nothing spent in this period.")
            }
        }

        AnaFigureRow(
            listOf(AnaFig("Spent in all", Money.pkrLac(b.totalExpenses), number = b.totalExpenses)) + kinds.map { k ->
                AnaFig(
                    anaKindLabel(k), Money.pkrLac(b.expenseKinds[k] ?: 0.0),
                    when (k) { ExpenseKind.running -> "comes off profit"; ExpenseKind.goods -> "for the pieces"; ExpenseKind.drawings -> "owners’ share, not a cost" },
                    number = b.expenseKinds[k] ?: 0.0,
                )
            },
        )

        AnaChartCard("Month by month", takeaway = monthTake) {
            if (kinds.isNotEmpty() && months.any { monthTotal(it) > 0 }) {
                AnaBarsChart(groups, kinds.map { AnaSeries(anaKindLabel(it), anaKindColor(it)) }, stacked = true, height = 220.dp)
            } else {
                AnaMuted("Nothing to draw: no expenses in the last 12 months.")
            }
        }

        LedgerSection("Largest expenses", footer = { Text("The ten biggest of this period.") }) {
            if (b.largestExpenses.isEmpty()) {
                Text("No expenses in this period.", Modifier.ledgerRow(), color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                DividedColumn {
                    for (e in b.largestExpenses) {
                        val date = AnaDate.parseISO(e.date)?.let { AnaDate.dayMonth(it) } ?: e.date
                        TwoLine(
                            e.category, Modifier.ledgerRow(),
                            subtitle = listOf(date, e.description).filter { it.isNotEmpty() }.joinToString(" · "),
                            trailing = Money.lacCrore(e.amount),
                        )
                    }
                }
            }
        }
    }
}

private fun monthKind(m: MonthRow, k: ExpenseKind): Double = when (k) {
    ExpenseKind.running -> m.running
    ExpenseKind.goods -> m.goods
    ExpenseKind.drawings -> m.drawings
}
