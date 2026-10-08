// Ported from src/lib/financials.ts (tests: FinancialsTests; financials.ts has no test of its own,
// so the figures there were taken from running the TypeScript itself).
//
// Small rules about what an invoice comes to and which orders are placeholders.
//
// The TS takes anything shaped like an invoice or an order (`InvoiceLike`, `OrderLike`) with every
// field optional or null, so a half-written document still answers. The same two names are here
// as structs, each with an init from the model; the functions also take the model itself.

import Foundation

/// What scripts/restore-orders.mjs writes at the head of the notes of an order it rebuilt from the
/// activity log after the original was overwritten (items unknown, to be filled in by hand).
private let RESTORED_ORDER_NOTES_MARKER = "[RESTORED FROM ACTIVITY LOG"

/// The five figures `getInvoiceExpectedGrandTotal` reads off an invoice (TS `InvoiceLike`). A figure
/// that is absent, null, 0 or not a number counts as 0.
public struct InvoiceLike: Hashable {
    public var subtotal: Double?
    public var discountAmount: Double?
    public var exchangeAmount1: Double?
    public var exchangeAmount2: Double?
    public var adjustmentsAmount: Double?

    public init(
        subtotal: Double? = nil, discountAmount: Double? = nil,
        exchangeAmount1: Double? = nil, exchangeAmount2: Double? = nil, adjustmentsAmount: Double? = nil
    ) {
        self.subtotal = subtotal
        self.discountAmount = discountAmount
        self.exchangeAmount1 = exchangeAmount1
        self.exchangeAmount2 = exchangeAmount2
        self.adjustmentsAmount = adjustmentsAmount
    }

    public init(_ invoice: Invoice) {
        self.init(
            subtotal: invoice.subtotal, discountAmount: invoice.discountAmount,
            exchangeAmount1: invoice.exchangeAmount1, exchangeAmount2: invoice.exchangeAmount2,
            adjustmentsAmount: invoice.adjustmentsAmount
        )
    }
}

/// The one field `isRestoredPlaceholderOrder` reads off an order (TS `OrderLike`).
public struct OrderLike: Hashable {
    public var notes: String?

    public init(notes: String? = nil) { self.notes = notes }
    public init(_ order: Order) { self.init(notes: order.notes) }
}

/// An order that was rebuilt as a placeholder from the activity log, which its notes say.
public func isRestoredPlaceholderOrder(_ order: OrderLike?) -> Bool {
    guard let notes = order?.notes else { return false }
    // `includes` compares UTF-16 code units; `.literal` is Foundation's way of saying the same.
    return notes.range(of: RESTORED_ORDER_NOTES_MARKER, options: .literal) != nil
}

public func isRestoredPlaceholderOrder(_ order: Order) -> Bool { isRestoredPlaceholderOrder(OrderLike(order)) }

/// The two old-gold exchange figures an invoice keeps, together (the `exchanges` rows are
/// lib/exchange.ts's; these are the older pair).
public func getInvoiceExchangeTotal(_ invoice: InvoiceLike?) -> Double {
    JS.orZero(invoice?.exchangeAmount1) + JS.orZero(invoice?.exchangeAmount2)
}

public func getInvoiceExchangeTotal(_ invoice: Invoice) -> Double { getInvoiceExchangeTotal(InvoiceLike(invoice)) }

/// Shipping, taxes or other adjustments beyond the line items.
public func getInvoiceAdjustmentsAmount(_ invoice: InvoiceLike?) -> Double {
    JS.orZero(invoice?.adjustmentsAmount)
}

public func getInvoiceAdjustmentsAmount(_ invoice: Invoice) -> Double { getInvoiceAdjustmentsAmount(InvoiceLike(invoice)) }

/// What the invoice should total: the lines, less the discount and the exchange, plus the adjustments.
/// 0 for no invoice.
public func getInvoiceExpectedGrandTotal(_ invoice: InvoiceLike?) -> Double {
    guard let invoice else { return 0 }
    return JS.orZero(invoice.subtotal)
        - JS.orZero(invoice.discountAmount)
        - getInvoiceExchangeTotal(invoice)
        + getInvoiceAdjustmentsAmount(invoice)
}

public func getInvoiceExpectedGrandTotal(_ invoice: Invoice) -> Double { getInvoiceExpectedGrandTotal(InvoiceLike(invoice)) }
