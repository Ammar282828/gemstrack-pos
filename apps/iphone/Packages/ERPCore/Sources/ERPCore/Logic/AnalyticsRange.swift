// Ported from src/lib/analytics/range-param.ts (rangeFor, readRange, QUICK_RANGES, DEFAULT_RANGE_KEY);
// AnalyticsRangeTests mirrors range-param.test.ts.
//
// Analytics' period. The default is this month, the 1st to today (owner, 2026-10-12), not a rolling 30 days.
// A rolling period is worked out from `now` every time it is read, so a screen left open past midnight
// moves with the day. Days are Karachi's, as for every date in ERPCore.
//
// The web's range ends at `now` and its pages compare whole days; the app keeps the pages' own convention
// (the first instant of the first day to the last millisecond of the last), so a range here is already that.

import Foundation

public struct AnalyticsRange: Equatable {
    public let from: Date
    public let to: Date
    public init(from: Date, to: Date) { self.from = from; self.to = to }

    /// date-fns `isWithinInterval` (both ends included).
    public func contains(_ d: Date) -> Bool { d >= from && d <= to }
}

public enum AnalyticsPeriod {
    /// The quick choices, in the web's order.
    public static let quick: [(key: String, label: String)] = [
        ("this-month", "This month"),
        ("last-30", "Last 30 days"),
        ("last-90", "Last 90 days"),
        ("this-year", "This year"),
        ("last-year", "Last year"),
        ("all-time", "All time"),
    ]

    public static let defaultKey = "this-month"

    private static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = ERPDate.karachi
        return c
    }()

    /// The year of a `year-2025` key (the Yearly table's rows set these).
    public static func year(_ key: String) -> Int? {
        guard key.count == 9, key.hasPrefix("year-") else { return nil }
        let digits = key.dropFirst(5)
        guard digits.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
        return Int(digits)
    }

    private static func startOfDay(_ d: Date) -> Date { calendar.startOfDay(for: d) }

    /// date-fns `endOfDay`: the last millisecond of the day.
    private static func endOfDay(_ d: Date) -> Date {
        let next = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: d)) ?? d
        return next.addingTimeInterval(-0.001)
    }

    private static func span(_ a: Date, _ b: Date) -> AnalyticsRange { AnalyticsRange(from: startOfDay(a), to: endOfDay(b)) }

    private static func wholeYear(_ y: Int) -> AnalyticsRange {
        let first = calendar.date(from: DateComponents(year: y, month: 1, day: 1)) ?? Date()
        let last = calendar.date(from: DateComponents(year: y, month: 12, day: 31)) ?? Date()
        return AnalyticsRange(from: first, to: endOfDay(last))
    }

    private static func startOfMonth(_ d: Date) -> Date {
        calendar.date(from: calendar.dateComponents([.year, .month], from: d)) ?? startOfDay(d)
    }

    /// The range a key names, as of `now`; nil for all time. An unknown key is this month.
    public static func rangeFor(_ key: String, now: Date, from: String?, to: String?) -> AnalyticsRange? {
        switch key {
        case "this-month": return span(startOfMonth(now), now)
        case "last-30": return span(calendar.date(byAdding: .day, value: -29, to: now) ?? now, now)
        case "last-90": return span(calendar.date(byAdding: .day, value: -89, to: now) ?? now, now)
        case "this-year": return span(wholeYear(calendar.component(.year, from: now)).from, now)
        case "last-year": return wholeYear(calendar.component(.year, from: now) - 1)
        case "all-time": return nil
        default: break
        }
        if let y = year(key) { return wholeYear(y) }
        if key == "custom", let start = JS.parseISO(from) {
            let end = JS.parseISO(to) ?? start
            return span(start, end)
        }
        return rangeFor(defaultKey, now: now, from: nil, to: nil)
    }

    /// The stored key made safe: an unknown or broken one (a custom range with no readable start too) is this month.
    public static func knownKey(_ raw: String, from: String?) -> String {
        let asked = raw.isEmpty ? defaultKey : raw
        let known = quick.contains { $0.key == asked } || year(asked) != nil || (asked == "custom" && JS.parseISO(from) != nil)
        return known ? asked : defaultKey
    }
}
