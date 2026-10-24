package erp.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import erp.core.models.ExchangeEntry
import erp.core.logic.Money
import erp.core.logic.ShopNumber
import erp.core.logic.blankExchangeRow
import erp.core.logic.exchangesFromRows
import erp.core.logic.rupees
import erp.core.logic.settleRemainderOffer
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlin.math.floor

/** How money arrived (the ERP's PAYMENT_TYPES), for the payment sheets. */
object PaymentMethods {
    val all = listOf("Cash", "Card", "Bank Transfer", "Cheque")
}

/**
 * Whom a payment on an invoice is for, so the sheet can say what happens to money over the balance
 * (components/invoice/record-payment-dialog.tsx). Left off for advances and repairs, which have no hisaab.
 */
data class PaymentCustomer(
    /** The name on the bill; empty for a sale to nobody in particular. */
    val name: String,
    /** A named customer holds the extra as credit on their hisaab; a walk-in cannot (lib/invoice-credit.ts canHoldCredit). */
    val canHoldCredit: Boolean,
)

/** What the sheet hands back: the screen makes the write (`ErpApi`). */
data class PaymentEntry(
    val amount: Double,
    val method: String,
    /** Empty for cash, whatever was typed before it was switched. */
    val reference: String,
    /** The note an advance is written with; empty where none is asked. */
    val note: String,
    /** Gold handed over with an advance, as `recordOrderAdvance` takes the rows (see `OrderAdvance.exchangeJSON`); empty otherwise. */
    val exchanges: List<Map<String, Any?>> = emptyList(),
)

/** The sheet's numbers and words, kept apart from the view so they read the same wherever they are used. */
object PaymentText {
    // Swift's `.whitespaces`: spaces and tabs, not line breaks.
    // Swift's `.rounded()`: a half goes away from zero (Kotlin's `round` goes to even).
    internal fun rounded(x: Double): Double {
        if (x < 0) return -rounded(-x)
        val whole = floor(x)
        return if (x - whole >= 0.5) whole + 1 else whole
    }

    /**
     * What was typed, in whole rupees (owner, 2026-10-17: "there should be no decimals"), by the one number reader
     * (Urdu and Arabic digits, lakh commas; a comma with one or two digits after it is a decimal point). Paise typed
     * are rounded away, as the ERP rounds every sum to the rupee. Unreadable is null, never 0.
     */
    fun amount(text: String): Double? {
        val v = ShopNumber.parse(text) ?: return null
        return if (v < 0) null else rounded(v)
    }

    /** A balance for the amount field: whole rupees, no grouping ("1500"). */
    fun field(v: Double): String = rounded(v).toLong().toString()

    /** "PKR 1,500": whole rupees, always; an old bill's paise are not shown. */
    fun pkr(v: Double): String = Money.pkr(v)

    /**
     * A money box's text kept to whole rupees: the number pad types only digits, and a pasted or prefilled
     * "1,500.40" becomes "1500". Blank stays blank.
     */
    fun whole(text: String): String {
        if (text.all { it in '0'..'9' }) return text
        val v = amount(text)
        if (v != null && v < 1e15) return field(v)
        return ShopNumber.ascii(text).filter { it in '0'..'9' }
    }

    /** What the reference box is for, by how it was paid (the web's labels). */
    fun referenceLabel(method: String): String = when (method) {
        "Cheque" -> "Cheque no."
        "Card" -> "Last 4 digits"
        "Bank Transfer" -> "Reference"
        else -> "Note"
    }

    /** One exchange row as `recordOrderAdvance` takes it (as the new order sends its rows). */
    fun exchangeJson(e: ExchangeEntry): Map<String, Any?> {
        val o = linkedMapOf<String, Any?>("description" to e.description, "value" to e.value)
        if (!e.karat.isNullOrEmpty()) o["karat"] = e.karat
        if ((e.weightG ?: 0.0) > 0) o["weightG"] = e.weightG
        if ((e.ratePerGram ?: 0.0) > 0) o["ratePerGram"] = e.ratePerGram
        return o
    }

    /** What was recorded, in words: the cash, the gold, or both ("PKR 50,000 cash + PKR 100,000 gold"). */
    fun advanceSaid(amount: Double, exchanges: List<Map<String, Any?>>): String {
        val gold = exchanges.fold(0.0) { s, e -> s + ((e["value"] as? Double) ?: 0.0) }
        if (gold <= 0) return Money.pkr(amount)
        return if (amount > 0) "${Money.pkr(amount)} cash + ${Money.pkr(gold)} gold" else "${Money.pkr(gold)} gold"
    }

    /** Rupees over the balance, as the web counts them: rounded, and only for an invoice. */
    internal fun over(amount: Double, balance: Double, forInvoice: Boolean): Double =
        if (!forInvoice || amount <= 0) 0.0 else rounded(amount - balance)
}

/**
 * Taking money: an invoice's payment or an order's advance. The amount is typed in whole rupees (no paise) and
 * shown back in lac as it is typed. [onSave] makes the ERP's write; if it throws, the sheet stays open with the
 * exception's message (the ERP's own words) and taps the error; if it returns, the sheet closes with a success tap.
 *
 * - [owed]: what is still owed, offered as the amount with one tap.
 * - [customer]: set for an invoice, since money over the balance is a named customer's credit and a walk-in's is refused.
 * - [noteDefault]: set for an advance (no reference, a note which can be changed but not left bare).
 * - [settle]: set where the remainder may be given off (an invoice, for owners: the discount is theirs to change;
 *   an advance): a remainder under 5,000 (what is owed less the amount typed) is offered as "Settle" (record-payment-dialog.tsx
 *   and RecordAdvanceDialog's SettleOffer, core `settleRemainderOffer`). It takes the payment as Save would, then
 *   raises the bill's discount by the remainder, and throws [SettleNotGiven] if the payment went through but the
 *   discount did not.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PaymentSheet(
    title: String,
    onDismiss: () -> Unit,
    onSave: suspend (PaymentEntry) -> Unit,
    owed: Double? = null,
    askReference: Boolean = true,
    customer: PaymentCustomer? = null,
    noteDefault: String? = null,
    settle: (suspend (entry: PaymentEntry, remainder: Double) -> Unit)? = null,
) {
    val asksReference = askReference && noteDefault == null
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()

    var amountText by rememberSaveable { mutableStateOf("") }
    // The balance as whole rupees, while the field still shows what "All that's owed" put there.
    var pinned by remember { mutableStateOf<Pair<String, Double>?>(null) }
    var method by rememberSaveable { mutableStateOf("Cash") }
    var reference by rememberSaveable { mutableStateOf("") }
    var note by rememberSaveable { mutableStateOf(noteDefault ?: "") }
    // An advance may be paid in gold handed over, instead of or beside the cash (AdvanceExchange).
    var exchangeRows by remember { mutableStateOf(listOf(blankExchangeRow())) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // A Settle's payment was taken and its discount refused: nothing more is sent from this sheet.
    var taken by remember { mutableStateOf(false) }

    val amount = pinned?.takeIf { it.first == amountText }?.second ?: (PaymentText.amount(amountText) ?: 0.0)
    val balance = maxOf(0.0, owed ?: 0.0)
    val over = PaymentText.over(amount, balance, forInvoice = customer != null)
    val exchanged = if (noteDefault == null) emptyList() else exchangesFromRows(exchangeRows)
    val exchangeValue = exchanged.fold(0.0) { s, e -> s + e.value }

    // Why Save is closed, in the web's words; null when it is open.
    val problem: String? = when {
        customer != null && over > 0 && !customer.canHoldCredit ->
            "More than the balance of ${PaymentText.pkr(balance)}. Credit needs a customer: name who this invoice is for first."
        exchanged.any { it.value <= 0 } -> "Give each exchange an amount, or its grams and rate."
        noteDefault != null && (amount > 0 || exchangeValue > 0) && note.trim().length < 3 -> "Please add a brief note for the payment."
        else -> null
    }
    val creditNote: String? = if (customer != null && customer.canHoldCredit && over > 0) {
        val who = customer.name.trim()
        "${Money.pkr(over)} over the balance stays as credit on ${who.ifEmpty { "the customer" }}'s hisaab."
    } else {
        null
    }

    // What would be left owing after this amount, when it is small enough to give off (0 < it < 5,000): the web's
    // `rupees(balance) - rupees(amount)`. Null without a Settle, an amount, or a balance.
    val settleOffer: Double? =
        // Gold taken beside it is not offered a Settle (the web's dialog hides it too).
        if (settle == null || taken || owed == null || amount <= 0 || exchangeValue > 0 || problem != null) null
        else settleRemainderOffer(rupees(owed) - rupees(amount))

    // Save, or Settle (`settling` is the remainder to give off): the ERP's write, the sheet kept open with its words
    // on a refusal. A Settle whose payment went through but whose discount did not stays open saying so, with
    // nothing left to send.
    fun send(settling: Double?) {
        if (saving || taken) return
        scope.launch {
            saving = true
            error = null
            try {
                // A cash payment has no reference to carry, whatever was typed before it was switched.
                val entry = PaymentEntry(amount, method, if (method == "Cash") "" else reference, note.trim(), exchanged.map { PaymentText.exchangeJson(it) })
                if (settling != null && settle != null) settle(entry, settling) else onSave(entry)
                haptics.success()
                sheetState.hide()
                onDismiss()
            } catch (e: CancellationException) {
                throw e
            } catch (e: SettleNotGiven) {
                taken = true
                haptics.success()
                error = e.message
            } catch (e: Exception) {
                error = e.message ?: e.toString()
                haptics.failure()
            }
            saving = false
        }
    }

    ModalBottomSheet(
        onDismissRequest = { if (!saving) onDismiss() },
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .navigationBarsPadding()
                .imePadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { if (!saving) scope.launch { sheetState.hide(); onDismiss() } }) { Text("Cancel") }
                Text(
                    title,
                    Modifier.weight(1f).semantics { heading() },
                    style = MaterialTheme.typography.titleMedium,
                    textAlign = TextAlign.Center,
                )
                Button(onClick = { send(null) }, enabled = (amount > 0 || exchangeValue > 0) && problem == null && !saving && !taken) {
                    if (saving) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                    else Text("Save")
                }
            }

            OutlinedTextField(
                value = amountText,
                onValueChange = { amountText = PaymentText.whole(it) },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Amount in rupees") },
                textStyle = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits),
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                isError = problem != null,
                supportingText = {
                    when {
                        problem != null -> Text(problem, color = MaterialTheme.colorScheme.error)
                        creditNote != null -> Text(creditNote, color = Tone.settled.color())
                    }
                },
            )
            if (amount > 0) {
                Text(Money.pkrLac(amount), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (owed != null && owed >= 1) {
                TextButton(onClick = {
                    amountText = PaymentText.field(owed)
                    pinned = amountText to PaymentText.rounded(owed)
                }) { Text("All that's owed: ${PaymentText.pkr(owed)}") }
            }

            Text(
                "How it was paid",
                Modifier.semantics { heading() },
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PaymentMethods.all.forEach { m -> FilterChip(m, chosen = method == m, onClick = { method = m }) }
            }
            if (asksReference && method != "Cash") {
                OutlinedTextField(
                    value = reference,
                    onValueChange = { reference = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text(PaymentText.referenceLabel(method)) },
                    placeholder = { Text("Optional") },
                    singleLine = true,
                )
            }
            if (noteDefault != null) {
                OutlinedTextField(
                    value = note,
                    onValueChange = { note = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Note") },
                    placeholder = { Text("e.g. Second advance payment") },
                    singleLine = true,
                )
            }
            if (noteDefault != null) AdvanceExchange(exchangeRows, { exchangeRows = it })
            settleOffer?.let { x ->
                OutlinedButton(onClick = { send(x) }, enabled = !saving, modifier = Modifier.fillMaxWidth()) {
                    Text(SettleWords.offer(x), color = ErpColors.accent)
                }
                Text(
                    "Takes this payment, then adds ${PaymentText.pkr(x)} to the discount, so nothing is left owing.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            // The ERP's words for a refusal show under the form rather than appearing in a jump.
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
            Spacer(Modifier.height(16.dp))
        }
    }
}
