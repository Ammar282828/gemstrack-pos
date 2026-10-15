// Ported from src/lib/analytics/cash-in.ts (tests: CashInTests, from cash-in.test.ts) and
// src/lib/analytics/todays-cash.ts (TodaysCashTests, from todays-cash.test.ts).
//
// Cash in over a period: what came into the shop, each rupee once, on the day it came.
//
// - Payments on invoices, whatever day the invoice was written.
// - Cash advances on orders that are not an invoice yet (orderAdvancePayments: the one taken
//   with the order on its date, each later one on its own). Finalising an order copies its
//   advances onto the invoice as payments with the same days, so from then on they are counted
//   there and not here, and a period's cash does not move when an order is finalised. An order
//   counts as invoiced when it names its invoice or an invoice names it (older data has only
//   the invoice's `sourceOrderId`).
// - Gold (or anything) taken in exchange, at the value agreed: the owner counts it as cash
//   (2026-09-25). An invoice's exchange on the invoice's revenue date, an open order's on the
//   order's, which is the same day once the order is invoiced.
// - Extra revenue.
//
// Invoices made from an order before 2026-09-25 carry the order's advance as ONE payment whose
// amount is the cash and the exchange together, noted "Advance from Order. Cash: X. Exchange: Y
// (…)". It is all counted; Y's share goes under `exchange` so the parts add up. The share is
// taken from the note rather than subtracting Y, because a bill with a coin on it reaches here
// already split pro rata (analytics/coins.ts), which scales the amount but not the note.

package erp.core.logic

import erp.core.ERPDate
import erp.core.models.AdditionalRevenue
import erp.core.models.Expense
import erp.core.models.Invoice
import erp.core.models.InvoiceStatus
import erp.core.models.Order
import erp.core.models.OrderStatus
import erp.core.models.PaidBy
import erp.core.models.Payment
import erp.core.models.PaymentType
import erp.core.models.Repair
import erp.core.seconds
import java.time.Instant

/** Either end left null is open. */
data class Period(val from: Instant? = null, val to: Instant? = null)

data class CashIn(
    /** Cash paid on invoices (an older order advance's exchange share is under `exchange`). */
    val invoicePayments: Double,
    /** Cash advances on orders not invoiced yet. */
    val orderAdvances: Double,
    /** Gold (or anything) taken in exchange, at the value agreed. */
    val exchange: Double,
    val extraRevenue: Double,
    /** All four. */
    val total: Double,
    /** The part of `exchange` taken off an invoice's grand total, which revenue therefore never counted. Revenue less (total less this) is what is still owed. */
    val exchangeOffInvoices: Double,
)

/** `inPeriod` of the TS: parseISO, as the rest of the page, so a bare "2026-09-01" is local (Karachi) midnight, not UTC. */
private fun inPeriod(iso: String?, period: Period): Boolean {
    if (iso.isNullOrEmpty()) return false
    if (period.from == null && period.to == null) return true
    val t = JS.parseISO(iso)?.let { JS.ms(it) } ?: return false
    return (period.from?.let { t >= JS.ms(it) } ?: true) && (period.to?.let { t <= JS.ms(it) } ?: true)
}

private val LEGACY_ORDER_ADVANCE = Regex("""(?i)^Advance from Order\. Cash: ([^\s\p{Z}]*)\. Exchange: (-?\p{Nd}+(?:\.\p{Nd}+)?(?:e[+-]?\p{Nd}+)?)""")

/** `Number(text) || 0`. */
private fun numberOrZero(text: String): Double {
    val v = JS.toNumber(text)
    return if (v.isNaN()) 0.0 else v
}

/** How much of a payment was gold taken in exchange: only an older order advance ever held any. */
fun paymentExchangePart(p: Payment): Double {
    val amount = if (p.amount.isNaN()) 0.0 else p.amount
    val notes = p.notes
    if (!(amount > 0) || notes == null) return 0.0
    val m = LEGACY_ORDER_ADVANCE.find(notes) ?: return 0.0
    val cash = maxOf(0.0, numberOrZero(m.groupValues[1]))
    val exchange = maxOf(0.0, numberOrZero(m.groupValues[2]))
    if (exchange <= 0) return 0.0
    return JS.round((amount * exchange / (cash + exchange)) * 100) / 100
}

/** Orders already made into an invoice: their advances are that invoice's payments now. */
fun invoicedOrderIds(orders: List<Order>, invoices: List<Invoice>): Set<String> {
    val ids = HashSet<String>()
    for (o in orders) if (JS.has(o.invoiceId)) ids.add(o.id)
    for (inv in invoices) if (JS.has(inv.sourceOrderId)) ids.add(inv.sourceOrderId!!)
    return ids
}

/**
 * - `invoices`: the invoices whose payments count.
 * - `invoiced`: from `invoicedOrderIds`, over every invoice (the coin ones too).
 * - `invoiceDate`: the day an invoice's exchange was taken; analytics passes its revenue date.
 *   Defaults to the invoice's `createdAt`.
 */
fun cashInForPeriod(
    invoices: List<Invoice>,
    orders: List<Order>,
    invoiced: Set<String>,
    extraRevenues: List<AdditionalRevenue>,
    period: Period,
    invoiceDate: ((Invoice) -> String)? = null,
): CashIn {
    var invoicePayments = 0.0
    var invoiceExchange = 0.0
    var legacyExchange = 0.0
    for (inv in invoices) {
        if (inv.status == InvoiceStatus.refunded) continue
        for (p in inv.paymentHistory) {
            if (!inPeriod(p.date, period)) continue
            val inKind = paymentExchangePart(p)
            invoicePayments += (if (p.amount.isNaN()) 0.0 else p.amount) - inKind
            legacyExchange += inKind
        }
        if (inPeriod(invoiceDate?.invoke(inv) ?: inv.createdAt, period)) invoiceExchange += exchangeTotal(invoiceExchanges(inv))
    }

    var orderAdvances = 0.0
    var orderExchange = 0.0
    for (o in orders) {
        if (o.status == OrderStatus.cancelled || o.status == OrderStatus.refunded || invoiced.contains(o.id)) continue
        for (p in orderAdvancePayments(o)) if (inPeriod(p.date, period)) orderAdvances += p.amount
        if (inPeriod(o.createdAt, period)) orderExchange += exchangeTotal(orderExchanges(o))
    }

    val extraRevenue = extraRevenues.fold(0.0) { acc, r -> acc + (if (inPeriod(r.date, period)) (if (r.amount.isNaN()) 0.0 else r.amount) else 0.0) }

    val exchange = invoiceExchange + legacyExchange + orderExchange
    return CashIn(
        invoicePayments = invoicePayments,
        orderAdvances = orderAdvances,
        exchange = exchange,
        extraRevenue = extraRevenue,
        total = invoicePayments + orderAdvances + exchange + extraRevenue,
        exchangeOffInvoices = invoiceExchange,
    )
}

// Today's cash: what came in today by how it was paid, what went out, and what the drawer should
// have gained (the audit of 2026-10-01: Home → Today's cash, and the 9 pm report's "Net cash",
// which counted invoice payments only and added card and bank to cash).
//
// Built on cash-in.ts, the rule Analytics' Cash In uses, so the two never disagree on a day:
//   in   invoice payments (by their own method), cash advances on orders not yet invoiced, repair
//        payments (by the repair's own record of the method), other Extra revenue (no method is
//        recorded for those: "Not recorded")
//   out  expenses paid by the business today: expenses carry no method, so every one the business
//        paid (not a partner out of pocket) is counted as leaving the drawer
//   exchange  gold (or anything) taken in exchange today, at the value agreed: its own line, never
//        in cash — it is in the safe, not the drawer
// Net cash is the drawer: money in by Cash, less the business's expenses.
// "Today" is Karachi's day, not the server's (the report runs in UTC).
//
// Left out: the TS logs a console warning when the lines and cash-in.ts's total differ by more than
// a rupee ("never expected: both walk the same records"); the lines are shown as they are.

/** TS `Method`: how money came in. Named for what it is, since a bare `Method` is too general a name to share a module with. */
enum class CashMethod(val rawValue: String) {
    cash("Cash"), card("Card"), bankTransfer("Bank Transfer"), cheque("Cheque"), notRecorded("Not recorded")
}

val METHODS: List<CashMethod> = listOf(CashMethod.cash, CashMethod.card, CashMethod.bankTransfer, CashMethod.cheque, CashMethod.notRecorded)

enum class CashSource { invoice, advance, repair, extra }

data class CashLine(
    val source: CashSource,
    /** INV-…, ORD-…, REP-…, or the Extra revenue row's words. */
    val ref: String,
    val who: String,
    val amount: Double,
    val method: CashMethod,
    val at: String,
)

data class ExpenseLine(val description: String, val amount: Double, val category: String)

class TodaysCash(
    /** Karachi's date, yyyy-mm-dd. */
    val day: String,
    /** Money in by method (exchange never here). Every method has an entry. */
    val byMethod: Map<CashMethod, Double>,
    /** Money in, every method. */
    val totalIn: Double,
    val exchange: Double,
    /** What the business paid out today. */
    val expenses: Double,
    val expenseLines: List<ExpenseLine>,
    /** The drawer: Cash in less expenses. */
    val netCash: Double,
    val lines: List<CashLine>,
)

private const val KARACHI_MS = 5 * 3_600_000.0 // UTC+5, no daylight saving

data class KarachiDayPeriod(val day: String, val period: Period)

/** Karachi's day around `now`: its date and [start, end] as instants. */
fun karachiDayPeriod(now: Instant): KarachiDayPeriod {
    val day = ERPDate.karachiDay(now)
    val startMs = (ERPDate.parse(day)?.seconds ?: 0.0) * 1000 - KARACHI_MS
    return KarachiDayPeriod(day, Period(from = ERPDate.fromSeconds(startMs / 1000), to = ERPDate.fromSeconds((startMs + 86_400_000 - 1) / 1000)))
}

/** `within` of the TS: `new Date(iso)`, so a bare day is UTC midnight here (unlike cash-in's parseISO). */
private fun within(iso: String?, period: Period): Boolean {
    if (iso.isNullOrEmpty()) return false
    val t = JS.newDate(iso)?.let { JS.ms(it) } ?: return false
    return (period.from?.let { t >= JS.ms(it) } ?: true) && (period.to?.let { t <= JS.ms(it) } ?: true)
}

private fun methodOf(m: PaymentType?): CashMethod = when (m) {
    PaymentType.cash -> CashMethod.cash
    PaymentType.card -> CashMethod.card
    PaymentType.bankTransfer -> CashMethod.bankTransfer
    PaymentType.cheque -> CashMethod.cheque
    else -> CashMethod.notRecorded
}

fun todaysCash(
    invoices: List<Invoice>,
    orders: List<Order>,
    repairs: List<Repair>,
    extraRevenues: List<AdditionalRevenue>,
    expenses: List<Expense>,
    now: Instant = Instant.now(),
): TodaysCash {
    val (day, period) = karachiDayPeriod(now)
    val lines = mutableListOf<CashLine>()

    for (inv in invoices) {
        if (inv.status == InvoiceStatus.refunded) continue
        for (p in inv.paymentHistory) {
            if (!within(p.date, period)) continue
            val amount = p.amount - paymentExchangePart(p)
            if (amount != 0.0) {
                lines.add(CashLine(CashSource.invoice, inv.id, if (inv.customerName.isEmpty()) "Walk-in" else inv.customerName, amount, methodOf(p.method), p.date))
            }
        }
    }
    val invoiced = invoicedOrderIds(orders, invoices)
    for (o in orders) {
        if (o.status == OrderStatus.cancelled || o.status == OrderStatus.refunded || invoiced.contains(o.id)) continue
        for (p in orderAdvancePayments(o)) {
            if (within(p.date, period) && p.amount != 0.0) {
                lines.add(CashLine(CashSource.advance, o.id, if (JS.has(o.customerName)) o.customerName!! else "Walk-in", p.amount, methodOf(p.method), p.date))
            }
        }
    }
    // A repair's money is written to Extra revenue with its repairId; the method is on the repair.
    val repairPayment = HashMap<String, Pair<Repair, PaymentType?>>()
    for (r in repairs) {
        for (p in r.payments) if (JS.has(p.revenueId)) repairPayment[p.revenueId!!] = r to p.method
    }
    for (r in extraRevenues) {
        if (!within(r.date, period) || r.amount == 0.0 || r.amount.isNaN()) continue
        val repairId = r.repairId
        if (!repairId.isNullOrEmpty()) {
            val rep = repairPayment[r.id]
            val who = if (rep != null) (if (JS.has(rep.first.customerName)) rep.first.customerName else r.description) else r.description
            lines.add(CashLine(CashSource.repair, repairId, who, r.amount, methodOf(rep?.second), r.date))
        } else {
            lines.add(CashLine(CashSource.extra, r.description, "", r.amount, CashMethod.notRecorded, r.date))
        }
    }

    // The totals by cash-in.ts's own rule, so the page and Analytics agree to the rupee.
    val cashIn = cashInForPeriod(invoices, orders, invoiced, extraRevenues, period)
    val byMethod = LinkedHashMap<CashMethod, Double>()
    for (m in METHODS) byMethod[m] = 0.0
    for (l in lines) byMethod[l.method] = (byMethod[l.method] ?: 0.0) + l.amount
    val totalIn = lines.fold(0.0) { acc, l -> acc + l.amount }

    val paidOut = expenses.filter { within(it.date, period) && it.paidBy == PaidBy.business }
    val spent = paidOut.fold(0.0) { acc, e -> acc + (if (e.amount.isNaN()) 0.0 else e.amount) }

    return TodaysCash(
        day = day,
        byMethod = byMethod,
        totalIn = totalIn,
        exchange = cashIn.exchange,
        expenses = spent,
        expenseLines = paidOut.map { ExpenseLine(it.description, if (it.amount.isNaN()) 0.0 else it.amount, it.category) },
        netCash = (byMethod[CashMethod.cash] ?: 0.0) - spent,
        lines = lines.jsSorted { a, b -> JS.localeCompare(a.at, b.at).toDouble() },
    )
}
