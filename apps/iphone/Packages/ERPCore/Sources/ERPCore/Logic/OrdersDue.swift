// Ported from src/lib/orders-due.ts (which the web extracted from this app's OrdersLogic on 2026-10-12, with
// vitest): the Orders hub's Due view, the open orders by how soon they were promised. Same buckets, same
// thresholds, same order. OrdersDueTests mirrors orders-due.test.ts.

import Foundation

/// The Due view's sections, in the order they are chased. "This week" is the bench week the ERP calls
/// urgent (URGENT_WINDOW_DAYS), so a card in it carries the same amber promise as anywhere else.
public enum OrdersDueBucket: String, CaseIterable {
    case late, today, week, later, undated

    public var title: String {
        switch self {
        case .late: return "Late"
        case .today: return "Today"
        case .week: return "This week"
        case .later: return "Later"
        case .undated: return "No date"
        }
    }

    public var hint: String {
        switch self {
        case .late: return "past the day promised"
        case .today: return "promised for today"
        case .week: return "in the next \(URGENT_WINDOW_DAYS) days: start them now"
        case .later: return "more than a week away"
        case .undated: return "no day promised: oldest first"
        }
    }
}

public enum OrdersDue {
    /// Still to be handed over: not invoiced, not cancelled or refunded (isOpenOrder).
    public static func isOpen(_ order: Order) -> Bool {
        (order.invoiceId ?? "").isEmpty && order.status != .cancelled && order.status != .refunded
    }

    /// An order with no day promised is undated here, whatever the age rule calls it (dueBucketOf).
    public static func bucket(_ t: OrderTiming) -> OrdersDueBucket {
        guard t.due != nil else { return .undated }
        switch t.state {
        case .late: return .late
        case .today: return .today
        case .upcoming: return -t.daysLate <= URGENT_WINDOW_DAYS ? .week : .later
        case .noPromise: return .undated
        }
    }

    /// When the order was taken, for ties; an order with no readable date sorts first (TS: 0).
    static func taken(_ order: Order) -> Date { ERPDate.parse(order.createdAt) ?? .distantPast }

    /// The open orders in their buckets (empty buckets left out). In each, the soonest promise first (so the
    /// latest of the late), and the undated oldest first, as they have waited longest; ties by when the order
    /// was taken, then by id (dueGroups).
    public static func groups(_ orders: [Order], now: Date) -> [(bucket: OrdersDueBucket, orders: [Order])] {
        var members: [OrdersDueBucket: [(order: Order, due: Date?)]] = [:]
        for o in orders where isOpen(o) {
            let t = orderTiming(o, now: now)
            members[bucket(t), default: []].append((o, t.due))
        }
        return OrdersDueBucket.allCases.compactMap { b in
            guard let rows = members[b], !rows.isEmpty else { return nil }
            let sorted = rows.sorted { a, c in
                if let da = a.due, let dc = c.due, da != dc { return da < dc }
                let ta = taken(a.order), tc = taken(c.order)
                if ta != tc { return ta < tc }
                return a.order.id < c.order.id
            }
            return (b, sorted.map(\.order))
        }
    }
}
