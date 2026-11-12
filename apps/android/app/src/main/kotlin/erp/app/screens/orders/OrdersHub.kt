package erp.app.screens.orders

import erp.app.ui.animatedItem
import erp.app.nav.LocalFabClearance
import erp.app.ui.icons.Symbols
import erp.app.screens.offline.pendingRecords
import erp.app.ui.SearchBarField
import erp.app.ui.appearOnce
import androidx.compose.foundation.lazy.grid.itemsIndexed
import erp.app.ui.AppClock
import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.text.KeyboardOptions
import erp.app.ui.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import erp.app.ui.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import erp.app.ui.OutlinedButton
import erp.app.ui.SegmentedButton
import erp.app.ui.SegmentedButtonDefaults
import erp.app.ui.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import kotlinx.coroutines.delay
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.config.Prefs
import erp.app.data.Connection
import erp.app.data.LocalBook
import erp.app.data.OnlineInbox
import erp.app.data.ErpApi
import erp.app.data.rememberOffMain
import erp.app.screens.neworder.slipTarget
import erp.app.data.rememberShelfStatus
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.ui.CardColumns
import erp.app.ui.ChipRow
import erp.app.ui.FailureAlert
import erp.app.ui.FilterChip
import erp.app.ui.LedgerHeading
import erp.app.ui.LocalNoteState
import erp.app.ui.Note
import erp.app.ui.rememberLocalChanges
import erp.app.ui.NotAvailableState
import erp.app.ui.PaymentSheet
import erp.app.ui.PaymentText
import erp.app.ui.ShelfState
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.isLargeText
import erp.app.ui.rememberHaptics
import erp.app.ui.theme.ErpColors
import erp.app.ui.toWhatsAppNumber
import erp.core.logic.OrderStage
import erp.core.logic.ShopifyOrders
import erp.app.screens.invoices.InvoiceFacts
import erp.app.screens.invoices.InvoiceGrouping
import erp.app.screens.invoices.InvoiceListRow
import erp.app.screens.invoices.InvoicesListRules
import erp.app.screens.invoices.SectionHeader
import androidx.compose.ui.draw.clip
import erp.app.ui.Radius
import erp.core.logic.Money
import erp.core.logic.stageOf
import erp.core.models.Order
import erp.core.models.Invoice
import erp.core.ERPDate
import androidx.compose.foundation.background
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * The Orders hub (src/app/orders/page.tsx, docs/decisions.md "Orders hub"): the list by day to start with (the
 * owner, 2026-10-05), or by stage (what is ready to hand over first, each card carrying its one next step), by
 * when it is due (the open orders, Late first), week or month. In the stage view Done and Cancelled fold away:
 * they are history, not work. The signed-in person's own cards are lit in place, not sorted or filtered.
 *
 * The switcher and the status chips are the list's first rows, not a bar pinned over it: pinned, they sat over the
 * title and greyed it out (2026-10-09). On a wide window the cards sit in columns, as on the iPad.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun OrdersHub(shopify: Boolean = false) {
    ScreenTitle(if (shopify) "Shopify" else "Orders")
    val book = LocalBook.current
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val context = LocalContext.current
    val haptics = rememberHaptics()
    val scope = rememberCoroutineScope()
    val me by session.me.collectAsStateWithLifecycle()
    val orders = rememberShelfStatus(book.orders)
    val invoices = rememberShelfStatus(book.invoices)
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()
    val pendingOrders = erp.app.screens.offline.rememberPendingRecords(session.business, "order")
    val waiting by OnlineInbox.waiting.collectAsStateWithLifecycle()
    val isOwner = me?.role == "owner"
    val person = session.shop.person

    var query by rememberSaveable { mutableStateOf("") }
    var statusFilter by rememberSaveable { mutableStateOf("All") }
    // Day, Stage or Due (or Week or Month, from the menu), kept on this phone: the owner's Day to start.
    var groupingRaw by rememberSaveable { mutableStateOf(Prefs.string(GROUPING_KEY) ?: OrdersGrouping.day.raw) }
    /** "" is all time, else "yyyy-MM". */
    var month by rememberSaveable { mutableStateOf("") }
    /** "" is Anyone: everyone's orders to start with, the signed-in person's lit (2026-10-05). */
    var takenBy by rememberSaveable { mutableStateOf("") }
    /** "All", or Paid / Partial / Unpaid. */
    var payment by rememberSaveable { mutableStateOf("All") }
    /** The folded stages a person has opened. */
    var opened by rememberSaveable { mutableStateOf(setOf<String>()) }
    /** The status each order was just given, until the books say so: a save leaves at once (Outbox). */
    val localStatus = rememberLocalChanges<String, String>()
    var advancing by remember { mutableStateOf<Order?>(null) }
    var cancelling by remember { mutableStateOf<Order?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    var filtering by remember { mutableStateOf(false) }
    // House of Mina's Shopify section (2026-11-09): its orders live in /shopify, not here (the nav map says the house has it).
    val hasSection = remember { erp.app.nav.NavMap.current.hasShopify }
    var sFilter by rememberSaveable { mutableStateOf(ShopifyOrders.Filter.all) }
    val earlierMode = shopify && sFilter == ShopifyOrders.Filter.earlier

    val grouping = OrdersGrouping.of(groupingRaw)
    fun choose(g: OrdersGrouping) {
        groupingRaw = g.raw
        Prefs.putString(GROUPING_KEY, g.raw)
    }

    // The list is worked out from the text 200 ms after the last keystroke (the box itself stays instant); clearing applies at once.
    var appliedQuery by remember { mutableStateOf(query) }
    LaunchedEffect(query) { if (query.isNotEmpty()) delay(200); appliedQuery = query }
    val searching = appliedQuery.trim().isNotEmpty()
    val narrowed = statusFilter != "All" || month.isNotEmpty() || takenBy.isNotEmpty() || payment != "All"
    /** Anything narrowing the list: the folded stages and the empty state both ask. */
    val anyFilter = searching || narrowed

    fun clearFilters() {
        query = ""; statusFilter = "All"; month = ""; takenBy = ""; payment = "All"
    }

    // The hub's sums, once per change of the books or of what narrows them.
    // Worked out off the main thread; the last view stays up while the next is computed.
    val viewNow by rememberOffMain(orders.revision, invoices.revision, appliedQuery, statusFilter, month, takenBy, payment, grouping, localStatus.entries, sFilter) {
        val now = AppClock.now()
        val owedOn = OrdersLogic.owedOnInvoices(invoices.items)
        val scoped = OrdersLogic.scope(ShopifyOrders.hubOrders(orders.items, hasSection, shopify), appliedQuery, month, takenBy, payment)
            .let { if (shopify && sFilter == ShopifyOrders.Filter.toConfirm) it.filter(ShopifyOrders::toConfirm) else it }
        val shown = if (statusFilter == "All") scoped else scoped.filter { it.status.rawValue == statusFilter }
        HubView(now, owedOn, shown, OrdersLogic.sections(shown, grouping, owedOn, now) { o -> OrdersLocal.stage(stageOf(o, OrdersLogic.owed(o, owedOn)), OrdersLogic.hasInvoice(o), localStatus[o.id]) })
    }
    val view = viewNow
    // What the hub lists (the filter sheet's counts) and the section's earlier invoices.
    val shopifyOrders = remember(orders.revision) { ShopifyOrders.hubOrders(orders.items, hasSection, shopify) }
    val earlierInvoices = remember(invoices.revision, orders.revision, shopify) { if (shopify) ShopifyOrders.earlier(invoices.items, orders.items) else emptyList() }
    // "All" in the section shows the orders and the old invoices together, newest first by day (fix 2, 2026-11-09).
    val mergedAll = shopify && sFilter == ShopifyOrders.Filter.all && earlierInvoices.isNotEmpty()
    val mixedDays = remember(view, earlierInvoices, mergedAll, appliedQuery, statusFilter, month, takenBy, payment) {
        if (!mergedAll || view == null) emptyList() else {
            val q = appliedQuery.trim()
            val digits = q.filter { it in '0'..'9' }.trimStart('0')
            val invoiceRows = if (statusFilter != "All" || takenBy.isNotEmpty() || payment != "All") emptyList() else
                earlierInvoices.filter { (month.isEmpty() || OrdersCalendar.monthKey(it.createdAt) == month) && (q.isEmpty() || InvoicesListRules.matches(it, q, digits, emptyMap())) }
            val rows = (view.shown.map { it as Any } + invoiceRows.map { it as Any })
            fun at(r: Any): Instant = ERPDate.parse(if (r is Order) r.createdAt else (r as Invoice).createdAt) ?: Instant.MIN
            val keys = ArrayList<String>()
            val info = HashMap<String, OrdersCalendar.Bucket>()
            val members = HashMap<String, MutableList<Any>>()
            for (r in rows.sortedByDescending(::at)) {
                val d = at(r)
                val b = if (d != Instant.MIN) OrdersCalendar.bucket(d, OrdersGrouping.day, view.now) else OrdersCalendar.Bucket("undated", "No date", "")
                if (!info.containsKey(b.key)) { info[b.key] = b; keys.add(b.key) }
                members.getOrPut(b.key) { ArrayList() }.add(r)
            }
            keys.map { MixedDay(it, info.getValue(it).title, members[it].orEmpty()) }
        }
    }
    // Owners: the old Shopify sales still open can be made orders.
    var converting by remember { mutableStateOf(false) }
    val convertible = remember(invoices.revision, orders.revision, shopify) { if (shopify) ShopifyOrders.eligible(invoices.items, orders.items) else emptyList() }
    // Drop what the books now agree with.
    LaunchedEffect(orders.revision) { localStatus.reconcile { id, s -> orders.items.firstOrNull { it.id == id }?.let { OrdersLocal.statusAgrees(it, s) } ?: true } }
    val note = LocalNoteState.current

    fun message(e: Throwable) = ordersSay(e)

    fun setStatus(order: Order, status: String) {
        // `from`: the status the person saw (machines/expected.ts): a stale queued change is refused, not replayed over a newer one.
        val from = localStatus[order.id] ?: order.status.rawValue
        localStatus[order.id] = status
        if (status == "Cancelled") haptics.warning() else haptics.success()
        note.show(Note(OrdersLocal.said(status), order.id))
        ErpApi.shared.enqueue("setOrderStatus", mapOf("orderId" to order.id, "status" to status, "from" to from), "${order.id} status")
    }

    // One set of actions for the life of the screen: the cards compare it by identity, so a change to the books or to a filter
    // recomposes only the cards whose own order changed. What the lambdas reach (the note, the navigator, the context) is read through
    // rememberUpdatedState, so they never go stale.
    val quick = erp.app.ui.rememberQuickPdf()
    var printingId by remember { mutableStateOf<String?>(null) }
    val applyStatus by rememberUpdatedState { order: Order, status: String -> setStatus(order, status) }
    val currentNavigator by rememberUpdatedState(navigator)
    val currentContext by rememberUpdatedState(context)
    val actions = remember(quick) {
        OrderCardActions(
            advance = { advancing = it },
            markReady = { applyStatus(it, "Completed") },
            // Cancelling asks first; every other status is one tap.
            setStatus = { order, status ->
                if (status != order.status.rawValue) {
                    if (status == "Cancelled") cancelling = order else applyStatus(order, status)
                }
            },
            open = { currentNavigator.open(it) },
            contact = { order, kind ->
                // The swipe's fast path; the number is the Contact menu's one (0300… dials +92300…).
                if (kind == OrderContactKind.call) {
                    erp.app.ui.CustomerContactLinks.tel(order.customerContact)?.let { erp.app.device.openAddress(currentContext, Intent.ACTION_DIAL, it) }
                } else {
                    erp.app.ui.CustomerContactLinks.whatsApp(order.customerContact)?.let { erp.app.device.openAddress(currentContext, Intent.ACTION_VIEW, it) }
                }
            },
            // One tap to the printer: the slip's target is built here, in the tap, not in every card's composition.
            print = { order ->
                printingId = order.id
                slipTarget(order.id).let { quick.share(it.path, it.fileName, it.title) }
            },
            printing = { order -> quick.preparing && printingId == order.id },
        )
    }

    ScreenActions {
        if (shopify) {
            // Analytics › Website › Visitors, which for House of Mina is Shopify's.
            IconButton(onClick = { navigator.open("/website/interest") }) { Icon(Symbols.BarChart, "Shopify analytics", tint = MaterialTheme.colorScheme.onSurfaceVariant) }
            // Import Shopify CSV is the ERP's own page (owners only, as on the web).
            if (isOwner) IconButton(onClick = { navigator.open("/shopify?web=1") }) { Icon(Symbols.Download, "Import Shopify CSV", tint = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        IconButton(onClick = { filtering = true }) {
            Icon(
                if (narrowed) Symbols.FilterList else Symbols.FilterListOff, "Filter",
                tint = if (narrowed) ErpColors.accent else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        // Online orders wait here until a person confirms them (docs/decisions.md "Online orders"): one tap from the
        // hub while any wait, with how many. A house whose website takes no orders (Mina) has none.
        if (me?.shop?.websiteSelling == true && waiting > 0) {
            IconButton(
                onClick = { navigator.open("/orders/online") },
                modifier = Modifier.semantics { contentDescription = "Online orders, $waiting to confirm" },
            ) {
                BadgedBox(badge = { Badge(containerColor = ErpColors.accent, contentColor = ErpColors.onAccent) { Text(if (waiting > 99) "99+" else "$waiting") } }) {
                    Icon(Symbols.Public, null)
                }
            }
        }
    }

    ShelfState(
        shape = erp.app.ui.SkeletonShape.Cards,
        loaded = orders.loaded && invoices.loaded && view != null,
        error = orders.error ?: invoices.error,
        offline = orders.offline,
        connectionLost = connectionLost,
    ) {
        if (view == null) return@ShelfState
        BoxWithConstraints(Modifier.fillMaxSize()) {
            // The wide window's cards sit in columns of one card width each; large text keeps the single column.
            val grid = maxWidth >= 760.dp && !isLargeText()
            val columns = if (grid) CardColumns.count(maxWidth - 48.dp) else 1
            val pad = if (grid) 24.dp else 16.dp
            val sections = view.sections
            LazyVerticalGrid(
                columns = GridCells.Fixed(columns),
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = pad, top = pad, end = pad, bottom = maxOf(pad, LocalFabClearance.current)),
                horizontalArrangement = Arrangement.spacedBy(20.dp),
                verticalArrangement = Arrangement.spacedBy(if (grid) 20.dp else 14.dp),
            ) {
                animatedItem(key = "controls", contentType = "controls", span = { GridItemSpan(maxLineSpan) }) {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        SearchBarField(
                            value = query, onValueChange = { query = it }, modifier = Modifier.fillMaxWidth(), singleLine = true,
                            placeholder = { Text("Order, customer, phone or piece") },
                            leadingIcon = { Icon(Symbols.Search, null) },
                            trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Symbols.Clear, "Clear the search") } },
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        )
                        if (shopify) {
                            ChipRow {
                                for (f in ShopifyOrders.Filter.values()) {
                                    val count = when (f) {
                                        ShopifyOrders.Filter.all -> shopifyOrders.size + earlierInvoices.size
                                        ShopifyOrders.Filter.toConfirm -> shopifyOrders.count(ShopifyOrders::toConfirm)
                                        ShopifyOrders.Filter.earlier -> earlierInvoices.size
                                    }
                                    // The Earlier chip only while there is something earlier; To confirm only while something waits.
                                    if (f == ShopifyOrders.Filter.all || f == sFilter || count > 0) FilterChip(f.title, sFilter == f, { sFilter = f }, count = count)
                                }
                            }
                        }
                        if (shopify && isOwner && convertible.isNotEmpty() && !searching) ConvertBanner(convertible.size) { converting = true }
                        if (!earlierMode && !mergedAll) GroupingPicker(grouping, ::choose)
                        if (narrowed) {
                            FilterSummary(statusFilter, month, takenBy, payment) { statusFilter = "All"; month = ""; takenBy = ""; payment = "All" }
                        }
                    }
                }
                // Orders taken with no line, kept on this phone until the ERP has them: "Waiting to send" at the top.
                if (!shopify) pendingRecords(pendingOrders)
                if (earlierMode) {
                    // Shopify sales from before the orders: invoices, opening their invoice pages.
                    val q = appliedQuery.trim()
                    val digits = q.filter { it in '0'..'9' }.trimStart('0')
                    val rows = earlierInvoices.filter { q.isEmpty() || InvoicesListRules.matches(it, q, digits, emptyMap()) }
                    val days = InvoicesListRules.sections(rows, InvoiceGrouping.day, view.now)
                    for (g in days) {
                        animatedItem(key = "eh-" + g.id, contentType = "header", span = { GridItemSpan(maxLineSpan) }) { SectionHeader(g) }
                        items(g.rows.size, key = { "ei-${g.id}-${g.rows[it].id}" }, contentType = { "invoice" }) { i ->
                            val inv = g.rows[i]
                            Column(Modifier.animateItem().clip(Radius.cardShape).clickable { navigator.open(InvoiceFacts.path(inv.id)) }) {
                                InvoiceListRow(inv, mine = false, dated = false, onPrint = {}, printing = { false })
                            }
                        }
                    }
                    if (days.isEmpty()) animatedItem(key = "eempty", contentType = "empty", span = { GridItemSpan(maxLineSpan) }) {
                        NotAvailableState("No earlier invoices", why = "Shopify sales from before orders were used are here.", icon = Symbols.Description)
                    }
                }
                for (g in mixedDays) {
                    animatedItem(key = "mh-" + g.id, contentType = "header", span = { GridItemSpan(maxLineSpan) }) { LedgerHeading(g.title, count = g.rows.size) }
                    items(g.rows.size, key = { "mi-${g.id}-" + (g.rows[it].let { r -> if (r is Order) "o" + r.id else "i" + (r as Invoice).id }) }, contentType = { if (g.rows[it] is Order) "order" else "invoice" }) { i ->
                        when (val r = g.rows[i]) {
                            is Order -> Card(r, view, isOwner, person, localStatus[r.id], actions, OrdersGrouping.day, i, Modifier.animateItem())
                            is Invoice -> Column(Modifier.animateItem().clip(Radius.cardShape).clickable { navigator.open(InvoiceFacts.path(r.id)) }) {
                                InvoiceListRow(r, mine = false, dated = false, onPrint = {}, printing = { false })
                            }
                        }
                    }
                }
                for (g in if (earlierMode || mergedAll) emptyList() else sections) {
                    animatedItem(key = "h-" + g.id, contentType = "header", span = { GridItemSpan(maxLineSpan) }) { OrdersSectionHeader(g) }
                    if (g.folds) {
                        // A search or a filter must reach the folded stages too, or its hits hide behind "Show".
                        val open = anyFilter || opened.contains(g.id)
                        animatedItem(key = "f-" + g.id, contentType = "fold", span = { GridItemSpan(maxLineSpan) }) {
                            Row(
                                Modifier.fillMaxWidth().clickable(enabled = !anyFilter) { opened = if (open) opened - g.id else opened + g.id }.padding(vertical = 8.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    "${g.orders.size} order${if (g.orders.size == 1) "" else "s"}",
                                    Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Icon(if (open) Symbols.ExpandLess else Symbols.ExpandMore, if (open) "Hide" else "Show", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        if (open) itemsIndexed(g.orders, key = { _, it -> "o-" + g.id + "-" + it.id }, contentType = { _, _ -> "order" }) { i, order -> Card(order, view, isOwner, person, localStatus[order.id], actions, grouping, i, Modifier.animateItem()) }
                    } else {
                        itemsIndexed(g.orders, key = { _, it -> "o-" + g.id + "-" + it.id }, contentType = { _, _ -> "order" }) { i, order -> Card(order, view, isOwner, person, localStatus[order.id], actions, grouping, i, Modifier.animateItem()) }
                    }
                }
                if (!earlierMode && !mergedAll && sections.isEmpty() && (shopify || pendingOrders.isEmpty()) || mergedAll && mixedDays.isEmpty()) {
                    animatedItem(key = "empty", contentType = "empty", span = { GridItemSpan(maxLineSpan) }) {
                        if (shopify && !anyFilter && sFilter == ShopifyOrders.Filter.all) NotAvailableState("No Shopify orders yet", why = "Orders from the online store will be here.", icon = Symbols.ShoppingBag)
                        else EmptyState(nothingOpen = grouping == OrdersGrouping.due && view.shown.isNotEmpty(), filtering = anyFilter || sFilter != ShopifyOrders.Filter.all, onClear = { clearFilters(); sFilter = ShopifyOrders.Filter.all }) {
                            navigator.open("/orders/add")
                        }
                    }
                }
            }
        }
    }

    if (filtering) {
        HubFilterSheet(
            all = shopifyOrders,
            statusFilter = statusFilter, onStatus = { statusFilter = it },
            grouping = grouping, onGrouping = ::choose,
            month = month, onMonth = { month = it },
            takenBy = takenBy, onTakenBy = { takenBy = it },
            people = session.shop.takenBy,
            payment = payment, onPayment = { payment = it },
            onDismiss = { filtering = false },
        )
    }

    // An advance from the card: owners only (the ERP refuses anyone else), and never once invoiced. It carries a
    // note, the web's "Advance payment received" unless the person writes their own.
    advancing?.let { order ->
        PaymentSheet(
            title = "Advance on ${order.id}",
            onDismiss = { advancing = null },
            onSave = { entry ->
                OrderAdvance.record(order, entry.amount, entry.method, entry.note, entry.exchanges)
                note.show(Note("Advance recorded", PaymentText.advanceSaid(entry.amount, entry.exchanges)))
            },
            owed = order.grandTotal,
            noteDefault = "Advance payment received",
            settle = if (isOwner) { entry, remainder ->
                OrderAdvance.settle(order, entry.amount, entry.method, entry.note, remainder)
                note.show(Note("Advance recorded", PaymentText.advanceSaid(entry.amount, emptyList())))
            } else null,
        )
    }

    cancelling?.let { order ->
        AlertDialog(
            onDismissRequest = { cancelling = null },
            title = { Text("Cancel order ${order.id}?") },
            text = { Text(OrdersLogic.cancelWords) },
            confirmButton = { TextButton(onClick = { cancelling = null; setStatus(order, "Cancelled") }) { Text("Cancel order", color = Tone.problem.color()) } },
            dismissButton = { TextButton(onClick = { cancelling = null }) { Text("Keep it") } },
        )
    }
    if (converting) ShopifyConvertFlow(convertible.map { it.id }, onDismiss = { converting = false })
    erp.app.ui.QuickPdfBusy(quick)
    FailureAlert(failure, onDismiss = { failure = null }, title = "Not changed")
}

private const val GROUPING_KEY = "orders.grouping"

private class MixedDay(val id: String, val title: String, val rows: List<Any>)

/** Owners: old Shopify sales still open as invoices, and the way to make them orders. */
@Composable
private fun ConvertBanner(count: Int, onMake: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(Radius.cardShape).background(MaterialTheme.colorScheme.surfaceVariant).padding(start = 16.dp, top = 8.dp, bottom = 8.dp, end = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "$count Shopify sale${if (count == 1) " is" else "s are"} still invoice${if (count == 1) "" else "s"}",
            Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium,
        )
        TextButton(onClick = onMake) { Text("Make them orders", fontWeight = FontWeight.Medium) }
    }
}

private class HubView(val now: Instant, val owedOn: Map<String, Double>, val shown: List<Order>, val sections: List<HubSection>)

@Composable
private fun Card(
    order: Order,
    view: HubView,
    isOwner: Boolean,
    person: String?,
    /** The status just chosen, laid over the books' stage until they agree. */
    localStatus: String?,
    actions: OrderCardActions,
    grouping: OrdersGrouping,
    index: Int = Int.MAX_VALUE,
    modifier: Modifier = Modifier,
) {
    val owed = OrdersLogic.owed(order, view.owedOn)
    OrderCard(
        modifier = modifier.appearOnce(index),
        order = order,
        stage = OrdersLocal.stage(stageOf(order, owed), OrdersLogic.hasInvoice(order), localStatus),
        owed = owed,
        now = view.now,
        isOwner = isOwner,
        mine = OrdersLogic.isMine(order, person),
        busy = false,
        actions = actions,
        showsStage = grouping != OrdersGrouping.stage,
    )
}

/** A section's name in the serif with how many orders it holds beside it and what they come to on the right, and its hint under it ("finished: invoice it", "past the day promised"). */
@Composable
private fun OrdersSectionHeader(g: HubSection) {
    val value = g.orders.fold(0.0) { a, o -> a + o.subtotal }
    Column(
        Modifier.padding(top = 4.dp).semantics(mergeDescendants = true) {
            contentDescription = "${g.title}, ${g.orders.size} order${if (g.orders.size == 1) "" else "s"}, worth ${Money.pkrLac(value)}"
        },
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        LedgerHeading(g.title, count = g.orders.size, trailing = "worth " + Money.pkrLac(value), tone = if (g.late) Tone.late else Tone.quiet)
        if (g.hint.isNotEmpty()) Text(g.hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
    }
}

/** Day / Stage / Due: always visible; status and the other filters share the toolbar's filter sheet. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun GroupingPicker(grouping: OrdersGrouping, onChoose: (OrdersGrouping) -> Unit) {
    val cut = grouping.calendarCut
    val options = listOf(cut, OrdersGrouping.stage, OrdersGrouping.due)
    // Three words need no more than a phone's width, wherever they are.
    SingleChoiceSegmentedButtonRow(Modifier.widthIn(max = 480.dp).fillMaxWidth()) {
        options.forEachIndexed { i, g ->
            SegmentedButton(
                selected = grouping == g || (g == cut && grouping.isCalendar),
                onClick = { onChoose(g) },
                shape = SegmentedButtonDefaults.itemShape(i, options.size),
                label = { Text(g.title) },
            )
        }
    }
}

/** What the filter sheet has narrowed the list to, with the way back. */
@Composable
private fun FilterSummary(status: String, month: String, takenBy: String, payment: String, onClear: () -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(
            listOfNotNull(
                status.takeIf { it != "All" },
                month.takeIf { it.isNotEmpty() }?.let { OrdersCalendar.monthLabel(it) },
                takenBy.takeIf { it.isNotEmpty() },
                payment.takeIf { it != "All" },
            ).joinToString(" · "),
            Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        TextButton(onClick = onClear) { Text("Clear", fontWeight = FontWeight.Medium) }
    }
}

@Composable
private fun EmptyState(nothingOpen: Boolean, filtering: Boolean, onClear: () -> Unit, onNew: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(top = 40.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (nothingOpen) {
            NotAvailableState("Nothing to chase", why = "Every order here is invoiced or closed. Day and Stage show them all.", icon = Symbols.CalendarMonth)
        } else {
            NotAvailableState("No orders found", why = if (filtering) "Try adjusting the search or filters." else "Create a custom order to begin.", icon = Symbols.ListAlt)
            if (filtering) OutlinedButton(onClick = onClear) { Text("Clear filters") }
            Button(onClick = onNew, colors = ButtonDefaults.buttonColors(containerColor = ErpColors.accent, contentColor = ErpColors.onAccent)) { Text("New order") }
        }
    }
}

// MARK: The filter sheet: how it is grouped, which month, whose, how paid

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun HubFilterSheet(
    all: List<Order>,
    statusFilter: String, onStatus: (String) -> Unit,
    grouping: OrdersGrouping, onGrouping: (OrdersGrouping) -> Unit,
    month: String, onMonth: (String) -> Unit,
    takenBy: String, onTakenBy: (String) -> Unit,
    people: List<String>,
    payment: String, onPayment: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val months = remember(all.size) { all.mapNotNull { OrdersCalendar.monthKey(it.createdAt) }.toSet().sortedDescending() }
    OrdersSheet(title = "Filter", cancelLabel = "Done", onDismiss = onDismiss) {
        OrdersFormSection(title = "Status") {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip("All orders", statusFilter == "All", { onStatus("All") }, count = all.size)
                for (s in OrdersLogic.filterStatuses) {
                    FilterChip(s, statusFilter == s, { onStatus(s) }, count = all.count { it.status.rawValue == s })
                }
            }
        }
        OrdersFormSection(title = "Group by") {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (g in OrdersGrouping.entries) FilterChip(g.title, grouping == g, { onGrouping(g) })
            }
        }
        OrdersFormSection(title = "Month") {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip("All time", month.isEmpty(), { onMonth("") })
                for (m in months) FilterChip(OrdersCalendar.monthLabel(m), month == m, { onMonth(m) })
            }
        }
        if (people.isNotEmpty()) {
            OrdersFormSection(title = "Taken by") {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip("Anyone", takenBy.isEmpty(), { onTakenBy("") })
                    for (p in people) FilterChip(p, takenBy == p, { onTakenBy(p) })
                }
            }
        }
        OrdersFormSection(title = "Payment") {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip("Any payment", payment == "All", { onPayment("All") })
                for (p in OrdersLogic.filterPayments) FilterChip(p, payment == p, { onPayment(p) })
            }
        }
    }
}
