package erp.app.screens.owner

import erp.core.ERPDate
import erp.core.logic.Money
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs

// What the owners' pages share (OwnerKit.swift): the words the pages print their money in. The delete code is the
// shared OwnerDeleteCodeSheet (erp.app.ui).

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
