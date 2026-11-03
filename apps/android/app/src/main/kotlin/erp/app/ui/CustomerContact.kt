package erp.app.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import erp.app.data.ErpApi
import erp.app.data.ServerShelf
import erp.app.nav.LocalNavigator
import erp.app.ui.icons.Symbols
import erp.core.logic.isWalkInName
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.net.URLEncoder

// The one way the app reaches a customer (lib/customer-contact.ts; App/UI/CustomerContact.swift on the iPhone; owner,
// 2026-11-02: "organize the pdf and whatsapp and phone and messaging for customers properly"). Wherever a customer
// appears, the same actions in this order:
//
//   Call · WhatsApp · Message · [Send PDF on WhatsApp · Share PDF — invoice / order] · Copy number
//
// Send PDF goes from this house's own WhatsApp line through /api/app/whatsapp/send-doc after a dialog that shows the
// number (changeable) and, for an invoice of several pieces, offers one per piece. One number for all of them:
// toWhatsAppNumber (0300… → +92300…). A walk-in is nobody to call: only the document's actions.

/** The links for a number, from the one normaliser. */
object CustomerContactLinks {
    /** "+923001234567", or "" when nothing is dialable. */
    fun e164(phone: String?): String {
        val d = toWhatsAppNumber(phone)
        return if (d.length >= 10) "+$d" else ""
    }

    fun tel(phone: String?): String? = e164(phone).ifEmpty { null }?.let { "tel:$it" }
    fun sms(phone: String?): String? = e164(phone).ifEmpty { null }?.let { "smsto:$it" }
    fun whatsApp(phone: String?, text: String = ""): String? = e164(phone).ifEmpty { null }?.let {
        "https://wa.me/" + it.drop(1) + if (text.isEmpty()) "" else "?text=" + URLEncoder.encode(text, "UTF-8").replace("+", "%20")
    }

    /** The counter's nobody-in-particular: no customer on file and no name, or the walk-in name. */
    fun isWalkIn(customerId: String?, customerName: String?): Boolean {
        val name = (customerName ?: "").trim()
        return customerId.isNullOrBlank() && (name.isEmpty() || isWalkInName(name))
    }
}

/**
 * What the Contact menu offers and in which order (decisions.md "Customer contact"). Pure, so the order is a JVM test:
 * Call, WhatsApp, Message; then Send <noun> PDF on WhatsApp and Share PDF…; then Copy number. No number: "Add phone
 * number" when the customer is on file; a walk-in has only the document's actions.
 */
object ContactMenuPlan {
    enum class Kind { Call, WhatsApp, Message, AddPhone, SendPdf, SharePdf, CopyNumber }
    data class Item(val kind: Kind, val label: String)

    fun items(number: String, walkIn: Boolean, customerId: String?, docNoun: String?): List<Item> = buildList {
        if (number.isNotEmpty()) {
            add(Item(Kind.Call, "Call")); add(Item(Kind.WhatsApp, "WhatsApp")); add(Item(Kind.Message, "Message"))
        } else if (!walkIn && !customerId.isNullOrEmpty()) {
            add(Item(Kind.AddPhone, "Add phone number"))
        }
        if (docNoun != null) {
            add(Item(Kind.SendPdf, "Send $docNoun PDF on WhatsApp")); add(Item(Kind.SharePdf, "Share PDF…"))
        }
        if (number.isNotEmpty()) add(Item(Kind.CopyNumber, "Copy number"))
    }
}

/** An invoice or an order, as the Contact actions send and share it. */
data class CustomerDoc(val kind: Kind, val id: String, val pieces: Int = 1, val fileName: String) {
    enum class Kind(val key: String, val noun: String) { Invoice("invoice", "invoice"), Order("order", "order") }

    /** The ERP route that draws it (lib/app-pdf.ts): the customer's copy, never the workshop slip. */
    val pdfPath: String get() = "/api/app/pdf/${kind.key}/" + Uri.encode(id)
}

/** POST /api/app/whatsapp/send-doc: answers the file's name and the number, masked. */
object CustomerDocSend {
    suspend fun send(doc: CustomerDoc, to: String?, perPiece: Boolean = false): Pair<String, String> {
        val body = buildMap<String, Any?> {
            put("kind", doc.kind.key); put("id", doc.id); put("perPiece", perPiece && doc.kind == CustomerDoc.Kind.Invoice)
            if (!to.isNullOrBlank()) put("to", to)
        }
        // The ERP asks WAHA first whether the number is on WhatsApp, draws the PDF, then sends: two minutes.
        val out = ErpApi.shared.send("/api/app/whatsapp/send-doc", body = body, timeoutMs = 130_000)
        ServerShelf.wake()
        return (out["fileName"] as? String ?: "The PDF") to (out["to"] as? String ?: to.orEmpty())
    }
}

private fun openUri(context: Context, action: String, uri: String?) {
    if (uri == null) return
    try {
        context.startActivity(Intent(action, Uri.parse(uri)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: Exception) {
        // No app on the phone handles it: the button simply did not open anything.
    }
}

private fun copyNumber(context: Context, number: String) {
    (context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager)?.setPrimaryClip(ClipData.newPlainText("Phone", number))
}

/**
 * The row on a hero card: Call, WhatsApp, Message, then the document's Send PDF, then More (Share PDF, Copy number).
 * A page with its own send or PDF screen (the invoice) passes `onSend` / `onShare`; otherwise the row does its own.
 * `onAddPhone` (the customer's edit page) shows "Add phone" when there is no number.
 */
@Composable
fun CustomerContactActions(
    phone: String?,
    modifier: Modifier = Modifier,
    customerId: String? = null,
    customerName: String? = null,
    doc: CustomerDoc? = null,
    onSend: (() -> Unit)? = null,
    onShare: (() -> Unit)? = null,
    onAddPhone: (() -> Unit)? = null,
    sent: ((String) -> Unit)? = null,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val walkIn = CustomerContactLinks.isWalkIn(customerId, customerName)
    val number = if (walkIn) "" else CustomerContactLinks.e164(phone)
    var asking by remember { mutableStateOf(false) }
    var more by remember { mutableStateOf(false) }
    if (number.isEmpty() && doc == null && onAddPhone == null) return

    // Share PDF goes straight to the system share sheet (Print, WhatsApp, Files), never a viewer first.
    val quick = rememberQuickPdf()
    fun share(d: CustomerDoc) {
        if (onShare != null) { onShare(); return }
        quick.share(d.pdfPath, d.fileName, d.fileName)
    }

    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
        if (number.isNotEmpty()) {
            QuickAction("Call", Symbols.Call, { openUri(context, Intent.ACTION_DIAL, CustomerContactLinks.tel(number)) }, Modifier.weight(1f), prominent = doc == null)
            QuickAction("WhatsApp", Symbols.Chat, { openUri(context, Intent.ACTION_VIEW, CustomerContactLinks.whatsApp(number)) }, Modifier.weight(1f))
            QuickAction("Message", Symbols.Sms, { openUri(context, Intent.ACTION_SENDTO, CustomerContactLinks.sms(number)) }, Modifier.weight(1f))
        } else if (!walkIn && onAddPhone != null) {
            QuickAction("Add phone", Symbols.PersonAdd, onAddPhone, Modifier.weight(1f))
        }
        if (doc != null) {
            QuickAction("Send PDF", Symbols.Send, { if (onSend != null) onSend() else asking = true }, Modifier.weight(1f), prominent = true)
        }
        if (doc != null || number.isNotEmpty()) {
            Box(Modifier.weight(1f)) {
                QuickAction("More", Symbols.MoreHoriz, { more = true }, Modifier.fillMaxWidth())
                DropdownMenu(expanded = more, onDismissRequest = { more = false }) {
                    if (doc != null) {
                        DropdownMenuItem(text = { Text("Share ${doc.kind.noun} PDF") }, leadingIcon = { Icon(Symbols.IosShare, null) },
                            onClick = { more = false; share(doc) })
                    }
                    if (number.isNotEmpty()) {
                        DropdownMenuItem(text = { Text("Copy number") }, leadingIcon = { Icon(Symbols.ContentCopy, null) },
                            onClick = { more = false; copyNumber(context, number) })
                    }
                }
            }
        }
    }

    if (asking && doc != null) {
        SendDocDialog(doc, if (number.isNotEmpty()) number else if (walkIn) phone.orEmpty() else "", if (walkIn) null else customerName,
            onDismiss = { asking = false }, sent = { asking = false; sent?.invoke(it) })
    }
    QuickPdfBusy(quick)
}

/**
 * Send the PDF from the shop's line: the number (the one on file, changeable), one per piece for an invoice of several,
 * then Send. A line that isn't connected (503) offers WhatsApp on this phone instead.
 */
@Composable
fun SendDocDialog(doc: CustomerDoc, phone: String, customerName: String?, onDismiss: () -> Unit, sent: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var to by remember(doc.id) { mutableStateOf(phone) }
    var perPiece by remember(doc.id) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var noLine by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Send ${doc.kind.noun} PDF") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("${doc.id} goes as a PDF from the shop’s own WhatsApp number${customerName?.let { " to $it" } ?: ""}.",
                    style = MaterialTheme.typography.bodyMedium)
                TextField(to, { to = it }, Modifier.fillMaxWidth(), singleLine = true, label = { Text("WhatsApp number") },
                    placeholder = { Text("0300 1234567") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    trailingIcon = { ContactPickButton { pick -> if (pick.phone.isNotEmpty()) to = pick.phone } })
                if (doc.kind == CustomerDoc.Kind.Invoice && doc.pieces > 1) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(perPiece, { perPiece = it })
                        Text("One invoice per piece")
                    }
                }
                failure?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && CustomerContactLinks.e164(to).isNotEmpty(), onClick = {
                scope.launch {
                    busy = true
                    failure = null
                    try {
                        val (fileName, masked) = CustomerDocSend.send(doc, to, perPiece)
                        sent("Sent to ${customerName ?: masked}: $fileName")
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: ErpApi.Failure) {
                        if (e.status == 503) noLine = true else failure = e.message
                    } catch (e: Exception) {
                        failure = e.message ?: e.toString()
                    }
                    busy = false
                }
            }) { Text(if (busy) "Sending…" else "Send") }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("Cancel") } },
    )

    if (noLine) {
        AlertDialog(
            onDismissRequest = { noLine = false },
            title = { Text("WhatsApp line not connected") },
            text = { Text("This shop’s WhatsApp line isn’t connected to the ERP. Open WhatsApp on this phone and attach the PDF from Share instead.") },
            confirmButton = {
                TextButton(onClick = { noLine = false; openUri(context, Intent.ACTION_VIEW, CustomerContactLinks.whatsApp(to)) }) { Text("Open WhatsApp") }
            },
            dismissButton = { TextButton(onClick = { noLine = false }) { Text("OK") } },
        )
    }
}

/**
 * The same actions as a menu (the iPhone's `CustomerContactMenu`, web `ContactMenu`): "Contact" with a person icon, for a
 * toolbar, a row's trailing side or a card. Shows nothing when there is nothing to offer.
 */
@Composable
fun CustomerContactMenu(
    phone: String?,
    modifier: Modifier = Modifier,
    customerId: String? = null,
    customerName: String? = null,
    doc: CustomerDoc? = null,
    message: String = "",
) {
    var open by remember { mutableStateOf(false) }
    val walkIn = CustomerContactLinks.isWalkIn(customerId, customerName)
    val number = if (walkIn) "" else CustomerContactLinks.e164(phone)
    if (ContactMenuPlan.items(number, walkIn, customerId, doc?.kind?.noun).isEmpty()) return
    Box(modifier) {
        IconButton(onClick = { open = true }) { Icon(Symbols.AccountCircle, contentDescription = "Contact ${customerName ?: "the customer"}") }
        CustomerContactDropdown(open, { open = false }, phone, customerId, customerName, doc, message)
    }
}

/** The menu's body, for a caller that has its own anchor (a row whose long press or swipe opens it). */
@Composable
fun CustomerContactDropdown(
    expanded: Boolean,
    onDismiss: () -> Unit,
    phone: String?,
    customerId: String? = null,
    customerName: String? = null,
    doc: CustomerDoc? = null,
    message: String = "",
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val navigator = LocalNavigator.current
    val note = LocalNoteState.current
    val walkIn = CustomerContactLinks.isWalkIn(customerId, customerName)
    val number = if (walkIn) "" else CustomerContactLinks.e164(phone)
    var asking by remember { mutableStateOf(false) }
    val quick = rememberQuickPdf()

    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        for (item in ContactMenuPlan.items(number, walkIn, customerId, doc?.kind?.noun)) {
            DropdownMenuItem(
                text = { Text(item.label) },
                leadingIcon = {
                    Icon(
                        when (item.kind) {
                            ContactMenuPlan.Kind.Call -> Symbols.Call
                            ContactMenuPlan.Kind.WhatsApp -> Symbols.Chat
                            ContactMenuPlan.Kind.Message -> Symbols.Sms
                            ContactMenuPlan.Kind.AddPhone -> Symbols.PersonAdd
                            ContactMenuPlan.Kind.SendPdf -> Symbols.Send
                            ContactMenuPlan.Kind.SharePdf -> Symbols.IosShare
                            ContactMenuPlan.Kind.CopyNumber -> Symbols.ContentCopy
                        }, null,
                    )
                },
                onClick = {
                    onDismiss()
                    when (item.kind) {
                        ContactMenuPlan.Kind.Call -> openUri(context, Intent.ACTION_DIAL, CustomerContactLinks.tel(number))
                        ContactMenuPlan.Kind.WhatsApp -> openUri(context, Intent.ACTION_VIEW, CustomerContactLinks.whatsApp(number, message))
                        ContactMenuPlan.Kind.Message -> openUri(context, Intent.ACTION_SENDTO, CustomerContactLinks.sms(number))
                        ContactMenuPlan.Kind.AddPhone -> customerId?.let { navigator.open("/customers/$it/edit") }
                        ContactMenuPlan.Kind.SendPdf -> asking = true
                        ContactMenuPlan.Kind.SharePdf -> doc?.let { d -> quick.share(d.pdfPath, d.fileName, d.fileName) }
                        ContactMenuPlan.Kind.CopyNumber -> copyNumber(context, number)
                    }
                },
            )
        }
    }
    if (asking && doc != null) {
        SendDocDialog(doc, if (number.isNotEmpty()) number else if (walkIn) phone.orEmpty() else "", if (walkIn) null else customerName,
            onDismiss = { asking = false }, sent = { asking = false; note.show(Note(it)) })
    }
    QuickPdfBusy(quick)
}
