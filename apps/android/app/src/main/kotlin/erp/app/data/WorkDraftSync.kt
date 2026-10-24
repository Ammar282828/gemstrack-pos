package erp.app.data

import android.os.Build
import erp.app.ErpApp
import erp.app.config.House
import erp.app.config.Prefs
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlin.random.Random
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The phone's unfinished order and sale in the ERP's Drafts too (Firestore `drafts`; decisions.md "Drafts":
 * "every device in the shop sees the same list and a sale started on a phone is finished at the counter").
 *
 * The phone keeps its own copy as it always has (the New order and New sale draft stores): that is what the
 * screen opens on, and it works with no connection. This sends the same work, in the web form's own shape, to
 * /api/app/drafts a second after the last change, as the web's forms do; removes it once the order or sale is
 * saved or started over; and asks, when the screen opens, whether it is still there, since an order finished at
 * the counter must not stay on the phone to be saved a second time.
 *
 * One draft of each kind, as the phone has one of each. Its id (the web's `newDraftId` form) is kept beside the
 * phone's copy. Sends go one at a time, in order, so an older draft never lands after a newer one or after the
 * remove; one still on its way when the work is saved is taken back out (the web's `finish`). Main thread.
 */
class WorkDraftSync private constructor(val kind: String) {
    private val idKey = "erp.${kind}Draft.remoteId"
    private val createdKey = "erp.${kind}Draft.remoteCreatedAt"

    /** Set once a send has landed: until then "not in Drafts" says nothing about the phone's copy. */
    private val landedKey = "erp.${kind}Draft.remoteLanded"

    /** The last draft sent, as text: the same work is not sent twice. */
    private var lastSent = ""
    private var waiting: Job? = null
    private var line: Job? = null

    /** Moves on each remove: a send begun before it is taken back out. */
    private var generation = 0

    /** This phone's draft in Drafts, once it has been sent. */
    val id: String? get() = Prefs.string(idKey)

    /** What goes to Drafts: the web form's values, and the card's total and name. */
    class Snapshot(val values: Map<String, Any?>, val total: Double, val customerName: String)

    /**
     * The work as it stands, a second after the last change (or `now`, as the screen or the app goes); `make` is
     * asked for it then, not on every key. Blank work is nothing worth keeping: the Drafts copy goes. Nothing is
     * sent where the shop has turned drafts off (Settings, `autoDraftForms`).
     */
    fun push(blank: Boolean, enabled: Boolean, now: Boolean = false, make: () -> Snapshot) {
        waiting?.cancel()
        // The demo's made-up books never leave the phone.
        if (!enabled || House.isDemo) return
        if (blank) {
            if (id != null) drop()
            return
        }
        val gen = generation
        waiting = ErpApp.scope.launch {
            if (!now) {
                try { delay(1000) } catch (e: CancellationException) { return@launch }
            }
            send(make(), gen)
        }
    }

    /** The order or sale was saved, or started over: its Drafts copy goes, and the next is a new draft. */
    fun drop() {
        waiting?.cancel()
        generation += 1
        lastSent = ""
        val gone = id ?: return
        forget()
        // The business it was made in: a switch before the line gets to it must not send it to the next business's ERP.
        val api = ErpApi.shared
        enqueue { runCatching { api.send("/api/app/drafts", body = mapOf("action" to "drop", "id" to gone)) } }
    }

    /**
     * The business changed: nothing waiting is sent for the one left (its phone copy is kept under its own key), and the next
     * business starts from nothing. What is already on its way finishes for the business it began in.
     */
    fun reset() {
        waiting?.cancel()
        lastSent = ""
    }

    /** Lets go of the Drafts copy without touching it: it was finished or thrown away on another device. */
    fun forget() {
        Prefs.remove(idKey)
        Prefs.remove(createdKey)
        Prefs.remove(landedKey)
        lastSent = ""
    }

    /** Whether this phone's draft is still in Drafts. Null when none has landed there, or there is no answer: the phone's copy then stands. */
    suspend fun stillThere(): Boolean? {
        val draftId = id ?: return null
        if (Prefs.bool(landedKey) != true) return null
        val out = runCatching { ErpApi.shared.send("/api/app/drafts", body = mapOf("action" to "check", "id" to draftId)) }.getOrNull() ?: return null
        return out["exists"] as? Boolean
    }

    private fun send(snap: Snapshot, gen: Int) {
        val values = snap.values
        if (gen != generation) return
        val text = JsonText.of(values, sorted = true) ?: return
        if (text == lastSent) return
        val draftId = id ?: newId(kind)
        val created = Prefs.string(createdKey) ?: Instant.now().truncatedTo(ChronoUnit.SECONDS).toString()
        Prefs.putString(idKey, draftId)
        Prefs.putString(createdKey, created)
        lastSent = text
        val body = mapOf(
            "action" to "save", "id" to draftId, "kind" to kind, "data" to values,
            "total" to (if (snap.total.isFinite()) snap.total else 0.0), "customerName" to snap.customerName,
            "device" to Build.MODEL, "createdAt" to created,
        )
        val api = ErpApi.shared
        val business = House.id
        enqueue {
            try {
                api.send("/api/app/drafts", body = body)
                if (House.id == business && id == draftId) Prefs.putBool(landedKey, true)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Not sent: the next change, or the screen going, sends it again.
                if (lastSent == text) lastSent = ""
            }
            // Saved or started over while it was on its way: take it back out.
            if (generation != gen) {
                runCatching { api.send("/api/app/drafts", body = mapOf("action" to "drop", "id" to draftId)) }
            }
        }
    }

    private fun enqueue(work: suspend () -> Unit) {
        val previous = line
        line = ErpApp.scope.launch {
            previous?.join()
            work()
        }
    }

    companion object {
        val order = WorkDraftSync("order")
        val sale = WorkDraftSync("sale")

        /** The web's `newDraftId`: "<kind>-<ms in base 36>-<five letters>". */
        fun newId(kind: String, nowMs: Long = System.currentTimeMillis(), random: Random = Random.Default): String {
            val letters = "abcdefghijklmnopqrstuvwxyz0123456789"
            val tail = (0 until 5).map { letters[random.nextInt(letters.length)] }.joinToString("")
            return "$kind-${maxOf(0L, nowMs).toString(36)}-$tail"
        }
    }
}
