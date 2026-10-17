import SwiftUI
import ERPCore

/// Change the discount on a saved invoice (invoice-viewer.tsx's Discount; store `updateInvoiceDiscount`, the
/// shared write lib/writes/invoice-discount.ts). The total becomes the lines less the discount and the exchange;
/// what is owed follows on what has been paid, and the customer's ledger row and the order it came from follow
/// in the same commit. The new figures are worked out here by the ERP's own rule (ERPCore InvoiceActions) and
/// agreed to before anything is sent; no delete code, as on the web. An owner's.
struct InvoiceActionDiscountSheet: View {
    let invoice: Invoice
    /// Told once the ERP has it, in the web's words.
    let onDone: (InvoiceActionOutcome) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var amountText: String
    @State private var saving = false
    @State private var error: String?

    init(invoice: Invoice, onDone: @escaping (InvoiceActionOutcome) -> Void) {
        self.invoice = invoice
        self.onDone = onDone
        // Whole rupees: an old invoice's paise are not carried into a box that types only digits.
        _amountText = State(initialValue: rupees(invoice.discountAmount) > 0 ? PaymentText.field(rupees(invoice.discountAmount)) : "")
    }

    /// Blank is no discount (the page's `parseFloat(…) || 0`); anything else must read as rupees.
    private var discount: Double? {
        if amountText.trimmingCharacters(in: .whitespaces).isEmpty { return 0 }
        return PaymentText.amount(amountText)
    }

    /// The page's refusal, in its words; nil when it can be saved.
    private var problem: String? {
        guard let d = discount else { return "Enter the discount." }
        return InvoiceActions.discountProblem(subtotal: invoice.subtotal, discount: d)
    }

    private var after: InvoiceActions.Discounted? {
        guard let d = discount, problem == nil else { return nil }
        return InvoiceActions.withDiscount(InvoiceActions.Figures(invoice), discount: d)
    }

    private var changed: Bool {
        guard let d = discount else { return false }
        return rupees(d) != rupees(invoice.discountAmount)
    }

    var body: some View {
        NavigationStack {
            Form { Group {
                Section {
                    MoneyRow("Subtotal", invoice.subtotal)
                    MoneyRow("Discount", invoice.discountAmount)
                    if getInvoiceExchangeTotal(invoice) > 0 {
                        MoneyRow("Exchange", -getInvoiceExchangeTotal(invoice), signed: true)
                    }
                    MoneyRow("Grand total", invoice.grandTotal)
                    if invoice.amountPaid != 0 {
                        MoneyRow("Paid", invoice.amountPaid)
                    }
                    MoneyRow(balanceLine(invoice.balanceDue).label, balanceLine(invoice.balanceDue).amount)
                } header: {
                    LedgerHeading(title: "Now")
                }
                Section {
                    TextField("Discount in rupees", text: $amountText.wholeRupees)
                        .keyboardType(.numberPad)
                        .font(.title2.weight(.semibold))
                        .monospacedDigit()
                    // invoice-viewer.tsx: the bill before any discount is the lines less the exchange.
                    RoundOffChips(payable: invoice.subtotal - getInvoiceExchangeTotal(invoice), discount: discount ?? 0) { n in
                        amountText = n > 0 ? PaymentText.field(n) : ""
                    }
                } header: {
                    LedgerHeading(title: "Discount")
                } footer: {
                    if let problem {
                        Text(problem).foregroundStyle(Tone.problem.color)
                    } else if let d = discount, d > 0 {
                        Text(Money.pkrLac(d))
                    }
                }
                if let after, changed {
                    Section {
                        MoneyRow("Grand total", after.grandTotal, emphasis: true)
                        MoneyRow(balanceLine(after.balanceDue).label, balanceLine(after.balanceDue).amount)
                    } header: {
                        LedgerHeading(title: "After")
                    } footer: {
                        Text(followers(after))
                    }
                }
                }
                .houseRows()
            }
            .houseForm()
            .scrollDismissesKeyboard(.interactively)
            .keyboardDone()
            .failureAlert($error)
            .navigationTitle("Change the discount")
            .navigationBarTitleDisplayMode(.inline)
            .disabled(saving)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
                // The figures above are the agreement: Before, After and what follows. This button is the confirm.
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView().controlSize(.small)
                    } else {
                        Button("Change", role: .confirm) { Task { await save() } }
                            .disabled(after == nil || !changed)
                    }
                }
            }
        }
        .interactiveDismissDisabled(saving)
    }

    /// What moves with the total: the ledger row and the order's balance.
    private func followers(_ after: InvoiceActions.Discounted) -> String {
        var said = InvoiceActionWords.ledger(invoice, balanceDue: after.balanceDue)
        if let order = invoice.sourceOrderId, !order.isEmpty {
            said += " Order \(order)'s balance becomes \(PaymentText.pkr(after.balanceDue))."
        }
        return said
    }

    private func save() async {
        guard let d = discount, after != nil else { return }
        saving = true
        error = nil
        do {
            try await ERPAPI.shared.write("updateInvoiceDiscount", [
                "invoiceId": invoice.id, "discountAmount": d, "seen": InvoiceActionWords.seen(invoice),
            ])
            onDone(InvoiceActionOutcome(note: InvoiceNote(title: "Discount updated", detail: "Discount set to \(PaymentText.pkr(d))."), removed: false))
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}
