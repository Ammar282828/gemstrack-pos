import SwiftUI
import ERPCore

/// Deleting one payment from an invoice (invoice-viewer.tsx's bin on a payment row; store `deleteInvoicePayment`,
/// the shared write `removeInvoicePayment` in lib/writes/invoice-payment.ts): an advance carried over from the
/// order, a payment taken since, or a partial refund. What is paid is recomputed from what remains, and the
/// customer's ledger row (credit included) and the order's balance follow in the same commit.
///
/// The invoice page's swipe (and context menu) on a payment row starts it; the delete code is asked next, saying
/// what the invoice will read after (ERPCore InvoiceActions.withoutPayment). The ERP refuses if the payment is no
/// longer where the page showed it. An owner's.
enum InvoiceActionPaymentSheet {
    /// What deleting one payment says and does: the delete code's words, the ERP's write, and the note for the page
    /// after. Nil when the payment is no longer there.
    static func deleting(_ invoice: Invoice, index: Int, payment p: Payment) -> (deletion: OwnerDeletion, outcome: InvoiceActionOutcome)? {
        guard let after = InvoiceActions.withoutPayment(InvoiceActions.Figures(invoice), index: index) else { return nil }
        let when = ShopDate.say(p.date)
        let note = (p.notes ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        var said = "\(PaymentText.pkr(p.amount)) of \(when)\(note.isEmpty ? "" : " (\(note))") comes off \(invoice.id)."
        said += " Paid becomes \(PaymentText.pkr(after.amountPaid)); \(InvoiceActionWords.balance(after.balanceDue))."
        said += " " + InvoiceActionWords.ledger(invoice, balanceDue: after.balanceDue, keepsCredit: true)
        if let order = invoice.sourceOrderId, !order.isEmpty {
            said += " Order \(order)'s balance becomes \(PaymentText.pkr(after.balanceDue))."
        }
        let line = balanceLine(after.balanceDue)
        let outcome = InvoiceActionOutcome(
            note: InvoiceNote(title: "Payment deleted",
                              detail: "\(PaymentText.pkr(p.amount)) taken off \(invoice.id). \(line.label)\(line.amount > 0 ? ": \(PaymentText.pkr(line.amount))" : "")."),
            removed: false)
        let invoiceId = invoice.id
        let deletion = OwnerDeletion(what: InvoiceActionWords.deletePaymentWhat(p.amount, invoiceId), detail: said) { code in
            // The payment as the list showed it: its place, amount and date. The ERP checks all three.
            _ = try await ERPAPI.shared.write("deleteInvoicePayment", [
                "invoiceId": invoiceId, "index": index, "amount": p.amount, "paymentDate": p.date, "deleteCode": code,
            ])
        }
        return (deletion, outcome)
    }
}
