package erp.app.screens.money

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddCircleOutline
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Work
import androidx.compose.material.icons.filled.WorkOutline
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.data.Connection
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.Sort
import erp.app.data.rememberShelfStatus
import erp.app.ui.FailureAlert
import erp.app.ui.LedgerDivider
import erp.app.ui.Radius
import erp.app.ui.ShelfState
import erp.app.ui.ledgerRow
import erp.app.ui.readableColumn
import erp.app.ui.theme.ErpColors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Hisaab → Add entry (src/app/hisaab/page.tsx `AddNewHisaabDialog`, "Add or choose an account"): the customers and
 * karigars on file to search, and a ledger opens for the one picked, where "You gave" and "You got" write the row. A
 * name typed that is on nobody's file can become a new karigar from here (`addKarigar`, as the web does), and opens
 * his ledger; a new customer, or a karigar with his number and specialty, goes to the form for one.
 *
 * [go] is told the path to open once the sheet is closing: a person's ledger, or the form for a new one.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HisaabAccountPicker(onDismiss: () -> Unit, go: (String) -> Unit) {
    val book = LocalBook.current
    val customers = rememberShelfStatus(book.customers)
    val karigars = rememberShelfStatus(book.karigars)
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var search by rememberSaveable { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { !creating })

    // Customers and karigars, A to Z; a removed one is not on the web's list either.
    val contacts = remember(customers.revision, karigars.revision) {
        val all = ArrayList<PickerContact>()
        for (c in customers.items) if (c.deletedAt.isNullOrEmpty()) all.add(PickerContact(c.id, c.name, true))
        for (k in karigars.items) if (k.deletedAt.isNullOrEmpty()) all.add(PickerContact(k.id, k.name, false))
        all.sortedWith(Sort.byName { it.name })
    }
    val typed = search.trim()

    fun finish(path: String) {
        scope.launch { sheet.hide() }.invokeOnCompletion { onDismiss() }
        go(path)
    }

    /** A typed name that is on nobody's file becomes a karigar with that name alone and opens his ledger. */
    fun createKarigar() {
        val name = typed
        if (name.isEmpty() || creating) return
        creating = true
        scope.launch {
            try {
                val out = ErpApi.shared.write("addKarigar", mapOf("karigar" to mapOf("name" to name)))
                val id = ((out["karigar"] as? Map<*, *>)?.get("id") as? String).orEmpty()
                if (id.isEmpty()) failure = "Nothing was saved. Try again." else finish(MoneyPaths.ledger(id, isCustomer = false))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = e.message ?: e.toString()
            }
            creating = false
        }
    }

    ModalBottomSheet(onDismissRequest = { if (!creating) onDismiss() }, sheetState = sheet, containerColor = MaterialTheme.colorScheme.surface) {
        Column(Modifier.fillMaxHeight(0.92f).fillMaxWidth().navigationBarsPadding().imePadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { if (!creating) scope.launch { sheet.hide() }.invokeOnCompletion { onDismiss() } }) { Text("Cancel") }
                Text(
                    "Add or choose an account", Modifier.weight(1f).semantics { heading() },
                    style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center, maxLines = 2,
                )
                Spacer(Modifier.size(64.dp))
            }
            Box(Modifier.padding(horizontal = 16.dp, vertical = 8.dp).readableColumn()) {
                MoneySearchField(search, { search = it }, "Search by name, or type a new karigar", enabled = !creating)
            }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                ShelfState(
                    loaded = customers.loaded && karigars.loaded,
                    error = customers.error ?: karigars.error,
                    offline = customers.offline,
                    connectionLost = connectionLost,
                ) {
                    val shown = if (typed.isEmpty()) contacts else contacts.filter { moneyContains(it.name, typed) }
                    // The web offers a new karigar for a name nobody on file has.
                    val exactOnFile = typed.isNotEmpty() && contacts.any { it.name.trim().equals(typed, ignoreCase = true) }
                    val canCreate = typed.isNotEmpty() && !exactOnFile && !creating
                    val rows: List<PickerRow> = shown.map { PickerRow.Contact(it) } + (if (canCreate || creating) listOf(PickerRow.Create) else emptyList())
                    LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(bottom = 24.dp)) {
                        if (rows.isEmpty()) {
                            item(key = "none") {
                                Text(
                                    "No contacts found. Add a new one below.",
                                    Modifier.padding(horizontal = 20.dp, vertical = 12.dp).readableColumn(),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        cardRows("p", rows, { it.key }) { row ->
                            when (row) {
                                is PickerRow.Contact -> ContactRow(row.c, enabled = !creating) { finish(MoneyPaths.ledger(row.c.id, row.c.isCustomer)) }
                                PickerRow.Create -> Row(
                                    Modifier.fillMaxWidth().clickable(enabled = !creating, role = Role.Button) { createKarigar() }.ledgerRow(),
                                    horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    if (creating) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                                    else Icon(Icons.Filled.AddCircleOutline, contentDescription = null, tint = ErpColors.accent)
                                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                        Text(
                                            "${if (creating) "Adding" else "Add karigar"} \u201C$typed\u201D",
                                            style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium),
                                        )
                                        Text("Opens a new hisaab for him", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                            }
                        }
                        item(key = "links") {
                            Column(Modifier.padding(horizontal = 16.dp, vertical = 16.dp).readableColumn()) {
                                Column(Modifier.fillMaxWidth().clip(Radius.cardShape).background(ErpColors.card)) {
                                    LinkRow("New customer", Icons.Filled.PersonAdd, enabled = !creating) { finish("/customers/add") }
                                    LedgerDivider()
                                    LinkRow("New karigar", Icons.Filled.WorkOutline, enabled = !creating) { finish("/karigars/add") }
                                }
                                Footnote("A new customer or karigar is added with the full form.", Modifier.padding(top = 8.dp))
                            }
                        }
                    }
                }
            }
        }
    }
    FailureAlert(failure, onDismiss = { failure = null }, title = "Could not add the karigar")
}

private data class PickerContact(val id: String, val name: String, val isCustomer: Boolean)

private sealed interface PickerRow {
    val key: String
    class Contact(val c: PickerContact) : PickerRow { override val key get() = "c" + c.id + c.isCustomer }
    object Create : PickerRow { override val key get() = "create" }
}

@Composable
private fun ContactRow(c: PickerContact, enabled: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(enabled = enabled, role = Role.Button, onClick = onClick).ledgerRow(),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(32.dp).clip(CircleShape).background(ErpColors.accent.copy(alpha = 0.14f)), contentAlignment = Alignment.Center) {
            Icon(if (c.isCustomer) Icons.Filled.Person else Icons.Filled.Work, contentDescription = null, tint = ErpColors.accent)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(c.name.ifEmpty { c.id }, style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium), maxLines = 1)
            Text(if (c.isCustomer) "Customer" else "Karigar", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun LinkRow(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, enabled: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(enabled = enabled, role = Role.Button, onClick = onClick).ledgerRow(),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = ErpColors.accent)
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
    }
}
