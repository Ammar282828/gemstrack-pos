package erp.app.ui

import erp.app.ui.ContactMenuPlan.Kind
import org.junit.Test
import kotlin.test.assertEquals

/** The Contact menu's order and words (docs/decisions.md "Customer contact"), the same on every surface. */
class CustomerContactTests {
    private fun kinds(number: String, walkIn: Boolean = false, id: String? = "C1", noun: String? = null) =
        ContactMenuPlan.items(number, walkIn, id, noun).map { it.kind }

    @Test fun orderIsCallWhatsAppMessageThenPdfThenCopy() {
        assertEquals(
            listOf(Kind.Call, Kind.WhatsApp, Kind.Message, Kind.SendPdf, Kind.SharePdf, Kind.CopyNumber),
            kinds("+923001234567", noun = "invoice"),
        )
        assertEquals(listOf("Call", "WhatsApp", "Message", "Copy number"), ContactMenuPlan.items("+923001234567", false, "C1", null).map { it.label })
    }

    @Test fun documentWordsNameTheDocument() {
        val labels = ContactMenuPlan.items("+923001234567", false, "C1", "order").map { it.label }
        assertEquals(listOf("Send order PDF on WhatsApp", "Share PDF…"), labels.filter { "PDF" in it })
    }

    @Test fun noNumberOffersAddPhoneForACustomerOnFile() {
        assertEquals(listOf(Kind.AddPhone), kinds("", id = "C1"))
        assertEquals(listOf(Kind.AddPhone, Kind.SendPdf, Kind.SharePdf), kinds("", id = "C1", noun = "invoice"))
    }

    @Test fun aWalkInHasOnlyTheDocumentsActions() {
        assertEquals(emptyList(), kinds("", walkIn = true, id = null))
        assertEquals(listOf(Kind.SendPdf, Kind.SharePdf), kinds("", walkIn = true, id = null, noun = "invoice"))
    }

    @Test fun oneNumberForAll() {
        assertEquals("+923001234567", CustomerContactLinks.e164("0300 1234567"))
        assertEquals("tel:+923001234567", CustomerContactLinks.tel("0300 1234567"))
        assertEquals("smsto:+923001234567", CustomerContactLinks.sms("0300 1234567"))
        assertEquals("https://wa.me/923001234567", CustomerContactLinks.whatsApp("0300 1234567"))
        assertEquals("https://wa.me/923001234567?text=Hi%20there", CustomerContactLinks.whatsApp("0300 1234567", "Hi there"))
        assertEquals(null, CustomerContactLinks.tel("abc"))
    }
}
