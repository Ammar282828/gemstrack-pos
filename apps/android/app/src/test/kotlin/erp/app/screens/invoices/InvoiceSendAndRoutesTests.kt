package erp.app.screens.invoices

import erp.app.screens.invoices.Fixtures.invoice
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class InvoiceSendAndRoutesTests {
    @Test fun taheriAsksBeforeSendingThePdfFromTheShopsLine() {
        assertEquals(InvoiceSendPlan.ConfirmPdf, InvoiceSendPlan.decide(true, "+923001234567", "https://x"))
        // no number on file: the ERP's page, for one to be typed
        assertEquals(InvoiceSendPlan.OpenWeb(null), InvoiceSendPlan.decide(true, "", "https://x"))
        assertEquals(InvoiceSendPlan.OpenWeb(null), InvoiceSendPlan.decide(true, "", null))
    }

    @Test fun minaWritesTheLinkIntoWhatsAppOnThisPhoneUnlessTheInvoiceHasNoKey() {
        assertEquals(InvoiceSendPlan.LinkSheet, InvoiceSendPlan.decide(false, "", "https://x"))
        assertEquals(InvoiceSendPlan.OpenWeb("share"), InvoiceSendPlan.decide(false, "+923001234567", null))
    }

    @Test fun theConfirmationNamesWhoAndSaysWhetherItWentBefore() {
        assertEquals("Send the PDF to Sana Demo?", InvoiceSendPlan.title(invoice()))
        assertEquals("Send the PDF to the customer?", InvoiceSendPlan.title(invoice(customerName = "")))
        val sent = invoice(extra = mapOf("sentOnWhatsApp" to mapOf("at" to "2026-10-05T06:00:00.000Z", "to" to "+923001234567", "by" to "Demo")))
        assertEquals("Send the PDF to Sana Demo again?", InvoiceSendPlan.title(sent))
        assertTrue(InvoiceSendPlan.words(invoice(), "+923001234567").startsWith("To +923001234567. From the shop's own WhatsApp"))
        assertFalse(InvoiceSendPlan.words(invoice(), "+923001234567").contains("Already sent"))
        assertTrue(InvoiceSendPlan.words(sent, "+923001234567").contains("Already sent to +923001234567 · "))
    }

    @Test fun theToastSaysWhoItWentTo() {
        assertEquals(
            InvoiceNote("Sent to Sana Demo", "Invoice - Sana Demo.pdf — on WhatsApp, from the shop's number."),
            InvoiceSendPlan.sentNote(invoice(), "Invoice - Sana Demo.pdf", "+923001234567"),
        )
        // a walk-in has no name to give: the number it went to
        assertEquals("Sent to +923001234567", InvoiceSendPlan.sentNote(invoice(customerName = ""), "x.pdf", "+923001234567").title)
        assertEquals(mapOf("to" to "+923001234567"), InvoiceFacts.sendPdfFields("+923001234567"))
    }

    @Test fun anInvoiceIsAnItemRouteExceptNewWhichIsTheSaleGroups() {
        val routes = InvoicesRoutes
        fun hit(path: String) = routes.any { it.matches(path) }
        assertTrue(hit("/invoices"))
        assertTrue(hit("/invoices?x=1"))
        assertTrue(hit("/invoices/INV-000123"))
        assertTrue(hit("/invoices/INV%2F1"))
        assertFalse(hit("/invoices/new"))
        assertFalse(hit("/invoices/new?x=1"))
        // an edit or a nested page has no native screen here: it falls through to the ERP's page
        assertFalse(hit("/invoices/INV-000123/edit"))
        assertFalse(hit("/orders/ORD-1"))
    }
}
