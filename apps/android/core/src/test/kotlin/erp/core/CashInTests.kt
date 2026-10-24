package erp.core

import erp.core.logic.CashIn
import erp.core.logic.Period
import erp.core.logic.cashInForPeriod
import erp.core.logic.invoicedOrderIds
import erp.core.logic.orderAdvancePayments
import erp.core.logic.paymentExchangePart
import erp.core.models.AdditionalRevenue
import erp.core.models.Invoice
import erp.core.models.Order
import erp.core.models.Payment
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals

/** src/lib/analytics/cash-in.test.ts, case for case. */
class CashInTests {
    private fun at(iso: String): Instant = ERPDate.parse(iso)!!
    private fun invoice(fields: Map<String, Any?>): Invoice = ERPDecode.model<Invoice>(fields)!!
    private fun order(fields: Map<String, Any?>): Order = ERPDecode.model<Order>(fields)!!

    private val september by lazy { Period(from = at("2026-09-01T00:00:00Z"), to = at("2026-09-30T23:59:59Z")) }
    private val august by lazy { Period(from = at("2026-08-01T00:00:00Z"), to = at("2026-08-31T23:59:59Z")) }

    // An order placed in August with 50,000 cash and 30,000 of gold, and a second advance of
    // 20,000 in September.
    private val openOrder: Map<String, Any?> = mapOf(
        "id" to "ORD-000123",
        "status" to "In Progress",
        "createdAt" to "2026-08-20T10:00:00.000Z",
        "advancePayment" to 70000,
        "advances" to listOf(mapOf("amount" to 20000, "date" to "2026-09-10T12:00:00.000Z")),
        "exchanges" to listOf(mapOf("description" to "Old 22k ring", "value" to 30000)),
        "advanceInExchangeValue" to 30000,
    )

    private fun orderWith(changes: Map<String, Any?>): Map<String, Any?> = openOrder + changes

    private fun run(period: Period, invoices: List<Map<String, Any?>>, orders: List<Map<String, Any?>>, extraRevenues: List<Map<String, Any?>> = emptyList()): CashIn {
        val invs = invoices.map { invoice(it) }
        val ords = orders.map { order(it) }
        return cashInForPeriod(
            invoices = invs, orders = ords, invoiced = invoicedOrderIds(ords, invs),
            extraRevenues = extraRevenues.map { ERPDecode.model<AdditionalRevenue>(it)!! }, period = period,
        )
    }

    // A customer's credit handed back is a negative invoice payment tagged kind "credit-payback" (lib/invoice-credit.ts):
    // netted off the payments like a refund, and also reported as `paidBack`.
    @Test
    fun testCreditHandedBackIsNettedOffPaymentsAndReportedAsPaidBack() {
        val inv = mapOf(
            "id" to "INV-9", "status" to "Paid", "createdAt" to "2026-09-02T10:00:00.000Z",
            "paymentHistory" to listOf(
                mapOf("amount" to 120000, "date" to "2026-09-02T10:00:00.000Z", "method" to "Cash"),
                mapOf("amount" to -20000, "date" to "2026-09-12T10:00:00.000Z", "method" to "Cash", "kind" to "credit-payback", "notes" to "Credit paid back"),
                mapOf("amount" to -1000, "date" to "2026-09-13T10:00:00.000Z", "method" to "Cash", "notes" to "Refund: small"),
            ),
        )
        val r = run(september, listOf(inv), emptyList())
        assertEquals(99000.0, r.invoicePayments)
        assertEquals(20000.0, r.paidBack) // a refund is not a give-back
    }

    private fun paymentFields(p: Payment): Map<String, Any?> {
        val fields = mutableMapOf<String, Any?>("amount" to p.amount, "date" to p.date)
        p.notes?.let { fields["notes"] = it }
        p.method?.let { fields["method"] = it.rawValue }
        return fields
    }

    @Test
    fun testAnOpenOrderItsCashAdvancesOnTheirOwnDaysItsGoldAsCashOnTheOrderDay() {
        val a = run(august, emptyList(), listOf(openOrder))
        assertEquals(50000.0, a.orderAdvances)
        assertEquals(30000.0, a.exchange)
        assertEquals(80000.0, a.total)
        assertEquals(0.0, a.exchangeOffInvoices)
        val s = run(september, emptyList(), listOf(openOrder))
        assertEquals(20000.0, s.orderAdvances)
        assertEquals(0.0, s.exchange)
        assertEquals(20000.0, s.total)
    }

    @Test
    fun testFinalisingTheOrderMovesNothingItsAdvancesAreCountedOnceOnTheInvoice() {
        // As generateInvoiceFromOrder writes it since 2026-09-25.
        val invoiceFields: Map<String, Any?> = mapOf(
            "createdAt" to "2026-09-15T09:00:00.000Z", "sourceOrderId" to "ORD-000123",
            "paymentHistory" to orderAdvancePayments(order(openOrder)).map { paymentFields(it) } + listOf(mapOf("amount" to 25000, "date" to "2026-09-15T09:00:00.000Z")),
            "exchanges" to openOrder["exchanges"], "exchangeAmount1" to 30000,
        )
        val inv = invoice(invoiceFields)
        val finalised = order(orderWith(mapOf("status" to "Completed", "invoiceId" to "INV-000900")))
        fun cashIn(period: Period): CashIn = cashInForPeriod(
            invoices = listOf(inv), orders = listOf(finalised), invoiced = invoicedOrderIds(listOf(finalised), listOf(inv)), extraRevenues = emptyList(), period = period,
            invoiceDate = { "2026-08-20T10:00:00.000Z" }, // its revenue date, the order's
        )
        val a = cashIn(august)
        assertEquals(50000.0, a.invoicePayments)
        assertEquals(0.0, a.orderAdvances)
        assertEquals(30000.0, a.exchange)
        assertEquals(80000.0, a.total)
        assertEquals(30000.0, a.exchangeOffInvoices)
        val s = cashIn(september)
        assertEquals(45000.0, s.invoicePayments)
        assertEquals(0.0, s.orderAdvances)
        assertEquals(0.0, s.exchange)
        assertEquals(45000.0, s.total)
    }

    @Test
    fun testAnOrderOnlyItsInvoicePointsToOlderDataIsNotCountedAgain() {
        val inv: Map<String, Any?> = mapOf(
            "createdAt" to "2026-08-25T09:00:00.000Z", "sourceOrderId" to "ORD-000123",
            "paymentHistory" to listOf(mapOf("amount" to 50000, "date" to "2026-08-20T10:00:00.000Z")),
        )
        val unlinked = orderWith(mapOf("advances" to emptyList<Any?>(), "advancePayment" to 50000, "status" to "Completed"))
        val r = run(august, listOf(inv), listOf(unlinked))
        assertEquals(50000.0, r.invoicePayments)
        assertEquals(0.0, r.orderAdvances)
        assertEquals(50000.0, r.total)
    }

    @Test
    fun testAnOlderInvoicesLumpedOrderAdvanceCountsWholeItsGoldUnderExchange() {
        val inv: Map<String, Any?> = mapOf(
            "createdAt" to "2026-08-25T09:00:00.000Z", "sourceOrderId" to "ORD-000050",
            "paymentHistory" to listOf(
                mapOf("amount" to 80000, "date" to "2026-08-02T10:00:00.000Z", "notes" to "Advance from Order. Cash: 50000. Exchange: 30000 (Old 22k ring)"),
                mapOf("amount" to 10000, "date" to "2026-08-25T09:00:00.000Z"),
            ),
        )
        val r = run(august, listOf(inv), emptyList())
        assertEquals(60000.0, r.invoicePayments)
        assertEquals(30000.0, r.exchange)
        assertEquals(90000.0, r.total)
        assertEquals(0.0, r.exchangeOffInvoices)
    }

    @Test
    fun testGoldTakenAtTheCounterIsCashOnTheDayOfTheSale() {
        val inv: Map<String, Any?> = mapOf(
            "createdAt" to "2026-09-12T09:00:00.000Z", "exchangeDescription" to "Old bangle", "exchangeAmount1" to 40000,
            "paymentHistory" to listOf(mapOf("amount" to 60000, "date" to "2026-09-12T09:00:00.000Z")),
        )
        val s = run(september, listOf(inv), emptyList())
        assertEquals(60000.0, s.invoicePayments)
        assertEquals(40000.0, s.exchange)
        assertEquals(100000.0, s.total)
        assertEquals(40000.0, s.exchangeOffInvoices)
        assertEquals(0.0, run(august, listOf(inv), emptyList()).total)
    }

    @Test
    fun testCancelledAndRefundedOrdersAndRefundedInvoicesBringNoCash() {
        val inv: Map<String, Any?> = mapOf(
            "status" to "Refunded", "createdAt" to "2026-09-01T00:00:00.000Z",
            "paymentHistory" to listOf(mapOf("amount" to 9000, "date" to "2026-09-02T00:00:00.000Z")),
        )
        val cancelled = orderWith(mapOf("id" to "ORD-1", "status" to "Cancelled"))
        val refunded = orderWith(mapOf("id" to "ORD-2", "status" to "Refunded"))
        assertEquals(0.0, run(september, listOf(inv), listOf(cancelled, refunded)).total)
    }

    @Test
    fun testExtraRevenueInThePeriodIsCashNoPeriodCountsEverything() {
        val extras: List<Map<String, Any?>> = listOf(mapOf("date" to "2026-09-05T00:00:00.000Z", "amount" to 4000), mapOf("date" to "2026-08-05T00:00:00.000Z", "amount" to 1000))
        val s = run(september, emptyList(), emptyList(), extras)
        assertEquals(4000.0, s.extraRevenue)
        assertEquals(4000.0, s.total)
        val all = run(Period(from = null, to = null), emptyList(), listOf(openOrder), extras)
        assertEquals(70000.0, all.orderAdvances)
        assertEquals(30000.0, all.exchange)
        assertEquals(5000.0, all.extraRevenue)
        assertEquals(105000.0, all.total)
    }

    // MARK: paymentExchangePart

    @Test
    fun testReadsTheExchangeOutOfAnOlderOrderAdvance() {
        assertEquals(30000.0, paymentExchangePart(Payment(amount = 80000.0, date = "", notes = "Advance from Order. Cash: 50000. Exchange: 30000 (Old ring)")))
    }

    @Test
    fun testKeepsItsShareWhenTheAmountWasScaledForACoinOnTheBill() {
        assertEquals(15000.0, paymentExchangePart(Payment(amount = 40000.0, date = "", notes = "Advance from Order. Cash: 50000. Exchange: 30000 ()")))
    }

    @Test
    fun testAMissingCashFigureMeansItWasAllExchange() {
        assertEquals(30000.0, paymentExchangePart(Payment(amount = 30000.0, date = "", notes = "Advance from Order. Cash: undefined. Exchange: 30000 ()")))
    }

    @Test
    fun testAnythingElseIsAllCash() {
        assertEquals(0.0, paymentExchangePart(Payment(amount = 50000.0, date = "", notes = "Advance from Order. Cash: 50000. Exchange: 0 ()")))
        assertEquals(0.0, paymentExchangePart(Payment(amount = 50000.0, date = "", notes = "Advance payment from custom order.")))
        assertEquals(0.0, paymentExchangePart(Payment(amount = 50000.0, date = "", notes = "Advance on order ORD-000123")))
        assertEquals(0.0, paymentExchangePart(Payment(amount = 50000.0, date = "")))
    }

    // Not in the TS tests: the note is read whatever its case, the share rounds to paise, and a
    // payment of nothing has no share.
    @Test
    fun testTheNoteIsReadInAnyCaseAndTheShareRoundsToPaise() {
        assertEquals(66.67, paymentExchangePart(Payment(amount = 100.0, date = "", notes = "advance from order. cash: 1. exchange: 2 (x)")))
        assertEquals(0.0, paymentExchangePart(Payment(amount = 0.0, date = "", notes = "Advance from Order. Cash: 50000. Exchange: 30000 ()")))
        assertEquals(1000.0, paymentExchangePart(Payment(amount = 1000.0, date = "", notes = "Advance from Order. Cash: 0. Exchange: 1e3 ()")))
    }

    // A bare day is Karachi's midnight in a period test, as date-fns' parseISO reads it.
    @Test
    fun testABareDayIsKarachisMidnight() {
        val inv: Map<String, Any?> = mapOf("createdAt" to "2026-09-01", "paymentHistory" to listOf(mapOf("amount" to 100, "date" to "2026-09-01")))
        // 2026-08-31T19:00:00Z is Karachi's midnight; a period starting a minute later misses it, one ending a minute earlier too.
        assertEquals(100.0, run(Period(from = at("2026-08-31T19:00:00Z"), to = at("2026-09-01T18:59:59Z")), listOf(inv), emptyList()).invoicePayments)
        assertEquals(0.0, run(Period(from = at("2026-08-31T19:01:00Z"), to = null), listOf(inv), emptyList()).invoicePayments)
    }
}
