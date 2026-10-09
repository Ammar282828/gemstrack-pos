import SwiftUI
import ERPCore

// "Save to <name>'s profile?" (order-form.tsx's size dialog, decisions.md "Sizes to the profile"): asked once,
// after the order is saved, for the sizes on its pieces that the customer's profile doesn't hold or holds
// differently. What is ticked is written with `setCustomerSizes`, which the browser's profile edit does too.

/// What is being asked: the customer, and the sizes on offer.
struct NewOrderSizeAsk: Identifiable {
    let id = UUID()
    let customerId: String
    let name: String
    let rows: [NewOrderSizeSuggestion]
}

struct NewOrderSizeAskSheet: View {
    let ask: NewOrderSizeAsk

    @Environment(\.dismiss) private var dismiss
    @State private var chosen: Set<String>
    @State private var saving = false
    @State private var failure: String?

    init(ask: NewOrderSizeAsk) {
        self.ask = ask
        _chosen = State(initialValue: Set(ask.rows.map { $0.id }))
    }

    private func isChosen(_ row: NewOrderSizeSuggestion) -> Binding<Bool> {
        Binding(
            get: { chosen.contains(row.id) },
            set: { on in
                if on { chosen.insert(row.id) } else { chosen.remove(row.id) }
            }
        )
    }

    private func words(_ row: NewOrderSizeSuggestion) -> String {
        if let current = row.current { return "The profile says \(current): this replaces it." }
        return "Not in the profile yet."
    }

    var body: some View {
        NavigationStack {
            List { Group {
                Section {
                    ForEach(ask.rows) { row in
                        Toggle(isOn: isChosen(row)) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(row.field.label): \(row.value)")
                                Text(words(row)).font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    }
                } footer: {
                    Text("So the size is there next time, on any order or sale for them.")
                }
                if let failure {
                    Section { Text(failure).foregroundStyle(.red) }
                }
                }
                .houseRows()
            }
            .navigationTitle("Save to \(ask.name)'s profile?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Not now") { dismiss() }.disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save to profile") { Task { await save() } }
                        .disabled(chosen.isEmpty || saving)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(saving)
    }

    private func save() async {
        saving = true
        failure = nil
        defer { saving = false }
        let picked = ask.rows.filter { chosen.contains($0.id) }
        do {
            try await ERPAPI.shared.write("setCustomerSizes", NewOrderSizes.request(customerId: ask.customerId, chosen: picked))
            dismiss()
        } catch {
            failure = error.localizedDescription
        }
    }
}
