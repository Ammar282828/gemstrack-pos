package erp.core

import erp.core.logic.InvoiceActions
import erp.core.models.Invoice
import erp.core.models.Payment
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** src/lib/invoice-actions.test.ts, case for case. All figures made up. */
class InvoiceActionsTests {
    private fun F(
        subtotal: Double? = null,
        exchangeAmount1: Double? = null,
        exchangeAmount2: Double? = null,
        grandTotal: Double? = null,
        amountPaid: Double? = null,
        payments: List<Double?> = emptyList(),
    ) = InvoiceActions.Figures(subtotal, exchangeAmount1, exchangeAmount2, grandTotal, amountPaid, payments)

    private fun invoice(fields: Map<String, Any?>): Invoice = ERPDecode.model<Invoice>(fields)!!

    // MARK: Changing the discount

    @Test
    fun testRefusesWhatTheInvoicePageRefusesInItsWords() {
        assertNull(InvoiceActions.discountProblem(subtotal = 100_000.0, discount = 5_000.0))
        assertNull(InvoiceActions.discountProblem(subtotal = 100_000.0, discount = 100_000.0))
        assertNull(InvoiceActions.discountProblem(subtotal = 100_000.0, discount = 0.0))
        assertEquals("Discount cannot be negative.", InvoiceActions.discountProblem(subtotal = 100_000.0, discount = -1.0))
        assertEquals("Discount cannot exceed subtotal.", InvoiceActions.discountProblem(subtotal = 100_000.0, discount = 100_001.0))
        assertEquals("Enter the discount.", InvoiceActions.discountProblem(subtotal = 100_000.0, discount = Double.NaN))
        assertEquals("Discount cannot exceed subtotal.", InvoiceActions.discountProblem(subtotal = null, discount = 1.0))
        assertNull(InvoiceActions.discountProblem(subtotal = null, discount = 0.0))
    }

    @Test
    fun testTakesTheDiscountAndTheExchangeOffTheLinesAndOwesOnWhatWasPaid() {
        assertEquals(
            InvoiceActions.Discounted(discountAmount = 15_000.0, grandTotal = 190_000.0, balanceDue = 90_000.0),
            InvoiceActions.withDiscount(F(subtotal = 250_000.0, exchangeAmount1 = 40_000.0, exchangeAmount2 = 5_000.0, amountPaid = 100_000.0), discount = 15_000.0),
        )
    }

    @Test
    fun testABiggerDiscountThanWhatIsLeftOwingPutsTheInvoiceInCredit() {
        assertEquals(
            InvoiceActions.Discounted(discountAmount = 5_000.0, grandTotal = 45_000.0, balanceDue = -3_000.0),
            InvoiceActions.withDiscount(F(subtotal = 50_000.0, amountPaid = 48_000.0), discount = 5_000.0),
        )
    }

    @Test
    fun testAFigureMissingFromAnOldInvoiceIsNothing() {
        assertEquals(InvoiceActions.Discounted(discountAmount = 0.0, grandTotal = 0.0, balanceDue = 0.0), InvoiceActions.withDiscount(F(), discount = 0.0))
        assertEquals(
            InvoiceActions.Discounted(discountAmount = 1_000.0, grandTotal = 9_000.0, balanceDue = 9_000.0),
            InvoiceActions.withDiscount(F(subtotal = 10_000.0, exchangeAmount1 = null, amountPaid = Double.NaN), discount = 1_000.0),
        )
    }

    @Test
    fun testTheDiscountWorksInWholeRupeesTheDiscountTheTotalAndTheBalanceAreEachRounded() {
        assertEquals(
            InvoiceActions.Discounted(discountAmount = 0.0, grandTotal = 1000.0, balanceDue = 999.0),
            InvoiceActions.withDiscount(F(subtotal = 1000.1, exchangeAmount1 = 0.2, exchangeAmount2 = 0.3, amountPaid = 0.7), discount = 0.05),
        )
        // An older bill with paise: what it comes to and what is left read as whole rupees.
        assertEquals(
            InvoiceActions.Discounted(discountAmount = 2_341.0, grandTotal = 294_659.0, balanceDue = 194_659.0),
            InvoiceActions.withDiscount(F(subtotal = 297_000.4, amountPaid = 100_000.3), discount = 2_340.6),
        )
    }

    @Test
    fun testReadsTheFiguresOffTheInvoice() {
        val inv = invoice(
            mapOf(
                "id" to "INV-1", "subtotal" to 250_000, "exchangeAmount1" to 40_000, "exchangeAmount2" to 5_000, "amountPaid" to 100_000, "grandTotal" to 205_000,
                "paymentHistory" to listOf(mapOf("amount" to 100_000, "date" to "d")),
            ),
        )
        assertEquals(90_000.0, InvoiceActions.withDiscount(InvoiceActions.Figures(inv), discount = 15_000.0).balanceDue)
        assertEquals(listOf<Double?>(100_000.0), InvoiceActions.Figures(inv).payments)
    }

    // MARK: A partial refund

    @Test
    fun testIsMoneyOutOnTheHistoryWithTheReasonInItsNote() {
        assertEquals(
            Payment(amount = -1_500.0, date = "2026-10-09T10:00:00.000Z", notes = "Refund: damaged item"),
            InvoiceActions.refundEntry(amount = 1_500.0, date = "2026-10-09T10:00:00.000Z", reason = "damaged item"),
        )
        assertEquals(Payment(amount = -1_500.0, date = "d", notes = "Refund"), InvoiceActions.refundEntry(amount = -1_500.0, date = "d"))
        assertEquals(Payment(amount = -1_500.0, date = "d", notes = "Refund"), InvoiceActions.refundEntry(amount = 1_500.0, date = "d", reason = ""))
    }

    @Test
    fun testRecomputesWhatIsPaidFromTheWholeHistoryAndOwesTheRest() {
        val out = InvoiceActions.withRefund(F(grandTotal = 120_000.0, payments = listOf(50_000.0, 70_000.0)), amount = 20_000.0)
        assertEquals(100_000.0, out.amountPaid)
        assertEquals(20_000.0, out.balanceDue)
        assertEquals(listOf<Double?>(50_000.0, 70_000.0, -20_000.0), out.payments)
    }

    @Test
    fun testReadsTheHistoryNotTheStoredTotal() {
        val out = InvoiceActions.withRefund(F(grandTotal = 1_000.0, amountPaid = 999.0, payments = listOf(1_000.0)), amount = 100.0)
        assertEquals(900.0, out.amountPaid)
        assertEquals(100.0, out.balanceDue)
    }

    @Test
    fun testWithNothingPaidItGoesBelowNothingAsTheStoreRecordsIt() {
        val out = InvoiceActions.withRefund(F(grandTotal = 5_000.0), amount = 500.0)
        assertEquals(-500.0, out.amountPaid)
        assertEquals(5_500.0, out.balanceDue)
    }

    @Test
    fun testAPaymentWithNoAmountCountsAsNothing() {
        val out = InvoiceActions.withRefund(F(grandTotal = 1_000.0, payments = listOf(null, 300.0)), amount = 100.0)
        assertEquals(200.0, out.amountPaid)
        assertEquals(800.0, out.balanceDue)
    }

    @Test
    fun testTheRefundWorksInWholeRupees() {
        val out = InvoiceActions.withRefund(F(grandTotal = 1_000.0, payments = listOf(600.4, 200.2)), amount = 50.4)
        assertEquals(751.0, out.amountPaid)
        assertEquals(249.0, out.balanceDue)
    }

    // MARK: Deleting one payment

    @Test
    fun testTakesItOffAndOwesItAgain() {
        assertEquals(
            InvoiceActions.Paid(payments = listOf(258_250.0), amountPaid = 258_250.0, balanceDue = 30_000.0),
            InvoiceActions.withoutPayment(F(grandTotal = 288_250.0, payments = listOf(30_000.0, 258_250.0)), index = 0),
        )
    }

    @Test
    fun testDeletingARefundPutsTheMoneyBackAsPaid() {
        val out = InvoiceActions.withoutPayment(F(grandTotal = 10_000.0, payments = listOf(10_000.0, -2_000.0)), index = 1)
        assertEquals(10_000.0, out?.amountPaid)
        assertEquals(0.0, out?.balanceDue)
    }

    @Test
    fun testThereIsNothingToDeleteOutsideTheHistory() {
        val inv = F(grandTotal = 1_000.0, payments = listOf(500.0, 500.0))
        assertNull(InvoiceActions.withoutPayment(inv, index = 2))
        assertNull(InvoiceActions.withoutPayment(inv, index = -1))
        // The TypeScript also refuses a place that is not a whole number (0.5); an Int always is one.
        assertNull(InvoiceActions.withoutPayment(F(grandTotal = 1_000.0), index = 0))
    }

    @Test
    fun testDeletingWorksInWholeRupees() {
        val out = InvoiceActions.withoutPayment(F(grandTotal = 1_000.0, payments = listOf(100.1, 200.2, 400.4)), index = 0)
        assertEquals(601.0, out?.amountPaid)
        assertEquals(399.0, out?.balanceDue)
    }

    // MARK: The pieces a deleted invoice puts back in stock

    @Test
    fun testEachOnceNeverAnOrdersPieceNeverOneAnotherInvoiceAlsoSold() {
        val inv = invoice(
            mapOf(
                "id" to "INV-2",
                "items" to listOf(mapOf("sku" to "RNG-001"), mapOf("sku" to "ORD-000003-1"), mapOf("sku" to "NEW-ABC"), mapOf("sku" to "BNG-002"), mapOf("sku" to ""), mapOf("sku" to "RNG-001")),
            ),
        )
        val others = listOf(
            invoice(mapOf("id" to "INV-2", "items" to listOf(mapOf("sku" to "RNG-001")))), // itself: no reason to keep a piece sold
            invoice(mapOf("id" to "INV-1", "items" to mapOf("0" to mapOf("sku" to "BNG-002")))), // an old invoice keeping its lines as a map
            invoice(mapOf("id" to "INV-3", "items" to null)),
        )
        assertEquals(listOf("RNG-001", "NEW-ABC"), InvoiceActions.piecesBackInStock(inv, others = others).map { it.sku })
    }

    @Test
    fun testReadsAnInvoiceKeptAsAMapAndOneWithNoLines() {
        assertEquals(
            listOf("A-1", "B-2"),
            InvoiceActions.piecesBackInStock(invoice(mapOf("id" to "INV-4", "items" to mapOf("0" to mapOf("sku" to "A-1"), "1" to mapOf("sku" to "B-2")))), others = emptyList()).map { it.sku },
        )
        assertEquals(emptyList(), InvoiceActions.piecesBackInStock(invoice(mapOf("id" to "INV-5")), others = emptyList()))
    }
}
