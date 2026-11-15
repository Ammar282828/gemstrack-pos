// Ported from src/lib/collect.ts (tests: CollectTests, from collect.test.ts).
//
// Who still owes the shop, one row per bill (the owner, 2026-11-14: "create a separate page to see people who still owe
// money in invoices or completed orders. allow to sort by who took the order").
//
// Two kinds of row:
//  - an invoice not refunded whose balance is still due (`isOwing`, the rule of every other "owed" figure);
//  - an order marked Completed that has not been invoiced yet and still has a balance (`grandTotal` is the balance after
//    its advances). An invoiced order's debt is its invoice's, so it is never counted twice.
// Never the hisaab's own entries: this reads bills only.

import Foundation

public enum CollectKind: String, Hashable, CaseIterable { case invoice, order }
public enum CollectAge: String, Hashable, CaseIterable { case under30, thirtyTo90 = "30to90", over90 }
public enum CollectPaid: String, Hashable, CaseIterable { case nothing, part }
public enum CollectSort: String, Hashable, CaseIterable { case oldest, amount, takenBy }

public struct CollectRow: Equatable, Identifiable {
    public var kind: CollectKind
    public var id: String
    /// Where it opens: "/invoices/<id>" or "/orders/<id>".
    public var href: String
    public var customerName: String
    public var customerId: String?
    public var phone: String?
    /// When the bill was written (the invoice's, or the order's, date).
    public var date: String
    /// The bill's full amount, and what is still to come.
    public var total: Double
    public var due: Double
    /// Who took it at the counter; "" when nobody was recorded.
    public var takenBy: String

    /// An invoice and an order may share an id's text; the row's own key says which.
    public var rowID: String { "\(kind.rawValue)-\(id)" }

    public init(kind: CollectKind, id: String, href: String, customerName: String, customerId: String? = nil, phone: String? = nil,
                date: String, total: Double, due: Double, takenBy: String) {
        self.kind = kind; self.id = id; self.href = href; self.customerName = customerName; self.customerId = customerId
        self.phone = phone; self.date = date; self.total = total; self.due = due; self.takenBy = takenBy
    }
}

public let COLLECT_NOBODY = ""

private func filled(_ s: String?) -> String? {
    guard let s, !s.isEmpty else { return nil }
    return s
}

public func collectRows(_ invoices: [Invoice], _ orders: [Order]) -> [CollectRow] {
    var rows: [CollectRow] = []
    for inv in invoices {
        if !isOwing(inv) { continue }
        rows.append(CollectRow(
            kind: .invoice, id: inv.id, href: "/invoices/\(inv.id)",
            customerName: inv.customerName.isEmpty ? "Walk-in" : inv.customerName,
            customerId: filled(inv.customerId), phone: filled(inv.customerContact),
            date: inv.createdAt, total: invoiceSaleValue(inv), due: JS.round(inv.balanceDue.isNaN ? 0 : inv.balanceDue),
            takenBy: inv.takenBy ?? COLLECT_NOBODY))
    }
    for o in orders {
        if o.status != .completed || JS.has(o.invoiceId) || !owesMoney(o.grandTotal) { continue }
        rows.append(CollectRow(
            kind: .order, id: o.id, href: "/orders/\(o.id)",
            customerName: filled(o.customerName) ?? "Walk-in",
            customerId: filled(o.customerId), phone: filled(o.customerContact),
            date: o.createdAt, total: orderFullTotal(o), due: JS.round(o.grandTotal.isNaN ? 0 : o.grandTotal),
            takenBy: o.takenBy ?? COLLECT_NOBODY))
    }
    return rows
}

/// A bill's date as `String(r.date).localeCompare` reads it.
private func oldestFirst(_ a: CollectRow, _ b: CollectRow) -> Double { Double(JS.localeCompare(a.date, b.date)) }

public func sortRows(_ rows: [CollectRow], by: CollectSort) -> [CollectRow] {
    switch by {
    case .amount:
        return rows.jsSorted { a, b in
            let d = b.due - a.due
            return d != 0 ? d : oldestFirst(a, b)
        }
    case .takenBy:
        // Nobody recorded sorts last: U+FFFF in the TS is after every name.
        return rows.jsSorted { a, b in
            let c = Double(JS.localeCompare(a.takenBy.isEmpty ? "\u{FFFF}" : a.takenBy, b.takenBy.isEmpty ? "\u{FFFF}" : b.takenBy))
            return c != 0 ? c : oldestFirst(a, b)
        }
    case .oldest:
        return rows.jsSorted(by: oldestFirst)
    }
}

public struct CollectPerson: Equatable {
    public var takenBy: String
    public var count: Int
    public var due: Double
}

/// By who took them: each person's rows' count and total due, the largest first; nobody recorded last.
public func byTakenBy(_ rows: [CollectRow]) -> [CollectPerson] {
    var order: [String] = []
    var m: [String: (count: Int, due: Double)] = [:]
    for r in rows {
        if m[r.takenBy] == nil { order.append(r.takenBy) }
        var e = m[r.takenBy] ?? (count: 0, due: 0)
        e.count += 1
        e.due += r.due
        m[r.takenBy] = e
    }
    return order.map { CollectPerson(takenBy: $0, count: m[$0]!.count, due: m[$0]!.due) }
        .jsSorted { a, b in
            let na = a.takenBy == COLLECT_NOBODY ? 1.0 : 0.0
            let nb = b.takenBy == COLLECT_NOBODY ? 1.0 : 0.0
            return (na - nb) != 0 ? (na - nb) : (b.due - a.due)
        }
}

/// Filters, several at once (the owner, 2026-11-14: "allow multi-filtering. Just keep the main filter as the person who took
/// the order"). The person is the main one; bill, age and paid narrow it. Within a group any chosen value passes; across
/// groups all must. An empty group lets everything through.
public struct CollectFilters: Equatable {
    public var people: Set<String>
    public var kinds: Set<CollectKind>
    public var ages: Set<CollectAge>
    public var paid: Set<CollectPaid>
    /// A customer's name or number, or the bill's id.
    public var query: String

    public init(people: Set<String> = [], kinds: Set<CollectKind> = [], ages: Set<CollectAge> = [], paid: Set<CollectPaid> = [], query: String = "") {
        self.people = people; self.kinds = kinds; self.ages = ages; self.paid = paid; self.query = query
    }
}

public let COLLECT_NO_FILTERS = CollectFilters()

public enum CollectGroup { case people, kinds, ages, paid, query }

private let DAY_MS = 86_400_000.0

/// How long a bill has waited: over 90 days, 30 to 90, or under. An unreadable date is under 30 (NaN beats neither test).
public func ageOf(_ r: CollectRow, now: Date = Date()) -> CollectAge {
    guard let d = JS.newDate(r.date) else { return .under30 }
    let days = ((Double(JS.ms(now)) - Double(JS.ms(d))) / DAY_MS).rounded(.down)
    return days > 90 ? .over90 : days >= 30 ? .thirtyTo90 : .under30
}

public func paidOf(_ r: CollectRow) -> CollectPaid { r.due >= r.total ? .nothing : .part }

private func digitsOf(_ s: String) -> String { String(s.unicodeScalars.filter { $0.value >= 48 && $0.value <= 57 }) }

/// Does a row pass every filter but `skip` (so each chip can count what choosing it would add)?
public func passes(_ r: CollectRow, _ f: CollectFilters, skip: CollectGroup? = nil, now: Date = Date()) -> Bool {
    if skip != .people && !f.people.isEmpty && !f.people.contains(r.takenBy) { return false }
    if skip != .kinds && !f.kinds.isEmpty && !f.kinds.contains(r.kind) { return false }
    if skip != .ages && !f.ages.isEmpty && !f.ages.contains(ageOf(r, now: now)) { return false }
    if skip != .paid && !f.paid.isEmpty && !f.paid.contains(paidOf(r)) { return false }
    let q = JS.trim(f.query).lowercased()
    if skip != .query && !q.isEmpty {
        let digits = digitsOf(q)
        let hay = "\(r.customerName) \(r.id)".lowercased()
        let byPhone = digits.count >= 3 && digitsOf(r.phone ?? "").contains(digits)
        if !hay.contains(q) && !byPhone { return false }
    }
    return true
}

public func filterRows(_ rows: [CollectRow], _ f: CollectFilters, now: Date = Date()) -> [CollectRow] {
    rows.filter { passes($0, f, now: now) }
}

public struct CollectCount: Equatable {
    public var count: Int
    public var due: Double
}

/// How many rows each value of a group would show, with the other groups' filters on.
public func countBy<V: Hashable>(_ rows: [CollectRow], _ f: CollectFilters, group: CollectGroup, valueOf: (CollectRow) -> V, now: Date = Date()) -> [V: CollectCount] {
    var m: [V: CollectCount] = [:]
    for r in rows {
        if !passes(r, f, skip: group, now: now) { continue }
        let v = valueOf(r)
        var e = m[v] ?? CollectCount(count: 0, due: 0)
        e.count += 1
        e.due += r.due
        m[v] = e
    }
    return m
}

public func filtersOn(_ f: CollectFilters) -> Int {
    f.people.count + f.kinds.count + f.ages.count + f.paid.count + (JS.trim(f.query).isEmpty ? 0 : 1)
}
