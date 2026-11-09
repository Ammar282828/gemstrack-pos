package erp.app.screens.invoices

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import erp.app.auth.LocalSession
import erp.app.config.House
import erp.app.data.Connection
import erp.app.data.ErpApi
import erp.app.ui.BusyLabel
import erp.app.ui.Button
import erp.app.ui.PaymentText
import erp.app.ui.TextButton
import erp.app.ui.TextField
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.rememberHaptics
import erp.app.ui.theme.TabularDigits
import erp.core.logic.Money
import erp.core.logic.SafepayLink
import erp.core.logic.pakistanE164
import erp.core.models.Customer
import erp.core.models.Invoice
import erp.core.models.Order
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

// Payment links by Safepay (owner, 2026-11-09; lib/writes/payment-links.ts, ops-paylinks.ts; the iPhone's SafepayLinkSheet).
// The sheet asks how much, the ERP makes the link, and it goes to the customer by Copy, Share or WhatsApp. The ERP records the
// money itself (an invoice payment or an order advance, by Card) within five minutes of its being paid: the app only refreshes.

/** What the sheet is for: an invoice or an order, what it still owes, and who to send it to. */
data class SafepayRequest(
    /** "invoice" or "order": the write's `target`. */
    val target: String,
    val targetId: String,
    val owed: Double,
    val customerName: String,
    /** The customer's number as the ERP keeps numbers (+92…); empty when there is none. */
    val phone: String,
)

/** The ERP's answer: the link and what it asks for. */
data class SafepayLinkMade(val id: String, val url: String, val amount: Double) {
    companion object {
        fun parse(out: Map<String, Any?>): SafepayLinkMade? {
            val link = out["link"] as? Map<*, *> ?: return null
            val url = (link["url"] as? String)?.takeIf { it.isNotEmpty() } ?: return null
            return SafepayLinkMade(link["id"] as? String ?: "", url, (link["amount"] as? Number)?.toDouble() ?: 0.0)
        }
    }
}

/** Which records offer a Safepay link, and the request each makes. */
object SafepayRequests {
    /** An invoice that is open with something owed, in a house that has Safepay (flags.paymentLinks); null otherwise. */
    fun forInvoice(inv: Invoice, customer: Customer?): SafepayRequest? {
        if (!House.business.offersPaymentLinks) return null
        if (!SafepayLink.offered(inv.status?.rawValue.orEmpty(), inv.balanceDue)) return null
        return SafepayRequest("invoice", inv.id, inv.balanceDue, inv.customerName, InvoiceFacts.whatsAppPhone(inv, customer))
    }

    /**
     * An order: an invoiced one is asked for on its invoice (`invoiceOwed` is that invoice's balance), the rest on the order itself
     * at the balance the order page works out, which includes the delivery charge.
     */
    fun forOrder(order: Order, status: String, invoiceOwed: Double, customer: Customer?): SafepayRequest? {
        if (!House.business.offersPaymentLinks) return null
        val invoiced = erp.app.screens.orders.OrdersLogic.hasInvoice(order)
        val owed = if (invoiced) invoiceOwed else erp.app.screens.orders.OrdersLogic.balance(order)
        if (!SafepayLink.offered(status, owed)) return null
        val own = order.customerContact ?: ""
        val phone = pakistanE164(own.ifEmpty { customer?.phone ?: "" })
        val id = if (invoiced) order.invoiceId.orEmpty().ifEmpty { order.id } else order.id
        return SafepayRequest(if (invoiced) "invoice" else "order", id, owed, order.customerName ?: "", phone)
    }
}

/**
 * The Payment link sheet: the amount (what is owed, to start), then Make the link, then the link with Copy, Share and
 * WhatsApp. Needs the line: a link is made by Safepay, so it is never kept to send later.
 */
@Composable
fun SafepayLinkSheet(request: SafepayRequest, onDismiss: () -> Unit) {
    val session = LocalSession.current
    val context = LocalContext.current
    val haptics = rememberHaptics()
    val scope = rememberCoroutineScope()
    val start = SafepayLink.defaultAmount(request.owed)
    var amountText by rememberSaveable { mutableStateOf(if (start >= 1) PaymentText.field(start) else "") }
    var making by remember { mutableStateOf(false) }
    var made by remember { mutableStateOf<SafepayLinkMade?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var copied by remember { mutableStateOf(false) }

    val amount = PaymentText.amount(amountText) ?: 0.0
    val canMake = SafepayLink.isValidAmount(amount) && !making

    fun make() {
        if (!canMake) return
        if (Connection.isOffline.value) {
            error = "Needs a connection. A payment link is made by Safepay, so it works when you're back online."
            haptics.failure()
            return
        }
        scope.launch {
            making = true
            error = null
            try {
                val out = ErpApi.shared.write(
                    "createPaymentLink",
                    mapOf("target" to request.target, "targetId" to request.targetId, "amount" to Math.round(amount)),
                    queueOffline = false,
                )
                val link = SafepayLinkMade.parse(out)
                if (link == null) {
                    error = "Safepay gave no link. Try again."
                    haptics.failure()
                } else {
                    made = link
                    haptics.success()
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.message ?: e.toString()
                haptics.failure()
            }
            making = false
        }
    }

    val link = made
    val words = link?.let {
        SafepayLink.message(request.customerName, if (it.amount > 0) it.amount else amount, request.targetId, it.url, session.shop.name)
    }

    InvoiceSheet(
        "Payment link", onDismiss, busy = making,
        action = {
            if (link == null) {
                Button(onClick = ::make, enabled = canMake) { BusyLabel(making) { Text("Make the link") } }
            } else {
                TextButton(onClick = onDismiss) { Text("Done") }
            }
        },
    ) {
        if (link == null) {
            TextField(
                value = amountText,
                onValueChange = { amountText = PaymentText.whole(it) },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Amount (PKR)") },
                textStyle = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits),
                singleLine = true,
                enabled = !making,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                supportingText = { if (amount > 0) Text(Money.pkrLac(amount)) },
            )
            if (request.owed >= 1) {
                TextButton(onClick = { amountText = PaymentText.field(start) }, enabled = !making) {
                    Text("All that's owed: ${PaymentText.pkr(request.owed)}")
                }
            }
            Text(
                "The customer pays ${request.targetId} by card on Safepay. It is recorded here by itself within a few minutes.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            Text(
                "Link for ${Money.pkr(if (link.amount > 0) link.amount else amount)}",
                style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            SelectionContainer { Text(link.url, style = MaterialTheme.typography.bodyMedium) }
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = {
                        (context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager)?.setPrimaryClip(ClipData.newPlainText("Payment link", link.url))
                        copied = true
                        haptics.success()
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (copied) "Copied" else "Copy") }
                OutlinedButton(
                    onClick = { erp.app.device.shareText(context, "Payment link ${request.targetId}", words.orEmpty()) },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Share") }
                val whatsApp = words?.let { InvoiceFacts.whatsAppUrl(request.phone, it) }
                if (whatsApp != null) {
                    OutlinedButton(
                        onClick = { erp.app.device.openAddress(context, Intent.ACTION_VIEW, whatsApp) },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("WhatsApp") }
                }
            }
            Text(
                if (words != null && InvoiceFacts.whatsAppUrl(request.phone, words) != null) "WhatsApp opens with the message written: press send there."
                else "There is no WhatsApp number on this record: use Share to pick the chat.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        error?.let { Text(it, color = Tone.problem.color(), style = MaterialTheme.typography.bodyMedium) }
        Spacer(Modifier.height(16.dp))
    }
}
