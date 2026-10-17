// Ported from src/lib/order-stage.ts (tests: OrderStageTests, from order-stage.test.ts),
// src/lib/order-payment.ts (OrderPaymentTests) and src/lib/order-timing.ts (OrderTimingTests;
// it has no TS test, the cases were written against the TS run under TZ=Asia/Karachi).
//
// Where an order stands, from its pieces: one rule for every path that changes them.
//
// The audit of 2026-10-04 (both houses' activity log, 60 days) found each custom order saved
// about 4.4 times after it was made, most of them status changes typed by hand: "In Progress"
// when the karigars had the pieces, "Completed" when they were back. The pieces already say
// both. Before, only the per-piece karigar picker moved an order on (Pending → In Progress), and
// ticking every piece finished never moved it at all; an order made with its karigars set, or
// changed in the edit form, stayed Pending until someone changed it.
//
// Forward only, and only from Pending or In Progress: an order that is Completed, Cancelled or
// Refunded, or already invoiced, is never moved by its pieces. (Unticking a piece of a finished
// order is its own action: `statusAfterUntick`.)
//
// And the stage the Orders hub sorts by, with the one thing to do next.
//
// The TS takes loose shapes (`Stageable`, `Piece`); here it takes the `Order` and `OrderItem`
// they are shapes of.

package erp.core.logic

import erp.core.models.Order
import erp.core.models.OrderItem
import erp.core.models.OrderStatus
import erp.core.models.Payment
import erp.core.models.WebsitePaymentStatus
import java.time.Instant

/** A confirmed online order whose bank transfer is not in yet (website/online.ts): nothing is made before it is. */
fun awaitingTransfer(order: Order): Boolean =
    order.website?.paymentStatus == WebsitePaymentStatus.awaitingTransfer || order.website?.paymentStatus == WebsitePaymentStatus.slipSent

/**
 * An order not yet invoiced that the books count as a sale on the day it was taken (its subtotal):
 * the dashboard, Analytics and the monthly PDF all read this one rule. A counter order is a sale
 * once taken: the customer stood there and agreed. An online order is not, until its transfer is
 * in: confirmed and unpaid it is an offer the customer may let lapse, and counting it put a
 * stranger's two-million-rupee basket into "Taken today" before a rupee had moved (2026-10-04).
 */
fun bookedAsSale(order: Order?): Boolean {
    val o = order ?: return false
    return JS.has(o.createdAt) && o.status != OrderStatus.cancelled && o.status != OrderStatus.refunded && !JS.has(o.invoiceId) && !awaitingTransfer(o)
}

private fun hasKarigar(p: OrderItem): Boolean = JS.has(p.karigarId) && p.karigarId != "none"

/** The status an order's pieces move it to, or null to leave it as it is. */
fun statusFromPieces(status: OrderStatus, items: List<OrderItem>?, invoiced: Boolean = false): OrderStatus? {
    val list = items ?: emptyList()
    if (invoiced || list.isEmpty()) return null
    if (status != OrderStatus.pending && status != OrderStatus.inProgress) return null
    if (list.all { it.isCompleted }) return OrderStatus.completed
    if (status == OrderStatus.pending && list.all { hasKarigar(it) }) return OrderStatus.inProgress
    return null
}

/** A piece of a finished (not yet invoiced) order was unticked: it is back with the karigars. */
fun statusAfterUntick(status: OrderStatus, invoiced: Boolean = false): OrderStatus? =
    if (status == OrderStatus.completed && !invoiced) OrderStatus.inProgress else null

/**
 * The hub's stages, in the order they are worked:
 *   transfer an online order, confirmed, its bank transfer not recorded yet: check the bank
 *   ready    finished, not invoiced: hand it over: Finalize & invoice
 *   karigar  In Progress: with the karigars
 *   new      Pending: not started: give the pieces to karigars
 *   payment  invoiced, money still owed on the invoice
 *   done     invoiced and paid
 *   closed   Cancelled or Refunded
 */
enum class OrderStage { transfer, ready, karigar, new, payment, done, closed }

val STAGE_ORDER: List<OrderStage> = listOf(OrderStage.transfer, OrderStage.ready, OrderStage.karigar, OrderStage.new, OrderStage.payment, OrderStage.done, OrderStage.closed)

data class StageInfo(val title: String, val hint: String)

val STAGES: Map<OrderStage, StageInfo> = mapOf(
    OrderStage.transfer to StageInfo("Awaiting transfer", "online, confirmed — check the bank"),
    OrderStage.ready to StageInfo("Ready to hand over", "finished — invoice it"),
    OrderStage.karigar to StageInfo("With karigars", "being made"),
    OrderStage.new to StageInfo("Not started", "give the pieces out"),
    OrderStage.payment to StageInfo("Awaiting payment", "invoiced — taken on the invoice"),
    OrderStage.done to StageInfo("Done", "invoiced and paid"),
    OrderStage.closed to StageInfo("Cancelled or refunded", ""),
)

/** `owedOnInvoice`: what the order's invoice still has owing (0 when paid or not invoiced). */
fun stageOf(order: Order, owedOnInvoice: Double = 0.0): OrderStage {
    if (order.status == OrderStatus.cancelled || order.status == OrderStatus.refunded) return OrderStage.closed
    if (!JS.has(order.invoiceId) && awaitingTransfer(order)) return OrderStage.transfer
    if (JS.has(order.invoiceId)) return if (owesMoney(owedOnInvoice)) OrderStage.payment else OrderStage.done
    if (order.status == OrderStatus.completed) return OrderStage.ready
    if (order.status == OrderStatus.inProgress) return OrderStage.karigar
    return OrderStage.new
}

data class PieceCounts(val total: Int, val unassigned: Int, val done: Int)

/** The pieces still without a karigar, and still being made. */
fun pieceCounts(items: List<OrderItem>?): PieceCounts {
    val list = items ?: emptyList()
    return PieceCounts(list.size, list.count { !hasKarigar(it) }, list.count { it.isCompleted })
}

// MARK: Payment (order-payment.ts)

enum class PaymentStatus(val rawValue: String) { paid("Paid"), partial("Partial"), unpaid("Unpaid") }

/**
 * Whether an order has been paid, from the one number that already knows.
 *
 * `order.grandTotal` is stored NET of both the discount and the advance
 * (order-form: `subtotal - discount - totalAdvance`), so it IS the balance
 * still owed, not a gross total.
 *
 * Both callers used to also test `totalAdvance >= grandTotal`, which compares
 * the advance against a figure the advance has already been taken out of. A
 * 100,000 order with 60,000 down stores a grandTotal of 40,000, and
 * `60,000 >= 40,000` marked it Paid while 40,000 was still outstanding: every
 * order whose advance covered half the price was mislabelled, on the badge and
 * in the list's payment filter. The balance decides it on its own.
 */
fun getOrderPaymentStatus(order: Order): PaymentStatus {
    val balance = order.grandTotal
    val totalAdvance = order.advancePayment + (order.advanceInExchangeValue ?: 0.0)

    if (balance <= 0) return PaymentStatus.paid
    if (totalAdvance > 0) return PaymentStatus.partial
    return PaymentStatus.unpaid
}

/**
 * An order's cash advances as the invoice's payments, each with its day and how it was paid
 * (the owner, 2026-09-25: "carry over all details from order to invoice, such as advances").
 *
 * `advancePayment` is the running total of every cash advance; `advances` lists the ones
 * recorded after the order was placed. What the list does not account for was taken with the
 * order, on the order's date, by `advanceMethod`. If the total was edited below its list, the
 * total is trusted as one advance. `label` is what each payment's note says ("Advance on order
 * ORD-000123"); the order page shows the same lines. (The TS takes a `Pick` of the order: its
 * id, createdAt, advancePayment, advanceMethod and advances.)
 */
fun orderAdvancePayments(order: Order, label: String? = null): List<Payment> {
    val text = label ?: "Advance on order ${order.id}"
    val cash = order.advancePayment
    val later = order.advances.filter { it.amount > 0 }
    val laterSum = later.fold(0.0) { acc, p -> acc + p.amount }
    if (laterSum > cash + 0.5) {
        return if (cash > 0) listOf(Payment(amount = cash, date = order.createdAt, notes = text)) else emptyList()
    }
    val first = cash - laterSum
    val lines = mutableListOf<Payment>()
    if (first > 0.5) {
        lines.add(Payment(amount = first, date = order.createdAt, notes = text, method = order.advanceMethod))
    }
    for (p in later) {
        val note = JS.trim(p.notes ?: "")
        lines.add(Payment(amount = p.amount, date = p.date, notes = if (note.isEmpty()) text else "$text: $note", method = p.method, reference = p.reference))
    }
    return lines
}

/** The order after one of its advance lines is taken away (`withoutOrderAdvance`). */
data class OrderAdvanceRemoval(
    val advancePayment: Double,
    val advances: List<Payment>,
    /** The order's `advanceMethod` goes with the advance taken with the order. */
    val dropMethod: Boolean,
    val removed: Payment,
)

/**
 * The order without one of its advance lines, as `orderAdvancePayments` lists them (owner,
 * 2026-10-01: "add ability to delete … advances"). The first line, when the total is more than
 * the list, is the advance taken with the order (its `advanceMethod` goes with it); the rest are
 * the `advances` list, in order. Null for a line that isn't there. The balance is the caller's:
 * subtotal − discount − what is left − exchange, as recording an advance works it out.
 */
fun withoutOrderAdvance(order: Order, lineIndex: Int): OrderAdvanceRemoval? {
    val lines = orderAdvancePayments(order, label = "")
    if (lineIndex < 0 || lineIndex >= lines.size) return null
    val removed = lines[lineIndex]
    val cash = order.advancePayment
    val all = order.advances
    val laterSum = all.filter { it.amount > 0 }.fold(0.0) { acc, p -> acc + p.amount }
    // The total was edited below its list: it is shown as one advance, and goes as one.
    if (laterSum > cash + 0.5) return OrderAdvanceRemoval(advancePayment = 0.0, advances = emptyList(), dropMethod = true, removed = removed)
    val hasFirst = cash - laterSum > 0.5
    if (hasFirst && lineIndex == 0) {
        return OrderAdvanceRemoval(advancePayment = rupees(laterSum), advances = all, dropMethod = true, removed = removed)
    }
    // The k-th positive entry of the list.
    var k = lineIndex - (if (hasFirst) 1 else 0)
    var at = -1
    for ((i, p) in all.withIndex()) {
        if (p.amount > 0) {
            if (k == 0) { at = i; break }
            k -= 1
        }
    }
    if (at < 0) return null
    return OrderAdvanceRemoval(
        advancePayment = rupees(cash - all[at].amount),
        advances = all.filterIndexed { i, _ -> i != at },
        dropMethod = false,
        removed = removed,
    )
}

// MARK: Timing (order-timing.ts)
//
// When an order is due, and whether it is late.
//
// Overdue used to mean `daysSince(createdAt) >= 7`: a fixed age, the same for
// every order regardless of what was actually promised. A piece promised in
// three weeks was flagged on day seven, and one promised in three days was not
// flagged until day seven, by which point the customer had already rung. The
// alert was noise in both directions.
//
// The rule now keys off the promised date. Orders taken before that field
// existed keep the old age rule, so nothing silently stops being reported.
//
// Days are Karachi's: date-fns reads a bare "2026-10-10" as the local midnight and counts
// calendar days in the local zone, and the shop's devices are Karachi's (JSCompat.kt).

/** Statuses still waiting on the bench. Cancelled and Refunded are finished. */
fun isActiveOrder(order: Order): Boolean = order.status == OrderStatus.pending || order.status == OrderStatus.inProgress

/** How long an order with no promised date may sit before it is called late. */
const val LEGACY_OVERDUE_DAYS = 7

/**
 * Promised within this many days, and it is urgent.
 *
 * Seven is a bench week: a piece promised inside it has to be started now, not
 * queued. The same window feeds the quick dates on the order form, so a 7-day
 * promise is marked urgent the moment it is chosen and the counter sees what it
 * is committing the workshop to.
 */
const val URGENT_WINDOW_DAYS = 7

/** The default promise for a new order, when nothing else was agreed. */
const val DEFAULT_PROMISE_DAYS = 14

enum class PromiseState(val rawValue: String) {
    /** No promised date, and not old enough for the fallback to fire (TS 'none'). */
    noPromise("none"),

    /** Promised, still ahead. */
    upcoming("upcoming"),

    /** Promised for today. */
    today("today"),

    /** Past its promise, or past the fallback age. */
    late("late"),
}

data class OrderTiming(
    /** Start of the promised day (Karachi), or null when the order never had one. */
    val due: Instant?,
    /** Negative before the promise, 0 on the day, positive after. */
    val daysLate: Int,
    val state: PromiseState,
    /** True when `state` came from the age fallback rather than a real promise. */
    val estimated: Boolean,
)

/**
 * Due within the urgent window, due today, or already late, and actually promised.
 * An order with no date is not urgent, it is undated, and that is a different problem
 * with its own flag.
 */
fun isUrgent(t: OrderTiming): Boolean {
    if (t.due == null) return false
    if (t.state == PromiseState.late || t.state == PromiseState.today) return true
    return -t.daysLate <= URGENT_WINDOW_DAYS
}

private fun day(iso: String?): Instant? = JS.parseISO(iso)?.let { JS.karachiStartOfDay(it) }

/** `now` is passed in rather than read from the clock so callers can group a whole list against one instant, and so this is testable. */
fun orderTiming(order: Order, now: Instant): OrderTiming {
    val due = day(order.promisedDate)

    if (due != null) {
        val daysLate = JS.calendarDays(now, due)
        return OrderTiming(
            due = due,
            daysLate = daysLate,
            state = if (daysLate > 0) PromiseState.late else if (daysLate == 0) PromiseState.today else PromiseState.upcoming,
            estimated = false,
        )
    }

    // No promise on record. Fall back to the age rule so orders taken before
    // this field existed are still surfaced.
    val age = day(order.createdAt)?.let { JS.calendarDays(now, it) } ?: 0
    return OrderTiming(
        due = null,
        daysLate = age - LEGACY_OVERDUE_DAYS,
        state = if (age >= LEGACY_OVERDUE_DAYS) PromiseState.late else PromiseState.noPromise,
        estimated = true,
    )
}

data class OrderWithTiming(val order: Order, val timing: OrderTiming)

/** Active orders that are late, worst first. */
fun lateOrders(orders: List<Order>, now: Instant): List<OrderWithTiming> =
    orders
        .filter { isActiveOrder(it) }
        .map { OrderWithTiming(it, orderTiming(it, now)) }
        .filter { it.timing.state == PromiseState.late }
        .jsSorted { a, b -> (b.timing.daysLate - a.timing.daysLate).toDouble() }

/** Active orders promised within the next `days`, soonest first. */
fun dueSoon(orders: List<Order>, now: Instant, days: Int = 7): List<OrderWithTiming> =
    orders
        .filter { isActiveOrder(it) }
        .map { OrderWithTiming(it, orderTiming(it, now)) }
        .filter { it.timing.due != null && it.timing.daysLate <= 0 && -it.timing.daysLate <= days }
        .jsSorted { a, b -> (b.timing.daysLate - a.timing.daysLate).toDouble() }

/** "3 days late" / "due today" / "in 5 days". */
fun timingLabel(t: OrderTiming): String {
    if (t.state == PromiseState.today) return "due today"
    if (t.state == PromiseState.late) {
        val n = if (t.due != null) t.daysLate else t.daysLate + LEGACY_OVERDUE_DAYS
        val noun = if (t.due != null) "late" else "old"
        return "$n day${if (n == 1) "" else "s"} $noun"
    }
    if (t.state == PromiseState.upcoming) {
        val n = -t.daysLate
        return "in $n day${if (n == 1) "" else "s"}"
    }
    return ""
}
