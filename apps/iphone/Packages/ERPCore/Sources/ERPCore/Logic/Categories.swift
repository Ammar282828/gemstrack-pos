// Ported from src/lib/categories.ts (staticCategories, categoryTitle, categorySingular) and the lists in
// src/lib/store.ts that the order and sale forms offer: CUSTOMER_SOURCES, CUSTOMER_SOURCE_LABELS, PLATING_TYPES.

import Foundation

public struct Category: Identifiable, Hashable, Sendable {
    public let id: String
    /// The list name, plural: "Rings". What the pickers and filters show.
    public let title: String
    /// One of them: "Ring". What a printed bill leads with.
    public let singular: String
}

public let staticCategories: [Category] = [
    Category(id: "cat001", title: "Rings", singular: "Ring"),
    Category(id: "cat002", title: "Tops", singular: "Top"),
    Category(id: "cat003", title: "Balis", singular: "Bali"),
    Category(id: "cat004", title: "Lockets", singular: "Locket"),
    Category(id: "cat005", title: "Bracelets", singular: "Bracelet"),
    Category(id: "cat006", title: "Bracelet and Ring Set", singular: "Bracelet and Ring Set"),
    Category(id: "cat007", title: "Bangles", singular: "Bangle"),
    Category(id: "cat008", title: "Chains", singular: "Chain"),
    Category(id: "cat009", title: "Bands", singular: "Band"),
    Category(id: "cat010", title: "Locket Sets without Bangle", singular: "Locket Set without Bangle"),
    Category(id: "cat011", title: "Locket Set with Bangle", singular: "Locket Set with Bangle"),
    Category(id: "cat012", title: "String Sets", singular: "String Set"),
    Category(id: "cat013", title: "Stone Necklace Sets without Bracelets", singular: "Stone Necklace Set without Bracelets"),
    Category(id: "cat014", title: "Stone Necklace Sets with Bracelets", singular: "Stone Necklace Set with Bracelets"),
    Category(id: "cat015", title: "Gold Necklace Sets with Bracelets", singular: "Gold Necklace Set with Bracelets"),
    Category(id: "cat016", title: "Gold Necklace Sets without Bracelets", singular: "Gold Necklace Set without Bracelets"),
    Category(id: "cat017", title: "Gold Coins", singular: "Gold Coin"),
    Category(id: "cat018", title: "Men's Rings", singular: "Men's Ring"),
    Category(id: "cat019", title: "Loose Bracelet", singular: "Loose Bracelet"),
    Category(id: "cat020", title: "Men's Buttons", singular: "Men's Button"),
]

/// Resolve a category id to its display name; nil when unknown.
public func categoryTitle(_ id: String?) -> String? {
    guard let id, !id.isEmpty else { return nil }
    return staticCategories.first { $0.id == id }?.title
}

/// One of them: "Ring" for cat001. Nil when the id is unknown.
public func categorySingular(_ id: String?) -> String? {
    guard let id, !id.isEmpty else { return nil }
    return staticCategories.first { $0.id == id }?.singular
}

/// categories.ts NAME_RULES: a piece's category from its name, the more particular words first
/// ("bangle & ring" is a set, not a ring). Same order, same patterns, case-insensitive.
private let nameRules: [(NSRegularExpression, String)] = {
    let rules: [(String, String)] = [
        (#"\b(men'?s|gents?)\b.*\bring|\bring\b.*\b(men'?s|gents?)\b"#, "cat018"),
        (#"\bbutton"#, "cat020"),
        (#"(bracelet|bangle|kara).*\bring|\bring\b.*(bracelet|bangle|kara)"#, "cat006"),
        (#"\b(locket|takhti|thakti)s? set\b.*bangle"#, "cat011"),
        (#"\b(locket|takhti|thakti)s? set"#, "cat010"),
        (#"\bstring set"#, "cat012"),
        (#"\b(necklace|full set|set)\b.*(bracelet)"#, "cat014"),
        (#"\b(coin|biscuit|bar)\b|\bary\b|\b\d+(\.\d+)?\s?g\b.*24k"#, "cat017"),
        (#"\b(necklace|neckless|full set|set|haar|choker)\b"#, "cat013"),
        (#"\bloose bracelet"#, "cat019"),
        (#"\b(bangle|kara|kangan|churi)"#, "cat007"),
        (#"\bbracelet"#, "cat005"),
        (#"\bchain"#, "cat008"),
        (#"\b(locket|takhti|thakti|taweez|tawiz|pendant)"#, "cat004"),
        (#"\b(bali|balis|hoop)"#, "cat003"),
        (#"\b(tops?|earrings?|studs?|jhum(k|ki|ka|kay))\b"#, "cat002"),
        (#"\bbands?\b"#, "cat009"),
        (#"\brings?\b"#, "cat001"),
    ]
    return rules.compactMap { (pattern: String, id: String) -> (NSRegularExpression, String)? in
        guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
        return (re, id)
    }
}()

/// categories.ts guessCategory: a piece's category from its name, for a line that carries none.
public func guessCategory(_ name: String?) -> String? {
    let n = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if n.isEmpty { return nil }
    let range = NSRange(n.startIndex..., in: n)
    for (re, id) in nameRules where re.firstMatch(in: n, options: [], range: range) != nil { return id }
    return nil
}

/// categories.ts lineCategory: a sold line's category for the reports: its own, else the custom
/// order's (`itemCategory`), else read from its name. Empty strings count as none.
public func lineCategory(categoryId: String?, itemCategory: String?, name: String?) -> String? {
    if let c = categoryId, !c.isEmpty { return c }
    if let c = itemCategory, !c.isEmpty { return c }
    return guessCategory(name)
}

/// category-breakdown.tsx: a category's share of revenue as written beside its bar: "32%", and one
/// decimal under 10%: "0.7%". `share` is a fraction (0.32).
public func categoryShareText(_ share: Double) -> String {
    share >= 0.1 ? "\(Int((share * 100).rounded()))%" : String(format: "%.1f%%", share * 100)
}

/// store.ts CUSTOMER_SOURCES, in the ERP's order.
public let customerSources: [String] = ["taheri_spillover", "referral", "walkin", "social_media", "website", "other"]

/// store.ts CUSTOMER_SOURCE_LABELS; nil for a key that is not one of the six.
public func customerSourceLabel(_ key: String) -> String? {
    switch key {
    case "taheri_spillover": return "Taheri Spillover"
    case "referral": return "Referral"
    case "walkin": return "Walk-in"
    case "social_media": return "Social media"
    case "website": return "Website"
    case "other": return "Other"
    default: return nil
    }
}

/// store.ts PLATING_TYPES: the finishes offered on 925 silver.
public let platingTypes: [String] = ["White Rhodium", "21K Gold Plating", "18K Gold Plating", "Chandi White Plating", "Other"]
