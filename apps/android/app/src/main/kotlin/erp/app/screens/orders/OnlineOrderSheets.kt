package erp.app.screens.orders

import erp.app.ui.icons.Symbols
import erp.app.ui.Loading
import android.content.Intent
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import erp.app.ui.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import erp.app.ui.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import erp.app.nav.LocalNavigator
import erp.app.ui.LedgerHeading
import erp.app.ui.ShopDate
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import erp.app.data.ErpApi
import erp.core.logic.Money
import erp.core.models.Order
import erp.core.models.WebsiteSlip
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// The confirmations before an online order moves (components/order/online-inbox.tsx's Confirm and Decline dialogs,
// website-order-panel.tsx's MoneyMoves): every one of them messages the customer from the shop's number, and
// Transfer received books money, so each sheet says to whom and, word for word, what goes (the server's preview:
// lib/website/online-preview.ts) before the move is asked of the server (OnlineOrderSheets.swift).

/** Where the WhatsApp goes and what it says, from the server's preview; the web's line while it comes. */
@Composable
fun OnlineMessageSection(preview: OnlinePreview?, problem: String?, fallback: String) {
    val footer = preview?.let { p ->
        if (p.sends) "Sent from the shop's number as soon as you go ahead."
        else "Nothing will be sent (${if (p.to.isEmpty()) "the order has no number" else "this ERP's WhatsApp is off"}): tell ${p.name} yourself."
    }
    OrdersFormSection(title = "WhatsApp to the customer", footer = footer) {
        when {
            preview != null -> {
                OrdersLabeled("To", if (preview.to.isEmpty()) preview.name else "${preview.name} · ${preview.to}")
                androidx.compose.foundation.text.selection.SelectionContainer {
                    Text(preview.text, style = MaterialTheme.typography.bodyMedium)
                }
            }
            problem != null -> {
                Text(fallback, style = MaterialTheme.typography.bodyMedium)
                Text("The exact words could not be read: $problem", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            else -> Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Loading(Modifier.size(24.dp))
                Text("Reading what is sent…", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** The ERP's refusal, in the problem tone. */
@Composable
private fun OnlineFailureSection(message: String?) {
    if (message != null) OrdersFormSection { OrdersStatusLine(Symbols.Warning, message, Tone.problem) }
}

/** The sheet's one big button, pinned under the form. */
@Composable
private fun OnlineBottomButton(
    title: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    busy: Boolean,
    disabled: Boolean,
    destructive: Boolean = false,
    onClick: () -> Unit,
) {
    val colors = if (destructive) ButtonDefaults.buttonColors(containerColor = Tone.problem.color(), contentColor = Color.White)
    else ButtonDefaults.buttonColors(containerColor = ErpColors.accent, contentColor = ErpColors.onAccent)
    Button(onClick = onClick, enabled = !disabled && !busy, modifier = Modifier.fillMaxWidth(), colors = colors) {
        if (busy) Loading(Modifier.size(24.dp), color = colors.contentColor) else Icon(icon, null, Modifier.size(18.dp))
        Text(title, Modifier.padding(start = 8.dp))
    }
}

// MARK: Confirm

/**
 * Confirm: the ORD- order is written (labelled Online, the quoted prices), the price is held and the customer is
 * told on WhatsApp. Then the sheet's second step, as the web's: send the bank details from this phone.
 */
@Composable
fun OnlineConfirmSheet(row: OnlineOrderRow, onDismiss: () -> Unit, openOrder: (String) -> Unit) {
    val context = LocalContext.current
    var preview by remember { mutableStateOf<OnlinePreview?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    /** The server would refuse (confirmed already, declined): Confirm stays shut. */
    var refused by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var confirmed by remember { mutableStateOf<OnlineOrdersStore.Confirmed?>(null) }
    val scope = rememberCoroutineScope()

    val bankUrl = OnlineOrdersLogic.bankDetailsUrl(row.customer.phone, row.customer.name, row.id, row.grandTotal)

    LaunchedEffect(row.id) {
        try {
            preview = OnlineOrdersStore.previewOnline(row.id, "confirm")
        } catch (e: CancellationException) {
            throw e
        } catch (e: erp.app.data.ErpApi.Failure) {
            if (e.status == 409) refused = e.message else problem = e.message
        } catch (e: Exception) {
            problem = ordersSay(e)
        }
    }

    fun confirm() {
        scope.launch {
            busy = true
            failure = null
            try {
                confirmed = OnlineOrdersStore.confirm(row.id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = ordersSay(e)
            }
            busy = false
        }
    }

    OrdersSheet(
        title = confirmed?.let { "${row.id} is ${it.orderId}" } ?: "Confirm ${row.id}?",
        cancelLabel = if (confirmed == null) "Cancel" else "Done",
        onDismiss = onDismiss,
        locked = busy,
        bottom = {
            if (confirmed == null) {
                OnlineBottomButton("Confirm", Symbols.Check, busy, disabled = refused != null || (preview == null && problem == null)) { confirm() }
            } else if (bankUrl != null) {
                OnlineBottomButton("Send bank details on WhatsApp", Symbols.Send, busy = false, disabled = false) {
                    erp.app.device.openAddress(context, Intent.ACTION_VIEW, bankUrl)
                }
            }
        },
    ) { close ->
        val c = confirmed
        if (c == null) {
            OrdersFormSection {
                Text(OnlineOrdersLogic.confirmWords(row, preview?.holdUntil), style = MaterialTheme.typography.bodyMedium)
                OrdersLabeled("Sizes", OnlineOrdersLogic.sizes(row))
                OrdersLabeled("Ships to", row.delivery.city)
                OnlineOrdersLogic.dearerToday(row)?.let { dearer -> OrdersLabeled("Today it would be", Money.pkr(dearer), tint = Tone.owed.color()) }
            }
            if (refused != null) {
                OnlineFailureSection(refused)
            } else {
                OnlineMessageSection(
                    preview, problem,
                    fallback = "${row.customer.name} is told on WhatsApp that it is confirmed and that your bank details are coming, with the price held ${OnlineOrdersLogic.holdHours} hours.",
                )
            }
            OnlineFailureSection(failure)
        } else {
            OrdersFormSection(
                footer = if (bankUrl == null) "There is no WhatsApp number on the order: call them for the transfer."
                else "WhatsApp opens on this phone with the amount and ${row.id} written in. Add your account and press send there.",
            ) {
                val n = c.notified
                if (!n.isNullOrEmpty()) {
                    OrdersStatusLine(Symbols.Warning, "Confirmed, but the WhatsApp telling ${row.customer.name} did not send ($n).", Tone.owed)
                } else {
                    OrdersStatusLine(Symbols.CheckCircle, "${row.customer.name} has been told it is confirmed and that your bank details are coming.", Tone.settled)
                }
                Text(
                    "Send them now: the price is held ${OnlineOrdersLogic.holdWords(preview?.holdUntil)} for ${Money.pkr(row.grandTotal)}.",
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            if (c.orderId.isNotEmpty()) {
                OrdersFormSection {
                    TextButton(onClick = { close(); openOrder(c.orderId) }) {
                        Icon(Symbols.ListAlt, null, Modifier.size(18.dp))
                        Text("Open ${c.orderId}", Modifier.padding(start = 8.dp))
                    }
                }
            }
        }
    }
}

// MARK: Decline

/** Decline: the customer is sent the reason; nothing else is written, and nothing was charged. */
@Composable
fun OnlineDeclineSheet(row: OnlineOrderRow, onDismiss: () -> Unit, done: (OnlineTold) -> Unit) {
    var reason by remember { mutableStateOf("") }
    var preview by remember { mutableStateOf<OnlinePreview?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val trimmed = reason.trim()
    val ready = OnlineOrdersLogic.reasonReady(reason)

    // The words follow the reason as it is typed: asked once the typing pauses.
    LaunchedEffect(trimmed) {
        preview = null
        problem = null
        if (!OnlineOrdersLogic.reasonReady(trimmed)) return@LaunchedEffect
        delay(500)
        try {
            preview = OnlineOrdersStore.previewOnline(row.id, "decline", trimmed)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            problem = ordersSay(e)
        }
    }

    fun decline(close: () -> Unit) {
        scope.launch {
            busy = true
            failure = null
            try {
                val notified = OnlineOrdersStore.decline(row.id, trimmed)
                done(OnlineOrdersLogic.told(notified, row.customer.name, "${row.id} declined: ${row.customer.name} has been told why."))
                close()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = ordersSay(e)
            }
            busy = false
        }
    }

    OrdersSheet(
        title = "Decline ${row.id}",
        onDismiss = onDismiss,
        locked = busy,
        bottom = { close ->
            OnlineBottomButton("Decline & tell them", Symbols.Close, busy, disabled = !ready || (preview == null && problem == null), destructive = true) { decline(close) }
        },
    ) {
        OrdersFormSection {
            Text(
                "${row.customer.name} is sent this on WhatsApp, after “we can't take it as it was placed:”. Nothing has been charged, so nothing needs undoing.",
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        OrdersFormSection(title = "Why") {
            for (r in OnlineOrdersLogic.reasons) {
                Row(
                    Modifier.fillMaxWidth().clickable { reason = r }.padding(vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(r, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                    if (trimmed == r) Icon(Symbols.Check, "Chosen", Modifier.size(18.dp), tint = ErpColors.accent)
                }
            }
            OutlinedTextField(
                value = reason,
                onValueChange = { reason = if (it.length > OnlineOrdersLogic.reasonLimit) it.take(OnlineOrdersLogic.reasonLimit) else it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Why, in a line") },
                minLines = 2,
                maxLines = 5,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
            )
        }
        if (ready) {
            OnlineMessageSection(preview, problem, fallback = "${row.customer.name} is told why on WhatsApp, with the link to their order.")
        }
        OnlineFailureSection(failure)
    }
}

// MARK: Transfer received, Let it lapse

/** A confirmed online order's two money moves (website-order-panel.tsx MoneyMoves): the transfer is in the bank, or nothing came and it lapses. Both tell the customer; the first books the money. */
enum class OnlineMoveKind(val raw: String) { paid("transfer_received"), lapse("lapse") }

@Composable
fun OnlineMoveSheet(order: Order, kind: OnlineMoveKind, onDismiss: () -> Unit, done: (OnlineTold) -> Unit) {
    var preview by remember { mutableStateOf<OnlinePreview?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var refused by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val total = OrdersLogic.onlineTotal(order)
    val ref = order.website?.onlineId ?: order.id
    val name = OrdersLogic.customerName(order)
    val fallback = if (kind == OnlineMoveKind.paid) "$name is told on WhatsApp that the transfer for $ref has come and the piece is being prepared."
    else "$name is told on WhatsApp that $ref is closed because the transfer did not come."

    LaunchedEffect(order.id, kind) {
        try {
            preview = OnlineOrdersStore.previewOrder(order.id, kind.raw)
        } catch (e: CancellationException) {
            throw e
        } catch (e: erp.app.data.ErpApi.Failure) {
            if (e.status == 409) refused = e.message else problem = e.message
        } catch (e: Exception) {
            problem = ordersSay(e)
        }
    }

    fun go(close: () -> Unit) {
        scope.launch {
            busy = true
            failure = null
            try {
                val notified = if (kind == OnlineMoveKind.paid) OnlineOrdersStore.transferReceived(order.id) else OnlineOrdersStore.lapse(order.id)
                val sent = if (kind == OnlineMoveKind.paid) "Transfer received: $name has been told on WhatsApp." else "$ref lapsed: $name has been told on WhatsApp."
                done(OnlineOrdersLogic.told(notified, name, sent))
                close()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = ordersSay(e)
            }
            busy = false
        }
    }

    OrdersSheet(
        title = if (kind == OnlineMoveKind.paid) "${Money.pkr(total)} is in the account?" else "Let $ref lapse?",
        cancelLabel = "Not yet",
        onDismiss = onDismiss,
        locked = busy,
        bottom = { close ->
            OnlineBottomButton(
                if (kind == OnlineMoveKind.paid) "Yes, it is in" else "Let it lapse",
                if (kind == OnlineMoveKind.paid) Symbols.Payments else Symbols.Block,
                busy,
                disabled = refused != null || (preview == null && problem == null),
                destructive = kind == OnlineMoveKind.lapse,
            ) { go(close) }
        },
    ) {
        OrdersFormSection {
            Text(
                if (kind == OnlineMoveKind.paid) "Only once you see it in the bank: a slip is not the money." else "Only once you have checked the bank and nothing came.",
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
            )
            if (kind == OnlineMoveKind.paid) {
                // What Transfer received books: the server's sums once its preview has come, the web's words until then.
                val advance = preview?.booking?.advance ?: order.subtotal
                val delivery = preview?.booking?.deliveryRevenue ?: (order.website?.deliveryCharge ?: 0.0)
                OrdersLabeled("Bank Transfer advance", Money.pkr(advance))
                if (delivery > 0) OrdersLabeled("Delivery, as extra revenue", Money.pkr(delivery))
                Text("The order is paid in full, $name is told, and it is ready to give out.", style = MaterialTheme.typography.bodyMedium)
            } else {
                Text("The order is cancelled and $name is told it lapsed and can order again at today's rate.", style = MaterialTheme.typography.bodyMedium)
            }
        }
        if (refused != null) OnlineFailureSection(refused) else OnlineMessageSection(preview, problem, fallback)
        OnlineFailureSection(failure)
    }
}

// MARK: A slip

/** A transfer slip the customer sent (/api/website/orders/<id>/slips/<slip>), to check against the bank: a picture shown here, a PDF handed to the share sheet to open. */
@Composable
fun OnlineSlipSheet(orderId: String, slip: WebsiteSlip, onDismiss: () -> Unit) {
    val context = LocalContext.current
    var bitmap by remember { mutableStateOf<androidx.compose.ui.graphics.ImageBitmap?>(null) }
    var pdf by remember { mutableStateOf<ByteArray?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(orderId, slip.id) {
        val path = "/api/website/orders/${OnlineOrdersLogic.component(orderId)}/slips/${OnlineOrdersLogic.component(slip.id)}"
        try {
            val data = ErpApi.shared.bytes(path, timeoutMs = 60_000)
            val picture = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) { BitmapFactory.decodeByteArray(data, 0, data.size) }
            if (picture != null) {
                bitmap = picture.asImageBitmap()
            } else {
                // Written to the share cache only when opened; the sheet's viewer picker shows it.
                pdf = data
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failure = OnlineOrdersStore.say(e)
        }
    }

    OrdersSheet(title = "Slip " + ShopDate.say(slip.at, withTime = true), cancelLabel = "Done", onDismiss = onDismiss) {
        val shown = bitmap
        val file = pdf
        when {
            shown != null -> Image(shown, "The transfer slip", Modifier.fillMaxWidth(), contentScale = ContentScale.FillWidth)
            file != null -> OrdersFormSection(title = "A PDF slip", footer = "Open it from the share sheet.") {
                OutlinedButton(
                    onClick = {
                        erp.app.device.viewFile(context, file, "$orderId-slip.pdf", "application/pdf", "Open the PDF")
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Symbols.Description, null, Modifier.size(18.dp))
                    Text("Open the PDF", Modifier.padding(start = 8.dp))
                }
            }
            failure != null -> OrdersFormSection(title = "The slip did not open") { OrdersStatusLine(Symbols.Warning, failure ?: "", Tone.problem) }
            else -> erp.app.ui.SkeletonLoading(Modifier.fillMaxWidth())
        }
    }
}
