// Ported from src/lib/repairs.ts (a repair ticket's sums and its line). Nothing is stored for the total,
// the paid sum or the balance: they are read from `pieces` and `payments`, here, once, for every screen.

package erp.core.logic

import erp.core.models.Repair

fun repairTotal(r: Repair): Double =
    // `Number(p.price) || 0`: a missing or NaN price counts as nothing.
    r.pieces.fold(0.0) { sum, p ->
        val price = p.price ?: 0.0
        sum + (if (price.isNaN()) 0.0 else price)
    }

fun repairPaid(r: Repair): Double =
    r.payments.fold(0.0) { sum, p -> sum + (if (p.amount.isNaN()) 0.0 else p.amount) }

/** What the customer still owes on the ticket. */
fun repairBalance(r: Repair): Double =
    maxOf(0.0, JS.round((repairTotal(r) - repairPaid(r)) * 100) / 100)

/** "Gold ring" or "Gold ring + 2 more": a ticket in a line. */
fun repairSummary(r: Repair): String {
    val named = r.pieces.filter { it.item.isNotEmpty() }
    if (named.isEmpty()) return "Repair"
    return if (named.size == 1) named[0].item else "${named[0].item} + ${named.size - 1} more"
}
