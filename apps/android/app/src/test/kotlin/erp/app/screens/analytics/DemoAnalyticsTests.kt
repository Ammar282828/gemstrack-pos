package erp.app.screens.analytics

import erp.app.data.Demo
import erp.app.ui.AppClock
import erp.core.logic.MarginSettings
import erp.core.logic.invoiceSaleValue
import erp.core.models.AdditionalRevenue
import erp.core.models.Customer
import erp.core.models.Expense
import erp.core.models.Invoice
import erp.core.models.Order
import erp.core.models.Product
import java.io.File
import java.time.Instant
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** The demo books (the iPhone's demo.json) go through every Analytics figure without a gap (CONVENTIONS.md rule 13). */
class DemoAnalyticsTests {
    private val now = Instant.parse("2026-10-12T08:00:00Z")

    @Before fun pin() { AppClock.pinned = now }

    @After fun unpin() { AppClock.pinned = null }

    private val data: Map<String, List<Map<String, Any?>>> by lazy {
        val file = listOf("../../iphone/App/Resources/demo.json", "../iphone/App/Resources/demo.json", "apps/iphone/App/Resources/demo.json")
            .map { File(it) }.first { it.exists() }
        Demo.parse(file.readText(), now)
    }

    private val books: AnaBooks by lazy {
        AnaBooks(
            invoices = data["invoices"].orEmpty().map { Invoice.fromMap(it) },
            orders = data["orders"].orEmpty().map { Order.fromMap(it) },
            products = data["products"].orEmpty().map { Product.fromMap(it) },
            customers = data["customers"].orEmpty().map { Customer.fromMap(it) },
            expenses = data["expenses"].orEmpty().map { Expense.fromMap(it) },
            extraRevenue = data["additional_revenue"].orEmpty().map { AdditionalRevenue.fromMap(it) },
        )
    }

    private val periods = listOf("this-month", "last-30", "last-90", "this-year", "last-year", "all-time")

    @Test fun everyPeriodWorksOutAndTheDemoHasSomethingThisMonth() {
        assertTrue(books.invoices.isNotEmpty())
        val month = AnaFigures.of(books, AnaPeriod.read("this-month", null, null, now).range, MarginSettings.taheri)
        assertTrue(month.invoicesInRange > 0, "the demo has sales on the 1st to today")
        assertTrue(month.totalSales > 0)
        for (key in periods) {
            val state = AnaPeriod.read(key, null, null, now)
            for (margin in listOf(MarginSettings.taheri, MarginSettings.mina, null)) {
                val f = AnaFigures.of(books, state.range, margin)
                assertTrue(f.totalSales.isFinite() && f.estProfit.isFinite() && f.cashIn.isFinite(), key)
                assertEquals(f.invoiceSales + f.orderSales + f.extraRevenue, f.totalSales, 0.001, key)
                assertEquals(f.invoicesInRange + f.ordersInRange, f.totalOrders, key)
                if (margin == null) assertEquals(0.0, f.estProfit, 0.0)
            }
        }
    }

    @Test fun allTimeIsEveryBillsSaleValueAndEveryLiveOrder() {
        val f = AnaFigures.of(books, null, null)
        val bills = books.invoices.filter { it.status?.rawValue != "Refunded" }.sumOf { invoiceSaleValue(it) }
        assertEquals(bills, f.invoiceSales, 0.001)
        assertEquals(books.expenses.sumOf { it.amount }, f.totalExpenses, 0.001)
        assertEquals(books.extraRevenue.sumOf { it.amount }, f.extraRevenue, 0.001)
        assertEquals(f.salesOverTime.sumOf { it.sales }, f.totalSales, 0.001)
    }

    @Test fun theBreakdownTabsAgreeWithEachOther() {
        val range = AnaPeriod.read("all-time", null, null, now).range
        val products = AnaBreakdown.products(books, range)
        val categories = AnaBreakdown.categories(books, range)
        val customers = AnaBreakdown.customers(books, range)
        assertTrue(products.isNotEmpty() && categories.isNotEmpty() && customers.isNotEmpty())
        // Three views of the same lines: each piece's own total, summed.
        assertEquals(products.sumOf { it.revenue }, categories.sumOf { it.revenue }, 0.001)
        assertEquals(categories.sumOf { it.itemsSold }, customers.sumOf { it.itemsPurchased }, 0.001)
        assertEquals(books.invoices.size, customers.sumOf { it.orderCount })
    }

    @Test fun theHistoryCoversTheDemosYearsAndMonths() {
        val h = AnaHistory.of(books, MarginSettings.taheri)
        assertTrue(h.yearly.isNotEmpty())
        assertTrue(h.months.isNotEmpty())
        assertNotNull(h.bestMonth)
        assertTrue(h.monthlyAverage > 0)
        assertTrue(h.months.zipWithNext().all { (a, b) -> a.key < b.key })
    }
}
