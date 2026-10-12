package erp.app.data

import erp.app.ErpApp
import erp.app.config.House
import erp.core.Decodable
import erp.core.Registry
import erp.core.models.AdditionalRevenue
import erp.core.models.Collections
import erp.core.models.Customer
import erp.core.models.Expense
import erp.core.models.GivenItem
import erp.core.models.HisaabEntry
import erp.core.models.Invoice
import erp.core.models.Karigar
import erp.core.models.KarigarBatch
import erp.core.models.KarigarJob
import erp.core.models.Order
import erp.core.models.Product
import erp.core.models.Repair
import erp.core.models.Settings
import java.math.BigInteger
import java.text.Collator
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The shop's books on the phone: one shelf per Firestore collection, kept live.
 *
 * Where a shelf fills from depends on who is signed in, exactly as the web store decides
 * (store.ts `readsThroughServer`):
 * - an owner reads Firestore itself, live, with the phone's own copy for opening offline;
 * - staff and marketing have no Firestore access (firestore.rules): their shelves come from the
 *   ERP's server (/api/staff/collections), which strips the cost side, every 25 seconds;
 * - the demo (intent extra `erp.demo`) reads made-up documents from the app (assets/demo.json).
 *
 * A shelf is read only once a screen asks for it (`need()`), so nobody pays for a collection
 * they never open. Reads only: every write goes through the ERP's server (CONVENTIONS.md rule 1),
 * and the change comes back down the shelf like anyone else's. Everything here runs on the main thread;
 * the sources decode elsewhere and hand over on it.
 */
class Book private constructor() {
    enum class Source { Firestore, Server, Demo }

    @Volatile var source: Source = if (House.isDemo) Source.Demo else Source.Firestore
        private set

    val orders = shelf<Order>(Collections.orders, { it.id }, Sort.descending { it.createdAt })
    val invoices = shelf<Invoice>(Collections.invoices, { it.id }, Sort.descending { it.createdAt })
    val customers = shelf<Customer>(Collections.customers, { it.id }, Sort.byName { it.name })
    val karigars = shelf<Karigar>(Collections.karigars, { it.id }, Sort.byName { it.name })
    val hisaab = shelf<HisaabEntry>(Collections.hisaab, { it.id }, Sort.descending { it.date })
    val expenses = shelf<Expense>(Collections.expenses, { it.id }, Sort.descending { it.date })
    val revenue = shelf<AdditionalRevenue>(Collections.additionalRevenue, { it.id }, Sort.descending { it.date })
    val products = shelf<Product>(Collections.products, { it.sku }, Sort.standard { it.sku })
    val repairs = shelf<Repair>(Collections.repairs, { it.id }, Sort.descending { it.receivedAt })
    val givenItems = shelf<GivenItem>(Collections.givenItems, { it.id }, Sort.descending { it.date })
    val karigarJobs = shelf<KarigarJob>(Collections.karigarJobs, { it.id }, Sort.descending { it.id })
    val karigarBatches = shelf<KarigarBatch>(Collections.karigarBatches, { it.id }, Sort.descending { it.startDate })
    val settings = Single(Collections.settings, Collections.globalSettingsDoc, Registry.decoder(Settings::class), this)

    private val all: List<Resettable> =
        listOf(orders, invoices, customers, karigars, hisaab, expenses, revenue, products, repairs, givenItems, karigarJobs, karigarBatches, settings)

    private inline fun <reified T : Any> shelf(name: String, noinline id: (T) -> String, sort: Comparator<T>) =
        Shelf(name, Registry.decoder(T::class), id, sort, this)

    /** Who is reading, once the ERP has said (Session.loadMe). Shelves already filled for someone else start again. */
    fun signedIn(role: String) {
        val next = if (House.isDemo) Source.Demo else if (role == "owner") Source.Firestore else Source.Server
        if (next != source) all.forEach { it.reset() }
        source = next
    }

    fun signedOut() = all.forEach { it.reset() }

    /**
     * Where a shelf's documents come from; the shelf calls it on its first `need()` and keeps the returned
     * stop for `reset()`. `deliver` is called on the main thread.
     */
    fun <T : Any> attach(name: String, model: Decodable<T>, docId: String?, deliver: (Delivery<T>) -> Unit): () -> Unit = when (source) {
        Source.Demo -> {
            // Decoded off the main thread, as the owners' Firestore answers are.
            val job = ErpApp.scope.launch {
                val items = withContext(Dispatchers.Default) {
                    val docs = Demo.docs(name)
                    if (docId != null) docs.filter { it["id"] == docId }.map { decodeDoc(model, docId, it) }
                    else docs.map { decodeDoc(model, it["id"] as? String ?: "", it) }
                }
                deliver(Delivery.All(items, offline = false))
            }
            ({ job.cancel() })
        }
        Source.Server -> ServerShelf.poll(if (name == Collections.settings) "settings" else name, docId != null, model, deliver)
        Source.Firestore -> FirestoreSource.listen(name, model, docId, deliver)
    }

    companion object {
        val shared: Book by lazy { Book() }

        /** A document as a model: its id is the document's (as store.ts does, `{ ...doc.data(), id: doc.id }`). */
        fun <T : Any> decodeDoc(model: Decodable<T>, id: String, data: Map<String, Any?>, custom: (Any) -> Any? = { null }): T {
            @Suppress("UNCHECKED_CAST")
            val plain = (erp.core.DocJSON.plain(data, custom) as? Map<String, Any?>) ?: emptyMap()
            val m = LinkedHashMap(plain)
            m["id"] = id
            return model.fromMap(m)
        }
    }
}

/** What a source hands a shelf. */
sealed interface Delivery<out T> {
    /** Everything there is (a first answer, a poll, the demo). */
    data class All<T>(val items: List<T>, val offline: Boolean) : Delivery<T>

    /** What changed since the last answer (Firestore's document changes). */
    data class Changes<T>(val upserts: List<T>, val removed: List<String>, val offline: Boolean) : Delivery<T>

    data class Failed(val message: String) : Delivery<Nothing>
}

interface Resettable { fun reset() }

/** One collection, live, sorted for its screens. */
class Shelf<T : Any>(
    val name: String,
    private val model: Decodable<T>,
    private val idOf: (T) -> String,
    private val before: Comparator<T>,
    private val book: Book? = Book.shared,
) : Resettable {
    private val _items = MutableStateFlow<List<T>>(emptyList())
    val items: StateFlow<List<T>> = _items.asStateFlow()
    private val _loaded = MutableStateFlow(false)
    val loaded: StateFlow<Boolean> = _loaded.asStateFlow()

    /** The last answer came from the phone's cache; this alone does not mean the network is offline. */
    private val _offline = MutableStateFlow(false)
    val offline: StateFlow<Boolean> = _offline.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    /**
     * Goes up on every change to the items: a screen keys what it works out from them on this (remember(revision)),
     * so a figure is reckoned once per change of the books, not once per drawing of the screen.
     */
    private val _revision = MutableStateFlow(0)
    val revision: StateFlow<Int> = _revision.asStateFlow()

    private var byId = LinkedHashMap<String, T>()
    private var stop: (() -> Unit)? = null

    /** Start filling, once. Every screen that shows this collection calls it (rememberShelf does). */
    fun need() {
        if (stop != null) return
        val b = book ?: return
        stop = b.attach(name, model, null) { take(it) }
    }

    /** One document by id. Read `items` too so a screen showing one document recomposes when it changes. */
    fun item(id: String): T? = byId[id]

    override fun reset() {
        stop?.invoke()
        stop = null
        byId = LinkedHashMap()
        _items.value = emptyList()
        _revision.value += 1
        _loaded.value = false
        _offline.value = false
        _error.value = null
    }

    /** Main thread. */
    fun take(d: Delivery<T>) {
        when (d) {
            is Delivery.All -> {
                byId = LinkedHashMap<String, T>().also { m -> d.items.forEach { m.putIfAbsent(idOf(it), it) } }
                publish(d.offline)
            }
            is Delivery.Changes -> {
                // Only the cache flag moved (Firestore's metadata change): no new books, so nothing re-reckoned.
                if (d.upserts.isEmpty() && d.removed.isEmpty()) { _offline.value = d.offline; return }
                val next = LinkedHashMap(byId)
                for (x in d.upserts) next[idOf(x)] = x
                for (id in d.removed) next.remove(id)
                byId = next
                // A handful of documents changed (a payment, a status): placed where they sort, rather than
                // sorting the whole collection again on the main thread.
                if (_loaded.value && d.upserts.size + d.removed.size <= 32) {
                    val gone = d.upserts.mapTo(HashSet()) { idOf(it) }.apply { addAll(d.removed) }
                    val list = _items.value.filterTo(ArrayList()) { idOf(it) !in gone }
                    for (x in d.upserts) {
                        var lo = 0
                        var hi = list.size
                        while (lo < hi) {
                            val mid = (lo + hi) / 2
                            if (before.compare(list[mid], x) < 0) lo = mid + 1 else hi = mid
                        }
                        list.add(lo, x)
                    }
                    _items.value = list
                    _revision.value += 1
                    _offline.value = d.offline
                    _error.value = null
                } else {
                    publish(d.offline)
                }
            }
            is Delivery.Failed -> {
                // Keep what is on screen: a dropped connection is no reason to blank the list being read.
                _error.value = d.message
                _loaded.value = true
            }
        }
    }

    private fun publish(off: Boolean) {
        _items.value = byId.values.sortedWith(before)
        _revision.value += 1
        _offline.value = off
        _loaded.value = true
        _error.value = null
    }
}

/** One document, live (the shop's settings: its rates and switches). */
class Single<T : Any>(
    val collection: String,
    val docId: String,
    private val model: Decodable<T>,
    private val book: Book? = null,
) : Resettable {
    private val _value = MutableStateFlow<T?>(null)
    val value: StateFlow<T?> = _value.asStateFlow()
    private val _loaded = MutableStateFlow(false)
    val loaded: StateFlow<Boolean> = _loaded.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()
    private var stop: (() -> Unit)? = null

    fun need() {
        if (stop != null) return
        val b = book ?: Book.shared
        stop = b.attach(collection, model, docId) { take(it) }
    }

    fun take(d: Delivery<T>) {
        when (d) {
            is Delivery.All -> { _value.value = d.items.firstOrNull() ?: _value.value; _loaded.value = true; _error.value = null }
            is Delivery.Changes -> { _value.value = d.upserts.firstOrNull() ?: _value.value; _loaded.value = true; _error.value = null }
            is Delivery.Failed -> { _error.value = d.message; _loaded.value = true }
        }
    }

    override fun reset() {
        stop?.invoke()
        stop = null
        _value.value = null
        _loaded.value = false
        _error.value = null
    }
}

/** The shelves' orders, as Swift's `localizedCaseInsensitiveCompare` and `localizedStandardCompare` have them. */
object Sort {
    fun <T> descending(key: (T) -> String): Comparator<T> = Comparator { a, b -> key(b).compareTo(key(a)) }

    private val collator: Collator = Collator.getInstance(Locale.ENGLISH).apply { strength = Collator.SECONDARY }

    /** Names, a before b, ignoring case. */
    fun <T> byName(key: (T) -> String): Comparator<T> = Comparator { a, b -> collator.compare(key(a), key(b)) }

    /** Like Finder: digits are numbers ("SKU-2" before "SKU-10"), case ignored. */
    fun <T> standard(key: (T) -> String): Comparator<T> = Comparator { a, b -> standardCompare(key(a), key(b)) }

    private val chunks = Regex("""\d+|\D+""")

    fun standardCompare(a: String, b: String): Int {
        val x = chunks.findAll(a).map { it.value }.toList()
        val y = chunks.findAll(b).map { it.value }.toList()
        for (i in 0 until minOf(x.size, y.size)) {
            val p = x[i]
            val q = y[i]
            val c = if (p[0].isDigit() && q[0].isDigit()) BigInteger(p).compareTo(BigInteger(q)) else collator.compare(p, q)
            if (c != 0) return c
        }
        return x.size.compareTo(y.size)
    }
}
