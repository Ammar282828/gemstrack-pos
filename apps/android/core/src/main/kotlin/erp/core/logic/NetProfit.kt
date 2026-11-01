// Ported from src/lib/analytics/net-profit.ts (tests: NetProfitTests, from net-profit.test.ts).
//
// Net profit = the estimated profit less the expenses (owner, 2026-10-25: "5.51 crore, 100.0% margin" with the
// estimate at 55 lac). Revenue less expenses ignored what the goods cost, so a jewellery shop read ~100% margin.
// The estimate is already each sale's own margin (Margin.kt), so it carries the cost of the goods.
// The expenses are the running costs only (isRunningCost, src/lib/analytics/net-profit.ts, 2026-10-31): not the partners'
// drawings, and not the goods where a house files them as expenses (Mina's stock and karigars), which the margin already took off.

package erp.core.logic

object NetProfit {
    /**
     * The categories that are the cost of the goods themselves, from the business (`goodsExpenseCategories`, the ERP's
     * NEXT_PUBLIC_STORE_GOODS_EXPENSE_CATEGORIES): the case-insensitive, trimmed match of lib/expense-categories.ts isGoodsExpense.
     */
    fun isGoodsExpense(category: String?, goods: List<String>): Boolean {
        val c = category?.trim()?.lowercase().orEmpty()
        return c.isNotEmpty() && goods.any { it.trim().lowercase() == c }
    }

    /** An expense that counts against net profit: a business cost (not drawings) that is not a goods category. */
    fun isRunningCost(category: String?, goods: List<String>): Boolean =
        Partnership.isBusinessCost(category) && !isGoodsExpense(category, goods)

    fun of(estimatedProfit: Double, expenses: Double): Double = estimatedProfit - expenses

    /** Net profit as a share of revenue, in percent; 0 where there was no revenue. */
    fun marginPercent(net: Double, revenue: Double): Double = if (revenue > 0) net / revenue * 100 else 0.0
}
