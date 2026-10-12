package erp.app.screens.owner

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AddCircleOutline
import androidx.compose.material.icons.filled.ArrowOutward
import androidx.compose.material.icons.filled.CallReceived
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.clickable
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.data.Book
import erp.app.data.Connection
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.Single
import erp.app.data.Sort
import erp.app.data.Shelf
import erp.app.data.rememberShelfStatus
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.screens.money.Footnote
import erp.app.screens.money.Host
import erp.app.screens.money.MoneyAction
import erp.app.screens.money.MoneyOwnersOnly
import erp.app.screens.money.MoneyParse
import erp.app.screens.money.MoneySwipe
import erp.app.screens.money.cardEdges
import erp.app.screens.money.cardRows
import erp.app.screens.money.rememberScreenNote
import erp.app.ui.FigureRow
import erp.app.ui.FigureTile
import erp.app.ui.HeroAmount
import erp.app.ui.LedgerDivider
import erp.app.ui.LedgerHeading
import erp.app.ui.NotAvailableState
import erp.app.ui.Note
import erp.app.ui.PaymentText
import erp.app.ui.RowAmount
import erp.app.ui.ShelfState
import erp.app.ui.Tone
import erp.app.ui.TwoLine
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.readableColumn
import erp.app.ui.theme.ErpColors
import erp.core.logic.Money
import erp.core.logic.Overheads
import erp.core.logic.Partnership
import erp.core.logic.PartnerDistributionInput
import erp.core.logic.ShareholderFigures
import erp.core.models.Collections
import erp.core.models.Expense
import erp.core.models.FloorHistoryEntry
import erp.core.models.PartnerLedgerType
import erp.core.models.PartnershipSettings
import erp.core.models.ShareholderLedgerRow
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.UUID
import kotlin.math.abs

/**
 * Money → Shareholders (src/app/shareholders/page.tsx): the two partners side by side, who is in for how much. Divided
 * equally: revenue and expenses since the partnership started, each partner's loan, equity and half of the P&L from
 * their own ledger, what unequal salaries move between them, and the distribution calculator (loans repaid first, then
 * the split, above the working-capital floor).
 *
 * Every figure is the page's own (core's ShareholderFigures and Partnership, ported from lib/shareholder-figures.ts and
 * lib/partnership.ts). Paying a salary, a contribution and a withdrawal are native; so are deleting an entry or a salary
 * payment, which ask for the delete code the ERP checks with the delete. Only the house that keeps partner ledgers has
 * this page (`session.shop.partnership`), and only its owners.
 */
@Composable
fun ShareholdersScreen() {
    val session = LocalSession.current
    if (!session.isOwner) {
        MoneyOwnersOnly("Shareholders")
    } else if (!session.shop.partnership) {
        // Reachable by address from either house; only one keeps this book.
        ScreenTitle("Shareholders")
        NotAvailableState("No partner ledgers", why = "This shop keeps no partner ledgers.", icon = Icons.Filled.People)
    } else {
        ShareholdersBoard()
    }
}

/**
 * The partners' own books and the floor, read live for this screen only: the shop's Book has no shelves for them, and
 * nobody else reads them. Owners read Firestore themselves, as the page does.
 */
class ShareholderBooks(book: Book = Book.shared) {
    val mina = Shelf(Collections.minaLedger, ShareholderLedgerRow, { it.id }, Sort.descending<ShareholderLedgerRow> { it.date }, book)
    val ammar = Shelf(Collections.ammarLedger, ShareholderLedgerRow, { it.id }, Sort.descending<ShareholderLedgerRow> { it.date }, book)
    val floor = Single(Collections.settings, "partnership", PartnershipSettings, book)

    fun need() {
        mina.need()
        ammar.need()
        floor.need()
    }

    /** Off the screen, the listeners stop; coming back starts them again. */
    fun stop() {
        mina.reset()
        ammar.reset()
        floor.reset()
    }
}

/** Everything the page works out from the books, once per change of them. */
class ShareholderBoardFigures(
    val totals: ShareholderFigures.Totals,
    val positions: List<ShareholderFigures.Position>,
    val gap: ShareholderFigures.SalaryGap?,
) {
    companion object {
        fun of(
            expenses: List<Expense>,
            invoices: List<erp.core.models.Invoice>,
            orders: List<erp.core.models.Order>,
            revenue: List<erp.core.models.AdditionalRevenue>,
            mina: List<ShareholderLedgerRow>,
            ammar: List<ShareholderLedgerRow>,
        ): ShareholderBoardFigures {
            val totals = ShareholderFigures.partnershipTotals(expenses, invoices, orders, revenue)
            val ledgers = mapOf("mina" to ShareholderFigures.shown(mina), "ammar" to ShareholderFigures.shown(ammar))
            val positions = ShareholderFigures.partnerPositions(
                partners = ShareholderPerson.all.map { it.id to it.name },
                ledgers = ledgers,
                salariesBy = ShareholderFigures.salariesByPartner(expenses),
                totals = totals,
            )
            return ShareholderBoardFigures(totals, positions, ShareholderFigures.salaryGap(positions))
        }
    }
}

@Composable
private fun ShareholdersBoard() {
    val book = LocalBook.current
    val scope = rememberCoroutineScope()
    val books = remember { ShareholderBooks() }
    DisposableEffect(books) {
        books.need()
        onDispose { books.stop() }
    }
    val expenses = rememberShelfStatus(book.expenses)
    val invoices = rememberShelfStatus(book.invoices)
    val orders = rememberShelfStatus(book.orders)
    val revenue = rememberShelfStatus(book.revenue)
    val mina = rememberShelfStatus(books.mina)
    val ammar = rememberShelfStatus(books.ammar)
    val floorLoaded by books.floor.loaded.collectAsStateWithLifecycle()
    val floorValue by books.floor.value.collectAsStateWithLifecycle()
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()
    val note = rememberScreenNote()

    var asking by remember { mutableStateOf<ShareholderAsk?>(null) }
    var deletion by remember { mutableStateOf<OwnerAsk?>(null) }
    var menu by remember { mutableStateOf(false) }
    var cashText by rememberSaveable { mutableStateOf("") }
    var floorText by remember { mutableStateOf<String?>(null) }
    var savingFloor by remember { mutableStateOf(false) }
    var floorError by remember { mutableStateOf<String?>(null) }

    val ready = expenses.loaded && invoices.loaded && orders.loaded && revenue.loaded && mina.loaded && ammar.loaded && floorLoaded
    val readError = mina.error ?: ammar.error ?: expenses.error ?: invoices.error ?: orders.error ?: revenue.error

    val figures = remember(expenses.revision, invoices.revision, orders.revision, revenue.revision, mina.revision, ammar.revision) {
        ShareholderBoardFigures.of(expenses.items, invoices.items, orders.items, revenue.items, mina.items, ammar.items)
    }
    val salaryPaid = remember(figures) { figures.positions.associate { it.id to it.salaryPaid } }

    ScreenTitle("Shareholders")
    ScreenActions {
        Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Filled.Add, contentDescription = "Add") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(
                    text = { Text("Add contribution") }, leadingIcon = { Icon(Icons.Filled.Add, null) },
                    onClick = { menu = false; asking = ShareholderAsk(ShareholderMove.contribution, "mina") },
                )
                DropdownMenuItem(
                    text = { Text("Pay salary") }, leadingIcon = { Icon(Icons.Filled.Payments, null) },
                    onClick = { menu = false; asking = ShareholderAsk(ShareholderMove.salary, "mina") },
                )
                DropdownMenuItem(
                    text = { Text("Withdraw capital") }, leadingIcon = { Icon(Icons.Filled.ArrowOutward, null) },
                    onClick = { menu = false; asking = ShareholderAsk(ShareholderMove.withdrawal, "mina") },
                )
            }
        }
    }

    val settings = floorValue ?: PartnershipSettings.none

    Box(Modifier.fillMaxSize()) {
        ShelfState(loaded = ready, error = readError, offline = expenses.offline, connectionLost = connectionLost) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 4.dp, bottom = 96.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item(key = "tiles") { Tiles(figures.totals) }
                for (p in figures.positions) {
                    item(key = "p-${p.id}") { PartnerCard(p, onAsk = { asking = it }) }
                    if (p.rows.isEmpty() && p.salaries.isEmpty()) {
                        item(key = "none-${p.id}") {
                            Column(Modifier.padding(horizontal = 16.dp).readableColumn()) {
                                Text(
                                    "No entries recorded.",
                                    Modifier.fillMaxWidth().cardEdges(true, true).ledgerRow(),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                    val entries: List<PartnerEntry> = p.salaries.map { PartnerEntry.Salary(it) } + p.rows.map { PartnerEntry.Row(it) }
                    cardRows("x-${p.id}-", entries, { it.key }) { entry ->
                        when (entry) {
                            is PartnerEntry.Salary -> SalaryRow(entry.e, p, onDelete = { deletion = askDeleteSalary(entry.e) })
                            is PartnerEntry.Row -> LedgerEntryRow(entry.r, p, onDelete = { deletion = askDeleteEntry(entry.r, p) })
                        }
                    }
                    if (entries.isNotEmpty()) item(key = "foot-${p.id}") {
                        Box(Modifier.padding(horizontal = 20.dp).readableColumn()) {
                            Footnote("Withdrawing capital reduces their stake; it is not a salary. Swipe an entry to delete it.")
                        }
                    }
                }
                item(key = "notes") { Notes(figures) }
                item(key = "distribution") {
                    Distribution(
                        figures.positions, settings, cashText, { cashText = it },
                        floorText, { floorText = it }, savingFloor, floorError,
                        saveFloor = { value ->
                            savingFloor = true
                            floorError = null
                            scope.launch {
                                try {
                                    ErpApi.shared.write("setWorkingCapitalFloor", mapOf("value" to value, "seq" to UUID.randomUUID().toString()))
                                    floorText = null
                                    note.show(Note("Working capital floor saved", "${Money.pkr(value)} — recorded with timestamp."))
                                } catch (e: CancellationException) {
                                    throw e
                                } catch (e: Exception) {
                                    floorError = e.message ?: e.toString()
                                }
                                savingFloor = false
                            }
                        },
                    )
                }
            }
        }
        note.Host()
    }

    asking?.let { a ->
        ShareholderEntrySheet(a, salaryPaid, onDismiss = { asking = null }, onSaved = { note.show(it) })
    }
    deletion?.let { d ->
        OwnerAskSheet(
            d, onDismiss = { deletion = null },
            onDone = { note.show(Note(if (d.what.startsWith("Delete expense")) "Salary payment removed" else "Entry removed")) },
        )
    }
}

/** One row under a partner: a salary (an expense) or a ledger row, one list. */
private sealed interface PartnerEntry {
    val key: String

    class Salary(val e: Expense) : PartnerEntry { override val key get() = "s" + e.id }
    class Row(val r: ShareholderLedgerRow) : PartnerEntry { override val key get() = "r" + r.id }
}

internal fun askDeleteSalary(e: Expense): OwnerAsk = ownerAsk(
    what = "Delete expense \"${e.description}\"",
    detail = "Remove this salary payment? ${e.description} — ${ShareholderMoney.fmt(e.amount)}. It will be deleted from Expenses too.",
) { code -> ErpApi.shared.write("deletePartnerSalary", mapOf("expenseId" to e.id, "deleteCode" to code)) }

internal fun askDeleteEntry(r: ShareholderLedgerRow, p: ShareholderFigures.Position): OwnerAsk {
    val linked = r.linkedExpenseId != null
    return ownerAsk(
        what = "Delete this ${p.name} ledger entry",
        detail = "Remove this entry? ${r.description} — ${ShareholderMoney.fmt(r.amount)}." +
            (if (linked) " The matching Partner Drawings expense will be deleted too." else ""),
    ) { code -> ErpApi.shared.write("deleteShareholderEntry", mapOf("shareholderId" to p.id, "entryId" to r.id, "deleteCode" to code)) }
}

// MARK: The page

@Composable
private fun Tiles(t: ShareholderFigures.Totals) {
    val share = t.revShare - t.expShare
    Column(Modifier.padding(horizontal = 16.dp).readableColumn(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Footnote("Divided equally · expenses from ${OwnerText.shortDate(ShareholderFigures.expenseCutoff)} · revenue from Shopify #1103")
        FigureRow(spacing = 10.dp) {
            FigureTile("Revenue", ShareholderMoney.fmt(t.totalRevenue), Modifier.share(), tint = Tone.settled.color(), number = t.totalRevenue)
            FigureTile("Expenses", ShareholderMoney.fmt(t.totalExpenses), Modifier.share(), number = t.totalExpenses)
        }
        FigureTile(
            "Each partner’s share", ShareholderMoney.signed(share), Modifier.fillMaxWidth(),
            tint = if (share >= 0) Tone.settled.color() else Tone.owed.color(), number = share,
        )
    }
}

// MARK: Each partner

@Composable
private fun PartnerCard(p: ShareholderFigures.Position, onAsk: (ShareholderAsk) -> Unit) {
    val claim = p.balance.totalClaim
    val owed = claim > 0
    val words = if (owed) "The business owes ${p.name}" else if (claim < 0) "${p.name} owes the business" else "All settled"
    val tone: Color = if (owed) Tone.credit.color() else if (claim < 0) Tone.owed.color() else MaterialTheme.colorScheme.onSurface
    Column(Modifier.padding(horizontal = 16.dp).readableColumn(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LedgerHeading(p.name, Modifier.padding(horizontal = 4.dp))
        Column(Modifier.fillMaxWidth().cardEdges(true, true).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(words, Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
                HeroAmount(abs(claim), tone = tone)
            }
            LabeledRow("Loan to the business") { RowAmount(abs(p.balance.loanBalance)) }
            LabeledRow("Equity in the business") { RowAmount(abs(p.balance.equityBalance)) }
            LabeledRow("Half of profit & loss") {
                Text(
                    ShareholderMoney.signed(p.balance.netPnL),
                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = if (p.balance.netPnL >= 0) Tone.settled.color() else Tone.owed.color(),
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SmallFigure("Contributed", p.contributed, Icons.Filled.CallReceived, Modifier.weight(1f))
                SmallFigure("Salary", p.salaryPaid, Icons.Filled.Payments, Modifier.weight(1f))
                SmallFigure("Capital drawn", p.withdrawn, Icons.Filled.ArrowOutward, Modifier.weight(1f))
            }
        }
        Column(Modifier.fillMaxWidth().cardEdges(true, true)) {
            ActionRow("Pay salary", Icons.Filled.Payments) { onAsk(ShareholderAsk(ShareholderMove.salary, p.id)) }
            LedgerDivider()
            ActionRow("Add a contribution", Icons.Filled.AddCircleOutline) { onAsk(ShareholderAsk(ShareholderMove.contribution, p.id)) }
            LedgerDivider()
            ActionRow("Withdraw capital", Icons.Filled.ArrowOutward) { onAsk(ShareholderAsk(ShareholderMove.withdrawal, p.id)) }
        }
    }
}

@Composable
private fun LabeledRow(label: String, value: @Composable () -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        value()
    }
}

@Composable
private fun SmallFigure(label: String, amount: Double, icon: androidx.compose.ui.graphics.vector.ImageVector, modifier: Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
        Text(ShareholderMoney.fmt(amount), style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold), maxLines = 1)
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

@Composable
private fun SalaryRow(e: Expense, p: ShareholderFigures.Position, onDelete: () -> Unit) {
    val shown = e.description.replace("${p.name} salary — ", "")
    val delete = MoneyAction("Delete", Icons.Filled.Delete, Tone.problem, onDelete)
    MoneySwipe(end = delete, menu = listOf(delete)) {
        Box(Modifier.background(ErpColors.card).fillMaxWidth().ledgerRow()) {
            TwoLine(
                title = shown,
                subtitle = "${OwnerText.shortDate(e.date)} · Salary · recorded as a business cost",
                trailing = ShareholderMoney.fmt(e.amount),
                trailingTint = ErpColors.accent,
            )
        }
    }
}

@Composable
private fun LedgerEntryRow(r: ShareholderLedgerRow, p: ShareholderFigures.Position, onDelete: () -> Unit) {
    val isIn = r.type == PartnerLedgerType.payment
    var sub = "${OwnerText.shortDate(r.date)} · ${if (r.category == erp.core.models.PartnerLedgerCategory.loan) "Loan" else "Equity"}"
    if (r.linkedExpenseId != null) sub += " · logged as an expense"
    val delete = MoneyAction("Delete", Icons.Filled.Delete, Tone.problem, onDelete)
    MoneySwipe(end = delete, menu = listOf(delete)) {
        Box(Modifier.background(ErpColors.card).fillMaxWidth().ledgerRow()) {
            TwoLine(
                title = r.description,
                subtitle = sub,
                trailing = "${if (isIn) "+" else "−"}${ShareholderMoney.fmt(r.amount)}",
                trailingTint = if (isIn) Tone.settled.color() else Tone.owed.color(),
            )
        }
    }
}

// MARK: What the figures mean

@Composable
private fun Notes(f: ShareholderBoardFigures) {
    if (f.gap == null && f.totals.drawings <= 0) return
    Column(Modifier.padding(horizontal = 16.dp).readableColumn(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Column(Modifier.fillMaxWidth().cardEdges(true, true).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            f.gap?.let { g ->
                InfoLine(
                    "${g.ahead.name} has drawn ${ShareholderMoney.fmt(g.ahead.salaryPaid - g.behind.salaryPaid)} more salary than ${g.behind.name}. " +
                        "A salary is a business cost split 50/50, so that gap has moved about ${ShareholderMoney.fmt(g.transferred)} from ${g.behind.name} to ${g.ahead.name}. " +
                        "Equal salaries cancel out entirely.",
                )
            }
            if (f.totals.drawings > 0) {
                InfoLine(
                    "${ShareholderMoney.fmt(f.totals.drawings)} of drawings sits in Expenses under “${Partnership.partnerDrawings}”. " +
                        "It is left out of the profit split above, because a draw already reduces that partner’s own equity — " +
                        "counting it as a shared cost as well would charge them for it twice.",
                )
            }
        }
    }
}

@Composable
private fun InfoLine(text: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
        Icon(Icons.Filled.Info, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// MARK: Distribution calculator

@Composable
private fun Distribution(
    positions: List<ShareholderFigures.Position>,
    s: PartnershipSettings,
    cashText: String,
    onCash: (String) -> Unit,
    floorText: String?,
    onFloorText: (String?) -> Unit,
    savingFloor: Boolean,
    floorError: String?,
    saveFloor: (Double) -> Unit,
) {
    var showHistory by rememberSaveable { mutableStateOf(false) }
    val cash = maxOf(0.0, MoneyParse.amount(cashText) ?: 0.0)
    // The calculator holds back the floor as saved, as the page's does (onFloorChange fires on load and save).
    val d = Partnership.calculateDistribution(
        cashOnHand = cash,
        workingCapitalFloor = maxOf(0.0, s.workingCapitalFloor),
        partners = positions.map { p -> PartnerDistributionInput(p.name, p.balance.loanBalance, p.balance.equityBalance, p.balance.netPnL) },
    )
    Column(Modifier.padding(horizontal = 16.dp).readableColumn(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LedgerHeading("Distribution calculator", Modifier.padding(horizontal = 4.dp))
        Column(Modifier.fillMaxWidth().cardEdges(true, true).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (Partnership.isFloorStale(s) && Partnership.isMonthStart()) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
                    Icon(Icons.Filled.Warning, contentDescription = null, tint = Tone.owed.color())
                    Text(
                        "It’s a new month — review the working-capital floor for ${Overheads.monthLabel(Overheads.monthKey(Instant.now()))}. Last set: ${lastSet(s)}.",
                        style = MaterialTheme.typography.bodySmall, color = Tone.owed.color(),
                    )
                }
            }
            LabeledRow("Cash available") {
                OutlinedTextField(
                    value = cashText, onValueChange = onCash, modifier = Modifier.widthIn130(),
                    singleLine = true, placeholder = { Text("0") },
                    textStyle = MaterialTheme.typography.bodyLarge.copy(textAlign = TextAlign.End),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
            }
            FloorRow(s, floorText, onFloorText, savingFloor, saveFloor)
            if (s.floorHistory.isNotEmpty()) {
                Row(
                    Modifier.fillMaxWidth().clickable(role = Role.Button) { showHistory = !showHistory }
                        .semantics { stateDescription = if (showHistory) "Expanded" else "Collapsed" },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Last reviewed: ${s.floorLastSetAt?.let { OwnerText.shortDate(it) } ?: "—"} · ${s.floorHistory.size} change${if (s.floorHistory.size == 1) "" else "s"}",
                        Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Icon(Icons.Filled.ExpandMore, contentDescription = null, Modifier.rotate(if (showHistory) 0f else -90f), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (showHistory) {
                    // Newest first, as the page lists them.
                    for (entry in s.floorHistory.reversed()) FloorHistoryRow(entry)
                }
            }
            if (cash > 0) {
                LabeledRow("Held back as working capital") { RowAmount(abs(d.workingCapitalFloor)) }
                LabeledRow("Available to distribute") { RowAmount(abs(d.distributableCash)) }
                for (pr in d.perPartner) {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Row {
                            Text(pr.name, Modifier.weight(1f), fontWeight = FontWeight.Medium)
                            Text(ShareholderMoney.fmt(pr.total), fontWeight = FontWeight.Medium)
                        }
                        Text(
                            "loan ${ShareholderMoney.fmt(pr.loanRepayment)}   equity ${ShareholderMoney.fmt(pr.equityDraw)}   profit ${ShareholderMoney.fmt(pr.profitShare)}",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                if (!d.feasible) {
                    Text(
                        "Not enough to clear the floor and the loans — ${ShareholderMoney.fmt(d.shortfallToFirstDistribution)} short.",
                        style = MaterialTheme.typography.bodySmall, color = Tone.owed.color(),
                    )
                }
            }
            floorError?.let { erp.app.screens.money.ErrorLine(it) }
        }
        Footnote("If there were cash to distribute, this is how it would flow — loans repaid first, then the split.")
    }
}

private fun Modifier.widthIn130(): Modifier = this.width(130.dp)

@Composable
private fun FloorHistoryRow(entry: FloorHistoryEntry) {
    val whenSaid = OwnerText.shortDate(entry.date)
    val who = entry.by?.let { "$whenSaid · $it" } ?: whenSaid
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(who, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
        Text(Money.pkr(entry.value), style = MaterialTheme.typography.bodySmall)
    }
}

private fun lastSet(s: PartnershipSettings): String {
    val whenSaid = s.floorLastSetAt?.let { OwnerText.shortDate(it) } ?: "—"
    val by = s.floorHistory.lastOrNull()?.by
    return if (!by.isNullOrEmpty()) "$whenSaid by $by" else whenSaid
}

/** The floor, edited where it is shown and saved with a stamp (`setWorkingCapitalFloor`). */
@Composable
private fun FloorRow(s: PartnershipSettings, floorText: String?, onFloorText: (String?) -> Unit, saving: Boolean, saveFloor: (Double) -> Unit) {
    val typed = floorText ?: PaymentText.field(s.workingCapitalFloor)
    val parsed = maxOf(0.0, MoneyParse.amount(typed) ?: 0.0)
    val changed = parsed != s.workingCapitalFloor
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("Working capital floor", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        OutlinedTextField(
            value = typed, onValueChange = { onFloorText(it) }, modifier = Modifier.widthIn130(),
            singleLine = true, placeholder = { Text("0") },
            textStyle = MaterialTheme.typography.bodyLarge.copy(textAlign = TextAlign.End),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        )
        if (changed) {
            Button(onClick = { saveFloor(parsed) }, enabled = !saving) {
                if (saving) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = ErpColors.onAccent) else Text("Save")
            }
        } else {
            Icon(Icons.Filled.CheckCircle, contentDescription = "Saved", tint = Tone.settled.color())
        }
    }
}
