package erp.app.screens.repairs

import erp.app.ui.icons.Symbols
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import erp.app.ui.OutlinedButton
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import erp.app.auth.LocalSession
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.rememberShelf
import erp.app.ui.FilterChip
import erp.app.ui.MoneyText
import erp.app.ui.NotAvailableState
import erp.app.ui.PaymentText
import erp.app.ui.PaymentMethods
import erp.app.ui.Radius
import erp.app.ui.Tone
import erp.app.ui.TwoLine
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import erp.core.DocJSON
import erp.core.ERPDate
import erp.core.logic.Money
import erp.core.logic.isWalkInName
import erp.core.models.Customer
import erp.core.models.Karigar
import erp.core.models.Repair
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * New repair, or Edit on a ticket (the form in src/app/repairs/page.tsx): who it is for, the pieces left to be mended, when
 * they will be ready, an advance if one is taken (a new ticket only), and (out of the way on the web, one section here) the
 * karigar, who took it and a note for the shop. A walk-in is a ticket with no name.
 *
 * Saving a new ticket is `addRepair` (owners only): the ERP numbers it REP-000001 on, writes any advance to Extra revenue in
 * the same commit, and answers with the ticket. The form then leaves and the list opens that ticket's sheet. Saving an edit
 * is `updateRepair` (lib/writes/repair-admin.ts): the whole form, as the web's Save sends it, a field left empty removed
 * from the ticket; the money taken, the status and the number are the ticket's own and stay. The receipt prints from the
 * ERP's page.
 */
@Composable
fun RepairsForm(editing: Repair?, onDismiss: () -> Unit, onSaved: (id: String, seed: Repair?) -> Unit) {
    val session = LocalSession.current
    val book = LocalBook.current
    val scope = rememberCoroutineScope()
    val customers by rememberShelf(book.customers)
    val allKarigars by rememberShelf(book.karigars)
    val repairs by rememberShelf(book.repairs)
    val orders by rememberShelf(book.orders)

    // An edit is filled from its ticket once, as the form opens; a new ticket's "Taken by" starts on the signed-in person once.
    var customerId by rememberSaveable { mutableStateOf(RepairsKit.filled(editing?.customerId)) }
    var name by rememberSaveable { mutableStateOf(editing?.customerName ?: "") }
    var phone by rememberSaveable { mutableStateOf(editing?.customerContact ?: "") }
    var pieces by rememberSaveable(stateSaver = PiecesSaver) { mutableStateOf(startingPieces(editing)) }
    val promisedAtOpen = remember { editing?.let { RepairsKit.filled(it.promisedDate)?.let { d -> ERPDate.parse(d)?.let(ERPDate::karachiDay) } } }
    var hasDate by rememberSaveable { mutableStateOf(editing == null || promisedAtOpen != null) }
    var promised by rememberSaveable { mutableStateOf(promisedAtOpen ?: RepairsKit.day(7)) }
    var karigarId by rememberSaveable { mutableStateOf(editing?.karigarId ?: "") }
    var takenBy by rememberSaveable { mutableStateOf(editing?.takenBy ?: seedTakenBy(session.shop.person, session.shop.takenBy)) }
    var note by rememberSaveable { mutableStateOf(editing?.internalNote ?: "") }
    var advance by rememberSaveable { mutableStateOf("") }
    var method by rememberSaveable { mutableStateOf("Cash") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var picking by remember { mutableStateOf(false) }

    // The customers a ticket can be pinned to: not removed, and not the old "Walk-in Customer" records (lib/walk-in.ts: a
    // walk-in is the absence of a customer).
    val people = remember(customers) { customers.filter { RepairsKit.filled(it.deletedAt) == null && !isWalkInName(it.name) } }
    // Removed karigars are left out, save the one an edited ticket is already with.
    val karigars = remember(allKarigars, editing?.karigarId) {
        val current = editing?.karigarId ?: ""
        allKarigars.filter { RepairsKit.filled(it.deletedAt) == null || it.id == current }
    }
    val hasPiece = RepairsFormLogic.hasPiece(pieces)
    val canSave = hasPiece && !saving && RepairsFormLogic.figuresReadable(advance, pieces)
    val total = RepairsFormLogic.total(pieces)
    val advanceAmount = RepairsFormLogic.rupees(advance) ?: 0.0

    fun values() = RepairsFormValues(
        customerId = customerId, name = name, phone = phone, pieces = pieces, hasDate = hasDate, promised = promised,
        karigarId = karigarId, takenBy = takenBy, note = note, advance = advance, method = method, editing = editing != null,
    )

    suspend fun save(close: () -> Unit) {
        if (!canSave) return
        saving = true
        error = null
        try {
            val payload = RepairsFormLogic.payload(values(), karigars)
            if (editing != null) {
                val out = ErpApi.shared.write("updateRepair", mapOf("repairId" to editing.id, "repair" to payload))
                @Suppress("UNCHECKED_CAST")
                val doc = out["repair"] as? Map<String, Any?> ?: emptyMap()
                onSaved(editing.id, DocJSON.decode<Repair>(editing.id, doc))
            } else {
                val out = ErpApi.shared.write("addRepair", mapOf("repair" to payload))
                @Suppress("UNCHECKED_CAST")
                val doc = out["repair"] as? Map<String, Any?> ?: emptyMap()
                val newId = doc["id"] as? String ?: ""
                if (newId.isNotEmpty()) onSaved(newId, DocJSON.decode<Repair>(newId, doc))
            }
            saving = false
            close()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message ?: e.toString()
            saving = false
        }
    }

    // Who has taken tickets and orders lately, newest first, for one tap instead of typing.
    val recentNames = remember(repairs, orders) {
        val raw = repairs.take(60).mapNotNull { it.takenBy } + orders.take(60).mapNotNull { it.takenBy }
        raw.map { it.trim() }.filter { it.isNotEmpty() }.distinct().take(8)
    }

    RepairsSheetFrame(
        title = editing?.let { "Repair ${it.id}" } ?: "New repair",
        onDismiss = onDismiss,
        cancelLabel = "Cancel",
        locked = saving,
        trailing = { close ->
            TextButton(onClick = { scope.launch { save(close) } }, enabled = canSave) { Text("Save", fontWeight = FontWeight.SemiBold) }
        },
    ) {
        // Who
        RepairsSection(
            title = "Customer",
            footer = if (customerId == null) "Leave both blank for a walk-in." else "Linked to $name in the book.",
        ) {
            Row(
                Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp).clickable(role = Role.Button) { picking = true },
                horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Symbols.Person, null, tint = ErpColors.accent)
                Text("Pick from your customers", color = ErpColors.accent, style = MaterialTheme.typography.bodyLarge)
            }
            RepairsField(
                name, { new ->
                    // Typing over a picked name lets go of the customer, as the web's autocomplete does.
                    if (new != name) customerId = null
                    name = new
                },
                "Name", capitalization = KeyboardCapitalization.Words,
            )
            RepairsField(phone, { phone = it }, "Phone", keyboardType = KeyboardType.Phone)
        }

        // The pieces
        RepairsSection(
            title = "Pieces",
            footer = if (!hasPiece) "What was brought in: \"gold ring\", \"chain\"." else null,
        ) {
            pieces.forEachIndexed { index, piece ->
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.weight(1f)) {
                            RepairsField(
                                piece.item, { v -> pieces = pieces.replaced(index) { it.copy(item = v) } },
                                "Piece (gold ring)", capitalization = KeyboardCapitalization.Sentences,
                            )
                        }
                        if (pieces.size > 1) {
                            IconButton(onClick = { pieces = pieces.filterIndexed { i, _ -> i != index } }) {
                                Icon(Symbols.Delete, contentDescription = "Remove piece ${index + 1}", tint = Tone.problem.color())
                            }
                        }
                    }
                    RepairsField(
                        piece.work, { v -> pieces = pieces.replaced(index) { it.copy(work = v) } },
                        "What to do (resize to 14)", capitalization = KeyboardCapitalization.Sentences,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(Modifier.weight(1f)) {
                            RepairsField(piece.weight, { v -> pieces = pieces.replaced(index) { it.copy(weight = v) } }, "Weight g", keyboardType = KeyboardType.Decimal)
                        }
                        Box(Modifier.weight(1f)) {
                            RepairsField(PaymentText.whole(piece.price), { v -> pieces = pieces.replaced(index) { it.copy(price = PaymentText.whole(v)) } }, "Price", keyboardType = KeyboardType.Number, end = true)
                        }
                    }
                }
            }
            Row(
                Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp).clickable(role = Role.Button) {
                    pieces = pieces + RepairsDraftPiece(key = nextKey(pieces))
                },
                horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Symbols.AddCircle, null, tint = ErpColors.accent)
                Text("Add another piece", color = ErpColors.accent, style = MaterialTheme.typography.bodyLarge)
            }
            if (total > 0) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Total", Modifier.weight(1f))
                    MoneyText(total, exact = true, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold))
                }
            }
        }

        // When
        RepairsSection(title = "When") {
            RepairsToggleRow("Ready by a date", hasDate) { hasDate = it }
            if (hasDate) {
                // Stored as yyyy-MM-dd, Karachi's day.
                RepairsDayRow("Ready by", promised) { promised = it }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { promised = RepairsKit.day(3) }) { Text("3 days") }
                    OutlinedButton(onClick = { promised = RepairsKit.day(7) }) { Text("1 week") }
                    OutlinedButton(onClick = { promised = RepairsKit.day(14) }) { Text("2 weeks") }
                }
            }
        }

        if (editing != null) {
            // What was paid on the ticket so far: the edit never changes it (Take payment does), as on the web.
            if (editing.payments.isNotEmpty()) {
                RepairsSection(
                    title = "Paid so far",
                    footer = "Money taken stays as it is. A new payment is Take payment on the ticket.",
                ) {
                    editing.payments.forEach { p ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(RepairsKit.paymentWords(p), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                            Text(Money.pkr(p.amount), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                        }
                    }
                }
            }
        } else {
            RepairsSection(title = "Advance taken now (optional)") {
                RepairsField(PaymentText.whole(advance), { advance = PaymentText.whole(it) }, "Amount in rupees", keyboardType = KeyboardType.Number)
                if (advanceAmount > 0) {
                    Text(Money.pkrLac(advanceAmount), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("How it was paid", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        PaymentMethods.all.forEach { m -> FilterChip(m, chosen = method == m, onClick = { method = m }) }
                    }
                }
            }
        }

        // The shop
        val takenByNames = remember(session.shop.takenBy, editing?.takenBy) {
            val names = session.shop.takenBy
            val own = RepairsKit.filled(editing?.takenBy)
            if (names.isNotEmpty() && own != null && own !in names) names + own else names
        }
        RepairsSection(title = "Karigar, taken by, note", footer = "The note is for the shop only: it is never printed or sent.") {
            PickerRow(
                "Karigar", karigars.firstOrNull { it.id == karigarId }?.name ?: "Done in the shop",
                listOf("" to "Done in the shop") + karigars.map { it.id to it.name },
            ) { karigarId = it }
            if (takenByNames.isEmpty()) {
                // A house that has not named its counter people types the name.
                RepairsField(takenBy, { takenBy = it }, "Taken by", capitalization = KeyboardCapitalization.Words)
                if (recentNames.isNotEmpty()) {
                    PickerRow("Names used lately", "", recentNames.map { it to it }) { takenBy = it }
                }
            } else {
                // The house's counter names, one to pick (a name typed three ways is three people to a filter).
                PickerRow("Taken by", takenBy.ifEmpty { "Not set" }, listOf("" to "Not set") + takenByNames.map { it to it }) { takenBy = it }
            }
            RepairsField(note, { note = it }, "Note for the shop", capitalization = KeyboardCapitalization.Sentences, singleLine = false, minLines = 2)
        }

        error?.let { Text(it, color = Tone.problem.color(), style = MaterialTheme.typography.bodyMedium) }
    }

    if (picking) {
        CustomerPicker(people, onDismiss = { picking = false }) { c ->
            customerId = c.id
            name = c.name
            RepairsKit.filled(c.phone)?.let { phone = it }
        }
    }
}

private fun seedTakenBy(person: String?, names: List<String>): String {
    // New work starts on whoever is signed in (docs/decisions.md "Signed-in defaults"), when they are on the house's list; Not
    // set is one tap away, since a device handed across the counter must not credit everything to whoever signed in.
    if (person.isNullOrEmpty()) return ""
    return if (names.isEmpty() || person in names) person else ""
}

private fun startingPieces(editing: Repair?): List<RepairsDraftPiece> {
    val drafts = editing?.pieces?.mapIndexed { i, p ->
        RepairsDraftPiece(i.toLong(), p.item, p.work, RepairsKit.typed(p.weightG, 3), RepairsKit.typed(p.price, 0))
    }.orEmpty()
    return drafts.ifEmpty { listOf(RepairsDraftPiece(0)) }
}

private fun nextKey(pieces: List<RepairsDraftPiece>): Long = (pieces.maxOfOrNull { it.key } ?: -1L) + 1

private fun List<RepairsDraftPiece>.replaced(index: Int, change: (RepairsDraftPiece) -> RepairsDraftPiece): List<RepairsDraftPiece> =
    mapIndexed { i, p -> if (i == index) change(p) else p }

/** The typed pieces survive a rotation: five texts a piece. */
private val PiecesSaver = listSaver<List<RepairsDraftPiece>, String>(
    save = { list -> list.flatMap { listOf(it.key.toString(), it.item, it.work, it.weight, it.price) } },
    restore = { flat -> flat.chunked(5).map { RepairsDraftPiece(it[0].toLongOrNull() ?: 0L, it[1], it[2], it[3], it[4]) } },
)

/** A labelled choice: the row shows the choice, a tap opens the list (the form's `Picker`). */
@Composable
private fun PickerRow(label: String, shown: String, options: List<Pair<String, String>>, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp).clickable(role = Role.DropdownList) { open = true },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
            if (shown.isNotEmpty()) Text(shown, color = ErpColors.accent, fontWeight = FontWeight.Medium)
            Icon(Symbols.ArrowDropDown, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (value, text) ->
                DropdownMenuItem(text = { Text(text) }, onClick = { open = false; onPick(value) })
            }
        }
    }
}

/** Pick a customer from the book, with search by name or number. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CustomerPicker(customers: List<Customer>, onDismiss: () -> Unit, onPick: (Customer) -> Unit) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var query by rememberSaveable { mutableStateOf("") }
    val q = query.trim().lowercase()
    val shown = remember(customers, q) {
        if (q.isEmpty()) customers else customers.filter { it.name.lowercase().contains(q) || (it.phone ?: "").lowercase().contains(q) }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = state, containerColor = ErpColors.ground) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { scope.launch { state.hide(); onDismiss() } }) { Text("Cancel") }
                Text("Customers", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                Box(Modifier.defaultMinSize(minWidth = 72.dp))
            }
            Box(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) { RepairsSearchField(query, { query = it }, "Name or phone") }
            if (shown.isEmpty()) {
                if (q.isEmpty()) NotAvailableState("No customers yet", icon = Symbols.Group)
                else NotAvailableState("No Results for “$query”", why = "Check the spelling or try a new search.", icon = Symbols.Group)
            } else {
                LazyColumn(Modifier.weight(1f).padding(horizontal = 16.dp)) {
                    items(shown, key = { it.id }) { c ->
                        Box(
                            Modifier.animateItem().fillMaxWidth().clickable(role = Role.Button) {
                                onPick(c)
                                scope.launch { state.hide(); onDismiss() }
                            }.ledgerRow(),
                        ) { TwoLine(title = c.name, subtitle = c.phone) }
                    }
                }
            }
        }
    }
}
