#if os(macOS)
import SwiftUI
import ERPCore

// The saved lists under the sidebar's places (docs/features/mac-design.md, "The sidebar"): Orders ▸ Late, Invoices ▸
// Unpaid. A list is the place's path with `?list=<id>`; the place reads `MacLists.list(in:)` and filters with the rule
// here, and the sidebar counts with the same rule, so a count and its list never disagree. The rules are the ERP's own
// (ERPCore's stages, timing and owing); nothing is decided here that the phone or the web decide otherwise.

/// One saved list of a place.
struct MacSavedList: Identifiable, Hashable {
    let id: String
    let title: String
    let symbol: String
}

enum MacLists {
    // MARK: The lists per place

    static let orders: [MacSavedList] = [
        MacSavedList(id: "late", title: "Late", symbol: "exclamationmark.circle"),
        MacSavedList(id: "week", title: "Due This Week", symbol: "calendar"),
        MacSavedList(id: "new", title: "Not Started", symbol: "circle.dashed"),
        MacSavedList(id: "karigar", title: "With Karigars", symbol: "hammer"),
        MacSavedList(id: "ready", title: "Ready to Hand Over", symbol: "checkmark.circle"),
        MacSavedList(id: "payment", title: "Awaiting Payment", symbol: "banknote"),
    ]
    static let invoices: [MacSavedList] = [
        MacSavedList(id: "unpaid", title: "Unpaid", symbol: "exclamationmark.circle"),
        MacSavedList(id: "today", title: "Today", symbol: "sun.max"),
        MacSavedList(id: "month", title: "This Month", symbol: "calendar"),
    ]
    static let repairs: [MacSavedList] = [
        MacSavedList(id: "shop", title: "In the Shop", symbol: "wrench.and.screwdriver"),
        MacSavedList(id: "ready", title: "Ready", symbol: "checkmark.circle"),
        MacSavedList(id: "collected", title: "Collected", symbol: "bag"),
    ]
    static let customers: [MacSavedList] = [
        MacSavedList(id: "owe", title: "Owe Us", symbol: "exclamationmark.circle"),
        MacSavedList(id: "recent", title: "Recent", symbol: "clock"),
    ]

    /// The saved lists of a place, by its path ("/orders"); none for a place without any.
    static func lists(for href: String) -> [MacSavedList] {
        switch ScreenRoute.bare(href) {
        case "/orders": return orders
        case "/invoices": return invoices
        case "/repairs": return repairs
        case "/customers": return customers
        default: return []
        }
    }

    /// The sidebar's path for a place's saved list: "/orders?list=late".
    static func path(_ href: String, _ list: MacSavedList) -> String { ScreenRoute.bare(href) + "?list=" + list.id }

    /// The saved list a path names, if any.
    static func list(in path: String) -> String? {
        URLComponents(string: path)?.queryItems?.first { $0.name == "list" }?.value
    }

    // MARK: The rules

    /// The orders a list holds. `invoices` decides Awaiting payment (an order invoiced and still owed on).
    @MainActor
    static func orders(_ all: [Order], list: String?, invoices: [Invoice], now: Date = Date()) -> [Order] {
        guard let list else { return all }
        switch list {
        case "late": return lateOrders(all, now: now).map(\.order)
        case "week": return dueSoon(all, now: now, days: 7).map(\.order)
        case "new", "karigar", "ready", "payment":
            let owedOn = OrdersLogic.owedOnInvoices(invoices)
            let want: OrderStage = list == "new" ? .new : list == "karigar" ? .karigar : list == "ready" ? .ready : .payment
            return all.filter { stageOf($0, owedOnInvoice: OrdersLogic.owed($0, owedOn)) == want }
        default: return all
        }
    }

    static func invoices(_ all: [Invoice], list: String?, now: Date = Date()) -> [Invoice] {
        guard let list else { return all }
        let cal = ERPDate.karachiCalendar
        switch list {
        case "unpaid": return all.filter { isOwing($0) }
        case "today": return all.filter { ERPDate.parse($0.createdAt).map { cal.isDate($0, inSameDayAs: now) } ?? false }
        case "month": return all.filter { ERPDate.parse($0.createdAt).map { cal.isDate($0, equalTo: now, toGranularity: .month) } ?? false }
        default: return all
        }
    }

    static func repairs(_ all: [Repair], list: String?) -> [Repair] {
        guard let list else { return all }
        switch list {
        case "shop": return all.filter { $0.status == .received }
        case "ready": return all.filter { $0.status == .ready }
        case "collected": return all.filter { $0.status == .collected }
        default: return all
        }
    }

    /// Customers a list holds: Owe Us is anyone with an invoice still owed on; Recent bought in the last 90 days.
    static func customers(_ all: [Customer], list: String?, invoices: [Invoice], now: Date = Date()) -> [Customer] {
        guard let list else { return all.filter { ($0.deletedAt ?? "").isEmpty } }
        let live = all.filter { ($0.deletedAt ?? "").isEmpty }
        switch list {
        case "owe":
            let owing = Set(invoices.filter { isOwing($0) }.compactMap(\.customerId))
            return live.filter { owing.contains($0.id) }
        case "recent":
            let since = now.addingTimeInterval(-90 * 86_400)
            let recent = Set(invoices.filter { (ERPDate.parse($0.createdAt) ?? .distantPast) >= since }.compactMap(\.customerId))
            return live.filter { recent.contains($0.id) }
        default: return live
        }
    }

    /// How many a saved list holds, for its sidebar count; nil where a count would say nothing (This Month, Recent).
    @MainActor
    static func count(_ href: String, _ list: String, book: Book, now: Date = Date()) -> Int? {
        switch (ScreenRoute.bare(href), list) {
        case ("/orders", "late"), ("/orders", "week"), ("/orders", "new"), ("/orders", "ready"), ("/orders", "payment"):
            return orders(book.orders.items, list: list, invoices: book.invoices.items, now: now).count
        case ("/invoices", "unpaid"), ("/invoices", "today"):
            return invoices(book.invoices.items, list: list, now: now).count
        case ("/repairs", "shop"), ("/repairs", "ready"):
            return repairs(book.repairs.items, list: list).count
        case ("/customers", "owe"):
            return customers(book.customers.items, list: list, invoices: book.invoices.items, now: now).count
        default:
            return nil
        }
    }
}
#endif
