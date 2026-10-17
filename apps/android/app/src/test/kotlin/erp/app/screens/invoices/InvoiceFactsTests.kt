package erp.app.screens.invoices

import erp.app.screens.invoices.Fixtures.customer
import erp.app.screens.invoices.Fixtures.invoice
import erp.app.ui.Tone
import java.time.Instant
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class InvoiceFactsTests {
    @Test fun aWalkInBillReadsWalkInButAPersonWithTheWordsInTheirNameKeepsIt() {
        assertEquals("Walk-in", InvoiceFacts.customerName(invoice(customerName = "")))
        assertEquals("Walk-in", InvoiceFacts.customerName(invoice(customerName = "  walk in ")))
        assertEquals("Walk-in", InvoiceFacts.customerName(invoice(customerName = "Walk-in Customer")))
        assertEquals("the customer", InvoiceFacts.customerName(invoice(customerName = "Walk-in"), walkIn = "the customer"))
        assertEquals("Walk-in Customer - 0300", InvoiceFacts.customerName(invoice(customerName = "Walk-in Customer - 0300")))
        assertEquals("Sana Demo", InvoiceFacts.customerName(invoice()))
    }

    @Test fun anIdWithASlashOrQuestionMarkDoesNotSplitTheAddress() {
        assertEquals("INV-000123", InvoiceFacts.encode("INV-000123"))
        assertEquals("a%2Fb%3Fc%23d%25e", InvoiceFacts.encode("a/b?c#d%e"))
        assertEquals("Zo%C3%AB", InvoiceFacts.encode("Zoë"))
        assertEquals("/invoices/INV-1", InvoiceFacts.path("INV-1"))
        assertEquals("/invoices/INV-1?web=1", InvoiceFacts.path("INV-1", web = true))
        assertEquals("/invoices/INV-1?web=1&do=share", InvoiceFacts.path("INV-1", web = true, doing = "share"))
        assertEquals("/invoices/INV-1/edit", InvoiceFacts.editPath("INV-1"))
    }

    @Test fun anOldDebtReadsRedAndTheRestKeepTheirTone() {
        val now = Instant.parse("2026-10-12T06:00:00Z")
        assertEquals(Tone.owed, InvoiceFacts.balanceTone(invoice(createdAt = "2026-10-01T06:00:00.000Z"), now))
        assertEquals(Tone.late, InvoiceFacts.balanceTone(invoice(createdAt = "2026-09-10T06:00:00.000Z"), now))
        // exactly thirty days is not yet old
        assertEquals(Tone.owed, InvoiceFacts.balanceTone(invoice(createdAt = "2026-09-12T06:00:00.000Z"), now))
        assertEquals(Tone.settled, InvoiceFacts.balanceTone(invoice(amountPaid = 100_000.0), now))
        assertEquals(Tone.credit, InvoiceFacts.balanceTone(invoice(amountPaid = 120_000.0), now))
        assertEquals(Tone.quiet, InvoiceFacts.balanceTone(invoice(extra = mapOf("status" to "Refunded")), now))
        // no readable date: owed, never a guess at late
        assertEquals(Tone.owed, InvoiceFacts.balanceTone(invoice(createdAt = "nonsense"), now))
    }

    @Test fun whatWasSoldIsTheFirstPieceAndHowManyMore() {
        assertEquals("Ruby ring", InvoiceFacts.whatSold(invoice()))
        val two = invoice(items = listOf(mapOf("name" to "Ruby ring"), mapOf("name" to "Pearl set"), mapOf("name" to "Gold chain")))
        assertEquals("Ruby ring +2 more", InvoiceFacts.whatSold(two))
        // no name: its category in words, else the id it carries, else "1 piece"
        assertEquals("Ring", InvoiceFacts.whatSold(invoice(items = listOf(mapOf("name" to " ", "itemCategory" to "cat001")))))
        assertEquals("custom-cat", InvoiceFacts.whatSold(invoice(items = listOf(mapOf("name" to "", "itemCategory" to "custom-cat")))))
        assertEquals("SKU-9", InvoiceFacts.whatSold(invoice(items = listOf(mapOf("name" to "", "sku" to "SKU-9")))))
        assertEquals("1 piece", InvoiceFacts.whatSold(invoice(items = listOf(mapOf("name" to "", "sku" to "")))))
        assertNull(InvoiceFacts.whatSold(invoice(items = emptyList())))
    }

    @Test fun theClockIsKarachisInLowerCase() {
        assertEquals("11:05 am", InvoiceFacts.time("2026-10-12T06:05:00.000Z"))
        assertEquals("5:30 pm", InvoiceFacts.time("2026-10-12T12:30:00.000Z"))
        assertEquals("", InvoiceFacts.time("nope"))
    }

    @Test fun onlyOwnersAndStaffTakePayments() {
        assertTrue(InvoiceFacts.mayTakePayments("owner"))
        assertTrue(InvoiceFacts.mayTakePayments("staff"))
        assertFalse(InvoiceFacts.mayTakePayments("marketing"))
        assertFalse(InvoiceFacts.mayTakePayments("karigar"))
        // a walk-in's paid-up bill cannot take credit; a named customer's can
        val named = invoice(amountPaid = 100_000.0, extra = mapOf("customerId" to "c1"))
        assertTrue(InvoiceFacts.mayTakePayment("staff", named, owing = false))
        assertFalse(InvoiceFacts.mayTakePayment("staff", invoice(amountPaid = 100_000.0), owing = false))
        assertTrue(InvoiceFacts.mayTakePayment("staff", invoice(), owing = true))
        assertFalse(InvoiceFacts.mayTakePayment("marketing", invoice(), owing = true))
    }

    @Test fun moneyOverTheBalanceNeedsANamedCustomer() {
        val walkIn = invoice(grandTotal = 10_000.0, amountPaid = 4_000.0)
        assertNull(InvoiceFacts.paymentRefusal(walkIn, 6_000.0))
        // under half a rupee over is rounding, not credit; a half rounds up to a whole rupee over (record-payment-dialog.tsx)
        assertNull(InvoiceFacts.paymentRefusal(walkIn, 6_000.4))
        assertEquals(
            "More than the balance of PKR 6,000. Credit needs a customer: name who this invoice is for first.",
            InvoiceFacts.paymentRefusal(walkIn, 6_000.5),
        )
        assertEquals(
            "More than the balance of PKR 6,000. Credit needs a customer: name who this invoice is for first.",
            InvoiceFacts.paymentRefusal(walkIn, 6_001.0),
        )
        val named = invoice(grandTotal = 10_000.0, amountPaid = 4_000.0, extra = mapOf("customerId" to "c1"))
        assertNull(InvoiceFacts.paymentRefusal(named, 9_000.0))
    }

    @Test fun thePaymentWriteCarriesTheReferenceOnlyForNonCash() {
        val inv = invoice(id = "INV-000042")
        assertEquals(mapOf("invoiceId" to "INV-000042", "amount" to 500.0, "method" to "Cash"), InvoiceFacts.paymentFields(inv, 500.0, "Cash", "ignored"))
        assertEquals(
            mapOf("invoiceId" to "INV-000042", "amount" to 500.5, "method" to "Cheque", "reference" to "0042"),
            InvoiceFacts.paymentFields(inv, 500.5, "Cheque", "  0042 "),
        )
        assertEquals(mapOf("invoiceId" to "INV-000042", "amount" to 500.0, "method" to "Card"), InvoiceFacts.paymentFields(inv, 500.0, "Card", "   "))
    }

    @Test fun theCustomersLinkNeedsTheInvoicesKey() {
        val inv = invoice(id = "INV 1/2", extra = mapOf("shareToken" to "k&y=1"))
        assertEquals("https://erp.example/view-invoice/INV%201%2F2?t=k%26y%3D1", InvoiceFacts.shareUrl(inv, "https://erp.example/"))
        assertNull(InvoiceFacts.shareUrl(invoice(), "https://erp.example"))
        assertNull(InvoiceFacts.shareUrl(invoice(extra = mapOf("shareToken" to "")), "https://erp.example"))
    }

    @Test fun theSubjectIsTheCustomerWhereInvoicesAreNamedAfterThem() {
        assertEquals("Invoice - Fatima Hussain", InvoiceFacts.shareTitle(invoice(customerName = "Fatima  Hussain"), byCustomer = true))
        // characters a file name cannot hold become spaces
        assertEquals("Invoice - A B", InvoiceFacts.shareTitle(invoice(customerName = "A/B"), byCustomer = true))
        assertEquals("Invoice - 12 Oct 2026", InvoiceFacts.shareTitle(invoice(customerName = "Walk-in"), byCustomer = true))
        assertEquals("Invoice-INV-000001", InvoiceFacts.shareTitle(invoice(), byCustomer = false))
    }

    @Test fun thePdfIsNamedAsTheBrowserSavesIt() {
        val two = invoice(items = listOf(mapOf("name" to "A"), mapOf("name" to "B")))
        assertEquals("/api/app/pdf/invoice/INV-000001", InvoiceFacts.pdfPath("INV-000001"))
        assertEquals("/api/app/pdf/invoice/INV-000001?perPiece=1", InvoiceFacts.pdfPath("INV-000001", perPiece = true))
        assertEquals("Invoice - Sana Demo.pdf", InvoiceFacts.pdfFileName(two, byCustomer = true))
        assertEquals("Invoice - Sana Demo (per piece).pdf", InvoiceFacts.pdfFileName(two, byCustomer = true, perPiece = true))
        assertEquals("Invoice-INV-000001-per-piece.pdf", InvoiceFacts.pdfFileName(two, byCustomer = false, perPiece = true))
        // per piece names only a bill of more than one piece
        assertEquals("Invoice-INV-000001.pdf", InvoiceFacts.pdfFileName(invoice(), byCustomer = false, perPiece = true))
        val target = InvoiceFacts.pdfTarget(two, byCustomer = false, perPiece = true)
        assertEquals("INV-000001 per piece", target.title)
        assertEquals("/api/app/pdf/invoice/INV-000001?perPiece=1", target.path)
    }

    @Test fun theMessageThatGoesWithTheLink() {
        val owing = invoice(grandTotal = 12_345.0, amountPaid = 2_000.0)
        assertEquals(
            "Dear Sana Demo,\n\nYour invoice from TAHERI is at the link below.\n\n*Total:* PKR 12,345\n*Paid:* PKR 2,000\n*Balance due:* PKR 10,345\n\nThank you for your business.",
            InvoiceFacts.shareMessage(owing, "TAHERI", byCustomer = true),
        )
        val untouched = invoice(customerName = "")
        assertEquals(
            "Dear Customer,\n\nYour invoice from TAHERI is at the link below.\n\n*Total:* PKR 100,000\n\nThank you for your business.",
            InvoiceFacts.shareMessage(untouched, "TAHERI", byCustomer = true),
        )
        val credit = invoice(grandTotal = 1_000.0, amountPaid = 1_500.0)
        assertTrue(InvoiceFacts.shareMessage(credit, "TAHERI", byCustomer = true).contains("*Credit to you:* PKR 500"))
    }

    @Test fun minasEstimateMessageIsTheCountersOwn() {
        assertEquals(
            "Dear Sana Demo,\n\nHere is your estimate from MINA.\n\n*Estimate ID:* INV-000001\n*Total Amount:* PKR 12,345\n*Amount Paid:* PKR 2,000\n*Balance Due:* PKR 10,345\n\nThank you for your business.",
            InvoiceFacts.shareMessage(invoice(grandTotal = 12_345.0, amountPaid = 2_000.0), "MINA", byCustomer = false),
        )
        assertEquals(
            "Dear Walk-in Customer,\n\nHere is your estimate from MINA.\n\n*Estimate ID:* INV-000001\n*Total Amount:* PKR 1,235\n*Amount Due:* PKR 1,235\n\nThank you for your business.",
            InvoiceFacts.shareMessage(invoice(customerName = "Walk-in Customer", grandTotal = 1_234.5), "MINA", byCustomer = false),
        )
        assertEquals("1,235", InvoiceFacts.rupees(1234.5))
        assertEquals("0", InvoiceFacts.rupees(0.0))
        assertEquals("1", InvoiceFacts.rupees(1.2351))
    }

    @Test fun whatGoesOnWhatsAppIsTheWordsThenTheLink() {
        val inv = invoice()
        assertTrue(InvoiceFacts.whatsAppText(inv, "https://x/y", "TAHERI", byCustomer = true).endsWith("Thank you for your business.\n\nhttps://x/y"))
        assertTrue(InvoiceFacts.whatsAppText(inv, "https://x/y", "MINA", byCustomer = false).endsWith("\n\nView estimate: https://x/y"))
        assertEquals("https://wa.me/923001234567?text=Hi%20there%0A*Bold*", InvoiceFacts.whatsAppUrl("0300 1234567", "Hi there\n*Bold*"))
        assertNull(InvoiceFacts.whatsAppUrl("", "x"))
    }

    @Test fun theNumberTheWhatsAppBoxStartsWith() {
        val withOwn = invoice(extra = mapOf("customerContact" to "0301 7654321"))
        assertEquals("+923017654321", InvoiceFacts.whatsAppPhone(withOwn, customer()))
        assertEquals("+923001234567", InvoiceFacts.whatsAppPhone(invoice(), customer()))
        assertEquals("", InvoiceFacts.whatsAppPhone(invoice(), null))
        assertEquals("+923001234567", InvoiceFacts.dialable("+92 300-1234567"))
        assertEquals("03001234567", InvoiceFacts.dialable("0300 1234567"))
    }

    @Test fun aPaymentTakenSaysWhatIsLeft() {
        val inv = invoice(grandTotal = 10_000.0)
        assertEquals("PKR 4,000 still due", InvoiceFacts.recordedDetail(inv, 6_000.0))
        assertEquals("Paid in full", InvoiceFacts.recordedDetail(inv, 10_000.0))
        assertEquals("Paid in full, PKR 500 in credit", InvoiceFacts.recordedDetail(inv, 10_500.0))
    }

    @Test fun theRowsReferenceAndPiecesLine() {
        assertEquals("1 piece", InvoiceFacts.piecesLine(invoice()))
        assertEquals("1 piece · Taken by Demo", InvoiceFacts.piecesLine(invoice(extra = mapOf("takenBy" to "Demo"))))
        assertEquals("2 pieces", InvoiceFacts.piecesLine(invoice(items = listOf(mapOf("name" to "A"), mapOf("name" to "B")))))
        assertTrue(InvoiceFacts.isShopify(invoice(extra = mapOf("source" to "shopify_import"))))
        assertFalse(InvoiceFacts.isShopify(invoice()))
        assertTrue(InvoiceFacts.unnamed(invoice(customerName = " ")))
        assertFalse(InvoiceFacts.unnamed(invoice()))
    }
}
