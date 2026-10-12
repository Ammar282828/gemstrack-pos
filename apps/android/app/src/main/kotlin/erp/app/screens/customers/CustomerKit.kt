package erp.app.screens.customers

import erp.app.nav.ScreenRoute
import erp.app.ui.Tone
import erp.app.ui.toWhatsAppNumber
import erp.core.ERPDate
import erp.core.entry.NewOrderFormat
import erp.core.logic.Owed
import erp.core.logic.WALK_IN_ENTITY
import erp.core.logic.ledgerBalances
import erp.core.logic.owedToYou
import erp.core.models.Customer
import erp.core.models.CustomerSource
import erp.core.models.HisaabEntry
import erp.core.models.Invoice
import erp.core.models.InvoiceStatus
import erp.core.models.Order
import erp.core.models.OrderStatus
import erp.core.models.Repair
import erp.core.models.RepairStatus
import java.text.Collator
import java.time.Instant
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * What the three customer screens share: paths, words, the phone's links, and the customer list's own figures
 * (CustomerKit.swift). The money rules are core's (`owedToYou`, `ledgerBalances`, `balanceLine`); what is here is only
 * what customers/page.tsx works out for itself.
 */
object CustomerKit {

    // MARK: Paths

    /** "/customers/CUST-1" is the customer "CUST-1". Null for the list, "add", a deeper page, and `?web=1`. */
    fun id(fromPath: String): String? {
        if (asksForWeb(fromPath)) return null
        val prefix = "/customers/"
        val bare = ScreenRoute.bare(fromPath)
        if (!bare.startsWith(prefix)) return null
        val rest = bare.drop(prefix.length)
        if (rest.isEmpty() || rest.contains('/') || rest == "add") return null
        return ScreenRoute.percentDecode(rest)
    }

    /** "/customers/CUST-1/edit" is the edit form of "CUST-1"; null for any other path and for `?web=1`. */
    fun editId(fromPath: String): String? {
        if (asksForWeb(fromPath)) return null
        val prefix = "/customers/"
        val suffix = "/edit"
        val bare = ScreenRoute.bare(fromPath)
        if (!bare.startsWith(prefix) || !bare.endsWith(suffix)) return null
        if (bare.length < prefix.length + suffix.length) return null
        val rest = bare.substring(prefix.length, bare.length - suffix.length)
        if (rest.isEmpty() || rest.contains('/')) return null
        return ScreenRoute.percentDecode(rest)
    }

    fun isList(path: String): Boolean = !asksForWeb(path) && ScreenRoute.bare(path) == "/customers"

    fun asksForWeb(path: String): Boolean {
        val query = path.substringBefore('#').let { if (it.contains('?')) it.substringAfter('?') else return false }
        return query.split('&').contains("web=1")
    }

    /** An id as one path piece ("CUST-1", or a Shopify name with a "#" in it). */
    fun piece(id: String): String {
        val out = StringBuilder()
        for (b in id.toByteArray(Charsets.UTF_8)) {
            val c = (b.toInt() and 0xFF).toChar()
            if (c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c == '-' || c == '_' || c == '.' || c == '~') out.append(c)
            else out.append('%').append("%02X".format(b.toInt() and 0xFF))
        }
        return out.toString()
    }

    /** The customer's page, or a page beneath it ("/edit"), or the ERP's own with "?web=1". */
    fun path(id: String, suffix: String = ""): String = "/customers/" + piece(id) + suffix

    /** A place by prefix and id: "/invoices/" + "INV-000123". */
    fun place(prefix: String, id: String): String = prefix + piece(id)

    fun hisaabPath(id: String): String = "/hisaab/" + piece(id) + "?type=customer"

    // MARK: Words

    /** The ERP's `CUSTOMER_SOURCES`, in its order. */
    val sources: List<CustomerSource> = listOf(
        CustomerSource.taheriSpillover, CustomerSource.referral, CustomerSource.walkin,
        CustomerSource.socialMedia, CustomerSource.website, CustomerSource.other,
    )

    /** `CUSTOMER_SOURCE_LABELS` (store.ts). */
    fun sourceLabel(source: CustomerSource): String = when (source) {
        CustomerSource.taheriSpillover -> "Taheri Spillover"
        CustomerSource.referral -> "Referral"
        CustomerSource.walkin -> "Walk-in"
        CustomerSource.socialMedia -> "Social media"
        CustomerSource.website -> "Website"
        CustomerSource.other -> "Other"
        else -> source.rawValue
    }

    fun shown(customer: Customer): String = if (trim(customer.name).isEmpty()) "Unnamed customer" else customer.name

    fun trim(s: String?): String = NewOrderFormat.trim(s ?: "")

    /** The text if there is any, else null. */
    fun filled(s: String?): String? = trim(s).ifEmpty { null }

    /** The web's `z.string().email()`, loosely: something, an @, something with a dot. Blank is fine (the field is optional). */
    fun validEmail(email: String): Boolean {
        val e = trim(email)
        if (e.isEmpty()) return true
        val parts = e.split('@')
        return parts.size == 2 && parts[0].isNotEmpty() && parts[1].contains('.') && !e.contains(' ')
    }

    /** Removal hides, it does not destroy (store.ts splitRemoved): a customer with a `deletedAt` is out of every list. */
    fun isRemoved(customer: Customer): Boolean = !customer.deletedAt.isNullOrEmpty()

    private fun format(pattern: String) = DateTimeFormatter.ofPattern(pattern, Locale.UK).withZone(ERPDate.karachi)
    private val monthYearFormat = format("MMM yyyy")
    private val dayFormat = format("d MMM yyyy")

    /** "Oct 2026" (the list's "last sale"). */
    fun monthYear(iso: String?): String = ERPDate.parse(iso)?.let { monthYearFormat.format(it) } ?: ""

    /** A birthday or anniversary: "6 Oct 1990", whichever year it is (never "Today"). Unreadable text is shown as written. */
    fun day(s: String?): String = ERPDate.parse(s)?.let { dayFormat.format(it) } ?: trim(s)

    /** Up to three places, no grouping: "3.4", "14.25" (en_US decimal). */
    fun grams(g: Double): String = NewOrderFormat.trimmed(g, 3)

    // MARK: The phone's links

    /** What can be dialled: digits, and a leading "+". */
    fun dialable(phone: String?): String {
        val out = StringBuilder()
        for (ch in trim(phone)) {
            if (ch == '+' && out.isEmpty()) out.append(ch)
            else if (ch in '0'..'9') out.append(ch)
        }
        return out.toString()
    }

    fun callUri(phone: String?): String? = dialable(phone).ifEmpty { null }?.let { "tel:$it" }

    fun messageUri(phone: String?): String? = dialable(phone).ifEmpty { null }?.let { "smsto:$it" }

    fun whatsAppUri(phone: String?): String? = whatsAppNumber(phone).ifEmpty { null }?.let { "https://wa.me/$it" }

    /** Digits with the country code, Pakistan's when the number is written the Pakistani way. */
    fun whatsAppNumber(phone: String?): String = toWhatsAppNumber(phone)

    // MARK: Owed, spent, last sale (customers/page.tsx)

    /** Lifetime spend, what is still owed, and when they last bought (the page's `CustomerStats`). */
    data class Stats(val spent: Double = 0.0, val owed: Double = 0.0, val count: Int = 0, val lastAt: String? = null)

    /**
     * One "owed" for the whole ERP (lib/owed.ts). `ledger` is null for staff: they have no hisaab, so the figure is
     * invoices alone, as on their web page. The name lookup is the live book only.
     */
    fun owed(invoices: List<Invoice>, customers: List<Customer>, ledger: List<HisaabEntry>?): Owed {
        val live = HashMap<String, String>()
        for (c in customers) if (!isRemoved(c)) live[c.id] = c.name
        return owedToYou(invoices, currentName = { live[it] }, ledgerRows = ledger)
    }

    // TODO(logic): this is customers/page.tsx's `statsById`, local to that page, not a src/lib rule.
    /**
     * Spend and last sale per customer from invoices (not refunded) and orders still open; what they owe is
     * `owedToYou`'s, the dashboard's own figure. A customer known only from the hisaab still owes.
     */
    fun stats(invoices: List<Invoice>, orders: List<Order>, owed: Owed): Map<String, Stats> {
        val map = LinkedHashMap<String, Stats>()
        fun bump(id: String?, total: Double, at: String) {
            if (id.isNullOrEmpty()) return
            val cur = map[id] ?: Stats()
            var last = cur.lastAt
            if (at.isNotEmpty()) {
                last = if (last != null) (if (at > last) at else last) else at
            }
            map[id] = cur.copy(spent = cur.spent + total, count = cur.count + 1, lastAt = last)
        }
        for (inv in invoices) if (inv.status != InvoiceStatus.refunded) bump(inv.customerId, inv.grandTotal, inv.createdAt)
        for ((key, o) in owed.byKey) {
            val cur = map[key]
            if (cur != null) map[key] = cur.copy(owed = o.amount)
            else if (!key.startsWith("name:") && key != WALK_IN_ENTITY) map[key] = Stats(spent = 0.0, owed = o.amount, count = 0, lastAt = null)
        }
        for (o in orders) {
            if (!o.invoiceId.isNullOrEmpty() || o.status == OrderStatus.cancelled || o.status == OrderStatus.refunded) continue
            bump(o.customerId, o.subtotal, o.createdAt)
        }
        return map
    }

    /** What one customer owes, in the parts the screen says. */
    data class Owing(
        val total: Double = 0.0,
        val onInvoices: Double = 0.0,
        /** The hisaab's hand-written balance, when it is owed to the shop (it is in `total`). */
        val inHisaab: Double = 0.0,
        /** The hisaab's hand-written balance when the shop owes them; it lowers nothing. */
        val shopOwesThem: Double = 0.0,
        val invoiceCount: Int = 0,
    )

    fun owing(id: String, owed: Owed, ledger: List<HisaabEntry>?): Owing {
        val mine = owed.byKey[id]
        val total = mine?.amount ?: 0.0
        var inHisaab = 0.0
        var shopOwes = 0.0
        if (ledger != null) {
            val hand = ledgerBalances(ledger)[id] ?: 0.0
            if (hand > 0.5) inHisaab = hand else if (hand < -0.5) shopOwes = -hand
        }
        return Owing(
            total = total, onInvoices = maxOf(0.0, total - inHisaab), inHisaab = inHisaab,
            shopOwesThem = shopOwes, invoiceCount = mine?.count ?: 0,
        )
    }

    // MARK: Who comes first (customers/page.tsx)

    data class Groups(
        val owing: List<Customer> = emptyList(),
        val active: List<Customer> = emptyList(),
        val quiet: List<Customer> = emptyList(),
    )

    const val dormantAfterMonths = 12

    private val collator: Collator = Collator.getInstance(Locale.ENGLISH).apply { strength = Collator.SECONDARY }

    /**
     * Grouped by the reason you would be looking someone up: money outstanding first (most owed first), then people
     * who bought in the last year (latest first), then everyone else (A to Z).
     */
    fun groups(people: List<Customer>, stats: Map<String, Stats>, now: Instant = Instant.now()): Groups {
        val cutoff = ERPDate.iso(ZonedDateTime.ofInstant(now, ERPDate.karachi).minusMonths(dormantAfterMonths.toLong()).toInstant())
        val owing = ArrayList<Customer>()
        val active = ArrayList<Customer>()
        val quiet = ArrayList<Customer>()
        for (c in people) {
            val s = stats[c.id]
            val last = s?.lastAt
            if (s != null && s.owed > 0) owing += c
            else if (last != null && last >= cutoff) active += c
            else quiet += c
        }
        // JavaScript's sort is stable, and so is Kotlin's: ties keep the book's order.
        return Groups(
            owing = owing.sortedWith { a, b -> (stats[b.id]?.owed ?: 0.0).compareTo(stats[a.id]?.owed ?: 0.0) },
            active = active.sortedWith { a, b ->
                val la = stats[a.id]?.lastAt ?: ""
                val lb = stats[b.id]?.lastAt ?: ""
                if (la == lb) 0 else if (lb < la) -1 else 1
            },
            quiet = quiet.sortedWith { a, b -> collator.compare(a.name, b.name) },
        )
    }

    /** The list's search: name, phone or email (customers/page.tsx `matched`). */
    fun matches(c: Customer, query: String): Boolean {
        val q = trim(query)
        if (q.isEmpty()) return true
        val lower = q.lowercase(Locale.ROOT)
        return c.name.lowercase(Locale.ROOT).contains(lower) ||
            (c.phone ?: "").contains(q) ||
            (c.email ?: "").lowercase(Locale.ROOT).contains(lower)
    }

    // MARK: Repairs (src/lib/store.ts)

    // TODO(shared): replace with core's repairTotal / repairPaid / repairBalance / repairSummary when Repairs.swift is ported.
    private fun jsRound(x: Double): Double = Math.floor(x + 0.5)

    /** What the customer still owes on the ticket. */
    fun repairBalance(r: Repair): Double {
        val total = r.pieces.fold(0.0) { sum, p -> sum + (p.price?.takeIf { !it.isNaN() } ?: 0.0) }
        val paid = r.payments.fold(0.0) { sum, p -> sum + (if (p.amount.isNaN()) 0.0 else p.amount) }
        return maxOf(0.0, jsRound((total - paid) * 100) / 100)
    }

    /** "Gold ring" or "Gold ring + 2 more": a ticket in a line. */
    fun repairSummary(r: Repair): String {
        val named = r.pieces.filter { it.item.isNotEmpty() }
        if (named.isEmpty()) return "Repair"
        return if (named.size == 1) named[0].item else "${named[0].item} + ${named.size - 1} more"
    }

    /** The repair's steps in the shop's words: In the shop, Ready, Collected. */
    fun repairStatus(s: RepairStatus): Pair<String, Tone> = when (s) {
        RepairStatus.received -> "In the shop" to Tone.owed
        RepairStatus.ready -> "Ready" to Tone.settled
        RepairStatus.collected -> "Collected" to Tone.quiet
        RepairStatus.cancelled -> "Cancelled" to Tone.quiet
        else -> (if (s.rawValue.isEmpty()) "No status" else s.rawValue) to Tone.quiet
    }
}
