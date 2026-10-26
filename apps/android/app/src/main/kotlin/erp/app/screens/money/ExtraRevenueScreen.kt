package erp.app.screens.money

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.TrendingUp
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
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
import erp.app.data.rememberShelfStatus
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.ui.FigureRow
import erp.app.ui.FigureTile
import erp.app.ui.LedgerHeading
import erp.app.ui.NotAvailableState
import erp.app.ui.Note
import erp.app.ui.Radius
import erp.app.ui.ShelfState
import erp.app.ui.ShopDate
import erp.app.ui.Tone
import erp.app.ui.TwoLine
import erp.app.ui.ledgerRow
import erp.app.ui.readableColumn
import erp.app.ui.theme.ErpColors
import erp.core.logic.Money
import erp.core.models.AdditionalRevenue
import java.time.Instant

/**
 * Money → Extra revenue (src/app/additional-revenue/page.tsx): income not tied to an order or invoice, month by month
 * with each month's total. Adding, editing and deleting are native (the page's form; a swipe or a long press on a row),
 * and Delete asks for the delete code, which the ERP checks with the delete itself. Money taken on a repair ticket opens
 * that ticket instead, as the web's "Change this on the repair" does: it changes there, and goes when the ticket is
 * deleted. Owners only.
 */
@Composable
fun ExtraRevenueScreen() {
    if (!LocalSession.current.isOwner) {
        MoneyOwnersOnly("Extra revenue")
        return
    }
    RevenueBoard()
}

@Composable
private fun RevenueBoard() {
    val book = LocalBook.current
    val navigator = LocalNavigator.current
    val revenue = rememberShelfStatus(book.revenue)
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()
    val note = LocalNoteState.current

    var search by rememberSaveable { mutableStateOf("") }
    // The date filter, none until a start date is chosen (additional-revenue/page.tsx `dateRange`).
    var dates by remember { mutableStateOf(MoneyCustomRange()) }
    var adding by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<AdditionalRevenue?>(null) }
    var deletion by remember { mutableStateOf<OwnerDeletion?>(null) }

    ScreenTitle("Extra revenue")
    ScreenActions { IconButton(onClick = { adding = true }) { Icon(Icons.Filled.Add, contentDescription = "Add extra revenue") } }

    Box(Modifier.fillMaxSize()) {
        ShelfState(loaded = revenue.loaded, error = revenue.error, offline = revenue.offline, connectionLost = connectionLost) {
            val now = remember(revenue.revision, dates) { Instant.now() }
            val shown = remember(revenue.revision, search, dates) { revenueLines(revenue.items, search, dates, now) }
            val months = remember(shown, now) { MoneyMonths.group(shown, now) { it.amount } }
            val total = remember(shown) { shown.fold(0.0) { acc, l -> acc + l.item.amount } }

            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 4.dp, bottom = 96.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item(key = "search") {
                    Box(Modifier.padding(horizontal = 16.dp).readableColumn()) { MoneySearchField(search, { search = it }, "Search by description") }
                }
                item(key = "dates") {
                    Column(Modifier.padding(horizontal = 16.dp).readableColumn(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        LedgerHeading("Dates", Modifier.padding(horizontal = 4.dp))
                        Column(Modifier.fillMaxWidth().clip(Radius.cardShape).background(ErpColors.card)) { MoneyRangeFields(dates, { dates = it }) }
                        Footnote(if (dates.useFrom) "Without an end date it runs to the end of today." else "Until a start date is chosen, every entry is shown.")
                    }
                }
                item(key = "figures") {
                    Column(Modifier.padding(horizontal = 16.dp).readableColumn(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Footnote("Income not tied to an order or invoice.")
                        FigureRow(spacing = 10.dp) {
                            FigureTile("Total revenue", Money.pkr(total), Modifier.share(), tint = ErpColors.accent, number = total)
                            FigureTile("Entries", "${shown.size}", Modifier.share())
                        }
                    }
                }
                if (months.isEmpty()) {
                    item(key = "empty") {
                        NotAvailableState(
                            "No revenue entries found",
                            why = if (search.isEmpty() && !dates.useFrom) "Add a revenue entry to begin." else "Try adjusting your search or filters.",
                            icon = Icons.Filled.TrendingUp,
                        )
                    }
                }
                for (month in months) {
                    item(key = "h" + month.key) {
                        val n = month.rows.size
                        val count = "$n entr${if (n == 1) "y" else "ies"}"
                        Column(Modifier.padding(horizontal = 20.dp).padding(top = 8.dp).readableColumn(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            LedgerHeading(month.title, trailing = Money.pkr(month.total))
                            Text(
                                if (month.hint.isEmpty()) count else "${month.hint} · $count",
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    cardRows("r" + month.key, month.rows, { it.id }) { line ->
                        val r = line.item
                        val whenSaid = ShopDate.say(r.date)
                        val repairId = r.repairId
                        if (!repairId.isNullOrEmpty()) {
                            // A repair's money is changed on the repair, never deleted as a loose row.
                            Box(Modifier.fillMaxWidth().clickable(role = Role.Button) { navigator.open(MoneyPaths.repair(repairId)) }.ledgerRow()) {
                                TwoLine(
                                    title = r.description,
                                    subtitle = if (whenSaid.isEmpty()) "Change this on the repair" else "$whenSaid · Change this on the repair",
                                    trailing = Money.pkr(r.amount),
                                )
                            }
                        } else {
                            val edit = RowAction("Edit", Icons.Filled.Edit, Tone.house) { editing = r }
                            val delete = RowAction("Delete", Icons.Filled.Delete, Tone.problem) { deletion = askDelete(r) }
                            SwipeActions(start = edit, end = delete, menu = listOf(edit, delete)) {
                                Box(Modifier.background(ErpColors.card).fillMaxWidth().ledgerRow()) {
                                    TwoLine(title = r.description, subtitle = whenSaid, trailing = Money.pkr(r.amount))
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (adding) RevenueEditSheet(null, onDismiss = { adding = false }, onSaved = { note.show(it) })
    editing?.let { r -> RevenueEditSheet(r, onDismiss = { editing = null }, onSaved = { note.show(it) }) }
    deletion?.let { d ->
        OwnerDeleteCodeSheet(d, onDismiss = { deletion = null }, onDone = { note.show(Note("Deleted", "Revenue entry deleted.")) })
    }
}

/**
 * The dates, then the search over descriptions. The web's range ends at midnight of the last day it names (`end:
 * dateRange.to ?? new Date()`), which drops that day's later entries (a repair's money, taken at its own time); here
 * the last day counts to its end, as on Expenses.
 */
internal fun revenueLines(all: List<AdditionalRevenue>, search: String, dates: MoneyCustomRange, now: Instant = Instant.now()): List<MoneyLine<AdditionalRevenue>> {
    val needle = search.trim()
    val range = dates.range(now)
    val out = ArrayList<MoneyLine<AdditionalRevenue>>()
    for (r in all) {
        val day = MoneyMonths.day(r.date)
        if (!range.contains(day)) continue
        if (needle.isNotEmpty() && !moneyContains(r.description, needle)) continue
        out.add(MoneyLine(r, day, r.id))
    }
    return out
}

/** The web's "Delete revenue entry?" and the code, in one sheet; the ERP checks the code with the delete (`deleteExtraRevenue`), in the store's own words for it. */
internal fun askDelete(r: AdditionalRevenue): OwnerDeletion {
    val id = r.id
    return OwnerDeletion(
        what = "Delete this extra revenue",
        detail = "This will permanently delete “${r.description}” (${Money.pkr(r.amount)}).",
        run = { code -> ErpApi.shared.write("deleteExtraRevenue", mapOf("revenueId" to id, "deleteCode" to code)) },
    )
}
