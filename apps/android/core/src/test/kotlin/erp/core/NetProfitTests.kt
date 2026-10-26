package erp.core

import erp.core.logic.NetProfit
import kotlin.test.Test
import kotlin.test.assertEquals

class NetProfitTests {
    @Test fun isTheEstimatedProfitLessExpensesNotRevenueLessExpenses() {
        // Revenue 5.51 crore, estimated profit 55.23 lac, no expenses: 10% margin, never 100%.
        val revenue = 55_100_000.0
        val est = 5_523_000.0
        assertEquals(est, NetProfit.of(est, 0.0), 0.0)
        assertEquals(10.0, NetProfit.marginPercent(NetProfit.of(est, 0.0), revenue), 0.05)
    }

    @Test fun takesTheExpensesOffTheEstimateAndCanGoNegative() {
        assertEquals(70_000.0, NetProfit.of(100_000.0, 30_000.0), 0.0)
        assertEquals(-50_000.0, NetProfit.of(100_000.0, 150_000.0), 0.0)
    }

    @Test fun hasNoMarginWithoutRevenue() {
        assertEquals(0.0, NetProfit.marginPercent(-5_000.0, 0.0), 0.0)
    }
}
