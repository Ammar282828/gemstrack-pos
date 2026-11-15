// Ported from src/lib/collect.ts (tests: CollectTests, from collect.test.ts case for case).
//
// Who still owes the shop, one row per bill (the owner, 2026-11-14). Two kinds of row:
//  - an invoice not refunded whose balance is still due (`isOwing`, the same rule as every other "owed" figure);
//  - an order marked Completed that has not been invoiced yet and still has a balance (`grandTotal` is the balance after
//    its advances). An invoiced order's debt is its invoice's, so it is never counted twice.
// Never the hisaab's own entries: this reads bills only. Docs: docs/decisions.md#to-collect.

package erp.core.logic

import erp.core.models.Invoice
import erp.core.models.Order
import erp.core.models.OrderStatus
import java.time.Instant

enum class CollectKind { invoice, order }

data class CollectRow(
    val kind: CollectKind,
    val id: String,
    /** Where the row opens: `/invoices/<id>` or `/orders/<id>`. */
    val href: String,
    val customerName: String,
    val customerId: String?,
    val phone: String?,
    /** When the bill was written (the invoice's, or the order's, date). */
    val date: String,
    /** The bill's full amount, and what is still to come. */
    val total: Double,
    val due: Double,
    /** Who took it at the counter; "" when nobody was recorded. */
    val takenBy: String,
)

enum class CollectSort { oldest, amount, takenBy }
enum class CollectAge { under30, from30to90, over90 }
enum class CollectPaid { nothing, part }

data class PersonTotal(val takenBy: String, val count: Int, val due: Double)
data class CountDue(val count: Int, val due: Double)

/**
 * Filters, several at once. The person is the main one; bill, age and paid narrow it. Within a group any chosen value
 * passes (Mansoor OR Murtaza); across groups all must. An empty group lets everything through.
 */
data class CollectFilters(
    val people: Set<String> = emptySet(),
    val kinds: Set<CollectKind> = emptySet(),
    val ages: Set<CollectAge> = emptySet(),
    val paid: Set<CollectPaid> = emptySet(),
    /** A customer's name or number, or the bill's id. */
    val query: String = "",
) {
    /** How many filters are on (each chosen value counts; the search counts once if it has text). */
    val on: Int get() = people.size + kinds.size + ages.size + paid.size + (if (JS.trim(query).isEmpty()) 0 else 1)

    companion object {
        val none = CollectFilters()
    }
}

enum class CollectGroup { people, kinds, ages, paid, query }

object Collect {
    const val NOBODY = ""

    /** order-payment.ts `orderFullTotal`: the order's full amount, never less the advance. */
    fun orderFullTotal(o: Order): Double {
        val subtotal = o.subtotal
        if (subtotal.isFinite() && subtotal > 0) return maxOf(0.0, subtotal - JS.orZero(o.discountAmount))
        return maxOf(0.0, JS.orZero(o.grandTotal) + JS.orZero(o.advancePayment) + JS.orZero(o.advanceInExchangeValue))
    }

    fun rows(invoices: List<Invoice>, orders: List<Order>): List<CollectRow> {
        val out = mutableListOf<CollectRow>()
        for (inv in invoices) {
            if (!isOwing(inv)) continue
            out.add(
                CollectRow(
                    kind = CollectKind.invoice, id = inv.id, href = "/invoices/${inv.id}",
                    customerName = inv.customerName.ifEmpty { "Walk-in" }, customerId = inv.customerId?.ifEmpty { null },
                    phone = inv.customerContact?.ifEmpty { null },
                    date = inv.createdAt, total = invoiceSaleValue(inv), due = JS.round(JS.orZero(inv.balanceDue)),
                    takenBy = inv.takenBy ?: NOBODY,
                ),
            )
        }
        for (o in orders) {
            if (o.status != OrderStatus.completed || JS.has(o.invoiceId) || !owesMoney(o.grandTotal)) continue
            out.add(
                CollectRow(
                    kind = CollectKind.order, id = o.id, href = "/orders/${o.id}",
                    customerName = o.customerName?.ifEmpty { null } ?: "Walk-in", customerId = o.customerId?.ifEmpty { null },
                    phone = o.customerContact?.ifEmpty { null },
                    date = o.createdAt, total = orderFullTotal(o), due = JS.round(JS.orZero(o.grandTotal)),
                    takenBy = o.takenBy ?: NOBODY,
                ),
            )
        }
        return out
    }

    private fun oldest(a: CollectRow, b: CollectRow): Int = JS.localeCompare(a.date, b.date)

    /** A last-sorting key for "nobody recorded" (the TS's U+FFFF). */
    private fun takenKey(r: CollectRow): String = r.takenBy.ifEmpty { "￿" }

    fun sort(rows: List<CollectRow>, by: CollectSort): List<CollectRow> = when (by) {
        CollectSort.amount -> rows.sortedWith { a, b -> val d = b.due.compareTo(a.due); if (d != 0) d else oldest(a, b) }
        CollectSort.takenBy -> rows.sortedWith { a, b -> val d = JS.localeCompare(takenKey(a), takenKey(b)); if (d != 0) d else oldest(a, b) }
        CollectSort.oldest -> rows.sortedWith(::oldest)
    }

    /** By who took them: each person's rows' count and total due, the largest first; nobody recorded last. */
    fun byTakenBy(rows: List<CollectRow>): List<PersonTotal> {
        val m = LinkedHashMap<String, CountDue>()
        for (r in rows) {
            val e = m[r.takenBy] ?: CountDue(0, 0.0)
            m[r.takenBy] = CountDue(e.count + 1, e.due + r.due)
        }
        return m.map { PersonTotal(it.key, it.value.count, it.value.due) }
            .sortedWith { a, b ->
                val n = (if (a.takenBy == NOBODY) 1 else 0) - (if (b.takenBy == NOBODY) 1 else 0)
                if (n != 0) n else b.due.compareTo(a.due)
            }
    }

    private const val DAY_MS = 86_400_000.0

    fun ageOf(r: CollectRow, now: Instant = Instant.now()): CollectAge {
        // An unreadable date is NaN days in the TS: neither over 90 nor 30 or more.
        val at = JS.newDate(r.date) ?: return CollectAge.under30
        val days = Math.floor((JS.ms(now) - JS.ms(at)) / DAY_MS)
        return if (days > 90) CollectAge.over90 else if (days >= 30) CollectAge.from30to90 else CollectAge.under30
    }

    /** Calendar days the bill has waited (page.tsx `differenceInCalendarDays`, in the shop's Karachi days); 0 when its date cannot be read. */
    fun daysWaiting(r: CollectRow, now: Instant = Instant.now()): Int {
        val at = JS.parseISO(r.date) ?: return 0
        return JS.calendarDays(now, at)
    }

    fun paidOf(r: CollectRow): CollectPaid = if (r.due >= r.total) CollectPaid.nothing else CollectPaid.part

    /** Does a row pass every filter but `skip` (so each chip can count what choosing it would add)? */
    fun passes(r: CollectRow, f: CollectFilters, skip: CollectGroup? = null, now: Instant = Instant.now()): Boolean {
        if (skip != CollectGroup.people && f.people.isNotEmpty() && r.takenBy !in f.people) return false
        if (skip != CollectGroup.kinds && f.kinds.isNotEmpty() && r.kind !in f.kinds) return false
        if (skip != CollectGroup.ages && f.ages.isNotEmpty() && ageOf(r, now) !in f.ages) return false
        if (skip != CollectGroup.paid && f.paid.isNotEmpty() && paidOf(r) !in f.paid) return false
        val q = JS.trim(f.query).lowercase()
        if (skip != CollectGroup.query && q.isNotEmpty()) {
            val digits = q.filter { it in '0'..'9' }
            val hay = "${r.customerName} ${r.id}".lowercase()
            if (!hay.contains(q) && !(digits.length >= 3 && (r.phone ?: "").filter { it in '0'..'9' }.contains(digits))) return false
        }
        return true
    }

    fun filter(rows: List<CollectRow>, f: CollectFilters, now: Instant = Instant.now()): List<CollectRow> =
        rows.filter { passes(it, f, null, now) }

    /** How many rows each value of a group would show, with the other groups' filters on. */
    fun <V> countBy(rows: List<CollectRow>, f: CollectFilters, group: CollectGroup, now: Instant = Instant.now(), valueOf: (CollectRow) -> V): Map<V, CountDue> {
        val m = LinkedHashMap<V, CountDue>()
        for (r in rows) {
            if (!passes(r, f, group, now)) continue
            val v = valueOf(r)
            val e = m[v] ?: CountDue(0, 0.0)
            m[v] = CountDue(e.count + 1, e.due + r.due)
        }
        return m
    }

    /** The chip words, as the page prints them. */
    fun kindWord(k: CollectKind): String = if (k == CollectKind.invoice) "Invoices" else "Completed orders"

    fun ageWord(a: CollectAge): String = when (a) {
        CollectAge.under30 -> "Under 30 days"
        CollectAge.from30to90 -> "30–90 days"
        CollectAge.over90 -> "Over 90 days"
    }

    fun paidWord(p: CollectPaid): String = if (p == CollectPaid.nothing) "Nothing paid" else "Part paid"

    /** A person's name, or "Not recorded" for nobody. */
    fun who(takenBy: String): String = takenBy.ifEmpty { "Not recorded" }

    /** The title of the one list when not grouped by person (page.tsx). */
    fun listTitle(f: CollectFilters): String =
        if (f.people.size == 1) who(f.people.first()) else if (f.on > 0) "Filtered" else "Everyone"
}
