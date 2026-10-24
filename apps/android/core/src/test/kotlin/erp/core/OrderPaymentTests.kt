package erp.core

import erp.core.logic.PaymentStatus
import erp.core.logic.getOrderPaymentStatus
import erp.core.logic.orderAdvanceLines
import erp.core.logic.orderAdvancePayments
import erp.core.logic.withoutOrderAdvance
import erp.core.models.Order
import erp.core.models.Payment
import erp.core.models.PaymentType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** src/lib/order-payment.test.ts, case for case, and the payment status its comment explains. */
class OrderPaymentTests {
    private fun order(fields: Map<String, Any?>): Order = ERPDecode.model<Order>(fields)!!

    private val base: Map<String, Any?> = mapOf("id" to "ORD-000123", "createdAt" to "2026-09-01T10:00:00.000Z")
    private fun withBase(fields: Map<String, Any?>): Order = order(base + fields)

    // MARK: orderAdvancePayments

    @Test
    fun testAnAdvanceTakenWithTheOrderIsOnePaymentOnTheOrderDateAsItWasPaid() {
        assertEquals(
            listOf(Payment(amount = 50000.0, date = "2026-09-01T10:00:00.000Z", notes = "Advance on order ORD-000123", method = PaymentType.bankTransfer)),
            orderAdvancePayments(withBase(mapOf("advancePayment" to 50000, "advanceMethod" to "Bank Transfer"))),
        )
    }

    @Test
    fun testAdvancesRecordedLaterKeepTheirOwnDayMethodAndNote() {
        val later: Map<String, Any?> = mapOf("amount" to 20000, "date" to "2026-09-10T12:00:00.000Z", "method" to "Cash", "notes" to "Second advance")
        assertEquals(
            listOf(
                Payment(amount = 50000.0, date = "2026-09-01T10:00:00.000Z", notes = "Advance on order ORD-000123"),
                Payment(amount = 20000.0, date = "2026-09-10T12:00:00.000Z", notes = "Advance on order ORD-000123: Second advance", method = PaymentType.cash),
            ),
            orderAdvancePayments(withBase(mapOf("advancePayment" to 70000, "advances" to listOf(later)))),
        )
    }

    @Test
    fun testAllOfItRecordedLaterNoPaymentOnTheOrderDate() {
        val later: Map<String, Any?> = mapOf("amount" to 30000, "date" to "2026-09-10T12:00:00.000Z")
        assertEquals(1, orderAdvancePayments(withBase(mapOf("advancePayment" to 30000, "advances" to listOf(later)))).size)
    }

    @Test
    fun testATotalEditedBelowItsListIsTrustedAsOneAdvance() {
        val later: Map<String, Any?> = mapOf("amount" to 30000, "date" to "2026-09-10T12:00:00.000Z")
        assertEquals(
            listOf(Payment(amount = 10000.0, date = "2026-09-01T10:00:00.000Z", notes = "Advance on order ORD-000123")),
            orderAdvancePayments(withBase(mapOf("advancePayment" to 10000, "advances" to listOf(later)))),
        )
    }

    @Test
    fun testNoAdvanceNoPayments() {
        assertEquals(emptyList(), orderAdvancePayments(withBase(mapOf("advancePayment" to 0))))
    }

    // MARK: withoutOrderAdvance

    private val advancedOrder: Order
        get() = order(
            mapOf(
                "id" to "ORD-1", "createdAt" to "2026-09-01", "advancePayment" to 100_000, "advanceMethod" to "Cash",
                "advances" to listOf(
                    mapOf("amount" to 30_000, "date" to "2026-09-10", "method" to "Bank Transfer"),
                    mapOf("amount" to 0, "date" to "x"),
                    mapOf("amount" to 20_000, "date" to "2026-09-20"),
                ),
            ),
        )

    @Test
    fun testTheAdvanceTakenWithTheOrderGoesWithItsMethod() {
        val r = withoutOrderAdvance(advancedOrder, lineIndex = 0)
        assertEquals(50_000.0, r?.advancePayment)
        assertEquals(true, r?.dropMethod)
        assertEquals(50_000.0, r?.removed?.amount)
        assertEquals(3, r?.advances?.size)
    }

    @Test
    fun testALaterAdvanceComesOffTheListAndTheTotal() {
        val r = withoutOrderAdvance(advancedOrder, lineIndex = 2)
        assertEquals(80_000.0, r?.advancePayment)
        assertEquals(false, r?.dropMethod)
        assertEquals(20_000.0, r?.removed?.amount)
        assertEquals(listOf(30_000.0, 0.0), r?.advances?.map { it.amount })
    }

    @Test
    fun testATotalEditedBelowItsListGoesAsTheOneAdvanceItIsShownAs() {
        val edited = order(
            mapOf(
                "id" to "ORD-1", "createdAt" to "2026-09-01", "advancePayment" to 10_000, "advanceMethod" to "Cash",
                "advances" to listOf(mapOf("amount" to 30_000, "date" to "2026-09-10"), mapOf("amount" to 0, "date" to "x"), mapOf("amount" to 20_000, "date" to "2026-09-20")),
            ),
        )
        val r = withoutOrderAdvance(edited, lineIndex = 0)
        assertEquals(0.0, r?.advancePayment)
        assertEquals(emptyList(), r?.advances)
        assertEquals(true, r?.dropMethod)
    }

    @Test
    fun testNothingForALineThatIsNotThere() {
        assertNull(withoutOrderAdvance(advancedOrder, lineIndex = 9))
        assertNull(withoutOrderAdvance(advancedOrder, lineIndex = -1))
    }

    // MARK: Gold handed over with an advance (OrderPaymentTests.swift testAGoldOnlyAdvanceIsAListedLineButNeverAPayment)

    @Test
    fun testAGoldOnlyAdvanceIsAListedLineButNeverAPayment() {
        val gold: Map<String, Any?> = mapOf(
            "id" to "adv-x", "amount" to 0, "date" to "2026-09-10T12:00:00.000Z",
            "exchanges" to listOf(mapOf("description" to "Old ring", "value" to 100000)),
        )
        val o = withBase(mapOf("advancePayment" to 0, "advances" to listOf(gold)))
        assertEquals(1, orderAdvanceLines(o, label = "").size)
        assertEquals(100000.0, orderAdvanceLines(o, label = "")[0].exchanges.firstOrNull()?.value)
        assertEquals(emptyList(), orderAdvancePayments(o))
        val removed = withoutOrderAdvance(o, lineIndex = 0)
        assertEquals(0.0, removed?.advancePayment)
        assertEquals(emptyList(), removed?.advances)
    }

    @Test
    fun testACashAndGoldAdvanceIsOnePaymentOfItsCashAndTheGoldRidesOnTheLine() {
        val both: Map<String, Any?> = mapOf(
            "id" to "adv-y", "amount" to 20000, "date" to "2026-09-10T12:00:00.000Z", "method" to "Cash",
            "exchanges" to listOf(mapOf("description" to "Old chain", "value" to 50000)),
        )
        val o = withBase(mapOf("advancePayment" to 20000, "advances" to listOf(both)))
        val pay = orderAdvancePayments(o)
        assertEquals(1, pay.size)
        assertEquals(20000.0, pay[0].amount)
        assertEquals(emptyList(), pay[0].exchanges) // gold is the order's exchange row, never a payment field
        assertEquals(1, orderAdvanceLines(o)[0].exchanges.size)
        // deleting a later gold line leaves the first advance and the rest in order
        val first: Map<String, Any?> = mapOf("amount" to 5000, "date" to "2026-09-05T12:00:00.000Z")
        val two = withBase(mapOf("advancePayment" to 25000, "advances" to listOf(first, both)))
        val gone = withoutOrderAdvance(two, lineIndex = 1)
        assertEquals(5000.0, gone?.advancePayment)
        assertEquals(1, gone?.advances?.size)
    }

    // MARK: getOrderPaymentStatus (no TS test; the cases are the ones its comment names)

    @Test
    fun testPaymentStatusIsDecidedByTheBalanceAlone() {
        // 100,000 with 60,000 down is stored as a grandTotal of 40,000: Partial, never Paid.
        assertEquals(PaymentStatus.partial, getOrderPaymentStatus(order(mapOf("grandTotal" to 40_000, "advancePayment" to 60_000))))
        assertEquals(PaymentStatus.unpaid, getOrderPaymentStatus(order(mapOf("grandTotal" to 100_000, "advancePayment" to 0))))
        assertEquals(PaymentStatus.paid, getOrderPaymentStatus(order(mapOf("grandTotal" to 0, "advancePayment" to 100_000))))
        assertEquals(PaymentStatus.partial, getOrderPaymentStatus(order(mapOf("grandTotal" to 70_000, "advancePayment" to 0, "advanceInExchangeValue" to 30_000))))
        assertEquals(PaymentStatus.paid, getOrderPaymentStatus(order(emptyMap())))
    }
}
