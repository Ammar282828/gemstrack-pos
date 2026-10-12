package erp.app.screens.orders

import erp.core.ERPDate
import erp.core.logic.Margin
import erp.core.logic.MarginSettings
import erp.core.logic.Money
import erp.core.logic.OrderStage
import erp.core.logic.OrderTiming
import erp.core.logic.PromiseState
import erp.core.logic.STAGES
import erp.core.logic.STAGE_ORDER
import erp.core.logic.URGENT_WINDOW_DAYS
import erp.core.logic.customerSourceLabel
import erp.core.logic.getOrderPaymentStatus
import erp.core.logic.isActiveOrder
import erp.core.logic.isOwing
import erp.core.logic.isUrgent
import erp.core.logic.isWalkInName
import erp.core.logic.orderAdvancePayments
import erp.core.logic.orderTiming
import erp.core.logic.percentLabel
import erp.core.logic.stageOf
import erp.core.logic.timingLabel
import erp.core.models.CustomerSource
import erp.core.models.Invoice
import erp.core.models.KaratValue
import erp.core.models.MetalType
import erp.core.models.Order
import erp.core.models.OrderItem
import erp.core.models.OrderStatus
import erp.core.models.WebsitePaymentStatus
import java.math.BigDecimal
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale

// The Orders screens' small rules (OrdersLogic.swift). Plain Kotlin and core only (no Compose), so they are
// checked on the JVM. The ERP's own rules stay in core; what is here is only the reading of them for a phone:
// which words, which order, which row.

/**
 * How the hub is broken up (orders/page.tsx `groupBy`): by day to start with (the owner, 2026-10-05), or by
 * stage, which is the hub proper, or by week or month. The calendar ones are the Invoices list's, so a day, a
 * week and a month are named and cut the same on both. Due is the phone's own (2026-10-09): the open orders
 * by how soon each was promised, Late first.
 */
enum class OrdersGrouping(val raw: String, val title: String) {
    stage("stage", "Stage"), day("day", "Day"), week("week", "Week"), month("month", "Month"), due("due", "Due");

    /** Whether this is one of the calendar cuts (Day, Week, Month). */
    val isCalendar: Boolean get() = this == day || this == week || this == month

    /** The switcher's first segment: the calendar cut in use, Day unless Week or Month was picked from the menu. */
    val calendarCut: OrdersGrouping get() = if (isCalendar) this else day

    companion object {
        fun of(raw: String?): OrdersGrouping = entries.firstOrNull { it.raw == raw } ?: day
    }
}

/**
 * The Due view's sections, in the order they are chased. "This week" is the bench week the ERP calls urgent
 * (URGENT_WINDOW_DAYS), so a card in it carries the same amber promise as anywhere else.
 */
enum class OrdersDueBucket(val title: String, val hint: String) {
    late("Late", "past the day promised"),
    today("Today", "promised for today"),
    week("This week", "in the next $URGENT_WINDOW_DAYS days: start them now"),
    later("Later", "more than a week away"),
    undated("No date", "no day promised: oldest first"),
}

/**
 * What an order asks for next (components/order/next-step.tsx): the one reading the hub's cards and the order
 * page's bar both use.
 *   Awaiting transfer  Check transfer (the transfer's moves: the slips, Transfer received, Let it lapse)
 *   Not started        Give out (native workshop assignment for this order)
 *   With karigars      Mark ready (Completed, every piece ticked)
 *   Ready to hand over Finalize & invoice
 *   Invoiced           the invoice: money is taken there only (decision "Orders hub", 2026-10-06)
 */
sealed interface OrderNextStep {
    data class CheckTransfer(val slipIn: Boolean) : OrderNextStep
    data object GiveOut : OrderNextStep
    data object MarkReady : OrderNextStep
    data object Finalize : OrderNextStep
    data class Invoice(val id: String, val owed: Double) : OrderNextStep

    val title: String
        get() = when (this) {
            is CheckTransfer -> if (slipIn) "Slip in: check" else "Check transfer"
            GiveOut -> "Give out"
            MarkReady -> "Mark ready"
            Finalize -> "Make invoice"
            is Invoice -> if (owed > 0.5) "Take ${Money.pkr(owed)}" else "Open $id"
        }

    /** The step's icon, by the SF Symbol the iPhone uses (the screens map it to a Material icon). */
    val symbol: String
        get() = when (this) {
            is CheckTransfer -> "banknote"
            GiveOut -> "person.badge.plus"
            MarkReady -> "checkmark.circle"
            Finalize -> "doc.text"
            is Invoice -> if (owed > 0.5) "banknote" else "doc.text"
        }
}

/** One section of the hub: a stage, a day, week or month, or how soon it is due. Done and Closed fold in the stage view. */
data class HubSection(
    val id: String,
    val title: String,
    val hint: String,
    /** Late is red; nothing else is (the screen maps it). */
    val late: Boolean,
    val folds: Boolean,
    val orders: List<Order>,
)

/** The promise as the cards and the order page read it (components/shared/promise-line.tsx). */
data class OrderPromise(
    /** No promised date on the order. */
    val undated: Boolean,
    val state: PromiseState,
    /** "3 days late" / "due today" / "in 5 days"; empty when it says nothing. */
    val label: String,
    /** Still being chased: a finished order's promise is history. */
    val chase: Boolean,
    /** Promised inside a bench week (or late, or today), and still open. */
    val urgent: Boolean,
    /** Whether the label is shown beside the date. */
    val showsLabel: Boolean,
)

/** What the page's advances will land as on the invoice. */
data class AdvanceLine(val id: Int, val date: String, val method: String, val note: String, val amount: Double)

/** Karachi's days, weeks (from Monday) and months: what the shop means by "today" and "this week" (Invoices' InvoiceCalendar). */
object OrdersCalendar {
    private fun formatter(pattern: String): DateTimeFormatter =
        DateTimeFormatter.ofPattern(pattern, Locale.UK).withZone(ERPDate.karachi)

    private val dayName = formatter("EEEE d MMM")
    private val shortDay = formatter("d MMM")
    private val fullDay = formatter("d MMM yyyy")
    private val yearOnly = formatter("yyyy")
    private val monthName = formatter("MMMM yyyy")

    class Bucket(val key: String, val title: String, val hint: String)

    private fun localDay(d: Instant): LocalDate = LocalDate.parse(ERPDate.karachiDay(d))

    private fun startOf(day: LocalDate): Instant = day.atStartOfDay(ERPDate.karachi).toInstant()

    /** Monday of the week a date falls in (firstWeekday 2). */
    private fun weekStart(d: Instant): LocalDate = localDay(d).with(DayOfWeek.MONDAY)

    private fun monthStart(d: Instant): LocalDate = localDay(d).withDayOfMonth(1)

    fun bucket(d: Instant, by: OrdersGrouping, now: Instant): Bucket = when (by) {
        OrdersGrouping.month -> {
            val start = monthStart(d)
            val at = startOf(start)
            Bucket("m${at.epochSecond}", monthName.format(at), if (start == monthStart(now)) "This month" else "")
        }
        OrdersGrouping.week -> {
            val start = weekStart(d)
            val at = startOf(start)
            Bucket("w${at.epochSecond}", "Week of " + shortDay.format(at), if (start == weekStart(now)) "This week" else yearOnly.format(at))
        }
        else -> {
            val key = ERPDate.karachiDay(d)
            val today = key == ERPDate.karachiDay(now)
            val yesterday = key == ERPDate.karachiDay(now.minusSeconds(86_400))
            val title = if (today) "Today" else if (yesterday) "Yesterday" else dayName.format(d)
            Bucket("d$key", title, if (today || yesterday) fullDay.format(d) else yearOnly.format(d))
        }
    }

    /** "2026-10" as the shop's month filter keeps it. */
    fun monthKey(iso: String): String? = ERPDate.parse(iso)?.let { ERPDate.karachiDay(it).take(7) }

    fun monthLabel(key: String): String = try {
        monthName.format(startOf(YearMonth.parse(key).atDay(1)))
    } catch (e: Exception) {
        key
    }
}

object OrdersLogic {
    // MARK: Statuses

    /** What the status menu offers: never a bare "Refunded" (docs/decisions.md "Orders hub"; the server refuses it too). Refund order is the ERP's own page. */
    val settableStatuses = listOf("Pending", "In Progress", "Completed", "Cancelled")

    /** The hub's status filter: the ERP's ORDER_STATUSES, all of them (it filters, it does not write). */
    val filterStatuses = listOf("Pending", "In Progress", "Completed", "Cancelled", "Refunded")

    /** The hub's payment filter: Any payment, then these (getOrderPaymentStatus). */
    val filterPayments = listOf("Paid", "Partial", "Unpaid")

    /** Cancelling asks first, on the list and on the order page alike. */
    const val cancelWords = "It leaves the Workshop and its Shopify draft is cancelled. It can be set back to Pending later."

    // MARK: What each stage lets you do (components/order/next-step.tsx)

    /** Still being made: an advance can be recorded, and the stage has its one action. */
    fun making(stage: OrderStage): Boolean = stage == OrderStage.new || stage == OrderStage.karigar || stage == OrderStage.ready

    /** "Record an advance": not once invoiced (money is taken on the invoice only), not once cancelled. */
    fun canAdvance(order: Order): Boolean = !hasInvoice(order) && order.status != OrderStatus.cancelled && order.status != OrderStatus.refunded

    fun hasInvoice(order: Order): Boolean = !order.invoiceId.isNullOrEmpty()

    /** The order's one next step; null once it is closed, or paid and done with no invoice to point at. `owed` is what its invoice still has owing. */
    fun nextStep(order: Order, stage: OrderStage, owed: Double): OrderNextStep? {
        val id = order.invoiceId
        if (!id.isNullOrEmpty()) return OrderNextStep.Invoice(id, owed)
        return when (stage) {
            OrderStage.transfer -> OrderNextStep.CheckTransfer(slipIn = order.website?.paymentStatus == WebsitePaymentStatus.slipSent)
            OrderStage.new -> OrderNextStep.GiveOut
            OrderStage.karigar -> OrderNextStep.MarkReady
            OrderStage.ready -> OrderNextStep.Finalize
            OrderStage.payment, OrderStage.done, OrderStage.closed -> null
        }
    }

    /** The Advance beside the step: an owner's (the ERP refuses anyone else), on an order still being made. */
    fun offersAdvance(order: Order, stage: OrderStage, isOwner: Boolean): Boolean = isOwner && making(stage) && canAdvance(order)

    /** Still to be handed over: not invoiced, not cancelled or refunded. A finished piece not yet invoiced still has its promise to keep. */
    fun isOpen(order: Order): Boolean = !hasInvoice(order) && order.status != OrderStatus.cancelled && order.status != OrderStatus.refunded

    /** Online orders are the ones placed on the website and confirmed by a person. */
    fun isOnline(order: Order): Boolean = order.source == CustomerSource.website && order.website != null

    // MARK: Owing on invoices

    /** What each invoice still has owing (the hub's "Awaiting payment"): `isOwing` is the ERP's rule. */
    fun owedOnInvoices(invoices: List<Invoice>): Map<String, Double> {
        val out = HashMap<String, Double>()
        for (inv in invoices) if (isOwing(inv)) out[inv.id] = inv.balanceDue
        return out
    }

    fun owed(order: Order, owedOn: Map<String, Double>): Double {
        val id = order.invoiceId
        if (id.isNullOrEmpty()) return 0.0
        return owedOn[id] ?: 0.0
    }

    /** What the customer still owes on the order as the list shows it: the order's own balance (its `grandTotal`) until it is invoiced, then what the invoice still has owing. Below zero is credit. */
    fun stillOwed(order: Order, invoiceOwed: Double): Double = if (hasInvoice(order)) invoiceOwed else order.grandTotal

    // MARK: The Due view

    fun dueBucket(t: OrderTiming): OrdersDueBucket {
        // An order with no day promised is undated here, whatever the age rule calls it.
        if (t.due == null) return OrdersDueBucket.undated
        return when (t.state) {
            PromiseState.late -> OrdersDueBucket.late
            PromiseState.today -> OrdersDueBucket.today
            PromiseState.upcoming -> if (-t.daysLate <= URGENT_WINDOW_DAYS) OrdersDueBucket.week else OrdersDueBucket.later
            PromiseState.noPromise -> OrdersDueBucket.undated
        }
    }

    /**
     * The open orders by how soon they were promised: in each section the soonest promise first (so the latest of
     * the late), and the undated oldest first, as they have waited longest.
     */
    fun dueGroups(orders: List<Order>, now: Instant): List<Pair<OrdersDueBucket, List<Order>>> {
        val members = HashMap<OrdersDueBucket, MutableList<Pair<Order, Instant?>>>()
        for (o in orders) {
            if (!isOpen(o)) continue
            val t = orderTiming(o, now)
            members.getOrPut(dueBucket(t)) { ArrayList() }.add(o to t.due)
        }
        return OrdersDueBucket.entries.mapNotNull { b ->
            val rows = members[b]
            if (rows.isNullOrEmpty()) return@mapNotNull null
            val sorted = rows.sortedWith { a, c ->
                val da = a.second
                val dc = c.second
                if (da != null && dc != null && da != dc) return@sortedWith da.compareTo(dc)
                val ta = takenAt(a.first)
                val tc = takenAt(c.first)
                if (ta != tc) return@sortedWith ta.compareTo(tc)
                a.first.id.compareTo(c.first.id)
            }
            b to sorted.map { it.first }
        }
    }

    // MARK: Sections

    /** Search, Month, Taken by and Payment: everything but the status chip, so the chips can count what they would show (the web's filteredOrders, orders/page.tsx). */
    fun scope(all: List<Order>, query: String, month: String, takenBy: String, payment: String): List<Order> = all.filter { order ->
        matches(order, query) &&
            (month.isEmpty() || OrdersCalendar.monthKey(order.createdAt) == month) &&
            (takenBy.isEmpty() || order.takenBy == takenBy) &&
            (payment == "All" || getOrderPaymentStatus(order).rawValue == payment)
    }

    /** Newest first inside every group, as the web sorts before it groups; the Due view soonest first. */
    fun sections(orders: List<Order>, grouping: OrdersGrouping, owedOn: Map<String, Double>, now: Instant): List<HubSection> {
        if (grouping == OrdersGrouping.due) {
            return dueGroups(orders, now).map { (b, list) ->
                HubSection("due-" + b.name, b.title, b.hint, late = b == OrdersDueBucket.late, folds = false, orders = list)
            }
        }
        val newest = orders.sortedByDescending { takenAt(it) }
        if (!grouping.isCalendar) return stageSections(newest, owedOn)
        val keys = ArrayList<String>()
        val info = HashMap<String, OrdersCalendar.Bucket>()
        val members = HashMap<String, MutableList<Order>>()
        for (order in newest) {
            val d = ERPDate.parse(order.createdAt)
            val b = if (d != null) OrdersCalendar.bucket(d, grouping, now) else OrdersCalendar.Bucket("undated", "No date", "")
            if (!info.containsKey(b.key)) {
                info[b.key] = b
                keys.add(b.key)
            }
            members.getOrPut(b.key) { ArrayList() }.add(order)
        }
        // A bare year under a heading says something only when it is not this one.
        val thisYear = ERPDate.karachiDay(now).take(4)
        return keys.map { key ->
            val b = info.getValue(key)
            HubSection(key, b.title, if (b.hint == thisYear) "" else b.hint, late = false, folds = false, orders = members[key].orEmpty())
        }
    }

    private fun stageSections(orders: List<Order>, owedOn: Map<String, Double>): List<HubSection> {
        val byStage = HashMap<OrderStage, MutableList<Order>>()
        for (o in orders) byStage.getOrPut(stageOf(o, owed(o, owedOn))) { ArrayList() }.add(o)
        return STAGE_ORDER.mapNotNull { st ->
            val rows = byStage[st]
            if (rows.isNullOrEmpty()) return@mapNotNull null
            val info = STAGES[st]
            HubSection(st.name, info?.title ?: st.name, info?.hint ?: "", late = false, folds = st == OrderStage.done || st == OrderStage.closed, orders = rows)
        }
    }

    // MARK: Whose it is

    /** Taken by the signed-in person, whose rows are lit in place (docs/decisions.md "Signed-in defaults"). Nobody is lit when this account has no counter name. */
    fun isMine(order: Order, person: String?): Boolean {
        if (person.isNullOrEmpty()) return false
        val by = order.takenBy ?: return false
        return by == person
    }

    /** When the order was taken, for newest first; an order with no readable date sorts last. */
    fun takenAt(order: Order): Instant = ERPDate.parse(order.createdAt) ?: Instant.MIN

    // MARK: Search

    /** The hub's search: order id, customer, phone, the ONL- number the customer quotes, and the pieces' words. */
    fun matches(order: Order, query: String): Boolean {
        val q = query.trim().lowercase()
        if (q.isEmpty()) return true
        if (order.id.lowercase().contains(q)) return true
        if ((order.customerName ?: "").lowercase().contains(q)) return true
        if ((order.summary ?: "").lowercase().contains(q)) return true
        if ((order.website?.onlineId ?: "").lowercase().contains(q)) return true
        val contact = order.customerContact
        if (!contact.isNullOrEmpty()) {
            if (contact.lowercase().contains(q)) return true
            val wanted = digits(q)
            if (wanted.length >= 3 && digits(contact).contains(wanted)) return true
        }
        return order.items.any { it.description.lowercase().contains(q) }
    }

    fun digits(s: String): String = s.filter { it in '0'..'9' }

    /** A number to dial: digits and a leading plus, nothing else. */
    fun dialable(phone: String?): String = (phone ?: "").filter { it in '0'..'9' || it == '+' }

    /** "Walk-in" when the order names nobody, or names the placeholder (lib/walk-in.ts: a walk-in is not a customer). */
    fun customerName(order: Order): String {
        val n = (order.customerName ?: "").trim()
        return if (n.isEmpty() || isWalkInName(n)) "Walk-in" else n
    }

    // MARK: The promise (components/shared/promise-line.tsx)

    fun promise(order: Order, now: Instant): OrderPromise {
        val promised = order.promisedDate
        if (promised.isNullOrEmpty()) return OrderPromise(true, PromiseState.noPromise, "", chase = false, urgent = false, showsLabel = false)
        val t = orderTiming(order, now)
        val chase = isActiveOrder(order)
        val hurry = chase && isUrgent(t)
        val shows = chase && (t.state != PromiseState.upcoming || hurry)
        return OrderPromise(false, t.state, timingLabel(t), chase, hurry, shows)
    }

    // MARK: Money, as the order page works it out

    /**
     * Always from the pieces, so it agrees with their estimates (the order page, 2026-10-04), and never from the
     * stored subtotal: the page sums `totalEstimate` and nothing else, so a piece without an estimate counts for
     * nothing there, and the balance must read the same here.
     */
    fun subtotal(order: Order): Double = order.items.fold(0.0) { acc, i -> acc + (i.totalEstimate ?: 0.0) }

    fun discount(order: Order): Double = order.discountAmount ?: 0.0

    fun exchangeValue(order: Order): Double = order.advanceInExchangeValue ?: 0.0

    /** Pieces − discount − advances − exchange: the big "Balance Due" on the order page. */
    fun balance(order: Order): Double = subtotal(order) - discount(order) - order.advancePayment - exchangeValue(order)

    /** The advances as they will land on the invoice: the one taken with the order, then each recorded after it, each with its day, how it was paid and its note. */
    fun advanceLines(order: Order): List<AdvanceLine> = orderAdvancePayments(order, label = "").mapIndexed { i, a ->
        val raw = a.notes ?: ""
        val clean = if (raw.startsWith(": ")) raw.drop(2) else raw
        val note = if (clean.isEmpty()) (if (a.date == order.createdAt) "With the order" else "") else clean
        AdvanceLine(i, a.date, a.method?.rawValue ?: "", note, a.amount)
    }

    // MARK: Online orders (components/order/website-order-panel.tsx)

    /** What the customer pays: the pieces and the delivery (the order's grandTotal is the ERP's balance). */
    fun onlineTotal(order: Order): Double {
        order.website?.total?.let { return it }
        return order.subtotal + (order.website?.deliveryCharge ?: 0.0)
    }

    fun paymentWords(status: WebsitePaymentStatus): String = when (status) {
        WebsitePaymentStatus.awaitingTransfer -> "Awaiting transfer"
        WebsitePaymentStatus.slipSent -> "Slip sent: check the bank"
        WebsitePaymentStatus.transferReceived -> "Transfer received"
        WebsitePaymentStatus.refunded -> "Refunded"
        WebsitePaymentStatus.expired -> "Lapsed"
        else -> status.rawValue
    }

    // MARK: Words and numbers

    /** A figure without trailing zeros: 4.2, 22.5, 8 (NumberFormatter, en_US, grouped, half to even over the double's shortest digits). */
    fun number(x: Double, maxDigits: Int = 3): String {
        if (!x.isFinite()) return x.toString()
        val f = DecimalFormat("#,##0", DecimalFormatSymbols(Locale.US)).apply {
            minimumFractionDigits = 0
            maximumFractionDigits = maxDigits
            roundingMode = RoundingMode.HALF_EVEN
        }
        return f.format(BigDecimal(x.toString()))
    }

    fun grams(g: Double): String = number(g) + " g"

    fun hasKarigar(item: OrderItem): Boolean {
        val id = item.karigarId ?: return false
        return id.isNotEmpty() && id != "none"
    }

    /** store.ts CUSTOMER_SOURCE_LABELS; a key the ERP does not know shows as it was written. */
    fun sourceLabel(s: CustomerSource): String = customerSourceLabel(s.rawValue) ?: s.rawValue

    /** categorySingular (lib/categories.ts): "Ring" for cat001; the id itself when unknown, as the web's `categorySingular(id) || id` shows it. Both the order page and the invoice page read it. */
    fun categorySingular(id: String?): String? {
        if (id.isNullOrEmpty()) return null
        return erp.core.logic.categorySingular(id) ?: id
    }

    /** The rates the order was booked at, for the gold karats it uses: "Gold (21K): PKR 33,700/g". Staff's orders carry no `ratesApplied` (roles.ts), so they get an empty line. */
    fun rateLine(order: Order): String {
        val seen = ArrayList<String>()
        val parts = ArrayList<String>()
        for (item in order.items) {
            if (item.metalType != MetalType.gold) continue
            val karat = item.karat ?: continue
            if (seen.contains(karat.rawValue)) continue
            seen.add(karat.rawValue)
            val r = order.ratesApplied
            val rate = when (karat) {
                KaratValue.k24 -> r.goldRatePerGram24k
                KaratValue.k22 -> r.goldRatePerGram22k
                KaratValue.k21 -> r.goldRatePerGram21k
                KaratValue.k18 -> r.goldRatePerGram18k
                else -> null
            }
            if (rate != null && rate > 0) parts.add("Gold (${karat.rawValue.uppercase()}): ${Money.pkr(rate)}/g")
        }
        return parts.joinToString(" | ")
    }

    /** The card's line about what the order is: its summary, else its pieces. */
    fun whatIsIt(order: Order): String {
        val s = (order.summary ?: "").trim()
        if (s.isNotEmpty()) return s
        val names = order.items.map { it.description.trim() }.filter { it.isNotEmpty() }
        if (names.isEmpty()) return if (order.items.isEmpty()) "No pieces" else "${order.items.size} piece${if (order.items.size == 1) "" else "s"}"
        val shown = names.take(3).joinToString(", ")
        return if (names.size > 3) shown + " and ${names.size - 3} more" else shown
    }

    /** The card's one line about what the order is: its summary, else its first piece, and how many more pieces there are beside it ("3 pieces", "+2 more"). */
    fun cardWhat(order: Order): Pair<String, String?> {
        val count = order.items.size
        val s = (order.summary ?: "").trim()
        if (s.isNotEmpty()) return s to (if (count > 1) "$count pieces" else null)
        val names = order.items.map { it.description.trim() }.filter { it.isNotEmpty() }
        val first = names.firstOrNull() ?: return (if (count == 0) "No pieces" else "$count piece${if (count == 1) "" else "s"}") to null
        return first to (if (count > 1) "+${count - 1} more" else null)
    }

    private val dueDayFormat: DateTimeFormatter = DateTimeFormatter.ofPattern("EEE d MMM", Locale.UK).withZone(ERPDate.karachi)

    /** "Thu 12 Oct", the promised day as the cards and the order page say it. */
    fun dueDay(d: Instant): String = dueDayFormat.format(d)

    /**
     * The order page's promise in words: "Due today", "Due Mon 12 Oct · in 3 days", "Due Wed 7 Oct · 2 days late";
     * how far off it is only while the order is still being chased (promise-line.tsx).
     */
    fun promiseLine(order: Order, now: Instant): String {
        val p = promise(order, now)
        val t = orderTiming(order, now)
        if (p.undated) {
            // The ERP's age rule still counts an old undated order as late; say how old, quietly.
            return if (isActiveOrder(order) && t.state == PromiseState.late) "No day promised · " + timingLabel(t) else "No day promised"
        }
        if (t.state == PromiseState.today) return "Due today"
        var s = t.due?.let { "Due " + dueDay(it) } ?: "No day promised"
        if (p.chase && p.label.isNotEmpty() && t.state != PromiseState.today) s += " · " + p.label
        return s
    }

    /** A number as the shop writes one: "0300 1234567", "+92 300 1234567"; anything else as it was typed. */
    fun phoneWords(phone: String?): String {
        val raw = (phone ?: "").trim()
        if (!raw.all { it in '0'..'9' || it == ' ' || it == '-' || it == '+' }) return raw
        val d = digits(raw)
        if (d.length == 12 && d.startsWith("92") && d.drop(2).startsWith("3") && !raw.startsWith("0")) {
            return "+92 ${d.drop(2).take(3)} ${d.drop(5)}"
        }
        if (d.length == 11 && d.startsWith("03")) return "${d.take(4)} ${d.drop(4)}"
        return raw
    }

    // MARK: Margin (shop screens only)

    /** A house that does not cost by gold (Mina) shows no margin at all (shop-margin.tsx SHOP_MARGIN_ON). Everyone else in the shop sees it, owner or staff, blurred until tapped; never a customer. */
    fun marginIsOn(settings: MarginSettings): Boolean = settings.rattiLess != null

    /** What the owner reads when the figure is tapped (shop-margin.tsx MarginFigure). */
    fun marginWords(m: Margin, settings: MarginSettings): String {
        if (m.assumed) return "≈ ${percentLabel(m)} (no 24k rate given: assumed)"
        var s = "${percentLabel(m)} · ${Money.pkr(m.profit)}"
        if (m.costedShare < 0.999) {
            val rest = halfAway((1 - m.costedShare) * 100).toInt()
            val assumed = halfAway(settings.assumedMargin * 100).toInt()
            s += " · $rest% of it at $assumed% (no weight)"
        }
        return s
    }

    /** Swift's `.rounded()`: halves away from zero. */
    internal fun halfAway(x: Double): Double = if (x < 0) -Math.floor(-x + 0.5) else Math.floor(x + 0.5)
}
