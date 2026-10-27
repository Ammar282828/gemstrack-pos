package erp.app.screens.invoices

import erp.app.ui.icons.Symbols
import erp.app.ui.Loading
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import erp.app.ui.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import erp.app.ui.SegmentedButton
import erp.app.ui.SegmentedButtonDefaults
import erp.app.ui.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import erp.app.auth.LocalSession
import erp.app.config.House
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.rememberShelf
import erp.app.data.rememberShelfStatus
import erp.app.ui.CustomerField
import erp.app.ui.PaymentText
import erp.app.ui.RoundOffChips
import erp.app.ui.RecentCustomers
import erp.app.ui.ShopDate
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.fill
import erp.app.ui.MoneyRow
import erp.app.ui.rememberHaptics
import erp.app.ui.theme.TabularDigits
import erp.core.logic.InvoiceActions
import erp.core.logic.Money
import erp.core.logic.balanceLine
import erp.core.logic.rupees
import erp.core.logic.getInvoiceExchangeTotal
import erp.core.logic.isWalkInName
import erp.core.logic.pakistanE164
import erp.core.models.Customer
import erp.core.models.HisaabEntry
import erp.core.models.Invoice
import kotlin.math.abs
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import erp.app.ui.OwnerDeletion
import erp.app.ui.OwnerDeleteCodeSheet

// The invoice page's sheets (InvoiceAction*Sheet.swift, InvoiceCustomerSheet.swift, InvoiceWhatsAppSheet.swift).

/** The discount box: blank is no discount (the page's `parseFloat(…) || 0`); anything else must read as rupees. */
object DiscountText {
    fun parse(text: String): Double? = if (text.isBlank()) 0.0 else PaymentText.amount(text)
}

/** What deleting an invoice takes with it, from the books as the phone has them: the ledger rows are counted once they are read. */
fun deleteDetail(inv: Invoice, invoices: List<Invoice>, hisaab: List<HisaabEntry>?): String {
    val rows = hisaab?.count { it.linkedInvoiceId == inv.id }
    return InvoiceActionWords.deletion(inv, invoices, rows)
}

/** The frame the sheets share: Cancel, the title, and the one confirming action. A sheet that is saving cannot be swiped away. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun InvoiceSheet(
    title: String,
    onDismiss: () -> Unit,
    busy: Boolean = false,
    action: (@Composable () -> Unit)? = null,
    footer: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val working by rememberUpdatedState(busy)
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { !working })
    val scope = rememberCoroutineScope()
    ModalBottomSheet(
        onDismissRequest = { if (!working) onDismiss() },
        sheetState = state,
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().imePadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { if (!working) scope.launch { state.hide(); onDismiss() } }) { Text("Cancel") }
                Text(title, Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center, maxLines = 2)
                if (action != null) action() else Spacer(Modifier.size(64.dp))
            }
            Column(
                Modifier.weight(1f, fill = false).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                content = content,
            )
            if (footer != null) Column(Modifier.fillMaxWidth().padding(16.dp)) { footer() }
        }
    }
}

@Composable
private fun SheetHeading(text: String) {
    Text(text, Modifier.semantics { heading() }, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun Footnote(text: String, tone: Tone = Tone.quiet) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = if (tone == Tone.quiet) MaterialTheme.colorScheme.onSurfaceVariant else tone.color())
}

@Composable
private fun ErrorLine(text: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Symbols.Warning, contentDescription = null, tint = Tone.problem.color())
        Text(text, color = Tone.problem.color(), style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun SaveAction(label: String, saving: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Button(onClick = onClick, enabled = enabled && !saving) {
        if (saving) Loading(Modifier.size(24.dp), color = MaterialTheme.colorScheme.onPrimary) else Text(label)
    }
}

// MARK: Discount

/**
 * Change the discount on a saved invoice (invoice-viewer.tsx's Discount; store `updateInvoiceDiscount`, the shared
 * write lib/writes/invoice-discount.ts). The total becomes the lines less the discount and the exchange; what is
 * owed follows on what has been paid, and the customer's ledger row and the order it came from follow in the same
 * commit. The new figures are worked out here by the ERP's own rule (core InvoiceActions) and agreed to before
 * anything is sent; no delete code, as on the web. An owner's.
 */
@Composable
fun InvoiceDiscountSheet(invoice: Invoice, onDismiss: () -> Unit, onDone: (InvoiceActionOutcome) -> Unit) {
    // Whole rupees: an old invoice's paise are not carried into a box that types only digits.
    var amountText by rememberSaveable { mutableStateOf(if (rupees(invoice.discountAmount) > 0) PaymentText.field(rupees(invoice.discountAmount)) else "") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()

    val discount = DiscountText.parse(amountText)
    val problem = if (discount == null) "Enter the discount." else InvoiceActions.discountProblem(invoice.subtotal, discount)
    val after = if (discount != null && problem == null) InvoiceActions.withDiscount(InvoiceActions.Figures(invoice), discount) else null
    val changed = discount != null && rupees(discount) != rupees(invoice.discountAmount)
    val exchange = getInvoiceExchangeTotal(invoice)

    fun save() {
        val d = discount ?: return
        if (after == null) return
        scope.launch {
            saving = true
            error = null
            try {
                ErpApi.shared.write("updateInvoiceDiscount", InvoiceActionWords.discountFields(invoice, d))
                haptics.success()
                onDone(InvoiceActionOutcome(InvoiceNote("Discount updated", "Discount set to ${PaymentText.pkr(d)}."), removed = false))
                onDismiss()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.message ?: e.toString()
                haptics.failure()
            }
            saving = false
        }
    }

    InvoiceSheet(
        "Change the discount", onDismiss, busy = saving,
        // The figures below are the agreement: Now, After and what follows. This button is the confirm.
        action = { SaveAction("Change", saving, enabled = after != null && changed, onClick = ::save) },
    ) {
        SheetHeading("Now")
        MoneyRow("Subtotal", invoice.subtotal)
        MoneyRow("Discount", invoice.discountAmount)
        if (exchange > 0) MoneyRow("Exchange", -exchange, signed = true)
        MoneyRow("Grand total", invoice.grandTotal)
        if (invoice.amountPaid != 0.0) MoneyRow("Paid", invoice.amountPaid)
        val now = balanceLine(invoice.balanceDue)
        MoneyRow(now.label, now.amount)
        SheetHeading("Discount")
        OutlinedTextField(
            value = amountText,
            onValueChange = { amountText = PaymentText.whole(it) },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Discount in rupees") },
            textStyle = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits),
            singleLine = true,
            enabled = !saving,
            isError = problem != null,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            supportingText = {
                if (problem != null) Text(problem, color = Tone.problem.color())
                else if (discount != null && discount > 0) Text(Money.pkrLac(discount))
            },
        )
        // invoice-viewer.tsx: the bill before any discount is the lines less the exchange.
        RoundOffChips(payable = invoice.subtotal - exchange, discount = discount ?: 0.0) { n ->
            amountText = if (n > 0) PaymentText.field(n) else ""
        }
        if (after != null && changed) {
            SheetHeading("After")
            MoneyRow("Grand total", after.grandTotal, emphasis = true)
            val line = balanceLine(after.balanceDue)
            MoneyRow(line.label, line.amount)
            var said = InvoiceActionWords.ledger(invoice, after.balanceDue)
            invoice.sourceOrderId?.takeIf { it.isNotEmpty() }?.let { said += " Order $it's balance becomes ${PaymentText.pkr(after.balanceDue)}." }
            Footnote(said)
        }
        error?.let { ErrorLine(it) }
        Spacer(Modifier.height(16.dp))
    }
}

// MARK: Give back credit

/**
 * Give a customer their credit back (give-back-credit.tsx; the shared write lib/writes/invoice-credit-payback.ts, op
 * `payBackCredit`; the iPhone's InvoiceActionCreditSheet). An invoice paid past its total leaves the named customer a
 * credit on their hisaab; this hands the money over and brings it down. The amount starts at the whole credit ("finish
 * that credit"); a part is allowed. It is a payment going out, NOT a refund of the sale: no delete code, nothing goes to
 * Shopify, and the sale's revenue is untouched. It shows as money out in Today's cash. A money op: awaited here, never
 * queued (the request's name is kept by `WriteIntents`, so a retry is the same change). An owner's.
 */
@Composable
fun InvoiceCreditSheet(invoice: Invoice, onDismiss: () -> Unit, onDone: (InvoiceActionOutcome) -> Unit) {
    val held = InvoiceCredit.held(invoice)
    var amountText by rememberSaveable { mutableStateOf(PaymentText.field(held)) }
    var method by rememberSaveable { mutableStateOf("Cash") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()

    val amount = PaymentText.amount(amountText) ?: 0.0
    val valid = InvoiceCredit.valid(amount, held)

    fun save() {
        if (!valid || saving) return
        scope.launch {
            saving = true
            error = null
            try {
                erp.app.config.UpdateGate.refuse()
                ErpApi.shared.write("payBackCredit", InvoiceCredit.fields(invoice, amount, method))
                haptics.success()
                onDone(InvoiceActionOutcome(InvoiceCredit.note(amount, held, method), removed = false))
                onDismiss()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.message ?: e.toString()
                haptics.failure()
            }
            saving = false
        }
    }

    InvoiceSheet(
        "Give back credit", onDismiss, busy = saving,
        action = { SaveAction("Give back", saving, enabled = valid, onClick = ::save) },
    ) {
        SheetHeading("${InvoiceActionWords.who(invoice)}'s credit")
        MoneyRow("Credit held", held)
        SheetHeading("Give back")
        OutlinedTextField(
            value = amountText,
            onValueChange = { amountText = PaymentText.whole(it) },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Amount (PKR)") },
            textStyle = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits),
            singleLine = true,
            enabled = !saving,
            isError = amount > held + 0.5,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        )
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            val methods = listOf("Cash", "Bank Transfer")
            methods.forEachIndexed { i, m ->
                SegmentedButton(selected = method == m, onClick = { method = m }, shape = SegmentedButtonDefaults.itemShape(i, methods.size), enabled = !saving) { Text(m) }
            }
        }
        InvoiceCredit.footer(amount, held)?.let { Footnote(it, if (amount > held + 0.5) Tone.problem else Tone.quiet) }
        error?.let { ErrorLine(it) }
        Spacer(Modifier.height(16.dp))
    }
}

// MARK: Delete a payment

/**
 * Delete one payment from an invoice (invoice-viewer.tsx's bin on a payment row; store `deleteInvoicePayment`, the
 * shared write `removeInvoicePayment` in lib/writes/invoice-payment.ts): an advance carried over from the order, a
 * payment taken since, or a partial refund. What is paid is recomputed from what remains, and the customer's ledger
 * row (credit included) and the order's balance follow in the same commit.
 *
 * Pick the payment; the delete code is asked next, saying what the invoice will read after. The ERP refuses if the
 * payment is no longer where this sheet showed it. An owner's.
 */
@Composable
fun InvoicePaymentDeleteSheet(invoice: Invoice, onDismiss: () -> Unit, onDone: (InvoiceActionOutcome) -> Unit) {
    var asking by remember { mutableStateOf<Pair<OwnerDeletion, InvoiceActionOutcome>?>(null) }

    InvoiceSheet("Delete a payment", onDismiss) {
        SheetHeading("Payments on ${invoice.id}")
        invoice.paymentHistory.forEachIndexed { index, p ->
            Row(
                Modifier.fillMaxWidth().defaultMinSize(minHeight = 56.dp).clickable { asking = InvoiceActionWords.deletingPayment(invoice, index, p) },
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(ShopDate.say(p.date, withTime = true))
                    Text(InvoiceActionWords.paymentDetail(p), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text(PaymentText.pkr(p.amount), style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium, fontFeatureSettings = TabularDigits))
                Icon(Symbols.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Footnote("Tap the payment to take off: an advance carried over from the order, a payment, or a refund. The delete code is asked next.")
        Spacer(Modifier.height(16.dp))
    }
    asking?.let { (deletion, outcome) ->
        OwnerDeleteCodeSheet(deletion, onDismiss = { asking = null }, onDone = { onDone(outcome); onDismiss() })
    }
}

// MARK: Delete the invoice

/**
 * Delete the invoice (invoice-viewer.tsx's Delete; store `deleteInvoice(id, false)`, the shared write lib/writes/
 * invoice-delete.ts): a mistake, a sale entered twice. As on the web it goes straight to the delete code, which says
 * first what goes with it: its ledger rows, its pieces back in stock (only those no other invoice sold, never one
 * made for an order), its order's link, and Shopify's copy. The invoice is gone after, so the page should leave
 * (`removed`). An owner's.
 */
@Composable
fun InvoiceDeleteSheet(invoice: Invoice, onDismiss: () -> Unit, onDone: (InvoiceActionOutcome) -> Unit) {
    val book = LocalBook.current
    val invoices by rememberShelf(book.invoices)
    val hisaab = rememberShelfStatus(book.hisaab)
    val invoiceId = invoice.id
    val deletion = OwnerDeletion(
        what = InvoiceActionWords.deleteInvoiceWhat(invoiceId),
        detail = deleteDetail(invoice, invoices, if (hisaab.loaded) hisaab.items else null),
        run = { code -> ErpApi.shared.write("deleteInvoice", InvoiceActionWords.deleteInvoiceFields(invoiceId, code)) },
    )
    OwnerDeleteCodeSheet(deletion, onDismiss = onDismiss, onDone = {
        onDone(
            InvoiceActionOutcome(
                InvoiceNote("Invoice $invoiceId deleted", "Its ledger rows went with it, and pieces only it had sold are back in stock."),
                removed = true,
            ),
        )
    })
}

// MARK: Refund

/**
 * Refund an invoice (invoice-viewer.tsx's Refund dialog), in the dialog's two ways and its words:
 * - **Full refund** deletes the invoice, as Delete does (store `deleteInvoice(id, false)`): its hisaab rows go and
 *   its pieces go back to stock.
 * - **Partial refund** records a negative payment and a matching refund on Shopify; the invoice stays (store
 *   `refundInvoicePartial`, lib/writes/invoice-refund.ts).
 * What changes is said here first, from the ERP's own rules (core InvoiceActions), then the delete code is asked,
 * as the store asks it before either. The ERP refuses a partial refund if the invoice has moved since this sheet
 * worked it out. An owner's; the menu offers it only on an invoice not refunded already.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InvoiceRefundSheet(invoice: Invoice, onDismiss: () -> Unit, onDone: (InvoiceActionOutcome) -> Unit) {
    val book = LocalBook.current
    val invoices by rememberShelf(book.invoices)
    val hisaab = rememberShelfStatus(book.hisaab)
    var full by rememberSaveable { mutableStateOf(true) }
    var amountText by rememberSaveable { mutableStateOf("") }
    var reason by rememberSaveable { mutableStateOf("") }
    var asking by remember { mutableStateOf<Pair<OwnerDeletion, InvoiceActionOutcome>?>(null) }

    val amount = PaymentText.amount(amountText) ?: 0.0
    val said = reason.trim()
    val after = if (!full && amount > 0) InvoiceActions.withRefund(InvoiceActions.Figures(invoice), amount) else null
    val detail = deleteDetail(invoice, invoices, if (hisaab.loaded) hisaab.items else null)

    /** What follows a partial refund: the hisaab while they owe again, Shopify, and the order left as it is. */
    fun partialFollowers(a: InvoiceActions.Paid): String {
        val lines = mutableListOf<String>()
        lines.add(
            if (a.balanceDue >= 1) InvoiceActionWords.ledger(invoice, a.balanceDue)
            else "Nothing is owed on it still; the hisaab is left as it is.",
        )
        if (!invoice.id.startsWith("SHOPIFY-")) lines.add("A refund for the same amount goes to its Shopify order, if it has one.")
        return lines.joinToString(" ")
    }

    fun ask() {
        val invoiceId = invoice.id
        if (full) {
            val outcome = InvoiceActionOutcome(InvoiceNote("Invoice refunded", "Invoice $invoiceId has been deleted and its pieces returned to stock."), removed = true)
            asking = OwnerDeletion(InvoiceActionWords.deleteInvoiceWhat(invoiceId), detail, run = { code ->
                ErpApi.shared.write("deleteInvoice", InvoiceActionWords.deleteInvoiceFields(invoiceId, code))
            }) to outcome
            return
        }
        val a = after ?: return
        val refund = amount
        val why = said
        val seen = InvoiceActionWords.seen(invoice)
        val outcome = InvoiceActionOutcome(InvoiceNote("Partial refund recorded", "${PaymentText.pkr(refund)} refunded on Invoice $invoiceId."), removed = false)
        val words = "${PaymentText.pkr(refund)} goes back to the customer${if (why.isEmpty()) "" else " ($why)"}, recorded on $invoiceId as a negative payment." +
            " Paid becomes ${PaymentText.pkr(a.amountPaid)}; ${InvoiceActionWords.balance(a.balanceDue)}. " + partialFollowers(a)
        asking = OwnerDeletion(InvoiceActionWords.refundWhat(refund, invoiceId), words, run = { code ->
            ErpApi.shared.write("refundInvoicePartial", InvoiceActionWords.partialRefundFields(invoiceId, refund, code, seen, why))
        }) to outcome
    }

    InvoiceSheet(
        "Refund ${invoice.id}", onDismiss,
        // The one action, full width at the foot, in the colour of a thing that cannot be taken back.
        footer = {
            Button(
                onClick = ::ask,
                enabled = full || after != null,
                modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = 52.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Tone.problem.fill(), contentColor = androidx.compose.ui.graphics.Color.White),
            ) {
                Icon(Symbols.Undo, contentDescription = null)
                Spacer(Modifier.size(8.dp))
                Text(if (full) "Yes, refund invoice" else "Record partial refund")
            }
        },
    ) {
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            SegmentedButton(selected = full, onClick = { full = true }, shape = SegmentedButtonDefaults.itemShape(0, 2)) { Text("Full refund") }
            SegmentedButton(selected = !full, onClick = { full = false }, shape = SegmentedButtonDefaults.itemShape(1, 2)) { Text("Partial refund") }
        }
        Footnote(
            if (full) "A full refund deletes the invoice, removes all hisaab entries, and returns all items to stock. This cannot be undone."
            else "A partial refund records a negative payment on this invoice and issues a matching refund on Shopify. The invoice stays in your records.",
        )
        if (full) {
            SheetHeading("What goes")
            Text(detail, style = MaterialTheme.typography.bodyMedium)
            Footnote("Same as Delete: the invoice is removed.")
        } else {
            SheetHeading("Refund")
            OutlinedTextField(
                value = amountText,
                onValueChange = { amountText = PaymentText.whole(it) },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Refund amount (PKR)") },
                placeholder = { Text("e.g. 1500") },
                textStyle = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits),
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                supportingText = {
                    if (amount > 0 && amount > invoice.amountPaid + 0.5) {
                        // The web takes it; said so nobody hands back more than came in by a slip of the keys.
                        Text("More than was paid on it (${PaymentText.pkr(invoice.amountPaid)}).", color = Tone.owed.color())
                    } else if (amount > 0) {
                        Text(Money.pkrLac(amount))
                    }
                },
            )
            OutlinedTextField(
                value = reason,
                onValueChange = { reason = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Reason") },
                placeholder = { Text("e.g. damaged item (optional)") },
                singleLine = true,
            )
            if (after != null) {
                SheetHeading("After")
                MoneyRow("Paid", after.amountPaid)
                val line = balanceLine(after.balanceDue)
                MoneyRow(line.label, line.amount, emphasis = true)
                Footnote(partialFollowers(after))
            }
        }
        Spacer(Modifier.height(16.dp))
    }
    asking?.let { (deletion, outcome) ->
        OwnerDeleteCodeSheet(deletion, onDismiss = { asking = null }, onDone = { onDone(outcome); onDismiss() })
    }
}

// MARK: Who it was for

/**
 * Who a saved sale was for, set on the invoice (components/invoice/set-customer-dialog.tsx; decision "Name a sale"):
 * pick them from the book, or type a new name and a number. The ERP moves the sale's hisaab line to them and
 * re-prices nothing (lib/writes/invoice-customer.ts, `setInvoiceCustomer`). An owner's, as on the web, where it is a
 * Firestore write the shop floor cannot make.
 */
@Composable
fun InvoiceCustomerSheet(invoice: Invoice, onDismiss: () -> Unit, onSaved: (InvoiceNote) -> Unit) {
    val book = LocalBook.current
    val customers by rememberShelf(book.customers)
    val invoices by rememberShelf(book.invoices)
    val orders by rememberShelf(book.orders)
    var name by rememberSaveable { mutableStateOf("") }
    var customerId by rememberSaveable { mutableStateOf<String?>(null) }
    var phone by rememberSaveable { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()

    // Already someone's (not a walk-in, however it was spelled).
    val named = !InvoiceFacts.unnamed(invoice)
    val owes = invoice.balanceDue >= 1
    val typed = name.trim()
    // A person's name, never the walk-in placeholder (the store refuses both).
    val canSave = !saving && typed.isNotEmpty() && !isWalkInName(typed)
    val explanation = (if (named) "${invoice.id} is ${invoice.customerName}'s now." else "${invoice.id} was saved as a walk-in.") +
        " Pick them, or type a new name." + (if (owes) " What is still owed moves to them." else "") +
        " The pieces and prices stay as they are."
    val note = if (customerId != null) "An existing customer." else if (typed.isEmpty()) "" else "A new customer will be made."

    fun save() {
        scope.launch {
            saving = true
            error = null
            try {
                val out = ErpApi.shared.write("setInvoiceCustomer", InvoiceActionWords.customerFields(invoice.id, typed, customerId, pakistanE164(phone)))
                // The name on file when one was picked, which the ERP puts on the invoice over the one typed.
                val saved = ((out["invoice"] as? Map<*, *>)?.get("customerName") as? String) ?: typed
                haptics.success()
                onSaved(
                    InvoiceNote(
                        "${invoice.id} is $saved's",
                        if (owes) "The ${Money.pkr(invoice.balanceDue)} still owed is on their hisaab now." else "Nothing was re-priced.",
                    ),
                )
                onDismiss()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.message ?: e.toString()
                haptics.failure()
            }
            saving = false
        }
    }

    InvoiceSheet(
        if (named) "Change the customer" else "Who was it for?", onDismiss, busy = saving,
        action = { SaveAction("Save", saving, enabled = canSave, onClick = ::save) },
    ) {
        Text(explanation, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        SheetHeading("Customer")
        // The book is offered as the name is typed (customer-autocomplete.tsx); a number typed first finds its
        // customer too. Typing again lets go of a pick.
        CustomerField(
            name = name,
            pickedId = customerId,
            phone = phone,
            book = customers,
            onType = { text -> if (text != name) { name = text; customerId = null } },
            onPhoneChange = { phone = it },
            onPick = { c: Customer? ->
                if (c == null) {
                    // The walk-in row empties the box, and Save stays closed until a person is named.
                    customerId = null; name = ""; phone = ""
                } else {
                    customerId = c.id
                    name = c.name
                    c.phone?.takeIf { it.isNotEmpty() }?.let { phone = it }
                }
            },
            recent = { RecentCustomers.recent(invoices, orders, customers) },
        )
        if (note.isNotEmpty()) Footnote(note)
        error?.let { ErrorLine(it) }
        // Room for the book's suggestions under the name as it is typed.
        Spacer(Modifier.height(240.dp))
    }
}

// MARK: Send on WhatsApp from this phone

/**
 * Send on WhatsApp where the house sends the customer's link from the phone (House of Mina:
 * NEXT_PUBLIC_STORE_INVOICE_WHATSAPP_PDF "0"; invoice-viewer.tsx `openWhatsAppWithLink`): the number in the box, as
 * the ERP page fills it, and the page's own words with the link, written into WhatsApp on this phone. A person still
 * presses send there, so nothing is recorded (the web records only the shop line's PDF send). An invoice without its
 * link's key never reaches here: the ERP's page makes the key as it sends.
 */
@Composable
fun InvoiceWhatsAppSheet(invoice: Invoice, initialPhone: String, onDismiss: () -> Unit) {
    val session = LocalSession.current
    val context = LocalContext.current
    var phone by rememberSaveable { mutableStateOf(initialPhone) }
    val link = InvoiceFacts.shareUrl(invoice, House.serverUrl)
    val text = link?.let { InvoiceFacts.whatsAppText(invoice, it, session.shop.name, session.shop.invoiceByCustomer) }
    val url = text?.let { InvoiceFacts.whatsAppUrl(phone, it) }
    val noNumber = erp.app.ui.toWhatsAppNumber(phone).isEmpty()
    val sent = invoice.sentOnWhatsApp

    InvoiceSheet(
        "Send on WhatsApp", onDismiss,
        footer = {
            Button(
                onClick = {
                    if (url != null) {
                        erp.app.device.openAddress(context, android.content.Intent.ACTION_VIEW, url)
                        onDismiss()
                    }
                },
                enabled = url != null,
                modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = 52.dp),
            ) {
                Icon(Symbols.Message, contentDescription = null)
                Spacer(Modifier.size(8.dp))
                Text("Open WhatsApp")
            }
        },
    ) {
        SheetHeading("WhatsApp number")
        OutlinedTextField(
            value = phone,
            onValueChange = { phone = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("WhatsApp number") },
            placeholder = { Text("0300 1234567") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
        )
        if (noNumber) Footnote("Enter the customer's WhatsApp number.")
        else if (sent != null) Footnote("PDF sent to ${sent.to} · ${ShopDate.say(sent.at, withTime = true)}")
        if (text != null) {
            SheetHeading("The message")
            androidx.compose.foundation.text.selection.SelectionContainer { Text(text, style = MaterialTheme.typography.bodyMedium) }
            Footnote("WhatsApp opens with it written: press send there.")
        }
        Spacer(Modifier.height(16.dp))
    }
}
