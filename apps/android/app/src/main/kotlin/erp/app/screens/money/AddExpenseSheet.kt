package erp.app.screens.money

import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.fillMaxWidth
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.rememberShelf
import erp.app.ui.Note
import erp.app.ui.rememberHaptics
import erp.core.ERPDate
import erp.core.logic.Money
import erp.core.models.Expense
import erp.core.models.Karigar
import erp.core.models.KarigarBatch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate

private const val TYPED = "__typed__"

/**
 * "+" on Expenses: the web's Add expense form (components/expense/expense-form.tsx). Date, category, description and
 * amount are required (the amount at least 0.01); paid by is the business unless a partner's own cash was used. A
 * karigar payment is filed under one of his hisaabs: picking him selects his open hisaab (the newest, if several), and
 * once the hisaab is touched it stays as chosen. The ERP writes it (`addExpense`, lib/writes/expenses.ts), and a
 * partner's cash also goes on that partner's ledger there, as a loan. The sheet stays open with the ERP's own words
 * if it refuses.
 *
 * [categories] is what the books already use, then "Other"; a new name can be typed. [partnership] is the house
 * keeping partner ledgers (`session.shop.partnership`): "Paid by" a partner, and a partner's salary.
 */
@Composable
fun AddExpenseSheet(categories: List<String>, partnership: Boolean, onDismiss: () -> Unit, onSaved: (Note) -> Unit) {
    ExpenseFormSheet(null, categories, partnership, onDismiss, onSaved)
}

/**
 * The one form behind Add expense and Edit expense (ExpenseEditSheet.swift is the same form over a row): the same
 * fields and rules. [editing] fills it from a row, and the hisaab that row is in stays as it is until the karigar changes.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ExpenseFormSheet(editing: Expense?, categories: List<String>, partnership: Boolean, onDismiss: () -> Unit, onSaved: (Note) -> Unit) {
    val book = LocalBook.current
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val allKarigars by rememberShelf(book.karigars)
    val allBatches by rememberShelf(book.karigarBatches)
    LaunchedEffect(Unit) { book.karigars.need(); book.karigarBatches.need() }

    var picked by remember { mutableStateOf(editing?.let { ERPDate.parse(it.date) } ?: Instant.now()) }
    var category by rememberSaveable { mutableStateOf(editing?.category ?: "") }
    var typedCategory by rememberSaveable { mutableStateOf("") }
    var what by rememberSaveable { mutableStateOf(editing?.description ?: "") }
    var amountText by rememberSaveable { mutableStateOf(editing?.let { ExpenseEditing.typed(it.amount) } ?: "") }
    var paidBy by rememberSaveable { mutableStateOf(editing?.let { ExpenseEditing.payerWord(it.paidBy) } ?: "business") }
    // Which partner a "Partner Salary" paid: "" until chosen.
    var salaryFor by rememberSaveable { mutableStateOf(editing?.shareholderId ?: "") }
    // "" is not a karigar payment.
    var karigarId by rememberSaveable { mutableStateOf(editing?.karigarId ?: "") }
    // Null until the hisaab picker is touched (or, editing, the row's own hisaab); until then the choice follows the karigar.
    var batchChoice by rememberSaveable {
        mutableStateOf<String?>(editing?.let { e -> if (e.karigarId.isNullOrEmpty()) null else (e.batchId ?: ExpenseFiling.direct) })
    }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    // The row's own category is always one to pick, on the list or not.
    val names = remember(categories, editing) {
        if (editing != null && editing.category.isNotEmpty() && editing.category !in categories) listOf(editing.category) + categories else categories
    }
    val amount = MoneyParse.amount(amountText) ?: 0.0
    val chosenCategory = (if (category == TYPED) typedCategory else category).trim()
    val cleanedWhat = what.trim()
    // A partner's wage: the business pays it, and the partner it paid is written on the row (the Shareholders page's
    // salary form), or his page leaves the expense out of his salaries.
    val isSalary = partnership && chosenCategory == MoneyPartners.salaryCategory
    // The web's schema: a category, a description, and an amount of at least 0.01; a salary also says whose.
    val canSave = !(isSalary && salaryFor.isEmpty()) && amount >= 0.01 && cleanedWhat.isNotEmpty() && chosenCategory.isNotEmpty() && !saving

    // Removed karigars are left out, as the web's list leaves them (editing keeps the one this row already pays).
    val karigars = remember(allKarigars, editing) {
        allKarigars.filter { it.deletedAt.isNullOrEmpty() || it.id == (editing?.karigarId ?: "") }
    }
    val karigarName = karigars.firstOrNull { it.id == karigarId }?.name.orEmpty().ifEmpty { karigarId }
    val theirBatches: List<KarigarBatch> = remember(allBatches, karigarId) { ExpenseFiling.batches(karigarId, allBatches) }
    val batchValue = batchChoice ?: ExpenseFiling.defaultChoice(karigarId, theirBatches)

    fun save() {
        if (!canSave) return
        saving = true
        error = null
        val filed = if (karigarId.isEmpty()) null else ExpenseFiling.filedBatchId(batchValue)
        val filedLabel = filed?.let { id -> theirBatches.firstOrNull { it.id == id }?.label }
        val fields = LinkedHashMap<String, Any?>()
        if (editing != null) fields["expenseId"] = editing.id
        fields["date"] = if (editing != null) ExpenseEditing.dateText(picked, editing.date) else ERPDate.iso(picked)
        fields["category"] = chosenCategory
        fields["description"] = if (isSalary && editing == null) MoneyPartners.salaryDescription(salaryFor, cleanedWhat) else cleanedWhat
        fields["amount"] = amount
        if (isSalary) {
            fields["paidBy"] = "business"
            fields["shareholderId"] = salaryFor
        } else if (partnership) {
            fields["paidBy"] = paidBy
        } else if (editing != null) {
            // No partner picker in this house: the row keeps the payer it has.
            ExpenseEditing.payerWord(editing.paidBy)?.let { fields["paidBy"] = it }
        }
        if (karigarId.isNotEmpty()) fields["karigarId"] = karigarId
        if (filed != null) fields["batchId"] = filed
        scope.launch {
            try {
                ErpApi.shared.write(if (editing != null) "updateExpense" else "addExpense", fields)
                onSaved(
                    if (editing != null) Note("Saved", "Expense updated.")
                    else Note("Expense added", filedLabel?.let { "Filed to hisaab “$it”." } ?: "Recorded."),
                )
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

    MoneySheet(if (editing != null) "Edit expense" else "Add expense", onDismiss, busy = saving, confirmText = "Save", confirmEnabled = canSave, onConfirm = ::save) {
        SheetHeading("When and what")
        DayRow("Date", picked.atZone(phoneZone).toLocalDate(), { picked = pickedInstant(it, picked) }, latest = LocalDate.now())
        PickerRow(
            "Category",
            listOf("" to "Choose…") + names.map { it to it } + (TYPED to "Another category…"),
            category, { category = it },
        )
        if (category == TYPED) MoneyField("Category name", typedCategory, { typedCategory = it }, enabled = !saving)
        MoneyField(
            "Description", what, { what = it },
            placeholder = if (editing == null) "e.g. Monthly electricity bill" else null, singleLine = false, enabled = !saving,
        )
        SheetHeading("How much")
        MoneyField("Amount in rupees", amountText, { amountText = it }, number = true, big = true, enabled = !saving)
        if (amount > 0) Text(Money.pkrLac(amount), color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (isSalary) {
            SheetHeading("Partner salary")
            PickerRow("Salary for", listOf("" to "Choose…") + MoneyPartners.all.map { it.id to it.name }, salaryFor, { salaryFor = it })
            Footnote("A wage is a cost of the business, so nothing goes on the partner’s ledger.")
        } else if (partnership) {
            SheetHeading("Paid by")
            val options = listOf("business" to "Business cash") + MoneyPartners.all.map { it.id to it.name }
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                options.forEachIndexed { i, (value, label) ->
                    SegmentedButton(
                        selected = paidBy == value, onClick = { paidBy = value },
                        shape = SegmentedButtonDefaults.itemShape(i, options.size), label = { Text(label) },
                    )
                }
            }
            if (paidBy != "business") Footnote("Logged to ${if (paidBy == "ammar") "his" else "her"} ledger as a loan to the business.")
        }
        // "Karigar payment": who was paid, and which of his hisaabs it goes under. Paying a karigar outside a hisaab is
        // a normal payment, so "Direct payment" is a choice, not a gap.
        SheetHeading("Karigar payment")
        PickerRow(
            "Karigar",
            listOf("" to "Not a karigar payment") + karigars.map { k: Karigar -> k.id to k.name.ifEmpty { k.id } },
            karigarId, { karigarId = it; batchChoice = null },
        )
        if (karigarId.isNotEmpty()) {
            if (theirBatches.isEmpty()) {
                Footnote("$karigarName has no hisaab yet. This is recorded as a direct payment.")
            } else {
                PickerRow(
                    "Add to a hisaab",
                    theirBatches.map { it.id to "${it.label} · ${ExpenseFiling.hint(it)}" } + (ExpenseFiling.direct to "Direct payment · outside any hisaab"),
                    batchValue, { batchChoice = it },
                )
            }
        }
        error?.let { ErrorLine(it) }
    }
}
