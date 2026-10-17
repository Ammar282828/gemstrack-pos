// Ported from src/lib/owed.ts (tests: OwedTests, from owed.test.ts).
//
// What customers owe the shop: one figure, read the same way on the dashboard ("Owed to you"),
// the customer list, Invoices' "Awaiting payment" and Hisaab (the audit of 2026-10-01 found four
// sums: the customer list dropped every walk-in and every invoice with only a typed name).
//
// The rule: every invoice not refunded, its `balanceDue` above zero. An order carries no debt
// until it is invoiced (its advance is the customer's money already paid, not owed).
//
// Walk-ins count. A walk-in sale left owing is still money the shop is owed, so it is in the
// total; it has no customer to belong to (walk-in.ts), so it is gathered under one key,
// WALK_IN_ENTITY (the same one Analytics and Hisaab use), and an invoice with only a typed name
// under `name:<name>` (saleCustomerKey). The customer list shows those two as their own lines
// rather than silently leaving them out of its total.
//
// And what the hisaab holds by hand (2026-10-03, the owner: "yes add dads"): a customer's own
// ledger rows (the old khata, an opening balance, udhaar written in Hisaab) that no invoice
// keeps. Given the ledger, each customer's hand-written balance is added when it is owed to the
// shop (a customer the shop owes does not lower anyone else's debt). Rows linked to an invoice are
// that invoice's balance again and are left out; karigars' rows are not customers' debt.

package erp.core.logic

import erp.core.models.HisaabEntityType
import erp.core.models.HisaabEntry
import erp.core.models.Invoice
import erp.core.models.InvoiceStatus

/** An invoice that is still owed money on. */
fun isOwing(inv: Invoice?): Boolean {
    if (inv == null) return false
    return inv.status != InvoiceStatus.refunded && owesMoney(inv.balanceDue)
}

/** A customer's rows in the order they were first seen, so the sums below add in the order the TS adds them (a JavaScript `Map` remembers insertion order). */
private fun ledgerBalanceList(rows: List<HisaabEntry>): List<Pair<String, Double>> {
    val sums = LinkedHashMap<String, Double>()
    for (r in rows) {
        if (r.entityId.isEmpty() || r.entityType != HisaabEntityType.customer || JS.has(r.linkedInvoiceId)) continue
        sums[r.entityId] = (sums[r.entityId] ?: 0.0) + (r.cashDebit - r.cashCredit)
    }
    return sums.map { it.key to it.value }
}

/** Each customer's hand-written hisaab balance (debit less credit), from rows no invoice keeps. */
fun ledgerBalances(rows: List<HisaabEntry>): Map<String, Double> = ledgerBalanceList(rows).toMap()

data class OwedAmount(
    val amount: Double,
    /** Invoices; 0 for a customer only the ledger knows. */
    val count: Int,
)

class Owed(
    /** Everything owed, walk-ins and the hisaab's hand-written balances included. */
    val total: Double,
    /** The invoices owed on, oldest first: the one to chase. */
    val invoices: List<Invoice>,
    /** By customer: a customer id, WALK_IN_ENTITY, or `name:<typed name>`. `count` is invoices. */
    val byKey: Map<String, OwedAmount>,
    /** What walk-in sales still owe (also in byKey under WALK_IN_ENTITY). */
    val walkIn: Double,
    /** What invoices with only a typed name owe (under `name:` keys). */
    val nameOnly: Double,
    /** What the hisaab holds by hand (also in total and byKey). 0 when no ledger was given. */
    val ledger: Double,
)

fun owedToYou(
    invoices: List<Invoice>,
    currentName: ((String) -> String?)? = null,
    ledgerRows: List<HisaabEntry>? = null,
): Owed {
    val owing = invoices.filter { isOwing(it) }.jsSorted { a, b -> JS.localeCompare(a.createdAt, b.createdAt).toDouble() }
    val byKey = LinkedHashMap<String, OwedAmount>()
    var total = 0.0
    var walkIn = 0.0
    var nameOnly = 0.0
    var ledger = 0.0
    for (inv in owing) {
        val due = inv.balanceDue
        total += due
        val key = saleCustomerKey(inv, currentName)
        if (key == WALK_IN_ENTITY) walkIn += due
        else if (key.startsWith("name:")) nameOnly += due
        val cur = byKey[key] ?: OwedAmount(0.0, 0)
        byKey[key] = OwedAmount(cur.amount + due, cur.count + 1)
    }
    if (ledgerRows != null) {
        for ((key, balance) in ledgerBalanceList(ledgerRows)) {
            if (!owesMoney(balance)) continue
            total += balance
            ledger += balance
            if (key == WALK_IN_ENTITY) walkIn += balance
            val cur = byKey[key] ?: OwedAmount(0.0, 0)
            byKey[key] = OwedAmount(cur.amount + balance, cur.count)
        }
    }
    return Owed(total, owing, byKey, walkIn, nameOnly, ledger)
}
