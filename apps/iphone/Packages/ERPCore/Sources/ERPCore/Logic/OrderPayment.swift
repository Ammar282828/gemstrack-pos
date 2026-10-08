// Ported from src/lib/order-payment.ts (tests: OrderPaymentTests, from order-payment.test.ts).

import Foundation

public enum PaymentStatus: String, Hashable {
    case paid = "Paid", partial = "Partial", unpaid = "Unpaid"
}

/// Whether an order has been paid, from the one number that already knows.
///
/// `order.grandTotal` is stored NET of both the discount and the advance
/// (order-form: `subtotal - discount - totalAdvance`), so it IS the balance
/// still owed, not a gross total.
///
/// Both callers used to also test `totalAdvance >= grandTotal`, which compares
/// the advance against a figure the advance has already been taken out of. A
/// 100,000 order with 60,000 down stores a grandTotal of 40,000, and
/// `60,000 >= 40,000` marked it Paid while 40,000 was still outstanding: every
/// order whose advance covered half the price was mislabelled, on the badge and
/// in the list's payment filter. The balance decides it on its own.
public func getOrderPaymentStatus(_ order: Order) -> PaymentStatus {
    let balance = order.grandTotal
    let totalAdvance = order.advancePayment + (order.advanceInExchangeValue ?? 0)

    if balance <= 0 { return .paid }
    if totalAdvance > 0 { return .partial }
    return .unpaid
}

/// An order's cash advances as the invoice's payments, each with its day and how it was paid
/// (the owner, 2026-09-25: "carry over all details from order to invoice, such as advances").
///
/// `advancePayment` is the running total of every cash advance; `advances` lists the ones
/// recorded after the order was placed. What the list does not account for was taken with the
/// order, on the order's date, by `advanceMethod`. If the total was edited below its list, the
/// total is trusted as one advance. `label` is what each payment's note says ("Advance on order
/// ORD-000123"); the order page shows the same lines. (The TS takes a `Pick` of the order: its
/// id, createdAt, advancePayment, advanceMethod and advances.)
public func orderAdvancePayments(_ order: Order, label: String? = nil) -> [Payment] {
    let label = label ?? "Advance on order \(order.id)"
    let cash = order.advancePayment
    let later = order.advances.filter { $0.amount > 0 }
    let laterSum = later.reduce(0) { $0 + $1.amount }
    if laterSum > cash + 0.5 {
        return cash > 0 ? [Payment(amount: cash, date: order.createdAt, notes: label)] : []
    }
    let first = cash - laterSum
    var lines: [Payment] = []
    if first > 0.5 {
        lines.append(Payment(amount: first, date: order.createdAt, notes: label, method: order.advanceMethod))
    }
    for p in later {
        let note = JS.trim(p.notes ?? "")
        lines.append(Payment(amount: p.amount, date: p.date, notes: note.isEmpty ? label : "\(label): \(note)", method: p.method, reference: p.reference))
    }
    return lines
}

/// The order after one of its advance lines is taken away (`withoutOrderAdvance`).
public struct OrderAdvanceRemoval: Equatable {
    public let advancePayment: Double
    public let advances: [Payment]
    /// The order's `advanceMethod` goes with the advance taken with the order.
    public let dropMethod: Bool
    public let removed: Payment

    public init(advancePayment: Double, advances: [Payment], dropMethod: Bool, removed: Payment) {
        self.advancePayment = advancePayment
        self.advances = advances
        self.dropMethod = dropMethod
        self.removed = removed
    }
}

/// The order without one of its advance lines, as `orderAdvancePayments` lists them (owner,
/// 2026-10-01: "add ability to delete … advances"). The first line, when the total is more than
/// the list, is the advance taken with the order (its `advanceMethod` goes with it); the rest are
/// the `advances` list, in order. Nil for a line that isn't there. The balance is the caller's:
/// subtotal − discount − what is left − exchange, as recording an advance works it out.
public func withoutOrderAdvance(_ order: Order, lineIndex: Int) -> OrderAdvanceRemoval? {
    let lines = orderAdvancePayments(order, label: "")
    guard lineIndex >= 0, lineIndex < lines.count else { return nil }
    let removed = lines[lineIndex]
    let cash = order.advancePayment
    let all = order.advances
    let laterSum = all.filter { $0.amount > 0 }.reduce(0) { $0 + $1.amount }
    // The total was edited below its list: it is shown as one advance, and goes as one.
    if laterSum > cash + 0.5 { return OrderAdvanceRemoval(advancePayment: 0, advances: [], dropMethod: true, removed: removed) }
    let hasFirst = cash - laterSum > 0.5
    if hasFirst && lineIndex == 0 {
        return OrderAdvanceRemoval(advancePayment: JS.round(laterSum * 100) / 100, advances: all, dropMethod: true, removed: removed)
    }
    // The k-th positive entry of the list.
    var k = lineIndex - (hasFirst ? 1 : 0)
    var at = -1
    for (i, p) in all.enumerated() where p.amount > 0 {
        if k == 0 { at = i; break }
        k -= 1
    }
    if at < 0 { return nil }
    return OrderAdvanceRemoval(
        advancePayment: JS.round((cash - all[at].amount) * 100) / 100,
        advances: all.enumerated().filter { $0.offset != at }.map(\.element),
        dropMethod: false,
        removed: removed
    )
}
