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
// Karachi, as everywhere in ERPCore (JSCompat.swift).

import Foundation

public enum Overheads {
    /// The benchmark starts here. Earlier months are not scored against it.
    public static let benchmarkStart = "2026-09"

    private static let karachi: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = ERPDate.karachi
        return c
    }()

    private static let monthNames = ["January", "February", "March", "April", "May", "June", "July", "August",
                                     "September", "October", "November", "December"]

    public static func overheadTotal(_ items: [OverheadItem]) -> Double {
        items.reduce(0) { sum, i in sum + (i.amount.isNaN ? 0 : i.amount) }
    }

    /// An id that will not collide with the seeded ones or with a sibling row.
    public static func newOverheadId(_ existing: [OverheadItem]) -> String {
        var n = existing.count + 1
        let taken = Set(existing.map(\.id))
        while taken.contains("item-\(n)") { n += 1 }
        return "item-\(n)"
    }

    /// "2026-10": the month of an instant, in Karachi.
    public static func monthKey(_ d: Date) -> String { String(ERPDate.karachiDay(d).prefix(7)) }

    /// "2026-09" as (2026, 9); nil for anything date-fns' parseISO would not read as `${key}-01`.
    static func parts(_ key: String) -> (year: Int, month: Int)? {
        let c = Array(key)
        guard c.count == 7, c[4] == "-",
              c.enumerated().allSatisfy({ i, ch in i == 4 || (ch.isASCII && ch.isNumber) }),
              let y = Int(String(c[0..<4])), let m = Int(String(c[5..<7])), (1...12).contains(m) else { return nil }
        return (y, m)
    }

    /// "September 2026"; a key that is not a month is said as it is.
    public static func monthLabel(_ key: String) -> String {
        guard let p = parts(key) else { return key }
        return "\(monthNames[p.month - 1]) \(String(format: "%04d", p.year))"
    }

    /// Every month from the benchmark's start up to and including `now`.
    public static func monthsSinceStart(_ now: Date, start: String = benchmarkStart) -> [String] {
        guard var at = parts(start) else { return [] }
        let last = monthKey(now)
        var out: [String] = []
        while true {
            let key = String(format: "%04d-%02d", at.year, at.month)
            if key > last { break }
            out.append(key)
            if out.count > 600 { break } // a bad start date must not spin forever
            at = at.month == 12 ? (at.year + 1, 1) : (at.year, at.month + 1)
        }
        return out
    }

    /// The sheet in force for a given month: the latest plan starting on or before it. Months before the
    /// first plan have no benchmark and are not scored.
    public static func planForMonth(_ plans: [OverheadPlan], _ month: String) -> [OverheadItem]? {
        let applicable = plans
            .filter { $0.from <= month }
            .jsSorted { a, b in Double(JS.localeCompare(a.from, b.from)) }
        return applicable.last?.items
    }

    /// `now` is passed in rather than read from the clock so a whole screen agrees on one instant.
    public static func overheadProgress(target: Double, earned: Double, now: Date) -> OverheadProgress {
        let shortfall = max(0, target - earned)
        let daysInMonth = karachi.range(of: .day, in: .month, for: now)?.count ?? 30
        let daysLeft = max(1, daysInMonth - karachi.component(.day, from: now) + 1)
        return OverheadProgress(
            target: target,
            earned: earned,
            shortfall: shortfall,
            percent: target > 0 ? min(100, max(0, (earned / target) * 100)) : 0,
            daysLeft: daysLeft,
            perDayNeeded: shortfall > 0 ? shortfall / Double(daysLeft) : 0
        )
    }

    // MARK: Revenue

    /// Revenue per month, by the rule Analytics uses.
    ///
    /// Both halves count. Invoices alone left out every order taken but not yet billed. An invoice is
    /// dated to the day its ORDER was taken rather than the day it was finally billed, so a sale does
    /// not drift across a month boundary when it happens to be invoiced late; an uninvoiced order
    /// counts at subtotal, and drops out once it has an invoice so nothing is counted twice.
    public static func revenueByMonth(invoices: [Invoice], orders: [Order]) -> [String: OverheadRevenue] {
        let byId = Dictionary(orders.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        var out: [String: OverheadRevenue] = [:]

        for inv in invoices {
            if inv.createdAt.isEmpty || inv.status == .refunded { continue }
            let fromOrder = JS.has(inv.sourceOrderId) ? byId[inv.sourceOrderId ?? ""]?.createdAt : nil
            let dated = JS.has(fromOrder) ? (fromOrder ?? "") : inv.createdAt
            guard let d = JS.parseISO(dated) else { continue }
            // The sale's value with its exchange added back, as Analytics counts it (analytics/sale-value.ts):
            // grandTotal alone counted a part-exchange sale at its cash part.
            let value = invoiceSaleValue(inv)
            out[monthKey(d), default: OverheadRevenue()].add(invoiced: value)
        }

        for o in orders {
            if o.createdAt.isEmpty { continue }
            if o.status == .cancelled || o.status == .refunded || JS.has(o.invoiceId) { continue }
            guard let d = JS.parseISO(o.createdAt) else { continue }
            out[monthKey(d), default: OverheadRevenue()].add(uninvoiced: o.subtotal.isNaN ? 0 : o.subtotal)
        }

        return out
    }

    /// One row per month from the benchmark's start to now, newest first.
    public static func monthlyRows(_ plans: [OverheadPlan], revenue: [String: OverheadRevenue], now: Date,
                                   start: String = benchmarkStart) -> [OverheadMonthRow] {
        let current = monthKey(now)
        return monthsSinceStart(now, start: start).map { (month: String) -> OverheadMonthRow in
            let items = planForMonth(plans, month)
            let target = items.map(overheadTotal) ?? 0
            let earned = revenue[month]?.total ?? 0
            return OverheadMonthRow(
                month: month,
                label: monthLabel(month),
                target: target,
                earned: earned,
                surplus: earned - target,
                met: target > 0 && earned >= target,
                percent: target > 0 ? min(100, max(0, (earned / target) * 100)) : 0,
                inProgress: month == current
            )
        }
        .reversed()
    }

    /// Totals across the finished months, so an in-progress month cannot flatter them.
    public static func benchmarkSummary(_ rows: [OverheadMonthRow]) -> OverheadSummary {
        let done = rows.filter { !$0.inProgress && $0.target > 0 }
        let met = done.filter(\.met).count
        var best: OverheadMonthRow?
        var worst: OverheadMonthRow?
        for r in done {
            if best == nil || r.surplus > best!.surplus { best = r }
            if worst == nil || r.surplus < worst!.surplus { worst = r }
        }
        return OverheadSummary(
            monthsScored: done.count,
            monthsMet: met,
            averageRevenue: done.isEmpty ? 0 : done.reduce(0) { $0 + $1.earned } / Double(done.count),
            cumulativeSurplus: done.reduce(0) { $0 + $1.surplus },
            best: best,
            worst: worst
        )
    }
}

public struct OverheadProgress: Hashable {
    public let target: Double
    public let earned: Double
    /// 0 once the target is passed.
    public let shortfall: Double
    /// 0–100, clamped, for a bar.
    public let percent: Double
    /// Days left in the month, today included. Only meaningful for the current one.
    public let daysLeft: Int
    /// What the remaining days have to average. 0 once covered.
    public let perDayNeeded: Double
}

/// One month's takings: billed, still only ordered, and the two together.
public struct OverheadRevenue: Hashable {
    public private(set) var invoiced: Double = 0
    public private(set) var uninvoiced: Double = 0
    public private(set) var total: Double = 0

    public init() {}

    public init(invoiced: Double, uninvoiced: Double, total: Double) {
        self.invoiced = invoiced
        self.uninvoiced = uninvoiced
        self.total = total
    }

    mutating func add(invoiced v: Double) {
        invoiced += v
        total += v
    }

    mutating func add(uninvoiced v: Double) {
        uninvoiced += v
        total += v
    }
}

public struct OverheadMonthRow: Hashable, Identifiable {
    public let month: String
    public let label: String
    public let target: Double
    public let earned: Double
    /// Positive when the month cleared its benchmark.
    public let surplus: Double
    public let met: Bool
    public let percent: Double
    /// True for the month still being lived: it has not finished yet.
    public let inProgress: Bool

    public var id: String { month }
}

public struct OverheadSummary: Hashable {
    public let monthsScored: Int
    public let monthsMet: Int
    public let averageRevenue: Double
    /// Cumulative, so a bad month and a good one net out the way cash does.
    public let cumulativeSurplus: Double
    public let best: OverheadMonthRow?
    public let worst: OverheadMonthRow?
}
