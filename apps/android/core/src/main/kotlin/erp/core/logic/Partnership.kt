// Ported from src/lib/partnership.ts and the date rules of src/lib/partnership-settings.ts
// (tests: PartnershipTests, from partnership.test.ts), and src/lib/shareholder-figures.ts, the
// Shareholders page's figures (ShareholderFiguresTests, from shareholder-figures.test.ts).
//
// Ledger entries are classified as equity or loan:
//   - payment + equity    → partner invests capital (counts toward their fair share)
//   - payment + loan      → partner lends cash to the business (repayable first)
//   - withdrawal + equity → partner draws against their capital
//   - withdrawal + loan   → business repays the partner's loan balance

package erp.core.logic

import erp.core.ERPDate
import erp.core.models.AdditionalRevenue
import erp.core.models.Expense
import erp.core.models.Invoice
import erp.core.models.InvoiceStatus
import erp.core.models.Order
import erp.core.models.OrderStatus
import erp.core.models.PartnerLedgerCategory
import erp.core.models.PartnerLedgerType
import erp.core.models.PartnershipSettings
import erp.core.models.ShareholderLedgerRow
import erp.core.seconds
import java.time.Instant
import kotlin.math.abs

object Partnership {
    /** The expense category for money a shareholder takes out of the business. */
    const val partnerDrawings = "Partner Drawings"

    /**
     * The expense category for a partner paying themselves for work done. Unlike a draw, a salary IS a
     * cost of doing business, so it stays inside every profit figure: on a 50/50 split one partner's
     * salary comes half out of the other partner's share. Equal salaries cancel out; unequal ones do not.
     */
    const val partnerSalary = "Partner Salary"

    /** lib/partnership-settings.ts DEFAULT_WORKING_CAPITAL_FLOOR. */
    const val defaultWorkingCapitalFloor: Double = 500_000.0

    /**
     * Is this expense a genuine cost of doing business? A drawing is a distribution of profit, not a
     * cost of earning it; a salary is a real cost, whether or not the partner owns the place.
     */
    fun isBusinessCost(category: String?): Boolean = category != partnerDrawings

    fun isBusinessCost(e: Expense): Boolean = isBusinessCost(category = e.category)

    fun categorise(payments: List<ShareholderLedgerRow>, withdrawals: List<ShareholderLedgerRow>): CategorisedLedger {
        var equityIn = 0.0
        var loanIn = 0.0
        var equityOut = 0.0
        var loanOut = 0.0
        for (p in payments) {
            if (p.category == PartnerLedgerCategory.loan) loanIn += p.amount else equityIn += p.amount
        }
        for (w in withdrawals) {
            if (w.category == PartnerLedgerCategory.loan) loanOut += w.amount else equityOut += w.amount
        }
        return CategorisedLedger(equityIn = equityIn, loanIn = loanIn, equityOut = equityOut, loanOut = loanOut)
    }

    /** The three-bucket view for one partner. `expShare` and `revShare` are their 50% of every expense and of all revenue since the partnership started. */
    fun partnerBalance(l: CategorisedLedger, expShare: Double, revShare: Double): PartnerBalance {
        val equityBalance = l.equityIn - l.equityOut
        val loanBalance = l.loanIn - l.loanOut
        val netPnL = revShare - expShare // positive if revenue exceeds expense burden
        val totalClaim = loanBalance + equityBalance + netPnL
        return PartnerBalance(equityBalance = equityBalance, loanBalance = loanBalance, netPnL = netPnL, totalClaim = totalClaim)
    }

    // Distribution waterfall

    /**
     * The standard waterfall: hold back the working-capital floor, repay outstanding loans (pro rata if
     * there is not enough for all), then split what remains as an equity draw, equally unless ratios are
     * given for every partner.
     */
    fun calculateDistribution(
        cashOnHand: Double,
        workingCapitalFloor: Double,
        partners: List<PartnerDistributionInput>,
        distributionRatios: List<Double>? = null,
    ): DistributionResult {
        val distributableCash = maxOf(0.0, cashOnHand - workingCapitalFloor)

        val totalLoanOutstanding = partners.fold(0.0) { acc, p -> acc + maxOf(0.0, p.loanBalance) }
        val loanRepaymentsTotal = minOf(distributableCash, totalLoanOutstanding)

        // If we can't cover all loans, repay each partner proportionally to their loan share.
        val perPartner = partners.map { p ->
            val loanShare = if (totalLoanOutstanding > 0) p.loanBalance / totalLoanOutstanding else 0.0
            val loanRepayment = loanRepaymentsTotal * loanShare
            PartnerDistributionResult(name = p.name, loanRepayment = loanRepayment, profitShare = 0.0, equityDraw = 0.0, total = loanRepayment)
        }.toMutableList()

        val profitPoolTotal = maxOf(0.0, distributableCash - loanRepaymentsTotal)

        val ratios: List<Double> = if (distributionRatios != null && distributionRatios.size == partners.size) {
            distributionRatios
        } else {
            partners.map { 1 / partners.size.toDouble() }
        }
        val summed = ratios.fold(0.0) { acc, r -> acc + r }
        val ratioSum = if (summed != 0.0 && !summed.isNaN()) summed else 1.0

        for (i in partners.indices) {
            val share = (ratios[i] / ratioSum) * profitPoolTotal
            val cur = perPartner[i]
            perPartner[i] = cur.copy(profitShare = share, equityDraw = share, total = cur.total + share)
        }

        val feasible = distributableCash > 0
        val shortfallToFirstDistribution = if (feasible) 0.0 else maxOf(0.0, workingCapitalFloor - cashOnHand)

        return DistributionResult(
            cashOnHand = cashOnHand,
            workingCapitalFloor = workingCapitalFloor,
            distributableCash = distributableCash,
            totalLoanOutstanding = totalLoanOutstanding,
            loanRepaymentsTotal = loanRepaymentsTotal,
            profitPoolTotal = profitPoolTotal,
            perPartner = perPartner,
            remainingAfter = distributableCash - loanRepaymentsTotal - profitPoolTotal,
            feasible = feasible,
            shortfallToFirstDistribution = shortfallToFirstDistribution,
        )
    }

    // The floor's review (partnership-settings.ts)

    /** True when the floor hasn't been touched since the start of the current calendar month. */
    fun isFloorStale(settings: PartnershipSettings, now: Instant = Instant.now()): Boolean {
        val last = JS.newDate(settings.floorLastSetAt) ?: return true
        val a = last.atOffset(ERPDate.karachi)
        val b = now.atOffset(ERPDate.karachi)
        return a.year != b.year || a.monthValue != b.monthValue
    }

    /** True only during the first 5 days of the month: the "review me" banner. */
    fun isMonthStart(now: Instant = Instant.now()): Boolean = now.atOffset(ERPDate.karachi).dayOfMonth <= 5
}

data class CategorisedLedger(
    /** Σ payments classified as equity. */
    var equityIn: Double = 0.0,
    /** Σ payments classified as loan. */
    var loanIn: Double = 0.0,
    /** Σ withdrawals classified as equity (drawing against capital). */
    var equityOut: Double = 0.0,
    /** Σ withdrawals classified as loan (loan repayment received). */
    var loanOut: Double = 0.0,
)

data class PartnerBalance(
    /** Equity contributions less equity draws: the partner's stake in retained capital. */
    val equityBalance: Double,
    /** Outstanding loan principal the business owes the partner. */
    val loanBalance: Double,
    /** Their share of the P&L since the partnership started: positive is profit, negative a loss absorbed. */
    val netPnL: Double,
    /** What the partner can claim from the business right now: loan + equity + P&L. */
    val totalClaim: Double,
)

data class PartnerDistributionInput(
    val name: String,
    val loanBalance: Double,
    val equityBalance: Double,
    val netPnL: Double,
)

data class PartnerDistributionResult(
    val name: String,
    val loanRepayment: Double,
    val profitShare: Double,
    val equityDraw: Double,
    val total: Double,
)

data class DistributionResult(
    val cashOnHand: Double,
    val workingCapitalFloor: Double,
    val distributableCash: Double,
    val totalLoanOutstanding: Double,
    val loanRepaymentsTotal: Double,
    val profitPoolTotal: Double,
    val perPartner: List<PartnerDistributionResult>,
    val remainingAfter: Double,
    val feasible: Boolean,
    val shortfallToFirstDistribution: Double,
)

// The business's profit and loss since the partnership started, each partner's position from their
// ledger plus their half of it, and what unequal salaries move between them. A salary is not a draw:
// a draw hands a partner their own capital back and is no business cost; a salary pays them for work,
// a cost like any wage, so it stays inside profit and does not touch their equity.

object ShareholderFigures {
    /** Expenses from "Pearls - Studs x2" onward. */
    const val expenseCutoff = "2025-07-02"

    /** Revenue from Shopify order #1103 onward. */
    const val revenueCutoff = "2025-07-16"

    data class Totals(
        val totalExpenses: Double,
        val totalRevenue: Double,
        val drawings: Double,
        val expShare: Double,
        val revShare: Double,
    )

    /** A sale counts on the day its order was taken (store.ts getInvoiceRevenueDate). */
    private fun revenueDate(inv: Invoice, ordersById: Map<String, Order>): String {
        if (JS.has(inv.sourceOrderId)) {
            val order = ordersById[inv.sourceOrderId ?: ""]
            if (order != null && JS.has(order.createdAt)) return order.createdAt
        }
        return inv.createdAt
    }

    /** The business P&L since the partnership started, and each partner's half of it. */
    fun partnershipTotals(
        expenses: List<Expense>,
        invoices: List<Invoice>,
        orders: List<Order>,
        additionalRevenues: List<AdditionalRevenue>,
    ): Totals {
        val ordersById = HashMap<String, Order>()
        for (o in orders) ordersById[o.id] = o
        // Drawings are excluded here on purpose: a partner taking money out is a reduction of their own
        // equity, not a shared cost. Counting it here would charge them for it twice.
        val businessExpenses = expenses.filter { it.date >= expenseCutoff && Partnership.isBusinessCost(it) }
        val totalExpenses = businessExpenses.fold(0.0) { acc, e -> acc + e.amount }

        val invoiceRevenue = invoices
            .filter { inv -> JS.has(inv.createdAt) && inv.status != InvoiceStatus.refunded && revenueDate(inv, ordersById) >= revenueCutoff }
            .fold(0.0) { acc, inv -> acc + invoiceSaleValue(inv) } // part-exchange included, as Analytics

        val invoicedOrderIds = HashSet<String>()
        for (o in orders) if (JS.has(o.invoiceId)) invoicedOrderIds.add(o.id)
        for (inv in invoices) if (JS.has(inv.sourceOrderId)) invoicedOrderIds.add(inv.sourceOrderId ?: "")
        val orderRevenue = orders
            .filter { o ->
                JS.has(o.createdAt) && o.status != OrderStatus.cancelled && o.status != OrderStatus.refunded &&
                    !invoicedOrderIds.contains(o.id) && o.createdAt >= revenueCutoff
            }
            .fold(0.0) { acc, o -> acc + (if (o.subtotal.isNaN()) 0.0 else o.subtotal) }

        val additionalRev = additionalRevenues
            .filter { it.date >= revenueCutoff }
            .fold(0.0) { acc, r -> acc + r.amount }

        val totalRevenue = invoiceRevenue + orderRevenue + additionalRev
        val drawings = expenses
            .filter { it.date >= expenseCutoff && it.category == Partnership.partnerDrawings }
            .fold(0.0) { acc, e -> acc + e.amount }

        return Totals(
            totalExpenses = totalExpenses, totalRevenue = totalRevenue, drawings = drawings,
            expShare = totalExpenses / 2, revShare = totalRevenue / 2,
        )
    }

    /** Salary rows live in Expenses, not the ledger: a wage is a cost of doing business, not a movement of anybody's capital. Newest first, per partner. */
    fun salariesByPartner(expenses: List<Expense>): Map<String, List<Expense>> {
        val out = LinkedHashMap<String, MutableList<Expense>>()
        out["mina"] = mutableListOf()
        out["ammar"] = mutableListOf()
        for (e in expenses) {
            val who = e.shareholderId
            if (e.category != Partnership.partnerSalary || who.isNullOrEmpty()) continue
            out.getOrPut(who) { mutableListOf() }.add(e)
        }
        return out.mapValues { (_, rows) -> rows.jsSorted { a, b -> JS.localeCompare(b.date, a.date).toDouble() } }
    }

    /**
     * The rows the web's ledger read shows: ordered by date, newest first, so a row with no date is not
     * on the page (Firestore leaves a document without the ordered field out of the read).
     */
    fun shown(rows: List<ShareholderLedgerRow>): List<ShareholderLedgerRow> =
        rows.filter { it.date.isNotEmpty() }
            .jsSorted { a, b ->
                val x = ERPDate.parse(a.date)?.seconds ?: 0.0
                val y = ERPDate.parse(b.date)?.seconds ?: 0.0
                y - x
            }

    data class Position(
        val id: String,
        val name: String,
        val rows: List<ShareholderLedgerRow>,
        val payments: List<ShareholderLedgerRow>,
        val withdrawals: List<ShareholderLedgerRow>,
        val salaries: List<Expense>,
        val contributed: Double,
        val withdrawn: Double,
        val salaryPaid: Double,
        val balance: PartnerBalance,
    )

    /** One partner's position, from their ledger plus their half of the P&L. `partners` are (id, name) pairs. */
    fun partnerPositions(
        partners: List<Pair<String, String>>,
        ledgers: Map<String, List<ShareholderLedgerRow>>,
        salariesBy: Map<String, List<Expense>>,
        totals: Totals,
    ): List<Position> = partners.map { s ->
        val rows = ledgers[s.first] ?: emptyList()
        val payments = rows.filter { it.type == PartnerLedgerType.payment }
        val withdrawals = rows.filter { it.type == PartnerLedgerType.withdrawal }
        val buckets = Partnership.categorise(payments, withdrawals)
        val salaries = salariesBy[s.first] ?: emptyList()
        Position(
            id = s.first, name = s.second,
            rows = rows, payments = payments, withdrawals = withdrawals, salaries = salaries,
            contributed = payments.fold(0.0) { acc, r -> acc + r.amount },
            withdrawn = withdrawals.fold(0.0) { acc, r -> acc + r.amount },
            salaryPaid = salaries.fold(0.0) { acc, e -> acc + e.amount },
            balance = Partnership.partnerBalance(buckets, expShare = totals.expShare, revShare = totals.revShare),
        )
    }

    data class SalaryGap(val ahead: Position, val behind: Position, val transferred: Double)

    /** Unequal salaries quietly move money between partners; equal ones cancel. */
    fun salaryGap(positions: List<Position>): SalaryGap? {
        if (positions.size < 2) return null
        val a = positions[0]
        val b = positions[1]
        val diff = a.salaryPaid - b.salaryPaid
        if (abs(diff) < 1) return null
        val ahead = if (diff > 0) a else b
        val behind = if (diff > 0) b else a
        return SalaryGap(ahead = ahead, behind = behind, transferred = abs(diff) / 2)
    }
}
