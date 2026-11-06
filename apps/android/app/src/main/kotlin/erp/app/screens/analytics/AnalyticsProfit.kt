package erp.app.screens.analytics

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import erp.app.config.House
import erp.app.ui.DividedColumn
import erp.app.ui.LedgerSection
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.TabularDigits
import erp.core.logic.Money
import erp.core.logic.YearRow
import kotlin.math.roundToInt

/**
 * Analytics → Profit (components/analytics/pages/profit.tsx): what did we keep? The waterfall from revenue to net profit
 * is the page; under it the same story month by month, how the estimate is made, and the years. Net profit is profit
 * less the running costs only (NetProfit); where a house records its goods (Mina) the middle step is its Gross profit,
 * not an estimate.
 */
@Composable
fun AnaProfitPage(l: AnaLedger, period: AnaPeriodState, pick: (String) -> Unit) {
    val b = l.books
    val goods = l.recordsGoods
    val profitWord = if (goods) "Gross profit" else "Est. profit"
    val revenue = b.totalSales
    val profit = b.estProfitAdj
    val running = b.runningExpenses
    val net = b.netProfit

    val takeaway = when {
        revenue <= 0 -> "No sales in this period."
        net >= 0 -> "Kept PKR ${AnaFormat.number(Math.round(b.netMargin * 10) / 10.0, 1)} of every PKR 100: ${Money.pkrLac(net)} net profit on ${Money.pkrLac(revenue)} revenue."
        else -> "A loss of ${Money.pkrLac(-net)}: running costs of ${Money.pkrLac(running)} were more than the ${Money.pkrLac(profit)} of ${if (goods) "gross" else "estimated"} profit."
    }
    val estPct = if (revenue > 0) Math.round(profit / revenue * 1000) / 10.0 else 0.0

    val months = l.months
    val bestMonth = months.fold(null as erp.core.logic.MonthRow?) { m, r -> if (r.net > (m?.net ?: Double.NEGATIVE_INFINITY)) r else m }
    val monthTake = if (bestMonth != null && bestMonth.revenue > 0) "Best net profit of the last 12 months: ${bestMonth.month}, ${Money.pkrLac(bestMonth.net)}." else "No sales in the last 12 months."
    val profitGroups = remember(months) { months.map { AnaGroup(it.month, listOf(it.estProfit, it.running)) } }
    val marginGroups = remember(months) { months.map { AnaGroup(it.month, listOf(it.netMargin)) } }

    AnaPage(period) {
        AnaChartCard("From revenue to profit", takeaway = takeaway) { AnaWaterfall(profitSteps(l, short = false), height = 240.dp) }

        AnaFigureRow(
            listOf(
                AnaFig("Revenue", Money.pkrLac(revenue), number = revenue),
                AnaFig(profitWord, Money.pkrLac(profit), if (revenue > 0) pct(estPct) + " of revenue" else null, number = profit),
                AnaFig("Running costs", Money.pkrLac(running), number = running),
                AnaFig(
                    "Net profit", Money.pkrLac(net), if (revenue > 0) pct(b.netMargin) + " margin" else null,
                    tone = if (revenue > 0) (if (net >= 0) Tone.settled else Tone.late) else null, number = net,
                ),
            ),
        )

        AnaChartCard("Month by month", takeaway = monthTake) {
            AnaBarsChart(profitGroups, listOf(AnaSeries(profitWord, anaColor(1)), AnaSeries("Running costs", anaColor(2))), height = 220.dp)
            Text("Net margin", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium))
            AnaBarsChart(
                marginGroups, listOf(AnaSeries("Net margin", anaColor(3))), height = 120.dp, format = { pct(it) },
                hint = "Touch a bar to read the margin.",
            )
        }

        AnaExplain("How profit is estimated") {
            val margin = House.margin
            val assumed = (margin.assumedMargin * 100).roundToInt()
            if (goods) {
                AnaMuted("Gross profit is revenue less the goods bought in the period (${AnaFormat.number(estPct, 1)}% of revenue here). Stock bought and not yet sold counts as spent. At a flat $assumed% it would be ${Money.pkrLac(b.estProfit)}.")
            } else if (margin.rattiLess == null || b.salesCosted == 0) {
                AnaMuted("Est. profit is revenue × $assumed%, before running costs.")
            } else {
                AnaMuted(
                    "${b.salesCosted} of ${b.salesCount} sales are worked out from the 24k rate typed when they were made (the piece costs that rate less ${AnaFormat.number(margin.rattiLess!!, 2)} ratti); " +
                        "the other ${maxOf(0, b.salesCount - b.salesCosted)} are taken at $assumed%. Extra revenue is also at $assumed%.",
                )
            }
            AnaMuted("Net profit is that profit less running costs only: not the owners’ drawings, and not the goods the margin already allows for.")
        }

        if (l.years.isNotEmpty()) {
            LedgerSection("Every year", footer = { Text("All of history, whatever period is chosen. Tap a year to look at it.") }) {
                DividedColumn { for (y in l.years) YearRowView(y, profitWord) { pick("year-${y.year}") } }
            }
        }
    }
}

private fun pct(n: Double): String = AnaFormat.fixed(Math.round(n * 10) / 10.0, 1) + "%"

@Composable
private fun YearRowView(y: YearRow, profitWord: String, onClick: () -> Unit) {
    val parts = ArrayList<String>()
    parts.add(if (y.unpaid > 0) "Unpaid ${Money.lacCrore(y.unpaid)}" else "Nothing unpaid")
    parts.add("Running costs ${Money.lacCrore(y.expenses)}")
    parts.add("$profitWord ${Money.lacCrore(y.profit)}")
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
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                "Net profit ${Money.lacCrore(y.netProfit)}",
                style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits),
                color = if (y.netProfit >= 0) Tone.settled.color() else Tone.late.color(),
            )
            Text(
                if (y.revenue > 0) pct(y.netMargin) + " margin" else "—",
                style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
