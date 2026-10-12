package erp.core

import erp.core.logic.OverheadMonthRow
import erp.core.logic.OverheadProgress
import erp.core.logic.OverheadRevenue
import erp.core.logic.OverheadSummary
import erp.core.logic.Overheads
import erp.core.models.Invoice
import erp.core.models.Order
import erp.core.models.OverheadItem
import erp.core.models.OverheadPlan
import erp.core.models.OverheadPlansAnswer
import java.time.Instant
import java.time.LocalDateTime
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * src/lib/overheads.test.ts, case for case. "Now" is Karachi's wall clock, as the TypeScript builds it in
 * local time on the shop's devices. All names and amounts made up.
 */
class OverheadsTests {
    private fun karachi(y: Int, m: Int, d: Int, h: Int = 12): Instant = LocalDateTime.of(y, m, d, h, 0).toInstant(ERPDate.karachi)

    private fun plan(from: String, vararg amounts: Double): OverheadPlan =
        OverheadPlan(from = from, items = amounts.withIndex().map { (i, a) -> OverheadItem(id = "item-${i + 1}", label = "Line ${i + 1}", amount = a) })

    private fun invoice(f: Map<String, Any?>): Invoice = ERPDecode.model<Invoice>(f)!!
    private fun order(f: Map<String, Any?>): Order = ERPDecode.model<Order>(f)!!
    private fun item(f: Map<String, Any?>): OverheadItem = ERPDecode.model<OverheadItem>(f)!!

    // MARK: The sheet

    @Test
    fun testAddsTheLinesAMissingOrOddAmountCountingAsNothing() {
        assertEquals(55_500.0, Overheads.overheadTotal(listOf(OverheadItem("a", "Rent", 20_000.0), OverheadItem("b", "Help", 35_500.0))))
        assertEquals(7000.0, Overheads.overheadTotal(listOf(item(mapOf("id" to "a", "label" to "Odd", "amount" to "lots")), item(mapOf("id" to "b", "label" to "Text", "amount" to "7000")))))
        assertEquals(0.0, Overheads.overheadTotal(emptyList()))
    }

    @Test
    fun testGivesANewLineAnIdNoSiblingHas() {
        assertEquals("item-1", Overheads.newOverheadId(emptyList()))
        assertEquals("item-2", Overheads.newOverheadId(listOf(OverheadItem("rent", "Rent", 1.0))))
        assertEquals("item-4", Overheads.newOverheadId(listOf(OverheadItem("item-2", "A", 1.0), OverheadItem("item-3", "B", 1.0))))
    }

    @Test
    fun testNamesMonthsAsThePageDoesAndLeavesAKeyItCannotReadAsItIs() {
        assertEquals("September 2026", Overheads.monthLabel("2026-09"))
        assertEquals("January 2027", Overheads.monthLabel("2027-01"))
        assertEquals("not-a-month", Overheads.monthLabel("not-a-month"))
        assertEquals("2026-10", Overheads.monthKey(karachi(2026, 10, 10)))
        // Karachi's month, not UTC's: 1 am on the 1st there is still the 30th in London.
        assertEquals("2026-10", Overheads.monthKey(karachi(2026, 10, 1, 1)))
    }

    @Test
    fun testCountsTheMonthsFromTheStartToNowAndNoneBeforeIt() {
        assertEquals(listOf("2026-09", "2026-10", "2026-11"), Overheads.monthsSinceStart(karachi(2026, 11, 3)))
        assertEquals(listOf("2026-11", "2026-12", "2027-01", "2027-02"), Overheads.monthsSinceStart(karachi(2027, 2, 1), start = "2026-11"))
        assertEquals(emptyList(), Overheads.monthsSinceStart(karachi(2026, 8, 20)))
        assertEquals(emptyList(), Overheads.monthsSinceStart(karachi(2026, 10, 1), start = "soon"))
    }

    @Test
    fun testUsesTheLatestPlanThatHasStartedAndNoneBeforeTheFirst() {
        val plans = listOf(plan("2026-11", 300.0), plan("2026-09", 100.0), plan("2026-10", 200.0))
        assertEquals(100.0, Overheads.planForMonth(plans, "2026-09")?.firstOrNull()?.amount)
        assertEquals(200.0, Overheads.planForMonth(plans, "2026-10")?.firstOrNull()?.amount)
        assertEquals(300.0, Overheads.planForMonth(plans, "2027-03")?.firstOrNull()?.amount)
        assertNull(Overheads.planForMonth(plans, "2026-08"))
        assertNull(Overheads.planForMonth(emptyList(), "2026-10"))
    }

    // MARK: This month

    @Test
    fun testSaysWhatIsStillToEarnAndWhatEachDayLeftHasToBring() {
        val p = Overheads.overheadProgress(target = 310_000.0, earned = 124_000.0, now = karachi(2026, 10, 10))
        assertEquals(186_000.0, p.shortfall)
        assertEquals(40.0, p.percent)
        // 31 days in October, the 10th itself included.
        assertEquals(22, p.daysLeft)
        assertEquals(186_000.0 / 22, p.perDayNeeded, 1e-9)
    }

    @Test
    fun testOnceCoveredNothingShortNothingADayTheBarFull() {
        val p = Overheads.overheadProgress(target = 100_000.0, earned = 150_000.0, now = karachi(2026, 2, 28))
        assertEquals(OverheadProgress(target = 100_000.0, earned = 150_000.0, shortfall = 0.0, percent = 100.0, daysLeft = 1, perDayNeeded = 0.0), p)
    }

    @Test
    fun testASheetOfNothingHasAnEmptyBar() {
        assertEquals(0.0, Overheads.overheadProgress(target = 0.0, earned = 5000.0, now = karachi(2026, 9, 1)).percent)
        assertEquals(30, Overheads.overheadProgress(target = 0.0, earned = 5000.0, now = karachi(2026, 9, 1)).daysLeft)
    }

    // MARK: Revenue by month

    @Test
    fun testDatesAnInvoiceByItsOrderCountsTheExchangeAndDropsARefund() {
        val orders = listOf(order(mapOf("id" to "ORD-1", "createdAt" to "2026-09-14T10:00:00.000Z", "subtotal" to 90_000, "invoiceId" to "INV-1", "status" to "Completed")))
        val invoices = listOf(
            // Billed in October for an order taken in September: September's.
            invoice(mapOf("id" to "INV-1", "createdAt" to "2026-10-15T10:00:00.000Z", "sourceOrderId" to "ORD-1", "grandTotal" to 60_000, "exchanges" to listOf(mapOf("description" to "Old ring", "value" to 30_000)))),
            invoice(mapOf("id" to "INV-2", "createdAt" to "2026-10-16T10:00:00.000Z", "grandTotal" to 25_000)),
            invoice(mapOf("id" to "INV-3", "createdAt" to "2026-10-17T10:00:00.000Z", "grandTotal" to 40_000, "status" to "Refunded")),
            invoice(mapOf("id" to "INV-4", "createdAt" to "", "grandTotal" to 99_000)),
            invoice(mapOf("id" to "INV-5", "createdAt" to "whenever", "grandTotal" to 99_000)),
        )
        val r = Overheads.revenueByMonth(invoices = invoices, orders = orders)
        assertEquals(OverheadRevenue(invoiced = 90_000.0, uninvoiced = 0.0, total = 90_000.0), r["2026-09"])
        assertEquals(OverheadRevenue(invoiced = 25_000.0, uninvoiced = 0.0, total = 25_000.0), r["2026-10"])
        assertEquals(listOf("2026-09", "2026-10"), r.keys.sorted())
    }

    @Test
    fun testAnInvoiceWhoseOrderIsNotOnFileKeepsItsOwnDate() {
        val r = Overheads.revenueByMonth(invoices = listOf(invoice(mapOf("createdAt" to "2026-10-05T10:00:00.000Z", "sourceOrderId" to "ORD-GONE", "grandTotal" to 12_000))), orders = emptyList())
        assertEquals(12_000.0, r["2026-10"]?.total)
    }

    @Test
    fun testAnOrderNotYetBilledCountsAtItsSubtotalCancelledRefundedAndBilledOnesDoNot() {
        val orders = listOf(
            order(mapOf("id" to "ORD-2", "createdAt" to "2026-10-02T10:00:00.000Z", "subtotal" to 70_000, "status" to "Pending")),
            order(mapOf("id" to "ORD-3", "createdAt" to "2026-10-03T10:00:00.000Z", "subtotal" to 11_000, "status" to "Cancelled")),
            order(mapOf("id" to "ORD-4", "createdAt" to "2026-10-04T10:00:00.000Z", "subtotal" to 12_000, "status" to "Refunded")),
            order(mapOf("id" to "ORD-5", "createdAt" to "2026-10-05T10:00:00.000Z", "subtotal" to 13_000, "invoiceId" to "INV-9")),
            order(mapOf("id" to "ORD-6", "createdAt" to "2026-10-06T10:00:00.000Z", "status" to "In Progress")),
            order(mapOf("id" to "ORD-7", "subtotal" to 14_000)),
        )
        assertEquals(OverheadRevenue(invoiced = 0.0, uninvoiced = 70_000.0, total = 70_000.0), Overheads.revenueByMonth(invoices = emptyList(), orders = orders)["2026-10"])
    }

    // MARK: Month by month

    private val plans: List<OverheadPlan> get() = listOf(plan("2026-09", 100_000.0, 50_000.0), plan("2026-11", 200_000.0))
    private val revenue: Map<String, OverheadRevenue> = mapOf(
        "2026-09" to OverheadRevenue(invoiced = 0.0, uninvoiced = 0.0, total = 180_000.0),
        "2026-10" to OverheadRevenue(invoiced = 0.0, uninvoiced = 0.0, total = 120_000.0),
        "2026-11" to OverheadRevenue(invoiced = 0.0, uninvoiced = 0.0, total = 30_000.0),
    )

    @Test
    fun testOneRowAMonthFromTheStartNewestFirstEachAgainstThePlanInForceThen() {
        val rows = Overheads.monthlyRows(plans, revenue = revenue, now = karachi(2026, 11, 12))
        assertEquals(listOf("2026-11", "2026-10", "2026-09"), rows.map { it.month })
        assertEquals(OverheadMonthRow(month = "2026-11", label = "November 2026", target = 200_000.0, earned = 30_000.0, surplus = -170_000.0, met = false, percent = 15.0, inProgress = true), rows[0])
        assertEquals(OverheadMonthRow(month = "2026-10", label = "October 2026", target = 150_000.0, earned = 120_000.0, surplus = -30_000.0, met = false, percent = 80.0, inProgress = false), rows[1])
        assertEquals(OverheadMonthRow(month = "2026-09", label = "September 2026", target = 150_000.0, earned = 180_000.0, surplus = 30_000.0, met = true, percent = 100.0, inProgress = false), rows[2])
    }

    @Test
    fun testAMonthBeforeAnyPlanHasNoTargetAndIsNeverMet() {
        val rows = Overheads.monthlyRows(listOf(plan("2026-10", 1000.0)), revenue = mapOf("2026-09" to OverheadRevenue(invoiced = 0.0, uninvoiced = 0.0, total = 5000.0)), now = karachi(2026, 10, 2))
        assertEquals("2026-09", rows[1].month)
        assertEquals(0.0, rows[1].target)
        assertEquals(5000.0, rows[1].earned)
        assertFalse(rows[1].met)
        assertEquals(0.0, rows[1].percent)
    }

    @Test
    fun testScoresOnlyTheFinishedMonths() {
        val s = Overheads.benchmarkSummary(Overheads.monthlyRows(plans, revenue = revenue, now = karachi(2026, 11, 12)))
        assertEquals(2, s.monthsScored)
        assertEquals(1, s.monthsMet)
        assertEquals(150_000.0, s.averageRevenue)
        assertEquals(0.0, s.cumulativeSurplus)
        assertEquals("2026-09", s.best?.month)
        assertEquals("2026-10", s.worst?.month)
    }

    @Test
    fun testWithNothingFinishedYetNothingIsScored() {
        val s = Overheads.benchmarkSummary(Overheads.monthlyRows(plans, revenue = revenue, now = karachi(2026, 9, 20)))
        assertEquals(OverheadSummary(monthsScored = 0, monthsMet = 0, averageRevenue = 0.0, cumulativeSurplus = 0.0, best = null, worst = null), s)
    }

    @Test
    fun testStartsInSeptember2026() {
        assertEquals("2026-09", Overheads.benchmarkStart)
    }

    // MARK: The ERP's answer

    @Test
    fun testReadsThePlansTheERPSends() {
        val a = ERPDecode.model<OverheadPlansAnswer>(
            mapOf(
                "start" to "2026-09", "saved" to true,
                "plans" to listOf(mapOf("from" to "2026-09", "items" to listOf(mapOf("id" to "rent", "label" to "Rent", "amount" to 20_000), mapOf("id" to "help", "label" to "Help", "amount" to "35000")))),
            ),
        )!!
        assertEquals("2026-09", a.start)
        assertTrue(a.saved)
        assertEquals(listOf(OverheadPlan(from = "2026-09", items = listOf(OverheadItem("rent", "Rent", 20_000.0), OverheadItem("help", "Help", 35_000.0)))), a.plans)
        assertEquals(emptyList(), ERPDecode.model<OverheadPlansAnswer>(emptyMap<String, Any?>())?.plans)
    }
}
