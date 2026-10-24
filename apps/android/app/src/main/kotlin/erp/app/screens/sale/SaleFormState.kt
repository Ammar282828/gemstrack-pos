package erp.app.screens.sale

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import erp.app.ErpApp
import erp.app.data.Book
import erp.app.data.ErpApi
import erp.app.data.WorkDraftSync
import erp.app.ui.EntryStep
import erp.core.entry.EntryHouse
import erp.core.entry.SaleDraft
import erp.core.entry.SaleDraftStore
import erp.core.entry.SaleEdit
import erp.core.entry.SaleFigures
import erp.core.entry.SaleLine
import erp.core.entry.SaleLookup
import erp.core.entry.TagCode
import erp.core.entry.editPayload
import erp.core.entry.payload
import erp.core.entry.ratesToWriteBack
import erp.core.entry.webValues
import erp.core.models.Customer
import erp.core.models.Product
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * New sale's state and what it does (the `@State` and the methods of the iPhone's `SaleForm`): the draft, the
 * step, the sheets, and Save. A sale is rules (core's SaleDraft / SaleFigures) and this is only the screen's side
 * of it. An unfinished sale is kept on this phone (SaleStore) and in the ERP's Drafts (WorkDraftSync, SaleWebDraft)
 * in the sale page's own shape, so the counter can finish it; "Start over" empties both.
 *
 * [edit] is Edit invoice (SaleEdit): the invoice on file in this form. Nothing is kept on the phone or in Drafts,
 * there is no starting over, and Save writes the invoice under its own number.
 */
class SaleFormState(
    private val book: Book,
    val edit: SaleEdit?,
    /** This account's counter name, which Taken by starts on (decisions.md "Signed-in defaults"). */
    private val defaultTaker: String,
    /** The AI bill reader opens over the form when it first shows (NewSale.readsBill). */
    private val startsReading: Boolean,
    /** The ERP page for a path ("/orders/add"). */
    private val open: (String) -> Unit,
    /** Leave this screen (an edit that saved). */
    private val leave: () -> Unit,
) {
    init {
        // core knows no BuildConfig: the house is told once, before any rule reads it.
        EntryHouse.id = erp.app.config.House.id
    }

    var draft by mutableStateOf(SaleDraft())
        private set
    var query by mutableStateOf("")
    var notice by mutableStateOf<String?>(null)
    var editing by mutableStateOf<SaleLine?>(null)

    /** A piece being described that is not on the sale yet. */
    var newItem by mutableStateOf<SaleLine?>(null)
    var step by mutableStateOf(EntryStep.customer)

    /** Change rate: the rates lead the Pieces step instead of following it. */
    var ratesFirst = false
    var scanning by mutableStateOf(false)
    var rateSheet by mutableStateOf(false)
    var confirmingReset by mutableStateOf(false)
    var confirmingOrder by mutableStateOf(false)
    var saving by mutableStateOf(false)
    var failure by mutableStateOf<String?>(null)
    var goneSkus by mutableStateOf<List<String>>(emptyList())

    /** The server refused a piece described for this bill because it was sold already: the sale was saved before. */
    var alreadySold by mutableStateOf(false)

    /** The invoice just saved: the screen is replaced by it. */
    var made by mutableStateOf<String?>(null)

    /** Exchange rows whose weight and rate are open. */
    var openedExchange by mutableStateOf<Set<String>>(emptySet())
    var marginShown by mutableStateOf(false)

    /** The rates typed on the sale, sent back to the shop's after the sale saved, did not go: said quietly. */
    var ratesNote by mutableStateOf<String?>(null)
    var readingBill by mutableStateOf(false)

    private var readerOpened = false
    private var editLoaded = false
    private var takenByStarted = false

    /** Changes the draft and keeps it: on the phone, and in Drafts a moment later. An edit is never kept. */
    fun replaceDraft(d: SaleDraft) {
        draft = d
        // An edit is never kept on the phone or in Drafts: the invoice on file is the copy.
        if (edit != null) return
        SaleStore.save(d)
        sync(d)
    }

    /** `draft.<change>`: the draft with that change made, as a new value so the screen sees it. */
    fun update(change: (SaleDraft) -> Unit) {
        val d = draft.copy()
        change(d)
        replaceDraft(d)
    }

    /** Every time the screen shows: this phone's unfinished sale is read, and a brand-new one starts Taken by on the signed-in person, once. */
    fun appeared() {
        if (edit != null) {
            if (!editLoaded) {
                replaceDraft(edit.draft)
                editLoaded = true
            }
            return
        }
        val stored = SaleStore.load()
        if (stored != null) {
            // A sale begun from Scan a tag has no Taken by yet: it starts on the signed-in person, as every new one.
            if (stored.takenBy.isEmpty() && !takenByStarted) stored.takenBy = defaultTaker
            if (SaleDraftStore.encode(stored) != SaleDraftStore.encode(draft)) replaceDraft(stored)
            if (!stored.isBlank) ErpApp.scope.launch { stillOurs() }
        } else if (!draft.isBlank) {
            val fresh = SaleDraft()
            fresh.takenBy = defaultTaker
            replaceDraft(fresh)
        } else if (!takenByStarted) {
            update { it.takenBy = defaultTaker }
        }
        takenByStarted = true
        if (startsReading && !readerOpened) {
            readerOpened = true
            readingBill = true
        }
    }

    /**
     * The sale in Drafts as the web's sale page holds it, a moment after the last change (`now` as the screen goes), so
     * it can be finished at the counter (WorkDraftSync).
     */
    fun sync(d: SaleDraft, now: Boolean = false) {
        val settings = book.settings.value.value
        val customers = book.customers.items.value
        WorkDraftSync.sale.push(blank = d.isBlank, enabled = settings?.autoDraftForms ?: true, now = now) {
            val subtotal = SaleFigures(d, settings, customers, EntryHouse.margin).subtotal
            WorkDraftSync.Snapshot(d.webValues(subtotal), subtotal, d.customerName)
        }
    }

    /** The screen is going: a change still waiting to be sent goes now. */
    fun disappeared() {
        if (made == null && edit == null) sync(draft, now = true)
    }

    /**
     * The sale kept on this phone is in Drafts too: one invoiced or thrown away at the counter since is not this phone's
     * to bill a second time, so it goes from here as well.
     */
    private suspend fun stillOurs() {
        if (WorkDraftSync.sale.stillThere() != false || made != null) return
        SaleStore.clear()
        WorkDraftSync.sale.forget()
        startOver()
        failure = "The sale kept on this phone was invoiced or discarded from Drafts on another device, so it is cleared here. Look for it under Invoices."
    }

    // MARK: Actions

    fun pickCustomer(c: Customer?) = update { it.pick(c) }

    fun replace(sku: String, with: SaleLine) = update { d ->
        val i = d.lines.indexOfFirst { it.sku == sku }
        if (i >= 0) d.lines[i] = with
    }

    fun remove(sku: String) = update { d -> d.lines.removeAll { it.sku == sku } }

    fun add(p: Product) {
        if (draft.lines.any { it.sku == p.sku }) {
            notice = "${p.name} is already on this sale."
            return
        }
        update { it.lines.add(SaleLine.fromProduct(p)) }
        query = ""
        notice = null
    }

    /**
     * Return in the search box: the piece typed exactly, else the only one the search found. Nothing found is a piece
     * that was never in inventory: the web opens a new item with what was typed as its name, so it can be billed
     * directly (handleAddBySku). A SKU that was sold is said so instead.
     */
    fun addTyped() {
        val typed = query.trim()
        if (typed.isEmpty()) return
        val products = book.products.items.value
        val p = SaleLookup.find(typed, products)
        if (p != null) {
            add(p)
            return
        }
        val found = SaleLookup.matches(typed, products, draft.lines.map { it.sku }.toSet())
        if (found.size == 1) {
            add(found[0])
        } else if (found.isEmpty()) {
            val inv = SaleLookup.soldOn(typed, book.invoices.items.value)
            if (inv != null) {
                notice = "$typed was sold on ${inv.id}."
            } else {
                startNewItem(typed)
                query = ""
            }
        }
    }

    /** "New item": a blank piece to describe (edit-cart-item-dialog.tsx `blankCartItem`), added to the sale when it is saved from the sheet. */
    fun startNewItem(named: String = "") {
        val line = SaleLine.blankFor(erp.app.config.House.metal, SaleLine.newItemSku(avoiding = draft.lines.map { it.sku }.toSet()))
        line.name = named
        newItem = line
    }

    fun addNew(line: SaleLine) {
        if (draft.lines.none { it.sku == line.sku }) update { it.lines.add(line) }
    }

    private fun notInStock(sku: String): String {
        val inv = SaleLookup.soldOn(sku, book.invoices.items.value)
        return if (inv != null) "$sku was sold on ${inv.id}." else "No piece $sku in stock."
    }

    /** A tag read by the camera or typed: what became of it, in a sentence. */
    fun scanned(code: String): String {
        val sku = TagCode.sku(code)
        val p = SaleLookup.find(sku, book.products.items.value) ?: return notInStock(sku)
        if (draft.lines.any { it.sku == p.sku }) return "${p.name} is already on this sale."
        update { it.lines.add(SaleLine.fromProduct(p)) }
        return "Added ${p.name} (${p.sku})."
    }

    fun startOver() {
        SaleStore.clear()
        WorkDraftSync.sale.drop()
        val d = SaleDraft()
        d.takenBy = defaultTaker
        replaceDraft(d)
        query = ""
        notice = null
        failure = null
        goneSkus = emptyList()
        alreadySold = false
        openedExchange = emptySet()
        step = EntryStep.customer
    }

    /** "Take them off the sale": the pieces the server says are gone. */
    fun dropGone() {
        update { d -> d.lines.removeAll { goneSkus.contains(it.sku) } }
        goneSkus = emptyList()
        alreadySold = false
        failure = null
    }

    /** "Create in stock and add": a new piece is the ERP's own page (the Stock group's form is not native yet); it is found by search or tag once made. */
    fun createInStock() = open(SaleLinks.newPiece)

    // MARK: Create order

    /**
     * The same pieces can go to the workshop as an order instead (sale-page.tsx "Create order", /orders/add?fromCart=1):
     * the order form opens on them, and the sale is cleared when the order saves.
     */
    fun createOrder() {
        SaleStore.startOrderFrom(draft)
        open("/orders/add")
    }

    /** An order half typed on this phone is not thrown away without asking. */
    fun askOrder() {
        if (SaleStore.orderInProgress()) confirmingOrder = true else createOrder()
    }

    /**
     * A rate typed on the sale becomes the shop's, after the invoice is saved and never before (the invoice is priced
     * from the rates in hand), as the web does. It is not waited for: the Outbox sends it, and says app-wide if it
     * cannot (the sale is still saved).
     */
    private fun keepRates(rates: Map<String, Double>) {
        ErpApi.shared.enqueue("setRates", mapOf("rates" to rates), "Rates")
    }

    // MARK: Save

    /**
     * The new invoice reaches the phone's shelf a moment after the server writes it; wait for it (a few seconds at most)
     * so the invoice page opens on the invoice, not on "not found".
     */
    private suspend fun waitForInvoice(id: String) {
        repeat(12) {
            if (book.invoices.item(id) != null) return
            delay(250)
        }
    }

    /** Save, which outlives the screen: a sale sent is not abandoned because the person looked away. */
    fun save(f: SaleFigures) {
        ErpApp.scope.launch { saveNow(f) }
    }

    private fun refused(e: ErpApi.Failure) {
        failure = e.message
        if (e.status == 409) {
            val r = SaleLookup.refusal(e.message, draft.lines)
            goneSkus = r.gone
            alreadySold = r.alreadySold
        }
    }

    private suspend fun saveNow(f: SaleFigures) {
        if (!f.canSave || saving) return
        saving = true
        failure = null
        goneSkus = emptyList()
        alreadySold = false
        val qr: (String) -> String? = { book.products.item(it)?.qrCodeDataUrl }
        val sent = draft
        if (edit != null) {
            // The sale page's edit: the same write under the invoice's own number. Its rates are its own, held, never
            // the shop's (an edit writes no rate back).
            try {
                ErpApi.shared.write("createInvoice", sent.editPayload(f, edit.invoiceId, qr))
                saving = false
                leave()
            } catch (e: CancellationException) {
                saving = false
                throw e
            } catch (e: ErpApi.Failure) {
                refused(e)
            } catch (e: Exception) {
                failure = e.message ?: "The ERP didn't answer."
            }
            saving = false
            return
        }
        // Decided before the save, from the shop's rates as they stand now.
        // A rate a written bill set is the bill's, never today's (SaleScanHeld).
        val kept = SaleStore.unheld(sent.ratesToWriteBack(f, book.settings.value.value), sent)
        try {
            val out = ErpApi.shared.write("createInvoice", sent.payload(f, qr))
            val id = ((out["invoice"] as? Map<*, *>)?.get("id") as? String).orEmpty()
            if (kept != null) keepRates(kept)
            SaleStore.clear()
            WorkDraftSync.sale.drop()
            replaceDraft(SaleDraft())
            if (id.isEmpty()) {
                failure = "The sale was saved, but the ERP did not say its number. Look for it under Invoices."
            } else {
                waitForInvoice(id)
                made = id
            }
        } catch (e: CancellationException) {
            saving = false
            throw e
        } catch (e: ErpApi.Failure) {
            // The ERP's own words, as they come: a piece sold meanwhile is a 409 that names it.
            refused(e)
        } catch (e: Exception) {
            failure = e.message ?: "The ERP didn't answer."
        }
        saving = false
    }
}
