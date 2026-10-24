package erp.app.screens.invoices

import erp.app.screens.invoices.Fixtures.invoice
import erp.core.models.Payment
import erp.core.models.PaymentType
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Give back a customer's credit (InvoiceActionCreditSheet.swift's rules): made-up names and amounts only.
class InvoiceCreditTests {
    private val over = invoice(grandTotal = 100_000.0, amountPaid = 130_000.0, extra = mapOf("customerId" to "c1"))

    @Test fun anInvoicePaidPastItsTotalHoldsTheCreditForANamedCustomer() {
        assertEquals(30_000.0, InvoiceCredit.held(over))
        assertTrue(InvoiceCredit.canGiveBack(over))
    }

    @Test fun aWalkInARefundedInvoiceOrAnOwingOneHoldsNone() {
        assertEquals(0.0, InvoiceCredit.held(invoice(grandTotal = 100_000.0, amountPaid = 130_000.0, extra = mapOf("customerId" to "walk-in"))))
        assertEquals(0.0, InvoiceCredit.held(invoice(grandTotal = 100_000.0, amountPaid = 130_000.0)))
        assertEquals(0.0, InvoiceCredit.held(invoice(grandTotal = 100_000.0, amountPaid = 130_000.0, extra = mapOf("customerId" to "c1", "status" to "Refunded"))))
        assertEquals(0.0, InvoiceCredit.held(invoice(grandTotal = 100_000.0, amountPaid = 50_000.0, extra = mapOf("customerId" to "c1"))))
        assertFalse(InvoiceCredit.canGiveBack(invoice(grandTotal = 100_000.0, amountPaid = 100_000.5, extra = mapOf("customerId" to "c1"))))
    }

    @Test fun theAmountIsAtLeastARupeeAndNoMoreThanIsHeld() {
        assertTrue(InvoiceCredit.valid(30_000.0, 30_000.0))
        assertTrue(InvoiceCredit.valid(1.0, 30_000.0))
        assertFalse(InvoiceCredit.valid(0.0, 30_000.0))
        assertFalse(InvoiceCredit.valid(30_001.0, 30_000.0))
    }

    @Test fun theFooterSaysWhatStaysOrThatTheCreditIsFinished() {
        assertEquals("Only PKR 30,000 is held.", InvoiceCredit.footer(31_000.0, 30_000.0))
        assertEquals("PKR 10,000 stays as credit on the hisaab.", InvoiceCredit.footer(20_000.0, 30_000.0))
        assertEquals(
            "No credit is left, and its row on the hisaab goes. The sale is not refunded; it shows as money out in Today's cash.",
            InvoiceCredit.footer(30_000.0, 30_000.0),
        )
        assertNull(InvoiceCredit.footer(0.0, 30_000.0))
    }

    @Test fun theWriteIsTheIPhonesPayloadKeyForKey() {
        assertEquals(
            mapOf(
                "invoiceId" to "INV-000001", "amount" to 20_000.0, "method" to "Bank Transfer",
                "seen" to mapOf("grandTotal" to 100_000.0, "amountPaid" to 130_000.0),
            ),
            InvoiceCredit.fields(over, 20_000.0, "Bank Transfer"),
        )
        // never more than is held, whatever was typed
        assertEquals(30_000.0, InvoiceCredit.fields(over, 30_000.4, "Cash")["amount"])
    }

    @Test fun theNoteSaysWhatWasGivenAndWhatIsLeft() {
        assertEquals(InvoiceNote("Credit given back", "PKR 20,000 by Cash. PKR 10,000 credit left."), InvoiceCredit.note(20_000.0, 30_000.0, "Cash"))
        assertEquals(InvoiceNote("Credit given back", "PKR 30,000 by Cash. No credit left."), InvoiceCredit.note(30_000.0, 30_000.0, "Cash"))
    }

    @Test fun theButtonAndRowNameTheAmount() {
        assertEquals("Give back PKR 30,000", InvoiceCredit.buttonWords(over))
        assertEquals("Give back PKR 30,000 on INV-000001", InvoiceCredit.rowWords(over))
    }

    @Test fun aGiveBackReadsAsCreditPaidBackNotARefund() {
        val back = Payment(amount = -20_000.0, date = "2026-10-12T06:00:00.000Z", notes = "Credit paid back", method = PaymentType.bankTransfer)
        val refund = Payment(amount = -1_000.0, date = "2026-10-12T06:00:00.000Z", notes = "Refund: damaged")
        assertEquals("Credit paid back", InvoiceWords.paymentTitle(back))
        assertEquals("Refund", InvoiceWords.paymentTitle(refund))
        assertTrue(InvoiceWords.paymentDetail(back).endsWith("Bank Transfer"))
        assertFalse(InvoiceWords.paymentDetail(back).contains("Credit paid back"))
        assertTrue(InvoiceWords.paymentDetail(refund).endsWith("damaged"))
    }
}
