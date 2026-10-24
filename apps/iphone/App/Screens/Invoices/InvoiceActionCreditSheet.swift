import SwiftUI
import ERPCore

/// Give a customer their credit back (give-back-credit.tsx; the shared write lib/writes/invoice-credit-payback.ts,
/// op `payBackCredit`). An invoice paid past its total leaves the named customer a credit on their hisaab; this
/// hands the money over and brings it down. The amount starts at the whole credit ("finish that credit"); a part
/// is allowed. It is a payment going out, NOT a refund of the sale: no delete code, nothing goes to Shopify, and
/// the sale's revenue is untouched. It shows as money out in Today's cash. A money op: awaited here, never queued.
/// An owner's. The toast the page raises on `onDone` is the tap (no second haptic).
struct InvoiceActionCreditSheet: View {
    let invoice: Invoice
    let onDone: (InvoiceActionOutcome) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var amountText: String
    @State private var method = "Cash"
    @State private var saving = false
    @State private var error: String?

    init(invoice: Invoice, onDone: @escaping (InvoiceActionOutcome) -> Void) {
        self.invoice = invoice
        self.onDone = onDone
        _amountText = State(initialValue: PaymentText.field(InvoiceCredit.held(invoice)))
    }

    private var held: Double { InvoiceCredit.held(invoice) }
    private var amount: Double { PaymentText.amount(amountText) ?? 0 }
    private var valid: Bool { amount >= 1 && amount <= held + 0.5 }
    private var left: Double { max(0, held - amount) }

    var body: some View {
        NavigationStack {
            Form { Group {
                Section {
                    MoneyRow("Credit held", held)
                } header: {
                    LedgerHeading(title: "\(InvoiceActionWords.who(invoice))'s credit")
                }
                Section {
                    TextField("Amount (PKR)", text: $amountText.wholeRupees)
                        .keyboardType(.numberPad)
                        .font(.title2.weight(.semibold))
                        .monospacedDigit()
                    Picker("Paid by", selection: $method) {
                        Text("Cash").tag("Cash")
                        Text("Bank Transfer").tag("Bank Transfer")
                    }
                    .pickerStyle(.segmented)
                } header: {
                    LedgerHeading(title: "Give back")
                } footer: {
                    if amount > held + 0.5 {
                        Text("Only \(PaymentText.pkr(held)) is held.").foregroundStyle(Tone.problem.color)
                    } else if valid {
                        Text(left >= 1
                             ? "\(PaymentText.pkr(left)) stays as credit on the hisaab."
                             : "No credit is left, and its row on the hisaab goes. The sale is not refunded; it shows as money out in Today's cash.")
                    }
                }
                }
                .houseRows()
            }
            .houseForm()
            .scrollDismissesKeyboard(.interactively)
            .keyboardDone()
            .failureAlert($error)
            .navigationTitle("Give back credit")
            .navigationBarTitleDisplayMode(.inline)
            .disabled(saving)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView().controlSize(.small)
                    } else {
                        Button("Give back", role: .confirm) { Task { await save() } }
                            .disabled(!valid)
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(saving)
    }

    private func save() async {
        guard valid else { return }
        saving = true
        error = nil
        let given = min(amount, held)
        do {
            try UpdateGate.refuse()
            try await ERPAPI.shared.write("payBackCredit", [
                "invoiceId": invoice.id, "amount": given, "method": method, "seen": InvoiceActionWords.seen(invoice),
            ])
            let rest = max(0, held - given)
            onDone(InvoiceActionOutcome(
                note: InvoiceNote(title: "Credit given back",
                                  detail: "\(PaymentText.pkr(given)) by \(method)." + (rest >= 1 ? " \(PaymentText.pkr(rest)) credit left." : " No credit left.")),
                removed: false))
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}

/// The credit an invoice holds for a named customer (lib/invoice-credit.ts): none for a walk-in or a refunded invoice.
enum InvoiceCredit {
    static func held(_ inv: Invoice) -> Double {
        guard inv.status != .refunded, canHoldCredit(inv.customerId) else { return 0 }
        let line = balanceLine(inv.balanceDue)
        return line.state == .credit ? rupees(line.amount) : 0
    }
}
