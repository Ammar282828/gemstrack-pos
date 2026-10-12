package erp.app.screens.sale

import erp.app.config.Prefs
import erp.app.data.JsonText
import erp.core.Json
import erp.core.entry.NewOrderDraftStore
import erp.core.entry.SaleDraft
import erp.core.entry.SaleDraftStore
import erp.core.entry.SaleScanHeld
import erp.core.models.Product

/**
 * Where this phone keeps the sale in progress, the order made from it and the rates a written bill set
 * (the iPhone's UserDefaults "erp.saleDraft", "erp.orderDraft", "erp.saleBillRates"). core encodes and decodes the
 * text; keeping it is the app's business, here as in Prefs.
 */
object SaleStore {
    /** This phone's unfinished sale, if it has one worth keeping. */
    fun load(): SaleDraft? = Prefs.string(SaleDraftStore.key)?.let { SaleDraftStore.decode(it) }

    /** A blank sale is not kept: what is there goes. */
    fun save(draft: SaleDraft) = Prefs.putString(SaleDraftStore.key, SaleDraftStore.encode(draft))

    fun clear() = Prefs.remove(SaleDraftStore.key)

    /** Puts a piece on the unfinished sale (a new one if there is none). False when it is already there. */
    fun add(product: Product): Boolean {
        val d = load() ?: SaleDraft()
        if (!d.add(product)) return false
        save(d)
        return true
    }

    /** Seeds the phone's order draft from the sale; it replaces an order in progress, so ask first ([orderInProgress]). */
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
