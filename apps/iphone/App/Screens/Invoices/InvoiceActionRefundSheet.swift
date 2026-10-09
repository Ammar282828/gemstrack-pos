import SwiftUI
import ERPCore

/// Refund an invoice (invoice-viewer.tsx's Refund dialog), in the dialog's two ways and its words:
/// - **Full refund** deletes the invoice, as Delete does (store `deleteInvoice(id, false)`, lib/writes/
///   invoice-delete.ts): its hisaab rows go and its pieces go back to stock.
/// - **Partial refund** records a negative payment and a matching refund on Shopify; the invoice stays (store
///   `refundInvoicePartial`, lib/writes/invoice-refund.ts).
/// What changes is said here first, from the ERP's own rules (ERPCore InvoiceActions), then the delete code is
/// asked, as the store asks it before either. The ERP refuses a partial refund if the invoice has moved since
/// this sheet worked it out. An owner's; the menu offers it only on an invoice not refunded already.
struct InvoiceActionRefundSheet: View {
    let invoice: Invoice
    let onDone: (InvoiceActionOutcome) -> Void

    private enum Mode: Hashable { case full, partial }

    @Environment(\.dismiss) private var dismiss
    @Environment(Book.self) private var book
    @State private var mode: Mode = .full
    @State private var amountText = ""
    @State private var reason = ""
    @State private var deletion: OwnerDeletion?
    @State private var outcome: InvoiceActionOutcome?

    private var amount: Double { PaymentText.amount(amountText) ?? 0 }
    private var said: String { reason.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// The invoice after the partial refund, as the shared write will leave it.
    private var after: InvoiceActions.Paid? {
        guard mode == .partial, amount > 0 else { return nil }
        return InvoiceActions.withRefund(InvoiceActions.Figures(invoice), amount: amount)
    }

    var body: some View {
        NavigationStack {
            Form { Group {
                Section {
                    Picker("Refund", selection: $mode) {
                        Text("Full refund").tag(Mode.full)
                        Text("Partial refund").tag(Mode.partial)
                    }
                    .pickerStyle(.segmented)
                } footer: {
                    Text(mode == .full
                         ? "A full refund deletes the invoice, removes all hisaab entries, and returns all items to stock. This cannot be undone."
                         : "A partial refund records a negative payment on this invoice and issues a matching refund on Shopify. The invoice stays in your records.")
                }
                if mode == .full {
                    Section("What goes") {
                        Text(InvoiceActionDeleteSheet.detail(invoice, book: book))
                            .font(.subheadline)
                    }
                } else {
                    partialSections
                }
                Section {
                    Button(role: .destructive) { ask() } label: {
                        Label(mode == .full ? "Yes, refund invoice" : "Record partial refund", systemImage: "arrow.uturn.backward")
                    }
                    .disabled(mode == .partial && after == nil)
                }
                }
                .houseRows()
            }
            .navigationTitle("Refund \(invoice.id)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .task {
            book.invoices.need()
            book.hisaab.need()
        }
        .invoiceActionCode($deletion) {
            if let outcome { onDone(outcome) }
            dismiss()
        }
    }

    @ViewBuilder
    private var partialSections: some View {
        Section {
            TextField("Refund amount (PKR)", text: $amountText, prompt: Text("e.g. 1500"))
                .keyboardType(.decimalPad)
                .font(.title2.weight(.semibold))
                .monospacedDigit()
            TextField("Reason", text: $reason, prompt: Text("e.g. damaged item (optional)"))
        } header: {
            Text("Refund")
        } footer: {
            if amount > 0 && amount > invoice.amountPaid + 0.5 {
                // The web takes it; said so nobody hands back more than came in by a slip of the keys.
                Text("More than was paid on it (\(PaymentText.pkr(invoice.amountPaid))).").foregroundStyle(.orange)
            } else if amount > 0 {
                Text(Money.pkrLac(amount))
            }
        }
        if let after {
            Section {
                LabeledContent("Paid") { MoneyText(amount: after.amountPaid, exact: true) }
                LabeledContent(balanceLine(after.balanceDue).label) { MoneyText(amount: balanceLine(after.balanceDue).amount, exact: true) }
                    .font(.headline)
            } header: {
                Text("After")
            } footer: {
                Text(partialFollowers(after))
            }
        }
    }

    /// What follows a partial refund: the hisaab while they owe again, Shopify, and the order left as it is.
    private func partialFollowers(_ after: InvoiceActions.Paid) -> String {
        var lines: [String] = []
        lines.append(after.balanceDue > 0
            ? InvoiceActionWords.ledger(invoice, balanceDue: after.balanceDue)
            : "Nothing is owed on it still; the hisaab is left as it is.")
        if !invoice.id.hasPrefix("SHOPIFY-") { lines.append("A refund for the same amount goes to its Shopify order, if it has one.") }
        return lines.joined(separator: " ")
    }

    private func ask() {
        let invoiceId = invoice.id
        if mode == .full {
            outcome = InvoiceActionOutcome(
                note: InvoiceNote(title: "Invoice refunded", detail: "Invoice \(invoiceId) has been deleted and its pieces returned to stock."),
                removed: true)
            deletion = OwnerDeletion(what: InvoiceActionWords.deleteInvoiceWhat(invoiceId), detail: InvoiceActionDeleteSheet.detail(invoice, book: book)) { code in
                _ = try await ERPAPI.shared.write("deleteInvoice", ["invoiceId": invoiceId, "deleteCode": code])
            }
            return
        }
        guard let after else { return }
        let refund = amount
        let why = said
        let seen = InvoiceActionWords.seen(invoice)
        outcome = InvoiceActionOutcome(
            note: InvoiceNote(title: "Partial refund recorded", detail: "\(PaymentText.pkr(refund)) refunded on Invoice \(invoiceId)."),
            removed: false)
        let detail = "\(PaymentText.pkr(refund)) goes back to the customer\(why.isEmpty ? "" : " (\(why))"), recorded on \(invoiceId) as a negative payment."
            + " Paid becomes \(PaymentText.pkr(after.amountPaid)); \(InvoiceActionWords.balance(after.balanceDue)). " + partialFollowers(after)
        deletion = OwnerDeletion(what: InvoiceActionWords.refundWhat(refund, invoiceId), detail: detail) { code in
            var fields: [String: Any] = ["invoiceId": invoiceId, "amount": refund, "deleteCode": code, "seen": seen]
            if !why.isEmpty { fields["reason"] = why }
            _ = try await ERPAPI.shared.write("refundInvoicePartial", fields)
        }
    }
}
