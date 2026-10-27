package erp.app.screens.work

import erp.app.ui.icons.Symbols
import erp.app.ui.SegmentedColumn
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import erp.app.auth.LocalSession
import erp.app.config.House
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.Shelf
import erp.app.data.WorkDraftSync
import erp.app.data.rememberShelfStatus
import erp.app.data.rememberSingle
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenTitle
import erp.app.screens.neworder.NewOrderPhoneStore
import erp.app.screens.sale.SaleStore
import erp.app.ui.ActionRow
import erp.app.ui.AppClock
import erp.app.ui.DividedColumn
import erp.app.ui.FailureAlert
import erp.app.ui.LedgerHeading
import erp.app.ui.Radius
import erp.app.ui.RowAction
import erp.app.ui.ShelfState
import erp.app.ui.SwipeActions
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import erp.core.entry.NewOrderDraft
import erp.core.entry.SaleDraft
import erp.core.logic.DRAFT_MAX_AGE_DAYS
import erp.core.logic.Money
import erp.core.logic.WorkDraft
import erp.core.logic.draftList
import erp.core.logic.isDraftId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Drafts (src/app/drafts/page.tsx, docs/decisions.md "Drafts"): orders and sales started and not yet saved, on every device,
 * newest typed first, each with who it is for, what is in it, the running total, and when and where it was last typed.
 * Continue opens it; Discard removes it (after asking: the web has an Undo, the phone asks first).
 *
 * Owners read Firestore `drafts` live, as the web does. Staff have no Firestore (firestore.rules) and the server has no list
 * of drafts for them, so they see what is kept on this phone, which is their own order in progress. A draft this phone wrote
 * (WorkDraftSync) is continued in the native form, which holds that work already (`?resume=1`: a New order or New sale is
 * blank, a draft is continued from here, on purpose); one begun on the web or on another phone
 * opens in the ERP's own form inside the app (`/orders/add?draft=<id>&web=1`).
 */
@Composable
fun DraftsScreen() {
    val session = LocalSession.current
    if (session.role == "owner" || session.role == "staff") {
        ScreenTitle("Drafts")
        DraftsPage()
    } else {
        WorkNotYours("Drafts", "Orders and sales not yet saved are kept for the shop's owners and staff.")
    }
}

@Composable
private fun DraftsPage() {
    val book = LocalBook.current
    val session = LocalSession.current
    val nav = LocalNavigator.current
    val scope = rememberCoroutineScope()

    val readsDrafts = session.isOwner && !House.isDemo
    // Firestore `drafts`, read as cards (the form's own values are left alone: a draft with photos weighs a megabyte).
    val shelf = remember { Shelf("drafts", WorkDraft, { it.id }, Comparator<WorkDraft> { a, b -> b.updatedAt.compareTo(a.updatedAt) }, book) }
    DisposableEffect(shelf) {
        if (readsDrafts) shelf.need()
        onDispose { shelf.reset() }
    }
    val status = rememberShelfStatus(shelf)
    val settings by rememberSingle(book.settings)

    // What this phone holds of its own, read when the screen opens (the photos left out: they change no figure).
    var phoneOrder by remember { mutableStateOf<NewOrderDraft?>(null) }
    var phoneSale by remember { mutableStateOf<SaleDraft?>(null) }
    LaunchedEffect(Unit) {
        phoneOrder = NewOrderPhoneStore.load()?.also { d -> d.pieces.forEach { it.photo = null } }
        phoneSale = if (session.isOwner) SaleStore.load() else null
        // Drafts that could not be sent (no line) are sent now if the line is back.
        WorkDraftSync.resumeAll()
    }
    var discarding by remember { mutableStateOf<DraftRow?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    // Drafts the demo has thrown away (nothing is sent in the demo).
    var demoGone by remember { mutableStateOf(emptySet<String>()) }
    // Month-old drafts already asked to go, so a list that redraws does not ask twice.
    val purged = remember { HashSet<String>() }

    val ready = !readsDrafts || status.loaded
    val now = AppClock.now()
    val split = if (House.isDemo) draftList(WorkDemoBooks.drafts(now).filter { it.id !in demoGone }, now)
    else draftList(if (readsDrafts) status.items else emptyList(), now)
    val seesDrafts = readsDrafts && status.loaded && status.error == null
    val all = DraftsLogic.rows(split.live, phoneOrder, phoneSale, WorkDraftSync.order.id, WorkDraftSync.sale.id, seesDrafts, settings)
    val orders = all.filter { it.draft.isOrder }
    val sales = all.filter { it.draft.isSale }

    /** A month without a keystroke and a draft is clutter: the web removes it as it sees it, and so does this. */
    LaunchedEffect(split.expired.map { it.id }) {
        if (!readsDrafts) return@LaunchedEffect
        for (d in split.expired) {
            if (d.id in purged || !isDraftId(d.id)) continue
            purged.add(d.id)
            runCatching { ErpApi.shared.send("/api/app/drafts", body = mapOf("action" to "drop", "id" to d.id)) }
        }
    }

    /** Gone from Drafts, and from this phone if the work is this phone's (or the form would put it straight back). */
    fun discard(row: DraftRow) {
        val d = row.draft
        if (House.isDemo) {
            demoGone = demoGone + d.id
            return
        }
        if (row.native) {
            if (d.isOrder) {
                NewOrderPhoneStore.clear()
                WorkDraftSync.order.drop()
                phoneOrder = null
            } else {
                SaleStore.clear()
                WorkDraftSync.sale.drop()
                phoneSale = null
            }
            return
        }
        // One still waiting to be sent (no line) must not come back after this.
        (if (d.isOrder) WorkDraftSync.order else WorkDraftSync.sale).abandon(d.id)
        scope.launch {
            try {
                ErpApi.shared.send("/api/app/drafts", body = mapOf("action" to "drop", "id" to d.id))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = "${e.message ?: e} The draft is still in the list."
            }
        }
    }

    ShelfState(loaded = ready, error = null, offline = readsDrafts && status.offline) {
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 96.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item(key = "orders") {
                DraftSection("Orders", orders, "No unfinished orders.", "New order", { nav.open("/orders/add") }, { discarding = it }, nav::open, now)
            }
            // A sale is an owner's to make (the ERP's write is for owners), so staff are not shown a place for them.
            if (session.isOwner) item(key = "sales") {
                DraftSection("Sales", sales, "No unfinished sales.", "New sale", { nav.open("/invoices/new") }, { discarding = it }, nav::open, now)
            }
            item(key = "footer") {
                Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    val small = MaterialTheme.typography.bodySmall
                    val quiet = MaterialTheme.colorScheme.onSurfaceVariant
                    Text(
                        "New orders and sales, kept as they are typed — on every device. One leaves this list the moment it is saved as an order or invoice, and after $DRAFT_MAX_AGE_DAYS days untouched. Orders and invoices that already exist are never drafted.",
                        style = small, color = quiet,
                    )
                    if (!session.isOwner) {
                        Text("Drafts begun on other devices are listed for the shop's owners; this shows what is kept on this phone.", style = small, color = quiet)
                    }
                    val error = status.error
                    if (readsDrafts && !error.isNullOrEmpty()) {
                        Text("The shop's drafts could not be read: $error", style = small, color = Tone.problem.color())
                    }
                }
            }
        }
    }

    discarding?.let { row ->
        AlertDialog(
            onDismissRequest = { discarding = null },
            title = { Text("Discard this draft?") },
            text = { Text(DraftsLogic.discardMessage(row)) },
            confirmButton = { TextButton(onClick = { discarding = null; discard(row) }) { Text("Discard", color = Tone.problem.color()) } },
            dismissButton = { TextButton(onClick = { discarding = null }) { Text("Keep it") } },
        )
    }
    FailureAlert(failure, onDismiss = { failure = null }, title = "Not discarded")
}

@Composable
private fun DraftSection(
    title: String,
    rows: List<DraftRow>,
    empty: String,
    newTitle: String,
    onNew: () -> Unit,
    onDiscard: (DraftRow) -> Unit,
    open: (String) -> Unit,
    now: java.time.Instant,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LedgerHeading(title, Modifier.padding(horizontal = 16.dp), count = rows.size)
        SegmentedColumn {
            DividedColumn {
                if (rows.isEmpty()) {
                    Text(empty, Modifier.fillMaxWidth().ledgerRow(), color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    for (row in rows) DraftRowView(row, onDiscard, open, now)
                }
                ActionRow(newTitle, onNew, icon = Symbols.Add)
            }
        }
    }
}

@Composable
private fun DraftRowView(row: DraftRow, onDiscard: (DraftRow) -> Unit, open: (String) -> Unit, now: java.time.Instant) {
    val d = row.draft
    val discard = RowAction("Discard", Symbols.Delete, Tone.problem) { onDiscard(row) }
    SwipeActions(end = discard, menu = listOf(discard), onClick = { open(DraftsLogic.path(row)) }) {
        Column(Modifier.fillMaxWidth().background(ErpColors.card).ledgerRow(), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(d.title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (d.total > 0) {
                    Text(Money.pkr(d.total), style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = "tnum"))
                }
            }
            if (d.detail.isNotEmpty()) {
                Text(d.detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Text(DraftsLogic.lastTyped(row, now), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f))
        }
    }
}
