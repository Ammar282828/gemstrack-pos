package erp.app.screens.orders

import erp.app.config.Business
import erp.app.config.Businesses
import erp.app.data.ErpApi
import erp.app.data.JsonText
import erp.app.data.Outbox
import erp.core.models.Karigar
import erp.core.models.Order
import java.util.UUID
import kotlinx.coroutines.CancellationException

// Send to karigar (SendToKarigarSheet.swift, KarigarSendQueue.swift): an order's pieces to a karigar on WhatsApp from the shop's line,
// through /api/app/orders/send-to-karigar. src/lib/karigar-message.ts is the one builder of the words: the sheet asks the route for
// them with `preview`, so the slip, the web and this agree. Never a price. Not a money op, so it is sent straight, not through
// /api/app/write.

/** The pure parts of the sheet and of the background send, apart from the screen so they are tested on the JVM. */
object KarigarSendLogic {
    const val PATH = "/api/app/orders/send-to-karigar"

    /** A long send answers `partial` after ~40 s and is asked again until it has all gone, at most this many times. */
    const val MAX_ROUNDS = 12

    /** The number on his file: the contact, else the second phone. */
    fun onFile(k: Karigar?): String = k?.contact?.trim().orEmpty().ifEmpty { k?.altPhone?.trim().orEmpty() }

    /** A WhatsApp number of 11 to 15 digits, as the sheet's Send needs. */
    fun numberOk(digits: String): Boolean = digits.length in 11..15

    /** The karigar the sheet opens on: the one asked for, else the asked piece's, else the first piece that has one. */
    fun firstKarigar(order: Order, karigarId: String?, pieces: List<Int>?): String {
        if (!karigarId.isNullOrEmpty()) return karigarId
        pieces?.firstOrNull()?.let { i -> order.items.getOrNull(i)?.karigarId?.takeIf { it.isNotEmpty() }?.let { return it } }
        return order.items.firstNotNullOfOrNull { it.karigarId?.takeIf { id -> id.isNotEmpty() } }.orEmpty()
    }

    /** The pieces asked for, else the ones he holds, else all. */
    fun initialPieces(order: Order, asked: List<Int>?, karigarId: String): Set<Int> {
        if (!asked.isNullOrEmpty()) return asked.filter { it in order.items.indices }.toSet()
        val mine = order.items.indices.filter { karigarId.isNotEmpty() && order.items[it].karigarId == karigarId }
        return (mine.ifEmpty { order.items.indices.toList() }).toSet()
    }

    fun pieceTitle(description: String): String = description.trim().ifEmpty { "Piece" }

    /** The route's request. Only the words the owner changed go in `texts`; an emptied one sends its photo bare. */
    fun body(orderId: String, indexes: List<Int>, karigarId: String, phone: String, edits: Map<Int, String>, preview: Boolean): Map<String, Any?> {
        val b = LinkedHashMap<String, Any?>()
        b["orderId"] = orderId
        b["pieceIndexes"] = indexes
        if (karigarId.isNotEmpty()) b["karigarId"] = karigarId
        if (phone.isNotBlank()) b["phone"] = phone.trim()
        if (preview) {
            b["preview"] = true
        } else {
            val texts = LinkedHashMap<String, String>()
            for (i in indexes) edits[i]?.let { texts[i.toString()] = it.trim() }
            if (texts.isNotEmpty()) b["texts"] = texts
        }
        return b
    }

    /** What the server would send per piece (by index) and how many reference photos go first. */
    class Preview(val words: Map<Int, String>, val photos: Int)

    fun preview(out: Map<String, Any?>): Preview {
        val groups = (out["messages"] as? List<*>).orEmpty().mapNotNull { it as? Map<*, *> }
        val photos = (groups.firstOrNull()?.get("photos") as? Number)?.toInt() ?: 0
        val words = LinkedHashMap<Int, String>()
        for (g in groups) {
            // Older servers sent `pieces` as the plain indexes: then there are no per-piece words to edit.
            for (p in (g["pieces"] as? List<*>).orEmpty()) {
                val m = p as? Map<*, *> ?: continue
                val i = (m["index"] as? Number)?.toInt() ?: continue
                words[i] = m["text"] as? String ?: ""
            }
        }
        return Preview(words, photos)
    }

    private fun count(v: Any?): Int = (v as? Number)?.toInt() ?: 0

    private fun plural(n: Int, one: String, many: String) = if (n == 1) one else many

    /**
     * Sends, and asks again while the answer is `partial` (the ERP carries on from where it stopped). A `duplicate` is a success: its
     * `said` ("Already sent to …"), never a failure. Returns the words for the app-wide toast.
     */
    suspend fun run(karigarName: String, body: Map<String, Any?>, ask: suspend (Map<String, Any?>) -> Map<String, Any?>): String {
        var sent = 0
        var photosFailed = 0
        var unsure = 0
        for (round in 0 until MAX_ROUNDS) {
            val out = ask(body)
            if (out["duplicate"] == true) {
                if (sent > 0) break
                return (out["said"] as? String)?.takeIf { it.isNotBlank() } ?: "Already sent to $karigarName."
            }
            sent += count(out["sent"])
            unsure += count(out["unsure"])
            if (out["partial"] != true) {
                photosFailed = count(out["photosFailed"])
                break
            }
        }
        var said = "Sent to $karigarName: $sent ${plural(sent, "message", "messages")}"
        if (photosFailed > 0) said += " · $photosFailed ${plural(photosFailed, "photo", "photos")} did not go. Retry sends only those"
        if (unsure > 0) said += " · WhatsApp was slow on $unsure: check the chat"
        return said
    }

    /** A failure the Outbox will not retry by itself (status 400): only the person's Retry asks again, and that resumes rather than repeats. */
    fun refusal(e: Exception): ErpApi.Failure =
        ErpApi.Failure(400, (e.message?.takeIf { it.isNotBlank() } ?: "It did not go.") + " Retry sends only what has not gone.")
}

/**
 * Send to karigar, in the background (owner, 2026-11-03: "send message in background"). The sheet hands its request here and closes at once;
 * the send runs on the Outbox's own post (the app's scope, so it outlives the sheet) and says how it ended app-wide: "Sent to Usman", or the
 * failure with Retry (OutboxHost).
 *
 * Never twice (owner, 2026-11-03: "it keeps retrying or double sending"). The ERP keeps one record per send (`karigar_sends`, keyed by the
 * order, pieces, karigar and words) and ticks each message off as it goes: the same send asked again while it runs, or within two minutes of
 * finishing, is answered "already"; an unfinished one carries on from where it stopped, so Retry sends only what had not gone. Here: one send
 * per request at a time (a second tap on the same one is dropped), and it is never retried by itself.
 */
object KarigarSendQueue {
    /** Requests on their way, by their words: the same one twice is the same tap twice. */
    private val inFlight = HashSet<String>()

    /** The key for [body] if it may start now, else null (the same request is already out). */
    @Synchronized
    fun claim(body: Map<String, Any?>): String? {
        val key = JsonText.of(body, sorted = true) ?: UUID.randomUUID().toString()
        return if (inFlight.add(key)) key else null
    }

    @Synchronized
    fun release(key: String) { inFlight.remove(key) }

    /** [body] is the route's request (`orderId`, `pieceIndexes`, `karigarId`, `phone`, `texts`). */
    fun send(body: Map<String, Any?>, karigarName: String, business: Business = Businesses.current) {
        val key = claim(body) ?: return
        val api = ErpApi.forBusiness(business)
        Outbox.of(business).post("Send to $karigarName") {
            try {
                KarigarSendLogic.run(karigarName, body) { api.send(KarigarSendLogic.PATH, body = it, timeoutMs = 90_000) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                throw KarigarSendLogic.refusal(e)
            } finally {
                release(key)
            }
        }
    }
}
