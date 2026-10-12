package erp.app.screens.workshop

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Book
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.data.Connection
import erp.app.data.LocalBook
import erp.app.data.rememberShelfStatus
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.ui.ChipRow
import erp.app.ui.FigureGrid
import erp.app.ui.FigureTile
import erp.app.ui.FilterChip
import erp.app.ui.LedgerHeading
import erp.app.ui.NotAvailableState
import erp.app.ui.Pill
import erp.app.ui.Radius
import erp.app.ui.ShelfState
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.isLargeText
import erp.app.ui.theme.ErpColors
import erp.core.models.Karigar
import erp.core.models.KarigarBatch

/** Who to show (the list's three chips). */
enum class KarigarsShowing(val title: String) { everyone("Everyone"), working("Working"), free("Free") }

/** The list's figures and groups, worked out once from the books (karigars/page.tsx). */
class KarigarsReckoned(live: List<Karigar>, val loads: Map<String, WorkshopLoad>, val batches: Map<String, KarigarBatch>) {
    val pieces: Int
    val critical: Int
    val grams: Double
    val working: Int
    val live: Int = live.size

    init {
        var p = 0
        var c = 0
        var g = 0.0
        var w = 0
        for (k in live) {
            val l = loads[k.id] ?: continue
            p += l.active
            c += l.critical
            g += l.totalWeightG
            if (l.active > 0) w += 1
        }
        pieces = p
        critical = c
        grams = g
        working = w
    }
}

object KarigarsLogic {
    /** The one holding the most, and the most overdue, is the one to look at. */
    fun busier(a: Karigar, b: Karigar, loads: Map<String, WorkshopLoad>): Int {
        val ca = loads[a.id]?.critical ?: 0
        val cb = loads[b.id]?.critical ?: 0
        if (ca != cb) return cb.compareTo(ca)
        val na = loads[a.id]?.active ?: 0
        val nb = loads[b.id]?.active ?: 0
        if (na != nb) return nb.compareTo(na)
        return String.CASE_INSENSITIVE_ORDER.compare(a.name, b.name)
    }

    fun matches(k: Karigar, query: String): Boolean {
        val q = query.trim()
        if (q.isEmpty()) return true
        if (k.name.contains(q, ignoreCase = true)) return true
        return (k.contact ?: "").contains(q)
    }

    fun loadsById(jobs: List<WorkshopJob>): Map<String, WorkshopLoad> = WorkshopLogic.groupByKarigar(jobs).associateBy { it.karigarId }

    /** The working karigars (busiest first) and the free ones, for a search and a chip. */
    fun split(live: List<Karigar>, loads: Map<String, WorkshopLoad>, query: String): Pair<List<Karigar>, List<Karigar>> {
        val matched = live.filter { matches(it, query) }
        val working = matched.filter { (loads[it.id]?.active ?: 0) > 0 }.withIndex()
            .sortedWith { a, b -> busier(a.value, b.value, loads).let { if (it != 0) it else a.index.compareTo(b.index) } }.map { it.value }
        val free = matched.filter { (loads[it.id]?.active ?: 0) == 0 }
        return working to free
    }
}

/**
 * The karigars (src/app/karigars/page.tsx): not a phone book but a list of what each one is holding right now.
 * Working first, the busiest and most overdue on top, then the free ones; each card says how many pieces are on the
 * bench and how many are overdue. A new karigar is the karigar form (owners).
 */
@Composable
fun WorkshopKarigarsList() {
    val book = LocalBook.current
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val owner = session.isOwner
    val karigars = rememberShelfStatus(book.karigars)
    val orders = rememberShelfStatus(book.orders)
    val invoices = rememberShelfStatus(book.invoices)
    val stockJobs = rememberShelfStatus(book.karigarJobs)
    // The pay batches are the owner's books: the staff's copy comes without them.
    LaunchedEffect(owner) { if (owner) book.karigarBatches.need() }
    val batchItems by book.karigarBatches.items.collectAsStateWithLifecycle()
    val batchesLoaded by book.karigarBatches.loaded.collectAsStateWithLifecycle()
    val batchesError by book.karigarBatches.error.collectAsStateWithLifecycle()
    val batchesRevision by book.karigarBatches.revision.collectAsStateWithLifecycle()
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()

    var query by rememberSaveable { mutableStateOf("") }
    var show by rememberSaveable { mutableStateOf(KarigarsShowing.everyone) }

    val books = karigars.loaded && orders.loaded && invoices.loaded && stockJobs.loaded
    val loaded = if (owner) books && batchesLoaded else books
    val coreError = karigars.error ?: orders.error ?: invoices.error ?: stockJobs.error
    val firstError = if (owner) coreError ?: batchesError else coreError

    val reckoned = remember(karigars.revision, orders.revision, invoices.revision, stockJobs.revision, batchesRevision, owner) {
        val live = workshopLive(karigars.items)
        val jobs = WorkshopLogic.buildJobs(orders.items, stockJobs.items, live, invoices.items)
        // Who has a hisaab open, and under what name (karigars/page.tsx activeHisaabMap).
        val batches = if (owner) WorkshopLogic.openBatches(batchItems) else emptyMap()
        Triple(live, KarigarsLogic.loadsById(jobs), batches)
    }
    val (live, loads, batches) = reckoned
    val split = remember(reckoned, query) { KarigarsLogic.split(live, loads, query) }
    val (working, free) = split
    val figures = remember(reckoned) { KarigarsReckoned(live, loads, batches) }

    ScreenTitle("Karigars")
    if (owner) {
        ScreenActions {
            // The karigar form: an owner's, as the ERP's menu has it.
            IconButton(onClick = { navigator.open("/karigars/add") }) { Icon(Icons.Filled.Add, "Add karigar") }
        }
    }

    ShelfState(loaded = loaded, error = firstError, offline = karigars.offline, connectionLost = connectionLost) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val columns = workshopColumns((maxWidth - 32.dp).value, isLargeText(), 340f)
            val matchedCount = working.size + free.size
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 96.dp)) {
                item(key = "search") {
                    OutlinedTextField(
                        value = query,
                        onValueChange = { query = it },
                        modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
                        placeholder = { Text("Name or contact") },
                        leadingIcon = { Icon(Icons.Filled.Search, null) },
                        trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Icons.Filled.Close, "Clear search") } },
                        singleLine = true,
                        shape = Radius.chipShape,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    )
                }
                item(key = "figures") {
                    FigureGrid(Modifier.padding(bottom = 12.dp)) {
                        FigureTile("Working now", "${figures.working}", detail = "of ${figures.live} on file")
                        FigureTile(
                            "Pieces out", "${figures.pieces}",
                            detail = if (figures.grams > 0) WorkshopLogic.number(figures.grams, 0) + "g of metal" else null,
                        )
                        FigureTile("Over ${WorkshopLogic.criticalDays} days", "${figures.critical}", tint = if (figures.critical > 0) Tone.late.color() else Color.Unspecified)
                        if (owner) FigureTile("Open hisaabs", "${batches.size}")
                        else FigureTile("Free", "${figures.live - figures.working}", detail = "nothing on the bench")
                    }
                }
                item(key = "show") {
                    ChipRow(Modifier.padding(bottom = 12.dp)) {
                        for (s in KarigarsShowing.values()) FilterChip(s.title, chosen = show == s, onClick = { show = s })
                    }
                }
                if (show != KarigarsShowing.free && working.isNotEmpty()) {
                    item(key = "h:working") { Column(Modifier.padding(bottom = 8.dp)) { LedgerHeading("Working", count = working.size) } }
                    workshopCardRows(working, columns, "working", key = { it.id }) { k -> KarigarCard(k, loads[k.id], batches[k.id]) { navigator.open(WorkshopLogic.karigarPath(k.id)) } }
                }
                if (show != KarigarsShowing.working && free.isNotEmpty()) {
                    item(key = "h:free") { Column(Modifier.padding(bottom = 8.dp)) { LedgerHeading("Free", count = free.size) } }
                    workshopCardRows(free, columns, "free", key = { it.id }) { k -> KarigarCard(k, loads[k.id], batches[k.id]) { navigator.open(WorkshopLogic.karigarPath(k.id)) } }
                }
                if ((show == KarigarsShowing.working && working.isEmpty()) || (show == KarigarsShowing.free && free.isEmpty()) || matchedCount == 0) {
                    item(key = "empty") {
                        NotAvailableState(
                            "No karigars found",
                            why = if (query.isNotEmpty()) "Try a different search term." else "Add a karigar to begin.",
                            icon = Icons.Filled.Group,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun KarigarCard(k: Karigar, load: WorkshopLoad?, batch: KarigarBatch?, onOpen: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClickLabel = "Open " + k.name, onClick = onOpen),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(k.name, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold))
            Icon(Icons.Filled.ChevronRight, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        BenchLine(load)
        if (batch != null && batch.label.isNotEmpty()) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Book, null, Modifier.size(14.dp), tint = ErpColors.accent)
                Text(batch.label, style = MaterialTheme.typography.bodySmall, color = ErpColors.accent)
            }
        }
        k.contact?.takeIf { it.isNotEmpty() }?.let { contact ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Phone, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(contact, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** What this karigar is holding, in one line: "3 pieces · 1 over 14d · 2 late · 8.5g out", or Free. */
@Composable
private fun BenchLine(load: WorkshopLoad?) {
    if (load != null && load.active > 0) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(WorkshopLogic.pieces(load.active), style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = "tnum"))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (load.critical > 0) Pill("${load.critical} over ${WorkshopLogic.criticalDays}d", tone = Tone.late)
                if (load.late > 0) Pill("${load.late} late", tone = Tone.owed)
            }
            if (load.totalWeightG > 0) {
                Text(
                    WorkshopLogic.number(load.totalWeightG, 1) + "g out",
                    style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = "tnum"), color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    } else {
        Text("Free", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
