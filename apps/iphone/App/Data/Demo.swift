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

    static func docs(_ collection: String) -> [[String: Any]] { collections[collection] ?? [] }

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
