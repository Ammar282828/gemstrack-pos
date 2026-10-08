// Ported from src/lib/materials.ts. (It has no TS test; MaterialsTests pins the rules the
// comments below state.) `MetalType` and `KaratValue` themselves are in Models/Enums.swift.
//
// Metals and karats: the single source of truth.
//
// These lists and labels were previously re-declared in the order form, the
// product form and the order detail page, and the display string was
// hand-built in nine different places. They had already drifted: silver read
// as "925 Sterling Silver" on invoices, slips, the cart and the order form,
// but as plain "Silver" in the product form.

import Foundation

public let METAL_TYPES: [MetalType] = [.gold, .palladium, .platinum, .silver]
public let KARAT_VALUES: [KaratValue] = [.k12, .k18, .k21, .k22, .k24]

/// Which karats each metal is actually sold in here.
///
/// A flat list offered 24k palladium and 22k platinum, neither of which this shop has
/// ever made, while palladium's real 12k and 18k were missing entirely. Platinum and
/// silver carry no karat at all: silver is 925 by assay, and saying "21k silver" is
/// how a wrong rate gets picked.
public let KARATS_BY_METAL: [MetalType: [KaratValue]] = [
    .gold: [.k18, .k21, .k22, .k24],
    .palladium: [.k12, .k18],
    .platinum: [],
    .silver: [],
]

/// The karats to offer for a metal; empty means the field should not be shown.
/// (Texts the list does not know, such as an `.unknown` metal, offer none.)
public func karatsFor(_ metalType: MetalType) -> [KaratValue] { KARATS_BY_METAL[metalType] ?? [] }
public func karatsFor(_ metalType: String?) -> [KaratValue] { karatsFor(MetalType(rawValue: metalType ?? "")) }

/// Does this metal carry a karat at all?
public func metalHasKarat(_ metalType: MetalType) -> Bool { !karatsFor(metalType).isEmpty }
public func metalHasKarat(_ metalType: String?) -> Bool { !karatsFor(metalType).isEmpty }

/// How a metal is named to a human. Silver is always the full assay name.
public func metalLabel(_ metalType: String?) -> String {
    guard let metal = metalType, !metal.isEmpty else { return "" }
    if metal == "silver" { return "925 Sterling Silver" }
    return metal.prefix(1).uppercased() + metal.dropFirst()
}

public func metalLabel(_ metalType: MetalType) -> String { metalLabel(metalType.rawValue) }

/// Karat means something for gold and palladium (see displayKarat in categories.ts).
public func karatLabel(_ karat: String?) -> String {
    guard let karat, !karat.isEmpty else { return "" }
    return karat.uppercased()
}

public func karatLabel(_ karat: KaratValue?) -> String { karatLabel(karat?.rawValue) }

/// Full description of an item's material, e.g.
///   describeMetal("gold", "21k")       → "Gold (21K)"
///   describeMetal("palladium", "18k")  → "Palladium (18K)"
///   describeMetal("silver", "21k")     → "925 Sterling Silver"   (karat ignored)
public func describeMetal(_ metalType: String?, _ karat: String? = nil) -> String {
    let base = metalLabel(metalType)
    // Palladium is sold at 12k and 18k here, so it reads its karat the same as gold does.
    guard let karat, !karat.isEmpty, metalHasKarat(metalType) else { return base }
    return "\(base) (\(karatLabel(karat)))"
}

public func describeMetal(_ metalType: MetalType, _ karat: KaratValue? = nil) -> String {
    describeMetal(metalType.rawValue, karat?.rawValue)
}

/// What the three piece models (a sold line, an order's piece, a stocked product) share, which
/// is all `describePlating` and `describeSettings` read (the TS takes the fields it needs).
public protocol PieceMaterial {
    var metalType: MetalType { get }
    var platingType: String? { get }
    var platingNote: String? { get }
    var nickelFree: Bool { get }
    var diamondDetails: String? { get }
    var stoneDetails: String? { get }
    var stoneWeightG: Double { get }
}

extension InvoiceItem: PieceMaterial {}
extension OrderItem: PieceMaterial {}
extension Product: PieceMaterial {}

/// The finish on a 925 silver piece, e.g. "White Rhodium · Nickel free".
/// Nil for non-silver or when nothing was specified.
public func describePlating(_ item: some PieceMaterial) -> String? {
    if item.metalType != .silver { return nil }
    var parts: [String] = []
    if item.platingType == "Other", let note = item.platingNote.map(JS.trim), !note.isEmpty { parts.append(note) }
    else if let plating = item.platingType, !plating.isEmpty { parts.append(plating) }
    if item.nickelFree { parts.append("Nickel free") }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
}

/// What is actually set into a piece, for the customer's copy.
///
/// The invoice already prints what the stones *cost* ("+ Diamonds: PKR
/// 45,000") but never what they are. A customer paying for a 1.12ct VVS2
/// stone should see that on the bill, not just its price; it is the part they
/// would take to a valuer.
///
/// Only what was actually recorded is printed. Nothing is inferred from a
/// charge being present, because "there is a diamond charge" is not a
/// description of a diamond.
public func describeSettings(_ item: some PieceMaterial) -> [String] {
    var lines: [String] = []
    // A note typed over several lines reads as one, joined with a dot.
    let oneLine = { (s: String) in
        JS.trim(s.replacingOccurrences(of: #"\s*\n+\s*"#, with: " · ", options: .regularExpression))
    }

    if let diamonds = item.diamondDetails.map(JS.trim), !diamonds.isEmpty { lines.append("Diamonds: \(oneLine(diamonds))") }

    if let stones = item.stoneDetails.map(JS.trim), !stones.isEmpty { lines.append("Stones: \(oneLine(stones))") }

    let sw = item.stoneWeightG.isNaN ? 0 : item.stoneWeightG
    if sw > 0 { lines.append("Stone weight: \(JS.toFixed(sw, 2))g") }

    if let plating = describePlating(item) { lines.append("Finish: \(plating)") }

    return lines
}

/// The delivery block for a printed invoice, as lines.
///
/// Empty when the sale is not being delivered, so the caller can leave the
/// whole section off rather than printing an empty heading.
///
/// The expected day is printed "5 Oct 2026" (the TS prints it in the viewer's own locale), as
/// Karachi's day.
public func describeDelivery(_ d: DeliveryInfo?) -> [String] {
    guard let d, d.required, !JS.trim(d.address).isEmpty else { return [] }
    var lines: [String] = []
    let name = JS.trim(d.contactName ?? "")
    let phone = JS.trim(d.contactPhone ?? "")
    // The recipient only earns a line when it is not the person on the bill.
    if !name.isEmpty {
        lines.append(phone.isEmpty ? name : "\(name) · \(phone)")
    } else if !phone.isEmpty {
        lines.append(phone)
    }
    lines.append([JS.trim(d.address), JS.trim(d.city ?? "")].filter { !$0.isEmpty }.joined(separator: ", "))
    if let expected = d.expectedDate, !expected.isEmpty, let t = JS.newDate(expected) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = ERPDate.karachi
        let parts = calendar.dateComponents([.day, .month, .year], from: t)
        lines.append("Expected \(parts.day ?? 1) \(JS.shortMonths[(parts.month ?? 1) - 1]) \(parts.year ?? 0)")
    }
    let notes = JS.trim(d.notes ?? "")
    if !notes.isEmpty { lines.append(notes) }
    return lines
}
