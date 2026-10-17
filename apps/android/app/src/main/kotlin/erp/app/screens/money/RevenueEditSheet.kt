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
import erp.app.ui.rememberHaptics
import erp.core.ERPDate
import erp.core.logic.Money
import erp.core.models.AdditionalRevenue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate

/**
 * Add extra revenue, or Edit on a row: the revenue page's form (src/app/additional-revenue/page.tsx RevenueForm). A
 * date (not after today), a description and an amount of at least 0.01. The ERP writes it (`addExtraRevenue` /
 * `updateExtraRevenue`, lib/writes/expense-admin.ts); an edit changes those three and keeps anything else on the
 * row. Money taken on a repair is never edited here (its row opens the ticket), and the ERP refuses it if asked. The
 * sheet stays open with the ERP's own words if it refuses. [editing] is null to add a new entry.
 */
@Composable
fun RevenueEditSheet(editing: AdditionalRevenue?, onDismiss: () -> Unit, onSaved: (Note) -> Unit) {
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    var picked by remember { mutableStateOf(editing?.let { ERPDate.parse(it.date) } ?: Instant.now()) }
    var what by rememberSaveable { mutableStateOf(editing?.description ?: "") }
    var amountText by rememberSaveable { mutableStateOf(editing?.let { ExpenseEditing.typed(it.amount) } ?: "") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val amount = MoneyParse.rupees(amountText) ?: 0.0
    val cleanedWhat = what.trim()
    val canSave = amount >= 0.01 && cleanedWhat.isNotEmpty() && !saving

    fun save() {
        if (!canSave) return
        saving = true
        error = null
        scope.launch {
            try {
                if (editing != null) {
                    ErpApi.shared.write(
                        "updateExtraRevenue",
                        mapOf(
                            "revenueId" to editing.id,
                            "date" to ExpenseEditing.dateText(picked, editing.date),
                            "description" to cleanedWhat,
                            "amount" to amount,
                        ),
                    )
                    onSaved(Note("Updated", "Revenue entry updated."))
                } else {
                    ErpApi.shared.write("addExtraRevenue", mapOf("date" to ERPDate.iso(picked), "description" to cleanedWhat, "amount" to amount))
                    onSaved(Note("Added", "Revenue entry added."))
                }
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

    MoneySheet(
        if (editing == null) "Add extra revenue" else "Edit extra revenue", onDismiss,
        busy = saving, confirmText = "Save", confirmEnabled = canSave, onConfirm = ::save,
    ) {
        SheetHeading("When and what")
        DayRow("Date", picked.atZone(phoneZone).toLocalDate(), { picked = pickedInstant(it, picked) }, latest = LocalDate.now())
        MoneyField("Description", what, { what = it }, placeholder = "e.g. Commission from partner", singleLine = false, enabled = !saving)
        SheetHeading("How much")
        MoneyField("Amount in rupees", amountText, { amountText = it }, number = true, big = true, enabled = !saving, rupees = true)
        if (amount > 0) Text(Money.pkrLac(amount), color = MaterialTheme.colorScheme.onSurfaceVariant)
        error?.let { ErrorLine(it) }
    }
}
