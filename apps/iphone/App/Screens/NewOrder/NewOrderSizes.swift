import Foundation
import ERPCore

// A piece's size, by its category (store.ts SIZE_SCALES, components/shared/size-picker.tsx).
// A category with no scale has no size box at all, as on the web. A set with two parts keeps its
// size as one string, "Ring: 10 · Bangle: 2.4", which is what the rest of the ERP stores and reads.
//
// TODO(logic): port SIZE_SCALES, composeMultiSize and parseMultiSize (store.ts).

enum NewOrderSizes {
    struct Part: Identifiable {
        let key: String
        let label: String
        let options: [String]
        var id: String { key }
    }

    struct Scale {
        /// Said under the box: "Indian ring size (0–25, 0.5 steps)".
        let label: String
        let parts: [Part]
        /// A set with a ring and a second part keeps "Ring: 10 · Bangle: 2.4"; the others keep the size as typed.
        let multi: Bool
        /// A size saved before a set gained its second part is a bare "2.2", and belongs to this part.
        let legacyPartKey: String?
    }

    // 0, 0.5, 1 ... 25.
    private static let ring: [String] = (0...50).map { NewOrderFormat.trimmed(Double($0) / 2, digits: 1) }
    // 1.1 ... 3.0.
    private static let bangle: [String] = (11...30).map { String(format: "%.1f", Double($0) / 10) }
    // 4.5" to 9" in quarter inches, for the loose bracelet only (decisions.md "Sizes to the profile").
    private static let looseBracelet: [String] = (18...36).map { NewOrderFormat.trimmed(Double($0) / 4, digits: 2) + "\"" }
    private static let string: [String] = stride(from: 14, through: 30, by: 2).map { "\($0)\"" }

    private static func single(_ label: String, _ options: [String]) -> Scale {
        Scale(label: label, parts: [Part(key: "", label: label, options: options)], multi: false, legacyPartKey: nil)
    }

    /// The scale for a category, or nil when it has none.
    static func scale(for category: String) -> Scale? {
        switch category {
        case "cat001", "cat018":
            return single("Indian ring size (0–25, 0.5 steps)", ring)
        case "cat009":
            return single("Band size (Indian 0–25, 0.5 steps)", ring)
        case "cat010", "cat013", "cat016":
            return single("Ring size (Indian 0–25, 0.5 steps)", ring)
        case "cat005":
            return single("Bracelet size (1.1–3.0)", bangle)
        case "cat007":
            return single("Bangle size (1.1–3.0)", bangle)
        case "cat019":
            return single("Loose bracelet (inches)", looseBracelet)
        case "cat012":
            return single("String length (inches)", string)
        case "cat006", "cat014", "cat015":
            return Scale(
                label: "Ring + Bracelet size",
                parts: [Part(key: "Ring", label: "Ring size", options: ring), Part(key: "Bracelet", label: "Bracelet size", options: bangle)],
                multi: true, legacyPartKey: "Bracelet"
            )
        case "cat011":
            return Scale(
                label: "Ring + Bangle size",
                parts: [Part(key: "Ring", label: "Ring size", options: ring), Part(key: "Bangle", label: "Bangle size", options: bangle)],
                multi: true, legacyPartKey: nil
            )
        default:
            return nil
        }
    }

    /// "Ring: 10 · Bangle: 2.4" → ["Ring": "10", "Bangle": "2.4"]; a bare size belongs to the legacy part.
    static func parse(_ value: String, legacyKey: String?) -> [String: String] {
        var out: [String: String] = [:]
        for chunk in value.split(separator: "·", omittingEmptySubsequences: true) {
            let pieces = chunk.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
            guard pieces.count == 2 else { continue }
            let key = pieces[0].trimmingCharacters(in: .whitespaces)
            let val = pieces[1].trimmingCharacters(in: .whitespaces)
            if !key.isEmpty && !val.isEmpty { out[key] = val }
        }
        let bare = value.trimmingCharacters(in: .whitespaces)
        if out.isEmpty, let legacyKey, !bare.isEmpty { out[legacyKey] = bare }
        return out
    }

    /// The parts that have a size, in the scale's order.
    static func compose(_ values: [String: String], order: [String]) -> String {
        order
            .compactMap { key -> String? in
                let v = (values[key] ?? "").trimmingCharacters(in: .whitespaces)
                return v.isEmpty ? nil : "\(key): \(v)"
            }
            .joined(separator: " · ")
    }
}

// MARK: Sizes to the profile

// A size on an order is offered to the customer's profile (decisions.md "Sizes to the profile", the owner,
// 2026-10-05: "show a popup to save the size in the customer bio for the future if the customer size is not
// already in their bio. If it is in the bio then no popup"). Ported from src/lib/customer-sizes.ts.
//
// On the web the question comes a moment after a size is picked. On the phone it is asked once, after the
// order is saved: by then a new customer exists, and the pieces are final. Only when the house wants it
// (`Session.Shop.sizeToProfile`, STORE_SIZE_TO_PROFILE: Taheri's, not Mina's).

/// The three sizes a customer's profile holds (Customer.ringSize, bangleSize, braceletSize).
enum NewOrderProfileField: String, CaseIterable, Hashable {
    case ringSize, bangleSize, braceletSize

    /// PROFILE_SIZE_LABEL.
    var label: String {
        switch self {
        case .ringSize: return "Ring size"
        case .bangleSize: return "Bangle size"
        case .braceletSize: return "Bracelet size"
        }
    }

    /// What the profile holds now.
    func current(in c: Customer?) -> String? {
        let text: String?
        switch self {
        case .ringSize: text = c?.ringSize
        case .bangleSize: text = c?.bangleSize
        case .braceletSize: text = c?.braceletSize
        }
        let t = NewOrderFormat.trim(text ?? "")
        return t.isEmpty ? nil : t
    }
}

/// One size the profile could keep.
struct NewOrderSizeSuggestion: Identifiable, Equatable {
    let field: NewOrderProfileField
    /// The size on the order.
    let value: String
    /// What the profile holds now, if anything.
    let current: String?
    /// For not asking twice: customer, field and value.
    let key: String
    var id: String { field.rawValue }
}

extension NewOrderSizes {
    /// Single-size categories, by what they measure (customer-sizes.ts SINGLE).
    private static let singleField: [String: NewOrderProfileField] = [
        "cat001": .ringSize, "cat018": .ringSize, "cat009": .ringSize, "cat010": .ringSize,
        "cat013": .ringSize, "cat016": .ringSize,
        "cat007": .bangleSize,
        "cat005": .braceletSize, "cat019": .braceletSize,
    ]

    /// The part names a multi-part size is written with ("Ring: 10 · Bangle: 2.4").
    private static let partField: [String: NewOrderProfileField] = [
        "Ring": .ringSize, "Bangle": .bangleSize, "Bracelet": .braceletSize,
    ]

    /// The profile sizes a piece's size gives, in the order its parts are written: ring 12, or ring 10 and
    /// bangle 2.4, or none (a chain's length is none of them).
    static func profileSizes(category: String, size: String) -> [(field: NewOrderProfileField, value: String)] {
        let value = NewOrderFormat.trim(size)
        if category.isEmpty || value.isEmpty { return [] }
        guard let s = scale(for: category) else { return [] }
        if s.multi {
            let parsed = parse(value, legacyKey: s.legacyPartKey)
            return s.parts.compactMap { part -> (field: NewOrderProfileField, value: String)? in
                guard let field = partField[part.key], let v = parsed[part.key] else { return nil }
                let t = NewOrderFormat.trim(v)
                return t.isEmpty ? nil : (field: field, value: t)
            }
        }
        if let field = singleField[category] { return [(field: field, value: value)] }
        return []
    }

    /// Sizes compare as the counter writes them: "12", " 12 ", "12.0" are one size, "US 6" and "us 6" one, and a
    /// bracelet's inches with or without the mark (7, 7", 7 in, 7 inches) one (`sameSize`).
    static func same(_ a: String?, _ b: String?) -> Bool { normal(a) == normal(b) }

    private static func normal(_ s: String?) -> String {
        let t = NewOrderFormat.trim(s ?? "").lowercased()
            .split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        // A number, then nothing, or a mark for inches.
        for mark in ["inches", "inch", "in", "''", "\""] where t.hasSuffix(mark) {
            let head = NewOrderFormat.trim(String(t.dropLast(mark.count)))
            if !head.isEmpty, head.allSatisfy({ $0.isNumber || $0 == "." }), let n = Double(head) { return NewOrderFormat.trimmed(n, digits: 6) }
        }
        if !t.isEmpty, t.allSatisfy({ $0.isNumber || $0 == "." }), let n = Double(t) { return NewOrderFormat.trimmed(n, digits: 6) }
        return t
    }

    /// What the order's pieces give that the profile doesn't hold yet: one per field, the last piece's size where
    /// two differ (`sizeSuggestions`). `who` keys a decision to its customer.
    static func suggestions(
        who: String,
        profile: Customer?,
        items: [(category: String, size: String)],
        decided: Set<String> = []
    ) -> [NewOrderSizeSuggestion] {
        var order: [NewOrderProfileField] = []
        var latest: [NewOrderProfileField: String] = [:]
        for item in items {
            for (field, value) in profileSizes(category: item.category, size: item.size) {
                if latest[field] == nil { order.append(field) }
                latest[field] = value
            }
        }
        var out: [NewOrderSizeSuggestion] = []
        for field in order {
            guard let value = latest[field] else { continue }
            let current = field.current(in: profile)
            if let current, same(current, value) { continue }
            let key = "\(who)|\(field.rawValue)|\(NewOrderFormat.trim(value).lowercased())"
            if decided.contains(key) { continue }
            out.append(NewOrderSizeSuggestion(field: field, value: value, current: current, key: key))
        }
        return out
    }

    /// The offer after a save: the sizes on the order's pieces that the customer's profile doesn't hold. Nothing
    /// for a walk-in (no customer id), or where the house doesn't keep sizes on the profile.
    static func offer(_ d: NewOrderDraft, customerId: String?, profile: Customer?, houseWants: Bool) -> [NewOrderSizeSuggestion] {
        guard houseWants, let customerId, !customerId.isEmpty else { return [] }
        return suggestions(who: customerId, profile: profile, items: d.pieces.map { (category: $0.category, size: $0.size) })
    }

    /// The fields of `setCustomerSizes` for the ones chosen.
    static func request(customerId: String, chosen: [NewOrderSizeSuggestion]) -> [String: Any] {
        var sizes: [String: Any] = [:]
        for s in chosen { sizes[s.field.rawValue] = s.value }
        return ["customerId": customerId, "sizes": sizes]
    }
}
