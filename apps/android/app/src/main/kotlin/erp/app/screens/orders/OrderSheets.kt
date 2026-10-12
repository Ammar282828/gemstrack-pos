package erp.app.screens.orders

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.LocalShipping
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import erp.app.auth.LocalSession
import erp.app.data.ErpApi
import erp.app.data.ServerShelf
import erp.app.nav.LocalNavigator
import erp.app.ui.Note
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.fill
import erp.app.ui.theme.ErpColors
import erp.app.ui.toWhatsAppNumber
import erp.core.Json
import erp.core.logic.pakistanE164
import erp.core.models.Order
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

// The order page's sheets: the undoing moves behind the delete code (OrderUndoSheets.swift), Book courier
// (OrderCourierSheet), Message the customer (OrderNotifySheet) and Track (OrderTrackingSheet).

// MARK: Undo, refund, delete

/** What follows once the delete code has been taken and the sheet has gone. */
sealed interface OrderThen {
    /** The page's toast. */
    data class Said(val note: Note) : OrderThen

    /** Unlock & edit: the order's edit form, now that it is open again. */
    data class Edit(val id: String) : OrderThen

    /** Delete order: the order is gone, so its screen goes too (the page goes back to /orders). */
    data object Leave : OrderThen
}

class OrderUndoAsk(val deletion: OrdersDeletion, val then: OrderThen)

/** The four asks, each built from the order as the screen shows it. The invoice named is the one on screen: the ERP refuses the undo if the order has been invoiced again since. */
object OrderUndo {
    /** Cancel invoice: the invoice and its hisaab rows go, its pieces stay sold, the order is open again. */
    fun undoInvoice(order: Order): OrderUndoAsk {
        val invoiceId = order.invoiceId ?: ""
        val said = OrderActions.undoneNote(order, invoiceId)
        return OrderUndoAsk(
            OrdersDeletion(OrderActions.undoWhat(order), OrderActions.undoDetail(order), run = { code ->
                ErpApi.shared.write("undoOrderInvoice", mapOf("orderId" to order.id, "invoiceId" to invoiceId, "deleteCode" to code))
            }),
            OrderThen.Said(Note(said.first, said.second)),
        )
    }

    /** Unlock & edit: the same write, then the edit form. */
    fun unlockAndEdit(order: Order): OrderUndoAsk {
        val invoiceId = order.invoiceId ?: ""
        return OrderUndoAsk(
            OrdersDeletion(OrderActions.undoWhat(order), OrderActions.unlockDetail(order), run = { code ->
                ErpApi.shared.write("undoOrderInvoice", mapOf("orderId" to order.id, "invoiceId" to invoiceId, "deleteCode" to code))
            }),
            OrderThen.Edit(order.id),
        )
    }

    /** Refund order: Refunded; an invoice deleted with its pieces back in stock, its Shopify order refunded. */
    fun refund(order: Order): OrderUndoAsk {
        val said = OrderActions.refundedNote(order)
        return OrderUndoAsk(
            OrdersDeletion(OrderActions.refundWhat(order), OrderActions.refundDetail(order), run = { code ->
                // The invoice the screen showed (none: ""), so a refund never takes one it did not say.
                ErpApi.shared.write("refundOrder", mapOf("orderId" to order.id, "invoiceId" to (order.invoiceId ?: ""), "deleteCode" to code))
            }),
            OrderThen.Said(Note(said.first, said.second)),
        )
    }

    /** Delete order: with its sample photos; never an invoiced one (the menu says why instead). */
    fun delete(order: Order): OrderUndoAsk = OrderUndoAsk(
        OrdersDeletion(OrderActions.deleteWhat(order), OrderActions.deleteDetail(order), run = { code ->
            ErpApi.shared.write("deleteOrder", mapOf("orderId" to order.id, "deleteCode" to code))
        }),
        OrderThen.Leave,
    )
}

/**
 * The undoing moves' code sheet and what follows each. What follows runs once the sheet has gone: the edit form
 * or going back never start under a closing sheet.
 */
@Composable
fun OrderUndoHost(ask: OrderUndoAsk?, onClear: () -> Unit) {
    var then by remember { mutableStateOf<OrderThen?>(null) }
    val note = erp.app.ui.LocalNoteState.current
    val navigator = LocalNavigator.current
    if (ask != null) {
        OrdersDeleteCodeSheet(
            deletion = ask.deletion,
            onDone = { then = ask.then },
            onDismiss = {
                onClear()
                val next = then
                then = null
                when (next) {
                    is OrderThen.Said -> note.show(next.note)
                    is OrderThen.Edit -> navigator.open(OrderPaths.edit(next.id))
                    OrderThen.Leave -> navigator.back()
                    null -> {}
                }
            },
        )
    }
}

// MARK: Book courier

/**
 * Book courier (the order page's BookCourierDialog / ShopifyCourierOption), the way the shop books TCS: by
 * fulfilling the order in Shopify, which Universal Courier watches to raise the Envio consignment and write the
 * tracking number back. A custom order taken in the shop has no Shopify order, so one is made first, of custom
 * lines only (nothing joins the catalogue, no receipt is sent), and linked to the order by the ERP itself
 * (/api/shopify/push/from-order); then it is fulfilled (/api/shopify/fulfill). Owners only, as both routes are.
 * The sheet says each step before the button is pressed, and what Shopify said after.
 */
@Composable
fun OrderCourierSheet(order: Order, onDismiss: () -> Unit) {
    // Off by default: the email worth sending is the one with a tracking number, and that does not exist until Envio has booked it.
    var notify by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf<String?>(null) }
    var made by remember { mutableStateOf<OrderActions.MadeShopifyOrder?>(null) }
    var sent by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    /** The Shopify order to fulfil: the order's own, or the one just made for it. */
    val linked = made?.id ?: OrderActions.shopifyOrder(order)
    val firstStep = made?.let { "Shopify order #${it.number ?: it.id} created" } ?: OrderActions.courierFirstStep(order)
    val buttonWords = when (busy) {
        "creating" -> "Creating the Shopify order…"
        "fulfilling" -> "Fulfilling…"
        else -> if (sent != null) "Done" else if (linked != null) "Fulfil in Shopify" else "Create and book"
    }

    fun book() {
        if (busy != null) return
        error = null
        scope.launch {
            try {
                var shopifyOrderId = linked
                if (shopifyOrderId == null) {
                    busy = "creating"
                    // The ERP links the Shopify order to this one as it makes it, and never makes a second.
                    val out = ErpApi.shared.send("/api/shopify/push/from-order", body = mapOf("orderId" to order.id))
                    val m = OrderActions.madeShopifyOrder(out) ?: throw OrderActionFailure("Could not create the Shopify order")
                    made = m
                    shopifyOrderId = m.id
                    ServerShelf.wake()
                }
                busy = "fulfilling"
                val out = ErpApi.shared.send("/api/shopify/fulfill", body = mapOf("shopifyOrderId" to shopifyOrderId, "notifyCustomer" to notify))
                sent = OrderActions.fulfilledWords(out)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = ordersSay(e)
            }
            busy = null
        }
    }

    OrdersSheet(
        title = "Book courier",
        onDismiss = onDismiss,
        locked = busy != null,
        bottom = { close ->
            Button(
                onClick = { if (sent != null) close() else book() },
                enabled = busy == null,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = ErpColors.accent, contentColor = ErpColors.onAccent),
            ) {
                if (busy != null) CircularProgressIndicator(Modifier.size(18.dp).padding(end = 0.dp), strokeWidth = 2.dp, color = ErpColors.onAccent)
                Icon(if (sent != null) Icons.Filled.CheckCircle else Icons.Filled.LocalShipping, null, Modifier.padding(start = 8.dp).size(18.dp))
                Text(buttonWords, Modifier.padding(start = 8.dp))
            }
        },
    ) {
        OrdersFormSection {
            Text(
                "Booking happens in Shopify: Universal Courier watches for the fulfilment and raises the Envio consignment.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (!OrderActions.delivering(order)) {
            OrdersFormSection { OrdersStatusLine(Icons.Filled.Warning, OrderActions.noAddressWarning, Tone.owed) }
        }
        OrdersFormSection(title = "What happens") {
            CourierStep(1, firstStep, linked != null)
            CourierStep(2, "Fulfil it in Shopify", sent != null)
            CourierStep(3, "Universal Courier raises the Envio consignment and returns the tracking number", false)
        }
        OrdersFormSection(
            footer = if (notify) "Shopify emails the customer that the order is on its way as soon as it is fulfilled." else "No email goes to the customer from here.",
        ) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Email the customer now — before there is a tracking number", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                Switch(checked = notify, onCheckedChange = { notify = it }, enabled = busy == null && sent == null)
            }
        }
        made?.let { m ->
            val said = OrderActions.madeNote(m)
            OrdersFormSection {
                OrdersStatusLine(Icons.Filled.CheckCircle, said.first, Tone.settled)
                Text(said.second, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        sent?.let { words ->
            OrdersFormSection {
                OrdersStatusLine(Icons.Filled.LocalShipping, "Sent for booking", Tone.settled)
                Text(words, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        error?.let { OrdersFormSection(title = "Could not book") { OrdersStatusLine(Icons.Filled.Warning, it, Tone.problem) } }
    }
}

@Composable
private fun CourierStep(n: Int, words: String, done: Boolean) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
        if (done) {
            Icon(Icons.Filled.CheckCircle, null, Modifier.size(22.dp), tint = Tone.settled.color())
        } else {
            Box(Modifier.size(22.dp).clip(CircleShape).background(MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.15f)), contentAlignment = Alignment.Center) {
                Text("$n", style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Text(
            words, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium,
            color = if (done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
        )
    }
}

// MARK: Message the customer

/**
 * Send to customer (the order page's ⋯ menu, "Notify Customer via WhatsApp"): the order's summary written into
 * WhatsApp on this phone, at the number in the box (the order's own to start with, as the page fills it). A person
 * presses send there, so nothing goes from the shop's line and nothing is recorded, as on the web. The words are
 * lib/order-message.ts's, shown in full before WhatsApp opens.
 */
@Composable
fun OrderNotifySheet(order: Order, onDismiss: () -> Unit, kind: OrderActions.MessageKind = OrderActions.MessageKind.summary) {
    val session = LocalSession.current
    val context = LocalContext.current
    var phone by remember { mutableStateOf(pakistanE164(order.customerContact ?: "")) }
    val text = OrderActions.customerMessage(order, kind, session.shop.name)
    val number = toWhatsAppNumber(phone)
    val url = if (number.isEmpty()) null else "https://wa.me/$number?text=${OnlineOrdersLogic.component(text)}"

    OrdersSheet(
        title = "Message the customer",
        onDismiss = onDismiss,
        bottom = { close ->
            Button(
                onClick = { url?.let { ordersOpen(context, Intent.ACTION_VIEW, it); close() } },
                enabled = url != null,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = ErpColors.accent, contentColor = ErpColors.onAccent),
            ) {
                Icon(Icons.Filled.Chat, null, Modifier.size(18.dp))
                Text("Send message", Modifier.padding(start = 8.dp))
            }
        },
    ) {
        OrdersFormSection(
            title = "Customer's WhatsApp number",
            footer = if (number.isEmpty()) "Please enter the customer's phone number."
            else if (kind == OrderActions.MessageKind.summary) "Would you like to send a summary of this order to the customer?"
            else "The order status has been updated. Would you like to send a notification?",
        ) {
            OutlinedTextField(
                value = phone, onValueChange = { phone = it }, modifier = Modifier.fillMaxWidth(), singleLine = true,
                label = { Text("WhatsApp number") }, placeholder = { Text("0300 1234567") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            )
        }
        OrdersFormSection(title = "The message", footer = "WhatsApp opens with it written: press send there.") {
            androidx.compose.foundation.text.selection.SelectionContainer {
                Text(text, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

// MARK: Track

/**
 * Track (the order page's ⋯ menu, "Track <CN>", when the order has a TCS consignment): TCS asked where the parcel
 * is (/api/tcs, action track), read as the page reads it: the summary, the first five checkpoints and the full
 * tracking on TCS's own site. Asked as the sheet opens and again on Refresh; nothing is written.
 */
@Composable
fun OrderTrackingSheet(order: Order, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val cn = OrderActions.tcsConsignment(order) ?: ""
    var track by remember { mutableStateOf<OrderActions.TCSTrack?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    var asking by remember { mutableStateOf(false) }
    var attempt by remember { mutableStateOf(0) }

    LaunchedEffect(attempt) {
        if (asking || cn.isEmpty()) return@LaunchedEffect
        asking = true
        failure = null
        try {
            val out = ErpApi.shared.send("/api/tcs", body = mapOf("action" to "track", "consignmentNo" to cn))
            val r = OrderActions.tcsTrack(out)
            r.getOrNull()?.let { track = it }
            r.exceptionOrNull()?.let { failure = it.message }
        } catch (e: CancellationException) {
            throw e
        } catch (e: ErpApi.Failure) {
            // The ERP's own words: TCS not set up, or what TCS refused. No answer at all is the page's words.
            failure = if (e.status == 0) "Could not reach TCS API." else e.message
        } catch (e: Exception) {
            failure = "Could not reach TCS API."
        }
        asking = false
    }

    OrdersSheet(
        title = "Track $cn",
        onDismiss = onDismiss,
        trailing = {
            IconButton(onClick = { attempt++ }, enabled = !asking) { Icon(Icons.Filled.Refresh, "Refresh") }
        },
    ) {
        if (asking && track == null && failure == null) {
            OrdersFormSection {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    Text("Asking TCS…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        failure?.let { OrdersFormSection(title = "Tracking failed") { OrdersStatusLine(Icons.Filled.Warning, it, Tone.problem) } }
        track?.let { t ->
            OrdersFormSection(title = "TCS tracking — $cn") {
                Text(t.summary, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                for (c in t.checkpoints) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                        Text(c.datetime, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(c.status, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
        if (cn.isNotEmpty()) {
            OrdersFormSection {
                TextButton(onClick = { ordersOpen(context, Intent.ACTION_VIEW, OrderActions.tcsUrl(cn)) }) {
                    Icon(Icons.Filled.OpenInNew, null, Modifier.size(18.dp))
                    Text("Full tracking on TCS website", Modifier.padding(start = 8.dp))
                }
            }
        }
    }
}

// MARK: Leopards

private sealed interface LeopardsAsk {
    data object Book : LeopardsAsk
    data class UseCN(val cn: String) : LeopardsAsk
}

/**
 * An online order's courier (components/order/website-order-panel.tsx): Book with Leopards once the transfer is
 * in, or the CN of a packet booked at the counter; then where it is (Refresh) and Mark delivered. Each goes
 * through the page's own route (/api/website/orders/<id>: ship, delivered, and GET for the tracking), which holds
 * Leopards' key and sends WhatsApp from the shop's number; owners and staff, as there.
 *
 * Shipping messages the customer, so it asks first and says so. Afterwards the sheet says what the ERP said:
 * told, or why the message did not go (the booking stands either way). Refresh and Mark delivered message
 * nobody; a packet Leopards calls delivered closes the order, as the route does.
 */
@Composable
fun OrderLeopardsSheet(order: Order, onDismiss: () -> Unit) {
    val context = LocalContext.current
    var cn by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var asking by remember { mutableStateOf<LeopardsAsk?>(null) }
    var said by remember { mutableStateOf<Pair<String, String>?>(null) }
    var track by remember { mutableStateOf<OrderActions.LeopardsTrack?>(null) }
    var shipped by remember { mutableStateOf<String?>(null) }
    var delivered by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    val path = "/api/website/orders/" + OnlineOrdersLogic.component(order.id)
    val customer = (order.customerName ?: "").trim().ifEmpty { "The customer" }
    val customerInSentence = if (customer == "The customer") "the customer" else customer
    /** Booked on file, or just now. */
    val cnOnFile = shipped ?: OrderActions.leopards(order)?.cn

    fun run(title: String, move: suspend () -> String) {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            try {
                val detail = move()
                said = title to detail
                ServerShelf.wake()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = "$title failed: ${ordersSay(e)}"
            }
            busy = false
        }
    }

    fun ship(ask: LeopardsAsk) {
        if (busy) return
        asking = null
        val body = linkedMapOf<String, Any?>("action" to "ship")
        if (ask is LeopardsAsk.UseCN) body["cn"] = ask.cn
        run(if (ask is LeopardsAsk.Book) "Booked with Leopards" else "Shipped") {
            val out = ErpApi.shared.send(path, body = body)
            shipped = OrderActions.shippedCN(out) ?: shipped
            OrderActions.notifiedWords(out)
        }
    }

    fun refresh() = run("Tracking refreshed") {
        val text = ErpApi.shared.data(path)
        @Suppress("UNCHECKED_CAST")
        val out = (Json.parse(text) as? Map<String, Any?>) ?: emptyMap()
        val t = OrderActions.leopardsTrack(out)
        track = t
        // The route closes an order Leopards calls delivered.
        if (t.delivered) delivered = true
        ""
    }

    fun markDelivered() = run("Delivered") {
        ErpApi.shared.send(path, body = mapOf("action" to "delivered"))
        delivered = true
        "The order is Completed."
    }

    OrdersSheet(title = "Leopards", onDismiss = onDismiss, locked = busy) {
        if (cnOnFile == null && OrderActions.canShipLeopards(order)) {
            OrdersFormSection(
                title = "Ship",
                footer = "Or enter a CN booked at the counter. Either way $customerInSentence is sent the tracking number on WhatsApp.",
            ) {
                Button(
                    onClick = { asking = LeopardsAsk.Book }, enabled = !busy, modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = ErpColors.accent, contentColor = ErpColors.onAccent),
                ) {
                    Icon(Icons.Filled.LocalShipping, null, Modifier.size(18.dp))
                    Text("Book with Leopards", Modifier.padding(start = 8.dp))
                }
                OutlinedTextField(
                    value = cn, onValueChange = { cn = it.uppercase() }, modifier = Modifier.fillMaxWidth(), singleLine = true,
                    label = { Text("CN number") }, placeholder = { Text("CN booked at the counter") },
                )
                OutlinedButton(
                    onClick = { asking = LeopardsAsk.UseCN(cn.trim()) },
                    enabled = !busy && OrderActions.cnLooksRight(cn), modifier = Modifier.fillMaxWidth(),
                ) { Text("Use this CN") }
            }
        }
        if (cnOnFile != null) {
            val onFile = OrderActions.leopards(order)
            val done = delivered || !(onFile?.deliveredAt ?: "").isEmpty()
            OrdersFormSection(
                title = if (done) "Delivered" else "Leopards $cnOnFile",
                footer = if (!done) "Mark delivered closes the order as Completed. Neither tells the customer anything." else null,
            ) {
                val tracking = onFile?.trackingUrl ?: ""
                if (tracking.isNotEmpty()) {
                    TextButton(onClick = { ordersOpen(context, Intent.ACTION_VIEW, tracking) }) {
                        Icon(Icons.Filled.OpenInNew, null, Modifier.size(18.dp))
                        Text("Track $cnOnFile on Leopards", Modifier.padding(start = 8.dp))
                    }
                } else {
                    OrdersLabeled("CN", cnOnFile)
                }
                track?.let { t ->
                    Text(t.status, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold))
                    for (line in t.lines) Text(line, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (!done) {
                    OutlinedButton(onClick = { refresh() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Filled.Refresh, null, Modifier.size(18.dp))
                        Text("Refresh", Modifier.padding(start = 8.dp))
                    }
                    OutlinedButton(onClick = { markDelivered() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Filled.CheckCircle, null, Modifier.size(18.dp))
                        Text("Mark delivered", Modifier.padding(start = 8.dp))
                    }
                }
            }
        }
        said?.let { s ->
            OrdersFormSection {
                OrdersStatusLine(Icons.Filled.CheckCircle, s.first, Tone.settled)
                if (s.second.isNotEmpty()) Text(s.second, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        error?.let { OrdersFormSection { OrdersStatusLine(Icons.Filled.Warning, it, Tone.problem) } }
    }

    asking?.let { ask ->
        val title = if (ask is LeopardsAsk.UseCN) "Ship ${order.id} with CN ${ask.cn}?" else "Book ${order.id} with Leopards?"
        val button = if (ask is LeopardsAsk.UseCN) "Use this CN" else "Book with Leopards"
        val told = "$customer is sent the tracking number and its link on WhatsApp from the shop's number."
        val words = if (ask is LeopardsAsk.UseCN) "The order is marked shipped with this CN. $told"
        else "Leopards books the packet to ${order.delivery?.city ?: "the customer's city"}. $told"
        AlertDialog(
            onDismissRequest = { asking = null },
            title = { Text(title) },
            text = { Text(words) },
            confirmButton = { TextButton(onClick = { ship(ask) }) { Text(button) } },
            dismissButton = { TextButton(onClick = { asking = null }) { Text("Not yet") } },
        )
    }
}
