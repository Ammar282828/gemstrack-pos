package erp.app.screens.workshop

import erp.app.ui.SearchBarField
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Handyman
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import erp.app.ui.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.ui.rememberLocalChanges
import erp.app.ui.rememberHaptics
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.rememberShelfStatus
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.screens.customers.FormSection
import erp.app.screens.neworder.PickerRow
import erp.app.screens.neworder.ValueRow
import erp.app.screens.neworder.WideFieldRow
import erp.app.screens.neworder.FieldRow
import erp.app.data.Connection
import erp.app.ui.ChipRow
import erp.app.ui.FailureAlert
import erp.app.ui.FigureRow
import erp.app.ui.FigureTile
import erp.app.ui.FilterChip
import erp.app.ui.LedgerHeading
import erp.app.ui.LocalNoteState
import erp.app.ui.MinTouchTarget
import erp.app.ui.Note
import erp.app.ui.NotAvailableState
import erp.app.ui.Pill
import erp.app.ui.Radius
import erp.app.ui.ShelfState
import erp.app.ui.ShopDate
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.isLargeText
import erp.core.ERPDate
import erp.core.entry.NewOrderDay
import erp.core.models.Customer
import erp.core.models.GivenItem
import erp.core.models.GivenItemRecipientType
import erp.core.models.GivenItemStatus
import erp.core.models.Karigar
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** The Given page's three chips. */
enum class GivenFilter(val title: String) { all("All"), stillOut("Still out"), returned("Returned") }

object GivenLogic {
    fun matches(g: GivenItem, filter: GivenFilter, query: String): Boolean {
        when (filter) {
            GivenFilter.all -> {}
            GivenFilter.stillOut -> if (g.status != GivenItemStatus.out) return false
            GivenFilter.returned -> if (g.status != GivenItemStatus.returned) return false
        }
        val q = query.trim()
        if (q.isEmpty()) return true
        return g.description.contains(q, ignoreCase = true) || g.recipientName.contains(q, ignoreCase = true) || (g.notes ?: "").contains(q, ignoreCase = true)
    }

    /** "3 Oct 2026 · Ustad Demo · by Ammar". */
    fun recipientWords(item: GivenItem): String {
        val whenWords = if (item.date.isEmpty()) "" else ShopDate.say(item.date)
        val who = item.recipientName.ifEmpty { "—" }
        val by = if ((item.givenBy ?: "").isEmpty()) "" else " · by " + item.givenBy
        return (if (whenWords.isEmpty()) who else "$whenWords · $who") + by
    }

    /** The karigar's page, or the customer's, when the entry is linked to one. */
    fun recipientPath(item: GivenItem): String? {
        val rid = item.recipientId
        if (rid.isNullOrEmpty()) return null
        return when (item.recipientType) {
            GivenItemRecipientType.karigar -> WorkshopLogic.karigarPath(rid)
            GivenItemRecipientType.customer -> workshopCustomerPath(rid)
            else -> null
        }
    }

    fun icon(t: GivenItemRecipientType): ImageVector = when (t) {
        GivenItemRecipientType.karigar -> Icons.Filled.Handyman
        GivenItemRecipientType.customer -> Icons.Filled.Group
        else -> Icons.Filled.Person
    }

    fun typeWords(t: GivenItemRecipientType): String = when (t) {
        GivenItemRecipientType.karigar -> "Karigar"
        GivenItemRecipientType.customer -> "Customer"
        else -> "Other"
    }
}

/**
 * Given items (src/app/given/page.tsx): samples, repairs, anything given to karigars or customers, and whether it
 * has come back. Owners record a new one (+), mark one returned ("Got back"), edit one (its date, what it is, who
 * has it, a note) and delete one (the delete code); each is a write through the ERP (`addGivenItem`,
 * `markGivenReturned`, `updateGivenItem`, `deleteGivenItem`).
 */
@Composable
fun WorkshopGivenScreen() {
    val book = LocalBook.current
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val note = LocalNoteState.current
    val scope = rememberCoroutineScope()
    val owner = session.isOwner
    val given = rememberShelfStatus(book.givenItems)
    // Only an owner records an item, and only the sheet's name suggestions read these two.
    LaunchedEffect(owner) {
        if (owner) {
            book.karigars.need()
            book.customers.need()
        }
    }
    val karigarItems by book.karigars.items.collectAsStateWithLifecycle()
    val customerItems by book.customers.items.collectAsStateWithLifecycle()
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()

    var query by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable { mutableStateOf(GivenFilter.all) }
    var adding by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<GivenItem?>(null) }
    var deletion by remember { mutableStateOf<WorkshopDeletion?>(null) }
    // What was just marked returned, until the shelf's copy says so: the Outbox carries the write.
    val returnedNow = rememberLocalChanges<String, String>()
    val haptics = rememberHaptics()
    var failure by remember { mutableStateOf<String?>(null) }

    val liveKarigars = remember(karigarItems) { workshopLive(karigarItems) }
    val liveCustomers = remember(customerItems) { customerItems.filter { it.deletedAt.isNullOrEmpty() } }
    val all = remember(given.items, returnedNow.entries) {
        if (returnedNow.isEmpty) given.items
        else given.items.map { g -> returnedNow[g.id]?.takeIf { g.status != GivenItemStatus.returned }?.let { day -> g.copy(status = GivenItemStatus.returned, returnedDate = day) } ?: g }
    }
    LaunchedEffect(given.items) { returnedNow.reconcile { id, _ -> given.items.firstOrNull { it.id == id }?.status?.let { it == GivenItemStatus.returned } ?: true } }
    val shown = remember(all, filter, query) { all.filter { GivenLogic.matches(it, filter, query) } }

    fun markReturned(item: GivenItem) {
        if (returnedNow[item.id] != null) return
        val day = ERPDate.iso(Instant.now())
        returnedNow[item.id] = day
        haptics.success()
        val w = WorkshopWrites.markReturned(item.id, day)
        ErpApi.shared.enqueue(w.op, w.fields, "Returned: ${item.description}")
    }

    /** The web's "Delete this entry?": the entry goes for good; nothing else is touched. */
    fun askDelete(item: GivenItem) {
        val who = if (item.recipientName.isEmpty()) "" else " — given to ${item.recipientName}."
        deletion = WorkshopDeletion(
            what = "Delete given item \"${item.description.ifEmpty { item.id }}\"",
            detail = "“${item.description}”${if (who.isEmpty()) "." else who}",
            run = { code -> WorkshopWrites.deleteGiven(item.id, code).let { ErpApi.shared.write(it.op, it.fields) } },
        )
    }

    ScreenTitle("Given items")
    if (owner) {
        ScreenActions { IconButton(onClick = { adding = true }) { Icon(Icons.Filled.Add, "Record item given") } }
    }

    ShelfState(loaded = given.loaded, error = given.error, offline = given.offline, connectionLost = connectionLost) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val columns = workshopColumns((maxWidth - 32.dp).value, isLargeText(), 340f)
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 96.dp)) {
                item(key = "search") {
                    SearchBarField(
                        value = query,
                        onValueChange = { query = it },
                        modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
                        placeholder = { Text("Item or recipient") },
                        leadingIcon = { Icon(Icons.Filled.Search, null) },
                        trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Icons.Filled.Close, "Clear search") } },
                        singleLine = true,
                        shape = Radius.chipShape,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    )
                }
                item(key = "summary") {
                    val out = all.count { it.status == GivenItemStatus.out }
                    val back = all.count { it.status == GivenItemStatus.returned }
                    FigureRow(Modifier.padding(bottom = 12.dp)) {
                        FigureTile("Still out", "$out", Modifier.share(), tint = if (out > 0) Tone.owed.color() else Color.Unspecified)
                        FigureTile("Returned", "$back", Modifier.share(), tint = if (back > 0) Tone.settled.color() else Color.Unspecified)
                    }
                }
                item(key = "filter") {
                    ChipRow(Modifier.padding(bottom = 12.dp)) {
                        for (f in GivenFilter.values()) FilterChip(f.title, chosen = filter == f, onClick = { filter = f })
                    }
                }
                if (shown.isNotEmpty()) {
                    item(key = "head") {
                        Column(Modifier.padding(bottom = 8.dp)) { LedgerHeading(if (filter == GivenFilter.returned) "Returned items" else "Items", count = shown.size) }
                    }
                    workshopCardRows(shown, columns, "given", key = { it.id }) { item ->
                        GivenCard(
                            item, owner, false,
                            onReturned = { markReturned(item) },
                            onOpen = { path -> navigator.open(path) },
                            onEdit = { editing = item },
                            onDelete = { askDelete(item) },
                        )
                    }
                } else {
                    item(key = "empty") {
                        val filtering = query.isNotEmpty() || filter != GivenFilter.all
                        NotAvailableState(
                            "Nothing here yet",
                            why = if (filtering) "No items match your filter." else "Tap + to record an item given.",
                            icon = Icons.Filled.Inventory2,
                        )
                    }
                }
            }
        }
    }

    FailureAlert(failure, onDismiss = { failure = null }, title = "Not changed")
    if (adding) {
        WorkshopGivenSheet(liveKarigars, liveCustomers, session.shop.takenBy, session.shop.person, null, onDismiss = { adding = false }, onSaved = {})
    }
    editing?.let { item ->
        WorkshopGivenSheet(
            liveKarigars, liveCustomers, session.shop.takenBy, session.shop.person, item, onDismiss = { editing = null },
            onSaved = { note.show(Note("Updated", "Item updated.")) },
        )
    }
    deletion?.let { d -> WorkshopDeleteCodeSheet(d, onDismiss = { deletion = null }, onDone = { note.show(Note("Deleted")) }) }
}

// MARK: A card

@Composable
private fun GivenCard(
    item: GivenItem,
    owner: Boolean,
    busy: Boolean,
    onReturned: () -> Unit,
    onOpen: (String) -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    val canReturn = owner && item.status == GivenItemStatus.out
    val recipientPath = GivenLogic.recipientPath(item)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(item.description, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold))
            Box {
                IconButton(onClick = { menu = true }, Modifier.size(MinTouchTarget)) { Icon(Icons.Filled.MoreVert, "Actions for " + item.description) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    if (canReturn) {
                        DropdownMenuItem(text = { Text("Got back") }, leadingIcon = { Icon(Icons.Filled.CheckCircle, null) }, onClick = { menu = false; onReturned() })
                    }
                    if (recipientPath != null) {
                        DropdownMenuItem(
                            text = { Text("Open " + item.recipientName) }, leadingIcon = { Icon(GivenLogic.icon(item.recipientType), null) },
                            onClick = { menu = false; onOpen(recipientPath) },
                        )
                    }
                    if (owner) {
                        DropdownMenuItem(text = { Text("Edit") }, leadingIcon = { Icon(Icons.Filled.Edit, null) }, onClick = { menu = false; onEdit() })
                        DropdownMenuItem(
                            text = { Text("Delete", color = Tone.problem.color()) }, leadingIcon = { Icon(Icons.Filled.Delete, null, tint = Tone.problem.color()) },
                            onClick = { menu = false; onDelete() },
                        )
                    }
                }
            }
        }
        if (item.status == GivenItemStatus.out) {
            Pill("Out", tone = Tone.owed)
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Pill("Returned", tone = Tone.settled)
                item.returnedDate?.takeIf { it.isNotEmpty() }?.let {
                    Text(ShopDate.say(it), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
            Icon(GivenLogic.icon(item.recipientType), null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(GivenLogic.recipientWords(item), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        item.notes?.takeIf { it.isNotEmpty() }?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (canReturn) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                if (busy) {
                    SkeletonLoading(Modifier.size(width = 120.dp, height = 20.dp), compact = true)
                } else {
                    OutlinedButton(onClick = onReturned, Modifier.defaultMinSize(minHeight = MinTouchTarget)) {
                        Icon(Icons.Filled.CheckCircle, null, Modifier.size(18.dp), tint = Tone.settled.color())
                        Text("Got back", Modifier.padding(start = 6.dp), color = Tone.settled.color())
                    }
                }
            }
        }
    }
}

// MARK: Record an item given

/**
 * The form of the Given page: the date, what it is, who it went to, and a note. The recipient is picked from the
 * karigars or customers or typed; a name that is exactly one live karigar's or customer's is linked by id, so a
 * customer merge and the karigar's page can find it (lib/given.ts `resolveRecipientId`). With an `item` it is "Edit
 * Given Item": its fields to start from, and an edit whose name no longer resolves to one clears the old link, as the
 * web's does. Whether it came back is not changed by an edit.
 */
@Composable
fun WorkshopGivenSheet(
    karigars: List<Karigar>,
    customers: List<Customer>,
    takenBy: List<String>,
    me: String?,
    item: GivenItem?,
    onDismiss: () -> Unit,
    onSaved: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    // A time of day for the saved date: the one the form was opened at (an edit keeps the entry's own).
    val openedAt = remember { (if (item != null) ERPDate.parse(item.date) else null) ?: Instant.now() }
    var day by remember { mutableStateOf(NewOrderDay.string(openedAt)) }
    var what by remember { mutableStateOf(item?.description ?: "") }
    var type by remember {
        mutableStateOf(
            when (item?.recipientType) {
                null -> GivenItemRecipientType.karigar
                GivenItemRecipientType.karigar -> GivenItemRecipientType.karigar
                GivenItemRecipientType.customer -> GivenItemRecipientType.customer
                // A type the form does not know is offered as Other.
                else -> GivenItemRecipientType.other
            },
        )
    }
    var name by remember { mutableStateOf(item?.recipientName ?: "") }
    // The record the name was picked from; dropped when the name is typed over.
    var pickedId by remember { mutableStateOf<String?>(null) }
    var pickedName by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf(item?.notes ?: "") }
    // A new entry starts on the signed-in person, as Taken by does; an edit on who it says.
    var givenBy by remember { mutableStateOf(item?.givenBy ?: me ?: "") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val trimmedName = name.trim()
    val canSave = what.trim().isNotEmpty() && trimmedName.isNotEmpty() && !saving

    fun save() {
        if (!canSave) return
        val write = WorkshopWrites.given(
            WorkshopDay.iso(day, openedAt), what, type, name, pickedId, pickedName, karigars, customers, notes, givenBy, item,
        )
        ErpApi.shared.enqueue(write.op, write.fields, "Given item: $what")
        if (item != null) onSaved()
        onDismiss()
    }

    WorkshopFormSheet(if (item == null) "Record item given" else "Edit Given Item", onDismiss, "Save", canSave, ::save, locked = saving) {
        FormSection(title = "Date given") { WorkshopDayRow("Date given", day) { day = it } }
        FormSection(title = "Item / description") {
            WideFieldRow("Item / description", what, { what = it }, prompt = "e.g. Gold ring sample, Silver bangle repair", minLines = 1, maxLines = 3)
        }
        FormSection(title = "Given to") {
            ChipRow(Modifier.padding(vertical = 4.dp)) {
                for (t in listOf(GivenItemRecipientType.karigar, GivenItemRecipientType.customer, GivenItemRecipientType.other)) {
                    FilterChip(GivenLogic.typeWords(t), chosen = type == t, onClick = {
                        if (type != t) {
                            type = t
                            name = ""
                            pickedId = null
                            pickedName = ""
                        }
                    })
                }
            }
            FieldRow(
                "Name", name,
                {
                    name = it
                    // Typing over a picked name makes it a typed one again.
                    if (pickedId != null && it != pickedName) pickedId = null
                },
                prompt = "Name",
            )
            for (s in suggestions(type, trimmedName, pickedId, karigars, customers)) {
                Row(
                    Modifier.fillMaxWidth().defaultMinSize(minHeight = MinTouchTarget).clickable(role = Role.Button) {
                        pickedId = s.id
                        pickedName = s.name
                        name = s.name
                    }.padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(s.name, Modifier.weight(1f))
                    s.hint?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        }
        FormSection(title = "Given by") {
            if (takenBy.isEmpty()) {
                // No list for this house: the ERP records who is signed in, and takes no typed name.
                ValueRow("Given by", givenBy.ifEmpty { "Who is signed in" })
            } else {
                // An older entry's name that is no longer on the list is still shown as it is.
                val options = buildList {
                    add("" to "Not set")
                    if (givenBy.isNotEmpty() && givenBy !in takenBy) add(givenBy to givenBy)
                    takenBy.forEach { add(it to it) }
                }
                PickerRow("Given by", givenBy, options) { givenBy = it }
            }
        }
        FormSection(title = "Notes (optional)") {
            WideFieldRow("Notes", notes, { notes = it }, prompt = "Any extra details", minLines = 2, maxLines = 4)
        }
        WorkshopFormError(error)
    }
}

class GivenSuggestion(val id: String, val name: String, val hint: String?)

/** Up to six people matching what is typed; a karigar list is short enough to show before any typing. */
fun suggestions(type: GivenItemRecipientType, q: String, pickedId: String?, karigars: List<Karigar>, customers: List<Customer>): List<GivenSuggestion> {
    if (pickedId != null) return emptyList()
    return when (type) {
        GivenItemRecipientType.karigar ->
            karigars.filter { q.isEmpty() || it.name.contains(q, ignoreCase = true) }.take(6).map { GivenSuggestion(it.id, it.name, it.contact) }
        GivenItemRecipientType.customer -> {
            if (q.isEmpty()) emptyList()
            else customers.filter { it.name.contains(q, ignoreCase = true) }.take(6).map { GivenSuggestion(it.id, it.name, it.phone) }
        }
        else -> emptyList()
    }
}
