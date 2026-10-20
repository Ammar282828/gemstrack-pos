import Foundation
import ERPCore

// What the order form's views and its arithmetic share, with no screen in it: how typed text becomes a
// number, Karachi's days, and the lists the web keeps in store.ts (not ported to ERPCore yet).

// MARK: Numbers

enum NewOrderFormat {
    static func trim(_ s: String) -> String {
        s.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// What was typed, as a number: commas are thousands, anything unreadable is 0 (`Number(x) || 0`).
    /// Never NaN or infinity: a NaN in the JSON body would crash JSONSerialization.
    static func num(_ s: String) -> Double { ShopNumber.parse(s) ?? 0 }

    /// Typed but not a number ("12abc"): the field is invalid, not 0 (a screen shows it and holds Save).
    static func unreadable(_ s: String) -> Bool { ShopNumber.isUnreadable(s) }

    static func finite(_ x: Double) -> Double { x.isFinite ? x : 0 }

    /// 4.2, 22.5, 8: no trailing zeros.
    static func trimmed(_ x: Double, digits: Int = 3) -> String {
        guard x.isFinite else { return "0" }
        var s = String(format: "%.\(digits)f", x)
        if s.contains(".") {
            while s.hasSuffix("0") { s.removeLast() }
            if s.hasSuffix(".") { s.removeLast() }
        }
        return s == "-0" ? "0" : s
    }

    /// A number back into a box; 0 is blank (decisions.md "Number fields": no pre-filled zeros to delete).
    static func boxText(_ x: Double, digits: Int = 2) -> String {
        x == 0 ? "" : trimmed(x, digits: digits)
    }

    /// A sum of money for a box: whole rupees (ERPCore `rupees`, half up), blank for none. An old order's
    /// paise are not carried into a field that types only digits (owner, 2026-10-17: "there should be no decimals").
    static func rupeeBox(_ x: Double?) -> String { boxText(rupees(x), digits: 0) }

    /// 1 piece, 3 pieces.
    static func pieces(_ n: Int) -> String { n == 1 ? "1 piece" : "\(n) pieces" }
}

// MARK: Karachi's days

/// A promised day is a bare "yyyy-MM-dd" in Karachi's calendar (lib/order-timing.ts, the form's
/// `<input type="date">`). Karachi has no daylight saving, so a day is 86,400 seconds.
enum NewOrderDay {
    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = ERPDate.karachi
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func string(_ d: Date) -> String { formatter.string(from: d) }

    /// Midnight at the start of that day in Karachi.
    static func date(_ s: String) -> Date? { s.isEmpty ? nil : formatter.date(from: s) }

    static var today: String { string(Date()) }

    /// The day N days from today (the form's `promiseIn`).
    static func after(_ days: Int) -> String {
        string(Date().addingTimeInterval(TimeInterval(days) * 86_400))
    }

    /// Whole days from today to that day: negative once it has passed.
    static func daysAway(_ s: String) -> Int? {
        guard let d = date(s), let t = date(today) else { return nil }
        return Int((d.timeIntervalSince(t) / 86_400).rounded())
    }
}

// MARK: Lists the web keeps in store.ts

struct NewOrderChoice: Identifiable, Hashable {
    let id: String
    let label: String
}

enum NewOrderWords {
    /// store.ts CUSTOMER_SOURCES / CUSTOMER_SOURCE_LABELS.
    static let sources: [NewOrderChoice] = customerSources.map { NewOrderChoice(id: $0, label: customerSourceLabel($0) ?? $0) }

    /// categories.ts staticCategories.
    static let categories: [NewOrderChoice] = staticCategories.map { NewOrderChoice(id: $0.id, label: $0.title) }

    /// store.ts PLATING_TYPES.
    static let platings = platingTypes

    /// The trade's tola, in grams (lib/units.ts): the 24k rate for our margin is typed per tola.
    static let gramsPerTola = ERPCore.gramsPerTola
}
