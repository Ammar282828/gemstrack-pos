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
import erp.app.ui.theme.TabularDigits
import erp.core.logic.Money
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.math.BigDecimal
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale
import kotlin.math.abs
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
)

/** The sheet's numbers and words, kept apart from the view so they read the same wherever they are used. */
object PaymentText {
    // Swift's `.whitespaces`: spaces and tabs, not line breaks.
    private fun isBlank(c: Char) = c == '\t' || Character.getType(c) == Character.SPACE_SEPARATOR.toInt()

    // What Swift's `Double(String)` takes of a typed amount (it also reads hex and "nan", which a decimal pad cannot type).
    private val plainNumber = Regex("""^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$""")

    // Swift's `.rounded()`: a half goes away from zero (Kotlin's `round` goes to even).
    private fun rounded(x: Double): Double {
        if (x < 0) return -rounded(-x)
        val whole = floor(x)
        return if (x - whole >= 0.5) whole + 1 else whole
    }

    /**
     * What was typed, as rupees and paise. Thousands commas are dropped; on a phone set to a region that
     * types its decimal point as a comma ("1500,4") a comma followed by one or two digits is the
     * decimal point, since a thousands comma always has three.
     */
    fun amount(text: String): Double? {
        var t = text.trim(::isBlank)
        if (!t.contains('.')) {
            val comma = t.lastIndexOf(',')
            if (comma >= 0) {
                val after = t.length - comma - 1
                if (after == 1 || after == 2) t = t.substring(0, comma) + "." + t.substring(comma + 1)
            }
        }
        t = t.replace(",", "")
        if (t.isEmpty() || !plainNumber.matches(t)) return null
        val v = t.toDoubleOrNull() ?: return null
        if (!v.isFinite() || v < 0) return null
        return rounded(v * 100) / 100
    }

    /** A balance for the amount field: up to two decimals, no grouping, no trailing zeros ("1500.4"). */
    fun field(v: Double): String {
        var s = BigDecimal(v).setScale(2, RoundingMode.HALF_EVEN).toPlainString()
        while (s.endsWith("0")) s = s.dropLast(1)
        if (s.endsWith(".")) s = s.dropLast(1)
        return s
    }

    /** "PKR 1,500" for whole rupees, "PKR 1,500.4" when paise are owed: Money.pkr would round them away. */
    fun pkr(v: Double): String {
        if (abs(v - rounded(v)) < 0.005) return Money.pkr(v)
        val format = DecimalFormat("#,##0.##", DecimalFormatSymbols(Locale.US)).apply { roundingMode = RoundingMode.HALF_EVEN }
        return "PKR " + format.format(BigDecimal(v.toString()))
    }

    /** What the reference box is for, by how it was paid (the web's labels). */
    fun referenceLabel(method: String): String = when (method) {
        "Cheque" -> "Cheque no."
        "Card" -> "Last 4 digits"
        "Bank Transfer" -> "Reference"
        else -> "Note"
    }

    /** Rupees over the balance, as the web counts them: rounded, and only for an invoice. */
    internal fun over(amount: Double, balance: Double, forInvoice: Boolean): Double =
        if (!forInvoice || amount <= 0) 0.0 else rounded(amount - balance)
}

/**
 * Taking money: an invoice's payment or an order's advance. The amount is typed in rupees (paise allowed) and
 * shown back in lac as it is typed. [onSave] makes the ERP's write; if it throws, the sheet stays open with the
 * exception's message (the ERP's own words) and taps the error; if it returns, the sheet closes with a success tap.
 *
 * - [owed]: what is still owed, offered as the amount with one tap.
 * - [customer]: set for an invoice, since money over the balance is a named customer's credit and a walk-in's is refused.
 * - [noteDefault]: set for an advance (no reference, a note which can be changed but not left bare).
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
) {
    val asksReference = askReference && noteDefault == null
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()

    var amountText by rememberSaveable { mutableStateOf("") }
    // The balance as the books keep it, while the field still shows what "All that's owed" put there:
    // 1500.4 is sent as 1500.4, never as the 1,500 the label would round it to.
    var pinned by remember { mutableStateOf<Pair<String, Double>?>(null) }
    var method by rememberSaveable { mutableStateOf("Cash") }
    var reference by rememberSaveable { mutableStateOf("") }
    var note by rememberSaveable { mutableStateOf(noteDefault ?: "") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val amount = pinned?.takeIf { it.first == amountText }?.second ?: (PaymentText.amount(amountText) ?: 0.0)
    val balance = maxOf(0.0, owed ?: 0.0)
    val over = PaymentText.over(amount, balance, forInvoice = customer != null)

    // Why Save is closed, in the web's words; null when it is open.
    val problem: String? = when {
        customer != null && over > 0 && !customer.canHoldCredit ->
            "More than the balance of ${PaymentText.pkr(balance)}. Credit needs a customer: name who this invoice is for first."
        noteDefault != null && amount > 0 && note.trim().length < 3 -> "Please add a brief note for the payment."
        else -> null
    }
    val creditNote: String? = if (customer != null && customer.canHoldCredit && over > 0) {
        val who = customer.name.trim()
        "${Money.pkr(over)} over the balance stays as credit on ${who.ifEmpty { "the customer" }}'s hisaab."
    } else {
        null
    }

    fun save() {
        scope.launch {
            saving = true
            error = null
            try {
                onSave(PaymentEntry(amount, method, if (method == "Cash") "" else reference, note.trim()))
                haptics.success()
                sheetState.hide()
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
                Button(onClick = ::save, enabled = amount > 0 && problem == null && !saving) {
                    if (saving) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                    else Text("Save")
                }
            }

            OutlinedTextField(
                value = amountText,
                onValueChange = { amountText = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Amount in rupees") },
                textStyle = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits),
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
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
            if (owed != null && owed > 0) {
                TextButton(onClick = {
                    amountText = PaymentText.field(owed)
                    pinned = amountText to owed
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
            // The ERP's words for a refusal show under the form rather than appearing in a jump.
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
            Spacer(Modifier.height(16.dp))
        }
    }
}
