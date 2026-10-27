package erp.app.screens.money

import erp.app.ui.animatedItem
import erp.app.ui.SegmentedColumn
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.ui.LocalNoteState
import erp.app.ui.SwipeActions
import erp.app.ui.RowAction
import erp.app.ui.OwnerDeleteCodeSheet
import erp.app.ui.OwnerDeletion
import erp.app.auth.LocalSession
import erp.app.data.Connection
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.rememberShelf
import erp.app.data.rememberShelfStatus
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.ui.ChipRow
import erp.app.ui.FigureRow
import erp.app.ui.FigureTile
import erp.app.ui.FilterChip
import erp.app.ui.LedgerHeading
import erp.app.ui.NotAvailableState
import erp.app.ui.Note
import erp.app.ui.Radius
import erp.app.ui.ShelfState
import erp.app.ui.ShopDate
import erp.app.ui.Tone
import erp.app.ui.TwoLine
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.readableColumn
import erp.app.ui.theme.ErpColors
import erp.core.logic.Money
import erp.core.models.Expense
import erp.core.models.PaidBy
import java.time.Instant

/**
 * Money → Expenses (src/app/expenses/page.tsx): every expense in a period, grouped by day, week or month with a
 * subtotal for each group, with the page's tiles, a category filter and search. Adding, editing and deleting are
 * native (a swipe or a long press on a row): Delete asks for the delete code, which the ERP checks with the delete
 * itself. A partner's drawing is the Shareholders page's, where it goes with its withdrawal, so its row points there
 * instead. The report PDF is drawn by the ERP's page. The period and the grouping are two different questions, as on
 * the web: how far back to look, and how coarsely to bucket what is there. Owners only.
 */
@Composable
fun ExpensesScreen() {
    if (!LocalSession.current.isOwner) {
        MoneyOwnersOnly("Expenses")
        return
    }
    ExpensesBoard()
}

@Composable
private fun ExpensesBoard() {
    val book = LocalBook.current
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val partnership = session.shop.partnership
    val expenses = rememberShelfStatus(book.expenses)
    val karigars by rememberShelf(book.karigars)
    // His hisaabs are read by the sheets; started here so they are ready when one opens.
    rememberShelf(book.karigarBatches)
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()
    val note = LocalNoteState.current

    var search by rememberSaveable { mutableStateOf("") }
    var period by rememberSaveable { mutableStateOf(ExpensePeriod.thisMonth) }
    var grouping by rememberSaveable { mutableStateOf(ExpenseGrouping.day) }
    // Custom range: no bound until a start date is chosen (date-grouping.ts periodRange).
    var custom by remember { mutableStateOf(MoneyCustomRange()) }
    // "" is every category.
    var category by rememberSaveable { mutableStateOf("") }
    var adding by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<Expense?>(null) }
    var deletion by remember { mutableStateOf<OwnerDeletion?>(null) }
    var menu by remember { mutableStateOf(false) }

    val karigarNames = remember(karigars) { karigars.associate { it.id to it.name } }
    val names = remember(expenses.revision, session.shop.expenseCategories) {
        ExpenseFigures.categories(session.shop.expenseCategories, expenses.items)
    }
    // What the Add expense sheet offers.
    val sheetCategories = remember(expenses.revision, session.shop.expenseCategories) {
        ExpenseFigures.formCategories(session.shop.expenseCategories, expenses.items)
    }

    ScreenTitle("Expenses")
    val filtering = period != ExpensePeriod.thisMonth || grouping != ExpenseGrouping.day
    ScreenActions {
        Box {
            IconButton(onClick = { menu = true }) {
                Icon(
                    Icons.Filled.FilterList,
                    contentDescription = if (filtering) "Period and grouping, on" else "Period and grouping",
                    tint = if (filtering) ErpColors.accent else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                MenuHeading("Period")
                for (p in ExpensePeriod.values()) ChoiceItem(p.title, p == period) { period = p; menu = false }
                androidx.compose.material3.HorizontalDivider()
                MenuHeading("Group by")
                for (g in ExpenseGrouping.values()) ChoiceItem(g.title, g == grouping) { grouping = g; menu = false }
            }
        }
        IconButton(onClick = { adding = true }) { Icon(Icons.Filled.Add, contentDescription = "Add expense") }
    }

    Box(Modifier.fillMaxSize()) {
        ShelfState(loaded = expenses.loaded, error = expenses.error, offline = expenses.offline, connectionLost = connectionLost) {
            val now = remember(expenses.revision, period, custom, grouping, search, category) { Instant.now() }
            val range = remember(period, custom, now) { period.range(custom.fromDay, custom.toDay, now) }
            // Search and the period: everything but the category, so each chip can count what it would show.
            val scoped = remember(expenses.revision, range, search, karigarNames) { scopedLines(expenses.items, range, search, karigarNames) }
            val shown = remember(scoped, category) { if (category.isEmpty()) scoped else scoped.filter { it.item.category == category } }
            val groups = remember(shown, grouping, now) { MoneyBuckets.group(shown, grouping, now) { it.amount } }
            val summary = remember(shown, groups) { ExpenseFigures.summary(shown, groups) }

            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 4.dp, bottom = 96.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                animatedItem(key = "search") {
                    Box(Modifier.padding(horizontal = 16.dp).readableColumn()) { MoneySearchField(search, { search = it }, "Description, category or karigar") }
                }
                if (names.isNotEmpty()) animatedItem(key = "chips") {
                    ChipRow {
                        FilterChip("All", chosen = category.isEmpty(), onClick = { category = "" }, count = scoped.size)
                        for (n in names) FilterChip(n, chosen = category == n, onClick = { category = n }, count = scoped.count { it.item.category == n })
                    }
                }
                if (period == ExpensePeriod.custom) animatedItem(key = "custom") {
                    Column(Modifier.padding(horizontal = 16.dp).readableColumn(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        LedgerHeading("Custom range", Modifier.padding(horizontal = 16.dp))
                        SegmentedColumn {
                            MoneyRangeFields(custom, { custom = it })
                        }
                        Footnote(if (custom.useFrom) "Without an end date it runs to the end of today." else "Until a start date is chosen, every expense is shown.")
                    }
                }
                animatedItem(key = "figures") {
                    Column(Modifier.padding(horizontal = 16.dp).readableColumn(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Footnote(periodLine(period, range))
                        Figures(summary, grouping, category)
                    }
                }
                if (groups.isEmpty()) {
                    animatedItem(key = "empty") {
                        val filtered = search.isNotEmpty() || category.isNotEmpty()
                        NotAvailableState(
                            "No expenses in this period",
                            why = if (filtered) "Select a wider period, or clear the filters." else "No expenses recorded for ${period.title.lowercase()}.",
                            icon = Icons.Filled.Inbox,
                        )
                    }
                }
                for (group in groups) {
                    animatedItem(key = "h" + group.key) {
                        val n = group.rows.size
                        val count = "$n item${if (n == 1) "" else "s"}"
                        Column(Modifier.padding(horizontal = 20.dp).padding(top = 8.dp).readableColumn(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            LedgerHeading(group.label, trailing = Money.pkr(group.total))
                            Text(
                                if (group.sub.isEmpty()) count else "${group.sub} · $count",
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    cardRows("e" + group.key, group.rows, { it.id }) { line ->
                        ExpenseRow(
                            line.item, karigarNames, partnership,
                            edit = { editing = line.item },
                            delete = { deletion = askDelete(line.item) },
                            shareholders = { navigator.open(MoneyPaths.shareholders) },
                        )
                    }
                }
                animatedItem(key = "report") {
                    Column(Modifier.padding(horizontal = 16.dp).readableColumn(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        SegmentedColumn {
                            Row(
                                Modifier.fillMaxWidth().clickable(role = Role.Button) { navigator.open(MoneyPaths.expensesWeb) }.ledgerRow(),
                                horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(Icons.Filled.Description, contentDescription = null, tint = ErpColors.accent)
                                Text("Expense report (PDF)", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                            }
                        }
                        Footnote("The report is drawn by the ERP’s page, for the period and filters chosen there.")
                    }
                }
            }
        }
    }

    if (adding) {
        AddExpenseSheet(sheetCategories, partnership, onDismiss = { adding = false }, onSaved = { note.show(it) })
    }
    editing?.let { e ->
        ExpenseEditSheet(e, sheetCategories, partnership, onDismiss = { editing = null }, onSaved = { note.show(it) })
    }
    deletion?.let { d ->
        OwnerDeleteCodeSheet(d, onDismiss = { deletion = null }, onDone = { note.show(Note("Expense deleted", "The record has been removed.")) })
    }
}

/** "This month · 1 Oct – 8 Oct 2026". */
internal fun periodLine(period: ExpensePeriod, range: MoneyDayRange): String {
    val caption = range.caption ?: return period.title
    return "${period.title} · $caption"
}

/** The period, then the search: description, category or the karigar paid. */
internal fun scopedLines(all: List<Expense>, range: MoneyDayRange, search: String, karigarNames: Map<String, String>): List<MoneyLine<Expense>> {
    val needle = search.trim()
    val out = ArrayList<MoneyLine<Expense>>()
    for (e in all) {
        val day = MoneyMonths.day(e.date)
        if (!range.contains(day)) continue
        if (needle.isNotEmpty() && !expenseMatches(e, needle, karigarNames)) continue
        out.add(MoneyLine(e, day, e.id))
    }
    return out
}

internal fun expenseMatches(e: Expense, q: String, karigarNames: Map<String, String>): Boolean {
    if (moneyContains(e.description, q)) return true
    if (moneyContains(e.category, q)) return true
    val kid = e.karigarId
    if (kid != null) karigarNames[kid]?.let { if (moneyContains(it, q)) return true }
    return false
}

/** Nil for the business: an expense with no `paidBy` is the business's. */
internal fun payerName(who: PaidBy): String? = when (who) {
    PaidBy.business -> null
    PaidBy.ammar -> "Ammar"
    PaidBy.mina -> "Mina"
    // Swift's `capitalized`: the first letter up, the rest down.
    else -> who.rawValue.takeIf { it.isNotEmpty() }?.lowercase()?.replaceFirstChar { it.uppercase() }
}

/** When, which category, and who it went to: the karigar or partner it paid, and a partner who fronted the cash (the web's badges). */
internal fun expenseSubtitle(e: Expense, karigarNames: Map<String, String>): String {
    val parts = ArrayList<String>()
    val whenSaid = ShopDate.say(e.date)
    if (whenSaid.isNotEmpty()) parts.add(whenSaid)
    if (e.category.isNotEmpty()) parts.add(e.category)
    val kid = e.karigarId
    if (kid != null) karigarNames[kid]?.takeIf { it.isNotEmpty() }?.let { parts.add(it) }
    MoneyPartners.name(e.shareholderId)?.let { parts.add(it) }
    payerName(e.paidBy)?.let { parts.add("paid by $it") }
    return parts.joinToString(" · ")
}

/**
 * The web's "Delete this expense?" and the code, in one sheet: what goes is said before the code is asked for. The
 * ERP checks the code with the delete (`deleteExpense`).
 */
internal fun askDelete(e: Expense): OwnerDeletion {
    val id = e.id
    return OwnerDeletion(ExpenseEditing.deleteWhat(e), "Delete this expense? ${ExpenseEditing.deleteDetail(e)}", run = { code ->
        ErpApi.shared.write("deleteExpense", mapOf("expenseId" to id, "deleteCode" to code))
    })
}

@Composable
private fun ExpenseRow(
    e: Expense,
    karigarNames: Map<String, String>,
    partnership: Boolean,
    edit: () -> Unit,
    delete: () -> Unit,
    shareholders: () -> Unit,
) {
    val row: @Composable () -> Unit = {
        Box(Modifier.background(ErpColors.card).fillMaxWidth().ledgerRow()) {
            TwoLine(
                title = e.description.ifEmpty { e.category },
                subtitle = expenseSubtitle(e, karigarNames),
                trailing = Money.pkr(e.amount),
            )
        }
    }
    if (ExpenseEditing.isDrawing(e, partnership)) {
        val go = RowAction("Change this on Shareholders", Icons.Filled.Group, Tone.quiet, shareholders)
        SwipeActions(end = RowAction("Shareholders", Icons.Filled.Group, Tone.quiet, shareholders), menu = listOf(go), onClick = null, content = row)
    } else {
        val editAction = RowAction("Edit", Icons.Filled.Edit, Tone.house, edit)
        val deleteAction = RowAction("Delete", Icons.Filled.Delete, Tone.problem, delete)
        SwipeActions(start = editAction, end = deleteAction, menu = listOf(editAction, deleteAction), onClick = null, content = row)
    }
}

/**
 * The page's tiles in its order: total, payments, average per day/week/month, karigar payments; then the biggest
 * day/week/month, which the page works out (`summary.biggest`) but leaves unshown.
 */
@Composable
private fun Figures(s: ExpenseSummary, grouping: ExpenseGrouping, category: String) {
    val per = grouping.title.lowercase()
    var open by rememberSaveable { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        FigureRow(spacing = 10.dp) {
            FigureTile("Total expenses", Money.pkr(s.total), Modifier.share(), tint = ErpColors.accent, number = s.total)
            FigureTile("Payments", "${s.count}", Modifier.share(), detail = category.ifEmpty { null })
        }
        SegmentedColumn {
            Row(
                Modifier.fillMaxWidth().clickable(role = Role.Button) { open = !open }.semantics { stateDescription = if (open) "Expanded" else "Collapsed" }.ledgerRow(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Spending breakdown", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                Icon(Icons.Filled.ExpandMore, contentDescription = null, Modifier.rotate(if (open) 0f else -90f), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (open) {
                Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    TwoLine("Average per $per", trailing = Money.pkr(s.perBucket))
                    TwoLine("Karigar payments", subtitle = "${s.karigarShare}% of total", trailing = Money.pkr(s.karigarTotal))
                    TwoLine("Biggest $per", subtitle = s.biggestLabel, trailing = Money.pkr(s.biggestTotal))
                }
            }
        }
    }
}
