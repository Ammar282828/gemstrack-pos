package erp.app.screens.orders

import erp.app.ui.icons.Symbols
import erp.app.ui.AppClock
import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.ui.DestructiveFeedback
import erp.app.ui.LedgerHeading
import erp.app.ui.MoneyFeedback
import erp.app.ui.ShopDate
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import erp.core.ERPDate
import erp.core.logic.Money
import erp.core.models.LeopardsMeta
import erp.core.models.Order
import erp.core.models.OrderStatus
import erp.core.models.WebsiteOrderMeta
import erp.core.models.WebsitePaymentStatus
import erp.core.models.WebsiteSlip
import java.time.Instant

/**
 * An online order's own panel (components/order/website-order-panel.tsx): where the money stands, the price hold,
 * the slips the customer sent (each opens), the courier, and the moves. Transfer received and Let it lapse are
 * native (OnlineMoveSheet): both message the customer and the first books money, so each says first, word for
 * word, what goes and to whom, and what it books. Bank details on WhatsApp opens this phone's WhatsApp with the
 * amount written in, as the web's button does; the person sends it. The Leopards moves (book, a CN typed in,
 * tracking, Delivered) are the order page's courier work.
 */
@Composable
fun OrderOnlineSection(order: Order, leopards: () -> Unit, modifier: Modifier = Modifier) {
    val w = order.website ?: return
    val session = LocalSession.current
    val me by session.me.collectAsStateWithLifecycle()
    val role = me?.role ?: "none"
    /** The accounts the server lets move an online order (lib/website/staff-gate.ts). */
    val mayAct = role == "owner" || role == "staff"
    val context = LocalContext.current
    var move by remember { mutableStateOf<OnlineMoveKind?>(null) }
    var slip by remember { mutableStateOf<WebsiteSlip?>(null) }
    var told by remember { mutableStateOf<OnlineTold?>(null) }
    // Counted so a transfer booked, or an order let lapse, is felt once.
    var paidTick by remember { mutableIntStateOf(0) }
    var lapseTick by remember { mutableIntStateOf(0) }
    MoneyFeedback(paidTick, null)
    DestructiveFeedback(lapseTick)

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        LedgerHeading("Online order" + (w.onlineId?.let { " $it" } ?: ""))
        Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            OrdersLabeled("Payment", OrdersLogic.paymentWords(w.paymentStatus), tint = paymentTint(w.paymentStatus))
            told?.let { t ->
                OrdersStatusLine(if (t.ok) Symbols.CheckCircle else Symbols.Warning, t.words, if (t.ok) Tone.settled else Tone.owed)
            }
            order.leopards?.takeIf { it.cn.isNotEmpty() }?.let { Courier(it, context) }
            OrdersLabeled("Placed", ShopDate.say(w.placedAt, withTime = true))
            if (!w.confirmedAt.isNullOrEmpty()) OrdersLabeled("Confirmed", confirmedLine(w, w.confirmedAt!!))
            OrdersLabeled("Customer pays", Money.pkr(OrdersLogic.onlineTotal(order)) + deliveryNote(w))
            order.delivery?.city?.takeIf { it.isNotEmpty() }?.let { OrdersLabeled("City", it) }
            Hold(w)
            for (s in w.slips) SlipRow(order, s, mayAct) { slip = s }
            if (w.slips.isEmpty() && awaitingMoney(order, w)) {
                Text(
                    "No slip yet. People often pay and send the slip on WhatsApp instead: check the bank and the chat.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (mayAct) Moves(order, w, context, onMove = { move = it }, leopards = leopards)
        }
    }

    move?.let { k ->
        OnlineMoveSheet(order, k, onDismiss = { move = null }) { t ->
            told = t
            // The move happened even when the WhatsApp did not go.
            if (k == OnlineMoveKind.paid) paidTick++ else lapseTick++
        }
    }
    slip?.let { s -> OnlineSlipSheet(order.id, s, onDismiss = { slip = null }) }
}

/** Not paid, not lapsed, not cancelled: the money moves are open (the web's `!paid && !lapsed && status !== 'Cancelled'`). */
private fun awaitingMoney(order: Order, w: WebsiteOrderMeta): Boolean =
    w.paymentStatus != WebsitePaymentStatus.transferReceived && w.paymentStatus != WebsitePaymentStatus.expired && order.status != OrderStatus.cancelled

@Composable
private fun Moves(order: Order, w: WebsiteOrderMeta, context: android.content.Context, onMove: (OnlineMoveKind) -> Unit, leopards: () -> Unit) {
    if (awaitingMoney(order, w)) {
        bankDetailsUrl(order, w)?.let { url ->
            // The shop sends its bank details itself (owner, 2026-10-04): the chat, the amount written in.
            MoveButton(Symbols.Send, "Bank details on WhatsApp") { erp.app.device.openAddress(context, Intent.ACTION_VIEW, url) }
        }
        MoveButton(Symbols.Payments, "Transfer received: ${Money.pkr(OrdersLogic.onlineTotal(order))}") { onMove(OnlineMoveKind.paid) }
        MoveButton(Symbols.Block, "Let it lapse", destructive = true) { onMove(OnlineMoveKind.lapse) }
    } else if (w.paymentStatus == WebsitePaymentStatus.transferReceived && (order.leopards?.deliveredAt ?: "").isEmpty()) {
        val shipped = !(order.leopards?.cn ?: "").isEmpty()
        MoveButton(
            if (shipped) Symbols.Inventory2 else Symbols.LocalShipping,
            if (shipped) "Tracking and Delivered" else "Book with Leopards, or enter a CN",
        ) { leopards() }
    }
}

@Composable
private fun MoveButton(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String, destructive: Boolean = false, onClick: () -> Unit) {
    TextButton(onClick = onClick, Modifier.fillMaxWidth(), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 4.dp, vertical = 8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, Modifier.size(18.dp), tint = if (destructive) Tone.problem.color() else ErpColors.accent)
            Text(text, Modifier.weight(1f), color = if (destructive) Tone.problem.color() else ErpColors.accent, textAlign = TextAlign.Start)
        }
    }
}

private fun bankDetailsUrl(order: Order, w: WebsiteOrderMeta): String? {
    val contact = (order.customerContact ?: "").trim()
    val phone = contact.ifEmpty { w.customerPhone ?: "" }
    val ref = if ((w.onlineId ?: "").isEmpty()) order.id else w.onlineId ?: order.id
    return OnlineOrdersLogic.bankDetailsUrl(phone, order.customerName ?: "", ref, OrdersLogic.onlineTotal(order))
}

@Composable
private fun paymentTint(s: WebsitePaymentStatus): Color = when (s) {
    WebsitePaymentStatus.transferReceived -> Tone.settled.color()
    WebsitePaymentStatus.expired, WebsitePaymentStatus.refunded -> MaterialTheme.colorScheme.onSurfaceVariant
    else -> Tone.owed.color()
}

private fun deliveryNote(w: WebsiteOrderMeta): String = if (w.deliveryCharge > 0) " (incl. ${Money.pkr(w.deliveryCharge)} delivery)" else ""

private fun confirmedLine(w: WebsiteOrderMeta, confirmed: String): String {
    var s = ShopDate.say(confirmed, withTime = true)
    OnlineOrdersLogic.who(w.confirmedBy)?.let { s += " by $it" }
    return s
}

@Composable
private fun Courier(l: LeopardsMeta, context: android.content.Context) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Courier", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        val words = (if (l.deliveredAt == null) "Leopards " else "Delivered, Leopards ") + l.cn
        if (l.trackingUrl.isNotEmpty()) {
            Text(
                words,
                Modifier.weight(1.2f).clickable { erp.app.device.openAddress(context, Intent.ACTION_VIEW, l.trackingUrl) },
                style = MaterialTheme.typography.bodyMedium, color = ErpColors.accent, textAlign = TextAlign.End,
            )
        } else {
            Text(words, Modifier.weight(1.2f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.End)
        }
    }
}

/** The price is held for the transfer, until the hold ends. */
@Composable
private fun Hold(w: WebsiteOrderMeta) {
    val until = w.holdUntil ?: return
    val whenEnds = ERPDate.parse(until) ?: return
    if (w.paymentStatus == WebsitePaymentStatus.transferReceived || w.paymentStatus == WebsitePaymentStatus.expired) return
    val ended = !whenEnds.isAfter(AppClock.now())
    val relative = OnlineOrdersLogic.ago(until)
    val tone = if (ended) Tone.late.color() else MaterialTheme.colorScheme.onSurfaceVariant
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
        Icon(Symbols.Schedule, null, Modifier.size(16.dp), tint = tone)
        Text(
            if (ended) "The price hold ended $relative. Check the bank before anything else."
            else "Price held until ${ShopDate.say(until, withTime = true)} ($relative)",
            style = MaterialTheme.typography.bodySmall, color = tone,
        )
    }
}

/** A slip the customer sent: tapped, it opens (owners and staff, as the slip's route is theirs). */
@Composable
private fun SlipRow(order: Order, s: WebsiteSlip, mayAct: Boolean, onOpen: () -> Unit) {
    val amount = s.amount ?: 0.0
    val wrong = amount > 0 && Math.abs(amount - OrdersLogic.onlineTotal(order)) > 0.5
    Column(
        Modifier.fillMaxWidth().then(if (mayAct) Modifier.clickable(onClick = onOpen) else Modifier).padding(vertical = 2.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Symbols.Description, null, Modifier.size(16.dp), tint = if (mayAct) ErpColors.accent else MaterialTheme.colorScheme.onSurface)
            Text(
                "Slip " + ShopDate.say(s.at, withTime = true), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium,
                color = if (mayAct) ErpColors.accent else MaterialTheme.colorScheme.onSurface,
            )
            if (amount > 0) {
                Text(
                    Money.pkr(amount) + if (wrong) " (not the total)" else "",
                    style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits),
                    color = if (wrong) Tone.problem.color() else MaterialTheme.colorScheme.onSurface,
                )
            }
        }
        val detail = listOf(s.fromBank ?: "", if ((s.reference ?: "").isEmpty()) "" else "ref ${s.reference}").filter { it.isNotEmpty() }
        if (detail.isNotEmpty()) {
            Text(detail.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
