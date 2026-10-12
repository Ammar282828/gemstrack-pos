package erp.core

import erp.core.logic.ShopCalendar
import erp.core.logic.ShopCalendarMonth
import erp.core.logic.shopCalendarDays
import erp.core.logic.shopCalendarDue
import erp.core.logic.shopCalendarDueOn
import erp.core.logic.shopCalendarMonth
import erp.core.models.Invoice
import erp.core.models.Order
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * src/app/calendar/page.tsx has no test of its own. These pin its reckoning: a sale on the day of its order,
 * money only where the page counts it, and Karachi's days (8 Oct 20:00 UTC is already 9 Oct 01:00 there).
 */
class ShopCalendarTests {
    private fun invoice(fields: Map<String, Any?>): Invoice = ERPDecode.model<Invoice>(fields)!!
    private fun order(fields: Map<String, Any?>): Order = ERPDecode.model<Order>(fields)!!

    @Test
    fun testASaleSitsOnTheDayItsOrderWasTakenAndItsRowKeepsItsOwnTime() {
        val o = order(mapOf("id" to "ORD-1", "createdAt" to "2026-10-01T08:00:00Z", "status" to "Completed", "invoiceId" to "INV-1", "subtotal" to 90_000))
        val i = invoice(mapOf("id" to "INV-1", "createdAt" to "2026-10-08T10:00:00Z", "sourceOrderId" to "ORD-1", "grandTotal" to 80_000, "customerName" to "Sana Ali"))
        val days = shopCalendarDays(invoices = listOf(i), orders = listOf(o))
        assertEquals(listOf("2026-10-01"), days.keys.sorted())
        val day = days["2026-10-01"]!!
        assertEquals(1, day.invoices)
        assertEquals(1, day.orders)
        // The sale, not the order too: an invoiced order's money is already in the sale.
        assertEquals(80_000.0, day.total)
        val sale = day.events.first { it.isInvoice }
        assertEquals("2026-10-08T10:00:00Z", sale.createdAt)
        assertEquals("Sana Ali", sale.customerName)
        assertEquals(80_000.0, sale.grandTotal)
    }

    @Test
    fun testADirectSaleSitsOnItsOwnKarachiDayWithTheExchangeAddedBackAndARefundLeftOut() {
        val sold = invoice(mapOf("id" to "INV-2", "createdAt" to "2026-10-08T20:00:00Z", "grandTotal" to 25_000, "exchanges" to listOf(mapOf("description" to "Old ring", "value" to 60_000))))
        val refunded = invoice(mapOf("id" to "INV-3", "createdAt" to "2026-10-08T21:00:00Z", "grandTotal" to 40_000, "status" to "Refunded"))
        val days = shopCalendarDays(invoices = listOf(sold, refunded), orders = emptyList())
        // 8 Oct 20:00 UTC is 9 Oct in Karachi.
        assertEquals(listOf("2026-10-09"), days.keys.sorted())
        val day = days["2026-10-09"]!!
        assertEquals(2, day.invoices)
        assertEquals(85_000.0, day.total)
        // Newest first.
        assertEquals(listOf("INV-3", "INV-2"), day.events.map { it.docId })
    }

    @Test
    fun testAnOrderCountsItsSubtotalOnlyWhileUninvoicedAndLive() {
        val open = order(mapOf("id" to "ORD-1", "createdAt" to "2026-10-05T08:00:00Z", "status" to "Pending", "subtotal" to 50_000, "grandTotal" to 30_000, "customerName" to "Bilal"))
        val invoiced = order(mapOf("id" to "ORD-2", "createdAt" to "2026-10-05T09:00:00Z", "status" to "Completed", "invoiceId" to "INV-9", "subtotal" to 70_000))
        val cancelled = order(mapOf("id" to "ORD-3", "createdAt" to "2026-10-05T10:00:00Z", "status" to "Cancelled", "subtotal" to 20_000))
        val day = shopCalendarDays(invoices = emptyList(), orders = listOf(open, invoiced, cancelled))["2026-10-05"]!!
        assertEquals(3, day.orders)
        assertEquals(0, day.invoices)
        assertEquals(50_000.0, day.total)
        assertEquals(3, day.events.size)
        // The row prints the document's own total (the balance, for an order).
        assertEquals(30_000.0, day.events.first { it.docId == "ORD-1" }.grandTotal)
        assertEquals("Bilal", day.events.first { it.docId == "ORD-1" }.customerName)
    }

    @Test
    fun testADateThatDoesNotReadHasNoDay() {
        val days = shopCalendarDays(
            invoices = listOf(invoice(mapOf("id" to "INV-1", "createdAt" to "not a date", "grandTotal" to 5))),
            orders = listOf(order(mapOf("id" to "ORD-1", "createdAt" to ""))),
        )
        assertTrue(days.isEmpty())
    }

    @Test
    fun testWhatIsPromisedOnEachDayIsActiveOrdersOnly() {
        val a = order(mapOf("id" to "ORD-1", "createdAt" to "2026-10-01T00:00:00Z", "status" to "Pending", "promisedDate" to "2026-10-20"))
        val b = order(mapOf("id" to "ORD-2", "createdAt" to "2026-10-01T00:00:00Z", "status" to "In Progress", "promisedDate" to "2026-10-20"))
        // An instant is placed on its Karachi day: 19 Oct 20:00 UTC is 20 Oct there.
        val c = order(mapOf("id" to "ORD-3", "createdAt" to "2026-10-01T00:00:00Z", "status" to "Pending", "promisedDate" to "2026-10-19T20:00:00.000Z"))
        val done = order(mapOf("id" to "ORD-4", "createdAt" to "2026-10-01T00:00:00Z", "status" to "Completed", "promisedDate" to "2026-10-20"))
        val none = order(mapOf("id" to "ORD-5", "createdAt" to "2026-10-01T00:00:00Z", "status" to "Pending"))
        val junk = order(mapOf("id" to "ORD-6", "createdAt" to "2026-10-01T00:00:00Z", "status" to "Pending", "promisedDate" to "soon"))
        assertEquals(mapOf("2026-10-20" to 3), shopCalendarDue(listOf(a, b, c, done, none, junk)))
    }

    @Test
    fun testTheOrdersPromisedOnADay() {
        val a = order(mapOf("id" to "ORD-1", "createdAt" to "2026-10-01T00:00:00Z", "status" to "Pending", "promisedDate" to "2026-10-20"))
        val b = order(mapOf("id" to "ORD-2", "createdAt" to "2026-10-01T00:00:00Z", "status" to "In Progress", "promisedDate" to "2026-10-19T20:00:00.000Z"))
        val done = order(mapOf("id" to "ORD-3", "createdAt" to "2026-10-01T00:00:00Z", "status" to "Completed", "promisedDate" to "2026-10-20"))
        val other = order(mapOf("id" to "ORD-4", "createdAt" to "2026-10-01T00:00:00Z", "status" to "Pending", "promisedDate" to "2026-10-21"))
        assertEquals(listOf("ORD-1", "ORD-2"), shopCalendarDueOn("2026-10-20", orders = listOf(a, b, done, other)).map { it.id })
        assertEquals(0, shopCalendarDueOn("2026-10-22", orders = listOf(a, b, done, other)).size)
    }

    @Test
    fun testTheMonthOnScreenAddsItsOwnDaysOnly() {
        val i1 = invoice(mapOf("id" to "INV-1", "createdAt" to "2026-10-02T08:00:00Z", "grandTotal" to 100_000))
        val i2 = invoice(mapOf("id" to "INV-2", "createdAt" to "2026-10-03T08:00:00Z", "grandTotal" to 50_000))
        val i3 = invoice(mapOf("id" to "INV-3", "createdAt" to "2026-09-30T08:00:00Z", "grandTotal" to 999_999))
        val o1 = order(mapOf("id" to "ORD-1", "createdAt" to "2026-10-03T09:00:00Z", "status" to "Pending", "subtotal" to 10_000))
        val o2 = order(mapOf("id" to "ORD-2", "createdAt" to "2026-10-04T09:00:00Z", "status" to "Cancelled", "subtotal" to 7_000))
        val days = shopCalendarDays(invoices = listOf(i1, i2, i3), orders = listOf(o1, o2))
        val oct = shopCalendarMonth(days, year = 2026, month = 10)
        assertEquals(ShopCalendarMonth(sales = 2, orders = 2, total = 160_000.0, days = 2, perTradingDay = 80_000.0), oct)
        val sep = shopCalendarMonth(days, year = 2026, month = 9)
        assertEquals(1, sep.sales)
        assertEquals(999_999.0, sep.total)
        // A month with nothing in it: no average.
        assertEquals(ShopCalendarMonth(sales = 0, orders = 0, total = 0.0, days = 0, perTradingDay = 0.0), shopCalendarMonth(days, year = 2026, month = 8))
    }

    @Test
    fun testTheGridHasAGapForEachWeekdayBeforeTheFirst() {
        // 1 Oct 2026 is a Thursday: Sunday to Wednesday are gaps.
        val oct = ShopCalendar.cells(year = 2026, month = 10)
        assertEquals(4 + 31, oct.size)
        assertEquals(listOf(0, 0, 0, 0, 1), oct.take(5).map { it ?: 0 })
        assertEquals(31, oct.last())
        // 1 Feb 2026 is a Sunday: no gap. 2028 is a leap year.
        val feb = ShopCalendar.cells(year = 2026, month = 2)
        assertEquals(28, feb.size)
        assertEquals(1, feb.first())
        assertEquals(29, ShopCalendar.cells(year = 2028, month = 2).filterNotNull().size)
    }

    @Test
    fun testStepsAndWords() {
        assertEquals(ShopCalendar.YearMonth(2027, 1), ShopCalendar.step(year = 2026, month = 12, by = 1))
        assertEquals(ShopCalendar.YearMonth(2025, 12), ShopCalendar.step(year = 2026, month = 1, by = -1))
        assertEquals(ShopCalendar.YearMonth(2026, 10), ShopCalendar.step(year = 2026, month = 10, by = 0))
        assertEquals(ShopCalendar.YearMonth(2024, 12), ShopCalendar.step(year = 2026, month = 3, by = -15))
        assertEquals("October 2026", ShopCalendar.title(year = 2026, month = 10))
        assertEquals("October 9, 2026", ShopCalendar.longDay("2026-10-09"))
        assertEquals("nonsense", ShopCalendar.longDay("nonsense"))
        assertEquals("2026-03", ShopCalendar.monthKey(year = 2026, month = 3))
        assertEquals("2026-03-07", ShopCalendar.dayKey(year = 2026, month = 3, day = 7))
        // 20:00 UTC on the 8th is already the 9th in Karachi.
        val t = ShopCalendar.today(now = ERPDate.parse("2026-10-08T20:00:00Z")!!)
        assertEquals(ShopCalendar.YearMonthDay(2026, 10, 9), t)
    }

    @Test
    fun testAnEmptyCellsMoney() {
        assertEquals("0", ShopCalendar.dayMoney(0.0))
        assertEquals("850", ShopCalendar.dayMoney(850.0))
        assertEquals("999", ShopCalendar.dayMoney(999.0))
        assertEquals("1k", ShopCalendar.dayMoney(1000.0))
        assertEquals("12k", ShopCalendar.dayMoney(12_499.0))
        assertEquals("13k", ShopCalendar.dayMoney(12_500.0))
        assertEquals("999k", ShopCalendar.dayMoney(999_499.0))
        assertEquals("1M", ShopCalendar.dayMoney(999_500.0))
        assertEquals("1.5M", ShopCalendar.dayMoney(1_500_000.0))
        assertEquals("12.3M", ShopCalendar.dayMoney(12_345_678.0))
    }

    @Test
    fun testTheTimeOfDayIsKarachis() {
        assertEquals("1:00 am", ShopCalendar.clock(iso = "2026-10-08T20:00:00Z"))
        assertEquals("12:00 am", ShopCalendar.clock(iso = "2026-10-08T19:00:00Z"))
        assertEquals("12:05 pm", ShopCalendar.clock(iso = "2026-10-09T07:05:00Z"))
        assertEquals("4:30 pm", ShopCalendar.clock(iso = "2026-10-09T11:30:00Z"))
        assertEquals("", ShopCalendar.clock(iso = ""))
    }
}
