package erp.app.screens.owner

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import erp.app.data.ErpApi
import erp.app.screens.money.DayRow
import erp.app.screens.money.ErrorLine
import erp.app.screens.money.Footnote
import erp.app.screens.money.MoneyField
import erp.app.screens.money.MoneyParse
import erp.app.screens.money.MoneyPartners
import erp.app.screens.money.MoneySheet
import erp.app.screens.money.SheetHeading
import erp.app.screens.money.phoneZone
import erp.app.screens.money.pickedInstant
import erp.app.ui.Note
import erp.app.ui.rememberHaptics
import erp.core.ERPDate
import erp.core.logic.Money
import erp.core.models.Collections
import erp.core.models.PartnerLedgerCategory
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.Instant
import kotlin.math.abs

/** The two partners, in the page's order (lib/shareholders.ts SHAREHOLDERS), with their own book. */
data class ShareholderPerson(val id: String, val name: String, val ledger: String) {
    companion object {
        val all = listOf(
            ShareholderPerson("mina", "Mina", Collections.minaLedger),
            ShareholderPerson("ammar", "Ammar", Collections.ammarLedger),
        )

        fun named(id: String): ShareholderPerson? = all.firstOrNull { it.id == id }
    }
}

/** What the Add / Pay / Withdraw sheet is for (shareholders/page.tsx `Mode`). */
enum class ShareholderMove(val raw: String) {
    contribution("contribution"), salary("salary"), withdrawal("withdrawal");

    val title: String
        get() = when (this) {
            salary -> "Pay a salary"
            withdrawal -> "Withdraw capital"
            contribution -> "Add a contribution"
        }

    val explanation: String
        get() = when (this) {
            salary -> "Remuneration for work performed. Recorded in Expenses as a business cost; it does not affect their stake in the business."
            withdrawal -> "Capital returned to the partner, which reduces their stake. This is not remuneration — use Pay salary for that."
            contribution -> "Funds contributed to the business — as equity, or as a loan repaid before profits are split."
        }

    val action: String
        get() = when (this) {
            salary -> "Pay salary"
            withdrawal -> "Record withdrawal"
            contribution -> "Record contribution"
        }

    val placeholder: String
        get() = when (this) {
            salary -> "e.g. August"
            withdrawal -> "e.g. capital returned"
            contribution -> "e.g. bank transfer"
        }
}

/** The sheet's opening: what it is for and whose it is. */
data class ShareholderAsk(val move: ShareholderMove, val who: String) {
    val id: String get() = "${move.raw}-$who"
}

/** The page's money (`fmt`): whole rupees, without a sign; the words or a +/− around it say which way. */
object ShareholderMoney {
    fun fmt(n: Double): String = Money.pkr(abs(n))

    /** "+PKR 31,750" / "−PKR 6,000", as the page prints a share of the P&L. */
    fun signed(n: Double): String = "${if (n >= 0) "+" else "−"}${fmt(n)}"
}

/** The page's line under a salary for the partner who is behind: paying them evens the two up. */
internal fun evensUp(move: ShareholderMove, who: String, salaryPaid: Map<String, Double>): String? {
    if (move != ShareholderMove.salary) return null
    val me = ShareholderPerson.named(who) ?: return null
    val other = ShareholderPerson.all.firstOrNull { it.id != me.id } ?: return null
    val mine = salaryPaid[me.id] ?: 0.0
    val theirs = salaryPaid[other.id] ?: 0.0
    val diff = theirs - mine
    // salaryGap: a gap under a rupee is no gap.
    if (abs(diff) < 1 || diff <= 0) return null
    return "${other.name} is ${ShareholderMoney.fmt(diff)} ahead on salary. Paying ${me.name} evens that up."
}

internal fun categoryHint(move: ShareholderMove, category: PartnerLedgerCategory): String = when {
    move == ShareholderMove.withdrawal && category == PartnerLedgerCategory.equity -> "Equity: reduces their stake in the business."
    move == ShareholderMove.withdrawal -> "Loan: repayment of funds they lent."
    category == PartnerLedgerCategory.equity -> "Equity: their stake in the business."
    else -> "Loan: repaid before profits are distributed."
}

/**
 * "Add contribution", "Pay salary" and "Withdraw capital" (the page's one dialog). A salary is only an expense: a wage
 * does not move anyone's capital, so nothing goes on the ledger (`addExpense`, the partner named, as the page files it).
 * A contribution is a ledger row; a withdrawal is the ledger's draw and its Partner Drawings expense
 * (`addShareholderEntry`, lib/writes/shareholders.ts). The sheet stays open with the ERP's own words if it refuses.
 *
 * [salaryPaid] is what each partner has had in salary, for the line that says paying one evens the two up.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareholderEntrySheet(ask: ShareholderAsk, salaryPaid: Map<String, Double>, onDismiss: () -> Unit, onSaved: (Note) -> Unit) {
    val move = ask.move
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    var who by rememberSaveable { mutableStateOf(ask.who) }
    var amountText by rememberSaveable { mutableStateOf("") }
    var picked by remember { mutableStateOf(Instant.now()) }
    var category by rememberSaveable { mutableStateOf(PartnerLedgerCategory.equity) }
    var what by rememberSaveable { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val amount = MoneyParse.amount(amountText) ?: 0.0
    val person = ShareholderPerson.named(who)
    val cleaned = what.trim()

    fun save() {
        val p = person ?: return
        if (cleaned.isEmpty() || amount <= 0) {
            error = "Add a description and an amount"
            return
        }
        saving = true
        error = null
        // The form's day as the ERP reads it (`new Date(date)`: its midnight, UTC).
        val day = OwnerText.day(picked)
        scope.launch {
            try {
                val saved: Note
                when (move) {
                    ShareholderMove.salary -> {
                        // Only an expense. Writing a withdrawal as well would shrink their stake on top of paying them.
                        val midnight = ERPDate.parse(day)?.let { ERPDate.iso(it) } ?: ERPDate.iso(picked)
                        ErpApi.shared.write(
                            "addExpense",
                            mapOf(
                                "date" to midnight,
                                "category" to MoneyPartners.salaryCategory,
                                "description" to MoneyPartners.salaryDescription(p.id, cleaned),
                                "amount" to amount,
                                "paidBy" to "business",
                                "shareholderId" to p.id,
                            ),
                        )
                        saved = Note("${p.name} paid ${ShareholderMoney.fmt(amount)}", "Recorded as a salary expense.")
                    }
                    ShareholderMove.contribution, ShareholderMove.withdrawal -> {
                        ErpApi.shared.write(
                            "addShareholderEntry",
                            mapOf(
                                "shareholderId" to p.id,
                                "kind" to move.raw,
                                "category" to category.name,
                                "description" to cleaned,
                                "amount" to amount,
                                "date" to day,
                            ),
                        )
                        saved = if (move == ShareholderMove.contribution) {
                            Note("${p.name}’s contribution recorded", ShareholderMoney.fmt(amount))
                        } else {
                            Note("${p.name} took ${ShareholderMoney.fmt(amount)}", "Logged as a Partner Drawings expense too.")
                        }
                    }
                }
                saving = false
                onSaved(saved)
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

    MoneySheet(move.title, onDismiss, busy = saving, confirmText = move.action, confirmEnabled = !saving, onConfirm = ::save) {
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            ShareholderPerson.all.forEachIndexed { i, p ->
                SegmentedButton(
                    selected = who == p.id, onClick = { who = p.id },
                    shape = SegmentedButtonDefaults.itemShape(i, ShareholderPerson.all.size), label = { Text(p.name) },
                )
            }
        }
        Footnote(move.explanation)
        MoneyField("Amount (PKR)", amountText, { amountText = it }, number = true, big = true, enabled = !saving)
        if (amount > 0) Text(Money.pkrLac(amount), color = MaterialTheme.colorScheme.onSurfaceVariant)
        DayRow("Date", picked.atZone(phoneZone).toLocalDate(), { picked = pickedInstant(it, picked) })
        if (move != ShareholderMove.salary) {
            SheetHeading("Treated as")
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                listOf(PartnerLedgerCategory.equity to "Equity", PartnerLedgerCategory.loan to "Loan").forEachIndexed { i, (c, label) ->
                    SegmentedButton(
                        selected = category == c, onClick = { category = c },
                        shape = SegmentedButtonDefaults.itemShape(i, 2), label = { Text(label) },
                    )
                }
            }
            Footnote(categoryHint(move, category))
        }
        MoneyField("Description, ${move.placeholder}", what, { what = it }, singleLine = false, enabled = !saving)
        evensUp(move, who, salaryPaid)?.let { Footnote(it) }
        error?.let { ErrorLine(it) }
    }
}
