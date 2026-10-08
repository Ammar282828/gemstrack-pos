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
    static func num(_ s: String) -> Double {
        let t = s.replacingOccurrences(of: ",", with: "").trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty, let v = Double(t), v.isFinite else { return 0 }
        return v
    }

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
    /// TODO(logic): port CUSTOMER_SOURCES / CUSTOMER_SOURCE_LABELS (store.ts).
    static let sources: [NewOrderChoice] = [
        NewOrderChoice(id: "taheri_spillover", label: "Taheri Spillover"),
        NewOrderChoice(id: "referral", label: "Referral"),
        NewOrderChoice(id: "walkin", label: "Walk-in"),
        NewOrderChoice(id: "social_media", label: "Social media"),
        NewOrderChoice(id: "website", label: "Website"),
        NewOrderChoice(id: "other", label: "Other"),
    ]

    /// TODO(logic): port staticCategories (categories.ts).
    static let categories: [NewOrderChoice] = [
        NewOrderChoice(id: "cat001", label: "Rings"),
        NewOrderChoice(id: "cat002", label: "Tops"),
        NewOrderChoice(id: "cat003", label: "Balis"),
        NewOrderChoice(id: "cat004", label: "Lockets"),
        NewOrderChoice(id: "cat005", label: "Bracelets"),
        NewOrderChoice(id: "cat006", label: "Bracelet and Ring Set"),
        NewOrderChoice(id: "cat007", label: "Bangles"),
        NewOrderChoice(id: "cat008", label: "Chains"),
        NewOrderChoice(id: "cat009", label: "Bands"),
        NewOrderChoice(id: "cat010", label: "Locket Sets without Bangle"),
        NewOrderChoice(id: "cat011", label: "Locket Set with Bangle"),
        NewOrderChoice(id: "cat012", label: "String Sets"),
        NewOrderChoice(id: "cat013", label: "Stone Necklace Sets without Bracelets"),
        NewOrderChoice(id: "cat014", label: "Stone Necklace Sets with Bracelets"),
        NewOrderChoice(id: "cat015", label: "Gold Necklace Sets with Bracelets"),
        NewOrderChoice(id: "cat016", label: "Gold Necklace Sets without Bracelets"),
        NewOrderChoice(id: "cat017", label: "Gold Coins"),
        NewOrderChoice(id: "cat018", label: "Men's Rings"),
        NewOrderChoice(id: "cat019", label: "Loose Bracelet"),
        NewOrderChoice(id: "cat020", label: "Men's Buttons"),
    ]

    /// TODO(logic): port PLATING_TYPES (store.ts).
    static let platings = ["White Rhodium", "21K Gold Plating", "18K Gold Plating", "Chandi White Plating", "Other"]

    /// The trade's tola, in grams (lib/units.ts GRAMS_PER_TOLA): the 24k rate for our margin is typed per tola.
    /// TODO(logic): port lib/units.ts.
    static let gramsPerTola = 11.664
}
