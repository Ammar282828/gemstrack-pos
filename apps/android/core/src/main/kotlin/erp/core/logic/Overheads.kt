// Ported from src/lib/overheads.ts (tests: OverheadsTests, from overheads.test.ts).
//
// The monthly overhead benchmark: what the shop has to cover every month before anything is profit
// (salaries, ad spend, rent, utilities). It answers one question, how much do we have to sell this
// month to stand still, and then keeps score month by month.
//
// Deliberately NOT expenses. Nothing here is written to the expenses collection, counted in profit,
// or reflected in the hisaab: the real payments are recorded separately as they happen, and this is
// the target they are measured against. If the benchmark were also an expense, every month would be
// double-counted.
//
// "Local" time in the TypeScript (date-fns' format, getDate, getMonth) is the shop's device, which is
// Karachi, as everywhere in erp.core (JSCompat.kt).

package erp.core.logic

import erp.core.ERPDate
import erp.core.models.Invoice
import erp.core.models.InvoiceStatus
import erp.core.models.OverheadItem
import erp.core.models.OverheadPlan
import erp.core.models.Order
import erp.core.models.OrderStatus
import java.time.Instant
import java.time.YearMonth as JYearMonth

object Overheads {
    /** The benchmark starts here. Earlier months are not scored against it. */
    const val benchmarkStart = "2026-09"

    private val monthNames = listOf(
        "January", "February", "March", "April", "May", "June", "July", "August",
        "September", "October", "November", "December",
    )

    fun overheadTotal(items: List<OverheadItem>): Double = items.fold(0.0) { sum, i -> sum + (if (i.amount.isNaN()) 0.0 else i.amount) }

    /** An id that will not collide with the seeded ones or with a sibling row. */
    fun newOverheadId(existing: List<OverheadItem>): String {
        var n = existing.size + 1
        val taken = existing.map { it.id }.toSet()
        while (taken.contains("item-$n")) n += 1
        return "item-$n"
    }

    /** "2026-10": the month of an instant, in Karachi. */
    fun monthKey(d: Instant): String = ERPDate.karachiDay(d).take(7)

    data class YearMonth(val year: Int, val month: Int)

    /** "2026-09" as (2026, 9); null for anything date-fns' parseISO would not read as `${key}-01`. */
    internal fun parts(key: String): YearMonth? {
        if (key.length != 7 || key[4] != '-') return null
        if (!key.withIndex().all { (i, ch) -> i == 4 || ch in '0'..'9' }) return null
        val y = key.substring(0, 4).toInt()
        val m = key.substring(5, 7).toInt()
        if (m !in 1..12) return null
        return YearMonth(y, m)
    }

    private fun pad(n: Int, width: Int) = n.toString().padStart(width, '0')

    /** "September 2026"; a key that is not a month is said as it is. */
    fun monthLabel(key: String): String {
        val p = parts(key) ?: return key
        return "${monthNames[p.month - 1]} ${pad(p.year, 4)}"
    }

    /** Every month from the benchmark's start up to and including `now`. */
    fun monthsSinceStart(now: Instant, start: String = benchmarkStart): List<String> {
        var at = parts(start) ?: return emptyList()
        val last = monthKey(now)
        val out = mutableListOf<String>()
        while (true) {
            val key = "${pad(at.year, 4)}-${pad(at.month, 2)}"
            if (key > last) break
            out.add(key)
            if (out.size > 600) break // a bad start date must not spin forever
            at = if (at.month == 12) YearMonth(at.year + 1, 1) else YearMonth(at.year, at.month + 1)
        }
        return out
    }

    /** The sheet in force for a given month: the latest plan starting on or before it. Months before the first plan have no benchmark and are not scored. */
    fun planForMonth(plans: List<OverheadPlan>, month: String): List<OverheadItem>? {
        val applicable = plans
            .filter { it.from <= month }
            .jsSorted { a, b -> JS.localeCompare(a.from, b.from).toDouble() }
        return applicable.lastOrNull()?.items
    }

    /** `now` is passed in rather than read from the clock so a whole screen agrees on one instant. */
    fun overheadProgress(target: Double, earned: Double, now: Instant): OverheadProgress {
        val shortfall = maxOf(0.0, target - earned)
        val local = now.atOffset(ERPDate.karachi)
        val daysInMonth = JYearMonth.of(local.year, local.monthValue).lengthOfMonth()
        val daysLeft = maxOf(1, daysInMonth - local.dayOfMonth + 1)
        return OverheadProgress(
            target = target,
            earned = earned,
            shortfall = shortfall,
            percent = if (target > 0) minOf(100.0, maxOf(0.0, (earned / target) * 100)) else 0.0,
            daysLeft = daysLeft,
            perDayNeeded = if (shortfall > 0) shortfall / daysLeft.toDouble() else 0.0,
        )
    }

    // Revenue

    /**
     * Revenue per month, by the rule Analytics uses.
     *
     * Both halves count. Invoices alone left out every order taken but not yet billed. An invoice is
     * dated to the day its ORDER was taken rather than the day it was finally billed, so a sale does
     * not drift across a month boundary when it happens to be invoiced late; an uninvoiced order
     * counts at subtotal, and drops out once it has an invoice so nothing is counted twice.
     */
    fun revenueByMonth(invoices: List<Invoice>, orders: List<Order>): Map<String, OverheadRevenue> {
        val byId = HashMap<String, Order>()
        for (o in orders) byId[o.id] = o
        val out = LinkedHashMap<String, OverheadRevenue>()

        for (inv in invoices) {
            if (inv.createdAt.isEmpty() || inv.status == InvoiceStatus.refunded) continue
            val fromOrder = if (JS.has(inv.sourceOrderId)) byId[inv.sourceOrderId ?: ""]?.createdAt else null
            val dated = if (JS.has(fromOrder)) (fromOrder ?: "") else inv.createdAt
            val d = JS.parseISO(dated) ?: continue
            // The sale's value with its exchange added back, as Analytics counts it (analytics/sale-value.ts):
            // grandTotal alone counted a part-exchange sale at its cash part.
            val value = invoiceSaleValue(inv)
            val key = monthKey(d)
            out[key] = (out[key] ?: OverheadRevenue()).addInvoiced(value)
        }

        for (o in orders) {
            if (o.createdAt.isEmpty()) continue
            if (o.status == OrderStatus.cancelled || o.status == OrderStatus.refunded || JS.has(o.invoiceId)) continue
            val d = JS.parseISO(o.createdAt) ?: continue
            val key = monthKey(d)
            out[key] = (out[key] ?: OverheadRevenue()).addUninvoiced(if (o.subtotal.isNaN()) 0.0 else o.subtotal)
        }

        return out
    }

    /** One row per month from the benchmark's start to now, newest first. */
    fun monthlyRows(plans: List<OverheadPlan>, revenue: Map<String, OverheadRevenue>, now: Instant, start: String = benchmarkStart): List<OverheadMonthRow> {
        val current = monthKey(now)
        return monthsSinceStart(now, start).map { month ->
            val items = planForMonth(plans, month)
            val target = items?.let { overheadTotal(it) } ?: 0.0
            val earned = revenue[month]?.total ?: 0.0
            OverheadMonthRow(
                month = month,
                label = monthLabel(month),
                target = target,
                earned = earned,
                surplus = earned - target,
                met = target > 0 && earned >= target,
                percent = if (target > 0) minOf(100.0, maxOf(0.0, (earned / target) * 100)) else 0.0,
                inProgress = month == current,
            )
        }.reversed()
    }

    /** Totals across the finished months, so an in-progress month cannot flatter them. */
    fun benchmarkSummary(rows: List<OverheadMonthRow>): OverheadSummary {
        val done = rows.filter { !it.inProgress && it.target > 0 }
        val met = done.count { it.met }
        var best: OverheadMonthRow? = null
        var worst: OverheadMonthRow? = null
        for (r in done) {
            if (best == null || r.surplus > best.surplus) best = r
            if (worst == null || r.surplus < worst.surplus) worst = r
        }
        return OverheadSummary(
            monthsScored = done.size,
            monthsMet = met,
            averageRevenue = if (done.isEmpty()) 0.0 else done.fold(0.0) { acc, r -> acc + r.earned } / done.size.toDouble(),
            cumulativeSurplus = done.fold(0.0) { acc, r -> acc + r.surplus },
            best = best,
            worst = worst,
        )
    }
}

data class OverheadProgress(
    val target: Double,
    val earned: Double,
    /** 0 once the target is passed. */
    val shortfall: Double,
    /** 0–100, clamped, for a bar. */
    val percent: Double,
    /** Days left in the month, today included. Only meaningful for the current one. */
    val daysLeft: Int,
    /** What the remaining days have to average. 0 once covered. */
    val perDayNeeded: Double,
)

/** One month's takings: billed, still only ordered, and the two together. */
data class OverheadRevenue(
    val invoiced: Double = 0.0,
    val uninvoiced: Double = 0.0,
    val total: Double = 0.0,
) {
    internal fun addInvoiced(v: Double): OverheadRevenue = copy(invoiced = invoiced + v, total = total + v)
    internal fun addUninvoiced(v: Double): OverheadRevenue = copy(uninvoiced = uninvoiced + v, total = total + v)
}

data class OverheadMonthRow(
    val month: String,
    val label: String,
    val target: Double,
    val earned: Double,
    /** Positive when the month cleared its benchmark. */
    val surplus: Double,
    val met: Boolean,
    val percent: Double,
    /** True for the month still being lived: it has not finished yet. */
    val inProgress: Boolean,
) {
    val id: String get() = month
}

data class OverheadSummary(
    val monthsScored: Int,
    val monthsMet: Int,
    val averageRevenue: Double,
    /** Cumulative, so a bad month and a good one net out the way cash does. */
    val cumulativeSurplus: Double,
    val best: OverheadMonthRow?,
    val worst: OverheadMonthRow?,
)
