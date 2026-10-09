import Foundation
import ERPCore

/// The demo build's documents (`-ERPDemo YES`, the simulator check): Resources/demo.json, all of
/// it made up (CONVENTIONS.md rule 3), read through the same decoding as the real books.
///
/// Dates in the file are relative, so "today" always has something in it:
/// "@d-2 14:30" is two days ago at 14:30 in Karachi; "@day+5" is the Karachi day five days on.
enum Demo {
    private static let collections: [String: [[String: Any]]] = {
        guard let url = Bundle.main.url(forResource: "demo", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return json.compactMapValues { ($0 as? [Any])?.compactMap { resolve($0) as? [String: Any] } }
    }()

    static func docs(_ collection: String) -> [[String: Any]] { scaled[collection] ?? collections[collection] ?? [] }

    /// `-ERPDemoScale N`: every list N times over, each copy with ids of its own, so the screens can be
    /// timed at many times the real books (the UI tests: 1,000 makes some 6,000 invoices and orders and
    /// 8,000 customers). The settings stay one document.
    private static let scale = max(1, UserDefaults.standard.integer(forKey: "ERPDemoScale"))

    private static let scaled: [String: [[String: Any]]] = {
        guard scale > 1 else { return [:] }
        var out: [String: [[String: Any]]] = [:]
        for (name, docs) in collections where name != Collections.settings {
            var list: [[String: Any]] = []
            list.reserveCapacity(docs.count * scale)
            for k in 0..<scale {
                for d in docs {
                    guard k > 0 else { list.append(d); continue }
                    var c = d
                    for key in ["id", "sku"] { if let v = d[key] as? String { c[key] = "\(v)-\(k)" } }
                    list.append(c)
                }
            }
            out[name] = list
        }
        return out
    }()

    private static func resolve(_ v: Any) -> Any {
        switch v {
        case let s as String: return when(s) ?? s
        case let list as [Any]: return list.map(resolve)
        case let map as [String: Any]: return map.mapValues(resolve)
        default: return v
        }
    }

    private static func when(_ s: String) -> String? {
        guard s.hasPrefix("@") else { return nil }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = ERPDate.karachi
        let today = cal.startOfDay(for: Date())
        if s.hasPrefix("@day"), let n = Int(s.dropFirst(4)) {
            return ERPDate.karachiDay(cal.date(byAdding: .day, value: n, to: today)!)
        }
        let parts = s.dropFirst(2).split(separator: " ")
        guard s.hasPrefix("@d"), let n = Int(parts.first ?? ""), let clock = parts.last?.split(separator: ":"),
              clock.count == 2, let h = Int(clock[0]), let m = Int(clock[1]) else { return nil }
        let day = cal.date(byAdding: .day, value: n, to: today)!
        return ERPDate.iso(day.addingTimeInterval(TimeInterval(h * 3600 + m * 60)))
    }
}
