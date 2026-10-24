package erp.app.nav

import erp.core.models.Customer
import erp.core.models.Invoice
import erp.core.models.Order
import erp.core.models.Product
import erp.core.models.Repair

/**
 * What the typed words find, per kind (SearchHome.swift `SearchResults`). A shelf the person cannot read answers an
 * error and holds nothing, so its kind gives no rows and its section is left out without a word.
 */
data class SearchResults(
    val places: List<NavHit> = emptyList(),
    val customers: List<Customer> = emptyList(),
    val invoices: List<Invoice> = emptyList(),
    val orders: List<Order> = emptyList(),
    val stock: List<Product> = emptyList(),
    val repairs: List<Repair> = emptyList(),
) {
    val isEmpty: Boolean get() = places.isEmpty() && customers.isEmpty() && invoices.isEmpty() && orders.isEmpty() && stock.isEmpty() && repairs.isEmpty()

    companion object {
        /** [q] is the typed words, trimmed (case does not matter). The books are left out for those who cannot read them (marketing). */
        fun of(
            q: String,
            map: NavMap,
            customers: List<Customer> = emptyList(),
            invoices: List<Invoice> = emptyList(),
            orders: List<Order> = emptyList(),
            stock: List<Product> = emptyList(),
            repairs: List<Repair> = emptyList(),
        ): SearchResults {
            val w = q.trim().lowercase()
            if (w.isEmpty()) return SearchResults()
            val places = map.allPlaces.filter { item ->
                item.place.label.lowercase().contains(w) ||
                    (item.place.keywords ?: emptyList()).any { it.lowercase().contains(w) } ||
                    (item.entry?.label?.lowercase() ?: "").contains(w)
            }
            // A phone is matched by its digits, and only once there are four (a short run would match half the book).
            val digits = w.filter { it.isDigit() }
            val byPhone = digits.length >= 4
            return SearchResults(
                places = places,
                customers = customers.filter { c ->
                    if (!c.deletedAt.isNullOrEmpty()) return@filter false
                    if (c.name.lowercase().contains(w)) return@filter true
                    byPhone && listOf(c.phone.orEmpty(), c.altPhone.orEmpty()).any { p -> p.filter { it.isDigit() }.contains(digits) }
                },
                invoices = invoices.filter { it.id.lowercase().contains(w) || it.customerName.lowercase().contains(w) },
                orders = orders.filter { it.id.lowercase().contains(w) || (it.customerName ?: "").lowercase().contains(w) },
                stock = stock.filter { it.sku.lowercase().contains(w) || it.name.lowercase().contains(w) },
                repairs = repairs.filter { it.id.lowercase().contains(w) || it.customerName.lowercase().contains(w) },
            )
        }
    }
}

/** The idle list: the map's groups with Home's own row left out (Home is a tab), the unlabelled group shown as "Overview". */
data class SearchGroup(val key: String, val label: String, val entries: List<NavEntry>)

object SearchLogic {
    /**
     * Home's unlabelled group holds Analytics too, which was listed nowhere (owner, 2026-10-24: "where is the analytics
     * tab"): it leads the list, under the name "Overview".
     */
    fun groups(map: NavMap): List<SearchGroup> = map.groups.mapNotNull { g ->
        val entries = map.entries.filter { it.group == g.key && it.id != "home" }
        if (entries.isEmpty()) null else SearchGroup(g.key, g.label.ifEmpty { "Overview" }, entries)
    }

    /** A sectioned entry (Analytics) also lists each section after its first as a quiet row opening that section's first page. */
    fun sectionRows(e: NavEntry): List<Pair<String, NavPlace>> =
        e.sections.drop(1).mapNotNull { name -> e.tabsIn(name).firstOrNull()?.let { "${e.label}: $name" to it } }
}
