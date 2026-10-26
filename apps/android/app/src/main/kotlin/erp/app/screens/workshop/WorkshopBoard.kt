package erp.app.screens.workshop

import erp.app.ui.SearchBarField
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Handyman
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.NightsStay
import androidx.compose.material.icons.filled.PanoramaFishEye
import androidx.compose.material.icons.filled.Pending
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.ViewAgenda
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
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
import erp.app.ui.ChipRow
import erp.app.ui.FigureGrid
import erp.app.ui.FigureRow
import erp.app.ui.FigureTile
import erp.app.ui.FailureAlert
import erp.app.ui.FilterChip
import erp.app.ui.LedgerHeading
import erp.app.ui.LocalNoteState
import erp.app.ui.MinTouchTarget
import erp.app.ui.NotAvailableState
import erp.app.ui.Note
import erp.app.ui.rememberHaptics
import erp.app.ui.rememberLocalChanges
import erp.app.ui.Radius
import erp.app.ui.ShelfState
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.isLargeText
import erp.app.ui.ledgerCard
import erp.core.logic.Money
import erp.core.models.KarigarJob
import erp.core.models.KarigarJobStatus
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private val FilterSaver = listSaver<WorkshopFilter, String>(
    save = { listOf(it.query, it.status.name, it.type.name, it.takenBy, it.karigarId) },
    restore = {
        WorkshopFilter(
            query = it[0], status = WorkshopStatusFilter.valueOf(it[1]), type = WorkshopTypeFilter.valueOf(it[2]),
            takenBy = it[3], karigarId = it[4],
        )
    },
)

/**
 * The Workshop board (src/app/workshop/page.tsx): every piece on the bench, by karigar or by stage, what is overdue,
 * what has nobody on it, what has not left the shop. Pieces come from orders, from stock jobs and from invoices (a
 * Shopify sale is an invoice, and any invoice line handed to a karigar). What an owner does to a piece is a write
 * through the ERP: pick the karigar, tick it Given, tick it Done (an order's piece or a sold one); and stock work is
 * assigned (+), its status set, its making details changed and deleted (the delete code), as on the web's page. An
 * order's or a sold piece's making details are its Details sheet (the web's Details dialog).
 *
 * "/workshop?karigar=<id>" (the karigar page's "On his bench") opens on his whole bench; "/workshop?order=<id>" (an
 * order's Give out) shows that order's pieces alone.
 */
@Composable
fun WorkshopBoard(path: String) {
    val book = LocalBook.current
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val note = LocalNoteState.current
    val scope = rememberCoroutineScope()
    val owner = session.isOwner

    val karigarFromLink = remember(path) { WorkshopLogic.queryValue("karigar", path) ?: "" }
    val orderId = remember(path) { WorkshopLogic.queryValue("order", path) }
    val asksForWholeBench = karigarFromLink.isNotEmpty() || orderId != null

    // Whoever is signed in sees their own pieces first, Anyone one tap away; a karigar's whole bench opens on Anyone,
    // this once (hooks/use-me.ts `useMineFilter`). What is picked after holds while this screen is open.
    var filter by rememberSaveable(path, stateSaver = FilterSaver) {
        mutableStateOf(WorkshopFilter(karigarId = karigarFromLink, takenBy = if (asksForWholeBench) "" else session.shop.person ?: ""))
    }
    var focus by rememberSaveable { mutableStateOf(WorkshopFocus.all) }
    // The list is where the web opens (workshop/page.tsx `view`).
    var grouping by rememberSaveable { mutableStateOf(WorkshopGrouping.list) }
    var showFree by rememberSaveable { mutableStateOf(false) }
    var showTotals by rememberSaveable { mutableStateOf(false) }
    // What the person just did to a piece, until the shelf's copy says so: a tick leaves at once (Outbox).
    val patches = rememberLocalChanges<String, JobPatch>()
    val haptics = rememberHaptics()
    var failure by remember { mutableStateOf<String?>(null) }
    var assigning by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf<KarigarJob?>(null) }
    var editingPiece by remember { mutableStateOf<WorkshopPieceAsk?>(null) }
    var deletion by remember { mutableStateOf<WorkshopDeletion?>(null) }
    var deleted by remember { mutableStateOf(false) }

    val orders = rememberShelfStatus(book.orders)
    val invoices = rememberShelfStatus(book.invoices)
    val karigars = rememberShelfStatus(book.karigars)
    val stockJobs = rememberShelfStatus(book.karigarJobs)
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()
    val loaded = orders.loaded && invoices.loaded && karigars.loaded && stockJobs.loaded
    val firstError = orders.error ?: invoices.error ?: karigars.error ?: stockJobs.error

    val live = remember(karigars.revision) { workshopLive(karigars.items) }
    val jobs = remember(orders.revision, invoices.revision, karigars.revision, stockJobs.revision) {
        WorkshopLogic.buildJobs(orders.items, stockJobs.items, live, invoices.items)
    }
    val shownJobs = remember(jobs, patches.entries) { if (patches.isEmpty) jobs else jobs.map { WorkshopPatches.patched(it, patches[it.id]) } }
    // Drop what the shelf now says too.
    LaunchedEffect(jobs) { patches.reconcile { id, p -> jobs.firstOrNull { it.id == id }?.let { WorkshopPatches.agrees(it, p) } ?: true } }
    val all = remember(shownJobs, orderId) { if (orderId == null) shownJobs else shownJobs.filter { it.orderId == orderId } }
    val snap = remember(all, filter) { WorkshopSnapshot(all, filter) }
    val focused = snap.focused(focus)
    val busyIds = remember(snap) { snap.all.filter { !it.isDone }.map { it.karigarId }.toSet() }
    val choices = remember(live, busyIds) { WorkshopChoices(live, busyIds) }

    /** One write for one piece: the board shows it at once and the Outbox carries it (the shelf brings the real copy). */
    fun write(
        job: WorkshopJob, w: WorkshopWrite?,
        status: WorkshopJob.Status? = null, given: Boolean? = null, karigarId: String? = null,
    ) {
        if (w == null) return
        patches[job.id] = WorkshopPatches.next(job, patches[job.id], status, given, karigarId) { id -> book.karigars.item(id)?.name }
        haptics.success()
        // These say the state wanted (done, given, a karigar), so Done → Not done → Done within the ERP's 30-second
        // once-only window is three changes, not a repeat: `seq` makes each its own.
        ErpApi.shared.enqueue(w.op, w.fields + ("seq" to UUID.randomUUID().toString()), job.description)
    }

    val actions = remember(book, owner) {
        WorkshopActions(
            done = { job, done -> write(job, WorkshopWrites.done(job, done), status = if (done) WorkshopJob.Status.completed else WorkshopJob.Status.pending) },
            given = { job, given ->
                // Nobody to have given it to: refused here as on the web.
                if (job.isUnassigned && given) failure = WorkshopWrites.nobodyYet else write(job, WorkshopWrites.given(job, given), given = given)
            },
            assign = { job, karigarId -> write(job, WorkshopWrites.karigar(job, karigarId), karigarId = karigarId) },
            status = { job, status ->
                write(
                    job, WorkshopWrites.status(job, status),
                    status = when (status) {
                        KarigarJobStatus.completed -> WorkshopJob.Status.completed
                        KarigarJobStatus.inProgress -> WorkshopJob.Status.inProgress
                        else -> WorkshopJob.Status.pending
                    },
                )
            },
            details = { job ->
                // A stock job as it is on file: its sheet edits its own fields (the board's line merges the instructions).
                // An order's piece or a sold piece opens the Details sheet, the order piece with its sample picture.
                when (val t = WorkshopLogic.writeTarget(job)) {
                    is WorkshopLogic.WriteTarget.Stock -> {
                        val held = book.karigarJobs.item(t.id)
                        if (held != null) editing = held else failure = "This job is no longer on file."
                    }
                    is WorkshopLogic.WriteTarget.Order -> {
                        val item = book.orders.item(t.id)?.items?.getOrNull(t.index)
                        if (item == null) failure = "This piece is no longer on the order."
                        else editingPiece = WorkshopPieceAsk(job, WorkshopPieceAsk.Target.Order(t.id, t.index), item.samplePhotoId, item.sampleImageDataUri)
                    }
                    is WorkshopLogic.WriteTarget.Invoice -> editingPiece = WorkshopPieceAsk(job, WorkshopPieceAsk.Target.Invoice(t.id, t.index))
                    null -> Unit
                }
            },
            delete = { job ->
                // The web's "Delete this job?": the job goes from the Workshop and his page; nothing else is touched.
                val t = WorkshopLogic.writeTarget(job) as? WorkshopLogic.WriteTarget.Stock
                if (t != null) {
                    val who = if (job.isUnassigned) "" else " It comes off ${job.karigarName}'s bench."
                    deletion = WorkshopDeletion(
                        what = "Delete this karigar job",
                        detail = "“${job.description}” will be removed.$who",
                        run = { code -> WorkshopWrites.deleteStockJob(t.id, code).let { ErpApi.shared.write(it.op, it.fields) } },
                    )
                }
            },
            open = { navigator.open(it) },
        )
    }

    ScreenTitle(if (orderId == null) "Workshop" else "Give out")
    if (orderId == null) {
        ScreenActions {
            FilterMenu(filter, session.shop.takenBy, live) { filter = it }
            if (owner) {
                // The karigar in focus is the one the work goes to, as the web's "Assign" on his card.
                IconButton(onClick = { assigning = filter.karigarId }) { Icon(Icons.Filled.Add, "Assign stock work") }
            }
            MoreMenu(owner, onAssign = { assigning = filter.karigarId }, onOpen = { navigator.open(it) })
        }
    }

    ShelfState(loaded = loaded, error = firstError, offline = orders.offline, connectionLost = connectionLost) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val large = isLargeText()
            val columns = workshopColumns((maxWidth - 32.dp).value, large, 420f)
            val ctx = BoardContext(columns, owner, emptySet(), choices, actions)
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 96.dp)) {
                if (orderId == null) {
                    item(key = "search") {
                        SearchBarField(
                            value = filter.query,
                            onValueChange = { filter = filter.copy(query = it) },
                            modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
                            placeholder = { Text("Item, karigar, customer, order") },
                            leadingIcon = { Icon(Icons.Filled.Search, null) },
                            trailingIcon = {
                                if (filter.query.isNotEmpty()) IconButton(onClick = { filter = filter.copy(query = "") }) { Icon(Icons.Filled.Close, "Clear search") }
                            },
                            singleLine = true,
                            shape = Radius.chipShape,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        )
                    }
                    item(key = "figures") {
                        FigureRow(Modifier.padding(bottom = 12.dp)) {
                            FigureTile("All active pieces", "${snap.stats.active}", Modifier.share())
                            FigureTile("Benches working", "${snap.stats.workers}", Modifier.share())
                        }
                    }
                    item(key = "controls") {
                        ControlBar(
                            snap, focus, { focus = it }, grouping, { grouping = it }, filter,
                            karigarName = karigars.items.firstOrNull { it.id == filter.karigarId }?.name ?: "one karigar",
                            onReset = { filter = WorkshopFilter() },
                            onEveryone = { filter = filter.copy(karigarId = "") },
                        )
                    }
                } else {
                    item(key = "order") {
                        Column(Modifier.padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(orderId, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold))
                            Text(
                                "Choose a karigar, then mark the piece Given when it leaves the shop.",
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                when (grouping) {
                    WorkshopGrouping.karigar ->
                        if (filter.karigarId.isEmpty() || focus == WorkshopFocus.unassigned) {
                            karigarSections(ctx, snap, focused, live, focus, filter, showTotals, { showTotals = it }, showFree, { showFree = it })
                        } else {
                            focusedKarigar(ctx, focused, filter)
                        }
                    WorkshopGrouping.stage -> stageSections(ctx, focused)
                    WorkshopGrouping.list -> if (focused.isNotEmpty()) {
                        item(key = "pieces") { Box(Modifier.padding(bottom = 8.dp)) { LedgerHeading("Pieces", count = focused.size) } }
                        jobCards(ctx, focused, showKarigar = true, "list")
                    }
                }
                if (focused.isEmpty()) {
                    item(key = "empty") { EmptyState(focus, snap.all.isNotEmpty()) }
                }
            }
        }
    }

    FailureAlert(failure, onDismiss = { failure = null }, title = "Not changed")
    assigning?.let { preset -> WorkshopStockJobSheet(live, preset) { assigning = null } }
    editing?.let { job -> WorkshopJobDetailsSheet(job) { editing = null } }
    editingPiece?.let { ask -> WorkshopPieceDetailsSheet(ask) { editingPiece = null } }
    deletion?.let { d ->
        WorkshopDeleteCodeSheet(d, onDismiss = { deletion = null }, onDone = { note.show(Note("Job deleted")) })
    }
}

/** What the board's sections share. */
private class BoardContext(
    val columns: Int,
    val isOwner: Boolean,
    val busy: Set<String>,
    val choices: WorkshopChoices,
    val actions: WorkshopActions,
)

private fun LazyListScope.jobCards(ctx: BoardContext, jobs: List<WorkshopJob>, showKarigar: Boolean, scope: String) {
    workshopCardRows(jobs, ctx.columns, scope, key = { it.id }) { job ->
        WorkshopJobRow(job, showKarigar, ctx.isOwner, job.id in ctx.busy, ctx.choices, ctx.actions)
    }
}

// MARK: By karigar

private fun LazyListScope.karigarSections(
    ctx: BoardContext,
    snap: WorkshopSnapshot,
    focused: List<WorkshopJob>,
    live: List<erp.core.models.Karigar>,
    focus: WorkshopFocus,
    filter: WorkshopFilter,
    showTotals: Boolean,
    setTotals: (Boolean) -> Unit,
    showFree: Boolean,
    setFree: (Boolean) -> Unit,
) {
    if (focus == WorkshopFocus.all && focused.isNotEmpty()) {
        item(key = "glance") { Glance(WorkshopLogic.groupByKarigar(snap.bench), ctx.isOwner, showTotals, setTotals) }
    }
    for (load in WorkshopLogic.groupByKarigar(focused)) {
        item(key = "head:${load.karigarId}") { KarigarHeader(load, ctx.actions) }
        jobCards(ctx, WorkshopLogic.byOrder(load.jobs), showKarigar = false, "k:${load.karigarId}")
    }
    if (focus == WorkshopFocus.all && !filter.narrowed && filter.karigarId.isEmpty()) {
        val busyIds = snap.bench.filter { !it.isDone }.map { it.karigarId }.toSet()
        val idle = live.filter { it.id !in busyIds }
        if (idle.isNotEmpty()) item(key = "free") { FreeSection(idle, showFree, setFree, ctx.actions) }
    }
}

/** The whole bench in six figures: the numbers keep showing everyone while one karigar is focused. */
@Composable
private fun Glance(loads: List<WorkshopLoad>, owner: Boolean, open: Boolean, setOpen: (Boolean) -> Unit) {
    val active = loads.sumOf { it.active }
    val late = loads.sumOf { it.late }
    val critical = loads.sumOf { it.critical }
    val grams = loads.fold(0.0) { s, l -> s + l.totalWeightG }
    val value = loads.fold(0.0) { s, l -> s + l.totalValue }
    val working = loads.count { !it.isUnassigned && it.active > 0 }
    Column(Modifier.fillMaxWidth().padding(bottom = 16.dp)) {
        Row(
            Modifier.fillMaxWidth().defaultMinSize(minHeight = MinTouchTarget).clickable(role = Role.Button, onClickLabel = if (open) "Hide bench totals" else "Show bench totals") { setOpen(!open) },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Bench totals", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium))
            Icon(Icons.Filled.ExpandMore, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        AnimatedVisibility(open) {
            FigureGrid(Modifier.padding(vertical = 4.dp)) {
                FigureTile("Pieces out", "$active")
                FigureTile("Benches working", "$working")
                FigureTile("Late ${WorkshopLogic.warnDays}d+", "$late", tint = if (late > 0) Tone.owed.color() else Color.Unspecified)
                FigureTile("Critical ${WorkshopLogic.criticalDays}d+", "$critical", tint = if (critical > 0) Tone.late.color() else Color.Unspecified)
                FigureTile("Metal out", if (grams > 0) WorkshopLogic.number(grams, 1) + "g" else "—")
                if (owner) FigureTile("Value out", if (value > 0) Money.pkrLac(value) else "—")
            }
        }
    }
}

@Composable
private fun KarigarHeader(load: WorkshopLoad, actions: WorkshopActions) {
    Row(Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    if (load.isUnassigned) Icons.Filled.Warning else Icons.Filled.Handyman, null, Modifier.size(18.dp),
                    tint = if (load.isUnassigned) Tone.owed.color() else MaterialTheme.colorScheme.primary,
                )
                Text(
                    if (load.isUnassigned) "Unassigned" else load.karigarName,
                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                    color = if (load.isUnassigned) Tone.owed.color() else MaterialTheme.colorScheme.onSurface,
                )
            }
            Text(headerCounts(load), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        WorkshopUrgencyBadges(load.critical, load.late)
        if (!load.isUnassigned) {
            IconButton(onClick = { actions.open(WorkshopLogic.karigarPath(load.karigarId)) }, Modifier.size(MinTouchTarget)) {
                Icon(Icons.Filled.AccountCircle, "Open " + load.karigarName)
            }
        }
    }
}

/** "4 active · 2 in progress · oldest 9d · 12.5g out". */
private fun headerCounts(load: WorkshopLoad): String {
    val parts = arrayListOf("${load.active} active")
    if (load.inProgress != load.active && load.inProgress > 0) parts.add("${load.inProgress} in progress")
    if (load.oldestActiveDays > 0) parts.add("oldest ${load.oldestActiveDays}d")
    if (load.active > 0 && load.totalWeightG > 0) parts.add(WorkshopLogic.number(load.totalWeightG, 1) + "g out")
    if (load.completed > 0 && load.active == 0) parts.add("${load.completed} done")
    return parts.joinToString(" · ")
}

/** The karigars with nothing on the bench: these are the people the next job can go to. */
@Composable
private fun FreeSection(idle: List<erp.core.models.Karigar>, open: Boolean, setOpen: (Boolean) -> Unit, actions: WorkshopActions) {
    Column(Modifier.fillMaxWidth().padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Column(Modifier.ledgerCard(8.dp)) {
            Row(
                Modifier.fillMaxWidth().defaultMinSize(minHeight = MinTouchTarget).clickable(role = Role.Button, onClickLabel = if (open) "Hide the free karigars" else "Show the free karigars") { setOpen(!open) }
                    .padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(Icons.Filled.NightsStay, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("${idle.size} free", Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Icon(Icons.Filled.ExpandMore, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            AnimatedVisibility(open) {
                Column {
                    for (k in idle) {
                        Row(
                            Modifier.fillMaxWidth().defaultMinSize(minHeight = MinTouchTarget).clickable(role = Role.Button) { actions.open(WorkshopLogic.karigarPath(k.id)) }.padding(horizontal = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Icon(Icons.Filled.Handyman, null, Modifier.size(18.dp))
                            Text(k.name, Modifier.weight(1f))
                            Icon(Icons.Filled.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
        if (!open) {
            Text(idle.joinToString(", ") { it.name }, Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

// MARK: One karigar, whole

/** One karigar selected: their numbers and their pieces sectioned by how long they have sat. */
private fun LazyListScope.focusedKarigar(ctx: BoardContext, focused: List<WorkshopJob>, filter: WorkshopFilter) {
    val load = WorkshopLogic.groupByKarigar(focused).firstOrNull() ?: return
    val active = load.jobs.filter { !it.isDone }
    fun oldestFirst(list: List<WorkshopJob>) = list.withIndex().sortedWith(compareByDescending<IndexedValue<WorkshopJob>> { it.value.ageDays }.thenBy { it.index }).map { it.value }
    val critical = oldestFirst(active.filter { it.urgency == WorkshopJob.Urgency.critical })
    val late = oldestFirst(active.filter { it.urgency == WorkshopJob.Urgency.warning })
    val onTrack = oldestFirst(active.filter { it.urgency == WorkshopJob.Urgency.ok })
    val done = load.jobs.filter { it.isDone }
    val orders = active.mapNotNull { it.orderId }.toSet().size
    item(key = "summary") { FocusedSummary(load, orders, ctx.isOwner, ctx.actions) }
    urgencySection(ctx, "Critical", "sitting ${WorkshopLogic.criticalDays}+ days", Tone.late, critical)
    urgencySection(ctx, "Late", "${WorkshopLogic.warnDays}–${WorkshopLogic.criticalDays} days", Tone.owed, late)
    urgencySection(ctx, "On track", "", Tone.quiet, onTrack)
    if (filter.status == WorkshopStatusFilter.all || filter.status == WorkshopStatusFilter.completed) {
        urgencySection(ctx, "Completed", "", Tone.quiet, done)
    }
}

private fun LazyListScope.urgencySection(ctx: BoardContext, title: String, hint: String, tone: Tone, jobs: List<WorkshopJob>) {
    if (jobs.isEmpty()) return
    item(key = "u:$title") { Box(Modifier.padding(bottom = 8.dp)) { LedgerHeading(title, count = jobs.size, trailing = hint.ifEmpty { null }, tone = tone) } }
    jobCards(ctx, WorkshopLogic.byOrder(jobs), showKarigar = false, "u:$title")
}

@Composable
private fun FocusedSummary(load: WorkshopLoad, orders: Int, owner: Boolean, actions: WorkshopActions) {
    Column(Modifier.fillMaxWidth().padding(bottom = 16.dp).ledgerCard(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(
            Modifier.fillMaxWidth().defaultMinSize(minHeight = MinTouchTarget)
                .let { if (load.isUnassigned) it else it.clickable(role = Role.Button, onClickLabel = "Open " + load.karigarName) { actions.open(WorkshopLogic.karigarPath(load.karigarId)) } },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(if (load.isUnassigned) "Unassigned work" else load.karigarName, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold))
                Text(focusedSentence(load, orders), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (!load.isUnassigned) Icon(Icons.Filled.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        FocusedCells(load, owner)
    }
}

fun focusedSentence(load: WorkshopLoad, orders: Int): String {
    var s = "${load.active} active job${if (load.active == 1) "" else "s"}"
    if (orders > 0) s += " across $orders order${if (orders == 1) "" else "s"}"
    if (load.oldestActiveDays > 0) s += " · oldest ${load.oldestActiveDays} days"
    return s
}

/** The one karigar's cells: only those that say something, and no zero printed as a muted 0. */
class WorkshopCell(val label: String, val value: String, val tone: Tone)

fun focusedCells(load: WorkshopLoad, showValue: Boolean): List<WorkshopCell> {
    val out = arrayListOf(WorkshopCell("Active", "${load.active}", Tone.quiet))
    if (load.inProgress != load.active) out.add(WorkshopCell("In progress", "${load.inProgress}", Tone.working))
    if (load.late > 0) out.add(WorkshopCell("Late ${WorkshopLogic.warnDays}d+", "${load.late}", Tone.owed))
    if (load.critical > 0) out.add(WorkshopCell("Critical ${WorkshopLogic.criticalDays}d+", "${load.critical}", Tone.late))
    if (load.totalWeightG > 0) out.add(WorkshopCell("Metal out", WorkshopLogic.number(load.totalWeightG, 1) + "g", Tone.quiet))
    if (showValue && load.totalValue > 0) out.add(WorkshopCell("Value", Money.pkrLac(load.totalValue), Tone.quiet))
    return out
}

@Composable
private fun FocusedCells(load: WorkshopLoad, showValue: Boolean) {
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
        for (c in focusedCells(load, showValue)) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(c.label.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                Text(
                    c.value, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold, fontFeatureSettings = "tnum"),
                    color = if (c.tone == Tone.quiet) MaterialTheme.colorScheme.onSurface else c.tone.color(),
                )
            }
        }
    }
}

// MARK: By stage

private class Stage(val status: WorkshopJob.Status, val title: String, val icon: ImageVector)

private val stages = listOf(
    Stage(WorkshopJob.Status.pending, "Pending", Icons.Filled.PanoramaFishEye),
    Stage(WorkshopJob.Status.inProgress, "In Progress", Icons.Filled.Pending),
    Stage(WorkshopJob.Status.completed, "Completed", Icons.Filled.CheckCircle),
)

private fun LazyListScope.stageSections(ctx: BoardContext, focused: List<WorkshopJob>) {
    for (stage in stages) {
        val jobs = focused.filter { it.status == stage.status }
        if (jobs.isEmpty()) continue
        item(key = "stage:${stage.title}") {
            Row(Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(stage.icon, null, Modifier.size(18.dp))
                Text(stage.title, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold))
                WorkshopUrgencyBadges(jobs.count { it.urgency == WorkshopJob.Urgency.critical }, jobs.count { it.urgency == WorkshopJob.Urgency.warning })
                Text("${jobs.size}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        jobCards(ctx, jobs, showKarigar = true, "s:${stage.title}")
    }
}

// MARK: The controls above the list

@Composable
private fun ControlBar(
    snap: WorkshopSnapshot,
    focus: WorkshopFocus,
    setFocus: (WorkshopFocus) -> Unit,
    grouping: WorkshopGrouping,
    setGrouping: (WorkshopGrouping) -> Unit,
    filter: WorkshopFilter,
    karigarName: String,
    onReset: () -> Unit,
    onEveryone: () -> Unit,
) {
    var groupMenu by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        // Filters scroll with the queue, and an empty queue keeps them reachable.
        ChipRow(Modifier.padding(horizontal = 0.dp)) {
            for (f in WorkshopFocus.values()) FilterChip(f.chip, chosen = focus == f, onClick = { setFocus(f) }, count = snap.count(f))
        }
        FigureRow(verticalAlignment = Alignment.CenterVertically) {
            Box {
                TextButton(onClick = { groupMenu = true }, Modifier.defaultMinSize(minHeight = MinTouchTarget)) {
                    Icon(Icons.Filled.ViewAgenda, null, Modifier.size(18.dp))
                    Text(if (grouping == WorkshopGrouping.list) "All pieces" else grouping.title, Modifier.padding(start = 6.dp))
                }
                DropdownMenu(expanded = groupMenu, onDismissRequest = { groupMenu = false }) {
                    MenuHeader("Group by")
                    for (g in WorkshopGrouping.values()) {
                        DropdownMenuItem(
                            text = { Text(g.title) },
                            leadingIcon = if (g == grouping) ({ Icon(Icons.Filled.Check, null) }) else null,
                            onClick = { groupMenu = false; setGrouping(g) },
                        )
                    }
                }
            }
            if (filter.menuCount > 0) {
                TextButton(onClick = onReset, Modifier.defaultMinSize(minHeight = MinTouchTarget)) { Text("Reset filters") }
            }
        }
        val words = activeFilterWords(filter)
        if (words.isNotEmpty()) Text(words, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (filter.karigarId.isNotEmpty()) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Showing $karigarName", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = onEveryone) { Text("Everyone", style = MaterialTheme.typography.bodySmall) }
            }
        }
    }
}

fun activeFilterWords(filter: WorkshopFilter): String {
    val words = ArrayList<String>()
    if (filter.takenBy.isNotEmpty()) words.add("Taken by " + filter.takenBy)
    if (filter.type != WorkshopTypeFilter.all) words.add(filter.type.title)
    if (filter.status != WorkshopStatusFilter.active) words.add(filter.status.title)
    return words.joinToString(" · ")
}

@Composable
private fun MenuHeader(text: String) {
    Text(
        text, Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
        style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun Choice(title: String, chosen: Boolean, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(title) },
        leadingIcon = if (chosen) ({ Icon(Icons.Filled.Check, null) }) else null,
        onClick = onClick,
    )
}

/** The toolbar's filter menu: Taken by, Work, Karigar, Status. */
@Composable
private fun FilterMenu(filter: WorkshopFilter, people: List<String>, live: List<erp.core.models.Karigar>, set: (WorkshopFilter) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }) {
            Icon(Icons.Filled.FilterList, "Filter", tint = if (filter.menuCount > 0) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            if (people.isNotEmpty()) {
                MenuHeader("Taken by")
                Choice("Anyone", filter.takenBy.isEmpty()) { open = false; set(filter.copy(takenBy = "")) }
                for (p in people) Choice(p, filter.takenBy == p) { open = false; set(filter.copy(takenBy = p)) }
            }
            MenuHeader("Work")
            for (t in WorkshopTypeFilter.values()) Choice(t.title, filter.type == t) { open = false; set(filter.copy(type = t)) }
            MenuHeader("Karigar")
            Choice("Everyone", filter.karigarId.isEmpty()) { open = false; set(filter.copy(karigarId = "")) }
            for (k in live) Choice(k.name, filter.karigarId == k.id) { open = false; set(filter.copy(karigarId = k.id)) }
            MenuHeader("Status")
            for (s in WorkshopStatusFilter.values()) Choice(s.title, filter.status == s) { open = false; set(filter.copy(status = s)) }
        }
    }
}

/** The Workshop's other places. */
@Composable
private fun MoreMenu(owner: Boolean, onAssign: () -> Unit, onOpen: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }) { Icon(Icons.Filled.MoreVert, "More") }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            if (owner) {
                DropdownMenuItem(text = { Text("Assign stock work") }, leadingIcon = { Icon(Icons.Filled.Add, null) }, onClick = { open = false; onAssign() })
            }
            DropdownMenuItem(text = { Text("Karigars") }, leadingIcon = { Icon(Icons.Filled.Group, null) }, onClick = { open = false; onOpen("/karigars") })
            DropdownMenuItem(text = { Text("Given items") }, leadingIcon = { Icon(Icons.Filled.Inventory2, null) }, onClick = { open = false; onOpen("/given") })
        }
    }
}

/** What the board says when its queue is empty: one line per queue. */
fun emptyWords(focus: WorkshopFocus, anyWork: Boolean): Pair<String, String> = when (focus) {
    WorkshopFocus.unassigned -> "All work is assigned" to "No work is awaiting assignment."
    WorkshopFocus.attention -> "No work requires attention" to "No overdue or unassigned work."
    WorkshopFocus.notGiven -> "Everything assigned has been given" to "No piece with a karigar is still in the safe."
    WorkshopFocus.all -> if (anyWork) "No jobs match" to "Try adjusting the search or filters." else "No pending work" to "Nothing is on the bench."
}

@Composable
private fun EmptyState(focus: WorkshopFocus, anyWork: Boolean) {
    val (title, why) = emptyWords(focus, anyWork)
    val icon = if (focus == WorkshopFocus.all) Icons.Filled.Handyman else Icons.Filled.CheckCircle
    NotAvailableState(title, why = why, icon = icon)
}
