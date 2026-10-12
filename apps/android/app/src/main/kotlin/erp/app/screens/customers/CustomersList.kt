package erp.app.screens.customers

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
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Message
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Sms
import androidx.compose.material.icons.filled.People
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.data.Connection
import erp.app.data.LocalBook
import erp.app.data.rememberShelfStatus
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.ui.RowAction
import erp.app.ui.SwipeActions
import erp.app.ui.ChipRow
import erp.app.ui.FilterChip
import erp.app.ui.HeroAmount
import erp.app.ui.LedgerDivider
import erp.app.ui.LedgerHeading
import erp.app.ui.Monogram
import erp.app.ui.MonogramSize
import erp.app.ui.NotAvailableState
import erp.app.ui.Radius
import erp.app.ui.ShelfState
import erp.app.ui.Tone
import erp.app.ui.TwoLine
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.app.ui.ledgerRow
import erp.app.ui.readableColumn
import erp.app.ui.theme.ErpColors
import erp.app.ui.zoomSource
import erp.core.logic.Money
import erp.core.logic.Owed
import erp.core.models.Customer

/** The web's "Everyone / Owing / Recent". */
enum class CustomersShowing(val title: String) { everyone("Everyone"), owing("Owing"), recent("Recent") }

/** What the list reckons from the books, once per change of them, not per keystroke in the search (which only narrows). */
private class Reckoned(val live: List<Customer>, val owed: Owed, val stats: Map<String, CustomerKit.Stats>, val lifetime: Double)

/**
 * Customers (src/app/customers/page.tsx): who owes, who bought lately, and everyone else. "Owed" is the ERP's one
 * figure (lib/owed.ts, decisions "One screen per question"): invoices with a balance, walk-ins and typed names in the
 * total but on their own lines, and, for an owner, the hisaab's hand-written balances. Staff have no hisaab (the ERP's
 * server sends them none), so for them it is invoices alone, as on their web page.
 */
@Composable
fun CustomersList() {
    val book = LocalBook.current
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val owner = session.isOwner
    val customers = rememberShelfStatus(book.customers)
    val invoices = rememberShelfStatus(book.invoices)
    val orders = rememberShelfStatus(book.orders)
    // The hisaab is an owner's: staff never ask for it.
    LaunchedEffect(owner) { if (owner) book.hisaab.need() }
    val hisaabItems by book.hisaab.items.collectAsStateWithLifecycle()
    val hisaabLoaded by book.hisaab.loaded.collectAsStateWithLifecycle()
    val hisaabError by book.hisaab.error.collectAsStateWithLifecycle()
    val hisaabRevision by book.hisaab.revision.collectAsStateWithLifecycle()
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()

    var search by rememberSaveable { mutableStateOf("") }
    var showing by rememberSaveable { mutableStateOf(CustomersShowing.everyone) }
    var merging by remember { mutableStateOf(false) }

    val loaded = customers.loaded && invoices.loaded && orders.loaded && (!owner || hisaabLoaded)
    val failure = customers.error ?: invoices.error ?: orders.error ?: (if (owner) hisaabError else null)
    val offline = customers.offline || invoices.offline

    val reckoned = remember(customers.revision, invoices.revision, orders.revision, hisaabRevision, owner) {
        val ledger = if (owner) hisaabItems else null
        val live = customers.items.filter { !CustomerKit.isRemoved(it) }
        val owed = CustomerKit.owed(invoices.items, customers.items, ledger)
        val stats = CustomerKit.stats(invoices.items, orders.items, owed)
        Reckoned(live, owed, stats, live.fold(0.0) { sum, c -> sum + (stats[c.id]?.spent ?: 0.0) })
    }
    val matched = remember(reckoned, search) { reckoned.live.filter { CustomerKit.matches(it, search) } }
    val groups = remember(matched, reckoned) { CustomerKit.groups(matched, reckoned.stats) }
    val shown = when (showing) {
        CustomersShowing.everyone -> groups
        CustomersShowing.owing -> CustomerKit.Groups(owing = groups.owing)
        CustomersShowing.recent -> CustomerKit.Groups(active = groups.active)
    }

    ScreenTitle("Customers")
    ScreenActions {
        IconButton(onClick = { navigator.open("/customers/add") }) { Icon(Icons.Filled.Add, contentDescription = "Add customer") }
    }

    ShelfState(loaded = loaded, error = failure, offline = offline, connectionLost = connectionLost) {
        LazyColumn(
            Modifier.fillMaxSize().readableColumn(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 96.dp),
        ) {
            item(key = "search") {
                OutlinedTextField(
                    value = search,
                    onValueChange = { search = it },
                    modifier = Modifier.fillMaxWidth().padding(bottom = GAP),
                    placeholder = { Text("Search by name, phone, or email") },
                    leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                    trailingIcon = {
                        if (search.isNotEmpty()) IconButton(onClick = { search = "" }) { Icon(Icons.Filled.Close, contentDescription = "Clear search") }
                    },
                    singleLine = true,
                    shape = Radius.chipShape,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                )
            }
            item(key = "summary") {
                CustSummary(
                    modifier = Modifier.padding(bottom = GAP),
                    customerCount = reckoned.live.size,
                    owed = reckoned.owed,
                    owingCount = groups.owing.size,
                    boughtRecently = groups.active.size + groups.owing.size,
                    lifetime = reckoned.lifetime,
                    showHisaab = owner,
                )
            }
            item(key = "chips") {
                ChipRow(Modifier.padding(bottom = GAP)) {
                    for (option in CustomersShowing.values()) FilterChip(option.title, chosen = option == showing, onClick = { showing = option })
                }
            }
            if (shown.owing.isEmpty() && shown.active.isEmpty() && shown.quiet.isEmpty()) {
                item(key = "empty") { Box(Modifier.padding(bottom = GAP)) { Empty(matched.size, search, showing) } }
            } else {
                group("Owing money", "most owed first", shown.owing, reckoned.stats) { navigator.open(CustomerKit.path(it)) }
                group("Recent", "bought in the last ${CustomerKit.dormantAfterMonths} months", shown.active, reckoned.stats) { navigator.open(CustomerKit.path(it)) }
                group("Quiet", "no sale in a year", shown.quiet, reckoned.stats) { navigator.open(CustomerKit.path(it)) }
            }
            // Clearing up the book is an owner's: the web's merge and removals are browser writes the shop floor cannot make.
            if (owner) {
                item(key = "clean") {
                    Column(Modifier.padding(top = GAP), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Column(Modifier.fillMaxWidth().clip(Radius.cardShape).background(ErpColors.card)) {
                            ActionLine("Merge duplicates", Icons.Filled.Group) { merging = true }
                            LedgerDivider()
                            // The spam finder (gibberish names and addresses with no number, history or address) stays the ERP's.
                            ActionLine("Clean up spam", Icons.Filled.Delete) { navigator.open("/customers?web=1") }
                        }
                        Text(
                            "Merging moves one customer's invoices, orders and hisaab to another, and asks for the delete code. Cleaning up spam opens on the ERP's own page.",
                            Modifier.padding(horizontal = 4.dp),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
    if (merging) CustomerMergeSheet(onDismiss = { merging = false })
}

@Composable
private fun ActionLine(text: String, icon: ImageVector, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).ledgerRow(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, contentDescription = null, tint = ErpColors.accent)
        Text(text, style = MaterialTheme.typography.bodyLarge, color = ErpColors.accent)
    }
}

private fun LazyListScope.group(
    title: String,
    hint: String,
    people: List<Customer>,
    stats: Map<String, CustomerKit.Stats>,
    open: (String) -> Unit,
) {
    if (people.isEmpty()) return
    item(key = "h-$title") {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(start = 4.dp, end = 4.dp, bottom = 8.dp)) {
            LedgerHeading(title, count = people.size)
            Text(hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    items(people.size, key = { "$title-${people[it].id}" }) { i ->
        val c = people[i]
        val first = i == 0
        val last = i == people.lastIndex
        val shape = RoundedCornerShape(
            topStart = if (first) Radius.card else 0.dp, topEnd = if (first) Radius.card else 0.dp,
            bottomStart = if (last) Radius.card else 0.dp, bottomEnd = if (last) Radius.card else 0.dp,
        )
        // The rows of a group are one card; the last leaves the gap to the next group.
        Column(Modifier.padding(bottom = if (last) GAP else 0.dp).clip(shape)) {
            CustomerRow(c, stats[c.id], onClick = { open(c.id) })
            if (!last) LedgerDivider()
        }
    }
}

private val GAP = 20.dp

/** One customer in the list: swipe for WhatsApp or Call, a long press for the three ways to reach them. */
@Composable
private fun CustomerRow(c: Customer, stats: CustomerKit.Stats?, onClick: () -> Unit) {
    val context = LocalContext.current
    val wa = CustomerKit.whatsAppUri(c.phone) != null
    val call = CustomerKit.callUri(c.phone) != null
    val menu = buildList {
        if (call) add(RowAction("Call", Icons.Filled.Call, Tone.house) { CustomerLinks.call(context, c.phone) })
        if (wa) add(RowAction("WhatsApp", Icons.AutoMirrored.Filled.Message, Tone.settled) { CustomerLinks.whatsApp(context, c.phone) })
        if (CustomerKit.messageUri(c.phone) != null) add(RowAction("Message", Icons.Filled.Sms, Tone.quiet) { CustomerLinks.message(context, c.phone) })
    }
    SwipeActions(
        start = menu.firstOrNull { it.label == "WhatsApp" },
        end = menu.firstOrNull { it.label == "Call" },
        menu = menu,
        onClick = onClick,
    ) {
        Box(Modifier.fillMaxWidth().background(ErpColors.card).zoomSource(CustomerKit.path(c.id))) {
            CustRowLabel(c, stats)
        }
    }
}

/** One customer in the list: name, number, what they owe (or, if nothing, what they have spent). */
@Composable
private fun CustRowLabel(customer: Customer, stats: CustomerKit.Stats?) {
    val subtitle = custSubtitle(customer, stats)
    val trailing = custTrailing(stats)
    val owes = (stats?.owed ?: 0.0) > 0
    // What is owed leads: it is the reason you look a customer up.
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
        Monogram(CustomerKit.shown(customer), size = MonogramSize.row)
        TwoLine(
            CustomerKit.shown(customer), Modifier.weight(1f),
            subtitle = subtitle.ifEmpty { null },
            trailing = trailing,
            trailingTint = if (owes) Tone.owed.color() else Color.Unspecified,
            trailingLabel = if (owes) "Owed" else "Lifetime sales",
        )
    }
}

internal fun custSubtitle(customer: Customer, stats: CustomerKit.Stats?): String {
    val lines = ArrayList<String>()
    CustomerKit.filled(customer.phone)?.let { lines += it }
    if (stats != null && stats.count > 0) {
        var sales = "${stats.count} sale${if (stats.count == 1) "" else "s"}"
        val last = CustomerKit.monthYear(stats.lastAt)
        if (last.isNotEmpty()) sales += " · last $last"
        lines += sales
    }
    return lines.joinToString("\n")
}

internal fun custTrailing(stats: CustomerKit.Stats?): String? {
    val s = stats ?: return null
    if (s.owed > 0) return Money.pkr(s.owed)
    if (s.spent > 0) return Money.pkrLac(s.spent)
    return null
}

internal fun custOwedDetail(owingCount: Int, owed: Owed, showHisaab: Boolean): String {
    val parts = arrayListOf("$owingCount customer${if (owingCount == 1) "" else "s"}")
    if (owed.walkIn > 0) parts += "walk-ins ${Money.pkr(owed.walkIn)}"
    if (owed.nameOnly > 0) parts += "typed names ${Money.pkr(owed.nameOnly)}"
    if (showHisaab && owed.ledger > 0) parts += "hisaab ${Money.pkr(owed.ledger)}"
    return parts.joinToString(" · ")
}

/** The four figures over the list: customers, owed to you, bought lately, lifetime sales. */
@Composable
private fun CustSummary(modifier: Modifier, customerCount: Int, owed: Owed, owingCount: Int, boughtRecently: Int, lifetime: Double, showHisaab: Boolean) {
    Column(modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Owed to you", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            HeroAmount(owed.total)
            Text(custOwedDetail(owingCount, owed, showHisaab), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Disclosure("Customer overview") {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(top = 4.dp)) {
                TwoLine("Customers", trailing = "$customerCount")
                TwoLine("Bought in ${CustomerKit.dormantAfterMonths} months", trailing = "$boughtRecently")
                TwoLine("Lifetime sales", trailing = Money.pkrLac(lifetime))
            }
        }
    }
}

@Composable
private fun Empty(matched: Int, search: String, showing: CustomersShowing) {
    when {
        matched == 0 && CustomerKit.trim(search).isNotEmpty() ->
            NotAvailableState("No results for “$search”", why = "Check the spelling or try a new search.", icon = Icons.Filled.Search)
        matched == 0 -> NotAvailableState("No customers found", why = "Add a customer to begin.", icon = Icons.Filled.People)
        showing == CustomersShowing.owing -> NotAvailableState("Nobody owes you", why = "Every customer is settled.", icon = Icons.Filled.CheckCircle)
        else -> NotAvailableState(
            "No recent buyers", why = "Nobody here has bought in the last ${CustomerKit.dormantAfterMonths} months.", icon = Icons.Filled.History,
        )
    }
}
