// Ported from src/lib/analytics/cash-in.ts (tests: CashInTests, from cash-in.test.ts).
//
// Cash in over a period: what came into the shop, each rupee once, on the day it came.
//
// - Payments on invoices, whatever day the invoice was written.
// - Cash advances on orders that are not an invoice yet (orderAdvancePayments: the one taken
//   with the order on its date, each later one on its own). Finalising an order copies its
//   advances onto the invoice as payments with the same days, so from then on they are counted
//   there and not here, and a period's cash does not move when an order is finalised. An order
//   counts as invoiced when it names its invoice or an invoice names it (older data has only
//   the invoice's `sourceOrderId`).
// - Gold (or anything) taken in exchange, at the value agreed: the owner counts it as cash
//   (2026-09-25). An invoice's exchange on the invoice's revenue date, an open order's on the
//   order's, which is the same day once the order is invoiced.
// - Extra revenue.
//
// Invoices made from an order before 2026-09-25 carry the order's advance as ONE payment whose
// amount is the cash and the exchange together, noted "Advance from Order. Cash: X. Exchange: Y
// (…)". It is all counted; Y's share goes under `exchange` so the parts add up. The share is
// taken from the note rather than subtracting Y, because a bill with a coin on it reaches here
// already split pro rata (analytics/coins.ts), which scales the amount but not the note.

import Foundation

/// Either end left nil is open.
public struct Period: Equatable {
    public var from: Date?
    public var to: Date?

    public init(from: Date? = nil, to: Date? = nil) {
        self.from = from
        self.to = to
    }
}

public struct CashIn: Equatable {
    /// Cash paid on invoices (an older order advance's exchange share is under `exchange`).
    public let invoicePayments: Double
    /// Cash advances on orders not invoiced yet.
    public let orderAdvances: Double
    /// Gold (or anything) taken in exchange, at the value agreed.
    public let exchange: Double
    public let extraRevenue: Double
    /// All four.
    public let total: Double
    /// The part of `exchange` taken off an invoice's grand total, which revenue therefore never
    /// counted. Revenue less (total less this) is what is still owed.
    public let exchangeOffInvoices: Double
}

/// `inPeriod` of the TS: parseISO, as the rest of the page, so a bare "2026-09-01" is local
/// (Karachi) midnight, not UTC.
private func inPeriod(_ iso: String?, _ period: Period) -> Bool {
    guard let iso, !iso.isEmpty else { return false }
    if period.from == nil && period.to == nil { return true }
    guard let t = JS.parseISO(iso).map(JS.ms) else { return false }
    return (period.from.map { t >= JS.ms($0) } ?? true) && (period.to.map { t <= JS.ms($0) } ?? true)
}

private let LEGACY_ORDER_ADVANCE = try! NSRegularExpression(
    pattern: #"^Advance from Order\. Cash: (\S*)\. Exchange: (-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)"#,
    options: [.caseInsensitive]
)

/// `Number(text) || 0`.
private func numberOrZero(_ text: String) -> Double {
    let v = JS.toNumber(text)
    return v.isNaN ? 0 : v
}

/// How much of a payment was gold taken in exchange: only an older order advance ever held any.
public func paymentExchangePart(_ p: Payment) -> Double {
    let amount = p.amount.isNaN ? 0 : p.amount
    guard amount > 0, let notes = p.notes,
          let m = LEGACY_ORDER_ADVANCE.firstMatch(in: notes, range: NSRange(notes.startIndex..., in: notes)),
          let cashRange = Range(m.range(at: 1), in: notes), let exchangeRange = Range(m.range(at: 2), in: notes)
    else { return 0 }
    let cash = max(0, numberOrZero(String(notes[cashRange])))
    let exchange = max(0, numberOrZero(String(notes[exchangeRange])))
    if exchange <= 0 { return 0 }
    return JS.round((amount * exchange / (cash + exchange)) * 100) / 100
}

/// Orders already made into an invoice: their advances are that invoice's payments now.
public func invoicedOrderIds(_ orders: [Order], _ invoices: [Invoice]) -> Set<String> {
    var ids = Set<String>()
    for o in orders where JS.has(o.invoiceId) { ids.insert(o.id) }
    for inv in invoices where JS.has(inv.sourceOrderId) { ids.insert(inv.sourceOrderId!) }
    return ids
}

/// - `invoices`: the invoices whose payments count.
/// - `invoiced`: from `invoicedOrderIds`, over every invoice (the coin ones too).
/// - `invoiceDate`: the day an invoice's exchange was taken; analytics passes its revenue date.
///   Defaults to the invoice's `createdAt`.
public func cashInForPeriod(
    invoices: [Invoice],
    orders: [Order],
    invoiced: Set<String>,
    extraRevenues: [AdditionalRevenue],
    period: Period,
    invoiceDate: ((Invoice) -> String)? = nil
) -> CashIn {
    var invoicePayments = 0.0
    var invoiceExchange = 0.0
    var legacyExchange = 0.0
    for inv in invoices {
        if inv.status == .refunded { continue }
        for p in inv.paymentHistory where inPeriod(p.date, period) {
            let inKind = paymentExchangePart(p)
            invoicePayments += (p.amount.isNaN ? 0 : p.amount) - inKind
            legacyExchange += inKind
        }
        if inPeriod(invoiceDate?(inv) ?? inv.createdAt, period) { invoiceExchange += exchangeTotal(invoiceExchanges(inv)) }
    }

    var orderAdvances = 0.0
    var orderExchange = 0.0
    for o in orders {
        if o.status == .cancelled || o.status == .refunded || invoiced.contains(o.id) { continue }
        for p in orderAdvancePayments(o) where inPeriod(p.date, period) { orderAdvances += p.amount }
        if inPeriod(o.createdAt, period) { orderExchange += exchangeTotal(orderExchanges(o)) }
    }

    let extraRevenue = extraRevenues.reduce(0) { $0 + (inPeriod($1.date, period) ? ($1.amount.isNaN ? 0 : $1.amount) : 0) }

    let exchange = invoiceExchange + legacyExchange + orderExchange
    return CashIn(
        invoicePayments: invoicePayments,
        orderAdvances: orderAdvances,
        exchange: exchange,
        extraRevenue: extraRevenue,
        total: invoicePayments + orderAdvances + exchange + extraRevenue,
        exchangeOffInvoices: invoiceExchange
    )
}
