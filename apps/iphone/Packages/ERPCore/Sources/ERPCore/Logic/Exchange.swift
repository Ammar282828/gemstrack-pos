// Ported from src/lib/exchange.ts (tests: ExchangeTests, from exchange.test.ts). `ExchangeEntry`
// itself is the model in Models/Payment.swift.
//
// Gold (or anything else) the customer hands over, taken off the bill at an agreed value.
//
// One shape everywhere (the owner, 2026-09-25: "make the exchange gold field uniform and add
// the ability to add another"): an order's exchange and an invoice's are the same list of
// rows (what it is, karat, grams, the rate it was taken at, and the value that comes off)
// and an order's list is carried onto its invoice as it is.
//
// Older documents hold one exchange on an order (advanceInExchangeDescription/Value) and one
// description with two amounts on an invoice (exchangeDescription, exchangeAmount1/2);
// orderExchanges and invoiceExchanges read either. Every write also keeps those old fields as
// totals (orderExchangeFields, invoiceExchangeFields), so all the arithmetic that reads them —
// balances, analytics, Shopify, the per-piece split — stays right without knowing about rows.

import Foundation

/// `typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0` for a number already in hand.
private func num(_ v: Double?) -> Double {
    guard let v, v.isFinite else { return 0 }
    return v
}

public func exchangeTotal(_ list: [ExchangeEntry]?) -> Double {
    (list ?? []).reduce(0) { $0 + num($1.value) }
}

/// "Old ring · 22k · 5.2 g at 22,000/g"; an unnamed row is "Gold" when weighed, else plain "Exchange".
public func describeExchangeEntry(_ e: ExchangeEntry) -> String {
    let named = JS.trim(e.description)
    var parts = [named.isEmpty ? (JS.has(e.karat) || num(e.weightG) > 0 ? "Gold" : "Exchange") : named]
    if let karat = e.karat, !karat.isEmpty { parts.append(karat) }
    if num(e.weightG) > 0 {
        // en-PK groups in thousands, as Money.grouped does.
        let rate = num(e.ratePerGram) > 0 ? " at \(Money.grouped(JS.round(num(e.ratePerGram))))/g" : ""
        parts.append("\(JS.number(num(e.weightG))) g\(rate)")
    }
    return parts.joined(separator: " · ")
}

public func describeExchanges(_ list: [ExchangeEntry]) -> String {
    list.map(describeExchangeEntry).joined(separator: "; ")
}

/// The rows worth keeping: a value or a name, trimmed, with a karat, grams or rate only when given.
private func clean(_ list: [ExchangeEntry]) -> [ExchangeEntry] {
    list
        .filter { num($0.value) > 0 || !JS.trim($0.description).isEmpty }
        .map { e in
            ExchangeEntry(
                description: JS.trim(e.description),
                karat: JS.has(e.karat) ? e.karat : nil,
                weightG: num(e.weightG) > 0 ? num(e.weightG) : nil,
                ratePerGram: num(e.ratePerGram) > 0 ? num(e.ratePerGram) : nil,
                value: num(e.value)
            )
        }
}

/// An order's exchange rows, from the list or from the one exchange older orders kept.
public func orderExchanges(_ order: Order?) -> [ExchangeEntry] {
    guard let order else { return [] }
    if !order.exchanges.isEmpty { return clean(order.exchanges) }
    let value = num(order.advanceInExchangeValue)
    let description = JS.trim(order.advanceInExchangeDescription ?? "")
    return value > 0 || !description.isEmpty ? [ExchangeEntry(description: description, value: value)] : []
}

/// An invoice's exchange rows, from the list or from an older invoice's description and two amounts.
public func invoiceExchanges(_ inv: Invoice?) -> [ExchangeEntry] {
    guard let inv else { return [] }
    if !inv.exchanges.isEmpty { return clean(inv.exchanges) }
    let described = JS.trim(inv.exchangeDescription ?? "")
    var out: [ExchangeEntry] = []
    if num(inv.exchangeAmount1) > 0 { out.append(ExchangeEntry(description: described, value: num(inv.exchangeAmount1))) }
    if num(inv.exchangeAmount2) > 0 { out.append(ExchangeEntry(description: out.isEmpty ? described : "", value: num(inv.exchangeAmount2))) }
    if out.isEmpty && !described.isEmpty { out.append(ExchangeEntry(description: described, value: 0)) }
    return out
}

/// What an order stores for its exchange rows: the rows, and the old single-exchange totals.
public struct OrderExchangeFields: Equatable {
    public let exchanges: [ExchangeEntry]
    public let advanceInExchangeDescription: String
    public let advanceInExchangeValue: Double
}

public func orderExchangeFields(_ list: [ExchangeEntry]) -> OrderExchangeFields {
    let rows = clean(list)
    return OrderExchangeFields(
        exchanges: rows,
        advanceInExchangeDescription: describeExchanges(rows),
        advanceInExchangeValue: exchangeTotal(rows)
    )
}

/// What an invoice stores for its exchange rows: the rows, and the old fields as one total.
public struct InvoiceExchangeFields: Equatable {
    public let exchanges: [ExchangeEntry]
    public let exchangeDescription: String
    /// Written only when the rows come to something.
    public let exchangeAmount1: Double?
}

/// Nil when there is nothing to write (the TS answers `{}`).
public func invoiceExchangeFields(_ list: [ExchangeEntry]) -> InvoiceExchangeFields? {
    let rows = clean(list)
    let total = exchangeTotal(rows)
    if rows.isEmpty { return nil }
    return InvoiceExchangeFields(exchanges: rows, exchangeDescription: describeExchanges(rows), exchangeAmount1: total > 0 ? total : nil)
}

// MARK: The rows as typed in a form (components/shared/exchange-rows.tsx)
// Kept as strings while being typed; ExchangeEntry when the document is written.

public struct ExchangeRow: Equatable, Identifiable {
    public var id: String
    public var description: String
    public var karat: String
    public var weightG: String
    public var ratePerGram: String
    public var value: String
    /// Someone typed the value; grams × rate no longer overwrites it.
    public var valueTyped: Bool

    public init(id: String = newExchangeRowId(), description: String = "", karat: String = "", weightG: String = "",
                ratePerGram: String = "", value: String = "", valueTyped: Bool = false) {
        self.id = id
        self.description = description
        self.karat = karat
        self.weightG = weightG
        self.ratePerGram = ratePerGram
        self.value = value
        self.valueTyped = valueTyped
    }
}

/// A change to a row (TS `Partial<ExchangeRow>`): only what is set changes. Presence is what
/// counts: `value: ""` clears the value, nil leaves it.
public struct ExchangeRowPatch {
    public var id: String?
    public var description: String?
    public var karat: String?
    public var weightG: String?
    public var ratePerGram: String?
    public var value: String?
    public var valueTyped: Bool?

    public init(id: String? = nil, description: String? = nil, karat: String? = nil, weightG: String? = nil,
                ratePerGram: String? = nil, value: String? = nil, valueTyped: Bool? = nil) {
        self.id = id
        self.description = description
        self.karat = karat
        self.weightG = weightG
        self.ratePerGram = ratePerGram
        self.value = value
        self.valueTyped = valueTyped
    }
}

/// `parseFloat(s) || 0`.
private func n(_ s: String) -> Double {
    let v = JS.parseFloat(s)
    return v.isNaN ? 0 : v
}

/// `Math.random().toString(36).slice(2, 9)`: seven characters.
public func newExchangeRowId() -> String {
    let alphabet = Array("0123456789abcdefghijklmnopqrstuvwxyz")
    return String((0..<7).map { _ in alphabet.randomElement()! })
}

public func blankExchangeRow() -> ExchangeRow { ExchangeRow() }

public func rowsFromExchanges(_ list: [ExchangeEntry]) -> [ExchangeRow] {
    guard !list.isEmpty else { return [blankExchangeRow()] }
    return list.map { e in
        ExchangeRow(
            description: e.description,
            karat: e.karat ?? "",
            weightG: (e.weightG ?? 0) != 0 ? JS.number(e.weightG!) : "",
            ratePerGram: (e.ratePerGram ?? 0) != 0 ? JS.number(e.ratePerGram!) : "",
            value: e.value != 0 ? JS.number(e.value) : "",
            valueTyped: true
        )
    }
}

public func exchangesFromRows(_ rows: [ExchangeRow]) -> [ExchangeEntry] {
    rows
        .map { r in
            ExchangeEntry(
                description: JS.trim(r.description),
                karat: r.karat.isEmpty ? nil : r.karat,
                weightG: n(r.weightG) > 0 ? n(r.weightG) : nil,
                ratePerGram: n(r.ratePerGram) > 0 ? n(r.ratePerGram) : nil,
                value: n(r.value)
            )
        }
        .filter { $0.value > 0 || !$0.description.isEmpty }
}

public func exchangeRowsTotal(_ rows: [ExchangeRow]) -> Double {
    rows.reduce(0) { $0 + n($1.value) }
}

/// Apply a change to one row; grams × rate refills the value unless it was typed.
public func applyExchangeRowChange(_ row: ExchangeRow, _ patch: ExchangeRowPatch) -> ExchangeRow {
    var next = row
    if let v = patch.id { next.id = v }
    if let v = patch.description { next.description = v }
    if let v = patch.karat { next.karat = v }
    if let v = patch.weightG { next.weightG = v }
    if let v = patch.ratePerGram { next.ratePerGram = v }
    if let v = patch.value { next.value = v }
    if let v = patch.valueTyped { next.valueTyped = v }
    if let typed = patch.value { next.valueTyped = !typed.isEmpty }
    if !next.valueTyped && (patch.weightG != nil || patch.ratePerGram != nil) {
        let computed = JS.round(n(next.weightG) * n(next.ratePerGram))
        next.value = computed > 0 ? JS.number(computed) : ""
    }
    return next
}
