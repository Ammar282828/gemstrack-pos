package erp.app.screens.orders

import erp.core.models.LeopardsMeta
import erp.core.models.Order
import erp.core.models.OrderStatus
import erp.core.models.WebsitePaymentStatus
import java.math.BigDecimal
import java.math.RoundingMode
import java.net.URLEncoder
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

/**
 * The order page's own moves (src/app/orders/[id]/page.tsx): which an order offers, the words each one says
 * before and after, and the answers of the routes they call (OrderActionsLogic.swift). Plain Kotlin, so it is
 * read here once and the sheets only draw it.
 *
 * The writes are the ERP's: Undo invoice, Refund order and Delete order run lib/writes/order-undo.ts through
 * /api/app/write (ops-orders.ts); Book courier, Track and the online order's Leopards moves call the routes the
 * page calls; Send to customer writes lib/order-message.ts's words into WhatsApp on this phone.
 */
object OrderActions {
    // MARK: Which moves an order offers

    fun hasInvoice(o: Order): Boolean = !o.invoiceId.isNullOrEmpty()

    fun isClosed(o: Order): Boolean = o.status == OrderStatus.cancelled || o.status == OrderStatus.refunded

    /** Cancel invoice and Unlock & edit (the invoiced banner): an invoiced order. An owner's, as every write the store makes to Firestore itself (the shop floor's would be refused). */
    fun canUndoInvoice(o: Order, isOwner: Boolean): Boolean = isOwner && hasInvoice(o)

    /** Refund order (⋯ menu): not once the order is cancelled or refunded. */
    fun canRefund(o: Order, isOwner: Boolean): Boolean = isOwner && !isClosed(o)

    /** Delete order (⋯ menu): an owner's; an invoiced order says why not instead (`deleteBlocked`). */
    fun canDelete(o: Order, isOwner: Boolean): Boolean = isOwner && !hasInvoice(o)

    /** The menu's disabled line on an invoiced order, in the page's words. */
    fun deleteBlocked(o: Order): String? = if (hasInvoice(o)) "Delete order: delete or undo ${o.invoiceId ?: ""} first" else null

    /** The TCS consignment on the order, when it has one (Track replaces Book courier then). */
    fun tcsConsignment(o: Order): String? {
        val cn = (o.tcsConsignmentNo ?: "").trim()
        return cn.ifEmpty { null }
    }

    /**
     * Book courier, where the page offers it: the header's button on an order neither invoiced nor being made
     * (it shows Finalize & invoice then), and the ⋯ menu's on an invoiced or completed order not yet given a TCS
     * number. Owners only: both Shopify routes it calls are (shopify/push/from-order, shopify/fulfill).
     */
    fun canBookCourier(o: Order, isOwner: Boolean): Boolean {
        if (!isOwner) return false
        val header = !hasInvoice(o) && o.status != OrderStatus.completed && o.status != OrderStatus.inProgress
        val menu = tcsConsignment(o) == null && (hasInvoice(o) || o.status == OrderStatus.completed)
        return header || menu
    }

    /** Online orders only (website-order-panel.tsx): booked once the transfer is in, followed once booked. */
    fun isOnline(o: Order): Boolean = o.source == erp.core.models.CustomerSource.website && o.website != null

    fun leopards(o: Order): LeopardsMeta? = o.leopards?.takeIf { it.cn.isNotEmpty() }

    /** Book with Leopards, or a CN booked at the counter: paid and not yet shipped. */
    fun canShipLeopards(o: Order): Boolean =
        isOnline(o) && o.website?.paymentStatus == WebsitePaymentStatus.transferReceived && leopards(o) == null

    /** Refresh the tracking and Mark delivered: shipped, not yet delivered. */
    fun canFollowLeopards(o: Order): Boolean {
        if (!isOnline(o)) return false
        val l = leopards(o) ?: return false
        return (l.deliveredAt ?: "").isEmpty()
    }

    /** The page's box takes a CN of six characters or more. */
    fun cnLooksRight(cn: String): Boolean = cn.trim().length >= 6

    // MARK: The undoing moves' words (the page's confirmations, the store's delete-code words, its toasts)

    /** The store's words for the delete code (lib/writes/order-undo.ts undoWhat, refundWhat, deleteWhat). */
    fun undoWhat(o: Order): String = "Undo invoice ${o.invoiceId ?: ""} back to order ${o.id}"
    fun refundWhat(o: Order): String = "Refund order ${o.id}"
    fun deleteWhat(o: Order): String = "Delete order ${o.id}"

    /** Cancel invoice's confirmation. "This can't be undone" is the code sheet's own last line. */
    fun undoDetail(o: Order): String =
        "This will permanently cancel invoice ${o.invoiceId ?: ""} and revert this order back to “In Progress” so it can be edited and re-finalized. Any hisaab entries linked to the invoice will also be removed."

    /** Unlock & edit's confirmation. */
    fun unlockDetail(o: Order): String =
        "This will revert invoice ${o.invoiceId ?: ""}, removing it and its ledger entries. Revenue calculations will be updated. You can re-finalize a new invoice after editing."

    /** Refund order's confirmation: what goes with the invoice, or that the order stays on file. */
    fun refundDetail(o: Order): String =
        "This will mark order ${o.id} as Refunded." +
            if (hasInvoice(o)) " Invoice ${o.invoiceId ?: ""} will be permanently deleted, all hisaab entries removed, and items returned to stock."
            else " The order record will be kept but removed from revenue calculations."

    /** Delete order asks only the code on the page; the photos going with it is said here. */
    @Suppress("UNUSED_PARAMETER")
    fun deleteDetail(o: Order): String = "Its sample photos go with it."

    /** What the page's toast says once each has gone through. */
    @Suppress("UNUSED_PARAMETER")
    fun undoneNote(o: Order, invoiceId: String): Pair<String, String> =
        "Order Reverted" to "Invoice $invoiceId has been cancelled and order is now editable."

    fun unlockedNote(invoiceId: String): Pair<String, String> =
        "Invoice Cancelled" to "Invoice $invoiceId removed. You can now edit the order."

    fun refundedNote(o: Order): Pair<String, String> =
        "Order Refunded" to "Order ${o.id} has been marked as refunded and stock restored."

    fun deletedNote(o: Order): String = "Order ${o.id} deleted"

    // MARK: Send to customer (lib/order-message.ts, line for line)

    enum class MessageKind { inProgress, completed, summary }

    fun customerMessage(o: Order, kind: MessageKind, shopName: String): String {
        val name = if ((o.customerName ?: "").isEmpty()) "Customer" else o.customerName ?: ""
        val message = StringBuilder("Dear $name,\n\n")
        if (kind == MessageKind.summary) {
            message.append("Here is a summary of your custom order *#${o.id}* from $shopName.\n\n")
            for ((index, item) in o.items.withIndex()) {
                message.append("*Item ${index + 1}:* ${item.description}\n")
                if (!item.isManualPrice) {
                    val karat = item.karat?.rawValue ?: ""
                    message.append("  - Est. Weight: ${jsNumber(item.estimatedWeightG)}g ${if (karat.isEmpty()) "" else "($karat)"}\n")
                }
            }
            message.append("\n*Total Balance Due:* PKR ${amount(o.grandTotal)}\n\n")
            message.append("We are working on your order and will notify you of any updates.\n\n")
        } else {
            message.append("This is an update regarding your order *#${o.id}* from $shopName.\n\n")
            if (kind == MessageKind.inProgress) {
                message.append("We are happy to inform you that your order is now *In Progress*. We will notify you again once it is ready for collection.\n\n")
            } else {
                message.append("Your custom order is now *Completed* and ready for collection.\n\n")
                message.append("*Amount Due:* PKR ${amount(o.grandTotal)}\n\n")
            }
        }
        message.append("Thank you for your business.")
        return message.toString()
    }

    /** A number as JavaScript writes it into text: 3 not 3.0, 4.25 as it is. */
    fun jsNumber(x: Double): String =
        if (x.isFinite() && x == Math.rint(x) && Math.abs(x) < 1e15) x.toLong().toString() else x.toString()

    /** "45,500.00": `toLocaleString('en-US', { minimumFractionDigits: 2 })` (three decimals at most, as there). */
    fun amount(n: Double): String {
        val v = if (n.isFinite()) n else 0.0
        val f = DecimalFormat("#,##0.00#", DecimalFormatSymbols(Locale.US)).apply { roundingMode = RoundingMode.HALF_EVEN }
        return f.format(BigDecimal(v.toString()))
    }

    // MARK: Book courier (the page's ShopifyCourierOption)

    /** The order's delivery has an address: the courier has somewhere to send it. */
    fun delivering(o: Order): Boolean {
        val d = o.delivery ?: return false
        if (!d.required) return false
        return d.address.trim().isNotEmpty()
    }

    /** The order's Shopify order, when it has one (a web order, or one made for a courier before). */
    fun shopifyOrder(o: Order): String? {
        val id = (o.shopifyOrderId ?: "").trim()
        return id.ifEmpty { null }
    }

    fun courierFirstStep(o: Order): String {
        val linked = shopifyOrder(o)
        if (linked != null) return "Shopify order #${o.shopifyOrderNumber?.toString() ?: linked} already exists"
        return "Create a matching Shopify order — custom lines only, nothing added to your catalogue"
    }

    const val noAddressWarning =
        "This order has no delivery address. It can still be booked, but the courier will have nowhere to send it — add one on the order first."

    /** What /api/shopify/push/from-order answers: the Shopify order made (or the one already linked). */
    data class MadeShopifyOrder(val id: String, val number: String?, val hasShippingAddress: Boolean)

    fun madeShopifyOrder(json: Map<String, Any?>): MadeShopifyOrder? {
        val id = text(json["shopifyOrderId"])
        if (id.isNullOrEmpty()) return null
        return MadeShopifyOrder(id, text(json["shopifyOrderNumber"]), json["hasShippingAddress"] as? Boolean ?: false)
    }

    /** The page's toast for the Shopify order just made. */
    fun madeNote(m: MadeShopifyOrder): Pair<String, String> =
        "Shopify order #${m.number ?: m.id} created" to
            if (m.hasShippingAddress) "Delivery address attached."
            else "No delivery address on this order — add one so the courier has somewhere to send it."

    /** What /api/shopify/fulfill says it did. */
    fun fulfilledWords(json: Map<String, Any?>): String =
        text(json["message"]) ?: "Fulfilled. Universal Courier will book it with Envio and add the tracking number."

    // MARK: Track (TCS, /api/tcs)

    data class Checkpoint(val datetime: String, val status: String)
    data class TCSTrack(val summary: String, val checkpoints: List<Checkpoint>)

    /** The page reads a TCS answer as found when it says SUCCESS or carries checkpoints; otherwise its words. */
    fun tcsTrack(json: Map<String, Any?>): Result<TCSTrack> {
        val found = text(json["message"]) == "SUCCESS" || json["checkpoints"] != null
        if (!found) {
            return Result.failure(OrderActionFailure(text(json["shipmentsummary"]) ?: text(json["error"]) ?: "No data found."))
        }
        val list = (json["checkpoints"] as? List<*>).orEmpty().mapNotNull { it as? Map<*, *> }.take(5).map {
            Checkpoint(text(it["datetime"]) ?: "", text(it["status"]) ?: "")
        }
        return Result.success(TCSTrack(text(json["shipmentsummary"]) ?: "No summary available.", list))
    }

    fun tcsUrl(cn: String): String = "https://www.tcscourier.com/domestic/tracking/?ref=" + URLEncoder.encode(cn, "UTF-8").replace("+", "%20")

    // MARK: Leopards (website-order-panel.tsx, /api/website/orders/<id>)

    data class LeopardsTrack(
        val status: String,
        val delivered: Boolean,
        /** The last five, as the panel lists them: "when — what · where". */
        val lines: List<String>,
    )

    fun leopardsTrack(json: Map<String, Any?>): LeopardsTrack {
        val history = (json["history"] as? List<*>).orEmpty().mapNotNull { it as? Map<*, *> }
        val lines = history.takeLast(5).map { h ->
            val place = text(h["location"]) ?: ""
            "${text(h["at"]) ?: ""} — ${text(h["status"]) ?: ""}" + if (place.isEmpty()) "" else " · $place"
        }
        return LeopardsTrack(text(json["status"]) ?: "Unknown", json["delivered"] as? Boolean ?: false, lines)
    }

    /** After a move that messages the customer: told, or why the message did not go (the move itself stands). */
    fun notifiedWords(json: Map<String, Any?>): String {
        val n = text(json["notified"])
        if (!n.isNullOrEmpty()) return "Done — but the customer's WhatsApp did not send: $n"
        return "Done. The customer has been told on WhatsApp."
    }

    /** The Leopards line booked, from the ship answer. */
    fun shippedCN(json: Map<String, Any?>): String? = (json["leopards"] as? Map<*, *>)?.let { text(it["cn"]) }

    /** A route's field as text, whether it came as text or a number. */
    fun text(v: Any?): String? = when (v) {
        is String -> v
        is Int -> v.toString()
        is Long -> v.toString()
        is Double -> jsNumber(v)
        else -> null
    }
}

/** A route that answered but found nothing, in its own words. */
class OrderActionFailure(override val message: String) : Exception(message)
