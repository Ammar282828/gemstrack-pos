package erp.app.screens.owner

import androidx.compose.runtime.Composable
import erp.app.screens.invoices.InvoiceDeleteCodeSheet
import erp.app.screens.invoices.InvoiceDeletion
import erp.core.ERPDate
import erp.core.logic.Money
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs

// What the owners' pages share (OwnerKit.swift): the delete code, asked before a delete the ERP's server carries out,
// and the words the pages print their money in. The Money screens use the same delete code.

/**
 * One delete waiting for its code: what is deleted (said in the sheet and in the ERP's log of who tried), what goes
 * with it, and the write that runs once the code is typed.
 * TODO(shared): replace with the shared owner delete-code sheet when merged (the fix-up pass moves it to
 * screens/owner/DeleteCode.kt); until then the invoices group's own copy does the asking.
 */
typealias OwnerAsk = InvoiceDeletion

/** Builds one, in the iPhone's argument order (`OwnerDeletion(what:detail:final:run:)`). */
fun ownerAsk(what: String, detail: String, final: Boolean = true, run: suspend (code: String) -> Unit): OwnerAsk =
    InvoiceDeletion(what = what, detail = detail, run = run, final = final)

/** The delete code sheet for one [OwnerAsk]; [onDone] runs once the delete has gone through. TODO(shared): see [OwnerAsk]. */
@Composable
fun OwnerAskSheet(ask: OwnerAsk, onDismiss: () -> Unit, onDone: () -> Unit) {
    InvoiceDeleteCodeSheet(ask, onDismiss = onDismiss, onDone = onDone)
}

object OwnerText {
    /** The pages' money: whole rupees, grouped in threes (`PKR ${Math.round(n).toLocaleString()}`). */
    fun pkr(n: Double): String = Money.pkr(n)

    /** "+ PKR 30,000" / "− PKR 30,000", the minus a real minus (overheads/page.tsx `signed`). */
    fun signed(n: Double): String = "${if (n < 0) "−" else "+"} ${Money.pkr(abs(n))}"

    /** The form's day for the ERP ("2026-10-09"): the day picked, in Karachi, as the web's date box gives it. */
    fun day(d: Instant): String = ERPDate.karachiDay(d)

    private val shortDate: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.US).withZone(ERPDate.karachi)

    /** "1 Oct 2026" (date-fns 'd MMM yyyy', the web's ledger rows); "" when the text is no date. */
    fun shortDate(iso: String?): String {
        val d: Instant = ERPDate.parse(iso) ?: return ""
        return shortDate.format(d)
    }
}
