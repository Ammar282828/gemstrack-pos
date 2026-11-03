package erp.app.data

/**
 * What a change waiting in the Outbox is, in the words a list reads: "Order for Ali", "Sale to Sara", "Payment on
 * INV-000123". Kept on disk beside the change, so a row "Waiting to send" survives the app being killed.
 * `kind` is "order" or "invoice" for a new record (shown at the top of Orders / Invoices as a pending row), and
 * "payment", "advance", "send" or "change" for the rest (shown in Waiting to send only). (PendingSummary.swift.)
 */
data class PendingSummary(
    val kind: String,
    /** Who it is for ("Ali", "Walk-in") or, for a change, what it does. */
    val title: String,
    val detail: String = "",
    /** The record's total, or the payment's amount. */
    val amount: Double? = null,
    /** The invoice or order a payment is on. */
    val target: String? = null,
) {
    /** The one line the failure banner and the queue say ("Not saved: Order for Ali"). */
    val label: String
        get() = when (kind) {
            "order" -> "Order for $title"
            "invoice" -> "Sale to $title"
            "payment" -> "Payment on ${target ?: title}"
            "advance" -> "Advance on ${target ?: title}"
            else -> title
        }

    fun toMap(): Map<String, Any?> {
        val o = LinkedHashMap<String, Any?>()
        o["kind"] = kind
        o["title"] = title
        o["detail"] = detail
        amount?.let { o["amount"] = it }
        target?.let { o["target"] = it }
        return o
    }

    companion object {
        fun fromMap(m: Map<*, *>): PendingSummary? {
            val kind = m["kind"] as? String ?: return null
            return PendingSummary(
                kind = kind,
                title = m["title"] as? String ?: "",
                detail = m["detail"] as? String ?: "",
                amount = (m["amount"] as? Number)?.toDouble(),
                target = m["target"] as? String,
            )
        }

        private fun text(v: Any?): String = ((v as? String) ?: "").trim()
        private fun number(v: Any?): Double? = (v as? Number)?.toDouble()
        private fun pieces(n: Int): String = if (n == 1) "1 piece" else "$n pieces"

        /** A summary made from the request itself, for a write whose screen did not say what it is. */
        fun make(op: String, fields: Map<String, Any?>): PendingSummary = when (op) {
            "createOrder" -> {
                val o = fields["order"] as? Map<*, *> ?: emptyMap<String, Any?>()
                val name = text(o["customerName"])
                PendingSummary("order", name.ifEmpty { "Walk-in" }, pieces((o["items"] as? List<*>)?.size ?: 0), number(o["subtotal"]))
            }
            "createInvoice" -> {
                val existing = text(fields["existingInvoiceId"])
                if (existing.isNotEmpty()) {
                    PendingSummary("change", "Changes to $existing")
                } else {
                    val name = text((fields["customer"] as? Map<*, *>)?.get("name"))
                    PendingSummary("invoice", name.ifEmpty { "Walk-in" }, pieces((fields["cart"] as? List<*>)?.size ?: 0))
                }
            }
            "recordPayment" -> {
                val id = text(fields["invoiceId"])
                PendingSummary("payment", id, text(fields["method"]), number(fields["amount"]), id)
            }
            "recordOrderAdvance" -> {
                val id = text(fields["orderId"])
                PendingSummary("advance", id, text(fields["method"]), number(fields["amount"]), id)
            }
            "updateOrder" -> PendingSummary("change", "Changes to order ${text(fields["orderId"])}")
            else -> PendingSummary("change", words(op))
        }

        /** "addExtraRevenue" -> "Add extra revenue". */
        fun words(op: String): String {
            val out = StringBuilder()
            for (ch in op) {
                if (ch.isUpperCase() && out.isNotEmpty()) out.append(' ')
                out.append(ch.lowercaseChar())
            }
            return out.toString().replaceFirstChar { it.uppercaseChar() }
        }
    }
}
