package erp.app.screens.orders

import erp.app.ui.AppClock
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.ListAlt
import androidx.compose.material.icons.filled.LocalShipping
import androidx.compose.material.icons.filled.LockOpen
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.Percent
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Undo
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.StickyNote2
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.config.House
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.rememberShelf
import erp.app.data.rememberShelfItem
import erp.app.data.rememberShelfStatus
import erp.app.data.Connection
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.ui.DateLeaf
import erp.app.ui.DestructiveFeedback
import erp.app.ui.FailureAlert
import erp.app.ui.HeroAmount
import erp.app.ui.LedgerHeading
import erp.app.ui.LocalNoteState
import erp.app.ui.ContactActions
import erp.app.ui.MineTag
import erp.app.ui.MoneyFeedback
import erp.app.ui.MoneyRow
import erp.app.ui.MoneySplit
import erp.app.ui.Monogram
import erp.app.ui.MonogramSize
import erp.app.ui.NotAvailableState
import erp.app.ui.Note
import erp.app.ui.rememberLocalChanges
import erp.app.ui.PaymentSheet
import erp.app.ui.Pill
import erp.app.ui.ShelfState
import erp.app.ui.ShopDate
import erp.app.ui.StageTrack
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.heroSheen
import erp.app.ui.isLargeText
import erp.app.ui.ledgerCard
import erp.app.ui.rememberHaptics
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.ErpType
import erp.app.ui.theme.TabularDigits
import erp.app.ui.zoomDestination
import erp.app.web.WebScreen
import erp.core.logic.OrderStage
import erp.core.logic.describeDelivery
import erp.core.logic.describeExchangeEntry
import erp.core.logic.isCredit
import erp.core.logic.isOwing
import erp.core.logic.orderExchanges
import erp.core.logic.orderTiming
import erp.core.logic.owesMoney
import erp.core.logic.pieceCounts
import erp.core.logic.stageOf
import erp.core.logic.PromiseState
import erp.core.logic.Money
import erp.core.models.Invoice
import erp.core.models.Order
import erp.core.models.OrderStatus
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * One order (src/app/orders/[id]/page.tsx): who it is for, where it stands, its pieces with their karigars, and the
 * money. Setting the status, ticking a piece done, recording an advance, editing, finalizing, the slip, cancelling
 * or unlocking the invoice, refunding, deleting (behind the delete code), booking and tracking the courier and
 * sending the customer an update are native (OrderUndoSheets, OrderCourierSheet, OrderTrackingSheet,
 * OrderLeopardsSheet, OrderNotifySheet); giving a piece out is the Workshop's.
 *
 * The page reads as the ledger (reordered in the iPhone review of 2026-10-12): the hero card first (who it is for,
 * what is owed, when it was promised, how far it has come, how to reach them); the note and where it goes; the
 * online panel; the pieces, open ones first; the money as Total · Paid · Due with its breakdown folded; the
 * quieter facts last. The order's next step is the bar at its foot, as an invoice's Take payment is, with an
 * Advance beside it while the order is being made. Edit is on the bar above; the ⋮ menu keeps everything else,
 * the destructive moves last.
 */
@Composable
fun OrderScreen(id: String) {
    // New order is the ERP's own page until its group lands, and "/orders/" + "add" reaches this screen as an order id.
    if (id == "add") {
        WebScreen("/orders/add")
        return
    }
    ScreenTitle(id)
    val book = LocalBook.current
    val orders = rememberShelfStatus(book.orders)
    rememberShelf(book.invoices)
    rememberShelf(book.karigars)
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()
    val order = rememberShelfItem(book.orders, id)
    Box(Modifier.fillMaxSize().zoomDestination(OrderPaths.order(id))) {
        ShelfState(loaded = orders.loaded, error = orders.error, offline = orders.offline, connectionLost = connectionLost) {
            // Read through `items`: the shelf's lookup alone would not redraw on a change.
            if (order != null) Detail(order) else NotAvailableState("Order not found", why = "$id is not in the book.", icon = Icons.Filled.ListAlt)
        }
    }
}

@Composable
private fun Detail(shelfOrder: Order) {
    val book = LocalBook.current
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val haptics = rememberHaptics()
    val scope = rememberCoroutineScope()
    val me by session.me.collectAsStateWithLifecycle()
    val role = me?.role ?: "none"
    val isOwner = role == "owner"
    val person = session.shop.person

    // What the person just did, until the books say so: a status or a tick leaves at once (Outbox).
    val localStatus = rememberLocalChanges<String, String>()
    val localDone = rememberLocalChanges<Int, Boolean>()
    val order = OrdersLocal.shown(shelfOrder, localStatus["status"], localDone.entries.toMap())
    LaunchedEffect(shelfOrder) {
        localStatus.reconcile { _, s -> OrdersLocal.statusAgrees(shelfOrder, s) }
        localDone.reconcile { i, d -> OrdersLocal.doneAgrees(shelfOrder, i, d) }
    }
    val note = LocalNoteState.current

    var advancing by remember { mutableStateOf(false) }
    var confirmCancel by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var undo by remember { mutableStateOf<OrderUndoAsk?>(null) }
    var booking by remember { mutableStateOf(false) }
    var tracking by remember { mutableStateOf(false) }
    var leopardsOpen by remember { mutableStateOf(false) }
    var notifying by remember { mutableStateOf(false) }
    /** The bar's Check transfer: the transfer's own sheet, as the online section's Transfer received opens it. */
    var checkingTransfer by remember { mutableStateOf(false) }
    /** What that sheet said once the transfer was booked. */
    var told by remember { mutableStateOf<OnlineTold?>(null) }
    // Counted so each event is felt once: money taken.
    var moneyTick by remember { mutableIntStateOf(0) }
    MoneyFeedback(moneyTick, null)

    val invoice: Invoice? = order.invoiceId?.takeIf { it.isNotEmpty() }?.let { rememberShelfItem(book.invoices, it) }
    // What the invoice still has owing, by the hub's own rule (isOwing), so the stage reads the same on both.
    val owed = invoice?.let { if (isOwing(it)) it.balanceDue else 0.0 } ?: 0.0
    val stage = OrdersLocal.stage(stageOf(shelfOrder, owed), OrdersLogic.hasInvoice(shelfOrder), localStatus["status"])
    val now = remember(order, invoice) { AppClock.now() }

    fun setStatus(status: String) {
        localStatus["status"] = status
        if (status == "Cancelled") haptics.warning() else haptics.success()
        note.show(Note(OrdersLocal.said(status), order.id))
        ErpApi.shared.enqueue("setOrderStatus", mapOf("orderId" to order.id, "status" to status), "${order.id} status")
    }

    fun choose(status: String) {
        if (status == order.status.rawValue) return
        if (status == "Cancelled") confirmCancel = true else setStatus(status)
    }

    /** Owners tick a piece done; the last one finishes the order, and unticking a finished one sends it back to the karigars (the server works that out: lib/order-stage.ts). */
    fun tick(index: Int, done: Boolean) {
        localDone[index] = done
        haptics.success()
        ErpApi.shared.enqueue("setPieceDone", mapOf("orderId" to order.id, "index" to index, "done" to done), "${order.id} piece ${index + 1}")
    }

    /** The hub's step, less what the foot of this page should not offer: an invoice only while it is owed (a paid one is the money card's link), the transfer only to the accounts the server lets move it (lib/website/staff-gate.ts). */
    fun barStep(): OrderNextStep? {
        val step = OrdersLogic.nextStep(order, stage, owed) ?: return null
        return when (step) {
            is OrderNextStep.Invoice -> if (step.owed >= 1) step else null
            is OrderNextStep.CheckTransfer -> if (role == "owner" || role == "staff") step else null
            else -> step
        }
    }
    val step = barStep()
    val offersAdvance = OrdersLogic.offersAdvance(order, stage, isOwner)

    fun run(step: OrderNextStep) {
        when (step) {
            // "Only once you see it in the bank": the sheet says what it books and what the customer is told.
            is OrderNextStep.CheckTransfer -> checkingTransfer = true
            OrderNextStep.GiveOut -> navigator.open(OrderPaths.giveOut(order.id))
            OrderNextStep.MarkReady -> setStatus("Completed")
            OrderNextStep.Finalize -> navigator.open(OrderPaths.finalize(order.id))
            is OrderNextStep.Invoice -> {}
        }
    }

    // Changing an order is an owner's, as in the browser, and only until it is invoiced (Unlock & edit is in the menu then).
    ScreenActions {
        if (isOwner && !OrdersLogic.hasInvoice(order)) {
            IconButton(onClick = { navigator.open(OrderPaths.edit(order.id)) }) { Icon(Icons.Filled.Edit, "Edit order") }
        }
        MoreMenu(
            order, stage, step, isOwner, offersAdvance, false,
            onStatus = ::choose,
            onAdvance = { advancing = true },
            onFinalize = { navigator.open(OrderPaths.finalize(order.id)) },
            onSlip = { navigator.open(OrderPaths.slip(order.id)) },
            onMessage = { notifying = true },
            onTrack = { tracking = true },
            onBook = { booking = true },
            onUndo = { undo = it },
            onWeb = { navigator.open(OrderPaths.orderPage(order.id)) },
            // Gold moves: Edit order (before an invoice) or Edit invoice (after), opened at the rates. Owners', as those are.
            onChangeRate = if (isOwner && !OrderActions.isClosed(order)) {
                { navigator.open(if (OrdersLogic.hasInvoice(order)) OrderPaths.invoice(order.invoiceId.orEmpty()) + "/edit?rates=1" else OrderPaths.changeRate(order.id)) }
            } else null,
        )
    }

    Column(Modifier.fillMaxSize()) {
        LazyColumn(
            Modifier.weight(1f).fillMaxWidth(), // the 820 column is PlaceScreen's (readableWidth)
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item("hero") { Hero(order, stage, now, owed, invoice, person) }
            if (noteText(order) != null) item("note") { NoteCard(order) }
            val t = told
            if (t != null) {
                item("told") {
                    Column(Modifier.ledgerCard()) {
                        OrdersStatusLine(if (t.ok) Icons.Filled.CheckCircle else Icons.Filled.Warning, t.words, if (t.ok) Tone.settled else Tone.owed)
                    }
                }
            }
            if (OrdersLogic.isOnline(order)) item("online") { OrderOnlineSection(order, leopards = { leopardsOpen = true }) }
            item("pieces") { Pieces(order, null, isOwner, onGiveOut = { navigator.open(OrderPaths.giveOut(order.id)) }, onTick = ::tick) }
            item("money") {
                if (OrdersLogic.hasInvoice(order)) InvoiceCard(order, invoice, owed, isOwner)
                else MoneyCard(order)
            }
            item("details") { Details(order, isOwner) }
        }
        ActionBar(order, stage, step, offersAdvance, false, onStep = ::run, onAdvance = { advancing = true })
    }

    if (advancing) {
        val balance = OrdersLogic.balance(order)
        // The note is the web's own default; it can be changed, and needs three characters (order-dialogs.tsx).
        PaymentSheet(
            title = "Record an advance",
            onDismiss = { advancing = false },
            onSave = { entry ->
                OrderAdvance.record(order, entry.amount, entry.method, entry.note)
                // PaymentSheet plays the success tap itself.
            },
            owed = if (owesMoney(balance)) balance else null,
            noteDefault = "Advance payment received",
            // Settle gives a remainder under 5,000 off the order's discount (OrderAdvance.settle).
            settle = if (erp.app.auth.LocalSession.current.isOwner) { entry, remainder -> OrderAdvance.settle(order, entry.amount, entry.method, entry.note, remainder) } else null,
        )
    }
    if (booking) OrderCourierSheet(order) { booking = false }
    if (tracking) OrderTrackingSheet(order) { tracking = false }
    if (leopardsOpen) OrderLeopardsSheet(order) { leopardsOpen = false }
    if (notifying) OrderNotifySheet(order, onDismiss = { notifying = false })
    if (checkingTransfer) {
        OnlineMoveSheet(order, OnlineMoveKind.paid, onDismiss = { checkingTransfer = false }) { t ->
            told = t
            moneyTick++
        }
    }
    OrderUndoHost(undo) { undo = null }
    if (confirmCancel) {
        AlertDialog(
            onDismissRequest = { confirmCancel = false },
            title = { Text("Cancel order ${order.id}?") },
            text = { Text(OrdersLogic.cancelWords) },
            confirmButton = { TextButton(onClick = { confirmCancel = false; setStatus("Cancelled") }) { Text("Cancel order", color = Tone.problem.color()) } },
            dismissButton = { TextButton(onClick = { confirmCancel = false }) { Text("Keep it") } },
        )
    }
    FailureAlert(failure, onDismiss = { failure = null }, title = "Not changed")
}

// MARK: Who, what is owed, when, how far

@Composable
private fun Hero(order: Order, stage: OrderStage, now: Instant, owed: Double, invoice: Invoice?, person: String?) {
    val phone = (order.customerContact ?: "").trim()
    Column(Modifier.heroSheen(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Who(order, phone, OrdersLogic.isMine(order, person))
        HeroFigure(order, stage, owed, invoice)
        PromiseRow(order, now)
        StandingRow(order, stage)
        if (OrdersLogic.dialable(phone).isNotEmpty()) ContactActions(phone)
    }
}

@Composable
private fun Who(order: Order, phone: String, mine: Boolean) {
    val name = OrdersLogic.customerName(order)
    val online = OrdersLogic.isOnline(order)
    Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.Top) {
        Monogram(name, size = MonogramSize.hero)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(name, style = ErpType.tileValue, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (phone.isNotEmpty() || online || mine) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (phone.isNotEmpty()) {
                        Text(
                            OrdersLogic.phoneWords(phone),
                            style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits),
                            color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1,
                        )
                    }
                    if (online) OrdersOnlineBadge()
                    if (mine) MineTag()
                }
            }
            Text(caption(order), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** "ORD-12 · taken Tue 6 Oct · by Sana": the order's number first, for finding it again. */
internal fun caption(order: Order): String {
    val parts = arrayListOf(order.id)
    val said = ShopDate.say(order.createdAt)
    if (said.isNotEmpty()) parts.add("taken " + (if (said in listOf("Today", "Yesterday", "Tomorrow")) said.lowercase() else said))
    val by = order.takenBy
    if (!by.isNullOrEmpty()) parts.add("by $by")
    return parts.joinToString(" · ")
}

/** What is still owed, as the page's one big figure (amber), or Paid / In credit in a pill once nothing is. A cancelled or refunded order has no money left to say. */
@Composable
private fun HeroFigure(order: Order, stage: OrderStage, owed: Double, invoice: Invoice?) {
    if (stage == OrderStage.closed) return
    val due = if (OrdersLogic.hasInvoice(order)) (invoice?.balanceDue ?: owed) else OrdersLogic.balance(order)
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (due >= 1) {
            Text(
                "OWED",
                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.6.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            HeroAmount(due, tone = Tone.owed.color())
        } else if (isCredit(due)) {
            Pill("In credit", tone = Tone.credit)
            HeroAmount(-due, tone = Tone.credit.color())
        } else {
            Pill("Paid", tone = Tone.settled, icon = Icons.Filled.Check)
        }
    }
}

/** The promised day as a leaf, and how it is going: red once late, amber on the day and inside the bench week (with "Urgent"), quiet once the order is finished (components/shared/promise-line.tsx). */
@Composable
private fun PromiseRow(order: Order, now: Instant) {
    val t = orderTiming(order, now)
    val p = OrdersLogic.promise(order, now)
    val tone = OrdersTone.promise(p)
    Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        DateLeaf(t.due, tone = tone)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                OrdersLogic.promiseLine(order, now),
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontWeight = if (tone == Tone.quiet) FontWeight.Normal else FontWeight.SemiBold, fontFeatureSettings = TabularDigits,
                ),
                color = if (tone == Tone.late) tone.color() else if (p.undated) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
            )
            if (p.urgent && t.state != PromiseState.late) Pill("Urgent", tone = Tone.owed)
        }
    }
}

/** Booked → Making → Ready → Invoiced; a cancelled or refunded order says so instead. The one place the stage is shown: the status is set from the ⋮ menu. */
@Composable
private fun StandingRow(order: Order, stage: OrderStage) {
    if (stage == OrderStage.closed) {
        Row { Pill(order.status.rawValue.ifEmpty { "Closed" }, tone = Tone.quiet) }
    } else {
        StageTrack(stage, labels = true)
    }
}

// MARK: The note and where it goes

private fun noteText(order: Order): String? = (order.notes ?: "").trim().ifEmpty { null }

@Composable
private fun NoteCard(order: Order) {
    val notes = noteText(order) ?: return
    val shipTo = describeDelivery(order.delivery)
    Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            LabelLine("Note", Icons.Filled.StickyNote2)
            androidx.compose.foundation.text.selection.SelectionContainer { Text(notes, style = MaterialTheme.typography.bodyMedium) }
        }
        if (shipTo.isNotEmpty()) {
            HorizontalDivider(color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.18f))
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                LabelLine("Deliver to", Icons.Filled.LocationOn)
                Text(shipTo.joinToString("\n"), style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
private fun LabelLine(text: String, icon: ImageVector) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(text, style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// MARK: Pieces

@Composable
private fun Pieces(order: Order, ticking: Int?, isOwner: Boolean, onGiveOut: () -> Unit, onTick: (Int, Boolean) -> Unit) {
    val book = LocalBook.current
    val karigars = rememberShelf(book.karigars)
    val invoiced = OrdersLogic.hasInvoice(order)
    val counts = pieceCounts(order.items)
    // Open pieces first; the finished ones follow, quieter. Each keeps its own index for the tick.
    val ordered = order.items.indices.filter { !order.items[it].isCompleted } + order.items.indices.filter { order.items[it].isCompleted }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LedgerHeading("Pieces", count = counts.total, trailing = if (counts.total > 0) "${counts.done} of ${counts.total} done" else null)
        if (counts.total > 0) {
            LinearProgressIndicator(
                progress = { counts.done.toFloat() / counts.total.toFloat() },
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = "${counts.done} of ${counts.total} pieces done" },
                color = if (counts.done == counts.total) Tone.settled.color() else ErpColors.accent,
                trackColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.18f),
            )
        }
        Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            for ((n, i) in ordered.withIndex()) {
                val item = order.items[i]
                if (n > 0) HorizontalDivider(color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.15f))
                val kid = item.karigarId
                val name = if (OrdersLogic.hasKarigar(item) && kid != null) karigars.value.firstOrNull { it.id == kid }?.name ?: "Karigar $kid" else null
                OrderPieceRow(
                    index = i, item = item, karigar = name,
                    canTick = isOwner && !invoiced, busy = ticking == i, showBreakdown = isOwner,
                    onTick = { done -> onTick(i, done) },
                )
            }
            if (order.items.isEmpty()) {
                Text("No pieces on this order.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (counts.unassigned > 0 && !invoiced) {
                TextButton(onClick = onGiveOut, contentPadding = PaddingValues(horizontal = 0.dp, vertical = 8.dp)) {
                    Icon(Icons.Filled.PersonAdd, null, Modifier.size(18.dp))
                    Text("Give out: ${counts.unassigned} without a karigar", Modifier.padding(start = 8.dp))
                }
            }
        }
    }
}

// MARK: Money, while it is the order's

@Composable
private fun MoneyCard(order: Order) {
    val subtotal = OrdersLogic.subtotal(order)
    val discount = OrdersLogic.discount(order)
    val exchangeValue = OrdersLogic.exchangeValue(order)
    val lines = OrdersLogic.advanceLines(order)
    val exchanges = orderExchanges(order)
    val rates = OrdersLogic.rateLine(order)
    // One advance and no exchange is the split's Paid figure already; the line only says more than that.
    val showAdvance = order.advancePayment > 0 && (lines.size > 1 || exchangeValue > 0)
    var open by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LedgerHeading("Money")
        Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            // The page's own sums, so the three always add up: the pieces less the discount, what has come in (the cash
            // advances and the gold taken in exchange: both are payment, decision "Exchange as cash"), and the balance
            // due (OrdersLogic.balance).
            MoneySplit(total = subtotal - discount, paid = order.advancePayment + exchangeValue, due = OrdersLogic.balance(order), paidLabel = "Paid")
            Row(
                Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp).clickable(onClickLabel = if (open) "Hide the breakdown" else "Show the breakdown") { open = !open },
                horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Breakdown", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium))
                Icon(if (open) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (open) {
                MoneyRow("Pieces", subtotal)
                if (discount > 0) MoneyRow("Discount", -discount, signed = true)
                if (showAdvance) MoneyRow("Advance paid", -order.advancePayment, signed = true)
                // Each advance with its day and how it was paid: these become the invoice's payments.
                if (lines.size > 1) for (l in lines) AdvanceLineRow(l)
                if (exchangeValue > 0) MoneyRow("Taken in exchange", -exchangeValue, signed = true)
                for (e in exchanges) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(describeExchangeEntry(e), Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (exchanges.size > 1) Text(Money.pkr(e.value), style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (rates.isNotEmpty()) Text(rates, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                // The shop's margin: owners and staff, never a customer, never in a house that does not cost by gold, and
                // blurred until tapped (docs/decisions.md "Margin").
                if (OrdersLogic.marginIsOn(House.margin)) OrdersMarginRow(order)
            }
        }
    }
}

@Composable
private fun AdvanceLineRow(l: AdvanceLine) {
    val words = listOf(ShopDate.say(l.date), l.method, l.note).filter { it.isNotEmpty() }.joinToString(" · ")
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
        Text(words, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(Money.pkr(l.amount), style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// MARK: Invoiced: the order is locked, the money is the invoice's

@Composable
private fun InvoiceCard(order: Order, invoice: Invoice?, owed: Double, isOwner: Boolean) {
    val navigator = LocalNavigator.current
    val invoiceId = order.invoiceId ?: ""
    val rates = OrdersLogic.rateLine(order)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LedgerHeading("Money")
        Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (invoice != null) MoneySplit(total = invoice.grandTotal, paid = invoice.amountPaid, due = invoice.balanceDue)
            if (rates.isNotEmpty()) Text(rates, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(
                Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp).clickable(onClickLabel = "Open invoice $invoiceId") { navigator.open(OrderPaths.invoice(invoiceId)) },
                horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Description, null, Modifier.size(18.dp), tint = ErpColors.accent)
                Text("Invoiced · $invoiceId", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium), color = ErpColors.accent)
                if (owed >= 1) {
                    Text(
                        Money.pkr(owed) + " owed",
                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits),
                        color = Tone.owed.color(),
                    )
                }
            }
        }
        Text(
            if (OrderActions.canUndoInvoice(order, isOwner)) "To change it, use Unlock & edit." else "The order is locked to its invoice.",
            Modifier.padding(horizontal = 4.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// MARK: Details: the quieter facts

/** Who it is for (their page), who took the order and how they found us; where it goes when there is no note card to hold that; and why it cannot be deleted, when it cannot. */
@Composable
private fun Details(order: Order, isOwner: Boolean) {
    val navigator = LocalNavigator.current
    val cid = order.customerId ?: ""
    val by = order.takenBy ?: ""
    val shipTo = if (noteText(order) == null) describeDelivery(order.delivery) else emptyList()
    val blocked = if (isOwner) OrderActions.deleteBlocked(order) else null
    if (cid.isEmpty() && by.isEmpty() && order.source == null && shipTo.isEmpty() && blocked == null) return
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LedgerHeading("Details")
        Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (cid.isNotEmpty()) {
                Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 32.dp).clickable(onClickLabel = "Open the customer") { navigator.open(OrderPaths.customer(cid)) }) {
                    OrdersLabeled("Customer", OrdersLogic.customerName(order), Modifier.weight(1f))
                }
            }
            if (by.isNotEmpty()) OrdersLabeled("Taken by", by)
            order.source?.let { OrdersLabeled("Found us via", OrdersLogic.sourceLabel(it)) }
            if (shipTo.isNotEmpty()) OrdersLabeled("Deliver to", shipTo.joinToString("\n"))
        }
        if (blocked != null) Text(blocked, Modifier.padding(horizontal = 4.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// MARK: The bar: the next step

/**
 * The order's next step at the foot of the page (OrdersLogic.nextStep, as the hub's card has it), as an invoice's
 * Take payment: one filled button, and an Advance beside it while the order is being made (owners). Nothing for a
 * cancelled or refunded order, or for one invoiced and paid. The buttons sit side by side where they fit and stack
 * where they do not (large text), with their words whole.
 */
@Composable
private fun ActionBar(
    order: Order,
    stage: OrderStage,
    step: OrderNextStep?,
    advance: Boolean,
    updatingStatus: Boolean,
    onStep: (OrderNextStep) -> Unit,
    onAdvance: () -> Unit,
) {
    if (stage == OrderStage.closed || (step == null && !advance)) return
    val navigator = LocalNavigator.current
    val prominent = ButtonDefaults.buttonColors(containerColor = ErpColors.accent, contentColor = ErpColors.onAccent)
    val buttons: @Composable (Modifier) -> Unit = { m ->
        if (step != null) {
            Button(
                onClick = { if (step is OrderNextStep.Invoice) navigator.open(OrderPaths.invoice(step.id)) else onStep(step) },
                enabled = !updatingStatus || step is OrderNextStep.Invoice,
                modifier = m.defaultMinSize(minHeight = 52.dp), colors = prominent,
            ) {
                if (updatingStatus && step == OrderNextStep.MarkReady) {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = ErpColors.onAccent)
                } else {
                    Icon(stepIcon(step), null, Modifier.size(18.dp))
                    Text(step.title, Modifier.padding(start = 8.dp))
                }
            }
            if (advance) {
                OutlinedButton(
                    onClick = onAdvance, modifier = m.defaultMinSize(minHeight = 52.dp).semantics { contentDescription = "Record an advance" },
                ) {
                    Icon(Icons.Filled.Payments, null, Modifier.size(18.dp))
                    Text("Advance", Modifier.padding(start = 8.dp))
                }
            }
        } else {
            Button(onClick = onAdvance, modifier = m.defaultMinSize(minHeight = 52.dp), colors = prominent) {
                Icon(Icons.Filled.Payments, null, Modifier.size(18.dp))
                Text("Record an advance", Modifier.padding(start = 8.dp))
            }
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.12f))
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        if (isLargeText()) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { buttons(Modifier.fillMaxWidth()) }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) { buttons(Modifier.weight(1f)) }
        }
    }
}

// MARK: The ⋮ menu

/**
 * The ⋮ menu in groups: Status, Share, Shipping, More, then what undoes or deletes. The bar's own moves (Advance,
 * Make invoice) are not repeated here.
 */
@Composable
private fun MoreMenu(
    order: Order,
    stage: OrderStage,
    step: OrderNextStep?,
    isOwner: Boolean,
    barOffersAdvance: Boolean,
    updatingStatus: Boolean,
    onStatus: (String) -> Unit,
    onAdvance: () -> Unit,
    onFinalize: () -> Unit,
    onSlip: () -> Unit,
    onMessage: () -> Unit,
    onTrack: () -> Unit,
    onBook: () -> Unit,
    onUndo: (OrderUndoAsk) -> Unit,
    onWeb: () -> Unit,
    onChangeRate: (() -> Unit)? = null,
) {
    var open by remember { mutableStateOf(false) }
    val showAdvance = isOwner && OrdersLogic.canAdvance(order) && !(stage != OrderStage.closed && barOffersAdvance)
    val showFinalize = !OrdersLogic.hasInvoice(order) && (order.status == OrderStatus.completed || order.status == OrderStatus.inProgress) && step != OrderNextStep.Finalize
    val tcs = OrderActions.tcsConsignment(order)
    val canBook = OrderActions.canBookCourier(order, isOwner)
    val canUndo = OrderActions.canUndoInvoice(order, isOwner)
    val canRefund = OrderActions.canRefund(order, isOwner)
    val canDelete = OrderActions.canDelete(order, isOwner)
    fun item(text: String, icon: ImageVector, destructive: Boolean = false, enabled: Boolean = true, onClick: () -> Unit): @Composable () -> Unit = {
        DropdownMenuItem(
            text = { Text(text, color = if (destructive) Tone.problem.color() else androidx.compose.ui.graphics.Color.Unspecified) },
            leadingIcon = { Icon(icon, null, tint = if (destructive) Tone.problem.color() else MaterialTheme.colorScheme.onSurfaceVariant) },
            enabled = enabled,
            onClick = { open = false; onClick() },
        )
    }
    Box {
    IconButton(onClick = { open = true }) { Icon(Icons.Filled.MoreVert, "More") }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
        MenuHeader("Status")
        for (s in OrdersLogic.settableStatuses) {
            DropdownMenuItem(
                text = { Text(s) },
                leadingIcon = if (s == order.status.rawValue) ({ Icon(Icons.Filled.Check, "Current status") }) else null,
                enabled = !updatingStatus,
                onClick = { open = false; onStatus(s) },
            )
        }
        if (showAdvance || showFinalize) {
            HorizontalDivider()
            if (showAdvance) item("Record an advance", Icons.Filled.Payments, onClick = onAdvance)()
            if (showFinalize) item("Make invoice", Icons.Filled.Description, onClick = onFinalize)()
        }
        HorizontalDivider()
        MenuHeader("Share")
        // The workshop slip: printed, saved or sent from the share sheet.
        item("Print slip", Icons.Filled.Print, onClick = onSlip)()
        item("Message the customer", Icons.Filled.Chat, onClick = onMessage)()
        if (tcs != null || canBook) {
            HorizontalDivider()
            MenuHeader("Shipping")
            if (tcs != null) item("Track $tcs", Icons.Filled.Inventory2, onClick = onTrack)()
            if (canBook) item("Book courier", Icons.Filled.LocalShipping, onClick = onBook)()
        }
        HorizontalDivider()
        MenuHeader("More")
        if (onChangeRate != null) item("Change rate", Icons.Filled.Percent, onClick = onChangeRate)()
        if (canUndo) item("Unlock & edit", Icons.Filled.LockOpen) { onUndo(OrderUndo.unlockAndEdit(order)) }()
        // Anything else the page has.
        item("Open in the ERP", Icons.Filled.Public, onClick = onWeb)()
        if (canUndo || canRefund || canDelete) {
            HorizontalDivider()
            if (canUndo) item("Cancel invoice", Icons.Filled.Undo, destructive = true) { onUndo(OrderUndo.undoInvoice(order)) }()
            if (canRefund) item("Refund order", Icons.Filled.Undo, destructive = true) { onUndo(OrderUndo.refund(order)) }()
            if (canDelete) item("Delete order", Icons.Filled.Delete, destructive = true) { onUndo(OrderUndo.delete(order)) }()
        }
    }
    }
}

@Composable
private fun MenuHeader(text: String) {
    Text(
        text, Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
        style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold), color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}
