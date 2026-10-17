package erp.app.screens.invoices

import erp.app.ui.appearOnce
import erp.app.ui.pressScale
import erp.app.ui.AppClock
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridItemSpanScope
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Message
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.data.Connection
import erp.app.data.LocalBook
import erp.app.data.rememberShelf
import erp.app.data.rememberShelfStatus
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.ui.CardColumns
import erp.app.ui.ChipRow
import erp.app.ui.FigureRow
import erp.app.ui.FigureTile
import erp.app.ui.FilterChip
import erp.app.ui.LedgerDivider
import erp.app.ui.LedgerHeading
import erp.app.ui.LocalNoteState
import erp.app.ui.MineTag
import erp.app.ui.Monogram
import erp.app.ui.MonogramSize
import erp.app.ui.Note
import erp.app.ui.NotAvailableState
import erp.app.ui.NumericText
import erp.app.ui.Pill
import erp.app.ui.Radius
import erp.app.ui.RowAmount
import erp.app.ui.ShelfState
import erp.app.ui.RowAction
import erp.app.ui.SwipeActions
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.isLargeText
import erp.app.ui.ledgerCard
import erp.app.ui.mineRow
import erp.app.ui.readableColumn
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.ErpType
import erp.app.ui.theme.TabularDigits
import erp.app.ui.zoomSource
import erp.core.ERPDate
import erp.core.logic.BalanceState
import erp.core.logic.balanceLine
import erp.core.logic.isOwing
import erp.core.models.Invoice
import erp.core.models.InvoiceStatus
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

// The whole row, whatever the columns (an Int.MAX_VALUE span laid nothing out in the grid).
private val FULL_WIDTH: LazyGridItemSpanScope.() -> GridItemSpan = { GridItemSpan(maxLineSpan) }
private val SECTION_GAP = 24.dp

/**
 * Every invoice, and what is still owed on it (src/app/invoices/page.tsx), as the ledger: the chips and the three
 * figures scroll with the list; a day's heading says what it billed and what is still owed on it; a row leads with
 * who, says what was sold, and carries one pill. On a tablet it is the iPad's grid of cards, each with its actions.
 */
@Composable
fun InvoicesList() {
    val book = LocalBook.current
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val status = rememberShelfStatus(book.invoices)
    val customers by rememberShelf(book.customers)
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()
    val note = LocalNoteState.current
    val byCustomer = session.shop.invoiceByCustomer
    val canPay = InvoiceFacts.mayTakePayments(session.role)

    var search by rememberSaveable { mutableStateOf("") }
    var chip by rememberSaveable { mutableStateOf(InvoiceChip.all) }
    var grouping by rememberSaveable { mutableStateOf(InvoiceGrouping.day) }
    var takenBy by rememberSaveable { mutableStateOf("") }
    var month by rememberSaveable { mutableStateOf("") }
    var rangeFrom by rememberSaveable { mutableStateOf<String?>(null) }
    var rangeTo by rememberSaveable { mutableStateOf<String?>(null) }
    var filtering by remember { mutableStateOf(false) }
    var pickingRange by remember { mutableStateOf(false) }
    var paying by remember { mutableStateOf<Invoice?>(null) }
    var sending by remember { mutableStateOf<Invoice?>(null) }
    var pdf by remember { mutableStateOf<InvoicePdfTarget?>(null) }

    val filter = InvoiceFilter(search, takenBy, month, rangeFrom, rangeTo)
    val now = remember(status.revision) { AppClock.now() }
    val all = status.items
    val scoped = remember(all, filter, customers) {
        InvoicesListRules.scope(all, filter, phones = {
            customers.mapNotNull { c -> c.phone?.takeIf { it.isNotEmpty() }?.let { c.id to it } }.toMap()
        }, now)
    }
    val shown = remember(scoped, chip) { scoped.filter { chip.matches(it) } }
    val groups = remember(shown, grouping, now) { InvoicesListRules.sections(shown, grouping, now) }
    // The figures hold still while the list below them is searched: the whole book's, or the chosen person's.
    val summary = remember(all, takenBy, now) {
        InvoiceSummary.of(if (takenBy.isEmpty()) all else all.filter { it.takenBy == takenBy }, now)
    }
    val filterOn = InvoicesListRules.filterActive(filter, chip)
    val anyFilter = takenBy.isNotEmpty() || month.isNotEmpty() || rangeFrom != null || chip != InvoiceChip.all

    fun clearFilters() {
        chip = InvoiceChip.all; takenBy = ""; month = ""; rangeFrom = null; rangeTo = null
    }

    fun mine(inv: Invoice): Boolean {
        val person = session.shop.person
        if (person.isNullOrEmpty()) return false
        return inv.takenBy == person
    }

    fun actions(inv: Invoice): List<RowAction> = buildList {
        if (canPay && isOwing(inv)) add(RowAction("Take payment", Icons.Filled.Payments, Tone.settled) { paying = inv })
        add(RowAction(if (inv.sentOnWhatsApp == null) "Send on WhatsApp" else "Send again on WhatsApp", Icons.AutoMirrored.Filled.Message, Tone.credit) { sending = inv })
        add(RowAction("Print / PDF", Icons.Filled.Print, Tone.quiet) { pdf = InvoiceFacts.pdfTarget(inv, byCustomer) })
    }

    ScreenTitle("Invoices")
    ScreenActions {
        IconButton(onClick = { filtering = true }) {
            Icon(
                Icons.Filled.FilterList,
                contentDescription = if (anyFilter) "Filter, on" else "Filter",
                tint = if (anyFilter) ErpColors.accent else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }

    Box(Modifier.fillMaxSize()) {
        ShelfState(loaded = status.loaded, error = status.error, offline = status.offline, connectionLost = connectionLost) {
            BoxWithConstraints(Modifier.fillMaxSize()) {
                val wide = maxWidth >= 760.dp && !isLargeText()
                val columns = if (wide) CardColumns.count(maxWidth - 48.dp) else 1
                LazyVerticalGrid(
                    columns = GridCells.Fixed(columns),
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = if (wide) 24.dp else 0.dp, end = if (wide) 24.dp else 0.dp, top = 4.dp, bottom = 96.dp),
                    verticalArrangement = Arrangement.spacedBy(if (wide) 20.dp else 0.dp),
                    horizontalArrangement = Arrangement.spacedBy(20.dp),
                ) {
                    head(
                        search = search, onSearch = { search = it },
                        scoped = scoped, chip = chip, onChip = { chip = it },
                        caption = if (filterOn) InvoicesListRules.caption(filter, chip) else null, onClear = ::clearFilters,
                        summary = summary, filter = filter, now = now,
                        onPick = { figure ->
                            val (f, c) = InvoicesListRules.pick(figure, filter, chip, AppClock.now())
                            month = f.month; rangeFrom = f.rangeFrom; rangeTo = f.rangeTo; chip = c
                        },
                    )
                    if (groups.isEmpty()) {
                        item(span = FULL_WIDTH) {
                            EmptyState(InvoicesListRules.filtering(filter, chip), onClear = { search = ""; clearFilters() }, onNewSale = { navigator.open("/invoices/new") })
                        }
                    }
                    for (group in groups) {
                        item(key = "h" + group.id, span = FULL_WIDTH) {
                            Box(Modifier.padding(horizontal = 20.dp).padding(top = if (wide) 4.dp else SECTION_GAP, bottom = 8.dp)) { SectionHeader(group) }
                        }
                        if (wide) {
                            items(group.rows.size, key = { "c${group.id}${group.rows[it].id}" }) { i ->
                                val inv = group.rows[i]
                                InvoiceCard(
                                    inv, mine = mine(inv), dated = grouping != InvoiceGrouping.day, canPay = canPay,
                                    actions = actions(inv), open = { navigator.open(InvoiceFacts.path(inv.id)) }, take = { paying = inv },
                                )
                            }
                        } else {
                            items(group.rows.size, key = { "r${group.id}${group.rows[it].id}" }, span = { FULL_WIDTH() }) { i ->
                                val inv = group.rows[i]
                                val first = i == 0
                                val last = i == group.rows.lastIndex
                                val shape = RoundedCornerShape(
                                    topStart = if (first) Radius.card else 0.dp, topEnd = if (first) Radius.card else 0.dp,
                                    bottomStart = if (last) Radius.card else 0.dp, bottomEnd = if (last) Radius.card else 0.dp,
                                )
                                Column(Modifier.appearOnce(if (group === groups.first()) i else Int.MAX_VALUE).padding(horizontal = 16.dp).readableColumn().clip(shape)) {
                                    SwipeActions(
                                        // The bill to the customer: the commonest thing after a sale, the same send as the invoice page's.
                                        start = RowAction("Send on WhatsApp", Icons.AutoMirrored.Filled.Message, Tone.credit) { sending = inv },
                                        end = if (canPay && isOwing(inv)) RowAction("Take payment", Icons.Filled.Payments, Tone.settled) { paying = inv } else null,
                                        menu = actions(inv),
                                        onClick = { navigator.open(InvoiceFacts.path(inv.id)) },
                                    ) {
                                        InvoiceListRow(inv, mine = mine(inv), dated = grouping != InvoiceGrouping.day, modifier = Modifier.zoomSource(InvoiceFacts.path(inv.id), Radius.tile))
                                    }
                                    if (!last) LedgerDivider()
                                }
                            }
                        }
                    }
                }
            }
        }
        InvoiceWhatsAppSend(
            invoice = sending,
            onStarted = { sending = null },
            openWeb = { inv, doing -> navigator.open(InvoiceFacts.path(inv.id, web = true, doing = doing)) },
            sent = { note.show(Note(it.title, it.detail)) },
        )
    }

    paying?.let { inv ->
        InvoicePaymentSheet(inv, onDismiss = { paying = null }, recorded = { paid, amount ->
            note.show(Note("Payment recorded", InvoiceFacts.recordedDetail(paid, amount)))
        })
    }
    pdf?.let { InvoicePdfDialog(it, onDismiss = { pdf = null }) }
    if (filtering) {
        InvoiceFilterSheet(
            all = all, scoped = scoped, filter = filter, chip = chip, grouping = grouping,
            onChip = { chip = it }, onGrouping = { grouping = it }, onTakenBy = { takenBy = it }, onMonth = { month = it },
            onPickRange = { filtering = false; pickingRange = true },
            onClearRange = { rangeFrom = null; rangeTo = null },
            onClear = ::clearFilters,
            onWeb = { filtering = false; navigator.open("/invoices?web=1") },
            onDismiss = { filtering = false },
        )
    }
    if (pickingRange) {
        InvoiceRangeSheet(rangeFrom, rangeTo, onDismiss = { pickingRange = false }) { from, to ->
            rangeFrom = from
            rangeTo = if (from == null) null else to
        }
    }
}

// MARK: The head of the list

/** The search box, the chips, the filter line and the figures: the list's first rows, so the title stays clear. */
@OptIn(ExperimentalLayoutApi::class)
private fun LazyGridScope.head(
    search: String,
    onSearch: (String) -> Unit,
    scoped: List<Invoice>,
    chip: InvoiceChip,
    onChip: (InvoiceChip) -> Unit,
    caption: String?,
    onClear: () -> Unit,
    summary: InvoiceSummary,
    filter: InvoiceFilter,
    now: Instant,
    onPick: (InvoiceSummary.Figure) -> Unit,
) {
    item(key = "search", span = FULL_WIDTH) {
        OutlinedTextField(
            value = search,
            onValueChange = onSearch,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).readableColumn(),
            placeholder = { Text("Search invoices") },
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
            trailingIcon = {
                if (search.isNotEmpty()) IconButton(onClick = { onSearch("") }) { Icon(Icons.Filled.Close, contentDescription = "Clear search") }
            },
            singleLine = true,
            shape = Radius.chipShape,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        )
    }
    item(key = "chips", span = FULL_WIDTH) {
        ChipRow {
            for (c in listOf(InvoiceChip.all, InvoiceChip.unpaid, InvoiceChip.paid)) {
                FilterChip(c.title, chosen = c == chip, onClick = { onChip(c) }, count = scoped.count { c.matches(it) })
            }
        }
    }
    if (caption != null) {
        item(key = "caption", span = FULL_WIDTH) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(caption, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = onClear) { Text("Clear", fontWeight = FontWeight.SemiBold) }
            }
        }
    }
    item(key = "summary", span = FULL_WIDTH) {
        Box(Modifier.padding(horizontal = 16.dp).readableColumn()) { SummaryStrip(summary, filter, chip, now, onPick) }
    }
}

/**
 * Owed to you in the serif (a tap shows the unpaid), then Today and This month: the whole book's, or the chosen
 * person's (Taken by), whatever else is filtered, so the figures hold still while the list below them is searched.
 * Always in view: a fold hid the one number the counter opens this page for.
 */
@Composable
private fun SummaryStrip(s: InvoiceSummary, filter: InvoiceFilter, chip: InvoiceChip, now: Instant, onPick: (InvoiceSummary.Figure) -> Unit) {
    fun chosen(f: InvoiceSummary.Figure) = InvoicesListRules.chosen(f, filter, chip, now)
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(
            Modifier
                .ledgerCard(padding = 0.dp)
                .chosenEdge(chosen(InvoiceSummary.Figure.owed))
                .clickable(role = Role.Button) { onPick(InvoiceSummary.Figure.owed) }
                .semantics { selected = chosen(InvoiceSummary.Figure.owed) }
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text("Owed to you", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            NumericText(
                erp.core.logic.Money.pkr(s.owed), s.owed,
                style = ErpType.heroNumber,
                color = if (s.owed >= 1) Tone.owed.color() else androidx.compose.ui.graphics.Color.Unspecified,
                autoSize = true,
            )
            Text("${s.owedCount} invoice${if (s.owedCount == 1) "" else "s"}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        FigureRow {
            FigureButton("Today", s.today, s.todayCount, chosen(InvoiceSummary.Figure.today)) { onPick(InvoiceSummary.Figure.today) }
            FigureButton("This month", s.month, s.monthCount, chosen(InvoiceSummary.Figure.month)) { onPick(InvoiceSummary.Figure.month) }
        }
    }
}

@Composable
private fun erp.app.ui.FigureScope.FigureButton(title: String, amount: Double, count: Int, chosen: Boolean, onClick: () -> Unit) {
    Box(
        // share(): each takes half the row (without it Today filled the row and This month had no width).
        Modifier
            .share()
            .chosenEdge(chosen)
            .clip(Radius.cardShape)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { selected = chosen },
    ) {
        FigureTile(title, erp.core.logic.Money.pkrLac(amount), detail = "$count invoice${if (count == 1) "" else "s"}", number = amount)
    }
}

/** The accent edge on the figure the list is showing. */
@Composable
private fun Modifier.chosenEdge(on: Boolean): Modifier =
    if (on) border(BorderStroke(1.5.dp, ErpColors.accent), Radius.cardShape) else this

@Composable
private fun EmptyState(filtering: Boolean, onClear: () -> Unit, onNewSale: () -> Unit) {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        if (filtering) {
            NotAvailableState("No matches", why = "Try adjusting your search or filter.", icon = Icons.Filled.Search)
            TextButton(onClick = onClear) { Text("Clear filters") }
        } else {
            NotAvailableState("No invoices yet", why = "A sale you make will be here, with what is still owed on it.", icon = Icons.Filled.Description)
            TextButton(onClick = onNewSale) { Text("New sale") }
        }
    }
}

/** A section's heading: its day, how many, what it billed; under it what is still owed on it. */
@Composable
private fun SectionHeader(section: InvoiceSection) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        LedgerHeading(section.title, count = section.rows.size, trailing = erp.core.logic.Money.pkr(section.billed))
        if (section.owed >= 1) {
            Text(
                if (section.hint.isEmpty()) "${erp.core.logic.Money.pkr(section.owed)} still owed" else "${section.hint} · ${erp.core.logic.Money.pkr(section.owed)} still owed",
                style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits),
                color = Tone.owed.color(),
            )
        } else if (section.hint.isNotEmpty()) {
            Text(section.hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

// MARK: Rows

/** Where an invoice's balance stands, the one badge a row carries: "Paid", "PKR 86,000 due" (red once it is old), "PKR 3,000 credit", "Refunded". */
@Composable
fun InvoiceBalancePill(invoice: Invoice, modifier: Modifier = Modifier) {
    val line = balanceLine(invoice.balanceDue)
    val tone = InvoiceFacts.balanceTone(invoice)
    if (invoice.status == InvoiceStatus.refunded) {
        Pill("Refunded", modifier, Tone.quiet)
    } else {
        when (line.state) {
            BalanceState.due -> Pill("${erp.core.logic.Money.pkr(line.amount)} due", modifier, tone)
            BalanceState.credit -> Pill("${erp.core.logic.Money.pkr(line.amount)} credit", modifier, Tone.credit)
            BalanceState.paid -> Pill("Paid", modifier, Tone.settled)
        }
    }
}

/** One invoice: who it was for, what was sold, its number and time; what it came to with where its balance stands under it. */
@Composable
private fun InvoiceListRow(invoice: Invoice, mine: Boolean, dated: Boolean, modifier: Modifier = Modifier) {
    val stacked = isLargeText()
    Row(
        modifier
            .fillMaxWidth()
            .mineRow(mine)
            .defaultMinSize(minHeight = 72.dp)
            .padding(16.dp)
            .semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        if (stacked) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                RowIdentity(invoice, mine, dated, Modifier)
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    RowAmount(invoice.grandTotal)
                    InvoiceBalancePill(invoice)
                }
            }
        } else {
            RowIdentity(invoice, mine, dated, Modifier.weight(1f))
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                RowAmount(invoice.grandTotal)
                InvoiceBalancePill(invoice)
            }
        }
    }
}

@Composable
private fun RowIdentity(invoice: Invoice, mine: Boolean, dated: Boolean, modifier: Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
        Monogram(invoice.customerName, size = MonogramSize.row)
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(InvoiceFacts.customerName(invoice), style = MaterialTheme.typography.titleMedium)
            InvoiceFacts.whatSold(invoice)?.takeIf { it.isNotEmpty() }?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Reference(invoice, mine, dated)
        }
    }
}

/**
 * "INV-000123 · 3:45 pm" under its day's heading, "INV-000123 · Tue 6 Oct" under a week's, with "You" and "Shopify"
 * beside it, or under it where the line is too narrow for all three.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Reference(invoice: Invoice, mine: Boolean, dated: Boolean) {
    val whenSaid = if (dated) erp.app.ui.ShopDate.say(invoice.createdAt) else InvoiceFacts.time(invoice.createdAt)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) {
        Text(
            listOf(invoice.id, whenSaid).filter { it.isNotEmpty() }.joinToString(" · "),
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1,
        )
        if (mine) MineTag()
        if (InvoiceFacts.isShopify(invoice)) Pill("Shopify")
    }
}

/** The iPad's card: the row, then Take payment and the actions menu in plain view (no swipe on a tablet). */
@Composable
private fun InvoiceCard(
    inv: Invoice,
    mine: Boolean,
    dated: Boolean,
    canPay: Boolean,
    actions: List<RowAction>,
    open: () -> Unit,
    take: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Column(
        Modifier
            .zoomSource(InvoiceFacts.path(inv.id))
            // The hairline is the card's own edge: on before the padding (after it, it drew a second card inside).
            .ledgerCard(padding = 0.dp)
            .border(BorderStroke(1.dp, ErpColors.accent.copy(alpha = if (mine) 0.22f else 0.08f)), Radius.cardShape)
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.pressScale().clickable(role = Role.Button, onClick = open)) {
            Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                RowIdentity(inv, mine, dated, Modifier.weight(1f))
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    RowAmount(inv.grandTotal)
                    InvoiceBalancePill(inv)
                }
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (canPay && isOwing(inv)) {
                TextButton(onClick = take, Modifier.defaultMinSize(minHeight = 48.dp)) {
                    Icon(Icons.Filled.Payments, contentDescription = null)
                    Spacer(Modifier.size(8.dp))
                    Text("Take payment", fontWeight = FontWeight.Medium)
                }
            }
            Spacer(Modifier.weight(1f))
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreHoriz, contentDescription = "Actions for ${inv.id}") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    for (a in actions) DropdownMenuItem(text = { Text(a.label) }, leadingIcon = { Icon(a.icon, null) }, onClick = { menu = false; a.run() })
                }
            }
        }
    }
}

// MARK: The filter

/** Status, Group by, Taken by, Month, a date range, and a way back to the whole book. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun InvoiceFilterSheet(
    all: List<Invoice>,
    scoped: List<Invoice>,
    filter: InvoiceFilter,
    chip: InvoiceChip,
    grouping: InvoiceGrouping,
    onChip: (InvoiceChip) -> Unit,
    onGrouping: (InvoiceGrouping) -> Unit,
    onTakenBy: (String) -> Unit,
    onMonth: (String) -> Unit,
    onPickRange: () -> Unit,
    onClearRange: () -> Unit,
    onClear: () -> Unit,
    onWeb: () -> Unit,
    onDismiss: () -> Unit,
) {
    val people = remember(all) { all.mapNotNull { it.takenBy }.filter { it.isNotEmpty() }.toSortedSet().toList() }
    val months = remember(all) { all.mapNotNull { InvoiceCalendar.monthKey(it.createdAt) }.toSortedSet().toList().reversed() }
    val narrowed = filter.takenBy.isNotEmpty() || filter.month.isNotEmpty() || filter.rangeFrom != null || chip != InvoiceChip.all
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = MaterialTheme.colorScheme.surface) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Filter", style = MaterialTheme.typography.titleMedium)
            val group: @Composable (String, @Composable () -> Unit) -> Unit = { title, chips ->
                Text(title, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { chips() }
            }
            group("Status") { for (c in InvoicesListRules.visibleChips(scoped.ifEmpty { all }, chip)) FilterChip(c.title, chosen = c == chip, onClick = { onChip(c) }) }
            group("Group by") { for (g in InvoiceGrouping.values()) FilterChip(g.title, chosen = g == grouping, onClick = { onGrouping(g) }) }
            group("Taken by") {
                FilterChip("Anyone", chosen = filter.takenBy.isEmpty(), onClick = { onTakenBy("") })
                for (p in people) FilterChip(p, chosen = filter.takenBy == p, onClick = { onTakenBy(p) })
            }
            group("Month") {
                FilterChip("All time", chosen = filter.month.isEmpty(), onClick = { onMonth("") })
                for (m in months) FilterChip(InvoiceCalendar.monthLabel(m), chosen = filter.month == m, onClick = { onMonth(m) })
            }
            // Any span of days, on top of a month (the web's date range picker).
            TextButton(onClick = onPickRange) {
                Icon(Icons.Filled.CalendarMonth, contentDescription = null)
                Spacer(Modifier.size(8.dp))
                Text(filter.rangeFrom?.let { InvoiceCalendar.caption(it, filter.rangeTo) } ?: "Date range")
            }
            if (filter.rangeFrom != null) TextButton(onClick = onClearRange) { Icon(Icons.Filled.Close, null); Spacer(Modifier.size(8.dp)); Text("Clear the date range") }
            if (narrowed) TextButton(onClick = onClear) { Icon(Icons.Filled.Close, null); Spacer(Modifier.size(8.dp)); Text("Clear filters") }
            HorizontalDivider()
            // Import Shopify CSV and the payment links are the ERP's own page.
            TextButton(onClick = onWeb) { Icon(Icons.Filled.Language, null); Spacer(Modifier.size(8.dp)); Text("Open in the ERP") }
        }
    }
}

/**
 * Pick the days to look at: from a first day to a last, or from a first day up to today. Cleared from the filter
 * sheet (the web uses a popover calendar).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InvoiceRangeSheet(from: String?, to: String?, onDismiss: () -> Unit, apply: (String?, String?) -> Unit) {
    var start by remember { mutableStateOf(InvoiceCalendar.picked(from) ?: LocalDate.now(ERPDate.karachi)) }
    var until by remember { mutableStateOf(InvoiceCalendar.picked(to) ?: start) }
    var hasEnd by remember { mutableStateOf(to != null) }
    var editing by remember { mutableStateOf<Int?>(null) } // 0 = from, 1 = to
    val scope = rememberCoroutineScope()
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = MaterialTheme.colorScheme.surface) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Date range", style = MaterialTheme.typography.titleMedium)
            DayRow("From", start) { editing = 0 }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Up to a last day", Modifier.weight(1f))
                Switch(checked = hasEnd, onCheckedChange = { hasEnd = it })
            }
            if (hasEnd) DayRow("To", until) { editing = 1 }
            Text(
                if (hasEnd) "Both days are included." else "Everything from that day up to today.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Button(
                onClick = {
                    val s = InvoiceCalendar.day(start)
                    // A last day set before the first reads as that one day.
                    val e = if (hasEnd) maxOf(s, InvoiceCalendar.day(until)) else null
                    apply(s, e)
                    onDismiss()
                },
                modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp),
            ) { Text("Apply") }
        }
    }
    editing?.let { which ->
        val initial = (if (which == 0) start else until).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
        val picker = rememberDatePickerState(initialSelectedDateMillis = initial)
        DatePickerDialog(
            onDismissRequest = { editing = null },
            confirmButton = {
                TextButton(onClick = {
                    picker.selectedDateMillis?.let { ms ->
                        // The picker's own calendar day, whatever time of day it holds.
                        val d = Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate()
                        if (which == 0) start = d else until = d
                    }
                    editing = null
                }) { Text("OK") }
            },
            dismissButton = { TextButton(onClick = { editing = null }) { Text("Cancel") } },
        ) { DatePicker(picker) }
    }
}

@Composable
private fun DayRow(label: String, day: LocalDate, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp).clickable(role = Role.Button, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, Modifier.weight(1f))
        Text(InvoiceCalendar.caption(InvoiceCalendar.day(day), null).removePrefix("From "), color = ErpColors.accent, fontWeight = FontWeight.Medium)
    }
}
