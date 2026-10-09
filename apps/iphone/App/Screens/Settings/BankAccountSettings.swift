import SwiftUI
import ERPCore

/// Settings → Bank accounts (src/app/settings/payment-methods): the accounts shared with customers
/// who pay by transfer. Added, changed and removed here; the web's QR code and "Send to customer"
/// stay on its page. Saved as the whole list, in the shape the web stores.
struct BankAccountSettings: View {
    var body: some View {
        SettingsGate(title: "Bank accounts") { BankAccountsForm(settings: $0) }
    }
}

/// One account being typed. `id` is the stored one (the web's `pm-<time>`).
struct BankAccountDraft: Identifiable, Equatable {
    var id: String
    var bankName = ""
    var accountName = ""
    var accountNumber = ""
    var iban = ""

    init(id: String) { self.id = id }

    init(_ m: PaymentMethod) {
        id = m.id
        bankName = m.bankName
        accountName = m.accountName
        accountNumber = m.accountNumber
        iban = m.iban ?? ""
    }

    static func new() -> BankAccountDraft {
        BankAccountDraft(id: "pm-\(Int(Date().timeIntervalSince1970 * 1000))")
    }

    var valid: Bool {
        !bankName.trimmed.isEmpty && !accountName.trimmed.isEmpty && !accountNumber.trimmed.isEmpty
    }

    /// As the ERP keeps it: an empty IBAN is left out.
    var stored: [String: Any] {
        var d: [String: Any] = ["id": id, "bankName": bankName.trimmed, "accountName": accountName.trimmed, "accountNumber": accountNumber.trimmed]
        if !iban.trimmed.isEmpty { d["iban"] = iban.trimmed }
        return d
    }
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}

private struct BankAccountsForm: View {
    let settings: Settings
    @State private var writer = SettingsWriter()
    @State private var editing: BankAccountDraft?
    /// The list as the person has left it, until the book answers with it.
    @State private var shown: [BankAccountDraft]?

    private var accounts: [BankAccountDraft] { shown ?? settings.paymentMethods.map { BankAccountDraft($0) } }

    var body: some View {
        Form { Group {
            Section {
                if accounts.isEmpty {
                    Text("No bank accounts yet").foregroundStyle(.secondary)
                }
                ForEach(accounts) { a in
                    Button { editing = a } label: {
                        TwoLine(title: a.bankName, subtitle: [a.accountName, a.accountNumber].filter { !$0.isEmpty }.joined(separator: " · "))
                            .foregroundStyle(.primary)
                    }
                }
                .onDelete { offsets in
                    var next = accounts
                    next.remove(atOffsets: offsets)
                    Task { _ = await write(next) }
                }
            } footer: {
                Text("Shared with customers who pay by transfer.")
            }

            SettingsErrorSection(writer: writer)
            }
            .houseRows()
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { editing = BankAccountDraft.new() } label: { Label("Add account", systemImage: "plus") }
            }
        }
        .sheet(item: $editing) { draft in
            BankAccountSheet(draft: draft, isNew: !accounts.contains { $0.id == draft.id }) { saved in
                var next = accounts
                if let i = next.firstIndex(where: { $0.id == saved.id }) { next[i] = saved } else { next.append(saved) }
                return await write(next)
            }
        }
        .onChange(of: settings) { _, _ in
            shown = nil
            writer.settled()
        }
    }

    /// Nil when the ERP took the list, else its words.
    private func write(_ next: [BankAccountDraft]) async -> String? {
        let before = shown
        shown = next
        let ok = await writer.save(["paymentMethods": next.map(\.stored)])
        if ok { return nil }
        shown = before
        return writer.error ?? "Not saved."
    }
}

private struct BankAccountSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var draft: BankAccountDraft
    let isNew: Bool
    let save: (BankAccountDraft) async -> String?
    @State private var saving = false
    @State private var error: String?

    init(draft: BankAccountDraft, isNew: Bool, save: @escaping (BankAccountDraft) async -> String?) {
        _draft = State(initialValue: draft)
        self.isNew = isNew
        self.save = save
    }

    private static let banks = [
        "Al Baraka Bank (Pakistan) Limited", "Allied Bank Limited", "Askari Bank", "Bank Alfalah", "Bank Al-Habib",
        "BankIslami Pakistan", "Bank of Khyber", "Bank of Punjab", "Dubai Islamic Bank", "Faysal Bank", "First Women Bank",
        "Habib Bank Limited (HBL)", "Habib Metropolitan Bank", "Industrial and Commercial Bank of China", "JS Bank",
        "MCB Bank", "MCB Islamic Bank", "Meezan Bank", "National Bank of Pakistan", "Samba Bank", "Silkbank Limited",
        "Sindh Bank", "Soneri Bank", "Standard Chartered Bank (Pakistan)", "Summit Bank", "United Bank Limited (UBL)",
        "Zarai Taraqiati Bank Limited",
    ]

    var body: some View {
        NavigationStack {
            Form { Group {
                Section {
                    LabeledContent("Bank") {
                        TextField("Bank", text: $draft.bankName).multilineTextAlignment(.trailing)
                    }
                    Menu("Choose from the list") {
                        ForEach(Self.banks, id: \.self) { b in
                            Button(b) { draft.bankName = b }
                        }
                    }
                    LabeledContent("Account name") {
                        TextField("Account name", text: $draft.accountName).multilineTextAlignment(.trailing)
                    }
                    LabeledContent("Account number") {
                        TextField("Account number", text: $draft.accountNumber)
                            .keyboardType(.numbersAndPunctuation)
                            .multilineTextAlignment(.trailing)
                    }
                    LabeledContent("IBAN") {
                        TextField("Optional", text: $draft.iban)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .multilineTextAlignment(.trailing)
                    }
                } footer: {
                    Text("The bank, the account name and the number are needed.")
                }

                if let error {
                    Section { Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
                }
                }
                .houseRows()
            }
            .navigationTitle(isNew ? "New bank account" : "Bank account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            saving = true
                            error = nil
                            if let said = await save(draft) { error = said } else { dismiss() }
                            saving = false
                        }
                    }
                    .disabled(saving || !draft.valid)
                }
            }
        }
        .presentationDetents([.large])
    }
}
