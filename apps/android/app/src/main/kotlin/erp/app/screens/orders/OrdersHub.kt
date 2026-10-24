package erp.app.screens.orders

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.FilterListOff
import androidx.compose.material.icons.filled.ListAlt
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import erp.app.ui.ShelfState
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.isLargeText
import erp.app.ui.rememberHaptics
import erp.app.ui.theme.ErpColors
import erp.app.ui.toWhatsAppNumber
import erp.core.logic.OrderStage
import erp.core.logic.Money
import erp.core.logic.stageOf
import erp.core.models.Order
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
fun OrdersHub() {
    ScreenTitle("Orders")
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

    val grouping = OrdersGrouping.of(groupingRaw)
    fun choose(g: OrdersGrouping) {
        groupingRaw = g.raw
        Prefs.putString(GROUPING_KEY, g.raw)
    }

    val searching = query.trim().isNotEmpty()
    val narrowed = statusFilter != "All" || month.isNotEmpty() || takenBy.isNotEmpty() || payment != "All"
    /** Anything narrowing the list: the folded stages and the empty state both ask. */
    val anyFilter = searching || narrowed

    fun clearFilters() {
        query = ""; statusFilter = "All"; month = ""; takenBy = ""; payment = "All"
    }

    // The hub's sums, once per change of the books or of what narrows them.
    val view = remember(orders.revision, invoices.revision, query, statusFilter, month, takenBy, payment, grouping, localStatus.entries) {
        val now = AppClock.now()
        val owedOn = OrdersLogic.owedOnInvoices(invoices.items)
        val scoped = OrdersLogic.scope(orders.items, query, month, takenBy, payment)
        val shown = if (statusFilter == "All") scoped else scoped.filter { it.status.rawValue == statusFilter }
        HubView(now, owedOn, shown, OrdersLogic.sections(shown, grouping, owedOn, now) { o -> OrdersLocal.stage(stageOf(o, OrdersLogic.owed(o, owedOn)), OrdersLogic.hasInvoice(o), localStatus[o.id]) })
    }
    // Drop what the books now agree with.
    LaunchedEffect(orders.revision) { localStatus.reconcile { id, s -> orders.items.firstOrNull { it.id == id }?.let { OrdersLocal.statusAgrees(it, s) } ?: true } }
    val note = LocalNoteState.current

    fun message(e: Throwable) = ordersSay(e)

    fun setStatus(order: Order, status: String) {
        localStatus[order.id] = status
        if (status == "Cancelled") haptics.warning() else haptics.success()
        note.show(Note(OrdersLocal.said(status), order.id))
        ErpApi.shared.enqueue("setOrderStatus", mapOf("orderId" to order.id, "status" to status), "${order.id} status")
    }

    val actions = OrderCardActions(
        advance = { advancing = it },
        markReady = { setStatus(it, "Completed") },
        // Cancelling asks first; every other status is one tap.
        setStatus = { order, status ->
            if (status != order.status.rawValue) {
                if (status == "Cancelled") cancelling = order else setStatus(order, status)
            }
        },
        open = { navigator.open(it) },
        contact = { order, kind ->
            if (kind == OrderContactKind.call) {
                val dial = OrdersLogic.dialable(order.customerContact)
                if (dial.isNotEmpty()) erp.app.device.openAddress(context, Intent.ACTION_DIAL, "tel:$dial")
            } else {
                val number = toWhatsAppNumber(order.customerContact)
                if (number.isNotEmpty()) erp.app.device.openAddress(context, Intent.ACTION_VIEW, "https://wa.me/$number")
            }
        },
    )

    ScreenActions {
        IconButton(onClick = { filtering = true }) {
            Icon(
                if (narrowed) Icons.Filled.FilterList else Icons.Filled.FilterListOff, "Filter",
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
                    Icon(Icons.Filled.Public, null)
                }
            }
        }
    }

    ShelfState(
        loaded = orders.loaded && invoices.loaded,
        error = orders.error ?: invoices.error,
        offline = orders.offline,
        connectionLost = connectionLost,
    ) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            // The wide window's cards sit in columns of one card width each; large text keeps the single column.
            val grid = maxWidth >= 760.dp && !isLargeText()
            val columns = if (grid) CardColumns.count(maxWidth - 48.dp) else 1
            val pad = if (grid) 24.dp else 16.dp
            val sections = view.sections
            LazyVerticalGrid(
                columns = GridCells.Fixed(columns),
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(pad),
                horizontalArrangement = Arrangement.spacedBy(20.dp),
                verticalArrangement = Arrangement.spacedBy(if (grid) 20.dp else 14.dp),
            ) {
                item(key = "controls", span = { GridItemSpan(maxLineSpan) }) {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        OutlinedTextField(
                            value = query, onValueChange = { query = it }, modifier = Modifier.fillMaxWidth(), singleLine = true,
                            placeholder = { Text("Order, customer, phone or piece") },
                            leadingIcon = { Icon(Icons.Filled.Search, null) },
                            trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Icons.Filled.Clear, "Clear the search") } },
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        )
                        GroupingPicker(grouping, ::choose)
                        if (narrowed) {
                            FilterSummary(statusFilter, month, takenBy, payment) { statusFilter = "All"; month = ""; takenBy = ""; payment = "All" }
                        }
                    }
                }
                for (g in sections) {
                    item(key = "h-" + g.id, span = { GridItemSpan(maxLineSpan) }) { OrdersSectionHeader(g) }
                    if (g.folds) {
                        // A search or a filter must reach the folded stages too, or its hits hide behind "Show".
                        val open = anyFilter || opened.contains(g.id)
                        item(key = "f-" + g.id, span = { GridItemSpan(maxLineSpan) }) {
                            Row(
                                Modifier.fillMaxWidth().clickable(enabled = !anyFilter) { opened = if (open) opened - g.id else opened + g.id }.padding(vertical = 8.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    "${g.orders.size} order${if (g.orders.size == 1) "" else "s"}",
                                    Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Icon(if (open) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, if (open) "Hide" else "Show", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        if (open) itemsIndexed(g.orders, key = { _, it -> "o-" + g.id + "-" + it.id }) { i, order -> Card(order, view, isOwner, person, localStatus[order.id], actions, grouping, i) }
                    } else {
                        itemsIndexed(g.orders, key = { _, it -> "o-" + g.id + "-" + it.id }) { i, order -> Card(order, view, isOwner, person, localStatus[order.id], actions, grouping, i) }
                    }
                }
                if (sections.isEmpty()) {
                    item(key = "empty", span = { GridItemSpan(maxLineSpan) }) {
                        EmptyState(nothingOpen = grouping == OrdersGrouping.due && view.shown.isNotEmpty(), filtering = anyFilter, onClear = ::clearFilters) {
                            navigator.open("/orders/add")
                        }
                    }
                }
            }
        }
    }

    if (filtering) {
        HubFilterSheet(
            all = orders.items,
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
            onSave = { entry -> OrderAdvance.record(order, entry.amount, entry.method, entry.note) },
            owed = order.grandTotal,
            noteDefault = "Advance payment received",
            settle = if (isOwner) { entry, remainder -> OrderAdvance.settle(order, entry.amount, entry.method, entry.note, remainder) } else null,
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
    FailureAlert(failure, onDismiss = { failure = null }, title = "Not changed")
}

private const val GROUPING_KEY = "orders.grouping"

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
) {
    val owed = OrdersLogic.owed(order, view.owedOn)
    OrderCard(
        modifier = Modifier.appearOnce(index),
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
            NotAvailableState("Nothing to chase", why = "Every order here is invoiced or closed. Day and Stage show them all.", icon = Icons.Filled.CalendarMonth)
        } else {
            NotAvailableState("No orders found", why = if (filtering) "Try adjusting the search or filters." else "Create a custom order to begin.", icon = Icons.Filled.ListAlt)
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
