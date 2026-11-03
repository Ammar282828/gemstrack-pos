package erp.app.screens.home

import erp.app.screens.analytics.AnaCoins
import erp.app.screens.invoices.InvoiceFacts
import erp.app.screens.orders.OrdersLogic
import erp.core.logic.bookedAsSale
import erp.core.logic.exchangeTotal
import erp.core.logic.invoiceExchanges
import erp.core.logic.invoiceSaleValue
import erp.core.logic.orderAdvancePayments
import erp.core.logic.orderExchanges
import erp.core.logic.paymentExchangePart
import erp.core.models.AdditionalRevenue
import erp.core.models.Invoice
import erp.core.models.InvoiceStatus
import erp.core.models.Order
import erp.core.models.Payment
import erp.core.models.PaymentType
import erp.core.models.Repair
import java.time.Instant

// "Taken today", opened (owner, 2026-11-03: "tapping Taken today should open the histogram of per day with all details").
// A bar for each day of money taken, a range (7 days / this month / 30 / 90), and under it the chosen day: its total,
// how it was paid, and every entry. Port of the iPhone's DashboardTaken.swift (`DashTaken`), which follows the server's
// src/lib/taken-by-day.ts: the same rule as Home's figure, so a day here and the same day on Home are one number to
// the rupee. It lives beside Home rather than in `core` because it reads Home's own parts (the coin split, the revenue
// date, Karachi's days).
//
// Home's figure is the sale value (an invoice's `invoiceSaleValue`, a counter order not yet invoiced at its subtotal, Extra
// revenue with the repairs' payments), not the cash drawer; each entry's amount is split by how the books say it was paid
// and what is not paid yet is its own line, so the split always adds up to the day.

/** How an entry was paid; [unpaid] is the rest of its amount. */
enum class DashTakenMethod(val label: String) {
    cash("Cash"), bank("Bank"), card("Card"), other("Other"), unpaid("Not paid yet");

    companion object {
        /** Cheques, gold in exchange, a payment with no method and Extra revenue with none recorded are Other. */
        fun of(m: PaymentType?): DashTakenMethod = when (m) {
            PaymentType.cash -> cash
            PaymentType.bankTransfer -> bank
            PaymentType.card -> card
            else -> other
        }
    }
}

enum class DashTakenKind(private val one: String, private val many: String) {
    sale("sale", "sales"), order("order", "orders"), repair("repair payment", "repair payments"), extra("extra revenue", "extra revenues");

    fun noun(n: Int): String = if (n == 1) one else many
}

/** One thing that counted toward a day: a sale, a counter order not yet invoiced, a repair's payment, Extra revenue. */
class DashTakenEntry(
    val id: String,
    val kind: DashTakenKind,
    /** The instant it counts on (a sale from an order counts on its order's day, as Home does). */
    val at: Instant,
    /** The ISO text it came from, for the clock (a bare day has no time to show). */
    val atISO: String,
    /** Who took it; empty when the books do not say. */
    val who: String,
    val customer: String,
    val what: String,
    val ref: String,
    /** Where it opens; null for Extra revenue, which has no page of its own. */
    val path: String?,
    val amount: Double,
    /** How the amount was paid. Adds up to [amount]. */
    val split: Map<DashTakenMethod, Double>,
) {
    val time: String get() = if (atISO.length > 10) DashDate.clock(atISO) else ""

    /** "Cash", "Cash + Card", "Not paid yet". */
    val methodText: String
        get() {
            val parts = DashTakenMethod.entries.filter { (split[it] ?: 0.0) >= 0.5 }
            return if (parts.isEmpty()) "Not paid yet" else parts.joinToString(" + ") { it.label }
        }
}

class DashTakenDay(
    val day: Instant,
    val total: Double,
    val bySplit: Map<DashTakenMethod, Double>,
    /** How many entries were paid, wholly or partly, each way. */
    val splitCounts: Map<DashTakenMethod, Int>,
    val kindCounts: Map<DashTakenKind, Int>,
    /** Newest first. */
    val entries: List<DashTakenEntry>,
) {
    /** "3 sales · 1 order · 2 repair payments". */
    val countsLine: String
        get() = DashTakenKind.entries.mapNotNull { k -> kindCounts[k]?.takeIf { it > 0 }?.let { "$it ${k.noun(it)}" } }.joinToString(" · ")
}

/** The ranges the sheet offers. */
enum class DashTakenRange(val label: String) {
    week("7 days"), month("This month"), thirty("30 days"), ninety("90 days");

    /** The words over the total: "Taken, last 7 days" / "Taken this month". */
    val heading: String get() = if (this == month) "Taken this month" else "Taken, last $label"

    /** The days of [all] (today last, up to 90) this range shows; [monthLength] is the days of this month so far. */
    fun shown(all: List<DashTakenDay>, monthLength: Int): List<DashTakenDay> = when (this) {
        week -> all.takeLast(7)
        month -> all.takeLast(maxOf(1, monthLength))
        thirty -> all.takeLast(30)
        ninety -> all
    }
}

object DashTaken {
    /**
     * Home's events, with the words and the split each carries. `jewellery` is the invoices after the coins are taken out
     * ([AnaCoins.splitAll]), exactly as Home counts them. Same filters, same amounts: invoices, booked orders, Extra revenue.
     */
    fun entries(
        jewellery: List<Invoice>, orders: List<Order>, ordersById: Map<String, Order>, revenues: List<AdditionalRevenue>, repairs: List<Repair>,
    ): List<DashTakenEntry> {
        val out = ArrayList<DashTakenEntry>()
        for (inv in jewellery) {
            if (inv.status == InvoiceStatus.refunded || inv.createdAt.isEmpty()) continue
            val iso = DashRules.revenueDate(inv, ordersById)
            val at = DashDate.parseISO(iso) ?: continue
            val value = invoiceSaleValue(inv)
            out += DashTakenEntry(
                "i" + inv.id, DashTakenKind.sale, at, iso, inv.takenBy.orEmpty(), DashText.name(inv.customerName),
                InvoiceFacts.whatSold(inv) ?: inv.id, inv.id, DashPath.invoice(inv.id), value,
                split(value, inv.paymentHistory, exchangeTotal(invoiceExchanges(inv))),
            )
        }
        // A counter order not yet invoiced is a sale once taken (bookedAsSale); an online one waits for its transfer.
        for (o in orders) {
            if (!bookedAsSale(o)) continue
            val at = DashDate.parseISO(o.createdAt) ?: continue
            val value = if (o.subtotal.isNaN()) 0.0 else o.subtotal
            val what = OrdersLogic.cardWhat(o).first
            out += DashTakenEntry(
                "o" + o.id, DashTakenKind.order, at, o.createdAt, o.takenBy.orEmpty(), DashText.name(o.customerName),
                what.ifEmpty { "Order" }, o.id, DashPath.order(o.id), value,
                split(value, orderAdvancePayments(o), exchangeTotal(orderExchanges(o))),
            )
        }
        // A repair's money is written to Extra revenue with its repairId; the method and the person are on the repair.
        val repairOf = HashMap<String, Pair<Repair, PaymentType?>>()
        for (r in repairs) for (p in r.payments) {
            val rid = p.revenueId
            if (!rid.isNullOrEmpty()) repairOf[rid] = r to p.method
        }
        for (r in revenues) {
            val at = DashDate.parseISO(r.date) ?: continue
            val value = if (r.amount.isNaN()) 0.0 else r.amount
            val repairId = r.repairId
            if (!repairId.isNullOrEmpty()) {
                val found = repairOf[r.id]
                out += DashTakenEntry(
                    "r" + r.id, DashTakenKind.repair, at, r.date, found?.first?.takenBy.orEmpty(),
                    found?.let { DashText.name(it.first.customerName) } ?: "Walk-in",
                    r.description.ifEmpty { "Repair payment" }, repairId, DashPath.repair(repairId), value,
                    if (value == 0.0) emptyMap() else mapOf(DashTakenMethod.of(found?.second) to value),
                )
            } else {
                out += DashTakenEntry(
                    "x" + r.id, DashTakenKind.extra, at, r.date, "", "", r.description.ifEmpty { "Extra revenue" }, "", null, value,
                    if (value == 0.0) emptyMap() else mapOf(DashTakenMethod.other to value),
                )
            }
        }
        return out
    }

    /**
     * How a sale's value was paid: each payment by its own method (its exchange part, and any gold taken in exchange, is
     * Other), and the rest is Not paid yet. Payments past the value are scaled back so the parts always add up to it.
     */
    fun split(value: Double, payments: List<Payment>, exchange: Double): Map<DashTakenMethod, Double> {
        if (!(value > 0)) return emptyMap()
        val paid = LinkedHashMap<DashTakenMethod, Double>()
        for (p in payments) {
            val amount = if (p.amount.isNaN()) 0.0 else p.amount
            val gold = minOf(maxOf(0.0, paymentExchangePart(p)), maxOf(0.0, amount))
            // A handed-back credit is a negative payment: it lowers its method (the server's rule, taken-by-day.ts), so the rest shows as not paid yet.
            if (amount - gold != 0.0) paid.merge(DashTakenMethod.of(p.method), amount - gold, Double::plus)
            if (gold > 0) paid.merge(DashTakenMethod.other, gold, Double::plus)
        }
        if (exchange > 0) paid.merge(DashTakenMethod.other, exchange, Double::plus)
        val sum = paid.values.sum()
        if (sum > value) {
            val scale = value / sum
            return paid.mapValues { it.value * scale }
        }
        if (value - sum >= 0.005) paid[DashTakenMethod.unpaid] = value - sum
        return paid
    }

    /** Every entry Home counts, from the raw books (the coins taken out first, as Home does). */
    fun entries(invoices: List<Invoice>, orders: List<Order>, revenues: List<AdditionalRevenue>, repairs: List<Repair>): List<DashTakenEntry> {
        val byId = HashMap<String, Order>()
        for (o in orders) byId[o.id] = o
        return entries(AnaCoins.splitAll(invoices).first, orders, byId, revenues, repairs)
    }

    /** One bar a day, [count] days ending on the day of [now] (Karachi's), oldest first. A day with nothing is still a day. */
    fun days(entries: List<DashTakenEntry>, now: Instant, count: Int): List<DashTakenDay> {
        if (count <= 0) return emptyList()
        val today = DashDate.startOfDay(now)
        val start = DashDate.adding(-(count - 1), today)
        val buckets = List(count) { ArrayList<DashTakenEntry>() }
        for (e in entries) {
            if (e.at < start) continue
            val index = DashDate.calendarDays(e.at, start)
            if (index in 0 until count) buckets[index].add(e)
        }
        return (0 until count).map { i ->
            val list = buckets[i].sortedByDescending { it.at }
            val by = LinkedHashMap<DashTakenMethod, Double>()
            val counts = HashMap<DashTakenMethod, Int>()
            val kinds = HashMap<DashTakenKind, Int>()
            var total = 0.0
            for (e in list) {
                total += e.amount
                kinds.merge(e.kind, 1, Int::plus)
                for ((m, v) in e.split) if (v >= 0.005) {
                    by.merge(m, v, Double::plus)
                    counts.merge(m, 1, Int::plus)
                }
            }
            DashTakenDay(DashDate.adding(i, start), total, by, counts, kinds, list)
        }
    }

    /** The days of this month so far, today included (for the "This month" range). */
    fun monthLength(now: Instant): Int = DashDate.calendarDays(now, DashDate.startOfMonth(now)) + 1
}
