package erp.app.screens.invoices

import erp.app.data.ErpApi
import erp.app.screens.invoices.Fixtures.invoice
import erp.core.models.Payment
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import erp.app.ui.OwnerDeletion
import erp.app.ui.DeleteCode

class InvoiceActionTests {
    private val paid = mapOf(
        "customerId" to "c1",
        "paymentHistory" to listOf(
            mapOf("amount" to 4_000.0, "date" to "2026-10-05T06:00:00.000Z", "method" to "Cash", "notes" to "Advance"),
            mapOf("amount" to 1_000.0, "date" to "2026-10-06T06:00:00.000Z", "method" to "Card", "reference" to "1234"),
        ),
    )

    @Test fun whatTheConfirmationWasWorkedOutFromTravelsWithTheWrite() {
        val inv = invoice(grandTotal = 10_000.0, amountPaid = 5_000.0)
        assertEquals(mapOf("grandTotal" to 10_000.0, "amountPaid" to 5_000.0), InvoiceActionWords.seen(inv))
        assertEquals(
            mapOf("invoiceId" to "INV-000001", "discountAmount" to 500.0, "seen" to mapOf("grandTotal" to 10_000.0, "amountPaid" to 5_000.0)),
            InvoiceActionWords.discountFields(inv, 500.0),
        )
    }

    @Test fun theBalanceIsNeverNegative() {
        assertEquals("Balance due PKR 5,000", InvoiceActionWords.balance(5_000.0))
        assertEquals("Credit to customer PKR 3,000", InvoiceActionWords.balance(-3_000.0))
        assertEquals("Paid in full", InvoiceActionWords.balance(0.2))
    }

    @Test fun theLedgerLineSaysWhatTheHisaabDoes() {
        val named = invoice(extra = mapOf("customerId" to "c1"))
        val walkIn = invoice(customerName = "")
        assertEquals("Sana Demo's hisaab shows PKR 5,000 owed on it.", InvoiceActionWords.ledger(named, 5_000.0))
        assertEquals("Its walk-in ledger row shows PKR 5,000 owed.", InvoiceActionWords.ledger(walkIn, 5_000.0))
        assertEquals("Nothing is owed on it: its ledger row for what was owed goes.", InvoiceActionWords.ledger(named, 0.0))
        assertEquals("Sana Demo's hisaab holds PKR 3,000 as credit.", InvoiceActionWords.ledger(named, -3_000.0, keepsCredit = true))
        // the discount's write does not keep the credit row
        assertEquals("Nothing is owed on it: its ledger row for what was owed goes.", InvoiceActionWords.ledger(named, -3_000.0))
        // a walk-in cannot hold credit
        assertEquals("Nothing is owed on it: its ledger row for what was owed goes.", InvoiceActionWords.ledger(walkIn, -3_000.0, keepsCredit = true))
    }

    @Test fun theDeleteCodesWordsAreTheStores() {
        assertEquals("Delete the payment of PKR 1,000 on INV-1", InvoiceActionWords.deletePaymentWhat(1_000.0, "INV-1"))
        assertEquals("Refund PKR 1,501 on INV-1", InvoiceActionWords.refundWhat(1_500.5, "INV-1"))
        assertEquals("Delete invoice INV-1", InvoiceActionWords.deleteInvoiceWhat("INV-1"))
    }

    @Test fun aPieceIsNamedWithItsStockNumberOnlyWhenItIsOne() {
        assertEquals("Ruby ring (RNG-001)", InvoiceActionWords.piece(Fixtures.item()))
        assertEquals("Custom ring", InvoiceActionWords.piece(Fixtures.item(sku = "NEW-17", name = "Custom ring")))
        assertEquals("Bill piece", InvoiceActionWords.piece(Fixtures.item(sku = "BILL-3", name = "Bill piece")))
        assertEquals("RNG-002", InvoiceActionWords.piece(Fixtures.item(sku = "RNG-002", name = " ")))
    }

    @Test fun deletingSaysWhatGoesBackInStockAndWhatStays() {
        val inv = invoice(
            id = "INV-1", extra = mapOf("sourceOrderId" to "ORD-000009", "shopifyOrderId" to "555"),
            items = listOf(
                mapOf("sku" to "RNG-001", "name" to "Ruby ring"),
                mapOf("sku" to "ORD-000009-1", "name" to "Made for the order"),
                mapOf("sku" to "RNG-002", "name" to "Pearl ring"),
            ),
        )
        val other = invoice(id = "INV-2", items = listOf(mapOf("sku" to "RNG-002", "name" to "Pearl ring")))
        val said = InvoiceActionWords.deletion(inv, listOf(inv, other), ledgerRows = 2)
        assertEquals(
            "Its 2 ledger rows on the hisaab go with it. Back in stock: Ruby ring (RNG-001). " +
                "A piece made for an order, or sold on another invoice too, stays where it is. " +
                "Order ORD-000009 stays, without this invoice: its advance counts again. Its Shopify order is cancelled too.",
            said,
        )
    }

    @Test fun theLedgerRowsAreSaidWithoutACountUntilTheHisaabIsRead() {
        val inv = invoice()
        assertTrue(InvoiceActionWords.deletion(inv, listOf(inv), null).startsWith("Its ledger rows on the hisaab go with it. Back in stock: Ruby ring (RNG-001)."))
        assertTrue(InvoiceActionWords.deletion(inv, listOf(inv), 0).startsWith("It has no ledger rows."))
        assertTrue(InvoiceActionWords.deletion(inv, listOf(inv), 1).startsWith("Its 1 ledger row on the hisaab goes with it."))
        val none = invoice(items = emptyList())
        assertTrue(InvoiceActionWords.deletion(none, listOf(none), 0).contains("No piece goes back in stock."))
        // an imported Shopify invoice is not cancelled on Shopify again
        val shopify = invoice(id = "SHOPIFY-9", extra = mapOf("shopifyOrderId" to "9"))
        assertFalse(InvoiceActionWords.deletion(shopify, listOf(shopify), 0).contains("Shopify order is cancelled"))
    }

    @Test fun deletingAPaymentSaysWhatTheInvoiceWillRead() {
        val inv = invoice(grandTotal = 10_000.0, amountPaid = 5_000.0, extra = paid + mapOf("sourceOrderId" to "ORD-000007"))
        val (deletion, outcome) = assertNotNull(InvoiceActionWords.deletingPayment(inv, 1, inv.paymentHistory[1]))
        assertEquals("Delete the payment of PKR 1,000 on INV-000001", deletion.what)
        assertTrue(deletion.final)
        assertTrue(deletion.detail.contains("PKR 1,000 of "))
        assertTrue(deletion.detail.contains("comes off INV-000001. Paid becomes PKR 4,000; Balance due PKR 6,000."))
        assertTrue(deletion.detail.contains("Sana Demo's hisaab shows PKR 6,000 owed on it."))
        assertTrue(deletion.detail.endsWith("Order ORD-000007's balance becomes PKR 6,000."))
        assertEquals("Payment deleted", outcome.note.title)
        assertEquals("PKR 1,000 taken off INV-000001. Balance due: PKR 6,000.", outcome.note.detail)
        assertFalse(outcome.removed)
        // no payment at that place any more
        assertNull(InvoiceActionWords.deletingPayment(inv, 5, inv.paymentHistory[0]))
    }

    @Test fun deletingTheLastPaymentOfASettledBillReadsPaidInFullNoAmount() {
        val inv = invoice(grandTotal = 0.0, extra = mapOf("paymentHistory" to listOf(mapOf("amount" to 0.0, "date" to "2026-10-05T06:00:00.000Z"))))
        val (_, outcome) = assertNotNull(InvoiceActionWords.deletingPayment(inv, 0, inv.paymentHistory[0]))
        assertEquals("PKR 0 taken off INV-000001. Paid in full.", outcome.note.detail)
    }

    @Test fun thePaymentWriteIsKeyedAsTheIphoneSendsIt() {
        val p = Payment(amount = 1_000.0, date = "2026-10-06T06:00:00.000Z")
        val fields = InvoiceActionWords.deletePaymentFields("INV-1", 1, p, "1234")
        assertEquals(listOf("invoiceId", "index", "amount", "paymentDate", "deleteCode"), fields.keys.toList())
        assertEquals(1, fields["index"])
        assertEquals("2026-10-06T06:00:00.000Z", fields["paymentDate"])
        assertEquals(mapOf("invoiceId" to "INV-1", "deleteCode" to "1234"), InvoiceActionWords.deleteInvoiceFields("INV-1", "1234"))
    }

    @Test fun aPartialRefundCarriesItsReasonOnlyWhenOneWasGiven() {
        val seen = mapOf("grandTotal" to 10_000.0, "amountPaid" to 5_000.0)
        val bare = InvoiceActionWords.partialRefundFields("INV-1", 1_500.0, "1234", seen, "")
        assertEquals(listOf("invoiceId", "amount", "deleteCode", "seen"), bare.keys.toList())
        val why = InvoiceActionWords.partialRefundFields("INV-1", 1_500.0, "1234", seen, "damaged")
        assertEquals("damaged", why["reason"])
        assertEquals(1_500.0, why["amount"])
    }

    @Test fun settingTheCustomerSendsTheIdAndTheNumberOnlyWhenThereAreOnes() {
        assertEquals(mapOf("invoiceId" to "INV-1", "name" to "Sana"), InvoiceActionWords.customerFields("INV-1", "Sana", null, ""))
        assertEquals(
            mapOf("invoiceId" to "INV-1", "name" to "Sana", "customerId" to "c1", "phone" to "+923001234567"),
            InvoiceActionWords.customerFields("INV-1", "Sana", "c1", "+923001234567"),
        )
    }

    @Test fun paymentDetailInTheDeleteSheet() {
        assertEquals("Cash · Advance", InvoiceActionWords.paymentDetail(Payment(1.0, "d", "Advance", erp.core.models.PaymentType.cash)))
        assertEquals("— · Payment received", InvoiceActionWords.paymentDetail(Payment(1.0, "d")))
        assertEquals("Cheque · 0042 · Payment received", InvoiceActionWords.paymentDetail(Payment(1.0, "d", null, erp.core.models.PaymentType.cheque, "0042")))
    }

    @Test fun discountBoxReadsBlankAsNoDiscount() {
        assertEquals(0.0, DiscountText.parse("  "))
        assertEquals(1_500.0, DiscountText.parse("1,500"))
        assertNull(DiscountText.parse("abc"))
        assertNull(DiscountText.parse("-5"))
    }

    @Test fun theDeleteCodeIsDigitsOnlyAndTheShopsOwnRefusalIsRecognised() {
        assertEquals("1234", DeleteCode.digits("12a3 4"))
        assertEquals("12345678", DeleteCode.digits("1234567890"))
        assertTrue(DeleteCode.isWrong(ErpApi.Failure(403, "Wrong code.")))
        assertFalse(DeleteCode.isWrong(ErpApi.Failure(403, "Owners only.")))
        assertFalse(DeleteCode.isWrong(ErpApi.Failure(400, "Wrong code.")))
        assertFalse(DeleteCode.isWrong(IllegalStateException("Wrong code.")))
        val d = OwnerDeletion("Delete invoice X", "Its rows go.", run = {})
        assertEquals("Its rows go. This can't be undone. Enter the code to go ahead.", DeleteCode.footer(d))
        assertEquals("Its rows go. Enter the code to go ahead.", DeleteCode.footer(OwnerDeletion("w", "Its rows go.", run = {}, final = false)))
    }

    @Test fun theDetailOfADeleteCountsTheInvoicesLedgerRowsOnceTheHisaabIsRead() {
        val inv = invoice(id = "INV-1")
        val rows = listOf(
            erp.core.models.HisaabEntry.fromMap(mapOf("id" to "h1", "linkedInvoiceId" to "INV-1")),
            erp.core.models.HisaabEntry.fromMap(mapOf("id" to "h2", "linkedInvoiceId" to "INV-2")),
            erp.core.models.HisaabEntry.fromMap(mapOf("id" to "h3", "linkedInvoiceId" to "INV-1")),
        )
        assertTrue(deleteDetail(inv, listOf(inv), rows).startsWith("Its 2 ledger rows"))
        assertTrue(deleteDetail(inv, listOf(inv), emptyList()).startsWith("It has no ledger rows."))
        assertTrue(deleteDetail(inv, listOf(inv), null).startsWith("Its ledger rows on the hisaab go with it."))
    }
}
