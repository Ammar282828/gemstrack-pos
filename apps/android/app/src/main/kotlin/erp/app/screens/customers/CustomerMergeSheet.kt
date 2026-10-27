package erp.app.screens.customers

import erp.app.ui.icons.Symbols
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.ui.OwnerDeleteCodeSheet
import erp.app.ui.OwnerDeletion
import erp.app.data.Connection
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.rememberShelfStatus
import erp.app.ui.FilterChip
import erp.app.ui.LedgerHeading
import erp.app.ui.NoteHost
import erp.app.ui.Note
import erp.app.ui.Radius
import erp.app.ui.ShelfState
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.TwoLine
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.rememberNoteState
import erp.app.ui.theme.ErpColors
import erp.core.models.Customer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Merge duplicate customers (the Customers page's "Merge duplicates" dialog): the pairs that look alike (the same
 * number, or names 85% alike: CustomerDuplicates, lib/customer-duplicates.ts), each with the customer to keep and the
 * one to delete, and a manual merge for any two the list missed.
 *
 * A merge moves the duplicate's invoices, orders, repairs, hisaab rows and given items to the customer kept, fills in
 * what only the duplicate knew (a number, an address), then deletes the duplicate's record for good (`mergeCustomers`,
 * lib/writes/customer-admin.ts). It says what moves, counted from the books, before it asks for the delete code, which
 * the ERP checks with the merge. Owners only, as the web's merge is a browser write the shop floor cannot make.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CustomerMergeSheet(onDismiss: () -> Unit) {
    val book = LocalBook.current
    val customers = rememberShelfStatus(book.customers)
    val invoices = rememberShelfStatus(book.invoices)
    val orders = rememberShelfStatus(book.orders)
    val hisaab = rememberShelfStatus(book.hisaab)
    val given = rememberShelfStatus(book.givenItems)
    val repairs = rememberShelfStatus(book.repairs)
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val note = rememberNoteState()

    val ready = customers.loaded && invoices.loaded && orders.loaded && hisaab.loaded && given.loaded && repairs.loaded
    val failure = customers.error ?: invoices.error ?: orders.error ?: hisaab.error ?: given.error ?: repairs.error

    /** The live book, as the web's `customers` (a removed customer is not in it). */
    val live = remember(customers.revision) { customers.items.filter { !CustomerKit.isRemoved(it) } }

    // Nil while it looks; found in the background, as the list of a few thousand customers is about two million pairs.
    var found by remember { mutableStateOf<List<CustomerDuplicates.Found>?>(null) }
    LaunchedEffect(customers.revision, customers.loaded) {
        if (!customers.loaded) return@LaunchedEffect
        val people = live.map { CustomerDuplicates.Candidate(it.id, it.name, it.phone ?: "") }
        found = withContext(Dispatchers.Default) { CustomerDuplicates.detect(people) }
    }

    // Pairs where the person turned keep and delete round, and pairs they said were not duplicates (by `Found.id`).
    var swapped by rememberSaveable { mutableStateOf(setOf<String>()) }
    var dismissed by rememberSaveable { mutableStateOf(setOf<String>()) }
    var keepId by rememberSaveable { mutableStateOf("") }
    var duplicateId by rememberSaveable { mutableStateOf("") }
    var keepSearch by rememberSaveable { mutableStateOf("") }
    var duplicateSearch by rememberSaveable { mutableStateOf("") }
    var deletion by remember { mutableStateOf<OwnerDeletion?>(null) }

    val counted = remember(invoices.revision, orders.revision, hisaab.revision, given.revision, repairs.revision, ready) {
        if (!ready) null else CustomerMergeBook(invoices.items, orders.items, hisaab.items, given.items, repairs.items)
    }
    fun moves(id: String): CustomerMergeCounts = counted?.counts(id) ?: CustomerMergeCounts()

    /** Says what moves before it asks for the code; the delete code is the web's `Merge, and delete customer <name>`. */
    fun ask(keep: Customer, duplicate: Customer) {
        val counts = moves(duplicate.id)
        val gone = CustomerKit.shown(duplicate)
        val kept = CustomerKit.shown(keep)
        val detail = if (counts.total == 0) {
            "$gone has no invoices, orders, repairs or hisaab, so only their record is deleted. $kept stays."
        } else {
            "$gone's ${counts.sentence} move to $kept, and $gone's record is deleted for good."
        }
        deletion = OwnerDeletion("Merge, and delete customer $gone", detail, run = { code ->
            val out = ErpApi.shared.write("mergeCustomers", mapOf("keepId" to keep.id, "deleteId" to duplicate.id, "deleteCode" to code))
            val moved = (out["updatedDocs"] as? Number)?.toInt() ?: 0
            note.show(Note("Customers merged", "$gone is gone. $moved record${if (moved == 1) "" else "s"} updated."))
            if (keepId == keep.id || duplicateId == duplicate.id) {
                keepId = ""
                duplicateId = ""
            }
        })
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = MaterialTheme.colorScheme.background) {
        Box(Modifier.fillMaxHeight(0.96f).fillMaxWidth()) {
            Column(Modifier.fillMaxSize().navigationBarsPadding()) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = onDismiss) { Text("Cancel") }
                    Text(
                        "Merge duplicates", Modifier.weight(1f).semantics { heading() },
                        style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center,
                    )
                    // Balances the Cancel button so the title sits in the middle.
                    Box(Modifier.padding(horizontal = 36.dp))
                }
                Box(Modifier.weight(1f)) {
                    ShelfState(loaded = ready, error = failure, offline = customers.offline, connectionLost = connectionLost) {
                        val byId = remember(live) { live.associateBy { it.id } }
                        val visible = (found ?: emptyList()).filter { it.id !in dismissed && byId[it.a] != null && byId[it.b] != null }
                        LazyColumn(
                            Modifier.fillMaxSize(),
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 32.dp),
                            verticalArrangement = Arrangement.spacedBy(20.dp),
                        ) {
                            if (found == null) {
                                item {
                                    Row(Modifier.fillMaxWidth().card().padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                        SkeletonLoading(compact = true)
                                        Text("Looking for duplicates…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                            } else if (visible.isEmpty()) {
                                item {
                                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Text("No duplicates auto-detected.", Modifier.fillMaxWidth().card().padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        Text(
                                            "Customers who share a number, or whose names are almost the same, show up here.",
                                            Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                            } else {
                                items(visible, key = { it.id }) { pair ->
                                    val turned = pair.id in swapped
                                    val keep = byId[if (turned) pair.b else pair.a]
                                    val duplicate = byId[if (turned) pair.a else pair.b]
                                    if (keep != null && duplicate != null) {
                                        PairSection(
                                            pair, keep, duplicate, moves(duplicate.id),
                                            onSwap = { swapped = if (pair.id in swapped) swapped - pair.id else swapped + pair.id },
                                            onMerge = { ask(keep, duplicate) },
                                            onNot = { dismissed = dismissed + pair.id },
                                        )
                                    }
                                }
                            }
                            item {
                                ManualSection(
                                    keep = byId[keepId], duplicate = byId[duplicateId], live = live,
                                    keepId = keepId, duplicateId = duplicateId,
                                    keepSearch = keepSearch, duplicateSearch = duplicateSearch,
                                    onKeepSearch = { keepSearch = it }, onDuplicateSearch = { duplicateSearch = it },
                                    onKeep = { keepId = it }, onDuplicate = { duplicateId = it },
                                    moves = ::moves, onMerge = ::ask,
                                )
                            }
                        }
                    }
                }
            }
            NoteHost(note)
        }
    }
    deletion?.let { OwnerDeleteCodeSheet(it, onDismiss = { deletion = null }, onDone = {}) }
}

@Composable
private fun Modifier.card(): Modifier = clip(Radius.cardShape).background(ErpColors.card)

// MARK: A pair the list found

@Composable
private fun PairSection(
    pair: CustomerDuplicates.Found,
    keep: Customer,
    duplicate: Customer,
    moves: CustomerMergeCounts,
    onSwap: () -> Unit,
    onMerge: () -> Unit,
    onNot: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(pair.reason, Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Column(Modifier.fillMaxWidth().card()) {
            Person("Keep", keep, ErpColors.accent)
            Rule()
            Person("Delete", duplicate, Tone.problem.color(), moves)
            Rule()
            Line("Swap keep and delete", Symbols.SwapVert, ErpColors.accent, onSwap)
            Rule()
            Line("Merge and delete the duplicate", Symbols.CallMerge, Tone.problem.color(), onMerge)
            Rule()
            Line("Not a duplicate", Symbols.Close, ErpColors.accent, onNot)
        }
    }
}

@Composable
private fun Rule() = erp.app.ui.LedgerDivider()

@Composable
private fun Line(text: String, icon: ImageVector, ink: Color, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).ledgerRow(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, contentDescription = null, tint = ink)
        Text(text, style = MaterialTheme.typography.bodyLarge, color = ink)
    }
}

internal fun movesWords(counts: CustomerMergeCounts): String =
    if (counts.total == 0) "No invoices, orders, repairs or hisaab to move." else "Moves ${counts.sentence} to the customer kept."

@Composable
private fun Person(role: String, c: Customer, tint: Color, moves: CustomerMergeCounts? = null) {
    Column(Modifier.fillMaxWidth().ledgerRow(), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(role.uppercase(), style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold), color = tint)
        Text(CustomerKit.shown(c), style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium))
        CustomerKit.filled(c.phone)?.let {
            Text(it, style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = "tnum"), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (moves != null) {
            Text(movesWords(moves), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

// MARK: Two the list missed

internal fun duplicateMoves(counts: CustomerMergeCounts, duplicate: Customer, keep: Customer): String =
    if (counts.total == 0) "${CustomerKit.shown(duplicate)} has no invoices, orders, repairs or hisaab to move."
    else "Moves ${counts.sentence} from ${CustomerKit.shown(duplicate)} to ${CustomerKit.shown(keep)}."

/** The web's two boxes: two letters at least, six shown. */
internal fun mergeMatches(live: List<Customer>, typed: String, excluding: String): List<Customer> {
    val q = CustomerKit.trim(typed)
    if (q.length <= 1) return emptyList()
    val lower = q.lowercase()
    return live.filter { c -> c.id != excluding && (c.name.lowercase().contains(lower) || (c.phone ?: "").contains(q)) }.take(6)
}

@Composable
private fun ManualSection(
    keep: Customer?,
    duplicate: Customer?,
    live: List<Customer>,
    keepId: String,
    duplicateId: String,
    keepSearch: String,
    duplicateSearch: String,
    onKeepSearch: (String) -> Unit,
    onDuplicateSearch: (String) -> Unit,
    onKeep: (String) -> Unit,
    onDuplicate: (String) -> Unit,
    moves: (String) -> CustomerMergeCounts,
    onMerge: (Customer, Customer) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LedgerHeading("Manual merge", Modifier.padding(horizontal = 16.dp))
        Column(Modifier.fillMaxWidth().card()) {
            Chooser("Keep (primary)", keep, ErpColors.accent, keepSearch, onKeepSearch, live, other = duplicateId, choose = onKeep)
            Rule()
            Chooser("Duplicate (will be deleted)", duplicate, Tone.problem.color(), duplicateSearch, onDuplicateSearch, live, other = keepId, choose = onDuplicate)
            if (keep != null && duplicate != null) {
                Rule()
                Text(
                    duplicateMoves(moves(duplicate.id), duplicate, keep), Modifier.fillMaxWidth().ledgerRow(),
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Rule()
            val can = keep != null && duplicate != null && keepId != duplicateId
            Row(
                Modifier.fillMaxWidth().clickable(enabled = can, role = Role.Button) { if (keep != null && duplicate != null) onMerge(keep, duplicate) }.ledgerRow(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                val ink = if (can) Tone.problem.color() else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                Icon(Symbols.CallMerge, contentDescription = null, tint = ink)
                Text("Merge and delete the duplicate", style = MaterialTheme.typography.bodyLarge, color = ink)
            }
        }
        Text(
            "Search the customer to keep, then the duplicate. The duplicate's record is deleted for good.",
            Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** Who is picked, or a search box with the people who match. */
@Composable
private fun Chooser(
    title: String,
    picked: Customer?,
    tint: Color,
    search: String,
    onSearch: (String) -> Unit,
    live: List<Customer>,
    other: String,
    choose: (String) -> Unit,
) {
    if (picked != null) {
        Row(Modifier.fillMaxWidth().ledgerRow(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold), color = tint)
                Text(CustomerKit.shown(picked), style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium))
                CustomerKit.filled(picked.phone)?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = "tnum"), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            TextButton(onClick = { choose(""); onSearch("") }) { Text("Clear") }
        }
    } else {
        Column(Modifier.fillMaxWidth().ledgerRow(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold), color = tint)
            OutlinedTextField(
                value = search, onValueChange = onSearch, modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Search by name or phone") }, singleLine = true, shape = Radius.chipShape,
                label = null,
            )
        }
        for (c in mergeMatches(live, search, other)) {
            Box(Modifier.fillMaxWidth().clickable(role = Role.Button) { choose(c.id); onSearch("") }.ledgerRow()) {
                TwoLine(CustomerKit.shown(c), subtitle = CustomerKit.filled(c.phone))
            }
        }
    }
}
