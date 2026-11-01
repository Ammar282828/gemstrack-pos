package erp.core.logic

/**
 * `whatsappOrderChip` in src/lib/shopify-whatsapp.ts: the words and tone of the chip that says where an order's WhatsApp stands
 * (`Invoice.whatsappOrder.state`). A state the ERP does not know says nothing.
 */
object WhatsAppOrderChip {
    enum class Tone { late, owed, settled, working, quiet }

    data class Chip(val label: String, val tone: Tone)

    fun chip(state: String?): Chip? = when (state) {
        "awaiting-confirmation" -> Chip("Awaiting confirmation", Tone.working)
        "confirmed" -> Chip("Confirmed on WhatsApp", Tone.settled)
        "declined" -> Chip("Cancel requested", Tone.late)
        "awaiting-payment" -> Chip("Awaiting transfer", Tone.working)
        "slip-received" -> Chip("Screenshot sent", Tone.owed)
        "paid" -> Chip("Paid · thanked on WhatsApp", Tone.settled)
        "sent" -> Chip("Thanked on WhatsApp", Tone.quiet)
        "failed" -> Chip("WhatsApp did not send", Tone.late)
        "no-whatsapp" -> Chip("No WhatsApp", Tone.late)
        else -> null
    }
}
