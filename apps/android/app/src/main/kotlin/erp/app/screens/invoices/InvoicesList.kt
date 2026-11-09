package erp.app.screens.invoices

import erp.app.ui.animatedItem
import erp.app.nav.LocalFabClearance
import erp.app.ui.icons.Symbols
import erp.app.screens.offline.pendingRecords
import erp.app.ui.SearchBarField
import erp.app.ui.appearOnce
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
import erp.app.ui.Button
import erp.app.data.rememberOffMain
import erp.app.ui.QuickPrintButton
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import erp.app.ui.Switch
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import kotlinx.coroutines.delay
import androidx.compose.runtime.LaunchedEffect
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
import erp.core.logic.WhatsAppOrderChip
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
import erp.core.logic.invoiceSaleValue
import erp.core.logic.BalanceState
import erp.core.logic.balanceLine
import erp.core.logic.isOwing
import erp.core.models.Invoice
import erp.core.models.InvoiceStatus
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

// The whole row, whatever the columns (an Int.MAX_VALUE span laid nothing out in the grid).
internal val FULL_WIDTH: LazyGridItemSpanScope.() -> GridItemSpan = { GridItemSpan(maxLineSpan) }
internal val SECTION_GAP = 24.dp

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
    // Sales taken with no line, kept on this phone until the ERP has them: "Waiting to send" at the top.
    val pendingSales = erp.app.screens.offline.rememberPendingRecords(session.business, "invoice")
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
    val quick = erp.app.ui.rememberQuickPdf()

    // The list is worked out from the text 200 ms after the last keystroke (the box itself stays instant); clearing applies at once.
    var appliedSearch by remember { mutableStateOf(search) }
    LaunchedEffect(search) { if (search.isNotEmpty()) delay(200); appliedSearch = search }
    val filter = InvoiceFilter(appliedSearch, takenBy, month, rangeFrom, rangeTo)
    val now = remember(status.revision) { AppClock.now() }
    // House of Mina's Shopify orders have their own section (the nav map says so): they are not listed here, nor counted in its chips.
    val hasShopifySection = remember { erp.app.nav.NavMap.current.hasShopify }
    val all = remember(status.items, hasShopifySection) { erp.core.logic.ShopifyOrders.listedInvoices(status.items, hasShopifySection) }
    // The whole-book passes (search, chips, day sections) run off the main thread; the last answer stays up while the next is worked out.
    val scopedNow by rememberOffMain(all, filter, customers, now) {
        InvoicesListRules.scope(all, filter, phones = {
            customers.mapNotNull { c -> c.phone?.takeIf { it.isNotEmpty() }?.let { c.id to it } }.toMap()
        }, now)
    }
    val scoped = scopedNow
    val groupsNow by rememberOffMain(scoped, chip, grouping, now) {
        InvoicesListRules.sections(scoped.orEmpty().filter { chip.matches(it) }, grouping, now)
    }
    val groups = groupsNow ?: emptyList()
    val ready = scoped != null && groupsNow != null
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

    // One tap to the printer: the target is built in the tap; the one QuickPdf is the screen's.
    var printingId by remember { mutableStateOf<String?>(null) }
    fun print(inv: Invoice) {
        printingId = inv.id
        InvoiceFacts.pdfTarget(inv, byCustomer).let { quick.share(it.path, it.fileName, it.title) }
    }
    val printing: (Invoice) -> Boolean = { quick.preparing && printingId == it.id }

    fun actions(inv: Invoice): List<RowAction> = buildList {
        if (canPay && isOwing(inv)) add(RowAction("Take payment", Symbols.Payments, Tone.settled) { paying = inv })
        add(RowAction(if (inv.sentOnWhatsApp == null) "Send on WhatsApp" else "Send again on WhatsApp", Symbols.Message, Tone.credit) { sending = inv })
        // Straight to the share sheet (Print, WhatsApp, Files); View PDF opens it for looking.
        add(RowAction("Print or share PDF", Symbols.Print, Tone.quiet) { print(inv) })
        add(RowAction("View PDF", Symbols.PictureAsPdf, Tone.quiet) { pdf = InvoiceFacts.pdfTarget(inv, byCustomer) })
    }

    ScreenTitle("Invoices")
    ScreenActions {
        IconButton(onClick = { filtering = true }) {
            Icon(
                Symbols.FilterList,
                contentDescription = if (anyFilter) "Filter, on" else "Filter",
                tint = if (anyFilter) ErpColors.accent else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }

    Box(Modifier.fillMaxSize()) {
        ShelfState(shape = erp.app.ui.SkeletonShape.Rows, loaded = status.loaded && ready, error = status.error, offline = status.offline, connectionLost = connectionLost) {
            BoxWithConstraints(Modifier.fillMaxSize()) {
                val wide = maxWidth >= 760.dp && !isLargeText()
                val columns = if (wide) CardColumns.count(maxWidth - 48.dp) else 1
                LazyVerticalGrid(
                    columns = GridCells.Fixed(columns),
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = if (wide) 24.dp else 0.dp, end = if (wide) 24.dp else 0.dp, top = 4.dp, bottom = maxOf(24.dp, LocalFabClearance.current)),
                    verticalArrangement = Arrangement.spacedBy(if (wide) 20.dp else 0.dp),
                    horizontalArrangement = Arrangement.spacedBy(20.dp),
                ) {
                    head(
                        search = search, onSearch = { search = it },
                        scoped = scoped.orEmpty(), chip = chip, onChip = { chip = it },
                        caption = if (filterOn) InvoicesListRules.caption(filter, chip) else null, onClear = ::clearFilters,
                    )
                    pendingRecords(pendingSales)
                    if (groups.isEmpty() && pendingSales.isEmpty()) {
                        item(span = FULL_WIDTH) {
                            EmptyState(InvoicesListRules.filtering(filter, chip), onClear = { search = ""; clearFilters() }, onNewSale = { navigator.open("/invoices/new") })
                        }
                    }
                    for (group in groups) {
                        animatedItem(key = "h" + group.id, contentType = "header", span = FULL_WIDTH) {
                            Box(Modifier.padding(horizontal = 20.dp).padding(top = if (wide) 4.dp else SECTION_GAP, bottom = 8.dp)) { SectionHeader(group) }
                        }
                        if (wide) {
                            items(group.rows.size, key = { "c${group.id}${group.rows[it].id}" }, contentType = { "card" }) { i ->
                                val inv = group.rows[i]
                                Box(Modifier.animateItem()) { InvoiceCard(
                                    inv, mine = mine(inv), dated = grouping != InvoiceGrouping.day, canPay = canPay,
                                    actions = ::actions, open = { navigator.open(InvoiceFacts.path(inv.id)) }, take = { paying = inv },
                                    onPrint = ::print, printing = printing,
                                ) }
                            }
                        } else {
                            items(group.rows.size, key = { "r${group.id}${group.rows[it].id}" }, span = { FULL_WIDTH() }, contentType = { "row" }) { i ->
                                val inv = group.rows[i]
                                val first = i == 0
                                val last = i == group.rows.lastIndex
                                val shape = RoundedCornerShape(
                                    topStart = if (first) Radius.card else Radius.joint, topEnd = if (first) Radius.card else Radius.joint,
                                    bottomStart = if (last) Radius.card else Radius.joint, bottomEnd = if (last) Radius.card else Radius.joint,
                                )
                                Column(Modifier.animateItem().appearOnce(if (group === groups.first()) i else Int.MAX_VALUE).padding(horizontal = 16.dp).readableColumn().padding(bottom = if (last) 0.dp else 2.dp).clip(shape)) {
                                    SwipeActions(
                                        // The bill to the customer: the commonest thing after a sale, the same send as the invoice page's.
                                        start = RowAction("Send on WhatsApp", Symbols.Message, Tone.credit) { sending = inv },
                                        end = if (canPay && isOwing(inv)) RowAction("Take payment", Symbols.Payments, Tone.settled) { paying = inv } else null,
                                        menu = { actions(inv) },
                                        onClick = { navigator.open(InvoiceFacts.path(inv.id)) },
                                    ) {
                                        InvoiceListRow(inv, mine = mine(inv), dated = grouping != InvoiceGrouping.day, onPrint = ::print, printing = printing, modifier = Modifier.zoomSource(InvoiceFacts.path(inv.id), Radius.tile))
                                    }
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
    erp.app.ui.QuickPdfBusy(quick)
    if (filtering) {
        InvoiceFilterSheet(
            all = all, scoped = scoped.orEmpty(), filter = filter, chip = chip, grouping = grouping,
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
) {
    animatedItem(key = "search", span = FULL_WIDTH) {
        SearchBarField(
            value = search,
            onValueChange = onSearch,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).readableColumn(),
            placeholder = { Text("Search invoices") },
            leadingIcon = { Icon(Symbols.Search, contentDescription = null) },
            trailingIcon = {
                if (search.isNotEmpty()) IconButton(onClick = { onSearch("") }) { Icon(Symbols.Close, contentDescription = "Clear search") }
            },
            singleLine = true,
            shape = Radius.chipShape,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        )
    }
    animatedItem(key = "chips", span = FULL_WIDTH) {
        ChipRow {
            for (c in listOf(InvoiceChip.all, InvoiceChip.unpaid, InvoiceChip.paid)) {
                FilterChip(c.title, chosen = c == chip, onClick = { onChip(c) }, count = scoped.count { c.matches(it) })
            }
        }
    }
    if (caption != null) {
        animatedItem(key = "caption", span = FULL_WIDTH) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(caption, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = onClear) { Text("Clear", fontWeight = FontWeight.SemiBold) }
            }
        }
    }
}

@Composable
private fun EmptyState(filtering: Boolean, onClear: () -> Unit, onNewSale: () -> Unit) {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        if (filtering) {
            NotAvailableState("No matches", why = "Try adjusting your search or filter.", icon = Symbols.Search)
            TextButton(onClick = onClear) { Text("Clear filters") }
        } else {
            NotAvailableState("No invoices yet", why = "A sale you make will be here, with what is still owed on it.", icon = Symbols.Description)
            TextButton(onClick = onNewSale) { Text("New sale") }
        }
    }
}

/** A section's heading: its day, how many, what it billed; under it what is still owed on it. */
@Composable
internal fun SectionHeader(section: InvoiceSection) {
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

/** One invoice: who it was for, what was sold, its number and time; what it came to with where its balance stands under it; the printer at the end. */
@Composable
internal fun InvoiceListRow(invoice: Invoice, mine: Boolean, dated: Boolean, onPrint: (Invoice) -> Unit, printing: (Invoice) -> Boolean, modifier: Modifier = Modifier) {
    val stacked = isLargeText()
    Row(
        modifier
            .fillMaxWidth()
            .mineRow(mine)
            .defaultMinSize(minHeight = 72.dp)
            .padding(start = 16.dp, top = 16.dp, bottom = 16.dp, end = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.Top,
    ) {
        // The words are one stop for TalkBack; the printer is its own, beside the row rather than inside its link.
        Row(Modifier.weight(1f).semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
            if (stacked) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    RowIdentity(invoice, mine, dated, Modifier)
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        RowAmount(invoiceSaleValue(invoice))
                        InvoiceBalancePill(invoice)
                    }
                }
            } else {
                RowIdentity(invoice, mine, dated, Modifier.weight(1f))
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    RowAmount(invoiceSaleValue(invoice))
                    InvoiceBalancePill(invoice)
                }
            }
        }
        InvoicePrint(invoice, onPrint, printing)
    }
}

/** One tap to the printer (owner, 2026-11-03): the invoice's PDF, named as Print saves it, straight to the share sheet. */
@Composable
internal fun InvoicePrint(invoice: Invoice, onPrint: (Invoice) -> Unit, printing: (Invoice) -> Boolean) {
    QuickPrintButton("Print ${invoice.id}", busy = { printing(invoice) }, onPrint = { onPrint(invoice) })
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
        WhatsAppOrderPill(invoice)
    }
}

/**
 * Where a Mina web order's WhatsApp stands ("Confirmed on WhatsApp", "Cancel requested", ...), as the web's Invoices list and invoice
 * show it (`whatsappOrderChip`): nothing for an invoice with no known state.
 */
@Composable
internal fun WhatsAppOrderPill(invoice: Invoice, modifier: Modifier = Modifier) = WhatsAppStatePill(invoice.whatsappOrder?.state, modifier)

/** The same pill from a state alone: an order carries it too (House of Mina's Shopify orders, 2026-11-09). */
@Composable
internal fun WhatsAppStatePill(state: String?, modifier: Modifier = Modifier) {
    val chip = WhatsAppOrderChip.chip(state) ?: return
    Pill(chip.label, modifier, tone = when (chip.tone) {
        WhatsAppOrderChip.Tone.late -> Tone.late
        WhatsAppOrderChip.Tone.owed -> Tone.owed
        WhatsAppOrderChip.Tone.settled -> Tone.settled
        WhatsAppOrderChip.Tone.working -> Tone.working
        WhatsAppOrderChip.Tone.quiet -> Tone.quiet
    })
}

/** The iPad's card: the row, then Take payment and the actions menu in plain view (no swipe on a tablet). */
@Composable
private fun InvoiceCard(
    inv: Invoice,
    mine: Boolean,
    dated: Boolean,
    canPay: Boolean,
    actions: (Invoice) -> List<RowAction>,
    open: () -> Unit,
    take: () -> Unit,
    onPrint: (Invoice) -> Unit,
    printing: (Invoice) -> Boolean,
) {
    var menu by remember { mutableStateOf(false) }
    Column(
        Modifier
            .zoomSource(InvoiceFacts.path(inv.id))
            .ledgerCard(padding = 20.dp, lit = mine),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.clickable(role = Role.Button, onClick = open)) {
            Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                RowIdentity(inv, mine, dated, Modifier.weight(1f))
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    RowAmount(invoiceSaleValue(inv))
                    InvoiceBalancePill(inv)
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (canPay && isOwing(inv)) {
                TextButton(onClick = take, Modifier.defaultMinSize(minHeight = 48.dp)) {
                    Icon(Symbols.Payments, contentDescription = null)
                    Spacer(Modifier.size(8.dp))
                    Text("Take payment", fontWeight = FontWeight.Medium)
                }
            }
            Spacer(Modifier.weight(1f))
            InvoicePrint(inv, onPrint, printing)
            Box {
                IconButton(onClick = { menu = true }) { Icon(Symbols.MoreHoriz, contentDescription = "Actions for ${inv.id}") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    if (menu) for (a in actions(inv)) DropdownMenuItem(text = { Text(a.label) }, leadingIcon = { Icon(a.icon, null) }, onClick = { menu = false; a.run() })
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
                Icon(Symbols.CalendarMonth, contentDescription = null)
                Spacer(Modifier.size(8.dp))
                Text(filter.rangeFrom?.let { InvoiceCalendar.caption(it, filter.rangeTo) } ?: "Date range")
            }
            if (filter.rangeFrom != null) TextButton(onClick = onClearRange) { Icon(Symbols.Close, null); Spacer(Modifier.size(8.dp)); Text("Clear the date range") }
            if (narrowed) TextButton(onClick = onClear) { Icon(Symbols.Close, null); Spacer(Modifier.size(8.dp)); Text("Clear filters") }
            // The payment links are the ERP's own page (Import Shopify CSV is in the Shopify section where a house has one).
            TextButton(onClick = onWeb) { Icon(Symbols.Language, null); Spacer(Modifier.size(8.dp)); Text("Open in the ERP") }
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
