package erp.app.screens.sale

import erp.app.config.Prefs
import erp.app.data.JsonText
import erp.core.Json
import erp.core.entry.NewOrderDraftStore
import erp.core.entry.SaleDraft
import erp.core.entry.SaleDraftStore
import erp.core.entry.SaleScanHeld
import erp.core.models.Product
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Where this phone keeps the sale in progress, the order made from it and the rates a written bill set
 * (the iPhone's UserDefaults "erp.saleDraft", "erp.orderDraft", "erp.saleBillRates"). core encodes and decodes the
 * text; keeping it is the app's business, here as in Prefs.
 */
object SaleStore {
    private val lock = Any()
    private class Waiting(val draft: SaleDraft, val gen: Long, val business: String?)
    private val waiting = HashMap<String, Waiting>()
    private var generation = 0L

    private fun slot(business: String?): String = business ?: Prefs.scope()

    /** This phone's unfinished sale, if it has one worth keeping. A change still waiting to be kept is kept first. */
    fun load(business: String? = null): SaleDraft? {
        flush(business)
        return Prefs.string(SaleDraftStore.key, business)?.let { SaleDraftStore.decode(it) }
    }

    /** A blank sale is not kept: what is there goes. `business` is the one a screen was opened in. */
    fun save(draft: SaleDraft, business: String? = null) {
        synchronized(lock) {
            waiting.remove(slot(business))
            Prefs.putString(SaleDraftStore.key, SaleDraftStore.encode(draft), business)
        }
    }

    /**
     * Keeps the sale 300 ms after the last change, encoded off the main thread (the form saves at every key): a newer change
     * replaces the one waiting. The draft handed over must not be changed afterwards, so the screen hands a copy.
     */
    fun saveSoon(draft: SaleDraft, business: String? = null) {
        val k = slot(business)
        val gen: Long
        synchronized(lock) { gen = ++generation; waiting[k] = Waiting(draft, gen, business) }
        erp.app.ErpApp.scope.launch(Dispatchers.Default) {
            delay(300)
            val text = SaleDraftStore.encode(draft)
            synchronized(lock) {
                if (waiting[k]?.gen != gen) return@synchronized
                waiting.remove(k)
                Prefs.putString(SaleDraftStore.key, text, business)
            }
        }
    }

    /** Writes the change still waiting, now (the screen or the app is going; every read does it first). */
    fun flush(business: String? = null) {
        synchronized(lock) {
            val w = waiting.remove(slot(business)) ?: return
            Prefs.putString(SaleDraftStore.key, SaleDraftStore.encode(w.draft), w.business)
        }
    }

    fun clear(business: String? = null) {
        synchronized(lock) {
            waiting.remove(slot(business))
            Prefs.remove(SaleDraftStore.key, business)
        }
    }

    /**
     * Puts a piece on the unfinished sale (a new one if there is none). False when it is already there. The caller opens
     * the sale with `?resume=1` ([SaleLinks.continueSale]): a New sale otherwise starts blank.
     */
    fun add(product: Product): Boolean {
        val d = load() ?: SaleDraft()
        if (!d.add(product)) return false
        save(d)
        return true
    }

    /** Seeds the phone's order draft from the sale (the order opens on it, `?resume=1`); release an order in progress to Drafts first. */
    fun startOrderFrom(sale: SaleDraft) {
        Prefs.putString(NewOrderDraftStore.key, NewOrderDraftStore.startFromSale(sale))
    }

    /** An order of its own is half typed on this phone (not one already made from a sale). */
    fun orderInProgress(): Boolean = NewOrderDraftStore.orderInProgress(Prefs.string(NewOrderDraftStore.key))

    // The bill's rates

    /** The boxes a written bill set on this sale, with the figure it set. */
    fun heldRates(): Map<String, String> {
        val m = Prefs.string(SaleScanHeld.key)?.let { Json.parse(it) } as? Map<*, *> ?: return emptyMap()
        val out = LinkedHashMap<String, String>()
        for ((k, v) in m) if (k is String && v is String) out[k] = v
        return out
    }

    fun hold(set: Map<String, String>, before: SaleDraft) {
        val kept = SaleScanHeld.hold(set, before, heldRates())
        Prefs.putString(SaleScanHeld.key, JsonText.of(kept, sorted = true))
    }

    /** The rates to write back, less every box still holding a bill's figure. */
    fun unheld(kept: Map<String, Double>?, draft: SaleDraft): Map<String, Double>? =
        SaleScanHeld.unheld(kept, draft, heldRates())
}
