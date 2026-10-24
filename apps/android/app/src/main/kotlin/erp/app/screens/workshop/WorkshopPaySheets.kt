package erp.app.screens.workshop

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import erp.app.data.ErpApi
import erp.app.ui.rememberHaptics
import erp.app.data.Shelf
import erp.app.data.Sort
import erp.app.screens.customers.FormSection
import erp.app.screens.neworder.FieldRow
import erp.app.screens.neworder.PickerRow
import erp.app.screens.neworder.ValueRow
import erp.app.screens.neworder.WideFieldRow
import erp.app.ui.ChipRow
import erp.app.ui.FilterChip
import erp.app.ui.LocalNoteState
import erp.app.ui.MoneyFeedback
import erp.app.ui.Note
import erp.app.screens.money.MoneyParse
import erp.app.ui.PaymentText
import erp.app.ui.Tone
import erp.core.ERPDate
import erp.core.Registry
import erp.core.entry.NewOrderDay
import erp.core.logic.KarigarPay
import erp.core.logic.Money
import erp.core.models.Collections
import erp.core.models.Expense
import erp.core.models.Karigar
import erp.core.models.KarigarBatch
import erp.core.models.KarigarSilverTransaction
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

// The karigar page's pay dialogs (src/app/karigars/[id]/page.tsx): Record Payment, Silver Transaction, Start a new
// pay batch, Settle and close the pay batch. Each is one write through the ERP. Paying him is an expense
// (`addExpense`, lib/writes/expenses.ts) filed under his open batch; the rest are lib/writes/workshop-admin.ts.
// Every figure shown before saving is core's KarigarPay, the one the ERP writes. None of them posts to Hisaab, as on
// the web; the sheets say so.

/** His silver entries, read live for his page only (owners): the shop's Book has no shelf for them, and nobody else reads them. */
class WorkshopSilverBook {
    val silver = Shelf(Collections.silverTransactions, Registry.decoder(KarigarSilverTransaction::class), { it.id }, Sort.descending<KarigarSilverTransaction> { it.date })

    fun need() = silver.need()

    /** Off the screen, the listener stops; coming back starts it again. */
    fun stop() = silver.reset()
}

/** What the karigar page asked to open. */
sealed interface WorkshopPayAsk {
    data class Pay(val batch: KarigarBatch) : WorkshopPayAsk
    data object Silver : WorkshopPayAsk
    data object Start : WorkshopPayAsk
    data class Settle(val open: KarigarPay.InBatch) : WorkshopPayAsk
    data object Assign : WorkshopPayAsk
}

/** The partners (lib/shareholders.ts SHAREHOLDERS): only a house that keeps partner ledgers offers them. */
data class WorkshopPartner(val id: String, val name: String)

object WorkshopPartners {
    val all = listOf(WorkshopPartner("ammar", "Ammar"), WorkshopPartner("mina", "Mina"))
}

object WorkshopPayWords {
    /** Every category an expense carries, the most used first (ties by name). */
    fun categoriesByUse(expenses: List<Expense>): List<String> {
        val counts = HashMap<String, Int>()
        for (e in expenses) if (e.category.isNotEmpty()) counts[e.category] = (counts[e.category] ?: 0) + 1
        return counts.keys.sortedWith { a, b ->
            val ca = counts[a] ?: 0
            val cb = counts[b] ?: 0
            if (ca != cb) cb.compareTo(ca) else String.CASE_INSENSITIVE_ORDER.compare(a, b)
        }
    }

    /**
     * What the Add expense form offers (`ExpenseFigures.formCategories`): the house's own list, then any other name an
     * expense carries, sorted; with no house list the names the books use, most used first, "Other" last.
     */
    fun formCategories(shop: List<String>, expenses: List<Expense>): List<String> {
        if (shop.isEmpty()) {
            val all = categoriesByUse(expenses)
            return all.filter { it != "Other" } + "Other"
        }
        val known = shop.toSet()
        val extra = sortedSetOf<String>()
        for (e in expenses) if (e.category.isNotEmpty() && e.category !in known) extra.add(e.category)
        return shop + extra
    }

    /** Exactly what the ERP writes for a payment. */
    fun paymentConsequence(isoDate: String, category: String, what: String, batchLabel: String, partner: WorkshopPartner?): String {
        var s = "An expense of ${WorkshopLogic.shortDate(isoDate)} under $category, “$what”, filed to pay batch “$batchLabel”."
        if (partner != null) {
            s += " Paid from ${partner.name}'s own pocket, so it also goes on ${partner.name}'s ledger as a loan to the business."
        }
        s += " Nothing is posted to Hisaab."
        return s
    }

    fun settleConsequence(open: KarigarPay.InBatch, carry: String): String {
        val count = open.payments.size
        var s = "“${open.batch.label}” is closed now at ${PaymentText.pkr(open.total)}, the total of its $count payment${if (count == 1) "" else "s"}, and kept under Settled pay batches."
        s += if (carry.isEmpty()) " Paying him from his page then needs a new pay batch."
        else " “$carry” starts at the same moment and takes his next payments."
        s += " Nothing is paid and nothing is posted to Hisaab."
        return s
    }
}

// MARK: Record a payment

/**
 * "Record Payment to <name>", added to his open pay batch: the expense form locked to him and to it. Date, category,
 * description and an amount of at least 0.01 are needed; "Paid by" is the business unless a partner's own cash was
 * used (the house that keeps partner ledgers). Asked once more before it is sent, saying what is written.
 */
@Composable
fun WorkshopPaySheet(karigar: Karigar, batch: KarigarBatch, categories: List<String>, partnership: Boolean, onDismiss: () -> Unit) {
    val note = LocalNoteState.current
    val scope = rememberCoroutineScope()
    val openedAt = remember { Instant.now() }
    var day by remember { mutableStateOf(NewOrderDay.today) }
    var category by remember { mutableStateOf("") }
    var typedCategory by remember { mutableStateOf("") }
    var what by remember { mutableStateOf("") }
    var amountText by remember { mutableStateOf("") }
    var paidBy by remember { mutableStateOf("business") }
    var confirming by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var savedTick by remember { mutableStateOf(0) }
    var failedTick by remember { mutableStateOf(0) }

    val typed = "__typed__"
    val amount = MoneyParse.rupees(amountText) ?: 0.0
    val cleanedWhat = what.trim()
    val chosenCategory = (if (category == typed) typedCategory else category).trim()
    val canSave = amount >= 0.01 && cleanedWhat.isNotEmpty() && chosenCategory.isNotEmpty() && !saving
    val name = karigar.name.ifEmpty { karigar.id }
    val partner = WorkshopPartners.all.firstOrNull { it.id == paidBy }

    fun save() {
        if (!canSave) return
        val iso = WorkshopDay.iso(day, openedAt)
        val write = WorkshopWrites.payment(iso, chosenCategory, cleanedWhat, amount, karigar.id, batch.id, partnership, paidBy)
        saving = true
        error = null
        scope.launch {
            try {
                ErpApi.shared.write(write.op, write.fields)
                note.show(Note("Expense added", "Filed to hisaab “${batch.label}”."))
                savedTick += 1
                saving = false
                onDismiss()
                return@launch
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failedTick += 1
                error = workshopSay(e)
            }
            saving = false
        }
    }

    MoneyFeedback(success = savedTick, failure = failedTick)
    WorkshopFormSheet("Record payment", onDismiss, "Add", canSave, { confirming = true }, locked = saving) {
        FormSection(title = "Paying $name", footer = "Added to ${batch.label}.") {
            WorkshopDayRow("Date", day) { day = it }
            PickerRow("Category", category, listOf("" to "Choose…") + categories.map { it to it } + (typed to "Another category…")) { category = it }
            if (category == typed) {
                FieldRow("Category name", typedCategory, { typedCategory = it }, prompt = "Category name", capitalization = KeyboardCapitalization.Words)
            }
            WideFieldRow("Description", what, { what = it }, prompt = "Description", minLines = 1, maxLines = 3)
        }
        FormSection(title = "Amount (PKR)") {
            FieldRow("Amount (PKR)", PaymentText.whole(amountText), { amountText = PaymentText.whole(it) }, prompt = "0", number = true, keyboardType = androidx.compose.ui.text.input.KeyboardType.Number)
            if (amount > 0) ValueRow("In words", Money.pkrLac(amount))
        }
        if (partnership) {
            FormSection(
                title = "Paid by",
                footer = partner?.let { "Personal: logged to ${it.name}'s ledger as a loan." },
            ) {
                ChipRow(Modifier.padding(vertical = 4.dp)) {
                    FilterChip("Business cash", chosen = paidBy == "business", onClick = { paidBy = "business" })
                    for (p in WorkshopPartners.all) FilterChip(p.name, chosen = paidBy == p.id, onClick = { paidBy = p.id })
                }
            }
        }
        WorkshopFormError(error)
    }
    if (confirming) {
        WorkshopConfirm(
            title = "Pay ${PaymentText.pkr(amount)} to $name?",
            message = WorkshopPayWords.paymentConsequence(WorkshopDay.iso(day, openedAt), chosenCategory, cleanedWhat, batch.label, partner),
            confirmLabel = "Pay ${PaymentText.pkr(amount)}",
            onConfirm = ::save,
            onDismiss = { confirming = false },
        )
    }
}

// MARK: Silver

/**
 * "Silver Transaction": silver received from him, with a surcharge per gram. The total is the grams at that rate
 * (KarigarPay.silverSurcharge), as the ERP stores it; the form's rules are KarigarPay.silverProblem's.
 */
@Composable
fun WorkshopSilverSheet(karigar: Karigar, onDismiss: () -> Unit) {
    val note = LocalNoteState.current
    val scope = rememberCoroutineScope()
    var gramsText by remember { mutableStateOf("") }
    var rateText by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var confirming by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var savedTick by remember { mutableStateOf(0) }
    var failedTick by remember { mutableStateOf(0) }

    val grams = WorkshopFigure.read(gramsText) ?: 0.0
    val rate = WorkshopFigure.read(rateText, places = 2) ?: 0.0
    val total = KarigarPay.silverSurcharge(grams, rate)
    val problem = KarigarPay.silverProblem(grams, rate)
    val name = karigar.name.ifEmpty { karigar.id }

    val haptics = rememberHaptics()
    fun save() {
        if (problem != null) return
        val write = WorkshopWrites.silver(karigar.id, grams, rate, notes)
        // Not money: the sheet closes at once and the Outbox carries the entry.
        ErpApi.shared.enqueue(write.op, write.fields, "Silver entry")
        note.show(Note("Silver transaction recorded"))
        savedTick += 1
        haptics.success()
        onDismiss()
    }

    MoneyFeedback(success = savedTick, failure = failedTick)
    WorkshopFormSheet("Silver Transaction", onDismiss, "Save", problem == null && !saving, { confirming = true }, locked = saving) {
        FormSection(
            footer = if (gramsText.isNotEmpty() && problem != null) problem else "Record silver received from $name with per-gram surcharge.",
            footerTone = if (gramsText.isNotEmpty() && problem != null) Tone.problem else Tone.quiet,
        ) {
            FieldRow("Silver received (grams)", gramsText, { gramsText = it }, prompt = "e.g. 50.5", number = true)
            FieldRow("Surcharge per gram (PKR)", rateText, { rateText = it }, prompt = "e.g. 35", number = true)
            if (total > 0) ValueRow("Total surcharge", PaymentText.pkr(total))
        }
        FormSection(title = "Notes (optional)") {
            WideFieldRow("Notes", notes, { notes = it }, prompt = "e.g. March batch ring set", minLines = 1, maxLines = 3)
        }
        WorkshopFormError(error)
    }
    if (confirming) {
        WorkshopConfirm(
            title = "Record ${WorkshopLogic.grams3(grams)} of silver from $name?",
            message = "Surcharge ${PaymentText.pkr(total)}: ${WorkshopLogic.grams3(grams)} at PKR ${erp.app.screens.rates.RateKeys.say(rate)} a gram, kept under his silver transactions. No expense and no Hisaab entry is written.",
            confirmLabel = "Record silver",
            onConfirm = ::save,
            onDismiss = { confirming = false },
        )
    }
}

// MARK: Start a pay batch

/** "Start a new pay batch": named, started now. His payments from this page are filed under it until it is settled. */
@Composable
fun WorkshopBatchStartSheet(karigar: Karigar, onDismiss: () -> Unit) {
    val note = LocalNoteState.current
    val scope = rememberCoroutineScope()
    var label by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val cleaned = label.trim()

    fun save() {
        if (cleaned.isEmpty() || saving) return
        val write = WorkshopWrites.startBatch(karigar.id, cleaned)
        saving = true
        error = null
        scope.launch {
            try {
                ErpApi.shared.write(write.op, write.fields)
                note.show(Note("New pay batch started", "“$cleaned” is now active."))
                saving = false
                onDismiss()
                return@launch
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = workshopSay(e)
            }
            saving = false
        }
    }

    WorkshopFormSheet("Start a new pay batch", onDismiss, "Start", cleaned.isNotEmpty() && !saving, ::save, locked = saving) {
        FormSection(
            title = "Pay batch name",
            footer = "Give it a name, e.g. “March 2026” or “Gold Set Batch”. Payments from his page are filed under it until it is settled.",
        ) {
            FieldRow("Pay batch name", label, { label = it }, prompt = "e.g. March 2026", capitalization = KeyboardCapitalization.Sentences)
        }
        WorkshopFormError(error)
    }
}

// MARK: Settle

/**
 * "Settle and close the pay batch": closed now at the total its payments come to (KarigarPay, the figure the ERP
 * writes; it refuses if a payment came or went since, so the owner sees the new one first). A name for the next
 * starts it at the same moment ("Settle & Carry Over"). The sheet is the confirmation: it says what happens.
 */
@Composable
fun WorkshopSettleSheet(open: KarigarPay.InBatch, onDismiss: () -> Unit) {
    val note = LocalNoteState.current
    val scope = rememberCoroutineScope()
    var carry by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var savedTick by remember { mutableStateOf(0) }
    var failedTick by remember { mutableStateOf(0) }
    val cleanedCarry = carry.trim()
    val count = open.payments.size

    fun save() {
        if (saving) return
        val write = WorkshopWrites.settleBatch(open.batch.id, open.total, cleanedCarry)
        saving = true
        error = null
        scope.launch {
            try {
                ErpApi.shared.write(write.op, write.fields)
                if (cleanedCarry.isEmpty()) {
                    note.show(Note("Pay batch settled", "“${open.batch.label}” closed — ${PaymentText.pkr(open.total)}."))
                } else {
                    note.show(Note("Settled, and a new pay batch started", "“${open.batch.label}” closed. “$cleanedCarry” is now active."))
                }
                savedTick += 1
                saving = false
                onDismiss()
                return@launch
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failedTick += 1
                error = workshopSay(e)
            }
            saving = false
        }
    }

    MoneyFeedback(success = savedTick, failure = failedTick)
    WorkshopFormSheet("Settle pay batch", onDismiss, if (cleanedCarry.isEmpty()) "Settle & Close" else "Settle & Carry Over", !saving, ::save, locked = saving) {
        FormSection(title = "Closing", footer = WorkshopPayWords.settleConsequence(open, cleanedCarry)) {
            ValueRow("Pay batch", open.batch.label)
            ValueRow("Payments", "$count")
            ValueRow("Total", PaymentText.pkr(open.total), strong = true)
        }
        FormSection(title = "Carry over to new hisaab? (optional)", footer = "Leave blank to settle without starting a new hisaab.") {
            FieldRow("New hisaab name", carry, { carry = it }, prompt = "New hisaab name, e.g. April 2026", capitalization = KeyboardCapitalization.Sentences)
        }
        WorkshopFormError(error)
    }
}
