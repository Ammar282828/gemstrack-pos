// Ported from src/lib/analytics/net-profit.ts (tests: NetProfitTests, from net-profit.test.ts).
//
// Net profit = the estimated profit less the expenses (owner, 2026-10-25: "5.51 crore, 100.0% margin" with the
// estimate at 55 lac). Revenue less expenses ignored what the goods cost, so a jewellery shop read ~100% margin.
// The estimate is already each sale's own margin (Margin.kt), so it carries the cost of the goods.

package erp.core.logic

object NetProfit {
    fun of(estimatedProfit: Double, expenses: Double): Double = estimatedProfit - expenses

    /** Net profit as a share of revenue, in percent; 0 where there was no revenue. */
    fun marginPercent(net: Double, revenue: Double): Double = if (revenue > 0) net / revenue * 100 else 0.0
}
