package erp.app.data

import erp.app.ErpApp
import erp.app.config.Business
import erp.app.config.Businesses
import erp.app.config.House
import erp.core.Json
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Saves that do not move money leave the screen at once and finish in the background (owner, 2026-10-23: "make the
 * app snappier"). `enqueue` returns as soon as the change is queued; the write goes through `ErpApi.write` with the
 * name (`requestId`) kept in the entry, so every retry is the same change to the ERP. Entries are kept on disk per
 * house (a kill loses nothing), retried with backoff and again when the app comes forward, and a refusal or a last
 * failure is said app-wide with Retry (OutboxHost). Money writes are awaited: the person sees the ERP's answer.
 *
 * Except offline (owner, 2026-11-03: "allow massive offline capabilities … it should fully handle not being connected at all
 * in any situation"): a creation or a payment that cannot reach the ERP (`queueableOps`) is kept here, durably, with the request
 * name fixed at the first tap (`queueForLater`, called by `ErpApi.write`). Those entries (`durable`) never give up on a missing
 * line: they wait for it (`Status.Waiting`), go one at a time in the order they were made, and send themselves when the connection
 * returns (`Connection.onRegain`), the app comes forward, or the backoff comes round. The ERP records a name once, so a replay
 * is never a second sale. Only a refusal (4xx) stops one: it stays here with its data, said app-wide with Retry, and can be
 * discarded from Waiting to send. (Outbox.swift.) Everything here runs on the main thread, as the shelves do; the sends suspend
 * on the network.
 */
class OutboxEngine(
    private val scope: CoroutineScope,
    private val send: suspend (op: String, fields: Map<String, Any?>, requestId: String) -> Any?,
    /** The business this queue belongs to (its file's name, and what a pending row is filtered by). */
    private val businessId: String = "",
    /** Whether the phone has no line right now: a kept change then says "Waiting to send" without trying. */
    private val isOffline: () -> Boolean = { false },
    /** The write's intent (WriteIntents) is forgotten once the ERP has the change. */
    private val clearIntent: (String) -> Unit = {},
    private val load: () -> String? = { null },
    private val save: (String?) -> Unit = {},
    private val sleep: suspend (Long) -> Unit = { delay(it) },
    private val now: () -> Long = System::currentTimeMillis,
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    enum class Status {
        Saving, Retrying, Failed,

        /** Kept on this phone until the connection is back. */
        Waiting,
    }

    /** What a screen may show: "Saving…" while `pending > 0`, or `status(label)` for one label. */
    data class Item(
        val id: String,
        val label: String,
        val status: Status,
        val message: String = "",
        val isPost: Boolean = false,
        /** A change kept for the line (`queueForLater`): its summary is what the pending row in a list reads. */
        val summary: PendingSummary? = null,
        val business: String = "",
        val createdAt: Long = 0L,
        val durable: Boolean = false,
    )

    /**
     * A change on its way, written to disk (a post is a closure, so it lives only until the app is killed). The optional fields
     * came with the offline queue: a file written before them still reads.
     */
    private class Entry(
        val id: String, val op: String, val fields: Map<String, Any?>, val label: String, var attempts: Int = 0, val createdAt: Long,
        val durable: Boolean = false, val summary: PendingSummary? = null, val intent: String? = null,
        /** The ERP's words when it refused this change: it stays on the phone as refused until the person retries or discards it. */
        var refusal: String? = null,
    )

    private val _items = MutableStateFlow<List<Item>>(emptyList())
    val items: StateFlow<List<Item>> = _items.asStateFlow()

    private val _failure = MutableStateFlow<Item?>(null)
    /** The last thing that failed for good: the banner shows it with Retry. */
    val failure: StateFlow<Item?> = _failure.asStateFlow()

    private val _notices = MutableSharedFlow<String>(extraBufferCapacity = 8)
    /** A post that finished: its words, said once as a toast. */
    val notices: SharedFlow<String> = _notices.asSharedFlow()

    val pending: Int get() = _items.value.count { it.status != Status.Failed }
    fun status(label: String): Status? = _items.value.firstOrNull { it.label == label }?.status

    private val entries = LinkedHashMap<String, Entry>()
    private val posts = HashMap<String, suspend () -> String>()
    private val running = HashSet<String>()
    private var loaded = false
    /** Bumped to cut every wait short (the line is back, the app came forward, Retry): the waiting tasks go now. */
    private var nudge = 0

    /** Changes kept for the line, not yet at the ERP (Waiting to send's count, the offline banner's). */
    val waitingCount: Int get() = _items.value.count { it.status == Status.Waiting }

    /** Kept changes in all, those refused included: the number Waiting to send shows. */
    val keptCount: Int get() = _items.value.count { it.durable }

    /**
     * New orders and sales (or other kinds) that the ERP does not have yet, newest first as the lists show them. Their rows are
     * "Waiting to send" at the top of Orders and Invoices.
     */
    fun records(kind: String): List<Item> =
        _items.value.filter { it.durable && it.summary?.kind == kind }.sortedByDescending { it.createdAt }

    /** The pending payments and advances on an invoice or an order (its page may say "PKR x waiting to send"). */
    fun payments(target: String): List<Item> =
        _items.value.filter { it.durable && it.summary?.target == target && (it.summary?.kind == "payment" || it.summary?.kind == "advance") }

    private fun item(id: String) = _items.value.firstOrNull { it.id == id }

    // MARK: Non-money saves

    /** Queue a change and return. The label is what the person reads if it fails ("Not saved: <label>"). */
    fun enqueue(op: String, fields: Map<String, Any?>, label: String) {
        if (op in moneyOps) {
            // A programming error, not the person's: the money still goes, awaited by nobody, and says if it fails.
            val id = newId()
            scope.launch {
                try { send(op, fields, newId()) } catch (e: CancellationException) { throw e } catch (e: Exception) { fail(id, label, e.message ?: "Not saved.") }
            }
            return
        }
        ensureLoaded()
        // A body JSON cannot hold would never be sent: refuse it here rather than queue it for ever.
        if (JsonText.of(fields) == null) { fail(newId(), label, "That can't be sent."); return }
        val e = Entry(newId(), op, fields, label, createdAt = now())
        entries[e.id] = e
        _items.update { it + Item(e.id, label, Status.Saving, business = businessId, createdAt = e.createdAt) }
        persist()
        run(e.id)
    }

    // MARK: Kept for the line (offline)

    /**
     * Keep a creation or a payment on this phone to be sent when the ERP can be reached, and say so. The entry's id IS the request
     * name, fixed at the first tap, so the same change asked again (a double tap, a retry after the app was killed) is the same
     * entry and, at the ERP, the same record. Written to disk before this returns. The answer has no record in it: `queued` is true.
     */
    fun queueForLater(op: String, fields: Map<String, Any?>, requestId: String, intent: String?, summary: PendingSummary?): Map<String, Any?> {
        ensureLoaded()
        val answer = mapOf<String, Any?>("queued" to true, "requestId" to requestId)
        if (entries.containsKey(requestId)) return answer
        // The moment of the tap travels with it: a payment is dated then (`date`, which the ERP honours), and every kept change
        // carries `clientAt` for the ERP to date its record by.
        val kept = LinkedHashMap(fields)
        val tapped = Instant.ofEpochMilli(now()).toString()
        if (kept["clientAt"] == null) kept["clientAt"] = tapped
        if (op == "recordPayment" && kept["date"] == null) kept["date"] = tapped
        if (JsonText.of(kept) == null) throw ErpApi.Failure(0, "This couldn't be kept for later. Try again when you're online.")
        val s = summary ?: PendingSummary.make(op, fields)
        val e = Entry(requestId, op, kept, s.label, createdAt = now(), durable = true, summary = s, intent = intent)
        entries[e.id] = e
        _items.update {
            it + Item(e.id, s.label, if (isOffline()) Status.Waiting else Status.Saving, summary = s, business = businessId, createdAt = e.createdAt, durable = true)
        }
        persist()
        _notices.tryEmit("${s.label} is saved on this phone and will send when you're back online.")
        run(e.id)
        return answer
    }

    /** Give a kept change up (Waiting to send's Discard, after asking): it is not sent and not kept. */
    fun discard(id: String) {
        if (_failure.value?.id == id) _failure.value = null
        running.remove(id)
        remove(id)
    }

    /** Every wait ends now: the line is back, or the person asked. */
    fun wake() {
        ensureLoaded()
        nudge += 1
        for (i in _items.value.filter { it.status == Status.Waiting || it.status == Status.Retrying }) run(i.id)
    }

    // MARK: Long sends

    /**
     * A website post or any long request: runs now in the background with the same retry policy. The closure returns
     * the words for success ("Posted to 3 places"); a thrown error is "<label> failed: …". Not kept on disk.
     */
    fun post(label: String, request: suspend () -> String) {
        val id = newId()
        posts[id] = request
        _items.update { it + Item(id, label, Status.Saving, isPost = true, business = businessId) }
        run(id)
    }

    // MARK: Retry

    /** Retry the failed one (the banner's button), or every failed one. */
    fun retry(id: String? = null) {
        if (id == null || _failure.value?.id == id) _failure.value = null
        for (i in _items.value.filter { it.status == Status.Failed && (id == null || it.id == id) }) {
            entries[i.id]?.let { it.attempts = 0; it.refusal = null }
            persist()
            set(i.id, Status.Saving)
            run(i.id)
        }
    }

    fun dismissFailure() { _failure.value = null }

    /** Back in front: load what a kill left, and try again what had given up waiting. */
    fun resume() {
        ensureLoaded()
        nudge += 1
        for (i in _items.value) {
            if (i.status == Status.Retrying || i.status == Status.Waiting || (i.status == Status.Saving && i.id !in running)) run(i.id)
        }
    }

    // MARK: Running

    private fun run(id: String) {
        if (entries[id]?.durable == true) { runDurable(id); return }
        if (!running.add(id)) return
        scope.launch {
            var attempt = entries[id]?.attempts ?: 0
            var lostTries = 0
            while (true) {
                if (item(id)?.status == Status.Waiting) set(id, Status.Saving)
                try {
                    val said = attemptOnce(id)
                    finish(id, said)
                    return@launch
                } catch (e: CancellationException) {
                    running.remove(id)
                    throw e
                } catch (e: Exception) {
                    val status = (e as? ErpApi.Failure)?.status ?: 0
                    if (status == 409 && (e as? ErpApi.Failure)?.message?.startsWith("This was already sent") == true) {
                        // "Already recorded": the earlier try of this same named change went through (idempotency.ts's busy answer).
                        finish(id, null)
                        return@launch
                    }
                    // Any other 409 is a refusal and was NOT recorded: a state machine's "can't go from … to …", an order invoiced
                    // meanwhile, not in stock, a stale `from`. It falls to the refusal below, which says the ERP's reason and puts
                    // the screen back as the books have it (the iPhone's Outbox.swift, 2026-11-11).
                    // No line is not a failure: a change waits for it as long as it takes (a named write is the same change however
                    // often it is sent). A post that may have gone out is not repeated; only one that never left.
                    val lost = if (posts.containsKey(id)) Connection.neverLeft(e) else (e is ErpApi.Failure && Connection.lost(e))
                    if (lost) {
                        lostTries += 1
                        set(id, Status.Waiting)
                        pause(waitBackoff(lostTries))
                        if (item(id) == null) { running.remove(id); return@launch }
                        continue
                    }
                    if (!retryAfter(id, e, status, ++attempt)) return@launch
                }
                delay1(id, attempt)
                if (item(id) == null) { running.remove(id); return@launch }
            }
        }
    }

    /** Counts the try; false when it will not be tried again (a refusal, or the last of them): said as failed. */
    private fun retryAfter(id: String, e: Exception, status: Int, attempt: Int): Boolean {
        // 4xx other than a timeout, a rate limit or an expired token is a refusal: no retry will change it.
        val refused = status in 400..499 && status !in listOf(401, 408, 425, 429)
        entries[id]?.let {
            it.attempts = attempt
            // Kept as refused, so the next launch does not send it again: a status move refused this morning must not land by
            // itself this afternoon because its order's invoice was undone meanwhile.
            if (refused) it.refusal = e.message ?: "Not saved."
            persist()
        }
        if (refused || attempt > backoffSeconds.size) {
            running.remove(id)
            fail(id, item(id)?.label ?: "", e.message ?: "Not saved.")
            return false
        }
        set(id, Status.Retrying)
        return true
    }

    private suspend fun delay1(id: String, attempt: Int) = sleep(backoffSeconds[attempt - 1] * 1000)

    // MARK: Running a kept change

    /**
     * A kept creation or payment: one at a time in the order made, waiting for the line without a limit, stopped only by a
     * refusal (4xx), which keeps it here with its data (`refuse`, said app-wide with Retry).
     */
    private fun runDurable(id: String) {
        if (!running.add(id)) return
        scope.launch {
            var lostTries = 0
            var serverTries = 0
            while (true) {
                if (item(id) == null) { running.remove(id); return@launch }
                // The earlier ones first: sales are numbered in the order they were taken.
                if (hasEarlier(id)) { sleep(500); continue }
                // No line at all: it waits for the line to return (which wakes it) rather than asking a network that is not there. A
                // phone that says it is offline while the ERP is in fact reachable (a stale report) is still tried every minute or so.
                if (isOffline() && lostTries < OFFLINE_SKIPS) {
                    set(id, Status.Waiting)
                    lostTries += 1
                    pause(waitBackoff(lostTries))
                    continue
                }
                set(id, if (isOffline()) Status.Waiting else Status.Saving)
                try {
                    val out = attemptDurable(id)
                    finishDurable(id, out)
                    return@launch
                } catch (e: CancellationException) {
                    running.remove(id)
                    throw e
                } catch (e: Exception) {
                    if (item(id) == null) { running.remove(id); return@launch }
                    val said = e as? ErpApi.Failure
                    val status = said?.status ?: 0
                    // The ERP is still recording the earlier try (a timeout whose answer was lost): ask again shortly and it
                    // answers with what it recorded.
                    val busy = status == 409 && (said?.message?.startsWith("This was already sent") == true)
                    if (Connection.lost(e) || busy || status in listOf(401, 408, 425, 429)) {
                        lostTries += 1
                    } else if (status >= 500) {
                        serverTries += 1
                        if (serverTries > 5) { refuse(id, e); return@launch }
                    } else {
                        // A refusal (not in stock any more, a bad request, the app out of date): no retry changes it.
                        refuse(id, e)
                        return@launch
                    }
                    set(id, Status.Waiting)
                    pause(waitBackoff(lostTries + serverTries))
                }
            }
        }
    }

    private fun refuse(id: String, e: Exception) {
        running.remove(id)
        val words = e.message ?: "Not saved."
        entries[id]?.let { it.refusal = words; persist() }
        fail(id, item(id)?.label ?: "", words)
    }

    /** Earlier kept changes that are still to go (a refused one does not hold the rest back). */
    private fun hasEarlier(id: String): Boolean {
        for (e in entries.values) {
            if (e.id == id) return false
            if (e.durable && item(e.id)?.status.let { it != null && it != Status.Failed }) return true
        }
        return false
    }

    private suspend fun attemptDurable(id: String): Map<String, Any?> {
        val e = entries[id] ?: return emptyMap()
        @Suppress("UNCHECKED_CAST")
        return (send(e.op, e.fields, e.id) as? Map<String, Any?>) ?: emptyMap()
    }

    private fun finishDurable(id: String, out: Map<String, Any?>) {
        running.remove(id)
        val e = entries[id] ?: return
        e.intent?.let { clearIntent(it) }
        remove(id)
        if (_failure.value?.id == id) _failure.value = null
        val sent = ((out["order"] as? Map<*, *>)?.get("id") as? String) ?: ((out["invoice"] as? Map<*, *>)?.get("id") as? String)
        val title = when (e.summary?.kind ?: "") {
            "order" -> sent?.let { "Order $it sent" } ?: "Order for ${e.summary?.title ?: ""} sent"
            "invoice" -> sent?.let { "Invoice $it sent" } ?: "Sale to ${e.summary?.title ?: ""} sent"
            else -> (out["said"] as? String)?.takeIf { it.isNotEmpty() } ?: "${e.label} sent"
        }
        _notices.tryEmit(title)
    }

    /** Waits up to `seconds`, less if something wakes the queue (`nudge`). */
    private suspend fun pause(seconds: Long) {
        val seen = nudge
        var left = seconds
        while (left > 0 && nudge == seen) {
            sleep(1000)
            left -= 1
        }
    }

    /** 3, 8, 20, 45 seconds, then every minute: the line coming back wakes it sooner. */
    private fun waitBackoff(tries: Int): Long {
        val steps = listOf(3L, 8L, 20L, 45L)
        return if (tries <= steps.size) steps[maxOf(0, tries - 1)] else 60L
    }

    private suspend fun attemptOnce(id: String): String? {
        posts[id]?.let { return it() }
        val e = entries[id] ?: return null
        send(e.op, e.fields, e.id)
        return null
    }

    private fun finish(id: String, said: String?) {
        running.remove(id)
        remove(id)
        if (!said.isNullOrEmpty()) _notices.tryEmit(said)
        if (_failure.value?.id == id) _failure.value = null
    }

    private fun fail(id: String, label: String, message: String) {
        val list = _items.value
        val at = list.indexOfFirst { it.id == id }
        val item: Item
        if (at >= 0) {
            item = list[at].copy(status = Status.Failed, message = message)
            _items.value = list.toMutableList().also { it[at] = item }
        } else {
            item = Item(id, label, Status.Failed, message, business = businessId)
            _items.value = list + item
        }
        _failure.value = item
    }

    private fun set(id: String, s: Status) = _items.update { l -> l.map { if (it.id == id && it.status != s) it.copy(status = s) else it } }

    private fun remove(id: String) {
        _items.update { l -> l.filterNot { it.id == id } }
        posts.remove(id)
        if (entries.remove(id) != null) persist()
    }

    // MARK: Disk

    private fun persist() {
        val mine = entries.values.sortedBy { it.createdAt }
        if (mine.isEmpty()) { save(null); return }
        save(
            JsonText.of(
                mine.map {
                    val o = LinkedHashMap<String, Any?>()
                    o["id"] = it.id; o["op"] = it.op; o["fields"] = it.fields; o["label"] = it.label
                    o["attempts"] = it.attempts; o["createdAt"] = it.createdAt
                    if (it.durable) o["durable"] = true
                    it.summary?.let { s -> o["summary"] = s.toMap() }
                    it.intent?.let { v -> o["intent"] = v }
                    it.refusal?.let { v -> o["refusal"] = v }
                    o
                },
            ),
        )
    }

    private fun ensureLoaded() {
        if (loaded) return
        loaded = true
        val saved = (load()?.let { Json.parse(it) } as? List<*>).orEmpty()
        for (m in saved) {
            val o = m as? Map<*, *> ?: continue
            val id = o["id"] as? String ?: continue
            val op = o["op"] as? String ?: continue
            @Suppress("UNCHECKED_CAST")
            val fields = o["fields"] as? Map<String, Any?> ?: continue
            if (id in entries) continue
            val label = o["label"] as? String ?: op
            val durable = o["durable"] == true
            val summary = (o["summary"] as? Map<*, *>)?.let { PendingSummary.fromMap(it) }
            val e = Entry(
                id, op, fields, label, (o["attempts"] as? Number)?.toInt() ?: 0, (o["createdAt"] as? Number)?.toLong() ?: now(),
                durable, summary, o["intent"] as? String, o["refusal"] as? String,
            )
            entries[id] = e
            val refusal = e.refusal
            if (refusal != null) {
                // Refused before the app was closed: kept as it was, said again in Waiting to send, not sent at every launch (a
                // kept creation or payment, and since 2026-11-12 a status or piece change too).
                _items.update { it + Item(id, label, Status.Failed, refusal, summary = summary, business = businessId, createdAt = e.createdAt, durable = durable) }
                continue
            }
            _items.update { it + Item(id, label, if (durable) Status.Waiting else Status.Saving, summary = summary, business = businessId, createdAt = e.createdAt, durable = durable) }
            run(id)
        }
    }

    companion object {
        /** ~5 tries over ~2 minutes: now, then after these seconds. */
        val backoffSeconds = listOf(2L, 8L, 25L, 80L)

        /** How many times a kept change lets the phone's own "no network" stand in for a try before it asks anyway. */
        private const val OFFLINE_SKIPS = 5

        /**
         * Every op the ERP records once by name (src/app/api/app/write/idempotency.ts MONEY_OP_NAMES) plus the owner-only
         * money ops of ops-money.ts. `enqueue` refuses these: the person must see the ERP's answer.
         */
        val moneyOps: Set<String> = setOf(
            "recordPayment", "recordOrderAdvance", "createInvoice", "createOrder", "finalizeOrder",
            "addRepair", "recordRepairPayment", "addExpense",
            "addHisaabEntry", "addShareholderEntry", "addExtraRevenue",
            "updateInvoiceDiscount", "refundInvoicePartial", "payBackCredit", "settleInvoicePayment", "settleOrderAdvance", "raiseOrderDiscount",
            "startPayBatch", "settlePayBatch",
            "saveOverheadPlan", "deleteShareholderEntry", "deletePartnerSalary", "setWorkingCapitalFloor",
            "restoreRemoved", "purgeRemoved",
        )

        /**
         * What may wait for the line when `ErpApi.write` cannot reach the ERP: creations and payments (the ERP records these once
         * by name, so a replay is safe), and the edits whose callers never read an answer. Deletes, refunds, settlements,
         * finalizing and the owner-only money settings are never here: they say "Needs a connection".
         */
        val queueableOps: Set<String> = setOf(
            "createOrder", "createInvoice", "recordPayment", "recordOrderAdvance",
            "addRepair", "recordRepairPayment", "addExpense", "addHisaabEntry", "addShareholderEntry", "addExtraRevenue",
            "updateOrder", "updateRepair", "setRepairStatus", "updateExpense", "updateExtraRevenue",
        )
    }
}

/**
 * The Outbox of each business, over its own file and its own `ErpApi.write` (Outbox in Outbox.swift, one per business here:
 * a save that is on its way when the person switches business is finished for the business it was made in, to that business's
 * server with that business's token, and what a kill leaves is found again in that business's file). The functions below are the
 * open business's; a screen only ever sees its own business's saves and failures.
 */
object Outbox {
    private val engines = HashMap<String, OutboxEngine>()

    init {
        // The line is back: whatever was waiting goes now, not at the end of its backoff.
        Connection.onRegain { ErpApp.scope.launch { wakeAll() } }
    }

    /** Makes the Outbox exist at launch, so the line coming back wakes what was kept (ErpApp). */
    fun start() = Unit

    @Synchronized
    fun of(b: Business): OutboxEngine = engines.getOrPut(b.id) {
        OutboxEngine(
            scope = ErpApp.scope,
            // This is the queue itself: a change that cannot go waits here, it is never queued a second time.
            send = { op, fields, id -> ErpApi.forBusiness(b).write(op, fields, requestId = id, queueOffline = false) },
            businessId = b.id,
            isOffline = { Connection.isOffline.value },
            clearIntent = { WriteIntents.forBusiness(b.id).clear(it) },
            load = { OutboxDisk.read(OutboxDisk.file("outbox", b.id)) },
            save = { OutboxDisk.write(OutboxDisk.file("outbox", b.id), it) },
        )
    }

    /** A business was removed: its queue is dropped with its file. */
    @Synchronized
    fun drop(id: String) { engines.remove(id) }

    val engine: OutboxEngine get() = of(Businesses.current)

    val failure get() = engine.failure
    val items get() = engine.items
    val notices get() = engine.notices

    fun enqueue(op: String, fields: Map<String, Any?>, label: String) = engine.enqueue(op, fields, label)
    fun post(label: String, request: suspend () -> String) = engine.post(label, request)
    fun retry(id: String? = null) = engine.retry(id)
    fun discard(id: String) = engine.discard(id)
    fun dismissFailure() = engine.dismissFailure()
    fun status(label: String) = engine.status(label)

    /** Every business the phone has has its own queue; each is woken, whichever is open. */
    private fun wakeAll() {
        // The drafts the phone could not send or remove while the line was gone.
        WorkDraftSync.resumeAll()
        engine.wake()
        for (b in Businesses.list.value) if (b.id != Businesses.current.id && OutboxDisk.has("outbox", b.id)) of(b).wake()
    }

    fun resume() {
        engine.resume()
        // What another business left on its way (a switch, a kill) is sent to its own server now, not when it is next opened.
        for (b in Businesses.list.value) if (b.id != Businesses.current.id && OutboxDisk.has("outbox", b.id)) of(b).resume()
    }

    private var lastWarm = 0L

    /** The first real tap should not pay a cold start: a cheap read of /api/app/me, at most once a minute. */
    fun warm() {
        val t = System.currentTimeMillis()
        if (House.isDemo || t - lastWarm < 60_000) return
        lastWarm = t
        val api = ErpApi.shared
        ErpApp.scope.launch(Dispatchers.IO) { runCatching { api.data("/api/app/me", timeoutMs = 10_000) } }
    }
}
