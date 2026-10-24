package erp.core

import erp.core.logic.CashMethod
import erp.core.logic.CashSource
import erp.core.logic.ExpenseLine
import erp.core.logic.JS
import erp.core.logic.TodaysCash
import erp.core.logic.karachiDayPeriod
import erp.core.logic.todaysCash
import erp.core.models.AdditionalRevenue
import erp.core.models.Expense
import erp.core.models.Invoice
import erp.core.models.Order
import erp.core.models.Repair
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

/** src/lib/analytics/todays-cash.test.ts, case for case (the customers are made up). */
class TodaysCashTests {
    private val now = ERPDate.parse("2026-10-01T15:00:00Z")!! // 20:00 in Karachi

    private fun T(hhmm: String): String = "2026-10-01T$hhmm:00+05:00"

    private inline fun <reified M : Any> models(list: List<Map<String, Any?>>): List<M> = list.map { ERPDecode.model<M>(it)!! }

    private val invoices: List<Invoice>
        get() = models(
            listOf(
                mapOf(
                    "id" to "INV-1", "customerName" to "Sana Example", "status" to "Paid", "createdAt" to T("11:00"), "grandTotal" to 100_000,
                    "exchangeAmount1" to 20_000, "exchangeDescription" to "Old ring",
                    "paymentHistory" to listOf(mapOf("amount" to 60_000, "date" to T("11:05"), "method" to "Cash"), mapOf("amount" to 20_000, "date" to T("11:06"), "method" to "Card")),
                ),
                mapOf(
                    "id" to "INV-2", "customerName" to "Walk-in Customer", "status" to "Paid", "createdAt" to "2026-09-20T10:00:00+05:00", "grandTotal" to 50_000,
                    "paymentHistory" to listOf(
                        mapOf("amount" to 50_000, "date" to "2026-09-30T23:30:00+05:00", "method" to "Cash"),
                        mapOf("amount" to 10_000, "date" to T("00:30"), "method" to "Bank Transfer"),
                    ),
                ),
                mapOf("id" to "INV-3", "status" to "Refunded", "createdAt" to T("12:00"), "paymentHistory" to listOf(mapOf("amount" to 9_999, "date" to T("12:00"), "method" to "Cash"))),
            ),
        )
    private val orders: List<Order>
        get() = models(
            listOf(
                mapOf("id" to "ORD-1", "customerName" to "Fatima Sample", "status" to "Pending", "createdAt" to T("13:00"), "advancePayment" to 15_000, "advanceMethod" to "Cash"),
                mapOf("id" to "ORD-2", "customerName" to "Old", "status" to "Pending", "createdAt" to T("13:30"), "advancePayment" to 5_000, "invoiceId" to "INV-9"),
            ),
        )
    private val repairs: List<Repair>
        get() = models(
            listOf(
                mapOf("id" to "REP-1", "customerName" to "Batool Test", "payments" to listOf(mapOf("amount" to 2_000, "date" to T("14:00"), "method" to "Card", "revenueId" to "rev-1"))),
            ),
        )
    private val extraRevenues: List<AdditionalRevenue>
        get() = models(
            listOf(
                mapOf("id" to "rev-1", "date" to T("14:00"), "description" to "Repair REP-1", "amount" to 2_000, "repairId" to "REP-1"),
                mapOf("id" to "rev-2", "date" to T("15:00"), "description" to "Polish", "amount" to 1_000),
            ),
        )
    private val expenses: List<Expense>
        get() = models(
            listOf(
                mapOf("id" to "e1", "date" to T("16:00"), "category" to "Tea", "description" to "Tea", "amount" to 500),
                mapOf("id" to "e2", "date" to T("16:30"), "category" to "Other", "description" to "Paid by a partner", "amount" to 7_000, "paidBy" to "mina"),
                mapOf("id" to "e3", "date" to "2026-09-30T18:00:00+05:00", "category" to "Tea", "description" to "Yesterday", "amount" to 300),
            ),
        )

    private val t: TodaysCash
        get() = todaysCash(invoices = invoices, orders = orders, repairs = repairs, extraRevenues = extraRevenues, expenses = expenses, now = now)

    @Test
    fun testIsKarachisDay() {
        assertEquals("2026-10-01", t.day)
        assertEquals("2026-10-01", karachiDayPeriod(ERPDate.parse("2026-09-30T19:30:00Z")!!).day) // 00:30 in Karachi
    }

    @Test
    fun testTakesMoneyInByHowItWasPaidInvoicesOrderAdvancesRepairsOtherExtraRevenue() {
        val r = t
        assertEquals(
            mapOf(CashMethod.cash to 75_000.0, CashMethod.card to 22_000.0, CashMethod.bankTransfer to 10_000.0, CashMethod.cheque to 0.0, CashMethod.notRecorded to 1_000.0),
            r.byMethod,
        )
        assertEquals(108_000.0, r.totalIn)
        assertEquals(listOf("INV-2", "INV-1", "INV-1", "ORD-1", "REP-1", "Polish"), r.lines.map { it.ref })
    }

    @Test
    fun testKeepsExchangeGoldOnItsOwnLineNeverInCash() {
        val r = t
        assertEquals(20_000.0, r.exchange)
        assertFalse(r.byMethod[CashMethod.cash]!! > 75_000)
    }

    @Test
    fun testTheDrawerIsCashInLessWhatTheBusinessPaidTodayNeverAPartnersOwnMoney() {
        val r = t
        assertEquals(500.0, r.expenses)
        assertEquals(74_500.0, r.netCash)
    }

    // Not in the TS tests: the lines themselves, and the edges of the Karachi day.
    @Test
    fun testEachLineSaysWhoWhatAndHow() {
        val lines = t.lines
        assertEquals(listOf(CashSource.invoice, CashSource.invoice, CashSource.invoice, CashSource.advance, CashSource.repair, CashSource.extra), lines.map { it.source })
        assertEquals(listOf("Walk-in Customer", "Sana Example", "Sana Example", "Fatima Sample", "Batool Test", ""), lines.map { it.who })
        assertEquals(listOf(CashMethod.bankTransfer, CashMethod.cash, CashMethod.card, CashMethod.cash, CashMethod.card, CashMethod.notRecorded), lines.map { it.method })
        assertEquals(listOf(10_000.0, 60_000.0, 20_000.0, 15_000.0, 2_000.0, 1_000.0), lines.map { it.amount })
        assertEquals(listOf(ExpenseLine(description = "Tea", amount = 500.0, category = "Tea")), t.expenseLines)
    }

    @Test
    fun testCreditGivenBackLowersMoneyInAndTheDrawerAndShowsAsPaidBack() {
        val back = models<Invoice>(
            listOf(
                mapOf(
                    "id" to "INV-C", "customerName" to "Sana Example", "customerId" to "c1", "status" to "Paid", "createdAt" to "2026-09-20T10:00:00+05:00",
                    "paymentHistory" to listOf(
                        mapOf("amount" to -5_000, "date" to T("10:00"), "method" to "Cash", "kind" to "credit-payback", "notes" to "Credit paid back"),
                        mapOf("amount" to -700, "date" to T("10:30"), "method" to "Cash", "notes" to "Refund: damaged"),
                    ),
                ),
            ),
        )
        val r = todaysCash(invoices = back, orders = emptyList(), repairs = emptyList(), extraRevenues = emptyList(), expenses = emptyList(), now = now)
        assertEquals(5_000.0, r.paidBack)
        assertEquals(-5_700.0, r.netCash)
        assertEquals(listOf(true, false), r.lines.map { it.payback })
    }

    @Test
    fun testTheDayRunsFromKarachisMidnightToItsLastMillisecond() {
        val (_, period) = karachiDayPeriod(now)
        assertEquals(ERPDate.parse("2026-09-30T19:00:00Z"), period.from)
        assertEquals(JS.ms(ERPDate.parse("2026-10-01T19:00:00Z")!!) - 1, JS.ms(period.to!!))
        val late = models<Invoice>(
            listOf(
                mapOf(
                    "id" to "INV-L", "customerName" to "Sana Example",
                    "paymentHistory" to listOf(
                        mapOf("amount" to 5, "date" to "2026-10-01T23:59:59.999+05:00", "method" to "Cash"),
                        mapOf("amount" to 7, "date" to "2026-10-02T00:00:00.000+05:00", "method" to "Cash"),
                    ),
                ),
            ),
        )
        val r = todaysCash(invoices = late, orders = emptyList(), repairs = emptyList(), extraRevenues = emptyList(), expenses = emptyList(), now = now)
        assertEquals(5.0, r.totalIn)
    }

    @Test
    fun testAMethodTheListDoesNotKnowIsNotRecorded() {
        val inv = models<Invoice>(listOf(mapOf("id" to "INV-M", "paymentHistory" to listOf(mapOf("amount" to 100, "date" to T("10:00"), "method" to "Easypaisa"), mapOf("amount" to 50, "date" to T("10:01"))))))
        val r = todaysCash(invoices = inv, orders = emptyList(), repairs = emptyList(), extraRevenues = emptyList(), expenses = emptyList(), now = now)
        assertEquals(150.0, r.byMethod[CashMethod.notRecorded])
        assertEquals(listOf("Walk-in", "Walk-in"), r.lines.map { it.who })
    }
}
