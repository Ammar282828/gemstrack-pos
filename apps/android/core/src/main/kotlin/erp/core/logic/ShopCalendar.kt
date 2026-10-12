// Ported from src/app/calendar/page.tsx (tests: ShopCalendarTests): the Calendar's day-by-day books.
//
// Two layers, kept apart on purpose (the page's own comment): the money layer places a SALE on the day its
// ORDER was taken (getInvoiceRevenueDate, as the dashboard and Analytics do), and an order on the day it was
// taken; the promise layer only answers "what did I say I would hand over that day" and never touches money.
// Days are Karachi's, the shop's (JSCompat.kt).

package erp.core.logic

import erp.core.ERPDate
import erp.core.models.Invoice
import erp.core.models.InvoiceStatus
import erp.core.models.Order
import erp.core.models.OrderStatus
import erp.core.seconds
import java.time.Instant
import java.time.LocalDate
import kotlin.math.floor

/** One sale or order on a day. */
data class ShopCalendarEvent(
    /** Unique across both kinds ("i:INV-1", "o:ORD-1"). */
    val id: String,
    /** The invoice's or order's own id: what a row opens. */
    val docId: String,
    val isInvoice: Boolean,
    /** ISO; its time of day is what the row shows. */
    val createdAt: String,
    /** Empty for a walk-in. */
    val customerName: String,
    /** The document's `grandTotal`, as the page prints it. */
    val grandTotal: Double,
    /** `createdAt` in seconds, for sorting; 0 when it does not read. */
    internal val at: Double,
)

/** What one day came to: sales and orders counted, the money taken, and the rows. */
data class ShopCalendarDay(
    var invoices: Int = 0,
    var orders: Int = 0,
    /** Money taken that day: sales at their value (exchange included, refunded left out) and orders not yet invoiced. */
    var total: Double = 0.0,
    /** Newest first. */
    var events: List<ShopCalendarEvent> = emptyList(),
)

/** The totals for the month on screen. */
data class ShopCalendarMonth(
    val sales: Int,
    val orders: Int,
    val total: Double,
    /** Days with money taken. */
    val days: Int,
    /** The average trading day; 0 when there was none. */
    val perTradingDay: Double,
)

/** Every day that has a sale or an order, by Karachi's "yyyy-MM-dd". */
fun shopCalendarDays(invoices: List<Invoice>, orders: List<Order>): Map<String, ShopCalendarDay> {
    val days = LinkedHashMap<String, ShopCalendarDay>()
    val events = HashMap<String, MutableList<ShopCalendarEvent>>()
    val ordersById = HashMap<String, Order>()
    for (o in orders) ordersById[o.id] = o

    for (inv in invoices) {
        // A sale counts on its order's day when it came from one (getInvoiceRevenueDate), else its own.
        var whenText = inv.createdAt
        val source = inv.sourceOrderId
        if (!source.isNullOrEmpty()) {
            val o = ordersById[source]
            if (o != null && o.createdAt.isNotEmpty()) whenText = o.createdAt
        }
        // A date that does not read has no day to sit on.
        val placed = JS.parseISO(whenText) ?: continue
        val key = ERPDate.karachiDay(placed)
        val day = days.getOrPut(key) { ShopCalendarDay() }
        day.invoices += 1
        // The sale's value, part-exchange included — as Analytics and the dashboard count it.
        if (inv.status != InvoiceStatus.refunded) day.total += invoiceSaleValue(inv)
        events.getOrPut(key) { mutableListOf() }.add(
            ShopCalendarEvent(
                id = "i:" + inv.id, docId = inv.id, isInvoice = true, createdAt = inv.createdAt,
                customerName = inv.customerName, grandTotal = inv.grandTotal,
                at = JS.parseISO(inv.createdAt)?.seconds ?: 0.0,
            ),
        )
    }

    for (o in orders) {
        val placed = JS.parseISO(o.createdAt) ?: continue
        val key = ERPDate.karachiDay(placed)
        val day = days.getOrPut(key) { ShopCalendarDay() }
        day.orders += 1
        // Uninvoiced orders only — an invoiced one is already counted above.
        if ((o.invoiceId ?: "").isEmpty() && o.status != OrderStatus.cancelled && o.status != OrderStatus.refunded) {
            day.total += o.subtotal
        }
        events.getOrPut(key) { mutableListOf() }.add(
            ShopCalendarEvent(
                id = "o:" + o.id, docId = o.id, isInvoice = false, createdAt = o.createdAt,
                customerName = o.customerName ?: "", grandTotal = o.grandTotal, at = placed.seconds,
            ),
        )
    }

    // Newest first inside a day.
    for ((key, day) in days) {
        day.events = (events[key] ?: mutableListOf<ShopCalendarEvent>()).jsSorted { a, b -> b.at - a.at }
    }
    return days
}

/** Pieces promised on each day, by Karachi's "yyyy-MM-dd": active orders with a promised date. */
fun shopCalendarDue(orders: List<Order>): Map<String, Int> {
    val due = LinkedHashMap<String, Int>()
    for (o in orders) {
        if (!isActiveOrder(o)) continue
        val promised = o.promisedDate
        if (promised.isNullOrEmpty()) continue
        val d = JS.parseISO(promised) ?: continue
        val key = ERPDate.karachiDay(d)
        due[key] = (due[key] ?: 0) + 1
    }
    return due
}

/** The active orders promised on one day ("yyyy-MM-dd"), soonest taken first: what was said would be handed over. */
fun shopCalendarDueOn(day: String, orders: List<Order>): List<Order> =
    orders.filter { o ->
        if (!isActiveOrder(o)) return@filter false
        val promised = o.promisedDate
        if (promised.isNullOrEmpty()) return@filter false
        val d = JS.parseISO(promised) ?: return@filter false
        ERPDate.karachiDay(d) == day
    }

/** The month's sales, orders and money, from the days that fall in it. */
fun shopCalendarMonth(days: Map<String, ShopCalendarDay>, year: Int, month: Int): ShopCalendarMonth {
    val prefix = ShopCalendar.monthKey(year, month) + "-"
    var sales = 0
    var orders = 0
    var tradingDays = 0
    var total = 0.0
    for ((key, day) in days) {
        if (!key.startsWith(prefix)) continue
        sales += day.invoices
        orders += day.orders
        total += day.total
        if (day.total > 0) tradingDays += 1
    }
    return ShopCalendarMonth(
        sales = sales, orders = orders, total = total, days = tradingDays,
        perTradingDay = if (total != 0.0 && tradingDays > 0) total / tradingDays.toDouble() else 0.0,
    )
}

/** The month grid and its words. Weeks start on Sunday, as the web's day picker draws them. */
object ShopCalendar {
    private val monthNames = listOf(
        "January", "February", "March", "April", "May", "June", "July", "August",
        "September", "October", "November", "December",
    )

    data class YearMonth(val year: Int, val month: Int)
    data class YearMonthDay(val year: Int, val month: Int, val day: Int)

    /** Karachi's year, month and day of an instant. */
    fun today(now: Instant = Instant.now()): YearMonthDay {
        val c = now.atOffset(ERPDate.karachi)
        return YearMonthDay(c.year, c.monthValue, c.dayOfMonth)
    }

    private fun pad(n: Int, width: Int): String = n.toString().padStart(width, '0')

    /** "2026-10". */
    fun monthKey(year: Int, month: Int): String = "${pad(year, 4)}-${pad(month, 2)}"

    /** "2026-10-09". */
    fun dayKey(year: Int, month: Int, day: Int): String = "${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}"

    /** The month `by` months on (or back), with the year carried. */
    fun step(year: Int, month: Int, by: Int): YearMonth {
        val index = year * 12 + (month - 1) + by
        return YearMonth(floor(index / 12.0).toInt(), ((index % 12) + 12) % 12 + 1)
    }

    /** "October 2026". */
    fun title(year: Int, month: Int): String {
        val name = if (month in 1..12) monthNames[month - 1] else ""
        return "$name $year"
    }

    /** "October 9, 2026" for a "yyyy-MM-dd" day. */
    fun longDay(key: String): String {
        val parts = key.split("-").filter { it.isNotEmpty() }.mapNotNull { it.toIntOrNull() }
        if (parts.size != 3 || parts[1] !in 1..12) return key
        return "${monthNames[parts[1] - 1]} ${parts[2]}, ${parts[0]}"
    }

    /** The days of the month in a grid of weeks: a gap for each weekday before the 1st, then 1…n. */
    fun cells(year: Int, month: Int): List<Int?> {
        val first = LocalDate.of(year, 1, 1).plusMonths((month - 1).toLong())
        val lead = maxOf(0, first.dayOfWeek.value % 7)
        return List<Int?>(lead) { null } + (1..first.lengthOfMonth()).map { it }
    }

    /** A day's money in a cell that has room for about six characters (`dayMoney`): 850, 12k, 1.5M. */
    fun dayMoney(n: Double): String {
        if (n >= 999_500) {
            var s = JS.toFixed(n / 1_000_000, 1)
            if (s.endsWith(".0")) s = s.dropLast(2)
            return s + "M"
        }
        if (n >= 1000) return JS.number(JS.round(n / 1000)) + "k"
        return JS.number(JS.round(n))
    }

    /** The time of day a row shows, in Karachi: "4:05 pm"; empty when the date does not read. */
    fun clock(iso: String): String {
        val d = JS.parseISO(iso) ?: return ""
        val c = d.atOffset(ERPDate.karachi)
        val hour = c.hour
        val twelve = if (hour % 12 == 0) 12 else hour % 12
        return "$twelve:" + pad(c.minute, 2) + (if (hour < 12) " am" else " pm")
    }
}
