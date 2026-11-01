package erp.core

import erp.core.logic.WhatsAppOrderChip
import erp.core.logic.WhatsAppOrderChip.Tone
import erp.core.models.Invoice
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** `whatsappOrderChip` in src/lib/shopify-whatsapp.test.ts, state for state, and `Invoice.whatsappOrder` as the ERP writes it. */
class WhatsAppOrderChipTests {
    @Test fun aChipForEachState() {
        val all = mapOf(
            "awaiting-confirmation" to ("Awaiting confirmation" to Tone.working),
            "confirmed" to ("Confirmed on WhatsApp" to Tone.settled),
            "declined" to ("Cancel requested" to Tone.late),
            "awaiting-payment" to ("Awaiting transfer" to Tone.working),
            "slip-received" to ("Screenshot sent" to Tone.owed),
            "paid" to ("Paid · thanked on WhatsApp" to Tone.settled),
            "sent" to ("Thanked on WhatsApp" to Tone.quiet),
            "failed" to ("WhatsApp did not send" to Tone.late),
            "no-whatsapp" to ("No WhatsApp" to Tone.late),
        )
        for ((state, want) in all) assertEquals(WhatsAppOrderChip.Chip(want.first, want.second), WhatsAppOrderChip.chip(state), state)
    }

    @Test fun noneWithoutAKnownState() {
        assertNull(WhatsAppOrderChip.chip(null))
        assertNull(WhatsAppOrderChip.chip(""))
        assertNull(WhatsAppOrderChip.chip("something-new"))
    }

    @Test fun theInvoiceReadsItsState() {
        val inv = Invoice.fromMap(mapOf("id" to "INV-1", "whatsappOrder" to mapOf("state" to "declined", "at" to "2026-10-30T10:00:00.000Z")))
        assertEquals("declined", inv.whatsappOrder?.state)
        assertEquals("Cancel requested", WhatsAppOrderChip.chip(inv.whatsappOrder?.state)?.label)
        assertNull(Invoice.fromMap(mapOf("id" to "INV-2")).whatsappOrder)
    }
}
