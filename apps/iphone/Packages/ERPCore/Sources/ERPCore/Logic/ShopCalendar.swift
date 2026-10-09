// Ported from src/app/calendar/page.tsx (tests: ShopCalendarTests): the Calendar's day-by-day books.
//
// Two layers, kept apart on purpose (the page's own comment): the money layer places a SALE on the day its
// ORDER was taken (getInvoiceRevenueDate, as the dashboard and Analytics do), and an order on the day it was
// taken; the promise layer only answers "what did I say I would hand over that day" and never touches money.
// Days are Karachi's, the shop's (JSCompat.swift).

import Foundation

/// One sale or order on a day.
public struct ShopCalendarEvent: Identifiable, Hashable {
    /// Unique across both kinds ("i:INV-1", "o:ORD-1").
    public let id: String
    /// The invoice's or order's own id: what a row opens.
    public let docId: String
    public let isInvoice: Bool
    /// ISO; its time of day is what the row shows.
    public let createdAt: String
    /// Empty for a walk-in.
    public let customerName: String
    /// The document's `grandTotal`, as the page prints it.
    public let grandTotal: Double
    /// `createdAt` in seconds, for sorting; 0 when it does not read.
    let at: Double
}

/// What one day came to: sales and orders counted, the money taken, and the rows.
public struct ShopCalendarDay: Hashable {
    public var invoices = 0
    public var orders = 0
    /// Money taken that day: sales at their value (exchange included, refunded left out) and orders not yet invoiced.
    public var total = 0.0
    /// Newest first.
    public var events: [ShopCalendarEvent] = []

    public init() {}
}

/// The totals for the month on screen.
public struct ShopCalendarMonth: Equatable {
    public let sales: Int
    public let orders: Int
    public let total: Double
    /// Days with money taken.
    public let days: Int
    /// The average trading day; 0 when there was none.
    public let perTradingDay: Double
}

/// Every day that has a sale or an order, by Karachi's "yyyy-MM-dd".
public func shopCalendarDays(invoices: [Invoice], orders: [Order]) -> [String: ShopCalendarDay] {
    var days: [String: ShopCalendarDay] = [:]
    var ordersById: [String: Order] = [:]
    for o in orders { ordersById[o.id] = o }

    for inv in invoices {
        // A sale counts on its order's day when it came from one (getInvoiceRevenueDate), else its own.
        var when = inv.createdAt
        if let source = inv.sourceOrderId, !source.isEmpty, let o = ordersById[source], !o.createdAt.isEmpty {
            when = o.createdAt
        }
        // A date that does not read has no day to sit on.
        guard let placed = JS.parseISO(when) else { continue }
        let key = ERPDate.karachiDay(placed)
        days[key, default: ShopCalendarDay()].invoices += 1
        // The sale's value, part-exchange included — as Analytics and the dashboard count it.
        if inv.status != .refunded { days[key, default: ShopCalendarDay()].total += invoiceSaleValue(inv) }
        days[key, default: ShopCalendarDay()].events.append(ShopCalendarEvent(
            id: "i:" + inv.id, docId: inv.id, isInvoice: true, createdAt: inv.createdAt,
            customerName: inv.customerName, grandTotal: inv.grandTotal,
            at: JS.parseISO(inv.createdAt)?.timeIntervalSince1970 ?? 0))
    }

    for o in orders {
        guard let placed = JS.parseISO(o.createdAt) else { continue }
        let key = ERPDate.karachiDay(placed)
        days[key, default: ShopCalendarDay()].orders += 1
        // Uninvoiced orders only — an invoiced one is already counted above.
        if (o.invoiceId ?? "").isEmpty && o.status != .cancelled && o.status != .refunded {
            days[key, default: ShopCalendarDay()].total += o.subtotal
        }
        days[key, default: ShopCalendarDay()].events.append(ShopCalendarEvent(
            id: "o:" + o.id, docId: o.id, isInvoice: false, createdAt: o.createdAt,
            customerName: o.customerName ?? "", grandTotal: o.grandTotal, at: placed.timeIntervalSince1970))
    }

    // Newest first inside a day.
    return days.mapValues { day in
        var sorted = day
        sorted.events = day.events.jsSorted { Double($1.at - $0.at) }
        return sorted
    }
}

/// Pieces promised on each day, by Karachi's "yyyy-MM-dd": active orders with a promised date.
public func shopCalendarDue(orders: [Order]) -> [String: Int] {
    var due: [String: Int] = [:]
    for o in orders where isActiveOrder(o) {
        guard let promised = o.promisedDate, !promised.isEmpty, let d = JS.parseISO(promised) else { continue }
        due[ERPDate.karachiDay(d), default: 0] += 1
    }
    return due
}

/// The active orders promised on one day ("yyyy-MM-dd"), soonest taken first: what was said would be handed over.
public func shopCalendarDueOn(_ day: String, orders: [Order]) -> [Order] {
    orders.filter { o in
        guard isActiveOrder(o), let promised = o.promisedDate, !promised.isEmpty, let d = JS.parseISO(promised) else { return false }
        return ERPDate.karachiDay(d) == day
    }
}

/// The month's sales, orders and money, from the days that fall in it.
public func shopCalendarMonth(_ days: [String: ShopCalendarDay], year: Int, month: Int) -> ShopCalendarMonth {
    let prefix = ShopCalendar.monthKey(year: year, month: month) + "-"
    var sales = 0, orders = 0, tradingDays = 0
    var total = 0.0
    for (key, day) in days where key.hasPrefix(prefix) {
        sales += day.invoices
        orders += day.orders
        total += day.total
        if day.total > 0 { tradingDays += 1 }
    }
    return ShopCalendarMonth(sales: sales, orders: orders, total: total, days: tradingDays,
                             perTradingDay: total != 0 && tradingDays > 0 ? total / Double(tradingDays) : 0)
}

/// The month grid and its words. Weeks start on Sunday, as the web's day picker draws them.
public enum ShopCalendar {
    private static let karachi: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = ERPDate.karachi
        return c
    }()

    private static let monthNames = ["January", "February", "March", "April", "May", "June", "July", "August",
                                     "September", "October", "November", "December"]

    /// Karachi's year, month and day of an instant.
    public static func today(now: Date = Date()) -> (year: Int, month: Int, day: Int) {
        let c = karachi.dateComponents([.year, .month, .day], from: now)
        return (c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }

    /// "2026-10".
    public static func monthKey(year: Int, month: Int) -> String {
        String(format: "%04d-%02d", year, month)
    }

    /// "2026-10-09".
    public static func dayKey(year: Int, month: Int, day: Int) -> String {
        String(format: "%04d-%02d-%02d", year, month, day)
    }

    /// The month `by` months on (or back), with the year carried.
    public static func step(year: Int, month: Int, by delta: Int) -> (year: Int, month: Int) {
        let index = year * 12 + (month - 1) + delta
        return (Int((Double(index) / 12).rounded(.down)), ((index % 12) + 12) % 12 + 1)
    }

    /// "October 2026".
    public static func title(year: Int, month: Int) -> String {
        let name = (1...12).contains(month) ? monthNames[month - 1] : ""
        return "\(name) \(year)"
    }

    /// "October 9, 2026" for a "yyyy-MM-dd" day.
    public static func longDay(_ key: String) -> String {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, (1...12).contains(parts[1]) else { return key }
        return "\(monthNames[parts[1] - 1]) \(parts[2]), \(parts[0])"
    }

    /// The days of the month in a grid of weeks: a gap for each weekday before the 1st, then 1…n.
    public static func cells(year: Int, month: Int) -> [Int?] {
        guard let first = karachi.date(from: DateComponents(year: year, month: month, day: 1)),
              let days = karachi.range(of: .day, in: .month, for: first) else { return [] }
        let lead = max(0, karachi.component(.weekday, from: first) - 1)
        return Array<Int?>(repeating: nil, count: lead) + days.map { Optional($0) }
    }

    /// A day's money in a cell that has room for about six characters (`dayMoney`): 850, 12k, 1.5M.
    public static func dayMoney(_ n: Double) -> String {
        if n >= 999_500 {
            var s = JS.toFixed(n / 1_000_000, 1)
            if s.hasSuffix(".0") { s.removeLast(2) }
            return s + "M"
        }
        if n >= 1000 { return JS.number(JS.round(n / 1000)) + "k" }
        return JS.number(JS.round(n))
    }

    /// The time of day a row shows, in Karachi: "4:05 pm"; empty when the date does not read.
    public static func clock(iso: String) -> String {
        guard let d = JS.parseISO(iso) else { return "" }
        let c = karachi.dateComponents([.hour, .minute], from: d)
        let hour = c.hour ?? 0
        let twelve = hour % 12 == 0 ? 12 : hour % 12
        return "\(twelve):" + String(format: "%02d", c.minute ?? 0) + (hour < 12 ? " am" : " pm")
    }
}
