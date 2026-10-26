package erp.app.data

import android.os.Build
import erp.app.ErpApp
import erp.app.config.Businesses
import erp.app.config.House
import erp.app.config.Prefs
import erp.core.Json
import erp.core.entry.EntryHouse
import erp.core.entry.NewOrderDraft
import erp.core.entry.NewOrderMath
import erp.core.entry.SaleDraft
import erp.core.entry.SaleFigures
import erp.core.entry.webValues
import erp.core.models.Customer
import erp.core.models.Settings
import java.io.File
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min
import kotlin.random.Random
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The phone's unfinished order and sale in the ERP's Drafts too (Firestore `drafts`; decisions.md "Drafts":
 * "every device in the shop sees the same list and a sale started on a phone is finished at the counter").
 *
 * Saved at every moment (owner, 2026-10-25: "auto save at every moment so even if I've just written the name a draft
 * gets saved. However don't auto open the draft"). The phone keeps its own copy as it always has (NewOrderPhoneStore,
 * SaleStore), written at once on every change; this sends the same work, in the web form's own shape, to
 * /api/app/drafts within a third of a second of a change, as one write for a burst of keys (the newest work wins) and
 * never more than one write on its way; the app leaving, the screen going and a business switch send it at once. A send
 * that fails (no line) is kept on disk and tried again, so the phone's copy reaches Drafts when the line is back
 * (`resume`, and a retry with backoff).
 *
 * Never auto-opened: a New order or New sale starts blank. The draft this phone was holding is made sure of in Drafts
 * (`release`) and its id forgotten, so the new form's first change is a NEW draft and never writes over the old one. A
 * draft is continued only on purpose: from Drafts, or from a screen that puts a piece on the sale in progress (Scan,
 * Stock, the voice assistant: `?resume=1`). Saving the order or sale removes only its own draft (`drop`).
 *
 * Per kind and business there is one current draft: its id (the web's `newDraftId` form) is kept beside the phone's
 * copy. Sends go one at a time, in order, so an older draft never lands after a newer one or after the remove; a draft
 * removed while a send of it is waiting is never sent (the web's `finish`). Main thread. (WorkDraftSync.swift.)
 *
 * The seams ([DraftWire], [DraftIds], [DraftOutboxFiles], the clock) are the app's by default and a test's own.
 */
class WorkDraftSync internal constructor(
    val kind: String,
    private val scope: () -> CoroutineScope = { ErpApp.scope },
    private val wire: DraftWire = AppWire,
    private val ids: DraftIds = PrefsIds,
    private val files: DraftOutboxFiles = AppOutboxFiles,
    private val clock: () -> Long = System::currentTimeMillis,
    private val openBusiness: () -> String = { House.id },
    private val isDemo: () -> Boolean = { House.isDemo },
    private val knows: (String) -> Boolean = { Businesses.business(it) != null },
    private val device: () -> String = { Build.MODEL.orEmpty() },
) {
    private val idKey = "erp.${kind}Draft.remoteId"
    private val createdKey = "erp.${kind}Draft.remoteCreatedAt"

    /** Set once a send has landed: until then "not in Drafts" says nothing about the phone's copy. */
    private val landedKey = "erp.${kind}Draft.remoteLanded"

    /** A save on its way to /api/app/drafts. `text` is the form's values as sorted JSON: the same work is not sent twice. */
    private class Outgoing(val id: String, val body: Map<String, Any?>, val biz: String, val text: String)

    private class Latest(val make: () -> Snapshot, val biz: String)

    /** The newest work not yet handed to the line: what a business switch sends at once for the business being left. */
    private var latest: Latest? = null

    /** The write that is due (the newest work goes in it). */
    private var waiting: Job? = null
    private var lastStart = Long.MIN_VALUE / 4

    /** The last draft sent, as text: the same work is not sent twice. */
    private var lastSent = ""

    /** The newest save of each draft that has not started: a newer one takes the place of an older one. */
    private val slots = HashMap<String, Outgoing>()

    /** Saves of a draft that are on the line or waiting for it (`resume` leaves such a draft alone). */
    private val busy = HashMap<String, Int>()

    /** Drafts removed (saved, discarded, started over): never written again, whatever is still on its way. */
    private val removed = HashSet<String>()
    private var queue: Job? = null
    private var retrying: Job? = null
    private var failures = 0

    /** What goes to Drafts: the web form's values, and the card's total and name. */
    class Snapshot(val values: Map<String, Any?>, val total: Double, val customerName: String)

    /** This phone's draft in Drafts for the open business, once it has been sent. */
    val id: String? get() = ids.get(idKey, openBusiness())

    /** The person switched business: what was waiting to be sent is the old business's, and goes nowhere. */
    fun reset() {
        waiting?.cancel()
        waiting = null
        latest = null
        lastSent = ""
    }

    /**
     * Called by `Businesses.switchTo` before the business changes: work waiting for its moment is sent now, to the
     * business it was typed in. A send already on its way is pinned to its own business and lands there.
     */
    fun flush(leaving: String) {
        val l = latest ?: return
        if (l.biz != leaving) return
        waiting?.cancel()
        waiting = null
        latest = null
        send(l.make(), leaving)
    }

    /**
     * The work as it stands, at the next moment ([INTERVAL_MS] after the last write began; at once if none has been for a
     * while) or `now`, as the screen or the app goes. `make` is asked for the work then, not on every key, so a burst is
     * one write of the newest. Blank work is nothing worth keeping: the Drafts copy goes. Nothing is sent where the shop
     * has turned drafts off (Settings, `autoDraftForms`). [business] is the one the form was opened in.
     */
    fun push(blank: Boolean, enabled: Boolean, now: Boolean = false, business: String? = null, make: () -> Snapshot) {
        // The demo's made-up books never leave the phone.
        if (!enabled || isDemo()) {
            waiting?.cancel()
            waiting = null
            latest = null
            return
        }
        val biz = business ?: openBusiness()
        if (blank) {
            waiting?.cancel()
            waiting = null
            latest = null
            if (ids.get(idKey, biz) != null) drop(biz)
            return
        }
        latest = Latest(make, biz)
        if (now) {
            waiting?.cancel()
            waiting = null
            sendLatest()
            return
        }
        // A write is already due: it takes the newest work (a burst of keys is one write).
        if (waiting != null) return
        val wait = max(0L, INTERVAL_MS - (clock() - lastStart))
        // Started after it is held, so a wait of nothing cannot finish before `waiting` is set.
        val job = scope().launch(start = CoroutineStart.LAZY) {
            if (wait > 0) {
                try { delay(wait) } catch (e: CancellationException) { return@launch }
            }
            waiting = null
            sendLatest()
        }
        waiting = job
        job.start()
    }

    private fun sendLatest() {
        val l = latest ?: return
        latest = null
        send(l.make(), l.biz)
    }

    /** The order or sale was saved, or started over: its Drafts copy goes, and the next is a new draft. */
    fun drop(business: String? = null) {
        val biz = business ?: openBusiness()
        waiting?.cancel()
        waiting = null
        latest = null
        lastSent = ""
        val gone = ids.get(idKey, biz) ?: return
        forget(biz)
        abandon(gone)
        enqueue {
            try {
                wire.send(biz, mapOf("action" to "drop", "id" to gone))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Gone from the phone's side already; a draft left in Drafts is discarded from there.
            }
        }
    }

    /** A draft that is gone (discarded from Drafts, saved): nothing of it is sent or retried any more. */
    fun abandon(draftId: String) {
        removed.add(draftId)
        slots.remove(draftId)
        files.remove(draftId)
    }

    /**
     * Lets go of the Drafts copy without touching it: it was finished or thrown away on another device, or it stays in
     * Drafts and the next form is a new draft.
     */
    fun forget(business: String? = null) {
        val b = business ?: openBusiness()
        ids.set(idKey, b, null)
        ids.set(createdKey, b, null)
        ids.set(landedKey, b, null)
        lastSent = ""
    }

    /**
     * A New order / New sale is opening blank while this phone holds work from before: that work is made sure of in
     * Drafts (sent now, and kept on disk until it has landed, so a kill or no line loses nothing), and this phone lets go
     * of its id, so the new form's first change is a new draft. [snapshot] is the held work as it stands (null when only
     * an id is left). The caller clears the phone's own copy.
     */
    fun release(business: String, enabled: Boolean, snapshot: (() -> Snapshot)?) {
        waiting?.cancel()
        waiting = null
        val pending = latest
        latest = null
        if (enabled && !isDemo()) {
            // What was typed last, whichever copy is newest: the form's own pending work, else the phone's copy.
            if (pending != null && pending.biz == business) send(pending.make(), business, durable = true)
            else if (snapshot != null) send(snapshot(), business, durable = true)
        }
        forget(business)
    }

    /**
     * Whether this phone's draft is still in Drafts. Null when none has landed there, or there is no answer: the phone's
     * copy then stands.
     */
    suspend fun stillThere(business: String? = null): Boolean? {
        val biz = business ?: openBusiness()
        val draftId = ids.get(idKey, biz) ?: return null
        if (ids.get(landedKey, biz) == null) return null
        val out = try {
            wire.send(biz, mapOf("action" to "check", "id" to draftId))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            return null
        }
        return out["exists"] as? Boolean
    }

    /**
     * A draft from Drafts continued on this phone: from now on this phone's work is that draft, so the next change writes
     * over it and saving the order or sale removes it, as the web's form does with `?draft=`. The phone's own draft was
     * released first ([release]) and stays in Drafts as it was.
     */
    fun adopt(draftId: String, createdAt: String) {
        waiting?.cancel()
        waiting = null
        latest = null
        lastSent = ""
        removed.remove(draftId)
        val b = openBusiness()
        ids.set(idKey, b, draftId)
        ids.set(createdKey, b, createdAt.ifEmpty { Instant.ofEpochMilli(clock()).truncatedTo(ChronoUnit.SECONDS).toString() })
        // It is in Drafts already: one finished at the counter since lets go of the phone's copy too.
        ids.set(landedKey, b, "1")
    }

    // MARK: Sending

    private fun send(snap: Snapshot, biz: String, durable: Boolean = false) {
        val values = snap.values
        val text = JsonText.of(values, sorted = true) ?: return
        // `lastSent` is the open business's; a send for the one just left leaves it alone.
        val open = biz == openBusiness()
        if (open && !durable && text == lastSent) return
        val draftId = ids.get(idKey, biz) ?: newId(kind)
        val created = ids.get(createdKey, biz) ?: Instant.ofEpochMilli(clock()).truncatedTo(ChronoUnit.SECONDS).toString()
        ids.set(idKey, biz, draftId)
        ids.set(createdKey, biz, created)
        if (open) lastSent = text
        // A heavy draft (sample photos) is not sent again straight away.
        lastStart = if (text.length > HEAVY_BYTES) clock() + HEAVY_INTERVAL_MS - INTERVAL_MS else clock()
        val body = mapOf(
            "action" to "save", "id" to draftId, "kind" to kind, "data" to values,
            "total" to (if (snap.total.isFinite()) snap.total else 0.0), "customerName" to snap.customerName,
            "device" to device(), "createdAt" to created,
        )
        submit(Outgoing(draftId, body, biz, text), durable)
    }

    private fun submit(o: Outgoing, durable: Boolean) {
        slots[o.id] = o
        busy[o.id] = (busy[o.id] ?: 0) + 1
        if (durable) files.write(o.id, kind, o.biz, o.body)
        enqueue { deliver(o.id) }
    }

    /** One save at a time on the line; a newer save of the same draft that arrived meanwhile is the one sent. */
    private suspend fun deliver(id: String) {
        try {
            val o = slots.remove(id)
            if (o == null || id in removed) return
            try {
                wire.send(o.biz, o.body)
                failures = 0
                if (slots[id] == null) files.remove(id)
                if (ids.get(idKey, o.biz) == id) ids.set(landedKey, o.biz, "1")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Not sent (no line, the server busy): the phone's copy is the truth. This body is kept on disk and sent
                // again, here by the backoff and when the app comes forward, unless a newer one has taken its place.
                if (o.biz == openBusiness() && lastSent == o.text) lastSent = ""
                if (id !in removed && slots[id] == null) {
                    files.write(id, kind, o.biz, o.body)
                    scheduleRetry()
                }
            }
        } finally {
            val left = (busy[id] ?: 1) - 1
            if (left <= 0) busy.remove(id) else busy[id] = left
        }
    }

    /**
     * Tries again what could not be sent: saves kept on disk after a failure or a hand-off. Called when the app comes
     * forward, when Drafts or a form opens, and by the backoff.
     */
    fun resume() {
        for (rec in files.all(kind)) {
            if (rec.id in removed || busy[rec.id] != null || !knows(rec.biz)) continue
            submit(Outgoing(rec.id, rec.body, rec.biz, ""), durable = false)
        }
    }

    private fun scheduleRetry() {
        if (retrying != null) return
        failures += 1
        val wait = min(120L, 5L shl (min(failures, 5) - 1)) * 1000
        val job = scope().launch(start = CoroutineStart.LAZY) {
            try { delay(wait) } catch (e: CancellationException) { return@launch }
            retrying = null
            resume()
        }
        retrying = job
        job.start()
    }

    private fun enqueue(work: suspend () -> Unit) {
        val previous = queue
        queue = scope().launch {
            previous?.join()
            work()
        }
    }

    companion object {
        val order = WorkDraftSync("order")
        val sale = WorkDraftSync("sale")

        /** A change reaches Drafts within this long; changes inside it are one write. */
        const val INTERVAL_MS = 300L

        /** A draft heavy with photos is sent at most this often, so typing is not a steady upload. */
        private const val HEAVY_INTERVAL_MS = 1500L
        private const val HEAVY_BYTES = 250_000

        /** The app is in front again: what could not be sent is sent. */
        fun resumeAll() {
            order.resume()
            sale.resume()
        }

        /** A business is being left: its waiting work goes now, to it. */
        fun flushAll(leaving: String) {
            order.flush(leaving)
            sale.flush(leaving)
        }

        /** The web's `newDraftId`: "<kind>-<ms in base 36>-<five letters>". */
        fun newId(kind: String, nowMs: Long = System.currentTimeMillis(), random: Random = Random.Default): String {
            val letters = "abcdefghijklmnopqrstuvwxyz0123456789"
            val tail = (0 until 5).map { letters[random.nextInt(letters.length)] }.joinToString("")
            return "$kind-${maxOf(0L, nowMs).toString(36)}-$tail"
        }

        /** A New order as it stands, in the web form's shape, with its balance as the card's total. */
        fun snapshot(d: NewOrderDraft, settings: Settings?): Snapshot =
            Snapshot(d.webValues(settings), NewOrderMath.totals(d, settings).balance, d.customerName)

        /** A New sale as it stands, in the sale page's shape, with its subtotal as the card's total. */
        fun snapshot(d: SaleDraft, settings: Settings?, customers: List<Customer>): Snapshot {
            val subtotal = SaleFigures(d, settings, customers, EntryHouse.margin).subtotal
            return Snapshot(d.webValues(subtotal), subtotal, d.customerName)
        }
    }
}

/** The line to /api/app/drafts, to a named business's ERP. */
fun interface DraftWire {
    suspend fun send(business: String, body: Map<String, Any?>): Map<String, Any?>
}

private object AppWire : DraftWire {
    override suspend fun send(business: String, body: Map<String, Any?>): Map<String, Any?> {
        val b = Businesses.business(business) ?: Businesses.current
        return ErpApi.forBusiness(b).send("/api/app/drafts", body = body)
    }
}

/** A draft's id, when it was begun and whether a send has landed, kept per business beside the phone's copy. */
interface DraftIds {
    fun get(key: String, business: String): String?
    fun set(key: String, business: String, value: String?)
}

private object PrefsIds : DraftIds {
    override fun get(key: String, business: String): String? = Prefs.string(key, business)
    override fun set(key: String, business: String, value: String?) = Prefs.putString(key, value, business)
}

/**
 * Saves that did not reach Drafts (no line), and the held work of a form that was left, kept until they land: one JSON
 * file per draft id (the iPhone's Application Support/erp-drafts/outbox).
 */
interface DraftOutboxFiles {
    class Record(val id: String, val biz: String, val body: Map<String, Any?>)

    fun write(id: String, kind: String, biz: String, body: Map<String, Any?>)
    fun remove(id: String)
    fun all(kind: String): List<Record>
}

/** In the app's private files, written in order on one thread (a draft with photos weighs a megabyte). */
private object AppOutboxFiles : DraftOutboxFiles {
    private val executor = Executors.newSingleThreadExecutor { r -> Thread(r, "erp-draft-outbox").apply { isDaemon = true } }

    private val dir: File?
        get() = runCatching { File(File(ErpApp.instance.filesDir, "erp-drafts"), "outbox") }.getOrNull()

    private fun safe(id: String): String = id.map { if (it.isLetterOrDigit() || it == '-' || it == '_') it else '_' }.joinToString("")

    override fun write(id: String, kind: String, biz: String, body: Map<String, Any?>) {
        val text = JsonText.of(mapOf("id" to id, "kind" to kind, "biz" to biz, "body" to body)) ?: return
        executor.execute {
            val d = dir ?: return@execute
            d.mkdirs()
            val tmp = File(d, safe(id) + ".tmp")
            tmp.writeText(text)
            tmp.renameTo(File(d, safe(id) + ".json"))
        }
    }

    override fun remove(id: String) {
        executor.execute { dir?.let { File(it, safe(id) + ".json").delete() } }
    }

    /** Read after every write and remove already asked for (the same thread). */
    override fun all(kind: String): List<DraftOutboxFiles.Record> =
        executor.submit<List<DraftOutboxFiles.Record>> {
            val out = ArrayList<DraftOutboxFiles.Record>()
            for (f in dir?.listFiles { _, name -> name.endsWith(".json") } ?: emptyArray()) {
                @Suppress("UNCHECKED_CAST")
                val rec = runCatching { Json.parse(f.readText()) as? Map<String, Any?> }.getOrNull() ?: continue
                if (rec["kind"] != kind) continue
                @Suppress("UNCHECKED_CAST")
                out.add(DraftOutboxFiles.Record(rec["id"] as? String ?: continue, rec["biz"] as? String ?: continue, rec["body"] as? Map<String, Any?> ?: continue))
            }
            out
        }.get()
}
