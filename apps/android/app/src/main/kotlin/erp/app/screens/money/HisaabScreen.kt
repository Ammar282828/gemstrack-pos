package erp.app.screens.money

import erp.app.ui.animatedItem
import erp.app.ui.Radius
import erp.app.ui.zoomSource
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoStories
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.IosShare
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Work
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.data.Connection
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.rememberShelfStatus
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.ui.ChipRow
import erp.app.ui.FigureRow
import erp.app.ui.FigureTile
import erp.app.ui.FilterChip
import erp.app.ui.LedgerDivider
import erp.app.ui.NotAvailableState
import erp.app.ui.RowAmount
import erp.app.ui.ShelfState
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.readableColumn
import erp.app.ui.theme.ErpColors
import erp.core.logic.Money
import erp.core.logic.owedToYou

/**
 * Money → Hisaab (src/app/hisaab/page.tsx): customers' and karigars' outstanding accounts, what the shop will get and
 * what it will give. Every figure is debit less credit over a person's rows, as the web works it. Opening a person
 * shows their ledger, where entries are written and deleted (HisaabLedgerScreen); Add entry here chooses the account
 * first (HisaabAccountPicker). The summary PDF is the ERP's page. Owners only: the hisaab is theirs.
 */
@Composable
fun HisaabScreen() {
    if (!LocalSession.current.isOwner) {
        MoneyOwnersOnly("Hisaab")
        return
    }
    HisaabBoard()
}

@Composable
private fun HisaabBoard() {
    val book = LocalBook.current
    val navigator = LocalNavigator.current
    val hisaab = rememberShelfStatus(book.hisaab)
    val invoices = rememberShelfStatus(book.invoices)
    val customers = rememberShelfStatus(book.customers)
    val karigars = rememberShelfStatus(book.karigars)
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()
    val ready = hisaab.loaded && invoices.loaded && customers.loaded && karigars.loaded

    var search by rememberSaveable { mutableStateOf("") }
    var chip by rememberSaveable { mutableStateOf(HisaabChip.all) }
    var kind by rememberSaveable { mutableStateOf(HisaabKind.everyone) }
    var order by rememberSaveable { mutableStateOf(HisaabOrder.byName) }
    var picking by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }

    // The Hisaab page re-checks the books' outstanding balances on every visit (syncHisaabOutstandingBalances);
    // once per opening of this list is the same. The screen never waits for it, and the shelves show what it
    // changed by themselves. Offline, or in the demo, it just does not happen.
    LaunchedEffect(Unit) { runCatching { ErpApi.shared.write("syncHisaab", emptyMap()) } }

    ScreenTitle("Hisaab")
    val filtering = kind != HisaabKind.everyone || order != HisaabOrder.byName
    ScreenActions {
        Box {
            IconButton(onClick = { menu = true }) {
                Icon(
                    Icons.Filled.FilterList,
                    contentDescription = if (filtering) "Filter, on" else "Filter",
                    tint = if (filtering) ErpColors.accent else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                MenuHeading("Order")
                for (o in HisaabOrder.values()) ChoiceItem(o.title, o == order) { order = o; menu = false }
                HorizontalDivider()
                MenuHeading("Show")
                for (k in HisaabKind.values()) ChoiceItem(k.title, k == kind) { kind = k; menu = false }
            }
        }
        IconButton(onClick = { picking = true }) { Icon(Icons.Filled.Add, contentDescription = "Add entry") }
    }

    Box(Modifier.fillMaxSize()) {
        ShelfState(loaded = ready, error = hisaab.error, offline = hisaab.offline, connectionLost = connectionLost) {
            val customerIds = remember(customers.revision) { customers.items.mapTo(HashSet()) { it.id } }
            val summary = remember(hisaab.revision, invoices.revision, customerIds) {
                HisaabBook.summary(hisaab.items, invoices.items, customerIds)
            }
            val onInvoices = remember(invoices.revision) { owedToYou(invoices.items).total }
            val scoped = remember(summary, kind, search) { HisaabBook.scope(summary.accounts, kind, search) }
            val shown = remember(scoped, chip, order) { HisaabBook.ordered(scoped.filter { chip.matches(it) }, order) }
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(top = 4.dp, bottom = 96.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                animatedItem(key = "search") {
                    Box(Modifier.padding(horizontal = 16.dp).readableColumn()) {
                        MoneySearchField(search, { search = it }, "Search by name")
                    }
                }
                animatedItem(key = "chips") {
                    ChipRow {
                        for (c in HisaabChip.values()) FilterChip(c.title, chosen = c == chip, onClick = { chip = c }, count = scoped.count { c.matches(it) })
                    }
                }
                animatedItem(key = "head") {
                    Column(Modifier.padding(horizontal = 16.dp).readableColumn(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Footnote("Outstanding accounts for customers and karigars.")
                        Tiles(summary, onInvoices)
                        Footnote("On invoices counts walk-in sales too. The dashboard’s “Owed to you” adds the hand-written balances here.")
                    }
                }
                if (shown.isEmpty()) {
                    animatedItem(key = "empty") { EmptyState(search.isNotEmpty()) }
                } else {
                    cardRows("a", shown, { it.id }) { a -> AccountRows(a, onOpen = navigator::open) }
                }
                animatedItem(key = "export") {
                    Column(Modifier.padding(horizontal = 16.dp).readableColumn(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Column(Modifier.fillMaxWidth().clip(erp.app.ui.Radius.cardShape).background(ErpColors.card)) {
                            Row(
                                Modifier.fillMaxWidth().clickable(role = Role.Button) { navigator.open(MoneyPaths.hisaabWeb) }.ledgerRow(),
                                horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(Icons.Filled.IosShare, contentDescription = null, tint = ErpColors.accent)
                                Text("Export the summary report", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                            }
                        }
                        Footnote("The summary PDF is made on the ERP’s own page. To add an entry, tap + and choose the account.")
                    }
                }
            }
        }
    }

    if (picking) {
        HisaabAccountPicker(onDismiss = { picking = false }, go = { path -> navigator.open(path) })
    }
}

@Composable
private fun EmptyState(searching: Boolean) {
    NotAvailableState(
        if (searching) "No accounts found" else "All settled",
        why = if (searching) "No accounts match your search." else "All accounts are settled. No outstanding balances found.",
        icon = Icons.Filled.AutoStories,
    )
}

// MARK: Figures

/** You will get beside You will give, the metal and the invoices under them. */
@Composable
private fun Tiles(s: HisaabSummary, onInvoices: Double) {
    val getLines = buildList {
        if (s.receivableGold > 0) add("${MoneyFormat.grams(s.receivableGold)} ${MoneyWords.metal}")
        add("On invoices: ${Money.pkr(onInvoices)}")
    }
    val giveLines = buildList { if (s.payableGold > 0) add("${MoneyFormat.grams(s.payableGold)} ${MoneyWords.metal}") }
    FigureRow(spacing = 10.dp) {
        FigureTile("You will get", Money.pkr(s.receivable), Modifier.share(), detail = getLines.joinToString("\n"), tint = Tone.owed.color(), number = s.receivable)
        FigureTile(
            "You will give", Money.pkr(s.payable), Modifier.share(),
            detail = giveLines.takeIf { it.isNotEmpty() }?.joinToString("\n"), tint = Tone.credit.color(), number = s.payable,
        )
    }
}

// MARK: Rows

@Composable
private fun AccountRows(a: HisaabAccount, onOpen: (String) -> Unit) {
    if (a.isWalkIn) {
        // Walk-ins have no account page; each of their invoices is the way in.
        AccountRow(a, listInvoices = false, modifier = Modifier)
        for (inv in a.unpaid) {
            LedgerDivider()
            Box(Modifier.fillMaxWidth().clickable(role = Role.Button) { onOpen(MoneyPaths.invoice(inv.id)) }.padding(horizontal = 16.dp, vertical = 10.dp)) {
                UnpaidLine(inv)
            }
        }
    } else {
        AccountRow(a, listInvoices = true, modifier = Modifier.zoomSource(MoneyPaths.ledger(a.id, a.isCustomer), Radius.tile).clickable(role = Role.Button) { onOpen(MoneyPaths.ledger(a.id, a.isCustomer)) })
    }
}

/**
 * A person (or the walk-in line) with what they owe or are owed, the metal beside the cash, and the invoices still
 * owing (the web's card).
 */
@Composable
private fun AccountRow(account: HisaabAccount, listInvoices: Boolean, modifier: Modifier) {
    val tint = if (account.cash > 0) Tone.owed.color() else Tone.credit.color()
    Row(
        modifier.fillMaxWidth().ledgerRow().semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(Modifier.size(36.dp).clip(CircleShape).background(ErpColors.accent.copy(alpha = 0.14f)), contentAlignment = Alignment.Center) {
            Icon(if (account.isCustomer) Icons.Filled.Person else Icons.Filled.Work, contentDescription = null, tint = ErpColors.accent)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
                Text(account.name, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium))
                if (account.hasCash) RowAmount(kotlin.math.abs(account.cash), tone = tint)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    if (account.isWalkIn) "Sales with no customer named" else if (account.isCustomer) "Customer" else "Karigar",
                    Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (account.hasCash) {
                    Text(if (account.cash > 0) "to receive" else "to pay", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (account.gold != 0.0) {
                val word = if (account.gold > 0) "to receive" else "to pay"
                Text(
                    "${MoneyFormat.grams(kotlin.math.abs(account.gold))} ${MoneyWords.metal} $word",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (listInvoices && account.unpaid.isNotEmpty()) {
                // Every invoice still owing, as the web's card lists them.
                HorizontalDivider(Modifier.padding(vertical = 2.dp), thickness = 0.5.dp)
                for (inv in account.unpaid) UnpaidLine(inv)
            }
        }
    }
}

/** An invoice still owing: its number, what was paid of the total, and what is due. */
@Composable
private fun UnpaidLine(invoice: HisaabUnpaid) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
        Text(invoice.id, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace)
        Text(
            "${Money.pkr(invoice.amountPaid)} / ${Money.grouped(invoice.grandTotal)} · ${Money.pkr(invoice.balanceDue)} due",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
