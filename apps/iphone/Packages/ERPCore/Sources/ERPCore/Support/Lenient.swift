import Foundation

/// Reading the ERP's Firestore documents as they really are: written over years by the web app,
/// scripts and imports, a number is sometimes a string ("25000"), a list is sometimes a map
/// keyed "0", "1", … (Firestore keeps arrays that way after some partial writes), and any field
/// may be missing. Every model decodes through these, never through the strict synthesized
/// Codable, so one odd document never empties a list.
public extension KeyedDecodingContainer {
    func string(_ key: Key) -> String? {
        if let s = try? decodeIfPresent(String.self, forKey: key) { return s }
        if let d = try? decodeIfPresent(Double.self, forKey: key) { return d == d.rounded() ? String(Int(d)) : String(d) }
        if let b = try? decodeIfPresent(Bool.self, forKey: key) { return b ? "true" : "false" }
        return nil
    }

    func string(_ key: Key, default value: String) -> String { string(key) ?? value }

    func double(_ key: Key) -> Double? {
        if let d = try? decodeIfPresent(Double.self, forKey: key) { return d.isFinite ? d : nil }
        if let s = try? decodeIfPresent(String.self, forKey: key) {
            let t = s.replacingOccurrences(of: ",", with: "").trimmingCharacters(in: .whitespaces)
            if let d = Double(t), d.isFinite { return d }
        }
        return nil
    }

    func double(_ key: Key, default value: Double) -> Double { double(key) ?? value }

    func int(_ key: Key) -> Int? { double(key).map { Int($0.rounded()) } }

    func bool(_ key: Key) -> Bool? {
        if let b = try? decodeIfPresent(Bool.self, forKey: key) { return b }
        if let s = try? decodeIfPresent(String.self, forKey: key) { return ["true", "yes", "1"].contains(s.lowercased()) }
        if let d = try? decodeIfPresent(Double.self, forKey: key) { return d != 0 }
        return nil
    }

    func bool(_ key: Key, default value: Bool) -> Bool { bool(key) ?? value }

    /// A list, from an array or from a map keyed by index ("0", "1", …); elements that do not
    /// decode are dropped, not fatal.
    func list<T: Decodable>(_ key: Key, of type: T.Type = T.self) -> [T] {
        if let items = try? decodeIfPresent([Lossy<T>].self, forKey: key) { return items.compactMap(\.value) }
        if let map = try? decodeIfPresent([String: Lossy<T>].self, forKey: key) {
            return map.sorted { (Int($0.key) ?? .max, $0.key) < (Int($1.key) ?? .max, $1.key) }.compactMap(\.value.value)
        }
        return []
    }

    func strings(_ key: Key) -> [String] { list(key, of: LenientString.self).map(\.value) }

    func object<T: Decodable>(_ key: Key, of type: T.Type = T.self) -> T? {
        (try? decodeIfPresent(Lossy<T>.self, forKey: key))?.value
    }
}

/// A value that decodes to nil instead of failing its container.
public struct Lossy<T: Decodable>: Decodable {
    public let value: T?
    public init(from decoder: Decoder) throws { value = try? T(from: decoder) }
}

/// A string, from a string or a number.
public struct LenientString: Decodable, Hashable {
    public let value: String
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) { value = s }
        else if let d = try? c.decode(Double.self) { value = d == d.rounded() ? String(Int(d)) : String(d) }
        else { throw DecodingError.typeMismatch(String.self, .init(codingPath: decoder.codingPath, debugDescription: "not a string")) }
    }
}

/// Coding keys from any string: models list their fields as `Key("balanceDue")`-style enums or use this.
public struct AnyKey: CodingKey, Hashable {
    public let stringValue: String
    public let intValue: Int?
    public init(_ s: String) { stringValue = s; intValue = nil }
    public init?(stringValue: String) { self.stringValue = stringValue; intValue = nil }
    public init?(intValue: Int) { stringValue = String(intValue); self.intValue = intValue }
}

/// Decode a model from a Firestore document already turned into JSON-safe values
/// (FirestoreJSON in the app: Timestamps become ISO strings).
public enum ERPDecode {
    public static func model<T: Decodable>(_ type: T.Type, from object: Any) -> T? {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    public static func models<T: Decodable>(_ type: T.Type, from json: Data) -> [T] {
        ((try? JSONDecoder().decode([Lossy<T>].self, from: json)) ?? []).compactMap(\.value)
    }
}
