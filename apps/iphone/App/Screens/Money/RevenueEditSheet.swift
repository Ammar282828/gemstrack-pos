import SwiftUI
import ERPCore

/// Add extra revenue, or Edit on a row: the revenue page's form (src/app/additional-revenue/page.tsx
/// RevenueForm). A date (not after today), a description and an amount of at least 0.01. The ERP writes
/// it (`addExtraRevenue` / `updateExtraRevenue`, lib/writes/expense-admin.ts); an edit changes those three
/// and keeps anything else on the row. Money taken on a repair is never edited here (its row opens the
/// ticket), and the ERP refuses it if asked. The sheet stays open with the ERP's own words if it refuses.
struct RevenueEditSheet: View {
    /// Nil adds a new entry.
    let editing: AdditionalRevenue?
    /// Told once it is saved: the web's toast.
    let onSaved: (OwnerNote) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var date: Date
    @State private var what: String
    @State private var amountText: String
    @State private var saving = false
    @State private var error: String?

    init(editing: AdditionalRevenue?, onSaved: @escaping (OwnerNote) -> Void) {
        self.editing = editing
        self.onSaved = onSaved
        _date = State(initialValue: editing.flatMap { ERPDate.parse($0.date) } ?? Date())
        _what = State(initialValue: editing?.description ?? "")
        _amountText = State(initialValue: editing.map { ExpenseEditing.typed($0.amount) } ?? "")
    }

    private var amount: Double { MoneyParse.amount(amountText) ?? 0 }
    private var cleanedWhat: String { what.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canSave: Bool { amount >= 0.01 && !cleanedWhat.isEmpty && !saving }

    var body: some View {
        NavigationStack {
            Form { Group {
                Section("When and what") {
                    DatePicker("Date", selection: $date, in: ...Date(), displayedComponents: .date)
                    TextField("Description, e.g. Commission from partner", text: $what, axis: .vertical)
                        .lineLimit(1...3)
                }
                Section("How much") {
                    TextField("Amount in rupees", text: $amountText)
                        .keyboardType(.decimalPad)
                        .font(.title2.weight(.semibold))
                        .monospacedDigit()
                    if amount > 0 { Text(Money.pkrLac(amount)).foregroundStyle(.secondary) }
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
                }
                .houseRows()
            }
            .navigationTitle(editing == nil ? "Add extra revenue" : "Edit extra revenue")
            .navigationBarTitleDisplayMode(.inline)
            .disabled(saving)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(role: .confirm) { Task { await save() } }
                        .disabled(!canSave)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(saving)
    }

    @MainActor
    private func save() async {
        saving = true
        error = nil
        do {
            if let row = editing {
                try await ERPAPI.shared.write("updateExtraRevenue", [
                    "revenueId": row.id,
                    "date": ExpenseEditing.dateText(picked: date, original: row.date),
                    "description": cleanedWhat,
                    "amount": amount,
                ])
                onSaved(OwnerNote(title: "Updated", detail: "Revenue entry updated."))
            } else {
                try await ERPAPI.shared.write("addExtraRevenue", [
                    "date": ERPDate.iso(date),
                    "description": cleanedWhat,
                    "amount": amount,
                ])
                onSaved(OwnerNote(title: "Added", detail: "Revenue entry added."))
            }
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}
