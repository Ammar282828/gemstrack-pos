import SwiftUI
import ERPCore

/// Which way the money or metal went on a hand-written hisaab row: the ledger page's "You Gave" (a debit: they
/// owe the shop more) and "You Got" (a credit).
enum HisaabEntryMode: String, Identifiable {
    case gave, got

    var id: String { rawValue }

    var title: String { self == .gave ? "You gave" : "You got" }

    var tint: Color { self == .gave ? Tone.owed.color : Tone.settled.color }
}

/// "You gave" / "You got" on one person's ledger (src/app/hisaab/[entityId]/page.tsx `AddTransactionDialog`): a
/// description, and a cash amount and the house's metal in grams, one of which at least must be above 0. A customer's
/// dialog leads with the cash and a karigar's with the metal, as the web's does.
///
/// The ERP writes the row (`addHisaabEntry`, lib/writes/hisaab-entries.ts, the store's own): dated now and named as
/// the person is on file, so neither is asked for. The sheet stays open with the ERP's words if it refuses.
struct HisaabEntrySheet: View {
    let mode: HisaabEntryMode
    let personId: String
    let personName: String
    let isCustomer: Bool
    /// Told once the row is written.
    let onSaved: (Note) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var what = ""
    @State private var cashText = ""
    @State private var gramsText = ""
    @State private var saving = false
    @State private var error: String?

    /// The web's number boxes: digits and one dot, two decimals for cash and three for grams.
    private var cash: Double { MoneyParse.amount(cashText) ?? 0 }
    private var grams: Double { MoneyParse.amount(gramsText, maxDecimals: 3) ?? 0 }
    private var cleanedWhat: String { what.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var metal: String { MoneyWords.metal.capitalized }

    /// The dialog's schema: a description, and a cash amount or grams above 0.
    private var canSave: Bool { !cleanedWhat.isEmpty && (cash > 0 || grams > 0) && !saving }

    var body: some View {
        NavigationStack {
            Form { Group {
                Section {
                    TextField("Description", text: $what, prompt: Text("e.g. Cash payment received, Sample given"), axis: .vertical)
                        .lineLimit(2...4)
                } header: {
                    LedgerHeading(title: isCustomer ? "For the customer \(personName)" : "For the karigar \(personName)")
                }
                Section {
                    if isCustomer {
                        cashRow
                        gramsRow
                    } else {
                        gramsRow
                        cashRow
                    }
                    if cash > 0 { Text(Money.pkrLac(cash)).foregroundStyle(.secondary) }
                } header: {
                    LedgerHeading(title: mode == .gave ? "What you gave" : "What you got")
                } footer: {
                    Text("Dated today.")
                }
                }
                .houseRows()
            }
            .scrollDismissesKeyboard(.interactively)
            .keyboardDone()
            .disabled(saving)
            #if os(macOS)
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .background(Theme.ground)
            .frame(minWidth: 520, idealWidth: 580, minHeight: 360)
            #endif
            .navigationTitle(mode.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button(role: .confirm) { Task { await save() } }
                            .disabled(!canSave)
                            .keyboardShortcut("s", modifiers: .command)
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationSizing(.form)
        .interactiveDismissDisabled(saving)
        .failureAlert($error, title: "Could not save")
    }

    private var cashRow: some View {
        NewOrderNumberRow(title: "Cash amount (PKR)", text: $cashText, prompt: "0", rupees: true)
    }

    private var gramsRow: some View {
        NewOrderNumberRow(title: "\(metal) (grams)", text: $gramsText, prompt: "0", unit: "g")
    }

    @MainActor
    private func save() async {
        guard canSave else { return }
        saving = true
        error = nil
        let fields: [String: Any] = [
            "entityId": personId,
            "entityType": isCustomer ? "customer" : "karigar",
            "mode": mode.rawValue,
            "description": cleanedWhat,
            "amount": cash,
            "goldGrams": grams,
        ]
        do {
            try await ERPAPI.shared.write("addHisaabEntry", fields)
            onSaved(Note(title: "New hisaab entry added", detail: "\(mode.title): \(cleanedWhat)."))
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}
