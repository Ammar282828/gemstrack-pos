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
