import Foundation

/// A Firestore document as plain JSON values, whichever way it reached the phone, so the models
/// decode it one way (Lenient.swift):
///
/// - from the Firestore SDK (owners): Timestamps, references and bytes are SDK objects, turned
///   into text by the app's hook (Data/FirestoreSource.swift), then into JSON here;
/// - from the ERP's server (/api/staff/collections, for staff): the Admin SDK's Timestamps arrive
///   as `{"_seconds": …, "_nanoseconds": …}`, which the models would otherwise drop as unreadable.
///
/// Timestamps become ISO text, as the ERP writes its own dates (store.ts keeps dates as strings).
public enum DocJSON {
    /// JSON-safe values all the way down. `custom` turns a value JSON cannot hold into one it can
    /// (nil: dropped from its map or list).
    public static func plain(_ value: Any, custom: (Any) -> Any? = { _ in nil }) -> Any? {
        switch value {
        case is NSNull: return NSNull()
        case let s as String: return s
        case let n as NSNumber:
            // A boolean NSNumber stays a boolean; a number JSON cannot hold (NaN, ∞) is dropped.
            if isBool(n) { return n }
            return n.doubleValue.isFinite ? n : nil
        case let d as Double: return d.isFinite ? d : nil
        case let i as Int: return i
        case let b as Bool: return b
        case let date as Date: return ERPDate.iso(date)
        case let data as Data: return data.base64EncodedString()
        case let list as [Any]: return list.compactMap { plain($0, custom: custom) }
        case let map as [String: Any]:
            if let ts = timestamp(map) { return ts }
            var out: [String: Any] = [:]
            for (k, v) in map { if let p = plain(v, custom: custom) { out[k] = p } }
            return out
        default:
            return custom(value).flatMap { plain($0, custom: custom) }
        }
    }

    private static func isBool(_ n: NSNumber) -> Bool {
        #if canImport(Darwin)
        return CFGetTypeID(n) == CFBooleanGetTypeID()
        #else
        return String(cString: n.objCType) == "c"
        #endif
    }

    /// The Admin SDK's Timestamp as JSON (`_seconds`/`_nanoseconds`, or `seconds`/`nanoseconds`), as ISO.
    static func timestamp(_ map: [String: Any]) -> String? {
        guard map.count == 2 else { return nil }
        let s = (map["_seconds"] ?? map["seconds"]) as? NSNumber
        let n = (map["_nanoseconds"] ?? map["nanoseconds"]) as? NSNumber
        guard let s, let n else { return nil }
        return ERPDate.iso(Date(timeIntervalSince1970: s.doubleValue + n.doubleValue / 1e9))
    }

    /// A document as a model: its id is the document's (as store.ts does, `{ ...doc.data(), id: doc.id }`).
    public static func decode<T: Decodable>(_ type: T.Type, id: String, data: [String: Any], custom: (Any) -> Any? = { _ in nil }) -> T? {
        var map = (plain(data, custom: custom) as? [String: Any]) ?? [:]
        map["id"] = id
        return ERPDecode.model(T.self, from: map)
    }

    /// A list of documents from the ERP's server: each carries its own `id`.
    public static func decodeList<T: Decodable>(_ type: T.Type, from docs: [Any]) -> [T] {
        docs.compactMap { doc in
            guard let map = plain(doc) as? [String: Any] else { return nil }
            return ERPDecode.model(T.self, from: map)
        }
    }
}
