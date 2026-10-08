// Ported from src/lib/analytics/todays-cash.ts (tests: TodaysCashTests, from todays-cash.test.ts).
//
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

import Foundation

/// TS `Method`: how money came in. Named for what it is, since a bare `Method` is too general a
/// name to share a module with.
public enum CashMethod: String, CaseIterable, Hashable {
    case cash = "Cash"
    case card = "Card"
    case bankTransfer = "Bank Transfer"
    case cheque = "Cheque"
    case notRecorded = "Not recorded"
}

public let METHODS: [CashMethod] = [.cash, .card, .bankTransfer, .cheque, .notRecorded]

public enum CashSource: String, Hashable {
    case invoice, advance, repair, extra
}

public struct CashLine: Equatable {
    public let source: CashSource
    /// INV-…, ORD-…, REP-…, or the Extra revenue row's words.
    public let ref: String
    public let who: String
    public let amount: Double
    public let method: CashMethod
    public let at: String
}

public struct ExpenseLine: Equatable {
    public let description: String
    public let amount: Double
    public let category: String
}

public struct TodaysCash {
    /// Karachi's date, yyyy-mm-dd.
    public let day: String
    /// Money in by method (exchange never here). Every method has an entry.
    public let byMethod: [CashMethod: Double]
    /// Money in, every method.
    public let totalIn: Double
    public let exchange: Double
    /// What the business paid out today.
    public let expenses: Double
    public let expenseLines: [ExpenseLine]
    /// The drawer: Cash in less expenses.
    public let netCash: Double
    public let lines: [CashLine]
}

private let KARACHI_MS = 5 * 3_600_000.0 // UTC+5, no daylight saving

/// Karachi's day around `now`: its date and [start, end] as instants.
public func karachiDayPeriod(_ now: Date) -> (day: String, period: Period) {
    let day = ERPDate.karachiDay(now)
    let startMs = (ERPDate.parse(day)?.timeIntervalSince1970 ?? 0) * 1000 - KARACHI_MS
    return (day, Period(from: Date(timeIntervalSince1970: startMs / 1000), to: Date(timeIntervalSince1970: (startMs + 86_400_000 - 1) / 1000)))
}

/// `within` of the TS: `new Date(iso)`, so a bare day is UTC midnight here (unlike cash-in's parseISO).
private func within(_ iso: String?, _ period: Period) -> Bool {
    guard let iso, !iso.isEmpty, let t = JS.newDate(iso).map(JS.ms) else { return false }
    return (period.from.map { t >= JS.ms($0) } ?? true) && (period.to.map { t <= JS.ms($0) } ?? true)
}

private func methodOf(_ m: PaymentType?) -> CashMethod {
    switch m {
    case .cash?: return .cash
    case .card?: return .card
    case .bankTransfer?: return .bankTransfer
    case .cheque?: return .cheque
    default: return .notRecorded
    }
}

public func todaysCash(
    invoices: [Invoice],
    orders: [Order],
    repairs: [Repair],
    extraRevenues: [AdditionalRevenue],
    expenses: [Expense],
    now: Date = Date()
) -> TodaysCash {
    let (day, period) = karachiDayPeriod(now)
    var lines: [CashLine] = []

    for inv in invoices {
        if inv.status == .refunded { continue }
        for p in inv.paymentHistory where within(p.date, period) {
            let amount = p.amount - paymentExchangePart(p)
            if amount != 0 {
                lines.append(CashLine(source: .invoice, ref: inv.id, who: inv.customerName.isEmpty ? "Walk-in" : inv.customerName,
                                      amount: amount, method: methodOf(p.method), at: p.date))
            }
        }
    }
    let invoiced = invoicedOrderIds(orders, invoices)
    for o in orders {
        if o.status == .cancelled || o.status == .refunded || invoiced.contains(o.id) { continue }
        for p in orderAdvancePayments(o) where within(p.date, period) && p.amount != 0 {
            lines.append(CashLine(source: .advance, ref: o.id, who: JS.has(o.customerName) ? o.customerName! : "Walk-in",
                                  amount: p.amount, method: methodOf(p.method), at: p.date))
        }
    }
    // A repair's money is written to Extra revenue with its repairId; the method is on the repair.
    var repairPayment: [String: (repair: Repair, method: PaymentType?)] = [:]
    for r in repairs {
        for p in r.payments where JS.has(p.revenueId) { repairPayment[p.revenueId!] = (r, p.method) }
    }
    for r in extraRevenues {
        if !within(r.date, period) || r.amount == 0 || r.amount.isNaN { continue }
        if let repairId = r.repairId, !repairId.isEmpty {
            let rep = repairPayment[r.id]
            let who = rep.map { JS.has($0.repair.customerName) ? $0.repair.customerName : r.description } ?? r.description
            lines.append(CashLine(source: .repair, ref: repairId, who: who, amount: r.amount, method: methodOf(rep?.method), at: r.date))
        } else {
            lines.append(CashLine(source: .extra, ref: r.description, who: "", amount: r.amount, method: .notRecorded, at: r.date))
        }
    }

    // The totals by cash-in.ts's own rule, so the page and Analytics agree to the rupee.
    let cashIn = cashInForPeriod(invoices: invoices, orders: orders, invoiced: invoiced, extraRevenues: extraRevenues, period: period)
    var byMethod = Dictionary(uniqueKeysWithValues: METHODS.map { ($0, 0.0) })
    for l in lines { byMethod[l.method, default: 0] += l.amount }
    let totalIn = lines.reduce(0) { $0 + $1.amount }

    let paidOut = expenses.filter { within($0.date, period) && $0.paidBy == .business }
    let spent = paidOut.reduce(0) { $0 + ($1.amount.isNaN ? 0 : $1.amount) }

    return TodaysCash(
        day: day,
        byMethod: byMethod,
        totalIn: totalIn,
        exchange: cashIn.exchange,
        expenses: spent,
        expenseLines: paidOut.map { ExpenseLine(description: $0.description, amount: $0.amount.isNaN ? 0 : $0.amount, category: $0.category) },
        netCash: (byMethod[.cash] ?? 0) - spent,
        lines: lines.jsSorted { Double(JS.localeCompare($0.at, $1.at)) }
    )
}
