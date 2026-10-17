package erp.app.screens.money

import erp.core.ERPDate
import erp.core.logic.Money
import erp.core.models.Expense
import erp.core.models.PaidBy
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.Instant
import java.time.ZoneId

// What the edit sheets on Expenses and Extra revenue work out for themselves, with no Compose in it
// (ExpenseEditing.swift): the figures put back in a box, the day sent again, and the words a delete says first.
// The writes are the ERP's (updateExpense, deleteExpense and the extra revenue ops, lib/writes/expense-admin.ts).

object ExpenseEditing {
    /** An amount as the form's box shows it: whole rupees bare ("12000"), never paise (owner, 2026-10-17: "there should be no decimals"). */
    fun typed(amount: Double): String {
        val whole = erp.app.ui.PaymentText.rounded(amount)
        if (!(whole > 0) || whole >= 1e15) return ""
        return whole.toLong().toString()
    }

    /**
     * The day to send: the row's own text when the day picked is the day it had, so a partner's loan row is not
     * drawn again for nothing; otherwise the moment picked, as the form's `date.toISOString()`.
     */
    fun dateText(picked: Instant, original: String, zone: ZoneId = ZoneId.systemDefault()): String {
        val had = ERPDate.parse(original)
        if (had != null && picked.atZone(zone).toLocalDate() == had.atZone(zone).toLocalDate()) return original
        return ERPDate.iso(picked)
    }

    /** The payer as the ERP names it ("business", "ammar", "mina"); null for a word it does not know. */
    fun payerWord(who: PaidBy): String? = when (who) {
        PaidBy.business -> "business"
        PaidBy.ammar -> "ammar"
        PaidBy.mina -> "mina"
        else -> null
    }

    /** A partner's drawing, in a house that keeps partner ledgers: the Shareholders page's to change, with its withdrawal. */
    fun isDrawing(e: Expense, partnership: Boolean): Boolean = partnership && e.category == MoneyPartners.drawingsCategory

    /** The store's own words for the delete (`Delete expense "…"`), said in the code sheet and the ERP's log. */
    fun deleteWhat(e: Expense): String = "Delete expense \"${if (e.description.isEmpty()) e.id else e.description}\""

    /** The web's confirmation ("Electricity bill — PKR 12,000.") and what goes with the row: a partner's loan on their ledger. */
    fun deleteDetail(e: Expense): String {
        val what = if (e.description.isEmpty()) e.category else e.description
        var text = "$what — ${Money.pkr(e.amount)}."
        fronted(e)?.let { partner ->
            text += " The loan on $partner's ledger, for the cash $partner put in, is deleted with it."
        }
        return text
    }

    /** The partner who fronted the cash, when their ledger has a loan row for it. */
    fun fronted(e: Expense): String? {
        if (e.ledgerEntryId.isNullOrEmpty()) return null
        return when (e.paidBy) {
            PaidBy.ammar -> "Ammar"
            PaidBy.mina -> "Mina"
            else -> null
        }
    }
}
