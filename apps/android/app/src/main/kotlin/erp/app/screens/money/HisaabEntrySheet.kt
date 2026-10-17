package erp.app.screens.money

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import erp.app.data.ErpApi
import erp.app.ui.Note
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.rememberHaptics
import erp.core.logic.Money
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** Which way the money or metal went on a hand-written hisaab row: the ledger page's "You Gave" (a debit: they owe the shop more) and "You Got" (a credit). */
enum class HisaabEntryMode(val raw: String, val title: String) {
    gave("gave", "You gave"), got("got", "You got");

    val tone: Tone get() = if (this == gave) Tone.owed else Tone.settled
}

/**
 * "You gave" / "You got" on one person's ledger (src/app/hisaab/[entityId]/page.tsx `AddTransactionDialog`): a
 * description, and a cash amount and the house's metal in grams, one of which at least must be above 0. A customer's
 * dialog leads with the cash and a karigar's with the metal, as the web's does.
 *
 * The ERP writes the row (`addHisaabEntry`, lib/writes/hisaab-entries.ts, the store's own): dated now and named as the
 * person is on file, so neither is asked for. The sheet stays open with the ERP's words if it refuses.
 */
@Composable
fun HisaabEntrySheet(
    mode: HisaabEntryMode,
    personId: String,
    personName: String,
    isCustomer: Boolean,
    onDismiss: () -> Unit,
    /** Told once the row is written. */
    onSaved: (Note) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    var what by rememberSaveable { mutableStateOf("") }
    var cashText by rememberSaveable { mutableStateOf("") }
    var gramsText by rememberSaveable { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    // The web's number boxes: digits and one dot, two decimals for cash and three for grams.
    val cash = MoneyParse.amount(cashText) ?: 0.0
    val grams = MoneyParse.amount(gramsText, maxDecimals = 3) ?: 0.0
    val cleanedWhat = what.trim()
    val metal = MoneyWords.metal.replaceFirstChar { it.uppercase() }
    // The dialog's schema: a description, and a cash amount or grams above 0.
    val canSave = cleanedWhat.isNotEmpty() && (cash > 0 || grams > 0) && !saving

    fun save() {
        if (!canSave) return
        saving = true
        error = null
        scope.launch {
            try {
                ErpApi.shared.write(
                    "addHisaabEntry",
                    mapOf(
                        "entityId" to personId,
                        "entityType" to if (isCustomer) "customer" else "karigar",
                        "mode" to mode.raw,
                        "description" to cleanedWhat,
                        "amount" to cash,
                        "goldGrams" to grams,
                    ),
                )
                onSaved(Note("New hisaab entry added", "${mode.title}: $cleanedWhat."))
                onDismiss()
                return@launch
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.message ?: e.toString()
                haptics.failure()
            }
            saving = false
        }
    }

    @Composable
    fun CashField() = MoneyField("Cash amount (PKR)", cashText, { cashText = it }, placeholder = "0", number = true, enabled = !saving, rupees = true)

    @Composable
    fun GramsField() = MoneyField("$metal (grams)", gramsText, { gramsText = it }, placeholder = "0", number = true, unit = "g", enabled = !saving)

    MoneySheet(mode.title, onDismiss, busy = saving, confirmText = "Save", confirmEnabled = canSave, onConfirm = ::save) {
        SheetHeading(if (isCustomer) "For the customer $personName" else "For the karigar $personName")
        MoneyField(
            "Description", what, { what = it }, placeholder = "e.g. Cash payment received, Sample given",
            singleLine = false, enabled = !saving,
        )
        Text("What you ${if (mode == HisaabEntryMode.gave) "gave" else "got"}", style = MaterialTheme.typography.labelLarge, color = mode.tone.color())
        if (isCustomer) {
            CashField()
            GramsField()
        } else {
            GramsField()
            CashField()
        }
        if (cash > 0) Text(Money.pkrLac(cash), color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            "Enter a cash amount or ${MoneyWords.metal} grams. It is written with today’s date.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        error?.let { ErrorLine(it) }
    }
}
