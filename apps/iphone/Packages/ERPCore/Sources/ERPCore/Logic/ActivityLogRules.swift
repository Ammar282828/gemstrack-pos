// Ported from src/app/activity-log/page.tsx and `ActivityLog` / `LOG_EVENT_TYPES` in src/lib/store.ts
// (tests: ActivityLogRulesTests): Firestore `activity_log`, everything done in the ERP, newest first,
// narrowed by the kind of event and a range of days. Days are Karachi's.

import Foundation

/// One line of the log: Firestore `activity_log/<id>`.
public struct ActivityLogEntry: Decodable, Identifiable, Hashable {
    public let id: String
    /// ISO instant.
    public let timestamp: String
    /// "invoice.create", "order.update", "rates.update"… (`LogEventType`): a kind, a dot, what was done.
    public let eventType: String
    /// "Created new product: RIN-000001".
    public let description: String
    /// "Product: Gold Ring | By: Murtaza".
    public let details: String
    /// The id of the product, customer, order…
    public let entityId: String

    private enum K: String, CodingKey {
        case id, timestamp, eventType, description, details, entityId
    }

    public init(id: String, timestamp: String, eventType: String, description: String, details: String, entityId: String) {
        self.id = id
        self.timestamp = timestamp
        self.eventType = eventType
        self.description = description
        self.details = details
        self.entityId = entityId
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? ""
        timestamp = c.string(.timestamp, default: "")
        eventType = c.string(.eventType, default: "")
        description = c.string(.description, default: "")
        details = c.string(.details, default: "")
        entityId = c.string(.entityId, default: "")
    }
}

public enum ActivityLogRules {
    /// The Event Type filter's choices (`LOG_EVENT_TYPES`). An entry is in one when its type starts with the word.
    public static let eventTypes = ["product", "customer", "karigar", "invoice", "order", "expense", "repair", "rates"]

    /// "Invoice", as the filter's menu says it.
    public static func title(_ type: String) -> String {
        guard let first = type.first else { return type }
        return first.uppercased() + type.dropFirst()
    }

    /// The three events the log can undo (`REVERTABLE_EVENTS`): undoing deletes the record, so it asks for the delete code.
    public static let revertable = ["invoice.create", "order.create", "expense.create"]

    public static func isRevertable(_ eventType: String) -> Bool { revertable.contains(eventType) }

    /// What undoing it does (`revertConsequences`).
    public static func consequence(_ eventType: String) -> String? {
        switch eventType {
        case "invoice.create": return "All sold products will be restored to active inventory, and all ledger entries for this invoice will be permanently deleted."
        case "order.create": return "The order will be permanently deleted."
        case "expense.create": return "The expense record will be permanently deleted."
        default: return nil
        }
    }

    /// How a line is coloured (`getEventTypeColor`).
    public enum Tone: Equatable {
        case created, updated, deleted, other
    }

    public static func tone(_ eventType: String) -> Tone {
        if eventType.contains("create") || eventType.contains("payment") { return .created }
        if eventType.contains("update") { return .updated }
        if eventType.contains("delete") { return .deleted }
        return .other
    }

    /// The log as the page lists it: the kind chosen ("All" or one of `eventTypes`, matched on the start of the
    /// event's type) and the days chosen, newest first.
    ///
    /// The range is whole days, both ends included. The web builds it as start-of-day to start-of-day
    /// (`isWithinInterval(…, { start: startOfDay(from), end: startOfDay(to) })`), which drops everything logged
    /// on the last day, and with no end date everything logged today; here the last day counts in full.
    /// `fromDay`/`toDay` are "yyyy-MM-dd"; no start means no range, and no end runs to `today`.
    public static func filter(_ logs: [ActivityLogEntry], type: String, fromDay: String?, toDay: String?, today: String) -> [ActivityLogEntry] {
        let last = toDay ?? today
        // Each line's time is read once: a log runs to thousands of lines, and the sort asks for it at every step.
        var kept: [(entry: ActivityLogEntry, at: Double)] = []
        for log in logs {
            if type != "All" && !log.eventType.hasPrefix(type) { continue }
            let at = JS.parseISO(log.timestamp)
            if let fromDay {
                guard let at else { continue }
                let day = ERPDate.karachiDay(at)
                if day < fromDay || day > last { continue }
            }
            kept.append((log, at?.timeIntervalSince1970 ?? 0))
        }
        return kept.jsSorted { $1.at - $0.at }.map { $0.entry }
    }
}
