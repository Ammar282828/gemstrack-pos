import Foundation

/// A word from a fixed list in the ERP (an order's status, a payment's method, a metal) that
/// must never fail a document: whatever the list does not know is kept as `.unknown(raw)`, so
/// a status some script wrote last year still decodes, still shows, and is not mistaken for a
/// known one. Matching is exact, as the TypeScript compares (`'In Progress'`, not `'in progress'`).
public protocol LenientRaw: RawRepresentable, Decodable, Hashable where RawValue == String {}

public extension LenientRaw {
    init(from decoder: Decoder) throws {
        let word = (try? decoder.singleValueContainer().decode(LenientString.self))?.value ?? ""
        guard let value = Self(rawValue: word) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "unreadable word"))
        }
        self = value
    }
}

extension KeyedDecodingContainer {
    /// A listed word, or nil when the field is missing or blank (the ERP reads '' as unset).
    func word<T: LenientRaw>(_ key: Key, of type: T.Type = T.self) -> T? {
        guard let s = string(key), !s.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        return T(rawValue: s)
    }

    func word<T: LenientRaw>(_ key: Key, default value: T) -> T { word(key) ?? value }

    /// `Record<string, string>`: a map of text to text; values that are not text or numbers are dropped.
    func stringMap(_ key: Key) -> [String: String] {
        guard let map = try? decodeIfPresent([String: Lossy<LenientString>].self, forKey: key) else { return [:] }
        return map.compactMapValues { $0.value?.value }
    }
}
