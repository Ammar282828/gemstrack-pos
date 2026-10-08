import Foundation
import ERPCore

// Karachi's days and the period picker, as the web's Analytics has them (components/analytics,
// lib/analytics/range-param.ts). Every type here is prefixed Ana so it cannot meet another screen
// group's type of the same name.

/// date-fns on Karachi's calendar: "today", "this year" and a day's start and end are the shop's,
/// wherever the phone is.
enum AnaDate {
    static let karachi: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = ERPDate.karachi
        return c
    }()

    private static let karachiOffset: TimeInterval = 5 * 3600

    private static func formatter(_ pattern: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = ERPDate.karachi
        f.dateFormat = pattern
        return f
    }

    private static let zoneless: [DateFormatter] = [
        formatter("yyyy-MM-dd'T'HH:mm:ss.SSS"),
        formatter("yyyy-MM-dd'T'HH:mm:ss"),
        formatter("yyyy-MM-dd'T'HH:mm"),
    ]
    private static let dayKeyFormat = formatter("yyyy-MM-dd")
    private static let monthKeyFormat = formatter("yyyy-MM")
    private static let dayMonthYearFormat = formatter("d MMM yyyy")
    private static let dayMonthFormat = formatter("d MMM")
    private static let weekdayFormat = formatter("EEE d MMM yyyy")
    private static let longDayFormat = formatter("EEEE, d MMMM yyyy")
    private static let monthShortFormat = formatter("MMM yy")

    /// `new Date(iso)`: an instant, a bare day (UTC midnight) or a date-time with no zone (Karachi's clock).
    static func newDate(_ s: String?) -> Date? {
        guard let t = s?.trimmingCharacters(in: .whitespaces), !t.isEmpty else { return nil }
        if let d = ERPDate.parse(t) { return d }
        for f in zoneless {
            if let d = f.date(from: t) { return d }
        }
        return nil
    }

    /// date-fns `parseISO`: as `newDate`, except that a bare day is the local (here Karachi's) midnight.
    static func parseISO(_ s: String?) -> Date? {
        guard let t = s?.trimmingCharacters(in: .whitespaces), !t.isEmpty else { return nil }
        if t.count == 10, let d = ERPDate.parse(t) { return d.addingTimeInterval(-karachiOffset) }
        return newDate(t)
    }

    static func startOfDay(_ d: Date) -> Date { karachi.startOfDay(for: d) }

    /// date-fns `endOfDay`: the last millisecond of the day.
    static func endOfDay(_ d: Date) -> Date {
        let next = karachi.date(byAdding: .day, value: 1, to: karachi.startOfDay(for: d)) ?? d
        return next.addingTimeInterval(-0.001)
    }

    static func adding(days: Int, to d: Date) -> Date { karachi.date(byAdding: .day, value: days, to: d) ?? d }

    static func year(of d: Date) -> Int { karachi.component(.year, from: d) }

    static func startOfYear(_ year: Int) -> Date {
        karachi.date(from: DateComponents(year: year, month: 1, day: 1)) ?? Date()
    }

    static func endOfYear(_ year: Int) -> Date {
        endOfDay(karachi.date(from: DateComponents(year: year, month: 12, day: 31)) ?? Date())
    }

    /// "2026-10-08": the Karachi day an instant falls on.
    static func dayKey(_ d: Date) -> String { dayKeyFormat.string(from: d) }

    /// "2026-10".
    static func monthKey(_ d: Date) -> String { monthKeyFormat.string(from: d) }

    /// Noon on a Karachi day, where a chart draws it: whichever zone the phone is in, the same day.
    static func plotDate(day key: String) -> Date {
        (parseISO(key) ?? Date()).addingTimeInterval(12 * 3600)
    }

    /// The 15th at noon, where a chart draws a month.
    static func plotDate(month key: String) -> Date {
        let parts = key.split(separator: "-")
        guard parts.count == 2, let y = Int(parts[0]), let m = Int(parts[1]) else { return Date() }
        return karachi.date(from: DateComponents(year: y, month: m, day: 15, hour: 12)) ?? Date()
    }

    /// "8 Oct 2026".
    static func dayMonthYear(_ d: Date) -> String { dayMonthYearFormat.string(from: d) }

    /// "8 Oct".
    static func dayMonth(_ d: Date) -> String { dayMonthFormat.string(from: d) }

    /// "Thu 8 Oct 2026".
    static func weekday(_ d: Date) -> String { weekdayFormat.string(from: d) }

    /// "Thursday, 8 October 2026".
    static func longDay(_ d: Date) -> String { longDayFormat.string(from: d) }

    /// "Oct 26" (date-fns 'MMM yy').
    static func monthShort(_ d: Date) -> String { monthShortFormat.string(from: d) }
}

/// A period as the pages filter by it: the first instant of its first day to the last of its last.
struct AnaRange: Equatable {
    let from: Date
    let to: Date

    /// date-fns `isWithinInterval` (both ends included).
    func contains(_ d: Date) -> Bool { d >= from && d <= to }
}

/// What the picker says and what the pages read: the key, and its range (nil is all time).
struct AnaPeriodState {
    let key: String
    let range: AnaRange?
}

// TODO(logic): port lib/analytics/range-param.ts (rangeFor, readRange) into ERPCore with range-param.test.ts.
/// The period picker's rules. The web keeps the key in the address (`?range=last-90`, or
/// `?range=custom&from=…&to=…`); the app keeps it in `@AppStorage("erp.analytics.range")` (and the
/// custom days in `erp.analytics.from` / `.to`), so every tab reads the same one.
///
/// A rolling period (last 30 / 90 days, this year) is worked out from `now` every time it is read,
/// so a screen left open past midnight moves with the day.
enum AnaPeriod {
    struct Quick: Identifiable {
        let key: String
        let label: String
        var id: String { key }
    }

    static let quick: [Quick] = [
        Quick(key: "last-30", label: "Last 30 days"),
        Quick(key: "last-90", label: "Last 90 days"),
        Quick(key: "this-year", label: "This year"),
        Quick(key: "last-year", label: "Last year"),
        Quick(key: "all-time", label: "All time"),
    ]

    static let defaultKey = "last-30"
    static let storageKey = "erp.analytics.range"

    /// The year of a `year-2025` key (the Yearly table's rows set these).
    static func year(_ key: String) -> Int? {
        guard key.count == 9, key.hasPrefix("year-") else { return nil }
        let digits = key.dropFirst(5)
        guard digits.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
        return Int(digits)
    }

    private static func span(_ a: Date, _ b: Date) -> AnaRange {
        AnaRange(from: AnaDate.startOfDay(a), to: AnaDate.endOfDay(b))
    }

    private static func wholeYear(_ y: Int) -> AnaRange {
        AnaRange(from: AnaDate.startOfYear(y), to: AnaDate.endOfYear(y))
    }

    /// The range a key names, as of `now`; nil for all time. An unknown key is the last 30 days.
    static func rangeFor(_ key: String, now: Date, from: String?, to: String?) -> AnaRange? {
        switch key {
        case "last-30": return span(AnaDate.adding(days: -29, to: now), now)
        case "last-90": return span(AnaDate.adding(days: -89, to: now), now)
        case "this-year": return span(AnaDate.startOfYear(AnaDate.year(of: now)), now)
        case "last-year": return wholeYear(AnaDate.year(of: now) - 1)
        case "all-time": return nil
        default: break
        }
        if let y = year(key) { return wholeYear(y) }
        if key == "custom", let start = AnaDate.parseISO(from) {
            let end = AnaDate.parseISO(to) ?? start
            return span(start, end)
        }
        return rangeFor(defaultKey, now: now, from: nil, to: nil)
    }

    /// The stored key, made safe: an unknown or broken one falls back to the last 30 days.
    static func read(key raw: String, from: String?, to: String?, now: Date) -> AnaPeriodState {
        let asked = raw.isEmpty ? defaultKey : raw
        let known = quick.contains { $0.key == asked }
            || year(asked) != nil
            || (asked == "custom" && AnaDate.parseISO(from) != nil)
        let key = known ? asked : defaultKey
        return AnaPeriodState(key: key, range: rangeFor(key, now: now, from: from, to: to))
    }

    /// "8 Sep 2026 to 7 Oct 2026", or "All time".
    static func describe(_ range: AnaRange?) -> String {
        guard let range else { return "All time" }
        let a = AnaDate.dayMonthYear(range.from)
        let b = AnaDate.dayMonthYear(range.to)
        return a == b ? a : "\(a) to \(b)"
    }
}
