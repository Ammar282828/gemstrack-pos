// Ported from src/lib/order-stage.ts (tests: OrderStageTests, from order-stage.test.ts).
//
// Where an order stands, from its pieces: one rule for every path that changes them.
//
// The audit of 2026-10-04 (both houses' activity log, 60 days) found each custom order saved
// about 4.4 times after it was made, most of them status changes typed by hand: "In Progress"
// when the karigars had the pieces, "Completed" when they were back. The pieces already say
// both. Before, only the per-piece karigar picker moved an order on (Pending → In Progress), and
// ticking every piece finished never moved it at all; an order made with its karigars set, or
// changed in the edit form, stayed Pending until someone changed it.
//
// Forward only, and only from Pending or In Progress: an order that is Completed, Cancelled or
// Refunded, or already invoiced, is never moved by its pieces. (Unticking a piece of a finished
// order is its own action: `statusAfterUntick`.)
//
// And the stage the Orders hub sorts by, with the one thing to do next.
//
// The TS takes loose shapes (`Stageable`, `Piece`); the Swift takes the `Order` and `OrderItem`
// they are shapes of.

import Foundation

/// A confirmed online order whose bank transfer is not in yet (website/online.ts): nothing is made before it is.
public func awaitingTransfer(_ order: Order) -> Bool {
    order.website?.paymentStatus == .awaitingTransfer || order.website?.paymentStatus == .slipSent
}

/// An order not yet invoiced that the books count as a sale on the day it was taken (its subtotal):
/// the dashboard, Analytics and the monthly PDF all read this one rule. A counter order is a sale
/// once taken: the customer stood there and agreed. An online order is not, until its transfer is
/// in: confirmed and unpaid it is an offer the customer may let lapse, and counting it put a
/// stranger's two-million-rupee basket into "Taken today" before a rupee had moved (2026-10-04).
public func bookedAsSale(_ order: Order?) -> Bool {
    guard let o = order else { return false }
    return JS.has(o.createdAt) && o.status != .cancelled && o.status != .refunded && !JS.has(o.invoiceId) && !awaitingTransfer(o)
}

private func hasKarigar(_ p: OrderItem) -> Bool {
    JS.has(p.karigarId) && p.karigarId != "none"
}

/// The status an order's pieces move it to, or nil to leave it as it is.
public func statusFromPieces(_ status: OrderStatus, _ items: [OrderItem]?, invoiced: Bool = false) -> OrderStatus? {
    let list = items ?? []
    if invoiced || list.isEmpty { return nil }
    if status != .pending && status != .inProgress { return nil }
    if list.allSatisfy(\.isCompleted) { return .completed }
    if status == .pending && list.allSatisfy(hasKarigar) { return .inProgress }
    return nil
}

/// A piece of a finished (not yet invoiced) order was unticked: it is back with the karigars.
public func statusAfterUntick(_ status: OrderStatus, invoiced: Bool = false) -> OrderStatus? {
    status == .completed && !invoiced ? .inProgress : nil
}

/// The hub's stages, in the order they are worked:
///   transfer an online order, confirmed, its bank transfer not recorded yet: check the bank
///   ready    finished, not invoiced: hand it over: Finalize & invoice
///   karigar  In Progress: with the karigars
///   new      Pending: not started: give the pieces to karigars
///   payment  invoiced, money still owed on the invoice
///   done     invoiced and paid
///   closed   Cancelled or Refunded
public enum OrderStage: String, CaseIterable, Hashable {
    case transfer, ready, karigar, new, payment, done, closed
}

public let STAGE_ORDER: [OrderStage] = [.transfer, .ready, .karigar, .new, .payment, .done, .closed]

public struct StageInfo: Equatable {
    public let title: String
    public let hint: String
}

public let STAGES: [OrderStage: StageInfo] = [
    .transfer: StageInfo(title: "Awaiting transfer", hint: "online, confirmed — check the bank"),
    .ready: StageInfo(title: "Ready to hand over", hint: "finished — invoice it"),
    .karigar: StageInfo(title: "With karigars", hint: "being made"),
    .new: StageInfo(title: "Not started", hint: "give the pieces out"),
    .payment: StageInfo(title: "Awaiting payment", hint: "invoiced — taken on the invoice"),
    .done: StageInfo(title: "Done", hint: "invoiced and paid"),
    .closed: StageInfo(title: "Cancelled or refunded", hint: ""),
]

/// `owedOnInvoice`: what the order's invoice still has owing (0 when paid or not invoiced).
public func stageOf(_ order: Order, owedOnInvoice: Double = 0) -> OrderStage {
    if order.status == .cancelled || order.status == .refunded { return .closed }
    if !JS.has(order.invoiceId) && awaitingTransfer(order) { return .transfer }
    if JS.has(order.invoiceId) { return owedOnInvoice > 0.5 ? .payment : .done }
    if order.status == .completed { return .ready }
    if order.status == .inProgress { return .karigar }
    return .new
}

public struct PieceCounts: Equatable {
    public let total: Int
    public let unassigned: Int
    public let done: Int
}

/// The pieces still without a karigar, and still being made.
public func pieceCounts(_ items: [OrderItem]?) -> PieceCounts {
    let list = items ?? []
    return PieceCounts(total: list.count, unassigned: list.filter { !hasKarigar($0) }.count, done: list.filter(\.isCompleted).count)
}
