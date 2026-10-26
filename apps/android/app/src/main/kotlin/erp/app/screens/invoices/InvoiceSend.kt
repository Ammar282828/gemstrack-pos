package erp.app.screens.invoices

import erp.app.ui.Loading
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.unit.dp
import erp.app.auth.LocalSession
import erp.app.config.House
import erp.app.data.LocalBook
import erp.app.data.ServerShelf
import erp.app.data.rememberShelf
import erp.app.ui.ShopDate
import erp.app.ui.rememberHaptics
import erp.app.ui.toWhatsAppNumber
import erp.core.models.Invoice
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** Where Send on WhatsApp goes from a given invoice, by house (STORE_INVOICE_WHATSAPP_PDF); pure, so it is tested. */
sealed interface InvoiceSendPlan {
    /** Taheri: ask first, then the shop's line sends the PDF. */
    data object ConfirmPdf : InvoiceSendPlan

    /** The ERP's page, for a number to be typed (`doing` = what it does as it opens). */
    data class OpenWeb(val doing: String?) : InvoiceSendPlan

    /** House of Mina: the number and the words, then WhatsApp on this phone. */
    data object LinkSheet : InvoiceSendPlan

    companion object {
        fun decide(pdfFromShopLine: Boolean, phone: String, shareUrl: String?): InvoiceSendPlan = when {
            pdfFromShopLine -> if (toWhatsAppNumber(phone).isEmpty()) OpenWeb(null) else ConfirmPdf
            // An invoice from before link keys existed: the ERP page makes its key as it sends.
            shareUrl == null -> OpenWeb("share")
            else -> LinkSheet
        }

        /** Whom it goes to, by name; the number is in the message under it. */
        fun title(inv: Invoice): String {
            val who = InvoiceFacts.customerName(inv, walkIn = "the customer")
            return if (inv.sentOnWhatsApp == null) "Send the PDF to $who?" else "Send the PDF to $who again?"
        }

        /** The number it goes to, what happens, and that it went before (the web shows the send under its button so nobody sends twice). */
        fun words(inv: Invoice, phone: String): String {
            var s = "To $phone. From the shop's own WhatsApp, with what is owed written under it: the PDF Print saves, drawn and sent by the ERP."
            inv.sentOnWhatsApp?.let { s += " Already sent to ${it.to} · ${ShopDate.say(it.at, withTime = true)}." }
            return s
        }

        /** The note the web's toast says for a send that went. */
        fun sentNote(inv: Invoice, fileName: String, to: String): InvoiceNote {
            val name = InvoiceFacts.customerName(inv, walkIn = "")
            return InvoiceNote("Sent to ${name.ifEmpty { to }}", "$fileName — on WhatsApp, from the shop's number.")
        }
    }
}

/**
 * The ERP page's Send via WhatsApp, by house, the same from the invoice page and from a swipe on the list: set
 * [invoice] and it runs ([onStarted] tells the caller it has been taken). Taheri sends the PDF itself from the shop's
 * line: the ERP draws it (Print's PDF), sends it and notes the send on the invoice, so it is asked first and then
 * done from here. With no number on file, or for another number, the ERP's page opens ([openWeb]) for one to be
 * typed. House of Mina writes the message and the customer's link into WhatsApp on this phone
 * ([InvoiceWhatsAppSheet]), unless the invoice predates its link's key, which the page makes as it sends.
 * Place it last in the screen's Box: "Sending the PDF…" rides at the top.
 */
@Composable
fun InvoiceWhatsAppSend(
    invoice: Invoice?,
    onStarted: () -> Unit,
    openWeb: (inv: Invoice, doing: String?) -> Unit,
    sent: (InvoiceNote) -> Unit,
) {
    val book = LocalBook.current
    val session = LocalSession.current
    val customers by rememberShelf(book.customers)
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    var confirming by remember { mutableStateOf<Invoice?>(null) }
    var linking by remember { mutableStateOf<Invoice?>(null) }
    var sending by remember { mutableStateOf(false) }
    var failedOn by remember { mutableStateOf<Invoice?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }

    /** The number the ERP page's box starts with: the invoice's, else its customer's. */
    fun phone(inv: Invoice): String = InvoiceFacts.whatsAppPhone(inv, inv.customerId?.let { id -> customers.firstOrNull { it.id == id } })

    fun start(inv: Invoice) {
        when (val plan = InvoiceSendPlan.decide(session.shop.invoiceWhatsappPdf, phone(inv), InvoiceFacts.shareUrl(inv, House.serverUrl))) {
            InvoiceSendPlan.ConfirmPdf -> confirming = inv
            is InvoiceSendPlan.OpenWeb -> openWeb(inv, plan.doing)
            InvoiceSendPlan.LinkSheet -> linking = inv
        }
    }

    LaunchedEffect(invoice) {
        val picked = invoice ?: return@LaunchedEffect
        onStarted()
        start(picked)
    }

    /** invoice-viewer.tsx `handleSendWhatsApp`: sent, said as its toast says it; refused, the ERP's words. */
    fun sendPdf(inv: Invoice) {
        if (sending) return
        scope.launch {
            sending = true
            try {
                val (fileName, to) = InvoiceFacts.sendPdf(inv, phone(inv))
                // Staff read the books every 25 seconds: fetch them now, so "sent" shows under the button.
                ServerShelf.wake()
                haptics.success()
                sent(InvoiceSendPlan.sentNote(inv, fileName, to))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failedOn = inv
                failure = e.message ?: e.toString()
                haptics.failure()
            }
            sending = false
        }
    }

    confirming?.let { inv ->
        AlertDialog(
            onDismissRequest = { confirming = null },
            title = { Text(InvoiceSendPlan.title(inv)) },
            text = { Text(InvoiceSendPlan.words(inv, phone(inv))) },
            confirmButton = {
                TextButton(onClick = { confirming = null; sendPdf(inv) }) { Text(if (inv.sentOnWhatsApp == null) "Send the PDF" else "Send it again") }
            },
            dismissButton = {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = { confirming = null }) { Text("Cancel") }
                    // The ERP page's box takes another number; its Send goes to whatever is typed there.
                    TextButton(onClick = { confirming = null; openWeb(inv, null) }) { Text("Another number…") }
                }
            },
        )
    }

    // As the web's error toast: the shop's line could not send, so the link can go from this phone instead.
    failure?.let { why ->
        val inv = failedOn
        AlertDialog(
            onDismissRequest = { failure = null; failedOn = null },
            title = { Text("Could not send the PDF") },
            text = { Text(why) },
            confirmButton = { TextButton(onClick = { failure = null; failedOn = null }) { Text("OK") } },
            dismissButton = {
                if (inv != null && InvoiceFacts.shareUrl(inv, House.serverUrl) != null) {
                    TextButton(onClick = { failure = null; failedOn = null; linking = inv }) { Text("Send a link") }
                }
            },
        )
    }

    linking?.let { inv -> InvoiceWhatsAppSheet(inv, phone(inv), onDismiss = { linking = null }) }

    Box(Modifier.fillMaxSize().statusBarsPadding(), contentAlignment = Alignment.TopCenter) {
        AnimatedVisibility(
            visible = sending,
            enter = slideInVertically { -it } + fadeIn(),
            exit = slideOutVertically { -it } + fadeOut(),
        ) {
            Surface(
                Modifier.padding(top = 8.dp),
                shape = androidx.compose.foundation.shape.CircleShape,
                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                shadowElevation = 4.dp,
            ) {
                Row(Modifier.padding(horizontal = 14.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Loading(Modifier.size(20.dp))
                    Text("Sending the PDF…", style = MaterialTheme.typography.labelLarge)
                }
            }
        }
    }
}
