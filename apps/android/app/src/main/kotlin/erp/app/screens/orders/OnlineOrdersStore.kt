package erp.app.screens.orders

import erp.app.ErpApp
import erp.app.data.ErpApi
import erp.app.data.OnlineInbox
import erp.app.data.ServerShelf
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * The online orders and their moves, through the web's own staff routes (lib/website/online-client.ts): the list
 * (/api/website/online), Confirm and Decline (/api/website/online/<ONL-…>), Transfer received and Let it lapse
 * (/api/website/orders/<ORD-…>). Each of those sends WhatsApp from the shop's number and the transfer books money,
 * so they are the server's (lib/website/online.ts, fulfilment.ts) and gated there to a signed-in owner or staff
 * account; the phone only asks, after saying what goes (the preview routes). Each move is safe to ask twice: the
 * server claims a confirm in a transaction and records a transfer once.
 */
object OnlineOrdersStore {
    sealed interface Phase {
        data object Idle : Phase
        data object Loading : Phase
        data object Loaded : Phase
        data class Failed(val message: String) : Phase
    }

    private val _phase = MutableStateFlow<Phase>(Phase.Idle)
    val phase: StateFlow<Phase> = _phase.asStateFlow()
    private val _rows = MutableStateFlow<List<OnlineOrderRow>>(emptyList())
    val rows: StateFlow<List<OnlineOrderRow>> = _rows.asStateFlow()
    private var loading = false

    /** The last fortnight's, newest first (the server sorts them so). */
    fun waiting(rows: List<OnlineOrderRow>): List<OnlineOrderRow> = rows.filter { OnlineOrdersLogic.isWaiting(it) }
    fun lately(rows: List<OnlineOrderRow>): List<OnlineOrderRow> = rows.filter { !OnlineOrdersLogic.isWaiting(it) }

    /** The list, and the count the dashboard and the Orders tab show, asked again. */
    suspend fun load() {
        if (loading) return
        loading = true
        try {
            if (_rows.value.isEmpty()) _phase.value = Phase.Loading
            try {
                val answer = OnlineOrdersAnswer.from(ErpApi.shared.get("/api/website/online"))
                _rows.value = answer?.orders ?: emptyList()
                _phase.value = Phase.Loaded
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (_rows.value.isEmpty()) _phase.value = Phase.Failed(say(e))
            }
        } finally {
            loading = false
        }
        OnlineInbox.refresh()
    }

    fun clear() {
        _rows.value = emptyList()
        _phase.value = Phase.Idle
    }

    // MARK: What a move will send

    suspend fun previewOnline(id: String, action: String, reason: String? = null): OnlinePreview {
        var path = "/api/website/online/${OnlineOrdersLogic.component(id)}/preview?action=$action"
        if (reason != null) path += "&reason=" + OnlineOrdersLogic.component(reason)
        return preview(path)
    }

    suspend fun previewOrder(id: String, action: String): OnlinePreview =
        preview("/api/website/orders/${OnlineOrdersLogic.component(id)}/preview?action=$action")

    private suspend fun preview(path: String): OnlinePreview {
        try {
            return OnlinePreview.from(ErpApi.shared.get(path)) ?: throw ErpApi.Failure(0, "The ERP's answer couldn't be read.")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            throw plain(e)
        }
    }

    // MARK: The moves

    data class Confirmed(val orderId: String, val notified: String?)

    /** Writes the ORD- order (labelled Online, the quoted prices), starts the price hold and tells the customer. */
    suspend fun confirm(id: String): Confirmed {
        val out = move("/api/website/online/${OnlineOrdersLogic.component(id)}", mapOf("action" to "confirm"))
        return Confirmed(out["orderId"] as? String ?: "", out["notified"] as? String)
    }

    /** Sends the customer the reason. Nothing else is written. Answers why the WhatsApp did not go, if it did not. */
    suspend fun decline(id: String, reason: String): String? =
        move("/api/website/online/${OnlineOrdersLogic.component(id)}", mapOf("action" to "decline", "reason" to reason))["notified"] as? String

    /** The money is in the bank: the pieces as a dated Bank Transfer advance, the delivery as extra revenue. */
    suspend fun transferReceived(order: String): String? =
        move("/api/website/orders/${OnlineOrdersLogic.component(order)}", mapOf("action" to "transfer_received"))["notified"] as? String

    /** Nothing came and the bank was checked: the order is cancelled and the customer told. */
    suspend fun lapse(order: String): String? =
        move("/api/website/orders/${OnlineOrdersLogic.component(order)}", mapOf("action" to "lapse"))["notified"] as? String

    private suspend fun move(path: String, body: Map<String, Any?>): Map<String, Any?> {
        val out = try {
            ErpApi.shared.send(path, body = body)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            throw plain(e)
        }
        // Staff read the books from the server every 25 seconds: ask now, so the order just confirmed or paid is on
        // the screen at once (owners' are live already).
        ServerShelf.wake()
        ErpApp.scope.launch { load() }
        return out
    }

    // MARK: Words for a refusal

    /** The web's words for the gate's refusals (online-client.ts staffFetch); the server's own otherwise. */
    fun say(error: Throwable): String {
        if (error is ErpApi.Failure) {
            if (error.status == 401) return "Sign in with Google to act on online orders."
            if (error.status == 403) return "Only owner and staff accounts can act on online orders."
        }
        return error.message?.takeIf { it.isNotBlank() } ?: "Something went wrong. Try again."
    }

    private fun plain(error: Throwable): Throwable {
        if (error !is ErpApi.Failure) return error
        return ErpApi.Failure(error.status, say(error))
    }
}
