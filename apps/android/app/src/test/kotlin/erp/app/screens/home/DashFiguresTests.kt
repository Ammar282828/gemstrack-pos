package erp.app.screens.home

import erp.app.data.OnlineInbox
import erp.core.logic.PromiseState
import erp.core.models.AdditionalRevenue
import erp.core.models.Customer
import erp.core.models.Expense
import erp.core.models.HisaabEntry
import erp.core.models.Invoice
import erp.core.models.Karigar
import erp.core.models.KarigarJob
import erp.core.models.Order
import erp.core.models.Repair
import java.time.Instant
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The dashboard's gathering, over made-up books. Monday 12 October 2026, noon in Karachi. */
class DashFiguresTests {
    private val now = Instant.parse("2026-10-12T07:00:00Z")

    private fun invoice(
        id: String, name: String = "Sana Demo", total: Double = 100_000.0, paid: Double = total,
        at: String = "2026-10-12T06:00:00.000Z", extra: Map<String, Any?> = emptyMap(),
    ) = Invoice.fromMap(
        mapOf(
            "id" to id, "customerName" to name, "grandTotal" to total, "subtotal" to total, "amountPaid" to paid,
            "balanceDue" to total - paid, "createdAt" to at, "items" to emptyList<Any>(),
        ) + extra,
    )

    private fun order(id: String, at: String = "2026-10-10T06:00:00.000Z", extra: Map<String, Any?> = emptyMap()) =
        Order.fromMap(
            mapOf(
                "id" to id, "createdAt" to at, "status" to "Pending", "customerName" to "Hira Demo", "subtotal" to 50_000, "grandTotal" to 50_000,
                "items" to emptyList<Any>(),
            ) + extra,
        )

    private fun figures(
        orders: List<Order> = emptyList(), invoices: List<Invoice> = emptyList(), revenues: List<AdditionalRevenue> = emptyList(),
        expenses: List<Expense> = emptyList(), karigars: List<Karigar> = emptyList(), jobs: List<KarigarJob> = emptyList(),
        repairs: List<Repair> = emptyList(), customers: List<Customer> = emptyList(), hisaab: List<HisaabEntry> = emptyList(),
    ) = DashFigures(now, orders, invoices, revenues, expenses, karigars, jobs, repairs, customers, hisaab)

    @Test fun todayCountsTheSaleValueOfEachNonRefundedInvoice() {
        val f = figures(
            invoices = listOf(
                invoice("INV-1", total = 120_000.0),
                invoice("INV-2", total = 30_000.0, extra = mapOf("exchanges" to listOf(mapOf("description" to "old ring", "value" to 10_000)))),
                invoice("INV-3", total = 999_000.0, extra = mapOf("status" to "Refunded")),
                invoice("INV-4", total = 40_000.0, at = "2026-10-10T06:00:00.000Z"),
            ),
        )
        assertEquals(160_000.0, f.todayRevenue, 0.001)
        assertEquals(2, f.todayInvoiceCount)
        // Yesterday-and-earlier this month still count in the month.
        assertEquals(200_000.0, f.monthRevenue, 0.001)
    }

    @Test fun anInvoiceFromAnOrderCountsOnTheOrdersDay() {
        val taken = order("ORD-1", at = "2026-09-20T06:00:00.000Z")
        val f = figures(
            orders = listOf(taken.let { Order.fromMap(mapOf("id" to "ORD-1", "createdAt" to "2026-09-20T06:00:00.000Z", "status" to "Completed", "invoiceId" to "INV-1", "items" to emptyList<Any>())) }),
            invoices = listOf(invoice("INV-1", total = 70_000.0, extra = mapOf("sourceOrderId" to "ORD-1"))),
        )
        assertEquals(0.0, f.todayRevenue, 0.001)
        assertEquals(0, f.todayInvoiceCount)
        assertEquals(0.0, f.monthRevenue, 0.001)
        assertEquals(70_000.0, f.lastMonthRevenue, 0.001)
    }

    @Test fun aCounterOrderIsASaleOnceTakenButAnOnlineOneWaitsForItsTransfer() {
        val counter = order("ORD-C", at = "2026-10-12T05:00:00.000Z")
        val online = order("ORD-W", at = "2026-10-12T05:30:00.000Z", extra = mapOf("website" to mapOf("paymentStatus" to "awaiting_transfer", "token" to "t")))
        val f = figures(orders = listOf(counter, online))
        assertEquals(50_000.0, f.todayRevenue, 0.001)
        // An online order awaiting its transfer is not due to anyone yet either.
        assertEquals(listOf("oORD-C"), f.due.map { it.id })
    }

    // lib/analytics/revenue-period.test.ts "gold coins are apart, as in Analytics", case for case (Home's month = Analytics' revenue).
    private fun line(category: String, total: Double) = mapOf("categoryId" to category, "itemTotal" to total, "quantity" to 1)
    private fun lined(id: String, total: Double, paid: Double, vararg items: Map<String, Any>, at: String = "2026-10-08T06:00:00.000Z") =
        invoice(id, total = total, paid = paid, at = at, extra = mapOf("items" to items.toList()))

    private val coinInv get() = lined("INV-coin", 1000.0, 1000.0, line("cat017", 1000.0))
    private val ringInv get() = lined("INV-ring", 500.0, 500.0, line("cat001", 500.0))
    private val mixedInv get() = lined("INV-mix", 400.0, 400.0, line("cat017", 100.0), line("cat001", 300.0))
    private val polish get() = AdditionalRevenue.fromMap(mapOf("id" to "R1", "date" to "2026-10-08T06:00:00.000Z", "description" to "Polish", "amount" to 50))

    @Test fun aCoinInvoiceLeavesTheMonthAndIsReportedInTheCoinLine() {
        val f = figures(invoices = listOf(coinInv, ringInv, mixedInv), revenues = listOf(polish))
        assertEquals(500.0 + 300.0 + 50.0, f.monthRevenue, 0.001)
        assertEquals(1000.0 + 100.0, f.monthCoins, 0.001)
    }

    @Test fun homeEqualsWhatAnalyticsCountsOnAMixedFixture() {
        val invoices = listOf(coinInv, ringInv, mixedInv)
        val (jewellery, coins) = erp.app.screens.analytics.AnaCoins.splitAll(invoices)
        val f = figures(invoices = invoices, revenues = listOf(polish))
        assertEquals(jewellery.sumOf { erp.core.logic.invoiceSaleValue(it) } + 50.0, f.monthRevenue, 0.001)
        assertEquals(erp.app.screens.analytics.AnaCoins.summarise(coins).revenue, f.monthCoins, 0.001)
    }

    @Test fun noCoinLineWhenNoneWereSoldAndRefundedCoinsAreIgnored() {
        assertEquals(0.0, figures(invoices = listOf(ringInv)).monthCoins, 0.001)
        val refunded = invoice("INV-r", total = 1000.0, extra = mapOf("status" to "Refunded", "items" to listOf(line("cat017", 1000.0))))
        assertEquals(0.0, figures(invoices = listOf(refunded)).monthCoins, 0.001)
    }

    @Test fun anInvoiceWithNoCreatedAtCountsNowhere() {
        assertEquals(0.0, figures(invoices = listOf(invoice("INV-e", at = ""))).monthRevenue, 0.001)
        assertEquals(0.0, figures(invoices = listOf(invoice("INV-e", at = ""))).todayRevenue, 0.001)
    }

    @Test fun aFutureDatedRowIsOutOfTodayAndThisMonth() {
        val f = figures(invoices = listOf(invoice("INV-f", total = 700.0, at = "2026-10-20T06:00:00.000Z"), invoice("INV-n", total = 100.0)))
        assertEquals(100.0, f.monthRevenue, 0.001)
        assertEquals(100.0, f.todayRevenue, 0.001)
    }

    @Test fun extraRevenueCounts() {
        val f = figures(revenues = listOf(AdditionalRevenue.fromMap(mapOf("id" to "R1", "date" to "2026-10-12T06:00:00.000Z", "description" to "Polish", "amount" to 2_500))))
        assertEquals(2_500.0, f.todayRevenue, 0.001)
    }

    @Test fun thisMonthAgainstLastIsNullWithNothingLastMonthAndAShareOtherwise() {
        assertNull(figures(invoices = listOf(invoice("INV-1"))).monthAgainstLast)
        val f = figures(invoices = listOf(invoice("INV-1", total = 62_000.0), invoice("INV-0", total = 100_000.0, at = "2026-09-10T06:00:00.000Z")))
        assertEquals(0.62, f.monthAgainstLast!!, 1e-9)
        assertEquals("62% of Sep", monthChange(0.62, now).text)
        assertEquals("+12%", monthChange(1.12, now).text)
        assertEquals("12% more than all of September", monthChange(1.12, now).spoken)
        // Barely over still says +1%.
        assertEquals("+1%", monthChange(1.001, now).text)
    }

    @Test fun theWeekIsSevenDaysTodayLastAndTheLineThirty() {
        val f = figures(invoices = listOf(invoice("INV-1", total = 10.0), invoice("INV-2", total = 20.0, at = "2026-10-08T06:00:00.000Z")))
        assertEquals(30, f.days.size)
        assertEquals(7, f.week.size)
        assertEquals(10.0, f.week.last().amount, 0.001)
        assertEquals(20.0, f.week[2].amount, 0.001)
        assertEquals(30.0, f.revenue30, 0.001)
        assertEquals("12 Oct", DashDate.dayMonth(f.week.last().day))
    }

    @Test fun theThirtyDayLineLeavesPartnerDrawingsOut() {
        val spend = listOf(
            Expense.fromMap(mapOf("id" to "E1", "date" to "2026-10-05", "category" to "Rent", "description" to "Rent", "amount" to 40_000)),
            Expense.fromMap(mapOf("id" to "E2", "date" to "2026-10-06", "category" to "Partner Drawings", "description" to "Draw", "amount" to 90_000)),
            Expense.fromMap(mapOf("id" to "E3", "date" to "2026-07-06", "category" to "Rent", "description" to "Old", "amount" to 5_000)),
        )
        val f = figures(expenses = spend, invoices = listOf(invoice("INV-1", total = 100_000.0)))
        assertEquals(40_000.0, f.expenses30, 0.001)
        assertEquals(60_000.0, f.net30, 0.001)
    }

    @Test fun owedIsInvoicesPlusTheHisaabBiggestFirst() {
        val rows = listOf(
            HisaabEntry.fromMap(mapOf("id" to "H1", "entityId" to "CUST-1", "entityType" to "customer", "entityName" to "Zoya Demo", "date" to "2026-10-01", "description" to "Old", "cashDebit" to 25_000, "cashCredit" to 0)),
        )
        val f = figures(
            invoices = listOf(invoice("INV-1", paid = 50_000.0), invoice("INV-2", paid = 0.0, total = 30_000.0), invoice("INV-3")),
            hisaab = rows,
        )
        assertEquals(listOf("INV-1", "INV-2"), f.unpaid.map { it.id })
        assertEquals(105_000.0, f.totalOutstanding, 0.001)
        assertEquals(25_000.0, f.owedInHisaab, 0.001)
    }

    @Test fun lastSaleTodayIsTheNewestNonRefundedOneAndStopsAtYesterday() {
        val a = invoice("INV-A", at = "2026-10-12T06:30:00.000Z")
        val refunded = invoice("INV-R", at = "2026-10-12T06:45:00.000Z", extra = mapOf("status" to "Refunded"))
        assertEquals("INV-A", figures(invoices = listOf(refunded, a)).lastSaleToday?.id)
        assertNull(figures(invoices = listOf(invoice("INV-Y", at = "2026-10-11T06:00:00.000Z"))).lastSaleToday)
        assertEquals("11:30 am", DashDate.clock("2026-10-12T06:30:00.000Z"))
    }

    @Test fun dueIsLateThenTodayThenSoonestThenUndated() {
        val orders = listOf(
            order("ORD-UP", extra = mapOf("promisedDate" to "2026-10-20")),
            order("ORD-TODAY", extra = mapOf("promisedDate" to "2026-10-12")),
            order("ORD-LATE", extra = mapOf("promisedDate" to "2026-10-08")),
            order("ORD-NODATE", at = "2026-10-11T06:00:00.000Z"),
            order("ORD-DONE", extra = mapOf("status" to "Completed", "promisedDate" to "2026-10-01")),
        )
        val repair = Repair.fromMap(
            mapOf(
                "id" to "REP-1", "customerName" to "Mina Demo", "status" to "received", "receivedAt" to "2026-10-01T06:00:00.000Z",
                "promisedDate" to "2026-10-09", "pieces" to listOf(mapOf("item" to "Chain", "work" to "Clasp", "price" to 1_500)), "payments" to emptyList<Any>(),
            ),
        )
        val f = figures(orders = orders, repairs = listOf(repair))
        assertEquals(listOf("oORD-LATE", "rREP-1", "oORD-TODAY", "oORD-UP", "oORD-NODATE"), f.due.map { it.id })
        // The oldest promise first among the late ones: the 8th is older than the 9th.
        assertTrue(f.due[0].isLate && f.due[1].isLate)
        assertEquals(1_500.0, f.due[1].amount, 0.001)
        assertEquals("Repair · REP-1", f.due[1].refLine)
        assertEquals("/repairs?id=REP-1", f.due[1].path)
        assertEquals("4 days late", f.due[0].whenText(now))
        assertEquals("due today", f.due[2].whenText(now))
        assertEquals("Tue 20 Oct", f.due[3].whenText(now))
        assertEquals("no date", f.due[4].whenText(now))
        assertEquals(PromiseState.noPromise, f.due[4].timing.state)
    }

    @Test fun anOrderWithNoDateIsLateOnlyOnceItIsAWeekOld() {
        val f = figures(orders = listOf(order("ORD-OLD", at = "2026-10-01T06:00:00.000Z")))
        assertTrue(f.due.single().isLate)
        assertEquals("11 days old", f.due.single().whenText(now))
    }

    @Test fun readyRepairsWaitThreeDaysBeforeTheyNeedACall() {
        fun repair(id: String, readyAt: String) = Repair.fromMap(
            mapOf("id" to id, "customerName" to "Mina Demo", "status" to "ready", "receivedAt" to "2026-10-01T06:00:00.000Z", "readyAt" to readyAt, "pieces" to emptyList<Any>(), "payments" to emptyList<Any>()),
        )
        val f = figures(repairs = listOf(repair("REP-OLD", "2026-10-08T06:00:00.000Z"), repair("REP-NEW", "2026-10-11T06:00:00.000Z")))
        assertEquals(listOf("REP-OLD"), f.readyWaiting.map { it.id })
    }

    private fun karigar(id: String, name: String) = Karigar.fromMap(mapOf("id" to id, "name" to name))

    @Test fun theBenchGroupsOverdueKarigarsAndCountsWhatNobodyHas() {
        val old = "2026-09-20T06:00:00.000Z"
        val pieces = listOf(mapOf("description" to "Ring", "karigarId" to "K1"), mapOf("description" to "Chain", "karigarId" to "K1"), mapOf("description" to "Pendant"), mapOf("description" to "Done", "karigarId" to "K2", "isCompleted" to true))
        val o = order("ORD-B", at = old, extra = mapOf("status" to "In Progress", "items" to pieces))
        val job = KarigarJob.fromMap(mapOf("id" to "J1", "karigarId" to "K2", "karigarName" to "Bilal", "description" to "Polish", "status" to "in-progress", "assignedDate" to "2026-10-10T06:00:00.000Z"))
        val f = figures(orders = listOf(o), karigars = listOf(karigar("K1", "Imran"), karigar("K2", "Bilal")), jobs = listOf(job))
        // Three pieces unfinished on the order (two with Imran, one unassigned) plus Bilal's fresh job.
        assertEquals(4, f.activeJobs)
        assertEquals(3, f.criticalJobs.size)
        assertEquals(1, f.unassignedJobs.size)
        val needs = f.needs(0, null)
        val bench = needs.filter { it.kind == DashNeed.Kind.bench }
        assertEquals(1, bench.size)
        assertEquals("Imran", bench.single().title)
        assertEquals("/karigars/K1", bench.single().path)
        assertEquals("2 pieces overdue · longest 22 days", bench.single().detail)
        assertEquals("1 unassigned piece", needs.single { it.kind == DashNeed.Kind.unassigned }.title)
        assertEquals(DashNeed.Tone.danger, bench.single().tone)
    }

    @Test fun needsComeWorstFirstInTheWebsOrder() {
        val late = order("ORD-L", extra = mapOf("promisedDate" to "2026-10-08"))
        val lateTwo = order("ORD-L2", extra = mapOf("promisedDate" to "2026-10-10"))
        val unpaid = (1..5).map { invoice("INV-$it", name = "Customer $it", total = 10_000.0 * it, paid = 0.0, at = "2026-10-0${it}T06:00:00.000Z") }
        val birthday = Customer.fromMap(mapOf("id" to "C1", "name" to "Noor Demo", "birthday" to "1990-10-13"))
        val f = figures(orders = listOf(late, lateTwo), invoices = unpaid, customers = listOf(birthday))
        val needs = f.needs(2, OnlineInbox.RatePause("2026-10-09T06:00:00.000Z"))
        assertEquals(
            listOf(DashNeed.Kind.rate, DashNeed.Kind.online, DashNeed.Kind.late, DashNeed.Kind.unpaid, DashNeed.Kind.unpaid, DashNeed.Kind.unpaid, DashNeed.Kind.unpaid, DashNeed.Kind.birthday),
            needs.map { it.kind },
        )
        assertTrue(needs[0].opensRates)
        assertEquals("/settings?tab=rates", needs[0].path)
        assertEquals("Last set 9 Oct · the rate chip at the top", needs[0].detail)
        assertEquals("2 online orders to confirm", needs[1].title)
        assertEquals("2 promises past their date", needs[2].title)
        assertEquals("Longest: Hira Demo, 4 days late", needs[2].detail)
        // The three biggest balances by name, the rest as one row.
        assertEquals(listOf("Customer 5", "Customer 4", "Customer 3"), needs.subList(3, 6).map { it.title })
        assertEquals("2 more unpaid", needs[6].title)
        assertEquals(30_000.0, needs[6].amount!!, 0.001)
        assertEquals("/invoices", needs[6].path)
        assertEquals("Birthday tomorrow", needs[7].detail)
        assertEquals(DashNeed.Tone.warn, needs[7].tone)
        assertEquals("/customers/C1", needs[7].path)
    }

    @Test fun aSingleLateOrderIsNamedAndOnlineOrdersSpeakInTheSingular() {
        val f = figures(orders = listOf(order("ORD-L", extra = mapOf("promisedDate" to "2026-10-08"))))
        val needs = f.needs(1, null)
        assertEquals("An online order to confirm", needs[0].title)
        assertEquals("Hira Demo’s order is late", needs[1].title)
        assertEquals("4 days late", needs[1].detail)
        assertFalse(needs.any { it.opensRates })
    }

    @Test fun nothingWaitingIsAnEmptyList() {
        assertTrue(figures().needs(0, null).isEmpty())
        assertNotNull(figures().week)
    }
}
