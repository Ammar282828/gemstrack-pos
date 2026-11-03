import Foundation

/// The ERP's dates are ISO strings ("2026-10-08T06:00:00.000Z"), and a promised day is a bare
/// "yyyy-MM-dd". Karachi has no daylight saving: UTC+5 all year.
public enum ERPDate {
    public static let karachi = TimeZone(secondsFromGMT: 5 * 3600)!

    /// The shop's days: gregorian, Karachi (a phone set to a Buddhist or Islamic calendar must not shift a year).
    public static var karachiCalendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = karachi
        return c
    }

    /// For a date picker's day: gregorian whatever the phone's calendar, in the phone's own zone (the zone the
    /// picker shows the 6th in), so "6 Oct" stays the 6th.
    public static var pickerCalendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = .current
        return c
    }

    private static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let plain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
    private static let day: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(secondsFromGMT: 0)
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    /// Strings already read. An ISO8601DateFormatter costs tens of microseconds a string, and a list asks for the same few
    /// thousand `createdAt`s on every sort, filter, group and row; a read is a dictionary hit after the first. A failed read
    /// is kept too (`.some(nil)`). Cleared whole when it grows past the limit, so it can never hold more than that.
    private final class Parsed: @unchecked Sendable {
        let lock = NSLock()
        var values: [String: Date?] = [:]
        static let limit = 8192
    }
    private static let parsed = Parsed()

    /// An ISO instant, or a bare day (its UTC midnight, as `new Date("yyyy-mm-dd")` reads it in JS).
    public static func parse(_ s: String?) -> Date? {
        guard let s else { return nil }
        parsed.lock.lock()
        let hit = parsed.values[s]
        parsed.lock.unlock()
        if let hit { return hit }
        let made = read(s)
        parsed.lock.lock()
        if parsed.values.count >= Parsed.limit { parsed.values.removeAll(keepingCapacity: true) }
        parsed.values[s] = Optional<Date?>.some(made)
        parsed.lock.unlock()
        return made
    }

    private static func read(_ raw: String) -> Date? {
        let s = raw.trimmingCharacters(in: .whitespaces)
        if s.isEmpty { return nil }
        if let d = withFraction.date(from: s) ?? plain.date(from: s) { return d }
        if s.count == 10, let d = day.date(from: s) { return d }
        return nil
    }

    public static func iso(_ d: Date) -> String { withFraction.string(from: d) }

    /// Karachi's calendar day of an instant, "yyyy-MM-dd".
    public static func karachiDay(_ d: Date) -> String {
        day.string(from: d.addingTimeInterval(TimeInterval(karachi.secondsFromGMT())))
    }
}
