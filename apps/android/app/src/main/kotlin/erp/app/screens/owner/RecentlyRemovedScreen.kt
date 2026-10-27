package erp.app.screens.owner

import erp.app.ui.icons.Symbols
import erp.app.ui.Loading
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import erp.app.ui.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import erp.app.ui.OutlinedButton
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.ui.LocalNoteState
import erp.app.ui.OwnerDeleteCodeSheet
import erp.app.ui.OwnerDeletion
import erp.app.auth.LocalSession
import erp.app.data.Connection
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.rememberShelfStatus
import erp.app.nav.ScreenTitle
import erp.app.screens.money.Footnote
import erp.app.screens.money.cardEdges
import erp.app.ui.FailureAlert
import erp.app.ui.LedgerDivider
import erp.app.ui.LedgerHeading
import erp.app.ui.NotAvailableState
import erp.app.ui.Note
import erp.app.ui.ShelfState
import erp.app.ui.ShopDate
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.readableColumn
import erp.core.logic.RecentlyRemoved
import erp.core.models.Customer
import erp.core.models.Karigar
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Settings → Recently removed (src/app/settings/recently-removed/page.tsx): the way back from a clear-out that went too
 * far. Removing a customer or a karigar anywhere only hides them; their ledger, orders and invoices stay where they
 * are, still pointing at the same id, so putting one back restores a whole account rather than a bare name. Each row
 * says how much history it carries (core's RecentlyRemoved).
 *
 * Putting back is native (`restoreRemoved`). Emptying the list is the one thing in the ERP that destroys a record: it
 * says how much history goes with them, then asks for the delete code, which the ERP checks with the delete
 * (`purgeRemoved`, lib/writes/recently-removed.ts). Owners only, as Settings are.
 */
@Composable
fun RecentlyRemovedScreen() {
    ScreenTitle("Recently removed")
    if (!LocalSession.current.isOwner) {
        NotAvailableState("Owners only", why = "Settings are the owners’.")
        return
    }
    RecentlyRemovedList()
}

private enum class Kind { customer, karigar }

@Composable
private fun RecentlyRemovedList() {
    val book = LocalBook.current
    val scope = rememberCoroutineScope()
    val customers = rememberShelfStatus(book.customers)
    val karigars = rememberShelfStatus(book.karigars)
    val hisaab = rememberShelfStatus(book.hisaab)
    val orders = rememberShelfStatus(book.orders)
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()
    val note = LocalNoteState.current

    var busy by remember { mutableStateOf<String?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    var deletion by remember { mutableStateOf<OwnerDeletion?>(null) }

    val ready = customers.loaded && karigars.loaded && hisaab.loaded && orders.loaded
    val removedCustomers = remember(customers.revision) { customers.items.filter { RecentlyRemoved.isRemoved(it.deletedAt) } }
    val removedKarigars = remember(karigars.revision) { karigars.items.filter { RecentlyRemoved.isRemoved(it.deletedAt) } }

    /** Put back one person, or everyone listed (the ERP restores only those still removed). */
    fun restore(customerIds: List<String>, karigarIds: List<String>, key: String, name: String?) {
        busy = key
        scope.launch {
            try {
                val out = ErpApi.shared.write("restoreRemoved", mapOf("customerIds" to customerIds, "karigarIds" to karigarIds))
                val back = (out["customers"] as? List<*>).orEmpty().size + (out["karigars"] as? List<*>).orEmpty().size
                note.show(
                    if (back == 0) {
                        // Someone put them back already (or they are gone): the list catches up by itself.
                        Note("Nothing to put back", "They are no longer in Recently removed.")
                    } else if (name != null) {
                        Note("Put back", "${if (name.isEmpty()) "They are" else "$name is"} in the book again.")
                    } else {
                        Note("Put everything back", "$back record(s) restored.")
                    },
                )
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = e.message ?: e.toString()
            }
            busy = null
        }
    }

    Box(Modifier.fillMaxSize()) {
        ShelfState(loaded = ready, error = customers.error ?: karigars.error, offline = customers.offline, connectionLost = connectionLost) {
            val history = remember(hisaab.revision, orders.revision) { RecentlyRemoved.removedHistory(hisaab.items, orders.items) }
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 8.dp, bottom = 96.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (removedCustomers.isEmpty() && removedKarigars.isEmpty()) {
                    item(key = "none") {
                        NotAvailableState(
                            "Nobody has been removed",
                            why = "Nothing here has been destroyed. Their history is exactly where they left it.",
                            icon = Symbols.Undo,
                        )
                    }
                } else {
                    item(key = "summary") {
                        Summary(
                            removedCustomers, removedKarigars, busy,
                            putAllBack = { restore(removedCustomers.map { it.id }, removedKarigars.map { it.id }, "all", null) },
                            empty = { deletion = askToEmpty(removedCustomers, removedKarigars, history, note::show) },
                        )
                    }
                    if (removedCustomers.isNotEmpty()) item(key = "customers") {
                        Section("Customers") {
                            removedCustomers.forEachIndexed { i, c ->
                                if (i > 0) LedgerDivider()
                                PersonRow(c.id, c.name, c.phone, c.deletedAt, Kind.customer, history[c.id], busy) {
                                    restore(listOf(c.id), emptyList(), c.id, c.name)
                                }
                            }
                        }
                    }
                    if (removedKarigars.isNotEmpty()) item(key = "karigars") {
                        Section("Karigars") {
                            removedKarigars.forEachIndexed { i, k ->
                                if (i > 0) LedgerDivider()
                                PersonRow(k.id, k.name, k.contact, k.deletedAt, Kind.karigar, history[k.id], busy) {
                                    restore(emptyList(), listOf(k.id), k.id, k.name)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    FailureAlert(failure, onDismiss = { failure = null }, title = "Could not do that")
    deletion?.let { d -> OwnerDeleteCodeSheet(d, onDismiss = { deletion = null }, onDone = {}) }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(Modifier.padding(horizontal = 16.dp).readableColumn(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LedgerHeading(title, Modifier.padding(horizontal = 16.dp))
        Column(Modifier.fillMaxWidth().cardEdges(first = true, last = true)) { content() }
    }
}

@Composable
private fun Summary(
    customers: List<Customer>,
    karigars: List<Karigar>,
    busy: String?,
    putAllBack: () -> Unit,
    empty: () -> Unit,
) {
    val total = customers.size + karigars.size
    Column(Modifier.padding(horizontal = 16.dp).readableColumn(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LedgerHeading("$total removed", Modifier.padding(horizontal = 16.dp))
        Column(Modifier.fillMaxWidth().cardEdges(first = true, last = true).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = putAllBack, enabled = busy == null, modifier = Modifier.fillMaxWidth()) {
                if (busy == "all") Loading(Modifier.size(24.dp), color = MaterialTheme.colorScheme.onPrimary)
                else Icon(Symbols.Undo, contentDescription = null)
                Text("  Put everything back")
            }
            // The sheet says what goes and what it orphans before it takes the code (the page's "Empty Recently removed?").
            OutlinedButton(onClick = empty, enabled = busy == null, modifier = Modifier.fillMaxWidth()) {
                Icon(Symbols.Delete, contentDescription = null, tint = Tone.problem.color())
                Text("  Empty", color = Tone.problem.color())
            }
        }
        Footnote("${customers.size} customer(s), ${karigars.size} karigar(s). Nothing here has been destroyed. Their history is exactly where they left it.")
    }
}

/** The page's warning, counted out loud: what goes, and the history it leaves orphaned. */
internal fun emptyWarning(customers: List<Customer>, karigars: List<Karigar>, h: Map<String, RecentlyRemoved.History>): String {
    val t = RecentlyRemoved.removedTotals(customers.map { it.id }, karigars.map { it.id }, h)
    var said = "This permanently deletes ${customers.size} customer(s) and ${karigars.size} karigar(s)."
    if (t.entries > 0 || t.orders > 0) {
        said += " They carry ${t.entries} ledger entr${if (t.entries == 1) "y" else "ies"} and ${t.orders} order${if (t.orders == 1) "" else "s"} between them, which will be orphaned."
    }
    return said + " This is the one thing in the app that cannot be undone."
}

private fun askToEmpty(customers: List<Customer>, karigars: List<Karigar>, h: Map<String, RecentlyRemoved.History>, say: (Note) -> Unit): OwnerDeletion {
    val customerIds = customers.map { it.id }
    val karigarIds = karigars.map { it.id }
    return OwnerDeletion(
        what = "Delete every removed customer and karigar for good",
        detail = "Empty Recently removed? " + emptyWarning(customers, karigars, h),
        run = { code ->
        val out = ErpApi.shared.write("purgeRemoved", mapOf("customerIds" to customerIds, "karigarIds" to karigarIds, "deleteCode" to code))
        val c = (out["customers"] as? Number)?.toInt() ?: 0
        val k = (out["karigars"] as? Number)?.toInt() ?: 0
        say(Note("Recently removed emptied", "$c customer(s) and $k karigar(s) permanently deleted."))
    })
}

@Composable
private fun PersonRow(
    id: String,
    name: String,
    sub: String?,
    removedAt: String?,
    kind: Kind,
    history: RecentlyRemoved.History?,
    busy: String?,
    putBack: () -> Unit,
) {
    val carries = RecentlyRemoved.carriesText(history)
    val line = listOf(sub ?: "", carries.ifEmpty { "no history" }).filter { it.isNotEmpty() }.joinToString(" — ")
    val whenSaid = ShopDate.say(removedAt)
    Row(
        Modifier.fillMaxWidth().ledgerRow(),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(if (kind == Kind.customer) Symbols.People else Symbols.Engineering, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(name.ifEmpty { id }, style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium), maxLines = 1)
            Text(line, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
            if (whenSaid.isNotEmpty()) {
                Text("Removed $whenSaid", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f))
            }
        }
        TextButton(onClick = putBack, enabled = busy == null) {
            if (busy == id) Loading(Modifier.size(24.dp)) else Text("Put back")
        }
    }
}
