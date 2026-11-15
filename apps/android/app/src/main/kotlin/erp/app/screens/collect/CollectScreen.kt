package erp.app.screens.collect

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.data.Connection
import erp.app.data.LocalBook
import erp.app.data.rememberShelfStatus
import erp.app.nav.LocalFabClearance
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenTitle
import erp.app.screens.money.MoneyOwnersOnly
import erp.app.ui.AppClock
import erp.app.ui.ChipRow
import erp.app.ui.CustomerContactMenu
import erp.app.ui.FilterChip
import erp.app.ui.LedgerHeading
import erp.app.ui.Monogram
import erp.app.ui.MonogramSize
import erp.app.ui.NotAvailableState
import erp.app.ui.NumericText
import erp.app.ui.Pill
import erp.app.ui.SearchBarField
import erp.app.ui.SegmentedButton
import erp.app.ui.SegmentedButtonDefaults
import erp.app.ui.SegmentedColumn
import erp.app.ui.ShelfState
import erp.app.ui.SingleChoiceSegmentedButtonRow
import erp.app.ui.Tone
import erp.app.ui.icons.Symbols
import erp.app.ui.readableColumn
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import erp.core.ERPDate
import erp.core.logic.Collect
import erp.core.logic.CollectAge
import erp.core.logic.CollectFilters
import erp.core.logic.CollectGroup
import erp.core.logic.CollectKind
import erp.core.logic.CollectPaid
import erp.core.logic.CollectRow
import erp.core.logic.CollectSort
import erp.core.logic.Money
import erp.core.logic.StaffAccess
import java.time.format.DateTimeFormatter
import java.util.Locale

/** A set with one value added or taken away (page.tsx `toggle`). */
private fun <T> Set<T>.toggled(v: T): Set<T> = if (v in this) this - v else this + v

/** A group of rows under one heading: a person's, or the one list. */
private class CollectGroupRows(val key: String, val title: String, val rows: List<CollectRow>)

private val billDate: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH).withZone(ERPDate.karachi)

/**
 * To collect (src/app/collect/page.tsx, docs/decisions.md#to-collect): everyone who still owes the shop, one row per bill,
 * invoices with a balance and completed orders not yet invoiced (core's Collect, from lib/collect.ts), grouped under who took
 * them or one list sorted oldest / largest, narrowed to some of the people and by bill, age and paid, and searched. Owners
 * only: what customers owe is the books. Filters live only on the screen, as on the web.
 */
@Composable
fun CollectScreen() {
    val session = LocalSession.current
    if (!StaffAccess.seesMoney(session.role)) {
        MoneyOwnersOnly("To collect")
        return
    }
    CollectBoard()
}

@Composable
private fun CollectBoard() {
    val book = LocalBook.current
    val navigator = LocalNavigator.current
    val invoices = rememberShelfStatus(book.invoices)
    val orders = rememberShelfStatus(book.orders)
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()

    var sort by remember { mutableStateOf(CollectSort.takenBy) }
    var f by remember { mutableStateOf(CollectFilters.none) }
    // One clock for the screen, moved on when the books change, so ages and "days waiting" agree.
    val now = remember(invoices.revision, orders.revision) { AppClock.now() }

    val rows = remember(invoices.items, orders.items) { Collect.rows(invoices.items, orders.items) }
    // Every person with anything owing, in the order of what they are owed, so the chips never jump about as filters change.
    val people = remember(rows) { Collect.byTakenBy(rows) }
    val shown = remember(rows, f, sort, now) { Collect.sort(Collect.filter(rows, f, now), sort) }
    // What each chip would show, with the other filters on.
    val perPerson = remember(rows, f, now) { Collect.countBy(rows, f, CollectGroup.people, now) { it.takenBy } }
    val perKind = remember(rows, f, now) { Collect.countBy(rows, f, CollectGroup.kinds, now) { it.kind } }
    val perAge = remember(rows, f, now) { Collect.countBy(rows, f, CollectGroup.ages, now) { Collect.ageOf(it, now) } }
    val perPaid = remember(rows, f, now) { Collect.countBy(rows, f, CollectGroup.paid, now) { Collect.paidOf(it) } }
    val total = rows.sumOf { it.due }
    val shownTotal = shown.sumOf { it.due }
    val on = f.on

    // Grouped under each person's name when sorted by who took it; one list otherwise.
    val groups = remember(sort, shown, people, f) {
        if (sort != CollectSort.takenBy) {
            listOf(CollectGroupRows("all", Collect.listTitle(f), shown))
        } else {
            val m = LinkedHashMap<String, MutableList<CollectRow>>()
            for (r in shown) m.getOrPut(r.takenBy) { mutableListOf() }.add(r)
            people.filter { m.containsKey(it.takenBy) }.map { CollectGroupRows(it.takenBy.ifEmpty { "nobody" }, Collect.who(it.takenBy), m.getValue(it.takenBy)) }
        }
    }

    ScreenTitle("To collect")

    ShelfState(
        loaded = invoices.loaded && orders.loaded,
        error = invoices.error ?: orders.error,
        offline = invoices.offline || orders.offline,
        connectionLost = connectionLost,
        shape = erp.app.ui.SkeletonShape.Rows,
    ) {
        if (rows.isEmpty()) {
            NotAvailableState("Nobody owes anything", why = "Every invoice and completed order is paid.", icon = Symbols.Payments, modifier = Modifier.padding(top = 48.dp))
            return@ShelfState
        }
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(top = 4.dp, bottom = maxOf(24.dp, LocalFabClearance.current)),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            item(key = "head") {
                Column(Modifier.readableColumn().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        "${Money.pkrLac(total)} owed on ${rows.size} bill${if (rows.size == 1) "" else "s"}",
                        style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits),
                        color = ErpColors.quiet,
                    )
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        SingleChoiceSegmentedButtonRow(Modifier.weight(1f)) {
                            val options = listOf(CollectSort.takenBy to "Taken by", CollectSort.oldest to "Oldest", CollectSort.amount to "Largest")
                            options.forEachIndexed { i, (v, label) ->
                                SegmentedButton(selected = sort == v, onClick = { sort = v }, shape = SegmentedButtonDefaults.itemShape(i, options.size)) { Text(label) }
                            }
                        }
                    }
                    if (on > 0) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                "${shown.size} of ${rows.size} · ${Money.pkrLac(shownTotal)}",
                                Modifier.weight(1f),
                                style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits),
                                color = ErpColors.quiet,
                            )
                            Pill("Clear", Modifier.clickable(role = Role.Button) { f = CollectFilters.none })
                        }
                    }
                }
            }

            // The main filter: who took it. Several may be chosen; Everyone clears them.
            item(key = "people") {
                Column(Modifier.readableColumn(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    LedgerHeading("Taken by", Modifier.padding(horizontal = 16.dp))
                    ChipRow {
                        FilterChip("Everyone", chosen = f.people.isEmpty(), onClick = { f = f.copy(people = emptySet()) })
                        for (p in people) {
                            val c = perPerson[p.takenBy]
                            val chosen = p.takenBy in f.people
                            FilterChip(
                                "${Collect.who(p.takenBy)} · ${Money.lacCrore(c?.due ?: 0.0)}", chosen = chosen,
                                onClick = { f = f.copy(people = f.people.toggled(p.takenBy)) },
                                modifier = if (!chosen && c == null) Modifier.alpha(0.5f) else Modifier,
                                count = c?.count ?: 0,
                            )
                        }
                    }
                }
            }

            // Then narrow it: the bill, how long it has waited, whether anything was paid, a name.
            item(key = "narrow") {
                Column(Modifier.readableColumn(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    SearchBarField(
                        value = f.query, onValueChange = { f = f.copy(query = it) },
                        modifier = Modifier.padding(horizontal = 16.dp).fillMaxWidth(),
                        placeholder = { Text("Customer, number or bill") },
                        leadingIcon = { Icon(Symbols.Search, contentDescription = null) },
                        trailingIcon = if (f.query.isNotEmpty()) ({
                            androidx.compose.material3.IconButton(onClick = { f = f.copy(query = "") }) { Icon(Symbols.Clear, contentDescription = "Clear the search") }
                        }) else null,
                    )
                    ChipRow {
                        for (k in CollectKind.entries) FilterChip(Collect.kindWord(k), chosen = k in f.kinds, onClick = { f = f.copy(kinds = f.kinds.toggled(k)) }, count = perKind[k]?.count ?: 0)
                        Divider()
                        for (a in CollectAge.entries) FilterChip(Collect.ageWord(a), chosen = a in f.ages, onClick = { f = f.copy(ages = f.ages.toggled(a)) }, count = perAge[a]?.count ?: 0)
                        Divider()
                        for (p in CollectPaid.entries) FilterChip(Collect.paidWord(p), chosen = p in f.paid, onClick = { f = f.copy(paid = f.paid.toggled(p)) }, count = perPaid[p]?.count ?: 0)
                    }
                }
            }

            if (shown.isEmpty()) {
                item(key = "none") {
                    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                        NotAvailableState("Nothing matches", why = "No bill passes all of these filters.", icon = Symbols.Payments)
                        androidx.compose.material3.TextButton(onClick = { f = CollectFilters.none }) { Text("Clear filters") }
                    }
                }
            }

            for (g in groups) {
                item(key = "h${g.key}") {
                    Column(Modifier.readableColumn().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        LedgerHeading(g.title, count = g.rows.size, trailing = Money.lacCrore(g.rows.sumOf { it.due }))
                        SegmentedColumn {
                            for (r in g.rows) CollectRowView(r, now) { navigator.open(r.href) }
                        }
                    }
                }
            }
        }
    }
}

/** The thin line between the chip groups (page.tsx `Divider`). */
@Composable
private fun Divider() {
    Box(Modifier.width(1.dp).height(24.dp).background(MaterialTheme.colorScheme.outlineVariant))
}

/** One bill: who, which bill and when, how long it has waited and who took it; what is due, and the Contact control. */
@Composable
private fun CollectRowView(r: CollectRow, now: java.time.Instant, open: () -> Unit) {
    val at = ERPDate.parse(r.date)
    val days = Collect.daysWaiting(r, now)
    val line = buildString {
        append(if (r.kind == CollectKind.invoice) "Invoice" else "Order").append(' ').append(r.id)
        if (at != null) append(" · ").append(billDate.format(at))
        if (days > 0) append(" · $days day${if (days == 1) "" else "s"}")
        append(" · ").append(Collect.who(r.takenBy))
    }
    Row(
        Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 72.dp)
            .clickable(role = Role.Button, onClick = open)
            .padding(start = 16.dp, top = 12.dp, bottom = 12.dp, end = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Monogram(r.customerName, size = MonogramSize.row)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(r.customerName, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(line, style = MaterialTheme.typography.bodySmall, color = ErpColors.quiet, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            NumericText(
                Money.lacCrore(r.due), r.due,
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
            )
            Pill(if (r.due >= r.total) "Unpaid" else "of ${Money.lacCrore(r.total)}", tone = if (days > 30) Tone.late else Tone.owed)
        }
        CustomerContactMenu(r.phone, customerId = r.customerId, customerName = r.customerName)
    }
}
