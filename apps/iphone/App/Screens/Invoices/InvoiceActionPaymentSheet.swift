import SwiftUI
import ERPCore

/// Delete one payment from an invoice (invoice-viewer.tsx's bin on a payment row; store `deleteInvoicePayment`,
/// the shared write `removeInvoicePayment` in lib/writes/invoice-payment.ts): an advance carried over from the
/// order, a payment taken since, or a partial refund. What is paid is recomputed from what remains, and the
/// customer's ledger row (credit included) and the order's balance follow in the same commit.
///
/// Pick the payment; the delete code is asked next, saying what the invoice will read after (ERPCore
/// InvoiceActions.withoutPayment). The ERP refuses if the payment is no longer where this sheet showed it. An owner's.
struct InvoiceActionPaymentSheet: View {
    let invoice: Invoice
    /// Told once the ERP has taken it off, in the web's words.
    let onDone: (InvoiceActionOutcome) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var deletion: OwnerDeletion?
    @State private var outcome: InvoiceActionOutcome?

    var body: some View {
        NavigationStack {
            List { Group {
                Section {
                    ForEach(Array(invoice.paymentHistory.enumerated()), id: \.offset) { pair in
                        Button { ask(index: pair.offset, payment: pair.element) } label: {
                            row(pair.element)
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Text("Payments on \(invoice.id)").textCase(nil)
                } footer: {
                    Text("Tap the payment to take off: an advance carried over from the order, a payment, or a refund. The delete code is asked next.")
                }
                }
                .houseRows()
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Delete a payment")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .invoiceActionCode($deletion) {
            if let outcome { onDone(outcome) }
            dismiss()
        }
    }

    private func row(_ p: Payment) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(ShopDate.say(p.date, withTime: true))
                Text(detail(p)).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Text(PaymentText.pkr(p.amount)).monospacedDigit().fontWeight(.medium)
            Image(systemName: "trash").foregroundStyle(.red)
        }
        .contentShape(.rect)
    }

    /// How it came and what it says (older records predate payment types and have none).
    private func detail(_ p: Payment) -> String {
        var parts: [String] = [p.method?.rawValue ?? "—"]
        if let ref = p.reference, !ref.isEmpty { parts.append(ref) }
        let note = (p.notes ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        parts.append(note.isEmpty ? "Payment received" : note)
        return parts.joined(separator: " · ")
    }

    /// The code sheet for this payment, saying what the invoice will read once it is off.
    private func ask(index: Int, payment p: Payment) {
        guard let after = InvoiceActions.withoutPayment(InvoiceActions.Figures(invoice), index: index) else { return }
        let when = ShopDate.say(p.date)
        let note = (p.notes ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        var said = "\(PaymentText.pkr(p.amount)) of \(when)\(note.isEmpty ? "" : " (\(note))") comes off \(invoice.id)."
        said += " Paid becomes \(PaymentText.pkr(after.amountPaid)); \(InvoiceActionWords.balance(after.balanceDue))."
        said += " " + InvoiceActionWords.ledger(invoice, balanceDue: after.balanceDue, keepsCredit: true)
        if let order = invoice.sourceOrderId, !order.isEmpty {
            said += " Order \(order)'s balance becomes \(PaymentText.pkr(after.balanceDue))."
        }
        let line = balanceLine(after.balanceDue)
        outcome = InvoiceActionOutcome(
            note: InvoiceNote(title: "Payment deleted",
                              detail: "\(PaymentText.pkr(p.amount)) taken off \(invoice.id). \(line.label)\(line.amount > 0 ? ": \(PaymentText.pkr(line.amount))" : "")."),
            removed: false)
        let invoiceId = invoice.id
        deletion = OwnerDeletion(what: InvoiceActionWords.deletePaymentWhat(p.amount, invoiceId), detail: said) { code in
            // The payment as this sheet showed it: its place, amount and date. The ERP checks all three.
            _ = try await ERPAPI.shared.write("deleteInvoicePayment", [
                "invoiceId": invoiceId, "index": index, "amount": p.amount, "paymentDate": p.date, "deleteCode": code,
            ])
        }
    }
}
