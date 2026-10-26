package erp.app.screens.workshop

import erp.app.ui.zoomDestination
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Handyman
import androidx.compose.material.icons.filled.LockOpen
import androidx.compose.material.icons.filled.NoteAlt
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PersonOff
import androidx.compose.material.icons.filled.PersonRemove
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Scale
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.data.Connection
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.rememberShelfStatus
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.ui.FigureTile
import erp.app.ui.LedgerDivider
import erp.app.ui.LedgerHeading
import erp.app.ui.LedgerSection
import erp.app.ui.LocalNoteState
import erp.app.ui.MinTouchTarget
import erp.app.ui.Note
import erp.app.ui.NotAvailableState
import erp.app.ui.PaymentText
import erp.app.ui.Pill
import erp.app.ui.Radius
import erp.app.ui.ShelfState
import erp.app.ui.ShopDate
import erp.app.ui.ChipRow
import erp.app.ui.FilterChip
import erp.app.ui.Tone
import erp.app.ui.TwoLine
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.app.ui.ledgerRow
import erp.app.ui.readableColumn
import erp.app.ui.theme.ErpColors
import erp.core.logic.KarigarPay
import erp.core.logic.Money
import erp.core.models.Expense
import erp.core.models.HisaabEntityType
import erp.core.models.HisaabEntry
import erp.core.models.Karigar
import erp.core.models.KarigarJob
import erp.core.models.KarigarJobStatus
import erp.core.models.KarigarSilverTransaction

/** The cash line of Now: what he holds of ours (an advance), what we owe him, or square (hisaab cash, rounded). */
object KarigarNow {
    fun cash(p: WorkshopPosition): Double = WorkshopLogic.roundedAway(p.cashBalance)

    fun cashTitle(cash: Double): String = if (cash > 0) "He holds of ours" else if (cash < 0) "We owe him" else "Cash"

    fun cashValue(cash: Double): String = if (cash == 0.0) "Square" else Money.pkr(Math.abs(cash))

    /** "March 2026: PKR 40,000 paid" while a pay batch is open, else just where the figure comes from. */
    fun cashHint(open: KarigarPay.InBatch?): String {
        if (open == null || open.batch.label.isEmpty()) return "Hisaab cash"
        return "${open.batch.label}: ${Money.pkr(open.total)} paid"
    }

    fun weighHint(p: WorkshopPosition): String {
        if (p.metals.isEmpty()) return if (p.unweighed > 0) "${p.unweighed} unweighed" else "the weights on the jobs"
        var s = p.metals.joinToString(", ") { it.label }
        if (p.unweighed > 0) s += " · ${p.unweighed} unweighed"
        return s
    }

    fun footnote(owner: Boolean, silver: KarigarPay.Silver?): String {
        var s = "The pieces' weight is what the jobs say they will weigh"
        s += if (owner) "; the gold khata is what was handed over and brought back. Two measures, never added." else "."
        if (silver != null && silver.rows.isNotEmpty()) {
            s += " Silver received: ${WorkshopLogic.grams3(silver.grams)} · ${PaymentText.pkr(silver.surcharge)} surcharge."
        }
        return s
    }

    fun hisaabPath(k: Karigar) = "/hisaab/" + WorkshopLogic.piece(k.id) + "?type=karigar"

    /** The order's page, or the invoice's; a stock job opens his whole bench. */
    fun benchPath(j: WorkshopJob, k: Karigar): String =
        j.orderId?.let { workshopOrderPath(it) } ?: j.invoiceId?.let { workshopInvoicePath(it) } ?: ("/workshop?karigar=" + WorkshopLogic.piece(k.id))

    /** "↑ 12.500g" gold given, "↓ 3.000g" received, else the cash. */
    fun hisaabAmount(e: HisaabEntry): String = when {
        e.goldDebitGrams > 0 -> "↑ " + WorkshopLogic.grams3(e.goldDebitGrams)
        e.goldCreditGrams > 0 -> "↓ " + WorkshopLogic.grams3(e.goldCreditGrams)
        e.cashDebit > 0 -> Money.pkr(e.cashDebit)
        e.cashCredit > 0 -> "− " + Money.pkr(e.cashCredit)
        else -> "—"
    }

    /** "Started 1 Oct 2026 · 2 payments". */
    fun startedWords(b: KarigarPay.InBatch): String {
        val n = b.payments.size
        val started = WorkshopLogic.shortDate(b.batch.startDate)
        val count = "$n payment${if (n == 1) "" else "s"}"
        return if (started.isEmpty()) count else "Started $started · $count"
    }

    /** "1 Sep 2026 → 30 Sep 2026 · 3 payments". */
    fun settledWords(s: KarigarPay.InBatch): String {
        val from = WorkshopLogic.shortDate(s.batch.startDate)
        val to = WorkshopLogic.shortDate(s.batch.closedDate ?: "")
        val span = if (to.isEmpty()) from else "$from → $to"
        val n = s.payments.size
        val count = "$n payment${if (n == 1) "" else "s"}"
        return if (span.isEmpty()) count else "$span · $count"
    }

    /** The web's "Delete Batch": the record goes, and its payments stay in Expenses, unassigned (deletePayBatch). */
    fun deleteBatchDetail(s: KarigarPay.InBatch): String {
        val n = s.payments.size
        val kept = if (n == 0) "It has no payments."
        else "Its $n payment${if (n == 1) "" else "s"} (${PaymentText.pkr(s.total)}) stay in Expenses and in his total paid, listed with his direct payments."
        return "“${s.batch.label}” is deleted. $kept"
    }

    fun deleteSilverDetail(t: KarigarSilverTransaction): String {
        val whenWords = ShopDate.say(t.date)
        return "${WorkshopLogic.grams3(t.silverGrams)} received${if (whenWords.isEmpty()) "" else " $whenWords"}, ${PaymentText.pkr(t.totalSurcharge)} surcharge: the record is removed permanently."
    }

    fun removeDetail(name: String) =
        "$name will be hidden from the lists. His jobs, given items and hisaab stay where they are. Settings, then Recently removed, puts him back."
}

/**
 * A karigar (src/app/karigars/[id]/page.tsx): opens on Now, what he holds of ours and what we owe him
 * (docs/decisions.md "One screen per question", lib/karigar-position.ts): his bench, the pieces' estimated weight
 * beside the gold khata (two measures, never summed), what has been handed to him and not come back, and the hisaab
 * cash. The hisaab, the khata and what has been paid are the owner's: the staff's copy of the books comes without
 * them. An owner also pays him here, as on the web: a payment into his open pay batch (an expense), silver received
 * with its surcharge, starting and settling a pay batch, the settled batches and the payments outside any, deleting
 * a settled batch or a silver entry (the delete code). Every figure is core's KarigarPay (lib/karigar-pay.ts), the
 * one the ERP writes when a batch is settled. Assigning him stock work is the Workshop's sheet.
 */
@Composable
fun WorkshopKarigarScreen(id: String) {
    val book = LocalBook.current
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val note = LocalNoteState.current
    val context = LocalContext.current
    val owner = session.isOwner

    val silverBook = remember { WorkshopSilverBook() }
    DisposableEffect(silverBook) { onDispose { silverBook.stop() } }
    LaunchedEffect(owner) { if (owner) silverBook.need() }

    val karigars = rememberShelfStatus(book.karigars)
    val orders = rememberShelfStatus(book.orders)
    val invoices = rememberShelfStatus(book.invoices)
    val stockJobs = rememberShelfStatus(book.karigarJobs)
    val givenItems = rememberShelfStatus(book.givenItems)
    // The owner's books: the staff's copy comes without them.
    LaunchedEffect(owner) {
        if (owner) {
            book.hisaab.need()
            book.expenses.need()
            book.karigarBatches.need()
        }
    }
    val hisaab by book.hisaab.items.collectAsStateWithLifecycle()
    val hisaabLoaded by book.hisaab.loaded.collectAsStateWithLifecycle()
    val hisaabError by book.hisaab.error.collectAsStateWithLifecycle()
    val expenses by book.expenses.items.collectAsStateWithLifecycle()
    val expensesLoaded by book.expenses.loaded.collectAsStateWithLifecycle()
    val expensesError by book.expenses.error.collectAsStateWithLifecycle()
    val batches by book.karigarBatches.items.collectAsStateWithLifecycle()
    val batchesLoaded by book.karigarBatches.loaded.collectAsStateWithLifecycle()
    val batchesError by book.karigarBatches.error.collectAsStateWithLifecycle()
    val silverRows by silverBook.silver.items.collectAsStateWithLifecycle()
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()

    var ask by remember { mutableStateOf<WorkshopPayAsk?>(null) }
    var deletion by remember { mutableStateOf<WorkshopDeletion?>(null) }
    var deletedWhat by remember { mutableStateOf("") }
    // The settled batches and the direct payments opened to show their payments.
    var expanded by rememberSaveable { mutableStateOf(setOf<String>()) }
    var showingAccounts by rememberSaveable { mutableStateOf(false) }

    val books = karigars.loaded && orders.loaded && invoices.loaded && stockJobs.loaded && givenItems.loaded
    // His silver is not waited on: its section and its line under Now appear once it has been read.
    val loaded = if (!owner) books else books && hisaabLoaded && expensesLoaded && batchesLoaded
    // Owners' books too: a failed hisaab or pay-batch read must say so, not read as "Square" or "No active pay batch"
    // (and invite a second batch).
    val core = karigars.error ?: orders.error ?: invoices.error ?: stockJobs.error ?: givenItems.error
    val firstError = if (!owner) core else core ?: hisaabError ?: expensesError ?: batchesError

    val karigar = karigars.items.firstOrNull { it.id == id }
    ScreenTitle(karigar?.name?.ifEmpty { null } ?: "Karigar")

    ShelfState(
        loaded = loaded, error = firstError, offline = karigars.offline, connectionLost = connectionLost,
        modifier = Modifier.fillMaxSize().zoomDestination(WorkshopLogic.karigarPath(id)),
    ) {
        if (karigar == null || !karigar.deletedAt.isNullOrEmpty()) {
            NotAvailableState(
                "Karigar not found", why = "They may have been removed. Settings, Recently removed puts them back.",
                icon = Icons.Filled.PersonOff,
            )
            return@ShelfState
        }
        val live = remember(karigars.revision) { workshopLive(karigars.items) }
        val jobs = remember(orders.revision, invoices.revision, karigars.revision, stockJobs.revision) {
            WorkshopLogic.buildJobs(orders.items, stockJobs.items, live, invoices.items)
        }
        val position = remember(jobs, givenItems.revision, hisaab, owner, karigar) {
            WorkshopPosition(karigar.id, karigar.name, jobs, givenItems.items, if (owner) hisaab else emptyList())
        }
        val load = remember(jobs, karigar) { WorkshopLogic.groupByKarigar(jobs.filter { it.karigarId == karigar.id }).firstOrNull() }
        // His pay (owners: the batches and the expenses are the owner's books).
        val pay = if (owner) remember(karigar.id, expenses, batches) { KarigarPay.figures(karigar.id, expenses, batches) } else null
        val silver = if (owner) remember(karigar.id, silverRows) { KarigarPay.silver(karigar.id, silverRows) } else null

        if (load != null && load.active > 0) {
            ScreenActions {
                // The web copies the list and opens WhatsApp to the karigar; the share sheet does both.
                IconButton(onClick = { workshopShare(context, WorkshopLogic.shareText(load, session.shop.name), "Send list") }) {
                    Icon(Icons.Filled.Share, "Send list")
                }
            }
        }

        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).readableColumn(720.dp).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            if (owner) {
                ChipRow(Modifier.padding(horizontal = 0.dp)) {
                    FilterChip("Work", chosen = !showingAccounts, onClick = { showingAccounts = false })
                    FilterChip("Payments & khata", chosen = showingAccounts, onClick = { showingAccounts = true })
                }
            }
            NowSection(karigar, position, pay?.open, silver, owner) { navigator.open(it) }
            if (!showingAccounts || !owner) {
                if (position.bench.isNotEmpty()) BenchSection(karigar, position) { navigator.open(it) }
                if (position.given.isNotEmpty()) {
                    LedgerSection("Handed to him, not back") {
                        DividedRows(position.given) { it ->
                            Box(Modifier.fillMaxWidth().clickable(role = Role.Button) { navigator.open("/given") }.ledgerRow()) {
                                TwoLine(it.description, trailing = if (it.date.isEmpty()) null else ShopDate.say(it.date))
                            }
                        }
                    }
                }
                StockJobsSection(karigar, stockJobs.items.filter { it.karigarId == karigar.id }, owner) { ask = WorkshopPayAsk.Assign }
            } else {
                HisaabSection(karigar, position, hisaab.filter { it.entityType == HisaabEntityType.karigar && it.entityId == karigar.id }) { navigator.open(it) }
                if (pay != null) PayBatchSection(pay, onAsk = { ask = it })
                if (silver != null && silver.rows.isNotEmpty()) {
                    SilverSection(silver, onAdd = { ask = WorkshopPayAsk.Silver }) { t ->
                        deletion = WorkshopDeletion(
                            what = "Delete this silver entry", detail = KarigarNow.deleteSilverDetail(t),
                            run = { code -> WorkshopWrites.deleteSilver(t.id, code).let { ErpApi.shared.write(it.op, it.fields) } },
                        )
                        deletedWhat = "Silver entry deleted"
                    }
                }
                if (pay != null && pay.settled.isNotEmpty()) {
                    LedgerSection("Settled pay batches") {
                        DividedRows(pay.settled) { s ->
                            val open = s.batch.id in expanded
                            Column {
                                Row(
                                    Modifier.fillMaxWidth().clickable(role = Role.Button, onClickLabel = if (open) "Hide payments" else "Show payments") {
                                        expanded = if (open) expanded - s.batch.id else expanded + s.batch.id
                                    }.ledgerRow(),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Box(Modifier.weight(1f)) { TwoLine(s.batch.label, subtitle = KarigarNow.settledWords(s), trailing = PaymentText.pkr(s.total)) }
                                    Icon(Icons.Filled.ExpandMore, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                if (open) {
                                    Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp)) {
                                        if (s.payments.isEmpty()) {
                                            Text("No payments in this batch.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        }
                                        for (e in s.payments) PaymentRow(e)
                                        TextButton(onClick = {
                                            deletion = WorkshopDeletion(
                                                what = "Delete this karigar batch", detail = KarigarNow.deleteBatchDetail(s),
                                                run = { code -> WorkshopWrites.deleteBatch(s.batch.id, code).let { ErpApi.shared.write(it.op, it.fields) } },
                                            )
                                            deletedWhat = "Batch deleted"
                                        }, Modifier.defaultMinSize(minHeight = MinTouchTarget)) {
                                            Icon(Icons.Filled.Delete, null, Modifier.size(18.dp), tint = Tone.problem.color())
                                            Text("Delete batch", Modifier.padding(start = 6.dp), color = Tone.problem.color())
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                if (pay != null && pay.direct.isNotEmpty()) {
                    val n = pay.direct.size
                    LedgerSection("Direct payments") {
                        val open = "direct" in expanded
                        Row(
                            Modifier.fillMaxWidth().clickable(role = Role.Button, onClickLabel = if (open) "Hide payments" else "Show payments") {
                                expanded = if (open) expanded - "direct" else expanded + "direct"
                            }.ledgerRow(),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(Modifier.weight(1f)) {
                                TwoLine("Direct payments", subtitle = "Not part of any hisaab · $n payment${if (n == 1) "" else "s"}", trailing = PaymentText.pkr(pay.directTotal))
                            }
                            Icon(Icons.Filled.ExpandMore, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (open) Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp)) { for (e in pay.direct) PaymentRow(e) }
                    }
                }
            }
            ProfileSection(karigar, if (showingAccounts) pay else null) { workshopDial(context, it) }
            if (owner) {
                LedgerSection("Karigar") {
                    ActionLine("Edit karigar", Icons.Filled.Edit, false) { navigator.open("/karigars/" + WorkshopLogic.piece(karigar.id) + "/edit") }
                    LedgerDivider()
                    ActionLine("Their view", Icons.Filled.Visibility, false) { navigator.open("/my-work?preview=" + WorkshopLogic.piece(karigar.id)) }
                    LedgerDivider()
                    ActionLine("Remove karigar", Icons.Filled.PersonRemove, true) {
                        // Removing him (`removeKarigar`, the delete code, the store's words) only hides him: his jobs,
                        // given items and hisaab stay, and Settings, Recently removed puts him back.
                        val name = karigar.name.ifEmpty { karigar.id }
                        deletion = WorkshopDeletion(
                            what = "Delete karigar $name", detail = KarigarNow.removeDetail(name),
                            run = { code -> WorkshopWrites.removeKarigar(karigar.id, code).let { ErpApi.shared.write(it.op, it.fields) } },
                            final = false,
                        )
                        deletedWhat = "Delete karigar "
                    }
                }
            }
        }

        // The pay sheets: each one write through the ERP.
        when (val a = ask) {
            is WorkshopPayAsk.Pay -> WorkshopPaySheet(
                karigar, a.batch, WorkshopPayWords.formCategories(session.shop.expenseCategories, expenses), session.shop.partnership,
            ) { ask = null }
            WorkshopPayAsk.Silver -> WorkshopSilverSheet(karigar) { ask = null }
            WorkshopPayAsk.Start -> WorkshopBatchStartSheet(karigar) { ask = null }
            is WorkshopPayAsk.Settle -> WorkshopSettleSheet(a.open) { ask = null }
            WorkshopPayAsk.Assign -> WorkshopStockJobSheet(live, karigar.id) { ask = null }
            null -> {}
        }
        deletion?.let { d ->
            WorkshopDeleteCodeSheet(d, onDismiss = { deletion = null }, onDone = {
                if (deletedWhat == "Delete karigar ") {
                    // He is off every list now; Recently removed has him.
                    navigator.back()
                } else {
                    note.show(Note(deletedWhat))
                }
            })
        }
    }
}

@Composable
private fun <T> ColumnScope.DividedRows(items: List<T>, row: @Composable (T) -> Unit) {
    items.forEachIndexed { i, it ->
        if (i > 0) LedgerDivider()
        row(it)
    }
}

@Composable
private fun ActionLine(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector, destructive: Boolean, onClick: () -> Unit) {
    val ink = if (destructive) Tone.problem.color() else MaterialTheme.colorScheme.primary
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).ledgerRow(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, null, Modifier.size(20.dp), tint = ink)
        Text(text, color = ink, style = MaterialTheme.typography.bodyLarge)
    }
}

// MARK: Now

@Composable
private fun NowSection(
    karigar: Karigar,
    p: WorkshopPosition,
    open: KarigarPay.InBatch?,
    silver: KarigarPay.Silver?,
    owner: Boolean,
    onOpen: (String) -> Unit,
) {
    val cash = KarigarNow.cash(p)
    LedgerSection("Now", footer = { Text(KarigarNow.footnote(owner, silver)) }) {
        Box(Modifier.fillMaxWidth().clickable(role = Role.Button) { onOpen("/workshop?karigar=" + WorkshopLogic.piece(karigar.id)) }.ledgerRow()) {
            TwoLine(
                "On his bench",
                subtitle = if (p.bench.isEmpty()) "nothing open" else "oldest ${p.bench[0].ageDays} d",
                trailing = WorkshopLogic.pieces(p.bench.size),
            )
        }
        LedgerDivider()
        Box(Modifier.fillMaxWidth().ledgerRow()) {
            TwoLine(
                "Pieces weigh (est.)", subtitle = KarigarNow.weighHint(p),
                trailing = if (p.metals.isEmpty()) "—" else p.metals.joinToString(" · ") { WorkshopLogic.grams3(it.grams) },
            )
        }
        if (owner) {
            LedgerDivider()
            Box(Modifier.fillMaxWidth().clickable(role = Role.Button) { onOpen(KarigarNow.hisaabPath(karigar)) }.ledgerRow()) {
                TwoLine(
                    "Gold khata", subtitle = "given less received, in Hisaab", trailing = WorkshopLogic.grams3(p.khataNet),
                    trailingTint = if (p.khataNet > 0.0005) Tone.owed.color() else Color.Unspecified,
                )
            }
            LedgerDivider()
            Box(Modifier.fillMaxWidth().clickable(role = Role.Button) { onOpen(KarigarNow.hisaabPath(karigar)) }.ledgerRow()) {
                TwoLine(
                    KarigarNow.cashTitle(cash), subtitle = KarigarNow.cashHint(open), trailing = KarigarNow.cashValue(cash),
                    trailingTint = if (cash < 0) Tone.owed.color() else Color.Unspecified,
                )
            }
        }
    }
}

// MARK: The bench

@Composable
private fun BenchSection(karigar: Karigar, p: WorkshopPosition, onOpen: (String) -> Unit) {
    LedgerSection("On the bench") {
        DividedRows(p.bench.take(12)) { j ->
            val sub = ArrayList<String>()
            j.customerName?.takeIf { it.isNotEmpty() && j.source != WorkshopJob.Source.manual }?.let { sub.add(it) }
            j.weightG?.takeIf { it > 0 }?.let { sub.add(WorkshopLogic.grams3(it)) }
            Box(Modifier.fillMaxWidth().clickable(role = Role.Button) { onOpen(KarigarNow.benchPath(j, karigar)) }.ledgerRow()) {
                TwoLine(
                    j.description, subtitle = sub.joinToString(" · "), trailing = "${j.ageDays} d",
                    trailingTint = when (j.urgency) {
                        WorkshopJob.Urgency.critical -> Tone.late.color()
                        WorkshopJob.Urgency.warning -> Tone.owed.color()
                        WorkshopJob.Urgency.ok -> Color.Unspecified
                    },
                )
            }
        }
        if (p.bench.size > 12) {
            LedgerDivider()
            Box(Modifier.fillMaxWidth().clickable(role = Role.Button) { onOpen("/workshop?karigar=" + WorkshopLogic.piece(karigar.id)) }.ledgerRow()) {
                Text("All ${p.bench.size} in Workshop", color = MaterialTheme.colorScheme.primary)
            }
        }
    }
}

// MARK: His stock jobs

/** The jobs written up for him that no customer order stands behind: stock pieces, repairs, samples. */
@Composable
private fun StockJobsSection(karigar: Karigar, mine: List<KarigarJob>, owner: Boolean, onAssign: () -> Unit) {
    if (mine.isEmpty() && !owner) return
    LedgerSection("His jobs") {
        DividedRows(mine) { j ->
            val sub = ArrayList<String>()
            j.weightG?.takeIf { it > 0 }?.let { sub.add(WorkshopLogic.grams(it)) }
            if (j.assignedDate.isNotEmpty()) sub.add("written up " + ShopDate.say(j.assignedDate))
            Box(Modifier.fillMaxWidth().ledgerRow()) {
                TwoLine(
                    j.description, subtitle = sub.joinToString(" · "), trailing = WorkshopStatusWords.say(j.status),
                    trailingTint = if (j.status == KarigarJobStatus.completed) Tone.settled.color() else Color.Unspecified,
                )
            }
        }
        if (owner) {
            if (mine.isNotEmpty()) LedgerDivider()
            // The Workshop's Assign Stock Work, with him chosen (the web's "Assign" on his card).
            ActionLine("Assign stock work", Icons.Filled.AddCircle, false, onAssign)
        }
    }
}

// MARK: Hisaab (owners only)

/** The gold khata (Gold Khata on the web): gold handed to him, pieces received back, what is still with him, and its rows with the cash beside them. */
@Composable
private fun HisaabSection(karigar: Karigar, p: WorkshopPosition, rows: List<HisaabEntry>, onOpen: (String) -> Unit) {
    if (rows.isEmpty()) return
    val net = p.khataNet
    val netTint = if (net > 0.0005) Tone.owed.color() else if (net < -0.0005) Tone.settled.color() else Color.Unspecified
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LedgerHeading("Hisaab", Modifier.padding(horizontal = 16.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            FigureTile("Given", WorkshopLogic.grams3(p.khataGiven), Modifier.weight(1f))
            FigureTile("Received", WorkshopLogic.grams3(p.khataBack), Modifier.weight(1f))
            FigureTile("Net (out)", WorkshopLogic.grams3(net), Modifier.weight(1f), tint = netTint)
        }
        Column(Modifier.fillMaxWidth().ledgerCardRows()) {
            DividedRows(rows.take(8)) { e ->
                Box(Modifier.fillMaxWidth().ledgerRow()) {
                    TwoLine(
                        e.description.ifEmpty { "Entry" }, subtitle = ShopDate.say(e.date), trailing = KarigarNow.hisaabAmount(e),
                        trailingTint = if (e.goldDebitGrams > 0) Tone.owed.color() else if (e.goldCreditGrams > 0) Tone.settled.color() else Color.Unspecified,
                    )
                }
            }
            LedgerDivider()
            Box(Modifier.fillMaxWidth().clickable(role = Role.Button) { onOpen(KarigarNow.hisaabPath(karigar)) }.ledgerRow()) {
                Text(if (rows.size > 8) "All ${rows.size} entries in Hisaab" else "Open in Hisaab", color = MaterialTheme.colorScheme.primary)
            }
        }
        Text("${rows.size} entries · net = gold still with the karigar", Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** The card the rows of a section sit on. */
@Composable
private fun Modifier.ledgerCardRows(): Modifier =
    this.clip(Radius.cardShape).background(ErpColors.card)

// MARK: Pay batch (owners only)

/**
 * The open pay batch and what is in it, with Add payment, Silver and Settle; or, with none open, the way to start one
 * (the web's "No active pay batch" card). A payment from here always goes into the open batch.
 */
@Composable
private fun PayBatchSection(pay: KarigarPay.Figures, onAsk: (WorkshopPayAsk) -> Unit) {
    val open = pay.open
    if (open != null) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.LockOpen, null, Modifier.size(18.dp))
                Text(open.batch.label.ifEmpty { "Pay batch" }, style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold))
                Pill("Active", tone = Tone.settled)
            }
            Column(Modifier.fillMaxWidth().ledgerCardRows()) {
                Box(Modifier.fillMaxWidth().ledgerRow()) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("Pay batch total", Modifier.weight(1f))
                        Text(PaymentText.pkr(open.total), style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = "tnum"))
                    }
                }
                if (open.payments.isEmpty()) {
                    LedgerDivider()
                    Box(Modifier.fillMaxWidth().ledgerRow()) {
                        Text(
                            "No payments recorded. Select “Add payment” to record one.",
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                for (e in open.payments) {
                    LedgerDivider()
                    Box(Modifier.fillMaxWidth().ledgerRow()) { PaymentRow(e) }
                }
                LedgerDivider()
                ActionLine("Add payment", Icons.Filled.AddCircle, false) { onAsk(WorkshopPayAsk.Pay(open.batch)) }
                LedgerDivider()
                ActionLine("Silver", Icons.Filled.Scale, false) { onAsk(WorkshopPayAsk.Silver) }
                LedgerDivider()
                SettleLine { onAsk(WorkshopPayAsk.Settle(open)) }
            }
            Text(KarigarNow.startedWords(open), Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    } else {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            LedgerHeading("Pay batch", Modifier.padding(horizontal = 16.dp))
            Column(Modifier.fillMaxWidth().ledgerCardRows()) {
                Column(Modifier.fillMaxWidth().ledgerRow(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("No active pay batch", style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold))
                    Text("Start a new hisaab to track payments in batches.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                LedgerDivider()
                ActionLine("Start a pay batch", Icons.Filled.AddCircle, false) { onAsk(WorkshopPayAsk.Start) }
            }
        }
    }
}

@Composable
private fun SettleLine(onClick: () -> Unit) {
    val ink = Tone.settled.color()
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).ledgerRow(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(Icons.Filled.CheckCircle, null, Modifier.size(20.dp), tint = ink)
        Text("Settle", color = ink, style = MaterialTheme.typography.bodyLarge)
    }
}

/** One payment: what it was for, when and under which category, and how much. */
@Composable
private fun PaymentRow(e: Expense) {
    TwoLine(
        e.description.ifEmpty { e.category.ifEmpty { "Payment" } },
        subtitle = listOf(ShopDate.say(e.date), e.category).filter { it.isNotEmpty() }.joinToString(" · "),
        trailing = PaymentText.pkr(e.amount),
    )
}

// MARK: Silver (owners only)

@Composable
private fun SilverSection(silver: KarigarPay.Silver, onAdd: () -> Unit, onDelete: (KarigarSilverTransaction) -> Unit) {
    LedgerSection(
        "Silver transactions",
        footer = { Text("${WorkshopLogic.grams3(silver.grams)} received · ${PaymentText.pkr(silver.surcharge)} surcharge") },
    ) {
        DividedRows(silver.rows) { t ->
            Row(Modifier.fillMaxWidth().ledgerRow(), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) {
                    TwoLine(
                        (t.description ?: "").ifEmpty { "—" },
                        subtitle = listOf(ShopDate.say(t.date), "${WorkshopLogic.grams3(t.silverGrams)} at ${PaymentText.pkr(t.surchargePerGram)}/g")
                            .filter { it.isNotEmpty() }.joinToString(" · "),
                        trailing = PaymentText.pkr(t.totalSurcharge),
                    )
                }
                IconButton(onClick = { onDelete(t) }, Modifier.size(MinTouchTarget)) {
                    Icon(Icons.Filled.Delete, "Delete this silver entry", tint = Tone.problem.color())
                }
            }
        }
        LedgerDivider()
        ActionLine("Silver", Icons.Filled.AddCircle, false, onAdd)
    }
}

// MARK: Who he is

@Composable
private fun ProfileSection(karigar: Karigar, pay: KarigarPay.Figures?, onDial: (String) -> Unit) {
    LedgerSection("Details") {
        val rows = ArrayList<@Composable () -> Unit>()
        karigar.contact?.takeIf { it.isNotEmpty() }?.let { contact ->
            rows.add {
                Row(
                    Modifier.fillMaxWidth().clickable(role = Role.Button, onClickLabel = "Call $contact") { onDial(contact) }.ledgerRow(),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Icon(Icons.Filled.Phone, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.primary)
                    Text(contact, color = MaterialTheme.colorScheme.primary)
                }
            }
        }
        karigar.specialty?.takeIf { it.isNotEmpty() }?.let { s ->
            rows.add { IconLine(Icons.Filled.Handyman, s) }
        }
        karigar.notes?.takeIf { it.isNotEmpty() }?.let { n ->
            rows.add { IconLine(Icons.Filled.NoteAlt, n) }
        }
        if (pay != null) {
            rows.add {
                Row(Modifier.fillMaxWidth().ledgerRow(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Total paid (all time)", Modifier.weight(1f))
                    Text(PaymentText.pkr(pay.totalPaid), style = MaterialTheme.typography.bodyLarge.copy(fontFeatureSettings = "tnum"))
                }
            }
            rows.add {
                Row(Modifier.fillMaxWidth().ledgerRow(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Active pay batch", Modifier.weight(1f))
                    val label = pay.open?.batch?.label.orEmpty()
                    if (label.isNotEmpty()) Text(label) else Text("None", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        rows.forEachIndexed { i, r ->
            if (i > 0) LedgerDivider()
            r()
        }
        if (rows.isEmpty()) Box(Modifier.fillMaxWidth().ledgerRow()) { Text("Nothing on file.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

@Composable
private fun IconLine(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String) {
    Row(Modifier.fillMaxWidth().ledgerRow(), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(icon, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
