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
        #if os(macOS)
        macBody
        #else
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
                            .keyboardShortcut("s", modifiers: .command)
                    }
                }
            }
        }
        .interactiveDismissDisabled(saving)
        #endif
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

#if os(macOS)
// The Mac's discount sheet (docs/features/mac-design.md, rule 7): what the invoice is now as plain rows, the discount
// focused with a Round menu beside it, and what it will be after. The figures, the rules and the write are the sheet's own.
extension InvoiceActionDiscountSheet {
    var macBody: some View {
        MacInvoiceSheetFrame(title: "Change Discount", subtitle: invoice.id + " · " + InvoiceActionWords.who(invoice),
                             confirmTitle: macConfirmTitle, canConfirm: after != nil && changed, busy: saving,
                             confirm: { Task { await save() } }, cancel: { dismiss() }) {
            macNow
            macDiscount
            macAfter
        }
        .failureAlert($error)
        .interactiveDismissDisabled(saving)
    }

    /// The button says what it does: the discount it sets.
    private var macConfirmTitle: String {
        guard let d = discount else { return "Change Discount" }
        return d > 0 ? "Set Discount to \(PaymentText.pkr(d))" : "Remove Discount"
    }

    /// The invoice as it stands.
    @ViewBuilder
    private var macNow: some View {
        let line = balanceLine(invoice.balanceDue)
        Section("Now") {
            MacInvoiceFigureRow(label: "Subtotal", value: PaymentText.pkr(invoice.subtotal))
            MacInvoiceFigureRow(label: "Discount", value: PaymentText.pkr(invoice.discountAmount))
            if getInvoiceExchangeTotal(invoice) > 0 {
                MacInvoiceFigureRow(label: "Exchange", value: Money.minus(getInvoiceExchangeTotal(invoice)))
            }
            MacInvoiceFigureRow(label: "Grand Total", value: PaymentText.pkr(invoice.grandTotal))
            if invoice.amountPaid != 0 {
                MacInvoiceFigureRow(label: "Paid", value: PaymentText.pkr(invoice.amountPaid))
            }
            MacInvoiceFigureRow(label: line.label, value: PaymentText.pkr(line.amount))
        }
    }

    /// The discount in rupees, the Round menu beside it, and the page's refusal or the sum in lac under it.
    @ViewBuilder
    private var macDiscount: some View {
        LabeledContent("Discount") {
            HStack(spacing: 8) {
                MacInvoiceNumberField(title: "Discount in rupees", text: $amountText.wholeRupees, prompt: "PKR")
                // invoice-viewer.tsx: the bill before any discount is the lines less the exchange.
                MacInvoiceRoundMenu(payable: invoice.subtotal - getInvoiceExchangeTotal(invoice), discount: discount ?? 0) { n in
                    amountText = n > 0 ? PaymentText.field(n) : ""
                }
            }
        }
        if let problem {
            Text(problem).foregroundStyle(Tone.problem.color)
        } else if let d = discount, d > 0 {
            Text(Money.pkrLac(d)).font(.callout).foregroundStyle(.secondary)
        }
    }

    /// What it will be, and what moves with it.
    @ViewBuilder
    private var macAfter: some View {
        if let after, changed {
            let line = balanceLine(after.balanceDue)
            Section("After") {
                MacInvoiceFigureRow(label: "Grand Total", value: PaymentText.pkr(after.grandTotal), bold: true)
                MacInvoiceFigureRow(label: line.label, value: PaymentText.pkr(line.amount))
                Text(followers(after)).font(.callout).foregroundStyle(.secondary)
            }
        }
    }
}
#endif
