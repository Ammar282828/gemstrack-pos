package erp.app.screens.invoices

import erp.app.ui.PaymentText
import erp.core.logic.BalanceState
import erp.core.logic.balanceLine
import erp.core.logic.canHoldCredit
import erp.core.logic.rupees
import erp.core.models.Invoice
import erp.core.models.InvoiceStatus

/**
 * Giving a customer their credit back (give-back-credit.tsx; the shared write lib/writes/invoice-credit-payback.ts, op
 * `payBackCredit`; the iPhone's InvoiceActionCreditSheet). An invoice paid past its total leaves the named customer a
 * credit on their hisaab; this is the words and the payload for handing the money over. It is a payment going out,
 * NOT a refund of the sale: no delete code, nothing goes to Shopify, the sale's revenue is untouched.
 */
object InvoiceCredit {
    /** The credit an invoice holds for a named customer (lib/invoice-credit.ts): none for a walk-in or a refunded invoice. */
    fun held(inv: Invoice): Double {
        if (inv.status == InvoiceStatus.refunded || !canHoldCredit(inv.customerId)) return 0.0
        val line = balanceLine(inv.balanceDue)
        return if (line.state == BalanceState.credit) rupees(line.amount) else 0.0
    }

    /** A give-back can be made when at least a rupee is held. */
    fun canGiveBack(inv: Invoice): Boolean = held(inv) >= 1

    /** The amount can be given: a rupee or more, and no more than is held (half a rupee of slack, as the sheet allows). */
    fun valid(amount: Double, held: Double): Boolean = amount >= 1 && amount <= held + 0.5

    /** The sheet's footer under a valid or too-large amount; null while nothing is typed. */
    fun footer(amount: Double, held: Double): String? {
        if (amount > held + 0.5) return "Only ${PaymentText.pkr(held)} is held."
        if (!valid(amount, held)) return null
        val left = maxOf(0.0, held - amount)
        return if (left >= 1) "${PaymentText.pkr(left)} stays as credit on the hisaab."
        else "No credit is left, and its row on the hisaab goes. The sale is not refunded; it shows as money out in Today's cash."
    }

    /** `payBackCredit`: the invoice, the amount (never more than is held), how it was paid, and the figures the sheet was worked out from. */
    fun fields(inv: Invoice, amount: Double, method: String): Map<String, Any?> =
        mapOf("invoiceId" to inv.id, "amount" to minOf(amount, held(inv)), "method" to method, "seen" to InvoiceActionWords.seen(inv))

    /** The note raised once it is given. */
    fun note(amount: Double, held: Double, method: String): InvoiceNote {
        val given = minOf(amount, held)
        val rest = maxOf(0.0, held - given)
        return InvoiceNote(
            "Credit given back",
            "${PaymentText.pkr(given)} by $method." + if (rest >= 1) " ${PaymentText.pkr(rest)} credit left." else " No credit left.",
        )
    }

    /** "Give back PKR 3,000": the button on the invoice page. */
    fun buttonWords(inv: Invoice): String = "Give back ${erp.core.logic.Money.pkr(held(inv))}"

    /** The plain row on the customer's page, one per invoice in credit. */
    fun rowWords(inv: Invoice): String = "Give back ${erp.core.logic.Money.pkr(held(inv))} on ${inv.id}"

    /** A negative payment written by a give-back: it reads "Credit paid back", not "Refund". */
    fun isPayback(p: erp.core.models.Payment): Boolean =
        p.amount < 0 && ((p.notes ?: "").startsWith("Credit paid back") || erp.core.logic.isCreditPayback(p))
}
