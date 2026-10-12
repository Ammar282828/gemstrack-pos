package erp.core

import erp.core.logic.InvoiceLike
import erp.core.logic.OrderLike
import erp.core.logic.getInvoiceAdjustmentsAmount
import erp.core.logic.getInvoiceExchangeTotal
import erp.core.logic.getInvoiceExpectedGrandTotal
import erp.core.logic.isRestoredPlaceholderOrder
import erp.core.models.Invoice
import erp.core.models.Order
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * src/lib/financials.ts. It has no test of its own, so the figures below were printed by the
 * TypeScript for the made-up invoices and notes beside them, and are compared exactly.
 */
class FinancialsTests {
    private fun invoice(fields: Map<String, Any?>): Invoice = ERPDecode.model<Invoice>(fields)!!
    private fun order(fields: Map<String, Any?>): Order = ERPDecode.model<Order>(fields)!!

    // MARK: What an invoice should total

    @Test
    fun testTheLinesLessDiscountAndExchangePlusAdjustments() {
        val like = InvoiceLike(subtotal = 100000.0, discountAmount = 5000.0, exchangeAmount1 = 20000.0, exchangeAmount2 = 3000.5, adjustmentsAmount = 1500.0)
        assertEquals(73499.5, getInvoiceExpectedGrandTotal(like))
        assertEquals(23000.5, getInvoiceExchangeTotal(like))
        assertEquals(1500.0, getInvoiceAdjustmentsAmount(like))
    }

    @Test
    fun testAFigureThatIsAbsentIsNothing() {
        assertEquals(50000.0, getInvoiceExpectedGrandTotal(InvoiceLike(subtotal = 50000.0)))
        assertEquals(0.0, getInvoiceExchangeTotal(InvoiceLike(subtotal = 50000.0)))
        assertEquals(0.0, getInvoiceAdjustmentsAmount(InvoiceLike(subtotal = 50000.0)))
        assertEquals(0.0, getInvoiceExpectedGrandTotal(InvoiceLike()))
    }

    @Test
    fun testNoInvoiceIsNothing() {
        assertEquals(0.0, getInvoiceExpectedGrandTotal(null as InvoiceLike?))
        assertEquals(0.0, getInvoiceExchangeTotal(null as InvoiceLike?))
        assertEquals(0.0, getInvoiceAdjustmentsAmount(null as InvoiceLike?))
    }

    @Test
    fun testAFigureThatIsNotANumberIsNothing() {
        // Number(NaN) || 0: only the 7 of exchange is left, and it comes off.
        val like = InvoiceLike(subtotal = Double.NaN, discountAmount = Double.NaN, exchangeAmount1 = Double.NaN, exchangeAmount2 = 7.0, adjustmentsAmount = Double.NaN)
        assertEquals(-7.0, getInvoiceExpectedGrandTotal(like))
        assertEquals(7.0, getInvoiceExchangeTotal(like))
    }

    @Test
    fun testTheSumIsTakenInTheOrderTheTypeScriptTakesIt() {
        // 0.1 - 0.2 - (0.3 + 0.05) + 0.4 in doubles.
        val like = InvoiceLike(subtotal = 0.1, discountAmount = 0.2, exchangeAmount1 = 0.3, exchangeAmount2 = 0.05, adjustmentsAmount = 0.4)
        assertEquals(-0.04999999999999993, getInvoiceExpectedGrandTotal(like))
        assertEquals(0.35, getInvoiceExchangeTotal(like))
    }

    @Test
    fun testADiscountBiggerThanTheLinesGoesBelowZero() {
        assertEquals(-2000.0, getInvoiceExpectedGrandTotal(InvoiceLike(subtotal = 10000.0, discountAmount = 12000.0)))
        assertEquals(
            75965.8,
            getInvoiceExpectedGrandTotal(InvoiceLike(subtotal = 120000.55, discountAmount = 2500.25, exchangeAmount1 = 41234.5, adjustmentsAmount = -300.0)),
        )
    }

    @Test
    fun testReadsTheInvoiceModelToo() {
        val inv = invoice(mapOf("subtotal" to 100000, "discountAmount" to 5000, "exchangeAmount1" to 20000, "exchangeAmount2" to 3000.5, "adjustmentsAmount" to 1500))
        assertEquals(73499.5, getInvoiceExpectedGrandTotal(inv))
        assertEquals(23000.5, getInvoiceExchangeTotal(inv))
        assertEquals(1500.0, getInvoiceAdjustmentsAmount(inv))
        // An older invoice with no exchange or adjustments at all.
        assertEquals(50000.0, getInvoiceExpectedGrandTotal(invoice(mapOf("subtotal" to 50000))))
    }

    // MARK: Placeholder orders

    @Test
    fun testAnOrderRestoredFromTheActivityLogSaysSoInItsNotes() {
        val note = "[RESTORED FROM ACTIVITY LOG — original order was overwritten. Items unknown. Please fill in manually.]"
        assertTrue(isRestoredPlaceholderOrder(OrderLike(notes = note)))
        assertTrue(isRestoredPlaceholderOrder(order(mapOf("notes" to note))))
        assertTrue(isRestoredPlaceholderOrder(OrderLike(notes = "Call first. [RESTORED FROM ACTIVITY LOG")))
    }

    @Test
    fun testAnyOtherOrderIsNotAPlaceholder() {
        assertFalse(isRestoredPlaceholderOrder(OrderLike(notes = "restored from activity log")))
        assertFalse(isRestoredPlaceholderOrder(OrderLike(notes = "[RESTORED FROM")))
        assertFalse(isRestoredPlaceholderOrder(OrderLike(notes = "Ring for Eid")))
        assertFalse(isRestoredPlaceholderOrder(OrderLike(notes = "")))
        assertFalse(isRestoredPlaceholderOrder(OrderLike()))
        assertFalse(isRestoredPlaceholderOrder(null as OrderLike?))
        assertFalse(isRestoredPlaceholderOrder(order(emptyMap())))
    }
}
