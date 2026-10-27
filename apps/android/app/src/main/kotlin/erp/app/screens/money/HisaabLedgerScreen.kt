package erp.app.screens.money

import erp.app.ui.animatedItem
import erp.app.ui.icons.Symbols
import erp.app.ui.SegmentedColumn
import erp.app.ui.zoomDestination
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.ui.LocalNoteState
import erp.app.ui.SwipeActions
import erp.app.ui.RowAction
import erp.app.ui.OwnerDeleteCodeSheet
import erp.app.ui.OwnerDeletion
import erp.app.auth.LocalSession
import erp.app.data.Connection
import erp.app.data.LocalBook
import erp.app.data.rememberShelfStatus
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.data.ErpApi
import erp.app.ui.FigureRow
import erp.app.ui.FigureTile
import erp.app.ui.LedgerDivider
import erp.app.ui.LedgerHeading
import erp.app.ui.NotAvailableState
import erp.app.ui.Note
import erp.app.ui.Radius
import erp.app.ui.ShelfState
import erp.app.ui.ShopDate
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.readableColumn
import erp.app.ui.theme.ErpColors
import erp.core.logic.Money
import erp.core.logic.WALK_IN_ENTITY
import erp.core.logic.WALK_IN_NAME
import erp.core.models.Customer
import erp.core.models.HisaabEntityType
import erp.core.models.HisaabEntry
import erp.core.models.Karigar
import kotlin.math.abs
import kotlin.math.min

/**
 * Money → Hisaab → one person (src/app/hisaab/[entityId]/page.tsx): what they owe the shop or the shop owes them, and
 * every row of their ledger by date with the balance as it stood.
 *
 * "You gave" and "You got" write a row (HisaabEntrySheet; `addHisaabEntry`), and a swipe deletes one: the ERP asks for
 * the delete code with the delete (`deleteHisaabEntry`, lib/writes/hisaab-entries.ts). Both are for a customer or
 * karigar who is on file, as the web's page is: a walk-in's balance has no page to write on. The ledger PDF is built by
 * the ERP's page in the browser (jsPDF, no server copy), so Print opens that page, and so does the WhatsApp reminder.
 *
 * [path] is "/hisaab/<id>?type=customer|karigar".
 */
@Composable
fun HisaabLedgerScreen(path: String) {
    if (!LocalSession.current.isOwner) {
        MoneyOwnersOnly("Hisaab")
        return
    }
    LedgerBoard(path)
}

@Composable
private fun LedgerBoard(path: String) {
    val book = LocalBook.current
    val navigator = LocalNavigator.current
    val hisaab = rememberShelfStatus(book.hisaab)
    val customers = rememberShelfStatus(book.customers)
    val karigars = rememberShelfStatus(book.karigars)
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()
    val note = LocalNoteState.current
    val id = MoneyPaths.ledgerID(path) ?: ""
    val ready = hisaab.loaded && customers.loaded && karigars.loaded

    var adding by remember { mutableStateOf<HisaabEntryMode?>(null) }
    var deletion by remember { mutableStateOf<OwnerDeletion?>(null) }
    var menu by remember { mutableStateOf(false) }

    val rows = remember(hisaab.revision, id) { hisaab.items.filter { it.entityId == id } }
    val customer = remember(customers.revision, id) { customers.items.firstOrNull { it.id == id } }
    val karigar = remember(karigars.revision, id) { karigars.items.firstOrNull { it.id == id } }
    val isCustomer = LedgerPerson.isCustomer(path, rows, customer, karigar)
    val name = LedgerPerson.name(id, rows, isCustomer, customer, karigar)
    val onFile = LedgerPerson.onFile(id, isCustomer, customer, karigar)
    val notFound = name.isEmpty() && rows.isEmpty()

    ScreenTitle(if (name.isEmpty()) "Hisaab" else name)
    if (ready && !notFound && onFile) {
        ScreenActions {
            Box {
                IconButton(onClick = { menu = true }) { Icon(Symbols.Add, contentDescription = "Add entry") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = { Text("You gave") }, leadingIcon = { Icon(Symbols.ArrowUpward, null) },
                        onClick = { menu = false; adding = HisaabEntryMode.gave },
                    )
                    DropdownMenuItem(
                        text = { Text("You got") }, leadingIcon = { Icon(Symbols.ArrowDownward, null) },
                        onClick = { menu = false; adding = HisaabEntryMode.got },
                    )
                }
            }
        }
    }

    Box(Modifier.fillMaxSize().zoomDestination(path)) {
        ShelfState(loaded = ready, error = hisaab.error, offline = hisaab.offline, connectionLost = connectionLost) {
            if (notFound) {
                // The web says "Entity not found. It may have been deleted."
                NotAvailableState("Not found", why = "It may have been deleted.", icon = Symbols.PersonSearch)
            } else {
                val result = remember(rows) { HisaabLedger.page(rows) }
                // The ERP's own page: the ledger PDF and the WhatsApp reminder are built there, in the browser.
                val printPath = MoneyPaths.ledger(id, isCustomer, web = true)
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 4.dp, bottom = 96.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    animatedItem(key = "head") {
                        Column(Modifier.padding(horizontal = 16.dp).readableColumn(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Footnote(if (isCustomer) "Customer ledger" else "Karigar ledger")
                            Tiles(result)
                        }
                    }
                    animatedItem(key = "heading") {
                        Box(Modifier.padding(horizontal = 20.dp).readableColumn()) { LedgerHeading("Transactions · ${result.lines.size}") }
                    }
                    if (result.lines.isEmpty()) {
                        animatedItem(key = "none") {
                            Column(Modifier.padding(horizontal = 16.dp).readableColumn()) {
                                Text(
                                    "No transactions found.",
                                    Modifier.fillMaxWidth().clip(Radius.cardShape).background(ErpColors.card).ledgerRow(),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    } else {
                        cardRows("l", result.lines, { it.id }) { line ->
                            val delete = RowAction("Delete", Symbols.Delete, Tone.problem) { deletion = askToDelete(line.entry) }
                            val invoiceId = line.entry.linkedInvoiceId
                            // A row that is an invoice's own balance opens the invoice (the web's link beside it).
                            SwipeActions(
                                end = if (onFile) delete else null,
                                menu = if (onFile) listOf(delete) else emptyList(),
                                onClick = if (!invoiceId.isNullOrEmpty()) ({ navigator.open(MoneyPaths.invoice(invoiceId)) }) else null,
                            ) {
                                Box(Modifier.background(ErpColors.card)) { LedgerRow(line, result.hasGold) }
                            }
                        }
                        if (onFile) animatedItem(key = "swipe") {
                            Box(Modifier.padding(horizontal = 20.dp).readableColumn()) { Footnote("Swipe a transaction to delete it. It asks for the delete code.") }
                        }
                    }
                    if (onFile) {
                        animatedItem(key = "add") {
                            Column(Modifier.padding(horizontal = 16.dp).readableColumn(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                SegmentedColumn {
                                    ActionRow("You gave", Symbols.ArrowUpward) { adding = HisaabEntryMode.gave }
                                    LedgerDivider()
                                    ActionRow("You got", Symbols.ArrowDownward) { adding = HisaabEntryMode.got }
                                }
                                Footnote("Writes a row in their hisaab, dated today.")
                            }
                        }
                    }
                    animatedItem(key = "print") {
                        Column(Modifier.padding(horizontal = 16.dp).readableColumn(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            SegmentedColumn {
                                ActionRow("Print the ledger or send a reminder", Symbols.Print) { navigator.open(printPath) }
                            }
                            Footnote("The ledger PDF and the WhatsApp reminder are made on the ERP’s own page.")
                        }
                    }
                }
            }
        }
    }

    adding?.let { mode ->
        HisaabEntrySheet(mode, personId = id, personName = name, isCustomer = isCustomer, onDismiss = { adding = null }, onSaved = { note.show(it) })
    }
    deletion?.let { d ->
        OwnerDeleteCodeSheet(d, onDismiss = { deletion = null }, onDone = { note.show(Note("Transaction deleted")) })
    }
}

/** The web's confirmation, then the delete code with the delete. A row that follows an invoice's balance is put back by the ERP while the invoice still owes, so the sheet says so. */
internal fun askToDelete(entry: HisaabEntry): OwnerDeletion {
    val said = entry.description.ifEmpty { "No description" }
    var detail = "Delete this transaction? “$said”"
    val invoice = entry.linkedInvoiceId
    if (!invoice.isNullOrEmpty()) {
        detail += " It follows the balance of invoice $invoice, so the ERP writes it again while the invoice still owes."
    }
    return OwnerDeletion(what = "Delete this ledger entry", detail = detail, run = { code ->
        ErpApi.shared.write("deleteHisaabEntry", mapOf("entryId" to entry.id, "deleteCode" to code))
    })
}

/** Who a ledger is: customer or karigar, their name, and whether the web's page would find them to write on. */
object LedgerPerson {
    /** `?type=` says which book the person is in; without it the rows, then the records, decide. */
    fun isCustomer(path: String, rows: List<HisaabEntry>, customer: Customer?, karigar: Karigar?): Boolean {
        when (MoneyPaths.query("type", path) ?: "") {
            "karigar" -> return false
            "customer" -> return true
        }
        rows.firstOrNull()?.let { first ->
            if (first.entityType == HisaabEntityType.karigar) return false
            if (first.entityType == HisaabEntityType.customer) return true
        }
        return !(karigar != null && customer == null)
    }

    fun name(id: String, rows: List<HisaabEntry>, isCustomer: Boolean, customer: Customer?, karigar: Karigar?): String {
        if (id == WALK_IN_ENTITY) return WALK_IN_NAME
        val own = if (isCustomer) customer?.name else karigar?.name
        val other = if (isCustomer) karigar?.name else customer?.name
        val named = own ?: other ?: rows.firstOrNull()?.entityName ?: ""
        return named.trim()
    }

    /** Whether the person is a live record the web's page would find: a removed one, and a walk-in, are not, and the web writes nothing on them. */
    fun onFile(id: String, isCustomer: Boolean, customer: Customer?, karigar: Karigar?): Boolean {
        if (id == WALK_IN_ENTITY) return false
        return if (isCustomer) customer?.let { it.deletedAt.isNullOrEmpty() } ?: false else karigar?.let { it.deletedAt.isNullOrEmpty() } ?: false
    }
}

@Composable
private fun ActionRow(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).ledgerRow(),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = ErpColors.accent)
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
    }
}

/** You will get (positive balance) beside You will give, the metal under each. */
@Composable
private fun Tiles(r: HisaabLedgerPage) {
    val getGold = if (r.gold > 0) "${MoneyFormat.grams(r.gold)} ${MoneyWords.metal}" else null
    val giveGold = if (r.gold < 0) "${MoneyFormat.grams(abs(r.gold))} ${MoneyWords.metal}" else null
    FigureRow(spacing = 10.dp) {
        FigureTile("You will get", Money.pkr(maxOf(0.0, r.cash)), Modifier.share(), detail = getGold, tint = Tone.owed.color(), number = maxOf(0.0, r.cash))
        FigureTile("You will give", Money.pkr(abs(min(0.0, r.cash))), Modifier.share(), detail = giveGold, tint = Tone.credit.color(), number = abs(min(0.0, r.cash)))
    }
}

/**
 * What was written, when, how much each way, and the balance after it. "You gave" is a debit (owed), "You got" a
 * credit (settled): the web's words in the kit's tones; a positive balance is owed to the shop.
 */
@Composable
private fun LedgerRow(line: HisaabLedgerLine, showGold: Boolean) {
    val e = line.entry
    Row(
        Modifier.fillMaxWidth().ledgerRow().semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(e.description.ifEmpty { "No description" }, style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium), maxLines = 2)
            Text(ShopDate.say(e.date), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            if (e.cashDebit > 0) Moved("You gave ${Money.pkr(e.cashDebit)}", Tone.owed.color(), big = true)
            if (e.cashCredit > 0) Moved("You got ${Money.pkr(e.cashCredit)}", Tone.settled.color(), big = true)
            if (e.goldDebitGrams > 0) Moved("You gave ${MoneyFormat.grams(e.goldDebitGrams)}", Tone.owed.color())
            if (e.goldCreditGrams > 0) Moved("You got ${MoneyFormat.grams(e.goldCreditGrams)}", Tone.settled.color())
            Text("Balance ${Money.pkr(line.cash)}", style = MaterialTheme.typography.bodySmall, color = balanceTone(line.cash))
            if (showGold) Text("${MoneyFormat.grams(line.gold)} ${MoneyWords.metal}", style = MaterialTheme.typography.bodySmall, color = balanceTone(line.gold))
        }
    }
}

@Composable
private fun Moved(text: String, color: Color, big: Boolean = false) {
    Text(
        text,
        style = if (big) MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold) else MaterialTheme.typography.bodySmall,
        color = color,
    )
}

@Composable
private fun balanceTone(balance: Double): Color {
    if (abs(balance) < 1) return MaterialTheme.colorScheme.onSurfaceVariant
    return if (balance > 0) Tone.owed.color() else Tone.credit.color()
}
