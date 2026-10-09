// Ported from src/lib/invoice-actions.ts (tests: InvoiceActionsTests, from invoice-actions.test.ts).
//
// What an invoice's own actions do to its figures, worked out before anything is written: changing the
// discount, a partial refund, deleting one payment, and which pieces a delete puts back in stock. The ERP's
// writes take their figures from the TypeScript; the phone's confirmations say them from this, so what a
// sheet says will happen is what the write then does. A missing figure on an old document counts as nothing.

import Foundation

public enum InvoiceActions {
    /// The figures the actions read off an invoice (TS `InvoiceFigures`).
    public struct Figures: Hashable {
        public var subtotal: Double?
        public var exchangeAmount1: Double?
        public var exchangeAmount2: Double?
        public var grandTotal: Double?
        public var amountPaid: Double?
        /// The payment history's amounts, in order (nil: a payment with no amount).
        public var payments: [Double?]

        public init(subtotal: Double? = nil, exchangeAmount1: Double? = nil, exchangeAmount2: Double? = nil,
                    grandTotal: Double? = nil, amountPaid: Double? = nil, payments: [Double?] = []) {
            self.subtotal = subtotal
            self.exchangeAmount1 = exchangeAmount1
            self.exchangeAmount2 = exchangeAmount2
            self.grandTotal = grandTotal
            self.amountPaid = amountPaid
            self.payments = payments
        }

        public init(_ invoice: Invoice) {
            self.init(subtotal: invoice.subtotal, exchangeAmount1: invoice.exchangeAmount1, exchangeAmount2: invoice.exchangeAmount2,
                      grandTotal: invoice.grandTotal, amountPaid: invoice.amountPaid, payments: invoice.paymentHistory.map { $0.amount })
        }
    }

    /// The invoice with a new discount (TS `withDiscount`).
    public struct Discounted: Equatable {
        public let discountAmount: Double
        public let grandTotal: Double
        public let balanceDue: Double

        public init(discountAmount: Double, grandTotal: Double, balanceDue: Double) {
            self.discountAmount = discountAmount
            self.grandTotal = grandTotal
            self.balanceDue = balanceDue
        }
    }

    /// The history after a refund or a payment deleted, and what is paid and owed on it.
    public struct Paid: Equatable {
        public let payments: [Double?]
        public let amountPaid: Double
        public let balanceDue: Double

        public init(payments: [Double?], amountPaid: Double, balanceDue: Double) {
            self.payments = payments
            self.amountPaid = amountPaid
            self.balanceDue = balanceDue
        }
    }

    /// `Number(v) || 0`: absent or not a number is nothing.
    private static func num(_ v: Double?) -> Double {
        guard let v, !v.isNaN else { return 0 }
        return v
    }

    /// The invoice page's refusals, in its words; nil when the discount can be saved.
    public static func discountProblem(subtotal: Double?, discount: Double) -> String? {
        if !discount.isFinite { return "Enter the discount." }
        if discount < 0 { return "Discount cannot be negative." }
        if discount > num(subtotal) { return "Discount cannot exceed subtotal." }
        return nil
    }

    /// The lines less the discount and the exchange (the two totals every invoice keeps), and what is still
    /// owed on what has been paid. Adjustments are left out, as every sale's total leaves them out.
    public static func withDiscount(_ f: Figures, discount: Double) -> Discounted {
        let grandTotal = num(f.subtotal) - discount - num(f.exchangeAmount1) - num(f.exchangeAmount2)
        return Discounted(discountAmount: discount, grandTotal: grandTotal, balanceDue: grandTotal - num(f.amountPaid))
    }

    /// The refund's line in the payment history: what was handed back, as money out.
    public static func refundEntry(amount: Double, date: String, reason: String? = nil) -> Payment {
        let said = reason ?? ""
        return Payment(amount: -abs(amount), date: date, notes: said.isEmpty ? "Refund" : "Refund: \(said)")
    }

    /// A partial refund: a negative payment on the history, and what is paid and owed recomputed from the
    /// whole history, never from a running total.
    public static func withRefund(_ f: Figures, amount: Double) -> Paid {
        let payments = f.payments + [-abs(amount)]
        let amountPaid = payments.reduce(0) { $0 + num($1) }
        return Paid(payments: payments, amountPaid: amountPaid, balanceDue: num(f.grandTotal) - amountPaid)
    }

    /// One payment off the history (its place as the page shows it), and what is paid and owed without it;
    /// nil when there is none there.
    public static func withoutPayment(_ f: Figures, index: Int) -> Paid? {
        guard index >= 0, index < f.payments.count else { return nil }
        var payments = f.payments
        payments.remove(at: index)
        let amountPaid = payments.reduce(0) { $0 + num($1) }
        return Paid(payments: payments, amountPaid: amountPaid, balanceDue: num(f.grandTotal) - amountPaid)
    }

    /// The pieces a deleted invoice puts back in stock, each once. A piece made for an order (ORD-…) was
    /// never in stock; a piece another invoice also sold (a sale entered twice) stays sold, to that invoice.
    public static func piecesBackInStock(_ invoice: Invoice, others: [Invoice]) -> [InvoiceItem] {
        var elsewhere = Set<String>()
        for o in others where o.id != invoice.id {
            for line in o.items where !line.sku.isEmpty { elsewhere.insert(line.sku) }
        }
        var seen = Set<String>()
        return invoice.items.filter { line in
            let sku = line.sku
            if sku.isEmpty || sku.hasPrefix("ORD-") || elsewhere.contains(sku) || seen.contains(sku) { return false }
            seen.insert(sku)
            return true
        }
    }
}
