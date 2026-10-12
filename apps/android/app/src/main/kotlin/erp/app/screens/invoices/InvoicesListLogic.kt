package erp.app.screens.invoices

import erp.core.ERPDate
import erp.core.logic.BalanceState
import erp.core.logic.balanceLine
import erp.core.logic.isOwing
import erp.core.logic.owedToYou
import erp.core.models.Invoice
import erp.core.models.InvoiceStatus
import java.time.Instant
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.temporal.TemporalAdjusters
import java.util.Locale

// The Invoices list's pure rules (InvoicesList.swift): how it is grouped, filtered, searched and summed, in
// Karachi's days. Kept apart from the screen so they are tested on the JVM.

/** How the list is broken up (invoices/page.tsx `groupBy`): by day to start (the owner, 2026-10-05), or by status to chase what is owed. */
enum class InvoiceGrouping(val title: String) {
    day("Day"), week("Week"), month("Month"), status("Status"),
}

/** The page's tabs and statuses as one row of chips: what is owed, what is settled, what is in credit. */
enum class InvoiceChip(val title: String) {
    all("All"), unpaid("Unpaid"), paid("Paid"), credit("In credit"), shopify("Shopify");

    fun matches(inv: Invoice): Boolean = when (this) {
        all -> true
        unpaid -> isOwing(inv)
        paid -> inv.status != InvoiceStatus.refunded && balanceLine(inv.balanceDue).state == BalanceState.paid
        credit -> inv.status != InvoiceStatus.refunded && balanceLine(inv.balanceDue).state == BalanceState.credit
        shopify -> (inv.source ?: "").startsWith("shopify")
    }
}

/** One section of the list, with what it is worth and what is still owed on it. */
data class InvoiceSection(
    val id: String,
    val title: String,
    /** A word under the heading when nothing is owed on it ("Oldest first"); "" for none. */
    val hint: String,
    val rows: List<Invoice>,
    val billed: Double,
    val owed: Double,
)

/**
 * The three figures at the head of the list: billed today, billed this month, still owed. Each is a tap to the
 * invoices it counts (today's, this month's, the Unpaid chip).
 */
data class InvoiceSummary(
    val today: Double = 0.0,
    val todayCount: Int = 0,
    val month: Double = 0.0,
    val monthCount: Int = 0,
    val owed: Double = 0.0,
    val owedCount: Int = 0,
) {
    enum class Figure { today, month, owed }

    companion object {
        /**
         * Billed as the sections bill (each invoice's grand total, as the web's list sums a day), and owed by the
         * ERP's one rule (lib/owed.ts `owedToYou`, invoices alone: the list has no hisaab).
         */
        fun of(rows: List<Invoice>, now: Instant): InvoiceSummary {
            val today = ERPDate.karachiDay(now)
            val month = today.take(7)
            // Reading a date is the slow part at ten times the books: anything stamped well before this month is passed
            // over by its text ("2026-08-…" sorts before the floor), and only the rest is read as Karachi's day.
            val floor = ERPDate.iso(now.minusSeconds(35L * 86_400)).take(10)
            var todaySum = 0.0
            var todayCount = 0
            var monthSum = 0.0
            var monthCount = 0
            for (inv in rows) {
                if (inv.createdAt.take(10) < floor) continue
                val made = ERPDate.parse(inv.createdAt) ?: continue
                val day = ERPDate.karachiDay(made)
                if (!day.startsWith(month)) continue
                monthSum += inv.grandTotal
                monthCount += 1
                if (day == today) {
                    todaySum += inv.grandTotal
                    todayCount += 1
                }
            }
            val owed = owedToYou(rows)
            return InvoiceSummary(todaySum, todayCount, monthSum, monthCount, owed.total, owed.invoices.size)
        }
    }
}

/** Karachi's days, weeks (from Monday) and months: what the shop means by "today" and "this week". */
object InvoiceCalendar {
    private fun formatter(pattern: String): DateTimeFormatter = DateTimeFormatter.ofPattern(pattern, Locale.UK).withZone(ERPDate.karachi)

    private val dayName = formatter("EEEE d MMM")
    private val dayOfYear = formatter("EEEE d MMM yyyy")
    private val shortDay = formatter("d MMM")
    private val shortDayOfYear = formatter("d MMM yyyy")
    private val fullDay = formatter("d MMM yyyy")
    private val monthName = formatter("MMMM yyyy")
    private val monthOnly = formatter("MMMM")

    private fun date(d: Instant): LocalDate = d.atOffset(ERPDate.karachi).toLocalDate()

    private fun weekStart(d: LocalDate): LocalDate = d.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))

    private fun monthStart(d: LocalDate): LocalDate = d.withDayOfMonth(1)

    private fun at(d: LocalDate): Instant = d.atStartOfDay(ERPDate.karachi).toInstant()

    /** The key the list groups an invoice under: its Karachi day, week (from Monday) or month. */
    fun bucketKey(d: Instant, by: InvoiceGrouping): String = when (by) {
        InvoiceGrouping.month -> "m" + monthStart(date(d))
        InvoiceGrouping.week -> "w" + weekStart(date(d))
        InvoiceGrouping.day, InvoiceGrouping.status -> "d" + ERPDate.karachiDay(d)
    }

    /**
     * A section's heading in the ledger (Invoices, 2026-10-09): "Today", "Yesterday", "Wednesday 7 Oct", "This week",
     * "Week of 28 Sep", "October"; the year only when it is not this one, so a heading never wraps.
     */
    fun heading(d: Instant, by: InvoiceGrouping, now: Instant): String {
        val local = date(d)
        val today = date(now)
        val thisYear = local.year == today.year
        return when (by) {
            InvoiceGrouping.month -> (if (thisYear) monthOnly else monthName).format(at(monthStart(local)))
            InvoiceGrouping.week -> {
                val start = weekStart(local)
                if (start == weekStart(today)) return "This week"
                "Week of " + (if (start.year == today.year) shortDay else shortDayOfYear).format(at(start))
            }
            InvoiceGrouping.day, InvoiceGrouping.status -> {
                val key = ERPDate.karachiDay(d)
                if (key == ERPDate.karachiDay(now)) return "Today"
                if (key == ERPDate.karachiDay(now.minusSeconds(86_400))) return "Yesterday"
                (if (thisYear) dayName else dayOfYear).format(d)
            }
        }
    }

    /** "1 Oct – 8 Oct 2026", or "From 1 Oct 2026" while the end is open (up to today). */
    fun caption(from: String, to: String?): String {
        val start = ERPDate.parse(from) ?: return from
        val end = to?.let { ERPDate.parse(it) } ?: return "From " + fullDay.format(start)
        return shortDay.format(start) + " – " + fullDay.format(end)
    }

    /** "2026-10" as the shop's month filter keeps it. */
    fun monthKey(iso: String): String? = ERPDate.parse(iso)?.let { ERPDate.karachiDay(it).take(7) }

    fun monthLabel(key: String): String {
        val parts = key.split("-")
        val y = parts.getOrNull(0)?.toIntOrNull() ?: return key
        val m = parts.getOrNull(1)?.toIntOrNull() ?: return key
        if (parts.size != 2 || m !in 1..12) return key
        return monthName.format(at(LocalDate.of(y, m, 1)))
    }

    /** The day a date picker shows, as "yyyy-MM-dd": the picker's own calendar day, whatever time of day it holds. */
    fun day(picked: LocalDate): String = "%04d-%02d-%02d".format(picked.year, picked.monthValue, picked.dayOfMonth)

    /** A "yyyy-MM-dd" day as a date for a picker to show. */
    fun picked(day: String?): LocalDate? {
        if (day == null || day.length != 10) return null
        val parts = day.split("-").mapNotNull { it.toIntOrNull() }
        if (parts.size != 3) return null
        return try { LocalDate.of(parts[0], parts[1], parts[2]) } catch (e: java.time.DateTimeException) { null }
    }
}

/** What narrows the list besides the chip: Taken by, Month, a date range and the search. */
data class InvoiceFilter(
    val search: String = "",
    /** "" is Anyone. */
    val takenBy: String = "",
    /** "" is all time, else "yyyy-MM". */
    val month: String = "",
    /** A span of days, "yyyy-MM-dd": from the first to the last, or to today while the end is open. Nothing without a start. */
    val rangeFrom: String? = null,
    val rangeTo: String? = null,
)

/** Searching, narrowing and grouping (InvoicesList's `scope`, `matches`, `sections`). */
object InvoicesListRules {
    /**
     * Search, Taken by, Month and the date range: everything but the chip, so the chips can count what they would
     * show. `phones` is the customer book's numbers by id, used only when a phone number is searched.
     */
    fun scope(all: List<Invoice>, f: InvoiceFilter, phones: () -> Map<String, String>, now: Instant): List<Invoice> {
        var out = all
        if (f.takenBy.isNotEmpty()) out = out.filter { it.takenBy == f.takenBy }
        if (f.month.isNotEmpty()) out = out.filter { InvoiceCalendar.monthKey(it.createdAt) == f.month }
        val start = f.rangeFrom
        if (start != null) {
            // The last day included; open, it runs to the end of today (isWithinInterval, invoices/page.tsx).
            val end = f.rangeTo ?: ERPDate.karachiDay(now)
            out = out.filter { inv ->
                val made = ERPDate.parse(inv.createdAt) ?: return@filter false
                val day = ERPDate.karachiDay(made)
                day >= start && day <= end
            }
        }
        val q = f.search.trim()
        if (q.isNotEmpty()) {
            // The customer's own number, for an invoice that does not carry one.
            val digits = q.filter { it in '0'..'9' }
            val wanted = digits.trimStart('0')
            val book = if (wanted.length >= 3) phones() else emptyMap()
            out = out.filter { matches(it, q, wanted, book) }
        }
        return out
    }

    /** Customer, phone, invoice id, a piece's SKU or its name ("drop earrings": the counter remembers what was sold). */
    fun matches(inv: Invoice, q: String, digits: String, phones: Map<String, String>): Boolean {
        if (inv.id.contains(q, ignoreCase = true)) return true
        if (inv.customerName.contains(q, ignoreCase = true)) return true
        if (inv.items.any { it.sku.contains(q, ignoreCase = true) || it.name.contains(q, ignoreCase = true) }) return true
        if (digits.length >= 3) {
            val own = inv.customerContact ?: ""
            val theirs = inv.customerId?.let { phones[it] } ?: ""
            for (p in listOf(own, theirs)) {
                if (p.filter { it in '0'..'9' }.contains(digits)) return true
            }
        }
        return false
    }

    fun sections(rows: List<Invoice>, grouping: InvoiceGrouping, now: Instant): List<InvoiceSection> {
        if (grouping == InvoiceGrouping.status) return statusSections(rows)
        val order = mutableListOf<String>()
        val titles = HashMap<String, String>()
        val members = HashMap<String, MutableList<Invoice>>()
        for (inv in rows) {
            val d = ERPDate.parse(inv.createdAt)
            val key: String
            if (d != null) {
                key = InvoiceCalendar.bucketKey(d, grouping)
                if (titles[key] == null) titles[key] = InvoiceCalendar.heading(d, grouping, now)
            } else {
                key = "undated"
                if (titles[key] == null) titles[key] = "No date"
            }
            if (members[key] == null) order.add(key)
            members.getOrPut(key) { mutableListOf() }.add(inv)
        }
        return order.map { key -> makeSection(key, titles[key] ?: "", "", members[key] ?: emptyList()) }
    }

    /** Awaiting payment (the oldest debt first: that is the one to chase), then Settled. */
    fun statusSections(rows: List<Invoice>): List<InvoiceSection> {
        val owing = rows.filter { isOwing(it) }.sortedBy { it.createdAt }
        val settled = rows.filter { !isOwing(it) }
        val out = mutableListOf<InvoiceSection>()
        if (owing.isNotEmpty()) out.add(makeSection("owing", "Awaiting payment", "Oldest first", owing))
        if (settled.isNotEmpty()) out.add(makeSection("settled", "Settled", "Nothing outstanding", settled))
        return out
    }

    fun makeSection(id: String, title: String, hint: String, rows: List<Invoice>): InvoiceSection {
        var billed = 0.0
        var owed = 0.0
        for (inv in rows) {
            billed += inv.grandTotal
            if (isOwing(inv)) owed += inv.balanceDue
        }
        return InvoiceSection(id, title, hint, rows, billed, owed)
    }

    /** The chips the filter offers: Credit and Shopify only when something would match (or one is chosen). */
    fun visibleChips(scoped: List<Invoice>, chosen: InvoiceChip): List<InvoiceChip> = InvoiceChip.values().filter { c ->
        when (c) {
            InvoiceChip.credit, InvoiceChip.shopify -> c == chosen || scoped.any { c.matches(it) }
            else -> true
        }
    }

    /** Something besides the three chips is narrowing the list. */
    fun filterActive(f: InvoiceFilter, chip: InvoiceChip): Boolean =
        f.takenBy.isNotEmpty() || f.month.isNotEmpty() || f.rangeFrom != null ||
            (chip != InvoiceChip.all && chip != InvoiceChip.unpaid && chip != InvoiceChip.paid)

    /** Anything at all narrows it (the empty state says "No matches" then). */
    fun filtering(f: InvoiceFilter, chip: InvoiceChip): Boolean =
        f.search.isNotEmpty() || f.takenBy.isNotEmpty() || f.month.isNotEmpty() || f.rangeFrom != null || chip != InvoiceChip.all

    /** What the list is narrowed to, as the caption under the chips says it. */
    fun caption(f: InvoiceFilter, chip: InvoiceChip): String = listOf(
        if (chip == InvoiceChip.all) "" else chip.title,
        f.takenBy,
        if (f.month.isEmpty()) "" else InvoiceCalendar.monthLabel(f.month),
        f.rangeFrom?.let { InvoiceCalendar.caption(it, f.rangeTo) } ?: "",
    ).filter { it.isNotEmpty() }.joinToString(" · ")

    /** Whether the list is showing what a summary figure counts. */
    fun chosen(figure: InvoiceSummary.Figure, f: InvoiceFilter, chip: InvoiceChip, now: Instant): Boolean {
        val today = ERPDate.karachiDay(now)
        return when (figure) {
            InvoiceSummary.Figure.today -> f.month.isEmpty() && f.rangeFrom == today && (f.rangeTo == null || f.rangeTo == today)
            InvoiceSummary.Figure.month -> f.month == today.take(7) && f.rangeFrom == null
            InvoiceSummary.Figure.owed -> chip == InvoiceChip.unpaid
        }
    }

    /** A figure tapped shows what it counts, through the filters the list already has; tapped again, lets go. */
    fun pick(figure: InvoiceSummary.Figure, f: InvoiceFilter, chip: InvoiceChip, now: Instant): Pair<InvoiceFilter, InvoiceChip> {
        val again = chosen(figure, f, chip, now)
        val today = ERPDate.karachiDay(now)
        return when (figure) {
            InvoiceSummary.Figure.today -> f.copy(month = "", rangeFrom = if (again) null else today, rangeTo = null) to chip
            InvoiceSummary.Figure.month -> f.copy(rangeFrom = null, rangeTo = null, month = if (again) "" else today.take(7)) to chip
            InvoiceSummary.Figure.owed -> f to (if (again) InvoiceChip.all else InvoiceChip.unpaid)
        }
    }
}
