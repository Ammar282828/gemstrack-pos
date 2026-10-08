import Foundation
import ERPCore

// The small rules and words the Analytics pages use that ERPCore does not hold yet (each marked
// TODO(logic)), and the formatting they share. Every money rule itself is ERPCore's:
// invoiceSaleValue, bookedAsSale, cashInForPeriod, invoicedOrderIds, invoiceMargin / orderMargin,
// saleCustomerKey.

enum AnaRules {
    // TODO(logic): port getInvoiceRevenueDate (store.ts)
    /// A sale counts on its order's day when it came from one.
    static func revenueDate(_ inv: Invoice, _ ordersById: [String: Order]) -> String {
        if let source = inv.sourceOrderId, !source.isEmpty, let o = ordersById[source], !o.createdAt.isEmpty {
            return o.createdAt
        }
        return inv.createdAt
    }

    // TODO(logic): port isBusinessCost (partnership.ts)
    /// A partner's drawing is a distribution of profit, not a cost of earning it.
    static func isBusinessCost(_ e: Expense) -> Bool { e.category != "Partner Drawings" }
}

/// `staticCategories` (lib/categories.ts): the list name of a category id.
enum AnaCategories {
    // TODO(logic): port categoryTitle / staticCategories (categories.ts)
    private static let titles: [String: String] = [
        "cat001": "Rings", "cat002": "Tops", "cat003": "Balis", "cat004": "Lockets", "cat005": "Bracelets",
        "cat006": "Bracelet and Ring Set", "cat007": "Bangles", "cat008": "Chains", "cat009": "Bands",
        "cat010": "Locket Sets without Bangle", "cat011": "Locket Set with Bangle", "cat012": "String Sets",
        "cat013": "Stone Necklace Sets without Bracelets", "cat014": "Stone Necklace Sets with Bracelets",
        "cat015": "Gold Necklace Sets with Bracelets", "cat016": "Gold Necklace Sets without Bracelets",
        "cat017": "Gold Coins", "cat018": "Men's Rings", "cat019": "Loose Bracelet", "cat020": "Men's Buttons",
    ]

    /// The category's name, or "Uncategorized".
    static func title(_ id: String) -> String { titles[id] ?? "Uncategorized" }
}

/// Where a sale came from (`CUSTOMER_SOURCES`, store.ts), plus the catch-all.
enum AnaSources {
    static let unclassified = "unclassified"

    // TODO(logic): port CUSTOMER_SOURCES / CUSTOMER_SOURCE_LABELS (store.ts)
    /// The ERP's order: the six real sources lead and Unclassified trails.
    static let keys: [String] = ["taheri_spillover", "referral", "walkin", "social_media", "website", "other", unclassified]

    static func label(_ key: String) -> String {
        switch key {
        case "taheri_spillover": return "Taheri Spillover"
        case "referral": return "Referral"
        case "walkin": return "Walk-in"
        case "social_media": return "Social media"
        case "website": return "Website"
        case "other": return "Other"
        default: return "Unclassified"
        }
    }
}

/// A SKU worth showing a person (lib/sku.ts stockSku): a piece described for one bill gets a
/// NEW-… or BILL-… key that is not a stock number.
enum AnaSku {
    // TODO(logic): port stockSku (sku.ts)
    static func isStock(_ sku: String) -> Bool {
        !sku.isEmpty && !sku.hasPrefix("NEW-") && !sku.hasPrefix("BILL-")
    }
}

/// Where a customer's row opens.
enum AnaPath {
    private static let safe: CharacterSet = {
        var s = CharacterSet.alphanumerics
        s.insert(charactersIn: "-_.~")
        return s
    }()

    static func customer(_ id: String) -> String {
        "/customers/" + (id.addingPercentEncoding(withAllowedCharacters: safe) ?? id)
    }
}

/// JavaScript's `sort` is stable; this is a descending sort that keeps first-seen order among equals.
enum AnaSort {
    static func descending<T>(_ list: [T], by key: (T) -> Double) -> [T] {
        var keyed: [(offset: Int, key: Double, item: T)] = []
        for (i, x) in list.enumerated() {
            keyed.append((offset: i, key: key(x), item: x))
        }
        let sorted = keyed.sorted { (a: (offset: Int, key: Double, item: T), b: (offset: Int, key: Double, item: T)) -> Bool in
            a.key != b.key ? a.key > b.key : a.offset < b.offset
        }
        return sorted.map { (e: (offset: Int, key: Double, item: T)) -> T in e.item }
    }
}

/// A name that may be empty: the first of these that has something in it (JS `a || b || c`).
enum AnaText {
    static func firstFilled(_ options: [String?], fallback: String) -> String {
        for o in options {
            if let o, !o.isEmpty { return o }
        }
        return fallback
    }
}

enum AnaFormat {
    private static let formatters: [NumberFormatter] = (0...3).map { (digits: Int) -> NumberFormatter in
        let f = NumberFormatter()
        f.locale = Locale(identifier: "en_US")
        f.numberStyle = .decimal
        f.minimumFractionDigits = 0
        f.maximumFractionDigits = digits
        return f
    }

    /// `toLocaleString('en-US', { maximumFractionDigits })`: 1,234.5.
    static func number(_ x: Double, maxDigits: Int) -> String {
        let f = formatters[min(max(maxDigits, 0), 3)]
        return f.string(from: NSNumber(value: x)) ?? String(x)
    }

    /// A count the way a JS number prints: 3, or 1.5.
    static func count(_ x: Double) -> String { number(x, maxDigits: 2) }

    /// `toFixed(digits)`.
    static func fixed(_ x: Double, _ digits: Int) -> String { String(format: "%.\(digits)f", x) }

    // TODO(logic): port GRAMS_PER_TOLA, toTola and formatWeight (units.ts)
    static let gramsPerTola = 11.664

    static func tola(_ grams: Double) -> Double { grams / gramsPerTola }

    /// "12.5 g · 1.072 tola" (units.ts formatWeight).
    static func weight(_ grams: Double) -> String {
        "\(number(grams, maxDigits: 2)) g · \(number(tola(grams), maxDigits: 3)) tola"
    }

    static func plural(_ n: Int, _ one: String, _ many: String) -> String { n == 1 ? one : many }
}
