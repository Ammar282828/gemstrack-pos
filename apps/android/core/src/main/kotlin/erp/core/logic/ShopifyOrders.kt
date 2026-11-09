package erp.core.logic

import erp.core.models.Invoice
import erp.core.models.Order

/**
 * The Shopify section's rules (owner, 2026-11-09): for a house with the section (House of Mina) a Shopify web order is an ERP ORDER
 * (id `SHOPIFY-<n>`, `source: "shopify"`) with the customer's WhatsApp state in `whatsappOrder` (see [WhatsAppOrderChip],
 * src/lib/shopify-whatsapp.ts). Shopify sales from before are INVOICES whose `source` starts with "shopify" (iPhone `InvoiceChip.shopify`).
 */
object ShopifyOrders {
    /** The nav entry whose presence in the map means the house has the section. */
    const val NAV_ID = "shopify"

    private const val AWAITING = "awaiting-confirmation"

    fun isShopify(inv: Invoice): Boolean = (inv.source ?: "").startsWith("shopify")

    fun isShopify(order: Order): Boolean = order.id.startsWith("SHOPIFY-") || (order.source?.rawValue ?: "").startsWith("shopify")

    /** To confirm: the confirmation message went out and the customer has not answered. */
    fun toConfirm(order: Order): Boolean = isShopify(order) && order.whatsappOrder?.state == AWAITING

    /** The Orders hub's own list: without the Shopify orders where the house has the section, only them in the section. */
    fun hubOrders(all: List<Order>, section: Boolean, shopify: Boolean): List<Order> = when {
        shopify -> all.filter(::isShopify)
        section -> all.filterNot(::isShopify)
        else -> all
    }

    /** Invoices of the Invoices list: without the Shopify ones where the house has the section. */
    fun listedInvoices(all: List<Invoice>, section: Boolean): List<Invoice> = if (section) all.filterNot(::isShopify) else all

    /** Shopify invoices from before the orders (not the ones an order was finalised into): the "Earlier (invoiced)" filter. */
    fun earlier(invoices: List<Invoice>, orders: List<Order>): List<Invoice> {
        val fromOrders = orders.mapNotNull { it.invoiceId?.takeIf { id -> id.isNotEmpty() } }.toSet()
        return invoices.filter { isShopify(it) && it.id !in fromOrders }
    }

    /**
     * An old Shopify invoice the owner may turn into an order (src/lib/writes/shopify-invoice-to-order.ts): a Shopify source, not
     * made from an order, not cancelled / refunded / void, and not fulfilled on Shopify (unfulfilled, partial or unknown).
     */
    fun eligibleForOrder(inv: Invoice): Boolean {
        if (!isShopify(inv)) return false
        if (!inv.sourceOrderId.isNullOrEmpty()) return false
        if (!inv.shopifyCancelledAt.isNullOrEmpty()) return false
        val status = inv.status?.rawValue?.lowercase().orEmpty()
        if (status == "refunded" || status == "void" || status == "voided" || status == "cancelled") return false
        if ((inv.shopifyFinancialStatus ?: "").lowercase() in setOf("refunded", "voided")) return false
        return (inv.shopifyFulfillment ?: "").lowercase() != "fulfilled"
    }

    /** The earlier invoices that can be made orders. */
    fun eligible(invoices: List<Invoice>, orders: List<Order>): List<Invoice> = earlier(invoices, orders).filter(::eligibleForOrder)

    /** What `shopifyInvoicesToOrders` answered: `{ converted: [{invoiceId, orderId}], skipped: [{invoiceId, reason}] }`. */
    data class Conversion(val converted: List<Pair<String, String>>, val skipped: List<Pair<String, String>>) {
        /** "12 made orders, 2 skipped: already an order (2)". */
        val summary: String get() {
            val made = "${converted.size} made ${if (converted.size == 1) "an order" else "orders"}"
            if (skipped.isEmpty()) return made
            val why = skipped.groupingBy { it.second.ifEmpty { "not eligible" } }.eachCount().entries.joinToString(", ") { (r, n) -> if (n == 1) r else "$r ($n)" }
            return "$made, ${skipped.size} skipped: $why"
        }

        companion object {
            private fun pairs(v: Any?, a: String, b: String): List<Pair<String, String>> =
                (v as? List<*>).orEmpty().mapNotNull { row ->
                    val m = row as? Map<*, *> ?: return@mapNotNull null
                    (m[a] as? String ?: return@mapNotNull null) to (m[b] as? String ?: "")
                }

            fun parse(out: Map<String, Any?>): Conversion = Conversion(pairs(out["converted"], "invoiceId", "orderId"), pairs(out["skipped"], "invoiceId", "reason"))
        }
    }

    /** What the section's own filter shows on top of the Orders hub's: all, the orders to confirm, or the earlier invoices. */
    enum class Filter(val title: String) { all("All"), toConfirm("To confirm"), earlier("Earlier (invoiced)") }
}
