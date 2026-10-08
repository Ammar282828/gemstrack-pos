import Foundation

/// The ERP's dates are ISO strings ("2026-10-08T06:00:00.000Z"), and a promised day is a bare
/// "yyyy-MM-dd". Karachi has no daylight saving: UTC+5 all year.
public enum ERPDate {
    public static let karachi = TimeZone(secondsFromGMT: 5 * 3600)!

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

    /// An ISO instant, or a bare day (its UTC midnight, as `new Date("yyyy-mm-dd")` reads it in JS).
    public static func parse(_ s: String?) -> Date? {
        guard let s = s?.trimmingCharacters(in: .whitespaces), !s.isEmpty else { return nil }
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
