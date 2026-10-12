package erp.app.screens.customers

import erp.core.models.GivenItem
import erp.core.models.HisaabEntityType
import erp.core.models.HisaabEntry
import erp.core.models.Invoice
import erp.core.models.Order
import erp.core.models.Repair
import java.util.Locale

// Which customers look like one person written twice, and what merging one into another moves
// (CustomerDuplicates.swift). The pairing is src/lib/customer-duplicates.ts line for line (the Customers page's
// "Merge duplicates" list); the counts are what store.ts mergeCustomers rewrites (src/lib/writes/customer-admin.ts),
// counted from the books on the phone so the sheet can say them before it asks for the delete code.

object CustomerDuplicates {
    /** What is looked at, as plain text: easy to hand to another thread, and nothing else about a customer matters. */
    data class Candidate(val id: String, val name: String, val phone: String)

    /** Two customers who look alike: their ids, why, and how sure (best first). */
    data class Found(val a: String, val b: String, val reason: String, val score: Double) {
        /** The pair either way round, as the page keys it. */
        val id: String get() = listOf(a, b).sorted().joinToString("|")
    }

    /** The least alike two names may be to be offered. */
    const val nameMatchFloor = 0.85

    /** `name.toLowerCase().replace(/\s+/g, ' ').trim()`. */
    fun normalizeName(name: String?): String =
        (name ?: "").lowercase(Locale.ROOT).split(Regex("\\s+")).filter { it.isNotEmpty() }.joinToString(" ")

    /** Digits only, leading zeros dropped (`phone.replace(/\D/g, '').replace(/^0+/, '')`). */
    fun normalizePhone(phone: String?): String = (phone ?: "").filter { it in '0'..'9' }.dropWhile { it == '0' }

    /**
     * 1 for the same name, 0.9 for one inside the other, else the share of words they have in common. A blank name is
     * like nothing (the page read it as inside every name).
     */
    fun nameSimilarity(a: String?, b: String?): Double {
        val na = normalizeName(a)
        val nb = normalizeName(b)
        return similarity(na, words(na), nb, words(nb))
    }

    private fun words(normalized: String): Set<String> = normalized.split(' ').filter { it.isNotEmpty() }.toSet()

    private fun similarity(na: String, wa: Set<String>, nb: String, wb: Set<String>): Double {
        if (na.isEmpty() || nb.isEmpty()) return 0.0
        if (na == nb) return 1.0
        if (na.contains(nb) || nb.contains(na)) return 0.9
        val shared = wa.count { wb.contains(it) }
        return shared.toDouble() / maxOf(wa.size, wb.size)
    }

    private class Row(val id: String, val name: String, val words: Set<String>, val hasPhone: Boolean, val phone: String)

    /**
     * The page's `detectDuplicates`: a pair when they share a number, or their names are 85% alike. Best first; equals
     * keep the book's order. Ids in a shelf are one each, so a pair is met once.
     */
    fun detect(people: List<Candidate>): List<Found> {
        val rows = people.map { p ->
            val n = normalizeName(p.name)
            Row(p.id, n, words(n), p.phone.isNotEmpty(), normalizePhone(p.phone))
        }
        val found = ArrayList<Found>()
        for (i in rows.indices) {
            val a = rows[i]
            for (j in i + 1 until rows.size) {
                val b = rows[j]
                if (a.hasPhone && b.hasPhone && a.phone.isNotEmpty() && a.phone == b.phone) {
                    found += Found(a.id, b.id, "Same phone number", 1.0)
                    continue
                }
                val sim = similarity(a.name, a.words, b.name, b.words)
                if (sim >= nameMatchFloor) {
                    found += Found(a.id, b.id, "Similar name (${Math.floor(sim * 100 + 0.5).toInt()}% match)", sim)
                }
            }
        }
        // JavaScript's sort is stable and so is Kotlin's: equal scores keep the book's order.
        return found.sortedByDescending { it.score }
    }
}

// MARK: What a merge moves

/** What follows the duplicate when it is merged away: its invoices, orders and repair tickets, its own hisaab rows, and the things given to it. */
data class CustomerMergeCounts(
    val invoices: Int = 0,
    val orders: Int = 0,
    val hisaab: Int = 0,
    val given: Int = 0,
    val repairs: Int = 0,
) {
    val total: Int get() = invoices + orders + hisaab + given + repairs

    /** "3 invoices, 1 order, 2 hisaab rows and 1 given item", only the kinds there are; "nothing" for none. */
    val sentence: String
        get() {
            val parts = ArrayList<String>()
            fun add(n: Int, one: String, many: String) { if (n > 0) parts += "$n ${if (n == 1) one else many}" }
            add(invoices, "invoice", "invoices")
            add(orders, "order", "orders")
            add(repairs, "repair", "repairs")
            add(hisaab, "hisaab row", "hisaab rows")
            add(given, "given item", "given items")
            return when (parts.size) {
                0 -> "nothing"
                1 -> parts[0]
                else -> parts.dropLast(1).joinToString(", ") + " and " + parts.last()
            }
        }
}

/** The books counted once by customer, so a list of pairs does not search them for each. */
class CustomerMergeBook(
    invoices: List<Invoice>,
    orders: List<Order>,
    hisaab: List<HisaabEntry>,
    given: List<GivenItem>,
    repairs: List<Repair>,
) {
    private val invoiceCounts = HashMap<String, Int>()
    private val orderCounts = HashMap<String, Int>()
    private val hisaabCounts = HashMap<String, Int>()
    private val givenCounts = HashMap<String, Int>()
    private val repairCounts = HashMap<String, Int>()

    init {
        for (i in invoices) i.customerId?.takeIf { it.isNotEmpty() }?.let { invoiceCounts.merge(it, 1, Int::plus) }
        for (o in orders) o.customerId?.takeIf { it.isNotEmpty() }?.let { orderCounts.merge(it, 1, Int::plus) }
        for (h in hisaab) if (h.entityType == HisaabEntityType.customer) hisaabCounts.merge(h.entityId, 1, Int::plus)
        for (g in given) g.recipientId?.takeIf { it.isNotEmpty() }?.let { givenCounts.merge(it, 1, Int::plus) }
        for (r in repairs) r.customerId?.takeIf { it.isNotEmpty() }?.let { repairCounts.merge(it, 1, Int::plus) }
    }

    fun counts(id: String): CustomerMergeCounts = CustomerMergeCounts(
        invoices = invoiceCounts[id] ?: 0,
        orders = orderCounts[id] ?: 0,
        hisaab = hisaabCounts[id] ?: 0,
        given = givenCounts[id] ?: 0,
        repairs = repairCounts[id] ?: 0,
    )
}
