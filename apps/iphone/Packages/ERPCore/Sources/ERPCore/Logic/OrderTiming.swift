// Ported from src/lib/order-timing.ts. (It has no TS test; OrderTimingTests was written against
// the TS run under TZ=Asia/Karachi.)
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
// calendar days in the local zone, and the shop's devices are Karachi's (JSCompat.swift).

import Foundation

/// Statuses still waiting on the bench. Cancelled and Refunded are finished.
public func isActiveOrder(_ order: Order) -> Bool {
    order.status == .pending || order.status == .inProgress
}

/// How long an order with no promised date may sit before it is called late.
public let LEGACY_OVERDUE_DAYS = 7

/// Promised within this many days, and it is urgent.
///
/// Seven is a bench week: a piece promised inside it has to be started now, not
/// queued. The same window feeds the quick dates on the order form, so a 7-day
/// promise is marked urgent the moment it is chosen and the counter sees what it
/// is committing the workshop to.
public let URGENT_WINDOW_DAYS = 7

/// The default promise for a new order, when nothing else was agreed.
public let DEFAULT_PROMISE_DAYS = 14

public enum PromiseState: String, Hashable {
    /// No promised date, and not old enough for the fallback to fire (TS 'none'; not `.none`, which reads as an absent optional).
    case noPromise = "none"
    /// Promised, still ahead.
    case upcoming
    /// Promised for today.
    case today
    /// Past its promise, or past the fallback age.
    case late
}

public struct OrderTiming: Equatable {
    /// Start of the promised day (Karachi), or nil when the order never had one.
    public let due: Date?
    /// Negative before the promise, 0 on the day, positive after.
    public let daysLate: Int
    public let state: PromiseState
    /// True when `state` came from the age fallback rather than a real promise.
    public let estimated: Bool

    public init(due: Date?, daysLate: Int, state: PromiseState, estimated: Bool) {
        self.due = due
        self.daysLate = daysLate
        self.state = state
        self.estimated = estimated
    }
}

/// Due within the urgent window, due today, or already late, and actually promised.
/// An order with no date is not urgent, it is undated, and that is a different problem
/// with its own flag.
public func isUrgent(_ t: OrderTiming) -> Bool {
    if t.due == nil { return false }
    if t.state == .late || t.state == .today { return true }
    return -t.daysLate <= URGENT_WINDOW_DAYS
}

private func day(_ iso: String?) -> Date? {
    JS.parseISO(iso).map(JS.karachiStartOfDay)
}

/// `now` is passed in rather than read from the clock so callers can group a
/// whole list against one instant, and so this is testable.
public func orderTiming(_ order: Order, now: Date) -> OrderTiming {
    let due = day(order.promisedDate)

    if let due {
        let daysLate = JS.calendarDays(now, since: due)
        return OrderTiming(
            due: due,
            daysLate: daysLate,
            state: daysLate > 0 ? .late : daysLate == 0 ? .today : .upcoming,
            estimated: false
        )
    }

    // No promise on record. Fall back to the age rule so orders taken before
    // this field existed are still surfaced.
    let age = day(order.createdAt).map { JS.calendarDays(now, since: $0) } ?? 0
    return OrderTiming(
        due: nil,
        daysLate: age - LEGACY_OVERDUE_DAYS,
        state: age >= LEGACY_OVERDUE_DAYS ? .late : .noPromise,
        estimated: true
    )
}

/// Active orders that are late, worst first.
public func lateOrders(_ orders: [Order], now: Date) -> [(order: Order, timing: OrderTiming)] {
    orders
        .filter(isActiveOrder)
        .map { (order: $0, timing: orderTiming($0, now: now)) }
        .filter { $0.timing.state == .late }
        .jsSorted { Double($1.timing.daysLate - $0.timing.daysLate) }
}

/// Active orders promised within the next `days`, soonest first.
public func dueSoon(_ orders: [Order], now: Date, days: Int = 7) -> [(order: Order, timing: OrderTiming)] {
    orders
        .filter(isActiveOrder)
        .map { (order: $0, timing: orderTiming($0, now: now)) }
        .filter { $0.timing.due != nil && $0.timing.daysLate <= 0 && -$0.timing.daysLate <= days }
        .jsSorted { Double($1.timing.daysLate - $0.timing.daysLate) }
}

/// "3 days late" / "due today" / "in 5 days".
public func timingLabel(_ t: OrderTiming) -> String {
    if t.state == .today { return "due today" }
    if t.state == .late {
        let n = t.due != nil ? t.daysLate : t.daysLate + LEGACY_OVERDUE_DAYS
        let noun = t.due != nil ? "late" : "old"
        return "\(n) day\(n == 1 ? "" : "s") \(noun)"
    }
    if t.state == .upcoming {
        let n = -t.daysLate
        return "in \(n) day\(n == 1 ? "" : "s")"
    }
    return ""
}
