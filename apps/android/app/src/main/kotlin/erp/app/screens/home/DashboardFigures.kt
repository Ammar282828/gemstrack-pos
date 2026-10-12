package erp.app.screens.home

import erp.app.data.OnlineInbox
import erp.app.ui.ShopDate
import erp.core.logic.Partnership
import erp.core.logic.OrderTiming
import erp.core.logic.PromiseState
import erp.core.logic.awaitingTransfer
import erp.core.logic.bookedAsSale
import erp.core.logic.invoiceSaleValue
import erp.core.logic.isActiveOrder
import erp.core.logic.orderTiming
import erp.core.logic.owedToYou
import erp.core.logic.timingLabel
import erp.core.models.AdditionalRevenue
import erp.core.models.Customer
import erp.core.models.Expense
import erp.core.models.HisaabEntry
import erp.core.models.Invoice
import erp.core.models.InvoiceStatus
import erp.core.models.Karigar
import erp.core.models.KarigarJob
import erp.core.models.KarigarJobStatus
import erp.core.models.Order
import erp.core.models.OrderStatus
import erp.core.models.Repair
import erp.core.models.RepairStatus
import java.time.Instant
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.roundToInt

// What the dashboard says, worked out once from the shelves (src/app/page.tsx `stats` and `tasks`;
// DashboardFigures.swift). No Compose in this file. Every money and timing rule is core's (owedToYou,
// invoiceSaleValue, bookedAsSale, orderTiming, timingLabel, awaitingTransfer, isActiveOrder); what is here
// is the page's own gathering of them, plus the three small rules core does not hold yet (DashRules).

// MARK: Small shared helpers

internal object DashText {
    /** `customerName || 'Walk-in'`. */
    fun name(s: String?): String = if (s.isNullOrEmpty()) "Walk-in" else s

    fun nonEmpty(s: String?): String? = if (s.isNullOrEmpty()) null else s
}

/** Where a row opens (ERP paths; a path with no native screen opens the ERP's own page). */
object DashPath {
    private fun encode(id: String): String {
        val out = StringBuilder()
        for (b in id.toByteArray(Charsets.UTF_8)) {
            val c = (b.toInt() and 0xFF).toChar()
            if ((c in 'a'..'z') || (c in 'A'..'Z') || (c in '0'..'9') || c == '-' || c == '_' || c == '.' || c == '~') out.append(c)
            else out.append('%').append("%02X".format(b.toInt() and 0xFF))
        }
        return out.toString()
    }

    fun order(id: String) = "/orders/" + encode(id)
    fun invoice(id: String) = "/invoices/" + encode(id)

    // The ERP opens a repair on its list page (/repairs?id=); there is no /repairs/<id>.
    fun repair(id: String) = "/repairs?id=" + encode(id)
    fun customer(id: String) = "/customers/" + encode(id)
    fun karigar(id: String) = "/karigars/" + encode(id)
}

// MARK: Rules the page uses

/**
 * Three one-liners the iPhone takes from ERPCore and core's port has not got yet (`getInvoiceRevenueDate`, `repairTotal`;
 * core keeps its own copy of the first private to Partnership). Same bodies as ERPCore's RevenueDate.swift and Repairs.swift.
 */
internal object DashRules {
    /** A sale counts on its order's day when it came from one. */
    fun revenueDate(inv: Invoice, orders: Map<String, Order>): String {
        val source = inv.sourceOrderId
        if (!source.isNullOrEmpty()) {
            val order = orders[source]
            if (order != null && order.createdAt.isNotEmpty()) return order.createdAt
        }
        return inv.createdAt
    }

    /** `Number(p.price) || 0`: a missing or NaN price counts as nothing. */
    fun repairTotal(r: Repair): Double = r.pieces.fold(0.0) { sum, p ->
        val price = p.price ?: 0.0
        sum + (if (price.isNaN()) 0.0 else price)
    }

    /** A partner's drawing is not a cost of earning. */
    fun isBusinessCost(e: Expense): Boolean = Partnership.isBusinessCost(e)
}

// MARK: The workshop

class DashBenchJob(
    val karigarId: String,
    val karigarName: String,
    val ageDays: Int,
    /** The piece or job is finished (the web's status 'completed'). */
    val done: Boolean,
    /** When it was handed over, in milliseconds; NaN when the date does not read. */
    val assignedAt: Double,
) {
    val isCritical: Boolean get() = !done && ageDays >= DashBench.criticalDays
    val isUnassigned: Boolean get() = karigarId == DashBench.unassignedId
}

object DashBench {
    const val unassignedId = "__unassigned__"

    /** Sitting this long on the bench is critical (workshop.ts CRITICAL_DAYS). */
    const val criticalDays = 14

    /** `Math.max(0, Math.floor((Date.now() - new Date(iso)) / 86400000))`. */
    fun daysSince(iso: String?, now: Instant): Int {
        val t = DashDate.newDate(iso) ?: return 0
        val seconds = (now.epochSecond - t.epochSecond) + (now.nano - t.nano) / 1e9
        return max(0, floor(seconds / 86_400).toInt())
    }

    private fun millis(iso: String?): Double {
        val t = DashDate.newDate(iso) ?: return Double.NaN
        return t.epochSecond * 1000.0 + t.nano / 1e6
    }

    private fun realKarigar(id: String?): String = if (id.isNullOrEmpty() || id == "none") "" else id

    /** Orders' pieces, karigar jobs, and sold pieces still needing bench work, newest first, finished last. */
    fun jobs(orders: List<Order>, karigarJobs: List<KarigarJob>, karigars: List<Karigar>, invoices: List<Invoice>, now: Instant): List<DashBenchJob> {
        val names = HashMap<String, String>()
        for (k in karigars) names[k.id] = k.name
        val out = ArrayList<DashBenchJob>()
        out += fromOrders(orders, names, now)
        out += fromJobs(karigarJobs, names, now)
        out += fromInvoices(invoices, names, now)
        // JavaScript's sort is stable and so is Kotlin's.
        return out.sortedWith { a, b ->
            if (a.done != b.done) return@sortedWith if (a.done) 1 else -1
            val d = b.assignedAt - a.assignedAt
            if (d.isNaN()) 0 else if (d < 0) -1 else if (d > 0) 1 else 0
        }
    }

    private fun fromOrders(orders: List<Order>, names: Map<String, String>, now: Instant): List<DashBenchJob> {
        val out = ArrayList<DashBenchJob>()
        for (o in orders) {
            if (o.status == OrderStatus.cancelled || o.status == OrderStatus.refunded) continue
            if (!o.invoiceId.isNullOrEmpty()) continue
            // An online order whose transfer is not in is not work yet.
            if (awaitingTransfer(o)) continue
            val age = daysSince(o.createdAt, now)
            val assigned = millis(o.createdAt)
            for (item in o.items) {
                val raw = realKarigar(item.karigarId)
                val name = if (raw.isEmpty()) "Unassigned" else (DashText.nonEmpty(names[raw]) ?: "Unknown karigar")
                // An order marked Completed means the work is done, ticked piece by piece or not.
                val done = item.isCompleted || o.status == OrderStatus.completed
                out += DashBenchJob(raw.ifEmpty { unassignedId }, name, age, done, assigned)
            }
        }
        return out
    }

    private fun fromJobs(jobs: List<KarigarJob>, names: Map<String, String>, now: Instant): List<DashBenchJob> {
        val out = ArrayList<DashBenchJob>()
        for (j in jobs) {
            val raw = j.karigarId
            val name = if (raw.isEmpty()) "Unassigned" else (DashText.nonEmpty(names[raw]) ?: DashText.nonEmpty(j.karigarName) ?: "Unknown karigar")
            out += DashBenchJob(raw.ifEmpty { unassignedId }, name, daysSince(j.assignedDate, now), j.status == KarigarJobStatus.completed, millis(j.assignedDate))
        }
        return out
    }

    private fun fromInvoices(invoices: List<Invoice>, names: Map<String, String>, now: Instant): List<DashBenchJob> {
        val out = ArrayList<DashBenchJob>()
        for (inv in invoices) {
            if (inv.status == InvoiceStatus.refunded) continue
            // An online sale needs bench work only while it is unfulfilled; a piece already handed to a karigar always shows.
            val fulfilment = (inv.shopifyFulfillment ?: "").lowercase()
            val fromShopify = (inv.source ?: "").startsWith("shopify") && (inv.shopifyCancelledAt ?: "").isEmpty()
            val unfulfilledNote = (inv.notes ?: "").contains("unfulfilled", ignoreCase = true)
            val isOnline = fromShopify && (if (fulfilment.isEmpty()) unfulfilledNote else fulfilment != "fulfilled")
            val age = daysSince(inv.createdAt, now)
            val assignedAt = millis(inv.createdAt)
            for (item in inv.items) {
                val assigned = realKarigar(item.karigarId)
                if (!isOnline && assigned.isEmpty()) continue
                if (item.isCompleted) continue
                val name = if (assigned.isEmpty()) "Unassigned" else (DashText.nonEmpty(names[assigned]) ?: "Unknown karigar")
                out += DashBenchJob(assigned.ifEmpty { unassignedId }, name, age, false, assignedAt)
            }
        }
        return out
    }
}

// MARK: Birthdays and anniversaries

class DashOccasion(
    val customerId: String,
    val customerName: String,
    val isBirthday: Boolean,
    /** Days from today; negative means it has just passed. */
    val inDays: Int,
) {
    val `when`: String
        get() = when {
            inDays == 0 -> "today"
            inDays == 1 -> "tomorrow"
            inDays < 0 -> "${abs(inDays)} day${if (abs(inDays) == 1) "" else "s"} ago"
            else -> "in $inDays days"
        }
}

object DashOccasions {
    /** A fortnight ahead, two days behind: a date noticed the morning after is still worth a message. */
    const val daysAhead = 14
    const val daysBehind = 2

    private fun isDigits(s: String) = s.isNotEmpty() && s.all { it in '0'..'9' }

    /** Days until this month-and-day next comes round; the stored year is ignored, a date just gone stays visible. */
    fun daysUntil(iso: String, today: Instant): Int? {
        val parts = iso.takeLast(5).split("-")
        if (parts.size != 2 || parts[0].length != 2 || parts[1].length != 2 || !isDigits(parts[0]) || !isDigits(parts[1])) return null
        val month = parts[0].toInt()
        val day = parts[1].toInt()
        val midnight = DashDate.startOfDay(today)
        val year = DashDate.year(today)
        val thisYear = DashDate.date(year, month, day)
        val diff = ((thisYear.epochSecond - midnight.epochSecond) / 86_400.0).roundToInt()
        if (diff >= -daysBehind) return diff
        val nextYear = DashDate.date(year + 1, month, day)
        return ((nextYear.epochSecond - midnight.epochSecond) / 86_400.0).roundToInt()
    }

    fun upcoming(customers: List<Customer>, today: Instant): List<DashOccasion> {
        val found = ArrayList<DashOccasion>()
        for (c in customers) {
            if (!c.deletedAt.isNullOrEmpty()) continue
            for ((isBirthday, iso) in listOf(true to c.birthday, false to c.anniversary)) {
                if (iso.isNullOrEmpty()) continue
                val inDays = daysUntil(iso, today) ?: continue
                if (inDays > daysAhead || inDays < -daysBehind) continue
                found += DashOccasion(c.id, c.name, isBirthday, inDays)
            }
        }
        return found.sortedBy { it.inDays }
    }
}

// MARK: Rows

/** A promise to a customer: an order or a repair, by when it is due. */
class DashDue(
    val id: String,
    val path: String,
    val isRepair: Boolean,
    /** ORD-… or REP-…. */
    val ref: String,
    val customer: String,
    val amount: Double,
    val timing: OrderTiming,
    val promisedDate: String?,
) {
    val isLate: Boolean get() = timing.state == PromiseState.late

    val refLine: String get() = if (isRepair) "Repair · $ref" else ref

    /** "3 days late", "due today", "Fri 9 Oct", "no date". */
    fun whenText(now: Instant): String {
        val due = timing.due
        if (due != null) {
            if (timing.state == PromiseState.late || timing.state == PromiseState.today) return timingLabel(timing)
            val said = ShopDate.say(promisedDate, now = now)
            return said.ifEmpty { DashDate.weekdayDayMonth(due) }
        }
        return if (timing.state == PromiseState.late) timingLabel(timing) else "no date"
    }

    companion object {
        /** Late first, then today, then soonest, then the undated by age. */
        fun before(a: DashDue, b: DashDue): Int {
            fun rank(t: OrderTiming) = if (t.state == PromiseState.late) 0 else if (t.state == PromiseState.today) 1 else if (t.due != null) 2 else 3
            val r = rank(a.timing) - rank(b.timing)
            if (r != 0) return r
            val x = a.timing.due
            val y = b.timing.due
            if (x != null && y != null) {
                val c = x.compareTo(y)
                if (c != 0) return if (c < 0) -1 else 1
            }
            return b.timing.daysLate - a.timing.daysLate
        }
    }
}

/** A row in "Needs you": one thing waiting on a decision. */
class DashNeed(
    val id: String,
    val path: String,
    val tone: Tone,
    val title: String,
    val detail: String,
    val amount: Double? = null,
    /** The row asks for today's rate: an owner's opens the rate form here, not the ERP's page at `path`. */
    val opensRates: Boolean = false,
    val kind: Kind = Kind.other,
) {
    enum class Tone { danger, warn, plain }

    /** What the row is about, so Home can lead it with its own symbol. Set where the row is made; it decides nothing. */
    enum class Kind { rate, online, late, bench, unassigned, unpaid, repairReady, birthday, anniversary, other }
}

class DashDay(val day: Instant, val amount: Double)

// MARK: The figures

class DashFigures(
    val now: Instant,
    orders: List<Order>,
    invoices: List<Invoice>,
    revenues: List<AdditionalRevenue>,
    expenses: List<Expense>,
    karigars: List<Karigar>,
    karigarJobs: List<KarigarJob>,
    repairs: List<Repair>,
    customers: List<Customer>,
    hisaab: List<HisaabEntry>,
) {
    // The four headline figures.
    var todayRevenue = 0.0; private set
    var todayInvoiceCount = 0; private set
    var monthRevenue = 0.0; private set
    var lastMonthRevenue = 0.0; private set

    /** Invoices owing, largest balance first. */
    var unpaid: List<Invoice> = emptyList(); private set
    var totalOutstanding = 0.0; private set

    /** The part of [totalOutstanding] the hisaab holds by hand. */
    var owedInHisaab = 0.0; private set
    var activeJobs = 0; private set
    var criticalJobs: List<DashBenchJob> = emptyList(); private set
    var unassignedJobs: List<DashBenchJob> = emptyList(); private set

    // The lists.
    var due: List<DashDue> = emptyList(); private set
    var readyWaiting: List<Repair> = emptyList(); private set
    var recentInvoices: List<Invoice> = emptyList(); private set
    var occasions: List<DashOccasion> = emptyList(); private set
    private var karigarIds: Set<String> = emptySet()

    // The 30-day line.
    var revenue30 = 0.0; private set
    var expenses30 = 0.0; private set
    var days: List<DashDay> = emptyList(); private set

    val net30: Double get() = revenue30 - expenses30
    val lateDue: List<DashDue> get() = due.filter { it.isLate }

    private class Event(val at: Instant, val amount: Double)

    init {
        val liveKarigars = karigars.filter { it.deletedAt.isNullOrEmpty() }
        karigarIds = liveKarigars.mapTo(HashSet()) { it.id }
        gatherRevenue(orders, invoices, revenues, expenses)
        gatherOwed(invoices, hisaab)
        gatherBench(orders, karigarJobs, liveKarigars, invoices)
        gatherDue(orders, repairs)
        occasions = DashOccasions.upcoming(customers, now)
        recentInvoices = invoices.take(12)
    }

    private fun total(events: List<Event>, from: Instant, before: Instant? = null): Double {
        var sum = 0.0
        for (e in events) {
            if (e.at < from) continue
            if (before != null && e.at >= before) continue
            sum += e.amount
        }
        return sum
    }

    private fun gatherRevenue(orders: List<Order>, invoices: List<Invoice>, revenues: List<AdditionalRevenue>, expenses: List<Expense>) {
        val todayStart = DashDate.startOfDay(now)
        val monthStart = DashDate.startOfMonth(now)
        val lastMonthStart = DashDate.startOfMonth(DashDate.lastMonth(now))
        // "Last 30 days" is today plus the 29 before, as Analytics has it.
        val last30Start = DashDate.startOfDay(DashDate.adding(-29, now))

        val ordersById = HashMap<String, Order>()
        for (o in orders) ordersById[o.id] = o

        // Revenue is recognised on the source order's date, and counts an exchange as payment (invoiceSaleValue).
        val events = ArrayList<Event>()
        var invoicesToday = 0
        for (inv in invoices) {
            if (inv.status == InvoiceStatus.refunded) continue
            val at = DashDate.parseISO(DashRules.revenueDate(inv, ordersById)) ?: continue
            events += Event(at, invoiceSaleValue(inv))
            if (at >= todayStart) invoicesToday += 1
        }
        // A counter order not yet invoiced is a sale once taken (bookedAsSale); an online one waits for its transfer.
        for (o in orders) {
            if (!bookedAsSale(o)) continue
            val at = DashDate.parseISO(o.createdAt) ?: continue
            events += Event(at, if (o.subtotal.isNaN()) 0.0 else o.subtotal)
        }
        for (r in revenues) {
            val at = DashDate.parseISO(r.date) ?: continue
            events += Event(at, if (r.amount.isNaN()) 0.0 else r.amount)
        }

        todayInvoiceCount = invoicesToday
        todayRevenue = total(events, todayStart)
        monthRevenue = total(events, monthStart)
        lastMonthRevenue = total(events, lastMonthStart, before = monthStart)
        revenue30 = total(events, last30Start)

        val perDay = DoubleArray(30)
        for (e in events) {
            if (e.at < last30Start) continue
            val index = ((e.at.epochSecond - last30Start.epochSecond) + (e.at.nano - last30Start.nano) / 1e9).div(86_400.0).toInt()
            if (index in 0..29) perDay[index] += e.amount
        }
        days = (0 until 30).map { DashDay(DashDate.adding(it, last30Start), perDay[it]) }

        // The 30-day profit line leaves partner drawings out.
        var spent = 0.0
        for (e in expenses) {
            if (!DashRules.isBusinessCost(e)) continue
            val at = DashDate.parseISO(e.date) ?: continue
            if (at < last30Start) continue
            spent += if (e.amount.isNaN()) 0.0 else e.amount
        }
        expenses30 = spent
    }

    private fun gatherOwed(invoices: List<Invoice>, hisaab: List<HisaabEntry>) {
        // The one selector the customer list, Invoices and Hisaab read too (lib/owed.ts), with the hisaab's hand-written balances added.
        val owed = owedToYou(invoices, currentName = null, ledgerRows = hisaab)
        unpaid = owed.invoices.sortedWith { a, b -> b.balanceDue.compareTo(a.balanceDue) }
        totalOutstanding = owed.total
        owedInHisaab = owed.ledger
    }

    private fun gatherBench(orders: List<Order>, karigarJobs: List<KarigarJob>, karigars: List<Karigar>, invoices: List<Invoice>) {
        val jobs = DashBench.jobs(orders, karigarJobs, karigars, invoices, now)
        val active = jobs.filter { !it.done }
        activeJobs = active.size
        criticalJobs = active.filter { it.isCritical }.sortedByDescending { it.ageDays }
        unassignedJobs = active.filter { it.isUnassigned }
    }

    private fun gatherDue(orders: List<Order>, repairs: List<Repair>) {
        val list = ArrayList<DashDue>()
        // Open orders; an online order waiting for its transfer is owed nothing yet.
        for (o in orders) {
            if (!isActiveOrder(o) || awaitingTransfer(o)) continue
            list += DashDue("o" + o.id, DashPath.order(o.id), false, o.id, DashText.name(o.customerName), o.grandTotal, orderTiming(o, now), o.promisedDate)
        }
        // Repairs still in the shop, timed by the same rule as an order in progress.
        for (r in repairs) {
            if (r.status != RepairStatus.received) continue
            list += DashDue("r" + r.id, DashPath.repair(r.id), true, r.id, DashText.name(r.customerName), DashRules.repairTotal(r), repairTiming(r, now), r.promisedDate)
        }
        due = list.sortedWith(DashDue::before)

        // Repairs finished but not collected for a while: the customer needs a call.
        val waiting = ArrayList<Repair>()
        for (r in repairs) {
            if (r.status != RepairStatus.ready) continue
            val at = DashDate.parseISO(r.readyAt) ?: continue
            if (DashDate.calendarDays(now, at) >= 3) waiting += r
        }
        readyWaiting = waiting
    }

    // MARK: Needs you

    private class BenchGroup(val id: String, val name: String, var count: Int, var oldest: Int)

    /** Everything actually waiting on a decision, worst first: grouped, not enumerated (page.tsx `tasks`). */
    fun needs(onlineWaiting: Int, ratePause: OnlineInbox.RatePause?): List<DashNeed> {
        val out = ArrayList<DashNeed>()
        fun add(path: String, tone: DashNeed.Tone, title: String, detail: String, amount: Double? = null, kind: DashNeed.Kind = DashNeed.Kind.other) {
            out += DashNeed("${out.size}|$path", path, tone, title, detail, amount, kind = kind)
        }

        // taheri.shop sells only at a rate set in the last 36 hours.
        if (ratePause != null) {
            val last = DashDate.dayMonth(ratePause.ratesUpdatedAt)
            // An owner's row opens the rate form; anyone else's keeps the web's link.
            out += DashNeed(
                "${out.size}|/settings?tab=rates", "/settings?tab=rates", DashNeed.Tone.danger,
                "Set today's gold rate — online selling is paused",
                if (last.isEmpty()) "The rate chip at the top" else "Last set $last · the rate chip at the top",
                opensRates = true, kind = DashNeed.Kind.rate,
            )
        }

        // An online order nobody has looked at: the customer is waiting for the bank details. The row opens
        // the online inbox, where each is confirmed or declined.
        if (onlineWaiting > 0) {
            add(
                "/orders/online", DashNeed.Tone.danger,
                if (onlineWaiting == 1) "An online order to confirm" else "$onlineWaiting online orders to confirm",
                "From taheri.shop · they get the bank details when you confirm", kind = DashNeed.Kind.online,
            )
        }

        val late = lateDue
        val worst = late.firstOrNull()
        if (worst != null) {
            if (late.size == 1) {
                add(worst.path, DashNeed.Tone.danger, "${worst.customer}’s ${if (worst.isRepair) "repair" else "order"} is late", timingLabel(worst.timing), kind = DashNeed.Kind.late)
            } else {
                add(worst.path, DashNeed.Tone.danger, "${late.size} promises past their date", "Longest: ${worst.customer}, ${timingLabel(worst.timing)}", kind = DashNeed.Kind.late)
            }
        }

        addBenchNeeds(::add)

        for (inv in unpaid.take(3)) {
            add(DashPath.invoice(inv.id), DashNeed.Tone.warn, DashText.name(inv.customerName), "Unpaid since ${DashDate.dayMonth(inv.createdAt)}", inv.balanceDue, DashNeed.Kind.unpaid)
        }
        val rest = unpaid.drop(3)
        if (rest.isNotEmpty()) {
            val sum = rest.fold(0.0) { acc, inv -> acc + inv.balanceDue }
            add("/invoices", DashNeed.Tone.warn, "${rest.size} more unpaid", "Smaller balances", sum, DashNeed.Kind.unpaid)
        }

        for (r in readyWaiting.take(3)) {
            add(DashPath.repair(r.id), DashNeed.Tone.warn, "${DashText.name(r.customerName)}’s repair is ready", "Waiting to be collected since ${DashDate.dayMonth(r.readyAt)}", kind = DashNeed.Kind.repairReady)
        }

        for (o in occasions.take(4)) {
            add(
                DashPath.customer(o.customerId), if (o.inDays <= 1) DashNeed.Tone.warn else DashNeed.Tone.plain, o.customerName,
                "${if (o.isBirthday) "Birthday" else "Anniversary"} ${o.`when`}", kind = if (o.isBirthday) DashNeed.Kind.birthday else DashNeed.Kind.anniversary,
            )
        }
        return out
    }

    /** One row per karigar with overdue pieces (the four worst), then the work nobody has. */
    private fun addBenchNeeds(add: (String, DashNeed.Tone, String, String, Double?, DashNeed.Kind) -> Unit) {
        val order = ArrayList<String>()
        val groups = HashMap<String, BenchGroup>()
        for (j in criticalJobs) {
            if (j.isUnassigned) continue
            val key = j.karigarId.ifEmpty { j.karigarName }
            val cur = groups[key] ?: BenchGroup(j.karigarId, j.karigarName, 0, 0).also { order += key }
            cur.count += 1
            cur.oldest = max(cur.oldest, j.ageDays)
            groups[key] = cur
        }
        val ranked = order.mapNotNull { groups[it] }.sortedByDescending { it.oldest }
        for (g in ranked.take(4)) {
            val path = if (g.id in karigarIds) DashPath.karigar(g.id) else "/workshop"
            val detail = if (g.count == 1) "1 piece, ${g.oldest} days on the bench" else "${g.count} pieces overdue · longest ${g.oldest} days"
            add(path, DashNeed.Tone.danger, g.name, detail, null, DashNeed.Kind.bench)
        }
        if (unassignedJobs.isNotEmpty()) {
            val n = unassignedJobs.size
            add("/workshop", DashNeed.Tone.danger, "$n unassigned piece${if (n == 1) "" else "s"}", "Nobody is making these yet", null, DashNeed.Kind.unassigned)
        }
    }

    // MARK: What the redrawn Home reads (2026-10-09)

    /** The last seven days of the 30-day line, today last: the bars under "Taken today". */
    val week: List<DashDay> get() = days.takeLast(7)

    /**
     * This month so far against the whole of last month (1.12 is 12% more); null with nothing last month to
     * compare. Month to date against a full month, so it is short of 1 for most of a month: the page says
     * "62% of Sep" then, not "−38%".
     */
    val monthAgainstLast: Double? get() = if (lastMonthRevenue > 0.5) monthRevenue / lastMonthRevenue else null

    /**
     * The newest sale rung up today (Karachi's day), for "last sale 3:45 pm"; a refund is not a sale.
     * The invoices come newest first, so the first one older than today ends the search.
     */
    val lastSaleToday: Invoice?
        get() {
            val start = DashDate.startOfDay(now)
            for (inv in recentInvoices) {
                val at = DashDate.parseISO(inv.createdAt) ?: continue
                if (at < start) return null
                if (inv.status != InvoiceStatus.refunded) return inv
            }
            return null
        }

    companion object {
        /** `orderTiming({ promisedDate, createdAt: receivedAt, status: 'In Progress' })`: an Order is read from the three fields it looks at. */
        internal fun repairTiming(r: Repair, now: Instant): OrderTiming {
            val fields = HashMap<String, Any?>()
            fields["id"] = r.id
            fields["createdAt"] = r.receivedAt
            fields["status"] = "In Progress"
            if (r.promisedDate != null) fields["promisedDate"] = r.promisedDate
            return orderTiming(Order.fromMap(fields), now)
        }
    }
}
