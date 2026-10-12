// Ported from src/lib/analytics/sale-value.ts (tests: SaleValueTests, from sale-value.test.ts),
// src/lib/invoice-credit.ts (InvoiceCreditTests), src/lib/recently-removed.ts (RecentlyRemovedTests)
// and src/lib/financials.ts (FinancialsTests).

package erp.core.logic

import erp.core.models.HisaabEntry
import erp.core.models.Invoice
import erp.core.models.Order

// What a sale was worth, for every revenue figure.
//
// An invoice's `grandTotal` is what is left to settle after the discount *and the exchange*
// (subtotal − discount − exchange), so summing it counted a sale paid in old gold at only its cash
// part, and one paid wholly in old gold at nothing (Taheri, 2026-09-29: five such sales, 1.47M,
// and 5.1M of exchange across 18 invoices, missing from Analytics). Exchange gold is payment
// like cash (the owner, 2026-09-25; Cash In already counts it so), so the sale is worth its total
// with the exchange added back: subtotal − discount.
//
// An older invoice made from an order kept its exchange inside a lumped "Advance from Order"
// payment and has no exchange field; its grandTotal already includes it, and nothing is added.

fun invoiceSaleValue(inv: Invoice?): Double {
    if (inv == null) return 0.0
    return (if (inv.grandTotal.isNaN()) 0.0 else inv.grandTotal) + exchangeTotal(invoiceExchanges(inv))
}

// An invoice in credit: the customer has paid more than it comes to, and the shop holds the
// difference for them (owner, 2026-10-07: "allow invoices to go into credit").
//
// A balance below zero is that credit. It is held only for a named customer, on their hisaab,
// where it nets against what they owe and shows as owed to them; a walk-in has no hisaab, so
// money over the total from nobody in particular is change to hand back, not credit.

/** The ledger row that carries an invoice's credit. */
fun creditDescription(invoiceId: String): String = "Credit held for Invoice $invoiceId"

/** Written by the ledger sync before credit could be taken on purpose; still a credit row. */
private fun legacyCreditDescription(invoiceId: String): String = "Excess advance returned for Invoice $invoiceId"

/** Whether a hisaab row is the credit row of `invoiceId` (the TS takes only description, cashCredit, cashDebit). */
fun isCreditRow(row: HisaabEntry, invoiceId: String): Boolean =
    row.cashCredit > 0 && (row.description == creditDescription(invoiceId) || row.description == legacyCreditDescription(invoiceId))

/** Under half a rupee either way is settled: paise from rounding are not a debt or a credit. */
private const val SETTLED = 0.5

/** `Number(x) || 0`: a missing or unreadable balance is nothing. */
private fun balance(balanceDue: Double?): Double = if (balanceDue == null || balanceDue.isNaN()) 0.0 else balanceDue

fun inCredit(balanceDue: Double?): Boolean = balance(balanceDue) < -SETTLED

fun canHoldCredit(customerId: String?): Boolean {
    if (customerId.isNullOrEmpty()) return false
    return customerId != WALK_IN_ENTITY
}

enum class BalanceState { due, paid, credit }

/** How an invoice's balance reads, everywhere it is shown, printed or sent. */
data class BalanceLine(val label: String, val amount: Double, val state: BalanceState)

fun balanceLine(balanceDue: Double?): BalanceLine {
    val b = balance(balanceDue)
    if (b > SETTLED) return BalanceLine("Balance due", b, BalanceState.due)
    if (b < -SETTLED) return BalanceLine("Credit to customer", -b, BalanceState.credit)
    return BalanceLine("Paid in full", 0.0, BalanceState.paid)
}

// How much history each removed customer or karigar still carries. This is the number that makes
// "Empty" a considered act rather than a reflex: a name with 40 ledger entries behind it is not a
// stray duplicate somebody added twice.

object RecentlyRemoved {
    data class History(val entries: Int = 0, val orders: Int = 0)

    /** Ledger entries per person (`entityId`) and orders per customer (`customerId`). */
    fun removedHistory(hisaab: List<HisaabEntry>, orders: List<Order>): Map<String, History> {
        val counts = LinkedHashMap<String, History>()
        for (e in hisaab) {
            if (e.entityId.isEmpty()) continue
            val cur = counts[e.entityId] ?: History()
            counts[e.entityId] = cur.copy(entries = cur.entries + 1)
        }
        for (o in orders) {
            val id = o.customerId
            if (id.isNullOrEmpty()) continue
            val cur = counts[id] ?: History()
            counts[id] = cur.copy(orders = cur.orders + 1)
        }
        return counts
    }

    /** "3 ledger entries · 1 order"; "" when there is none. */
    fun carriesText(history: History?): String {
        val parts = mutableListOf<String>()
        history?.entries?.let { n -> if (n > 0) parts.add("$n ledger entr${if (n == 1) "y" else "ies"}") }
        history?.orders?.let { n -> if (n > 0) parts.add("$n order${if (n == 1) "" else "s"}") }
        return parts.joinToString(" · ")
    }

    /** What emptying the list takes with it: every removed person's entries, and the removed customers' orders. */
    fun removedTotals(customerIds: List<String>, karigarIds: List<String>, history: Map<String, History>): History {
        val entries = (customerIds + karigarIds).fold(0) { acc, id -> acc + (history[id]?.entries ?: 0) }
        val orders = customerIds.fold(0) { acc, id -> acc + (history[id]?.orders ?: 0) }
        return History(entries, orders)
    }

    /** Removed means `deletedAt` is set (store.ts splitRemoved: `Boolean(r.deletedAt)`). */
    fun isRemoved(deletedAt: String?): Boolean = !deletedAt.isNullOrEmpty()
}

// Small rules about what an invoice comes to and which orders are placeholders.
//
// The TS takes anything shaped like an invoice or an order (`InvoiceLike`, `OrderLike`) with every
// field optional or null, so a half-written document still answers. The same two names are here
// as classes, each with a constructor from the model; the functions also take the model itself.

/**
 * What scripts/restore-orders.mjs writes at the head of the notes of an order it rebuilt from the
 * activity log after the original was overwritten (items unknown, to be filled in by hand).
 */
private const val RESTORED_ORDER_NOTES_MARKER = "[RESTORED FROM ACTIVITY LOG"

/** The five figures `getInvoiceExpectedGrandTotal` reads off an invoice (TS `InvoiceLike`). A figure that is absent, null, 0 or not a number counts as 0. */
data class InvoiceLike(
    val subtotal: Double? = null,
    val discountAmount: Double? = null,
    val exchangeAmount1: Double? = null,
    val exchangeAmount2: Double? = null,
    val adjustmentsAmount: Double? = null,
) {
    constructor(invoice: Invoice) : this(
        subtotal = invoice.subtotal, discountAmount = invoice.discountAmount,
        exchangeAmount1 = invoice.exchangeAmount1, exchangeAmount2 = invoice.exchangeAmount2,
        adjustmentsAmount = invoice.adjustmentsAmount,
    )
}

/** The one field `isRestoredPlaceholderOrder` reads off an order (TS `OrderLike`). */
data class OrderLike(val notes: String? = null) {
    constructor(order: Order) : this(notes = order.notes)
}

/** An order that was rebuilt as a placeholder from the activity log, which its notes say. */
fun isRestoredPlaceholderOrder(order: OrderLike?): Boolean {
    val notes = order?.notes ?: return false
    return notes.contains(RESTORED_ORDER_NOTES_MARKER)
}

fun isRestoredPlaceholderOrder(order: Order): Boolean = isRestoredPlaceholderOrder(OrderLike(order))

/** The two old-gold exchange figures an invoice keeps, together (the `exchanges` rows are lib/exchange.ts's; these are the older pair). */
fun getInvoiceExchangeTotal(invoice: InvoiceLike?): Double =
    JS.orZero(invoice?.exchangeAmount1) + JS.orZero(invoice?.exchangeAmount2)

fun getInvoiceExchangeTotal(invoice: Invoice): Double = getInvoiceExchangeTotal(InvoiceLike(invoice))

/** Shipping, taxes or other adjustments beyond the line items. */
fun getInvoiceAdjustmentsAmount(invoice: InvoiceLike?): Double = JS.orZero(invoice?.adjustmentsAmount)

fun getInvoiceAdjustmentsAmount(invoice: Invoice): Double = getInvoiceAdjustmentsAmount(InvoiceLike(invoice))

/** What the invoice should total: the lines, less the discount and the exchange, plus the adjustments. 0 for no invoice. */
fun getInvoiceExpectedGrandTotal(invoice: InvoiceLike?): Double {
    if (invoice == null) return 0.0
    return JS.orZero(invoice.subtotal) -
        JS.orZero(invoice.discountAmount) -
        getInvoiceExchangeTotal(invoice) +
        getInvoiceAdjustmentsAmount(invoice)
}

fun getInvoiceExpectedGrandTotal(invoice: Invoice): Double = getInvoiceExpectedGrandTotal(InvoiceLike(invoice))
