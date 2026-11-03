package erp.app.screens.orders

import erp.app.ui.toWhatsAppNumber
import erp.core.models.OrderItem

/**
 * Send to karigar (docs/decisions.md "Send to karigar"; the iPhone's SendToKarigarSheet): which pieces are ticked, the
 * body of `POST /api/app/orders/send-to-karigar` and what it answers. The words are never built here: the route builds
 * them (lib/karigar-message.ts) and the sheet shows what `preview: true` returns, so the slip, the web and this agree.
 */
object SendToKarigarLogic {
    const val PATH = "/api/app/orders/send-to-karigar"

    /** The karigar the sheet opens on: the one asked for, else the first asked-for piece's, else the first piece anyone holds. */
    fun firstKarigar(items: List<OrderItem>, karigarId: String?, pieces: List<Int>?): String =
        karigarId?.takeIf { it.isNotEmpty() }
            ?: pieces?.firstOrNull()?.let { items.getOrNull(it)?.karigarId }?.takeIf { it.isNotEmpty() }
            ?: items.firstNotNullOfOrNull { it.karigarId?.takeIf { id -> id.isNotEmpty() } }
            ?: ""

    /** The pieces asked for, else the ones he holds, else all. */
    fun initialPieces(items: List<OrderItem>, karigarId: String, pieces: List<Int>?): Set<Int> {
        if (!pieces.isNullOrEmpty()) return pieces.filter { it in items.indices }.toSet()
        val mine = items.indices.filter { karigarId.isNotEmpty() && items[it].karigarId == karigarId }
        return (mine.ifEmpty { items.indices.toList() }).toSet()
    }

    /** The route's body: `phone` only when typed, `karigarId` only when chosen, `preview` only when asking for the words. */
    fun body(orderId: String, karigarId: String, indexes: Collection<Int>, phone: String, preview: Boolean): Map<String, Any?> = buildMap {
        put("orderId", orderId)
        put("pieceIndexes", indexes.sorted())
        if (karigarId.isNotEmpty()) put("karigarId", karigarId)
        if (phone.trim().isNotEmpty()) put("phone", phone.trim())
        if (preview) put("preview", true)
    }

    /** A WhatsApp number the route will take (it refuses fewer than 11 or more than 15 digits). */
    fun numberOK(phone: String): Boolean = toWhatsAppNumber(phone).length in 11..15

    fun pieceTitle(item: OrderItem): String = item.description.trim().ifEmpty { "Piece" }

    data class Preview(val text: String, val photos: Int)

    /** The words and the first message's photo count, from the route's `preview: true` answer. */
    fun preview(out: Map<String, Any?>): Preview {
        val first = (out["messages"] as? List<*>)?.firstOrNull() as? Map<*, *>
        return Preview(out["message"] as? String ?: "", (first?.get("photos") as? Number)?.toInt() ?: 0)
    }

    fun photosNote(photos: Int): String =
        if (photos > 0) "$photos reference photo${if (photos == 1) "" else "s"} go first. No prices are sent." else "No prices are sent."

    /** "3 messages to 03•••567", with how many photos did not go. */
    fun sentDetail(out: Map<String, Any?>): String {
        val sent = (out["sent"] as? Number)?.toInt() ?: 0
        var detail = "$sent message${if (sent == 1) "" else "s"} to ${out["to"] as? String ?: ""}"
        val failed = (out["photosFailed"] as? Number)?.toInt() ?: 0
        if (failed > 0) detail += " · $failed photo${if (failed == 1) "" else "s"} did not go"
        return detail
    }
}
