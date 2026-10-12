// Ported from src/lib/invoice-actions.ts (tests: InvoiceActionsTests, from invoice-actions.test.ts).
//
// What an invoice's own actions do to its figures, worked out before anything is written: changing the
// discount, a partial refund, deleting one payment, and which pieces a delete puts back in stock. The ERP's
// writes take their figures from the TypeScript; the phone's confirmations say them from this, so what a
// sheet says will happen is what the write then does. A missing figure on an old document counts as nothing.

package erp.core.logic

import erp.core.models.Invoice
import erp.core.models.InvoiceItem
import erp.core.models.Payment
import kotlin.math.abs

object InvoiceActions {
    /** The figures the actions read off an invoice (TS `InvoiceFigures`). */
    data class Figures(
        val subtotal: Double? = null,
        val exchangeAmount1: Double? = null,
        val exchangeAmount2: Double? = null,
        val grandTotal: Double? = null,
        val amountPaid: Double? = null,
        /** The payment history's amounts, in order (null: a payment with no amount). */
        val payments: List<Double?> = emptyList(),
    ) {
        constructor(invoice: Invoice) : this(
            subtotal = invoice.subtotal, exchangeAmount1 = invoice.exchangeAmount1, exchangeAmount2 = invoice.exchangeAmount2,
            grandTotal = invoice.grandTotal, amountPaid = invoice.amountPaid, payments = invoice.paymentHistory.map { it.amount },
        )
    }

    /** The invoice with a new discount (TS `withDiscount`). */
    data class Discounted(val discountAmount: Double, val grandTotal: Double, val balanceDue: Double)

    /** The history after a refund or a payment deleted, and what is paid and owed on it. */
    data class Paid(val payments: List<Double?>, val amountPaid: Double, val balanceDue: Double)

    /** `Number(v) || 0`: absent or not a number is nothing. */
    private fun num(v: Double?): Double = if (v == null || v.isNaN()) 0.0 else v

    /** The invoice page's refusals, in its words; null when the discount can be saved. */
    fun discountProblem(subtotal: Double?, discount: Double): String? {
        if (!discount.isFinite()) return "Enter the discount."
        if (discount < 0) return "Discount cannot be negative."
        if (discount > num(subtotal)) return "Discount cannot exceed subtotal."
        return null
    }

    /**
     * The lines less the discount and the exchange (the two totals every invoice keeps), and what is still
     * owed on what has been paid. Adjustments are left out, as every sale's total leaves them out.
     */
    fun withDiscount(f: Figures, discount: Double): Discounted {
        val grandTotal = num(f.subtotal) - discount - num(f.exchangeAmount1) - num(f.exchangeAmount2)
        return Discounted(discountAmount = discount, grandTotal = grandTotal, balanceDue = grandTotal - num(f.amountPaid))
    }

    /** The refund's line in the payment history: what was handed back, as money out. */
    fun refundEntry(amount: Double, date: String, reason: String? = null): Payment {
        val said = reason ?: ""
        return Payment(amount = -abs(amount), date = date, notes = if (said.isEmpty()) "Refund" else "Refund: $said")
    }

    /** A partial refund: a negative payment on the history, and what is paid and owed recomputed from the whole history, never from a running total. */
    fun withRefund(f: Figures, amount: Double): Paid {
        val payments = f.payments + listOf(-abs(amount))
        val amountPaid = payments.fold(0.0) { acc, p -> acc + num(p) }
        return Paid(payments = payments, amountPaid = amountPaid, balanceDue = num(f.grandTotal) - amountPaid)
    }

    /** One payment off the history (its place as the page shows it), and what is paid and owed without it; null when there is none there. */
    fun withoutPayment(f: Figures, index: Int): Paid? {
        if (index < 0 || index >= f.payments.size) return null
        val payments = f.payments.toMutableList()
        payments.removeAt(index)
        val amountPaid = payments.fold(0.0) { acc, p -> acc + num(p) }
        return Paid(payments = payments, amountPaid = amountPaid, balanceDue = num(f.grandTotal) - amountPaid)
    }

    /**
     * The pieces a deleted invoice puts back in stock, each once. A piece made for an order (ORD-…) was
     * never in stock; a piece another invoice also sold (a sale entered twice) stays sold, to that invoice.
     */
    fun piecesBackInStock(invoice: Invoice, others: List<Invoice>): List<InvoiceItem> {
        val elsewhere = HashSet<String>()
        for (o in others) {
            if (o.id == invoice.id) continue
            for (line in o.items) if (line.sku.isNotEmpty()) elsewhere.add(line.sku)
        }
        val seen = HashSet<String>()
        return invoice.items.filter { line ->
            val sku = line.sku
            if (sku.isEmpty() || sku.startsWith("ORD-") || elsewhere.contains(sku) || seen.contains(sku)) return@filter false
            seen.add(sku)
            true
        }
    }
}
