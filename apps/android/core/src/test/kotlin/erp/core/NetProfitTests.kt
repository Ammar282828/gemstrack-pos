package erp.core

import erp.core.logic.NetProfit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

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

/** From src/lib/analytics/net-profit-running.test.ts: House of Mina's goods list (apphosting.mina.yaml). */
class NetProfitRunningTests {
    private val mina = listOf("Stock & Karigars", "Custom Orders", "Stones & Pearls", "Plating & Finishing")

    @Test fun leavesOutTheGoodsTheMarginAllowsForAndThePartnersDrawings() {
        assertTrue(NetProfit.isRunningCost("Rent", mina))
        assertTrue(NetProfit.isRunningCost("Ad Spend", mina))
        assertFalse(NetProfit.isRunningCost("Stock & Karigars", mina))
        assertFalse(NetProfit.isRunningCost(" plating & finishing ", mina))
        assertFalse(NetProfit.isRunningCost("Partner Drawings", mina))
        assertTrue(NetProfit.isRunningCost(null, mina))
    }

    @Test fun minasMonthTheGoodsAreNotCountedTwice() {
        // Revenue 1.84 crore at 40% -> 73.6 lac estimated; 1.89 crore paid out, of which most was stock and karigars.
        val expenses = listOf("Stock & Karigars" to 14_000_000.0, "Rent" to 600_000.0, "Salaries" to 1_200_000.0, "Partner Drawings" to 3_100_000.0)
        val running = expenses.filter { NetProfit.isRunningCost(it.first, mina) }.sumOf { it.second }
        assertEquals(1_800_000.0, running, 0.0)
        assertEquals(5_560_000.0, NetProfit.of(7_360_000.0, running), 0.0)
    }

    @Test fun aHouseWithNoGoodsListCountsEveryBusinessCost() {
        // Taheri: none, so stock is not special; only drawings stay out.
        assertTrue(NetProfit.isRunningCost("Stock & Karigars", emptyList()))
        assertFalse(NetProfit.isRunningCost("Partner Drawings", emptyList()))
    }
}
