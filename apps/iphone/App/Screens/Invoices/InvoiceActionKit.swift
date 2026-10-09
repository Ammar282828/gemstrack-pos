import SwiftUI
import ERPCore

// What the invoice page's own actions share on the phone (components/invoice/invoice-viewer.tsx): change the
// discount, delete a payment, refund, delete. Each sheet says exactly what will change, from the ERP's own
// rules (ERPCore InvoiceActions, ported from lib/invoice-actions.ts), before anything is sent; the write is the
// ERP's (/api/app/write, ops-invoice-actions.ts). A delete or a refund asks for the delete code with it
// (OwnerDeleteCodeSheet), as the store asks before each (decision "Delete code"). Owners only: on the web each
// is the store's own Firestore write, which the shop floor cannot make.

/// What came of an action, for the invoice page to say (the web's toast) or to leave (the invoice is gone).
struct InvoiceActionOutcome {
    let note: InvoiceNote
    /// Deleted, or refunded in full (which deletes it): the page has nothing left to show, as the web goes back to Invoices.
    let removed: Bool
}

enum InvoiceActionWords {
    /// The figures a confirmation was worked out from: the ERP changes nothing if the invoice has moved since
    /// (a payment taken on another screen), so what was agreed to is what happens.
    static func seen(_ inv: Invoice) -> [String: Any] {
        ["grandTotal": inv.grandTotal, "amountPaid": inv.amountPaid]
    }

    /// "Balance due PKR 5,000", "Credit to customer PKR 3,000" or "Paid in full" (invoice-credit.ts), never a
    /// negative balance.
    static func balance(_ balanceDue: Double) -> String {
        let line = balanceLine(balanceDue)
        return line.state == .paid ? line.label : "\(line.label) \(PaymentText.pkr(line.amount))"
    }

    /// Who the ledger row is for, as the page names them.
    static func who(_ inv: Invoice) -> String {
        InvoiceFacts.customerName(inv, walkIn: "the walk-in")
    }

    /// What the customer's hisaab does after a change that leaves `balanceDue` owing (the shared writes'
    /// ledger rule): one row at what is owed, or none once nothing is. A walk-in has no hisaab of their own.
    /// `keepsCredit`: the write also keeps the invoice's credit row (deleting a payment does, `followCredit`;
    /// the discount's write does not, and the ledger sync puts that right later).
    static func ledger(_ inv: Invoice, balanceDue: Double, keepsCredit: Bool = false) -> String {
        if balanceDue > 0 {
            return canHoldCredit(inv.customerId)
                ? "\(who(inv))'s hisaab shows \(PaymentText.pkr(balanceDue)) owed on it."
                : "Its walk-in ledger row shows \(PaymentText.pkr(balanceDue)) owed."
        }
        if keepsCredit && inCredit(balanceDue) && canHoldCredit(inv.customerId) {
            return "\(who(inv))'s hisaab holds \(PaymentText.pkr(-balanceDue)) as credit."
        }
        return "Nothing is owed on it: its ledger row for what was owed goes."
    }

    /// The store's words as its delete-code dialog says them (requireDeleteCode).
    static func deletePaymentWhat(_ amount: Double, _ invoiceId: String) -> String {
        "Delete the payment of \(PaymentText.pkr(amount)) on \(invoiceId)"
    }

    static func refundWhat(_ amount: Double, _ invoiceId: String) -> String {
        "Refund \(PaymentText.pkr(amount)) on \(invoiceId)"
    }

    static func deleteInvoiceWhat(_ invoiceId: String) -> String { "Delete invoice \(invoiceId)" }

    /// One piece as a person names it: "Ruby ring (RNG-001)", the stock number only when it is one.
    static func piece(_ item: InvoiceItem) -> String {
        let name = item.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let oneOff = item.sku.hasPrefix("NEW-") || item.sku.hasPrefix("BILL-")
        if name.isEmpty { return item.sku }
        return oneOff ? name : "\(name) (\(item.sku))"
    }

    /// What deleting the invoice takes with it (lib/writes/invoice-delete.ts): its ledger rows, its pieces back
    /// in stock (ERPCore piecesBackInStock), its order's link, Shopify's copy. Said before the code is asked.
    /// `ledgerRows` nil: the hisaab is not read yet, and the rows are said without a count rather than as none.
    static func deletion(_ inv: Invoice, others: [Invoice], ledgerRows: Int?) -> String {
        var lines: [String] = []
        switch ledgerRows {
        case nil: lines.append("Its ledger rows on the hisaab go with it.")
        case 0?: lines.append("It has no ledger rows.")
        case let n?: lines.append("Its \(n) ledger row\(n == 1 ? "" : "s") on the hisaab go\(n == 1 ? "es" : "") with it.")
        }
        let back = InvoiceActions.piecesBackInStock(inv, others: others)
        if back.isEmpty {
            lines.append("No piece goes back in stock.")
        } else {
            lines.append("Back in stock: " + back.map(piece).joined(separator: ", ") + ".")
        }
        // Fewer back than it has: a piece made for an order (never stock) or sold on another invoice too stays as it is.
        if back.count < Set(inv.items.map(\.sku).filter { !$0.isEmpty }).count {
            lines.append("A piece made for an order, or sold on another invoice too, stays where it is.")
        }
        if let order = inv.sourceOrderId, !order.isEmpty {
            lines.append("Order \(order) stays, without this invoice: its advance counts again.")
        }
        if let shop = inv.shopifyOrderId, !shop.isEmpty, !inv.id.hasPrefix("SHOPIFY-") {
            lines.append("Its Shopify order is cancelled too.")
        }
        return lines.joined(separator: " ")
    }
}

extension View {
    /// The delete code, asked over an action's sheet; `done` runs once the ERP has made the change.
    func invoiceActionCode(_ deletion: Binding<OwnerDeletion?>, done: @escaping () -> Void) -> some View {
        sheet(item: deletion) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) { done() }
        }
    }
}
