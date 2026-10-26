package erp.app.screens.neworder

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.ArrowCircleRight
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.DocumentScanner
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import erp.app.ui.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.config.House
import erp.app.config.Prefs
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.WorkDraftSync
import erp.app.data.rememberShelf
import erp.app.data.rememberSingle
import erp.app.nav.AppRouter
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.screens.work.DraftOpen
import erp.app.screens.work.DraftOpening
import erp.app.screens.work.DraftsCount
import erp.app.screens.work.DraftsNote
import erp.app.ui.EntryContinue
import erp.app.ui.EntryStep
import erp.app.ui.EntrySteps
import erp.app.ui.FailureAlert
import erp.app.ui.MoneyFeedback
import erp.app.ui.MoneyText
import erp.app.ui.NotAvailableState
import erp.app.ui.RecentCustomers
import erp.app.ui.ShopDate
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.TransactionReview
import erp.app.ui.TransactionReviewRow
import erp.app.ui.TransactionWorkspace
import erp.app.ui.color
import erp.app.ui.MinTouchTarget
import erp.core.entry.EntryHouse
import erp.core.entry.NewOrderDraft
import erp.core.entry.NewOrderDraftStore
import erp.core.entry.NewOrderEdit
import erp.core.entry.NewOrderFormat
import erp.core.entry.NewOrderMath
import erp.core.entry.NewOrderPieceDraft
import erp.core.entry.NewOrderSizes
import erp.core.entry.SaleDraftStore
import erp.core.entry.SaleLine
import erp.core.entry.editRequest
import erp.core.entry.fromSale
import erp.core.logic.Money
import erp.core.models.Product
import java.util.UUID
import kotlin.math.abs
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.launch

// New order (src/app/orders/add/page.tsx, components/order/order-form.tsx): who it is for, when it is promised, the
// pieces (each opens full-screen), the rates, the discount, the advance and the exchange, and the totals as the web
// works them out. Saved through the ERP's own shared write (`createOrder`, lib/writes/create-order.ts): it numbers the
// order and stamps the rates, exactly as the browser's does.
//
// The order in progress is kept at every change, on this phone and in Drafts (NewOrderPhoneStore, WorkDraftSync), until
// it is saved or started over. A New order always opens blank: the one kept before is in Drafts, continued from there
// (or from a screen that opens this one with `?resume=1`). A piece can start from one in stock (Add from stock); sizes are offered to the
// customer's profile once the order is saved (SizeAskSheet). "Read a slip" reads a parchi with the ERP's AI reader
// into this form (ScanSlipPage); the voice order stays on the ERP's page.
//
// Edit order (/orders/<id>/edit) is this same form opened on the order on file (NewOrderEdit): nothing is kept on the
// phone or in Drafts, there is no starting over, and Save writes the changes (`updateOrder`), owners only as in the
// browser. (NewOrder.swift.)

@Composable
fun NewOrder(readsSlip: Boolean = false, edit: NewOrderEdit? = null, ratesFirst: Boolean = false, resumes: Boolean = false) {
    // The core knows no BuildConfig: the house is told once, before any piece starts on its metal.
    EntryHouse.id = House.id
    val session = LocalSession.current
    val me by session.me.collectAsStateWithLifecycle()
    val role = me?.role ?: "none"
    when {
        edit != null && role != "owner" ->
            NotAvailableState("Only an owner can change an order", why = "Ask an owner to make the change, or add a note on the order.")
        role == "owner" || role == "staff" -> NewOrderForm(readsSlip, edit, ratesFirst, resumes)
        else -> NotAvailableState("Orders are taken by the shop", why = "Sign in with an owner or staff account to take an order.")
    }
}

@Composable
private fun NewOrderForm(readsSlip: Boolean, edit: NewOrderEdit?, ratesFirst: Boolean, resumes: Boolean) {
    val session = LocalSession.current
    val me by session.me.collectAsStateWithLifecycle()
    val shop = me?.shop ?: session.shop
    val book = LocalBook.current
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()

    val customers by rememberShelf(book.customers)
    val karigars by rememberShelf(book.karigars)
    val orders by rememberShelf(book.orders)
    val invoices by rememberShelf(book.invoices)
    val settings by rememberSingle(book.settings)
    val people = remember(customers) { NewOrderMath.people(customers) }
    val workshop = remember(karigars) { karigars.filter { (it.deletedAt ?: "").isEmpty() } }

    val holder = remember(edit) { DraftHolder(edit?.draft ?: NewOrderDraft.fresh()) }
    /** The phone's copy has been dealt with (and not before: an unread draft must never be overwritten). */
    var loaded by remember(edit) { mutableStateOf(edit != null) }
    /** The business this screen was opened in: every draft and the save go to it, whatever is open when they run. */
    val biz = remember { House.id }
    /** The draft this form was opened on, as text, until the first change: opening a draft is not a change to it. */
    var baseline by remember { mutableStateOf<String?>(null) }
    var restored by remember { mutableStateOf(false) }
    var editingId by remember { mutableStateOf<UUID?>(null) }
    var saving by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var failureTitle by remember { mutableStateOf("The order wasn't saved") }
    var created by remember { mutableStateOf<String?>(null) }
    /** The sizes on offer to the customer's profile once the order is saved. */
    var sizeAsk by remember { mutableStateOf<NewOrderSizeAsk?>(null) }
    var savedEdit by remember { mutableStateOf(false) }
    var confirmReset by remember { mutableStateOf(false) }
    var pickingStock by remember { mutableStateOf(false) }
    var readingSlip by remember { mutableStateOf(false) }
    var readerOpened by remember { mutableStateOf(false) }
    // Change rate opens an order on file at the Pieces step, its rates on top (the owner, 2026-10-24).
    var stepIndex by rememberSaveable { mutableIntStateOf(if (ratesFirst && edit != null) EntryStep.pieces.ordinal else 0) }
    val step = EntryStep.entries[stepIndex.coerceIn(0, EntryStep.entries.size - 1)]

    ScreenTitle(created ?: edit?.let { "Edit ${it.orderId}" } ?: "New order")
    if (edit == null && created == null) {
        // The AI slip reader (ScanSlipPage): the ERP's own reader, its answer laid into this draft.
        ScreenActions {
            TextButton(onClick = { readingSlip = true }) {
                androidx.compose.material3.Icon(Icons.Filled.DocumentScanner, null, Modifier.padding(end = 6.dp))
                Text("Read a slip")
            }
        }
    }

    fun tell(title: String, message: String) {
        failureTitle = title
        failure = message
    }

    fun seedTodaysRates() {
        val s = settings
        if (!loaded || s == null || holder.now.ratesSeeded) return
        holder.edit { seedRates(s) }
    }

    /** "Taken by" starts on the signed-in person (their counter name on the house's list), once. */
    fun settleTakenBy() {
        if (!loaded || edit != null || me?.shop == null) return
        holder.edit { settleTakenBy(shop.person, shop.takenBy) }
    }

    /**
     * The order in Drafts as the web's form holds it, within a third of a second of the last change (`now` as the screen
     * or the app goes). `make` reads the form when the write is due, so a burst of keys is one write of the newest.
     */
    fun sync(now: Boolean = false) {
        if (!loaded || created != null || edit != null) return
        val s = settings
        WorkDraftSync.order.push(blank = holder.now.isBlank, enabled = s?.autoDraftForms ?: true, now = now, business = biz) {
            WorkDraftSync.snapshot(holder.now, s)
        }
    }

    /** Any change to the form is on the phone at once (off the main thread, the newest of a burst) and in Drafts. */
    fun changed() {
        // An edit is never kept on the phone or in Drafts: the order on file is the copy.
        if (!loaded || created != null || edit != null) return
        // The draft just opened is not a change to it.
        baseline?.let { if (NewOrderDraftStore.encode(holder.now) == it) return; baseline = null }
        NewOrderPhoneStore.save(holder.now.copy(), business = biz)
        sync()
    }

    fun keepNow() {
        if (!loaded || created != null || edit != null) return
        // A draft opened and left as it was has nothing new to keep.
        baseline?.let { if (NewOrderDraftStore.encode(holder.now) == it) return }
        NewOrderPhoneStore.save(holder.now.copy(), now = true, business = biz)
        sync(now = true)
    }

    /** Where the new order goes: its own page replaces this one. */
    fun leaveTo(path: String?) {
        if (path == null) navigator.back() else navigator.replace(path)
    }

    fun orderPath(id: String): String = "/orders/" + java.net.URLEncoder.encode(id, "UTF-8").replace("+", "%20")

    /**
     * The order kept on this phone is in Drafts too: one saved or thrown away at the counter since is not this phone's
     * to save a second time, so it goes from here as well.
     */
    suspend fun stillOurs() {
        if (WorkDraftSync.order.stillThere(biz) != false || created != null) return
        NewOrderPhoneStore.clear(biz)
        WorkDraftSync.order.forget(biz)
        holder.replace(NewOrderDraft.fresh())
        baseline = null
        restored = false
        editingId = null
        seedTodaysRates()
        settleTakenBy()
        tell("Finished on another device", "The order kept on this phone was saved or discarded from Drafts on another device, so it is cleared here. Look for it under Orders.")
    }

    /**
     * What the form opens on, once: blank, with the order this phone was holding made sure of in Drafts (the owner,
     * 2026-10-25: "don't auto open the draft"); or that very order, when it is continued on purpose. Where the work has
     * no other place to be found the phone's copy is continued as it always was: drafts turned off, the demo, and staff,
     * who cannot read Drafts (firestore.rules).
     */
    fun begin() {
        if (loaded || edit != null) return
        loaded = true
        scope.launch { DraftsCount.refresh() }
        val s = settings
        val kept = DraftOpening.kept(s?.autoDraftForms, House.isDemo, session.isOwner)
        val saved = NewOrderPhoneStore.load(biz)
        if (saved != null && DraftOpening.decide(true, resumes, kept) == DraftOpen.Continue) {
            // A form that was typed in while this waited keeps what it has.
            if (holder.now.isBlank) {
                holder.replace(saved)
                baseline = NewOrderDraftStore.encode(saved)
                restored = true
            }
            scope.launch { stillOurs() }
            // Work put on the phone's draft by another screen is in Drafts from now, not from its next key.
            if (WorkDraftSync.order.id == null) sync()
        } else if (saved != null) {
            // Blank, with this phone's copy made sure of in Drafts.
            WorkDraftSync.order.release(biz, kept) { WorkDraftSync.snapshot(saved, s) }
            NewOrderPhoneStore.clear(biz)
        } else {
            // Nothing kept here: an id left from it is no draft of this form's.
            WorkDraftSync.order.forget(biz)
        }
        WorkDraftSync.order.resume()
        seedTodaysRates()
        settleTakenBy()
    }

    // The shop's settings say whether drafts are kept: wait for them (a moment, from the phone's cache), then decide what to open.
    LaunchedEffect(Unit) {
        if (!loaded) {
            if (!House.isDemo) withTimeoutOrNull(3000) { book.settings.loaded.first { it } }
            begin()
        }
    }
    // The rates start as today's, once; a draft that is continued keeps the rates it was quoted at.
    LaunchedEffect(loaded, settings) { seedTodaysRates() }
    LaunchedEffect(loaded, me?.shop) { settleTakenBy() }
    LaunchedEffect(loaded) {
        if (loaded && readsSlip && !readerOpened && created == null) {
            readerOpened = true
            readingSlip = true
        }
    }

    // Kept on this phone and in Drafts at every change, and at once when the app leaves or the screen goes.
    LaunchedEffect(holder.stamp, loaded) { changed() }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { keepNow() }
    DisposableEffect(Unit) { onDispose { keepNow() } }
    MoneyFeedback(success = created, failure = null)
    BackHandler(enabled = saving) { /* a save is on its way: the screen stays */ }

    // Sizes on the order that the customer's profile doesn't hold are offered once, over the order's own page.
    // The customer is the one the ERP names on the order (a new one it has just made, or the one on file).
    fun offerSizes(made: Map<*, *>, draft: NewOrderDraft) {
        val customerId = made["customerId"] as? String
        val profile = customerId?.let { id -> book.customers.item(id) }
        val rows = NewOrderSizes.offer(draft, customerId, profile, shop.sizeToProfile)
        if (customerId == null || rows.isEmpty()) return
        val name = (made["customerName"] as? String) ?: profile?.name ?: "the customer"
        sizeAsk = NewOrderSizeAsk(customerId, name, rows)
    }

    /**
     * The same checks as the web's form (`orderFormSchema`), then `createOrder` with `{ order }`, then the order's own
     * page replaces this one. The ERP numbers the order and stamps the rates; nothing here updates a shelf, the new
     * order arrives on it by itself.
     */
    fun save() {
        if (saving) return
        val s = settings
        if (s == null) {
            tell(NewOrderLogic.SAVE_BLOCKED_TITLE, "The shop's rates haven't loaded. Check the connection and try again.")
            return
        }
        val draft = holder.now
        NewOrderMath.problem(draft, takenBy = shop.takenBy)?.let { tell(NewOrderLogic.SAVE_BLOCKED_TITLE, it); return }
        saving = true
        scope.launch {
            try {
                if (edit != null) {
                    // The form's edit path: the ERP lays these fields over the order on file and its pieces.
                    val request = NewOrderMath.editRequest(draft, edit, s, people)
                    try {
                        ErpApi.shared.write("updateOrder", request)
                        savedEdit = true
                        (request["order"] as? Map<*, *>)?.let { offerSizes(it, draft) }
                        if (sizeAsk == null) leaveTo(null)
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: ErpApi.Failure) {
                        tell("The changes weren't saved", if (e.status == 0 && !House.isDemo) NewOrderLogic.noAnswer(e.message, false) else e.message)
                    }
                    return@launch
                }
                val request = NewOrderMath.request(draft, s, people)
                try {
                    val out = ErpApi.shared.write("createOrder", request)
                    val made = out["order"] as? Map<*, *>
                    val id = made?.get("id") as? String
                    if (made == null || id.isNullOrEmpty()) {
                        tell("The order wasn't saved", "The ERP saved the order but didn't say its number. Look for it in Orders.")
                        return@launch
                    }
                    NewOrderPhoneStore.clear(biz)
                    WorkDraftSync.order.drop(biz)
                    // Made from the sale in progress: the pieces are the order's now, and leaving them on the sale would
                    // bill the same pieces a second time (the web clears the cart).
                    if (draft.fromSale) {
                        Prefs.remove(SaleDraftStore.key, biz)
                        WorkDraftSync.sale.drop(biz)
                    }
                    offerSizes(made, draft)
                    // Blank, so a keep that was already on its way writes nothing back.
                    holder.replace(NewOrderDraft.fresh())
                    created = id
                } catch (e: CancellationException) {
                    throw e
                } catch (e: ErpApi.Failure) {
                    // The ERP has seen this very order already (a second tap, a retry): it is made, not lost.
                    if (NewOrderLogic.alreadySent(e.status, e.message)) {
                        tell("Already sent", e.message)
                    } else {
                        // No answer is not "no": the order may have gone through, and saving again would make a second.
                        tell("The order wasn't saved", if (e.status == 0 && !House.isDemo) NewOrderLogic.noAnswer(e.message, true) else e.message)
                    }
                }
            } finally {
                saving = false
            }
        }
    }

    fun startOver() {
        NewOrderPhoneStore.clear(biz)
        WorkDraftSync.order.drop(biz)
        holder.replace(NewOrderDraft.fresh())
        baseline = null
        restored = false
        editingId = null
        stepIndex = 0
        seedTodaysRates()
        settleTakenBy()
    }

    // After the save: the new order's own page replaces the form, once the sizes (if any) are answered.
    val madeId = created
    if (madeId != null) {
        NewOrderLanding(madeId, waiting = sizeAsk != null) { leaveTo(orderPath(madeId)) }
        sizeAsk?.let { ask -> SizeAskSheet(ask) { sizeAsk = null } }
        return
    }

    val d = holder.read()
    val totals = NewOrderMath.totals(d, settings)
    val knownAddresses = { NewOrderLogic.knownAddresses(d.customerId, customers, orders, invoices) }

    TransactionWorkspace(
        editor = {
            Column(Modifier.fillMaxSize()) {
                EntrySteps(selection = step, onSelect = { stepIndex = it.ordinal }, states = NewOrderLogic.stepStates(d))
                if (step == EntryStep.pieces || step == EntryStep.payment) PinnedSummary(totals)
                val scroll = rememberScrollState()
                LaunchedEffect(step) { scroll.scrollTo(0) }
                Column(
                    Modifier.weight(1f).fillMaxWidth().verticalScroll(scroll).padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                ) {
                    if (restored) RestoredBanner(d.fromSale, d.photosLeftOut)
                    if (edit?.invoiced == true) {
                        FormCard {
                            NoteRow("This order is on an invoice already. The invoice keeps its own copy of the pieces and the money: change those on the invoice.", Icons.Filled.Description)
                        }
                    }
                    when (step) {
                        EntryStep.customer -> {
                            if (edit == null && d.isBlank) DraftsNote()
                            CustomerSection(holder, people, shop.takenBy) { RecentCustomers.recent(invoices, orders, customers) }
                            PromisedSection(holder)
                        }
                        EntryStep.pieces -> {
                            if (ratesFirst) RatesSection(holder, settings)
                            PiecesSection(
                                holder, totals,
                                onOpen = { editingId = it },
                                onAdd = {
                                    val p = NewOrderPieceDraft()
                                    holder.edit { pieces.add(p) }
                                    editingId = p.id
                                },
                                onStock = { pickingStock = true },
                            )
                            if (!ratesFirst) RatesSection(holder, settings)
                            PrintedSection(holder)
                        }
                        EntryStep.payment -> {
                            PaymentSection(holder, totals)
                            ExchangeSection(holder)
                        }
                        EntryStep.review -> {
                            FormCard(title = "Review") {
                                ValueRow("Customer", d.customerName.ifEmpty { "Walk-in" })
                                if (d.customerPhone.isNotEmpty()) ValueRow("Phone", d.customerPhone)
                                ValueRow("Promised for", if (d.promised.isEmpty()) "No date" else ShopDate.say(d.promised))
                                ActionRow("Edit ${NewOrderFormat.pieces(d.pieces.size)}", onClick = { stepIndex = EntryStep.pieces.ordinal })
                                ActionRow("Edit payment and exchange", onClick = { stepIndex = EntryStep.payment.ordinal })
                            }
                            if (d.pieces.isNotEmpty()) {
                                FormCard(title = "Pieces") {
                                    d.pieces.forEachIndexed { index, piece ->
                                        PieceRow(
                                            NewOrderFormat.trim(piece.description), NewOrderLogic.pieceSpec(piece), index + 1,
                                            totals.prices.getOrElse(index) { 0.0 },
                                            onOpen = { editingId = piece.id },
                                            onDuplicate = { holder.edit { duplicatePiece(piece.id) } },
                                            onRemove = { holder.edit { pieces.removeAll { it.id == piece.id } } },
                                        )
                                    }
                                }
                            }
                            NotesSection(holder)
                            DeliverySection(holder, knownAddresses)
                            // The shop's own figure: owners and staff, never the customer (decisions.md "Margin").
                            if (EntryHouse.margin.rattiLess != null) MarginSection(holder, settings) { totals }
                            TotalsSection(totals, d.pieces.size)
                            if (edit == null && !d.isBlank) {
                                FormCard(footer = "Your order is kept as you type, on this phone and in Drafts for the counter, until you save it or start over.") {
                                    ActionRow("Start over", destructive = true, onClick = { confirmReset = true })
                                }
                            }
                        }
                    }
                }
            }
        },
        review = {
            TransactionReview(
                customer = d.customerName,
                contact = d.customerPhone,
                pieces = d.pieces.mapIndexed { index, p ->
                    TransactionReviewRow(NewOrderLogic.pieceLabel(index, p.description), Money.pkr(totals.prices.getOrElse(index) { 0.0 }))
                },
                figures = NewOrderLogic.reviewFigures(totals).map { (label, value) -> TransactionReviewRow(label, value) },
            )
        },
        footer = {
            if (step == EntryStep.review) {
                SaveBar(totals.balance, saving, edit != null, onSave = ::save)
            } else {
                EntryContinue(selection = step, onSelect = { stepIndex = it.ordinal })
            }
        },
    )

    // The piece being edited, over the form.
    editingId?.let { id ->
        PieceEditor(
            holder, id, settings, workshop, editingOrder = edit != null,
            onDuplicate = { holder.edit { duplicatePiece(id) } },
            onRemove = { holder.edit { pieces.removeAll { it.id == id } } },
            onClose = { editingId = null },
        )
    }
    if (pickingStock) {
        StockPickerSheet(
            onPick = { p: Product ->
                // A piece in stock as the start of one to be made (the web's "Add from Inventory"): everything copied,
                // its SKU the reference, and it opens to be changed.
                val piece = NewOrderPieceDraft.fromSale(SaleLine.fromProduct(p))
                holder.edit { pieces.add(piece) }
                editingId = piece.id
            },
            onDismiss = { pickingStock = false },
        )
    }
    if (readingSlip) ScanSlipPage(holder) { readingSlip = false }
    sizeAsk?.let { ask ->
        SizeAskSheet(ask) {
            sizeAsk = null
            if (edit != null && savedEdit) leaveTo(null)
        }
    }
    FailureAlert(failure, onDismiss = { failure = null }, title = failureTitle)
    if (confirmReset) {
        AlertDialog(
            onDismissRequest = { confirmReset = false },
            title = { Text("Start this order over?") },
            text = { Text("Everything typed so far is cleared from this phone and from Drafts.") },
            confirmButton = { TextButton(onClick = { confirmReset = false; startOver() }) { Text("Start over", color = Tone.problem.color()) } },
            dismissButton = { TextButton(onClick = { confirmReset = false }) { Text("Keep it") } },
        )
    }
}

// MARK: Pieces

@Composable
private fun PiecesSection(
    holder: DraftHolder,
    totals: NewOrderMath.Totals,
    onOpen: (UUID) -> Unit,
    onAdd: () -> Unit,
    onStock: () -> Unit,
) {
    val d = holder.read()
    FormCard(title = "Pieces", footer = piecesFooter(d.pieces.size)) {
        d.pieces.forEachIndexed { index, piece ->
            PieceRow(
                NewOrderFormat.trim(piece.description), NewOrderLogic.pieceSpec(piece), index + 1,
                totals.prices.getOrElse(index) { 0.0 },
                onOpen = { onOpen(piece.id) },
                onDuplicate = { holder.edit { duplicatePiece(piece.id) } },
                onRemove = { holder.edit { pieces.removeAll { it.id == piece.id } } },
            )
        }
        ActionRow("Add a piece", icon = Icons.Filled.AddCircle, onClick = onAdd)
        ActionRow("Add from stock", icon = Icons.Filled.Inventory2, onClick = onStock)
    }
}

@Composable
private fun RestoredBanner(fromSale: Boolean, photosLeftOut: Boolean) {
    FormCard {
        if (fromSale) {
            NoteRow("These are the pieces of your sale. Once this order is saved they leave the sale.", Icons.Filled.ArrowCircleRight)
        } else {
            NoteRow("Your order in progress is back. It was kept on this phone.", Icons.AutoMirrored.Filled.Undo)
        }
        if (photosLeftOut) NoteRow("The sample photos were too many to keep: add them again.", Icons.Filled.Warning, Tone.owed)
    }
}

// MARK: Saving

/** THE action of the screen: one button, with the balance beside it. */
@Composable
private fun SaveBar(balance: Double, saving: Boolean, editing: Boolean, onSave: () -> Unit) {
    val blocked = erp.app.ui.rememberUpdateBlocked()
    Column(Modifier.fillMaxWidth()) {
        erp.app.ui.UpdateBanner()
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text("Balance due", style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Medium), color = MaterialTheme.colorScheme.onSurfaceVariant)
                MoneyText(balance, exact = true, style = MaterialTheme.typography.titleMedium)
            }
            Button(onClick = onSave, enabled = !saving && !blocked, modifier = Modifier.defaultMinSize(minWidth = 120.dp, minHeight = MinTouchTarget)) {
                if (saving) SkeletonLoading(compact = true) else Text(if (editing) "Save changes" else "Save order")
            }
        }
    }
}

/**
 * The order's total and what is still due, pinned under the steps while pieces and payment are typed. The figures
 * are `NewOrderMath.totals`' own (subtotal and balance), never worked out again here.
 */
@Composable
private fun PinnedSummary(totals: NewOrderMath.Totals) {
    val tone = when (NewOrderLogic.dueTone(totals.balance)) {
        NewOrderLogic.DueTone.credit -> Tone.credit
        NewOrderLogic.DueTone.owed -> Tone.owed
        NewOrderLogic.DueTone.settled -> Tone.settled
    }
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Column(Modifier.weight(1f)) {
            Text("Order total", style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Medium), color = MaterialTheme.colorScheme.onSurfaceVariant)
            MoneyText(totals.subtotal, exact = true, style = MaterialTheme.typography.titleLarge.copy(fontFamily = androidx.compose.ui.text.font.FontFamily.Serif, fontWeight = FontWeight.SemiBold))
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(NewOrderLogic.dueLabel(totals.balance), style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Medium), color = MaterialTheme.colorScheme.onSurfaceVariant)
            MoneyText(abs(totals.balance), exact = true, style = MaterialTheme.typography.titleMedium, color = tone.color())
        }
    }
}

/**
 * After the save: the new order's own page replaces the form. The order reaches the shelf a moment after the write, so
 * a short wait keeps the page from saying "Order not found" first. (NewOrderLanding.)
 */
@Composable
private fun NewOrderLanding(id: String, waiting: Boolean, onOpen: () -> Unit) {
    val book = LocalBook.current
    val orders by rememberShelf(book.orders)
    val here = orders.any { it.id == id }
    LaunchedEffect(id, here, waiting) {
        if (waiting) return@LaunchedEffect
        if (!here) delay(4000)
        onOpen()
    }
    Column(
        Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        SkeletonLoading()
        Text("Opening $id…", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
