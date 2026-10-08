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
