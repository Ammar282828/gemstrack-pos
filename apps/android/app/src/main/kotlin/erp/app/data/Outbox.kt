package erp.app.data

import erp.app.ErpApp
import erp.app.config.Business
import erp.app.config.Businesses
import erp.app.config.House
import erp.core.Json
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
 * failure is said app-wide with Retry (OutboxHost). Money writes are never queued: they stay awaited (CONVENTIONS.md).
 * (Outbox.swift.) Everything here runs on the main thread, as the shelves do; the sends suspend on the network.
 */
class OutboxEngine(
    private val scope: CoroutineScope,
    private val send: suspend (op: String, fields: Map<String, Any?>, requestId: String) -> Unit,
    private val load: () -> String? = { null },
    private val save: (String?) -> Unit = {},
    private val sleep: suspend (Long) -> Unit = { delay(it) },
    private val now: () -> Long = System::currentTimeMillis,
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    enum class Status { Saving, Retrying, Failed }

    /** What a screen may show: "Saving…" while `pending > 0`, or `status(label)` for one label. */
    data class Item(val id: String, val label: String, val status: Status, val message: String = "", val isPost: Boolean = false)

    /** A change on its way, written to disk (a post is a closure, so it lives only until the app is killed). */
    private class Entry(val id: String, val op: String, val fields: Map<String, Any?>, val label: String, var attempts: Int = 0, val createdAt: Long)

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
        _items.update { it + Item(e.id, label, Status.Saving) }
        persist()
        run(e.id)
    }

    // MARK: Long sends

    /**
     * A website post or any long request: runs now in the background with the same retry policy. The closure returns
     * the words for success ("Posted to 3 places"); a thrown error is "<label> failed: …". Not kept on disk.
     */
    fun post(label: String, request: suspend () -> String) {
        val id = newId()
        posts[id] = request
        _items.update { it + Item(id, label, Status.Saving, isPost = true) }
        run(id)
    }

    // MARK: Retry

    /** Retry the failed one (the banner's button), or every failed one. */
    fun retry(id: String? = null) {
        if (id == null || _failure.value?.id == id) _failure.value = null
        for (i in _items.value.filter { it.status == Status.Failed && (id == null || it.id == id) }) {
            entries[i.id]?.attempts = 0
            set(i.id, Status.Saving)
            run(i.id)
        }
    }

    fun dismissFailure() { _failure.value = null }

    /** Back in front: load what a kill left, and try again what had given up waiting. */
    fun resume() {
        ensureLoaded()
        for (i in _items.value) if (i.status == Status.Retrying || (i.status == Status.Saving && i.id !in running)) run(i.id)
    }

    // MARK: Running

    private fun run(id: String) {
        if (!running.add(id)) return
        scope.launch {
            var attempt = entries[id]?.attempts ?: 0
            while (true) {
                try {
                    val said = attemptOnce(id)
                    finish(id, said)
                    return@launch
                } catch (e: CancellationException) {
                    running.remove(id)
                    throw e
                } catch (e: ErpApi.Failure) {
                    if (e.status == 409) {
                        // "Already recorded": the earlier try went through.
                        finish(id, null)
                        return@launch
                    }
                    if (!retryAfter(id, e, e.status, ++attempt)) return@launch
                } catch (e: Exception) {
                    if (!retryAfter(id, e, 0, ++attempt)) return@launch
                }
                delay1(id, attempt)
                if (_items.value.none { it.id == id }) { running.remove(id); return@launch }
            }
        }
    }

    /** Counts the try; false when it will not be tried again (a refusal, or the last of them): said as failed. */
    private fun retryAfter(id: String, e: Exception, status: Int, attempt: Int): Boolean {
        // 4xx other than a timeout, a rate limit or an expired token is a refusal: no retry will change it.
        val refused = status in 400..499 && status !in listOf(401, 408, 425, 429)
        entries[id]?.let { it.attempts = attempt; persist() }
        if (refused || attempt > backoffSeconds.size) {
            running.remove(id)
            fail(id, _items.value.firstOrNull { it.id == id }?.label ?: "", e.message ?: "Not saved.")
            return false
        }
        set(id, Status.Retrying)
        return true
    }

    private suspend fun delay1(id: String, attempt: Int) = sleep(backoffSeconds[attempt - 1] * 1000)

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
            item = Item(id, label, Status.Failed, message)
            _items.value = list + item
        }
        _failure.value = item
    }

    private fun set(id: String, s: Status) = _items.update { l -> l.map { if (it.id == id) it.copy(status = s) else it } }

    private fun remove(id: String) {
        _items.update { l -> l.filterNot { it.id == id } }
        posts.remove(id)
        if (entries.remove(id) != null) persist()
    }

    // MARK: Disk

    private fun persist() {
        val mine = entries.values.sortedBy { it.createdAt }
        if (mine.isEmpty()) { save(null); return }
        save(JsonText.of(mine.map { mapOf("id" to it.id, "op" to it.op, "fields" to it.fields, "label" to it.label, "attempts" to it.attempts, "createdAt" to it.createdAt) }))
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
            val e = Entry(id, op, fields, label, (o["attempts"] as? Number)?.toInt() ?: 0, (o["createdAt"] as? Number)?.toLong() ?: now())
            entries[id] = e
            _items.update { it + Item(id, label, Status.Saving) }
            run(id)
        }
    }

    companion object {
        /** ~5 tries over ~2 minutes: now, then after these seconds. */
        val backoffSeconds = listOf(2L, 8L, 25L, 80L)

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

    @Synchronized
    fun of(b: Business): OutboxEngine = engines.getOrPut(b.id) {
        OutboxEngine(
            scope = ErpApp.scope,
            send = { op, fields, id -> ErpApi.forBusiness(b).write(op, fields, requestId = id) },
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
    fun dismissFailure() = engine.dismissFailure()
    fun status(label: String) = engine.status(label)
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
