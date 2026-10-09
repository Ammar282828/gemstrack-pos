// Ported from src/lib/recently-removed.ts, Settings → Recently removed (tests: RecentlyRemovedTests,
// from recently-removed.test.ts).
//
// How much history each removed customer or karigar still carries. This is the number that makes
// "Empty" a considered act rather than a reflex: a name with 40 ledger entries behind it is not a
// stray duplicate somebody added twice.

import Foundation

public enum RecentlyRemoved {
    public struct History: Hashable {
        public var entries = 0
        public var orders = 0

        public init(entries: Int = 0, orders: Int = 0) {
            self.entries = entries
            self.orders = orders
        }
    }

    /// Ledger entries per person (`entityId`) and orders per customer (`customerId`).
    public static func removedHistory(hisaab: [HisaabEntry], orders: [Order]) -> [String: History] {
        var counts: [String: History] = [:]
        for e in hisaab where !e.entityId.isEmpty { counts[e.entityId, default: History()].entries += 1 }
        for o in orders {
            guard let id = o.customerId, !id.isEmpty else { continue }
            counts[id, default: History()].orders += 1
        }
        return counts
    }

    /// "3 ledger entries · 1 order"; "" when there is none.
    public static func carriesText(_ history: History?) -> String {
        var parts: [String] = []
        if let n = history?.entries, n > 0 { parts.append("\(n) ledger entr\(n == 1 ? "y" : "ies")") }
        if let n = history?.orders, n > 0 { parts.append("\(n) order\(n == 1 ? "" : "s")") }
        return parts.joined(separator: " · ")
    }

    /// What emptying the list takes with it: every removed person's entries, and the removed customers' orders.
    public static func removedTotals(customerIds: [String], karigarIds: [String], history: [String: History]) -> History {
        let entries = (customerIds + karigarIds).reduce(0) { $0 + (history[$1]?.entries ?? 0) }
        let orders = customerIds.reduce(0) { $0 + (history[$1]?.orders ?? 0) }
        return History(entries: entries, orders: orders)
    }

    /// Removed means `deletedAt` is set (store.ts splitRemoved: `Boolean(r.deletedAt)`).
    public static func isRemoved(_ deletedAt: String?) -> Bool { !(deletedAt ?? "").isEmpty }
}
