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
    /// A swipe asks first: customers pay into these accounts.
    @State private var removing: IndexSet?
    /// The list as the person has left it, until the book answers with it.
    @State private var shown: [BankAccountDraft]?

    private var accounts: [BankAccountDraft] { shown ?? settings.paymentMethods.map { BankAccountDraft($0) } }

    var body: some View {
        #if os(macOS)
        macBody
        #else
        phoneBody
        #endif
    }

    @ViewBuilder
    private var phoneBody: some View {
        Form { Group {
            Section {
                ForEach(accounts) { a in
                    Button { editing = a } label: {
                        TwoLine(title: a.bankName, subtitle: [a.accountName, a.accountNumber].filter { !$0.isEmpty }.joined(separator: " · "))
                            .foregroundStyle(.primary)
                    }
                }
                .onDelete { offsets in removing = offsets }
            } footer: {
                Text("Shared with customers who pay by transfer.")
            }
            }
            .houseRows()
        }
        .overlay {
            if accounts.isEmpty {
                EmptyState("No bank accounts yet", symbol: "building.columns",
                           message: "Add one to share it with customers who pay by transfer.",
                           action: (title: "Add account", run: { editing = BankAccountDraft.new() }))
            }
        }
        .settingsFailure(writer)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { editing = BankAccountDraft.new() } label: { Label("Add account", systemImage: "plus") }
            }
        }
        .confirmationDialog(removingTitle(accounts), isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
                            titleVisibility: .visible) {
            Button("Remove", role: .destructive) {
                guard let offsets = removing else { return }
                var next = accounts
                next.remove(atOffsets: offsets)
                removing = nil
                Task { _ = await write(next) }
            }
            Button("Cancel", role: .cancel) { removing = nil }
        } message: {
            Text("Customers paying by transfer will no longer be shown it.")
        }
        .sheet(item: $editing) { draft in
            BankAccountSheet(draft: draft, isNew: !accounts.contains { $0.id == draft.id }) { saved in
                var next = accounts
                if let i = next.firstIndex(where: { $0.id == saved.id }) { next[i] = saved } else { next.append(saved) }
                return await write(next)
            }
            .presentationSizing(.form)
        }
        .onChange(of: settings) { _, _ in
            shown = nil
            writer.settled()
        }
    }

    /// Nil when the ERP took the list, else its words.
    private func removingTitle(_ accounts: [BankAccountDraft]) -> String {
        guard let offsets = removing else { return "Remove this account?" }
        let names = offsets.compactMap { accounts.indices.contains($0) ? accounts[$0].bankName : nil }.filter { !$0.isEmpty }
        return names.count == 1 ? "Remove \(names[0])?" : "Remove these accounts?"
    }

    private func write(_ next: [BankAccountDraft]) async -> String? {
        shown = next
        writer.queue(["paymentMethods": next.map(\.stored)], label: "Bank accounts")
        return nil
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
        #if os(macOS)
        macBody
        #else
        phoneBody
        #endif
    }

    @ViewBuilder
    private var phoneBody: some View {
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

                }
                .houseRows()
            }
            .modifier(HouseGround())
            .scrollDismissesKeyboard(.interactively)
            .keyboardDone()
            .failureAlert($error, title: "Not saved")
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
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(saving)
    }
}

#if os(macOS)
extension BankAccountsForm {
    /// The accounts as a table (what a window is for), with Add in the toolbar, Edit and Remove on the right-click menu
    /// and the Delete key, and a double-click to edit. The add/edit sheet is a Mac sheet.
    @ViewBuilder
    fileprivate var macBody: some View {
        MacBankAccountsTable(accounts: accounts, onAdd: { editing = BankAccountDraft.new() },
                             onEdit: { id in editing = accounts.first { $0.id == id } },
                             onRemove: { ids in
                                 let at = IndexSet(accounts.indices.filter { ids.contains(accounts[$0].id) })
                                 if !at.isEmpty { removing = at }
                             })
        .settingsFailure(writer)
        .confirmationDialog(removingTitle(accounts), isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
                            titleVisibility: .visible) {
            Button("Remove", role: .destructive) {
                guard let offsets = removing else { return }
                var next = accounts
                next.remove(atOffsets: offsets)
                removing = nil
                Task { _ = await write(next) }
            }
            Button("Cancel", role: .cancel) { removing = nil }
        } message: {
            Text("Customers paying by transfer will no longer be shown it.")
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
}

private struct MacBankAccountsTable: View {
    let accounts: [BankAccountDraft]
    let onAdd: () -> Void
    let onEdit: (String) -> Void
    let onRemove: (Set<String>) -> Void
    @State private var selection = Set<String>()

    var body: some View {
        VStack(spacing: 0) {
            Table(accounts, selection: $selection) {
                TableColumn("Bank") { (a: BankAccountDraft) in Text(a.bankName).fontWeight(.medium).lineLimit(1) }
                    .width(min: 120, ideal: 200)
                TableColumn("Account name") { (a: BankAccountDraft) in Text(a.accountName).lineLimit(1) }
                    .width(min: 100, ideal: 160)
                TableColumn("Account number") { (a: BankAccountDraft) in Text(a.accountNumber).monospacedDigit().lineLimit(1) }
                    .width(min: 100, ideal: 140)
                TableColumn("IBAN") { (a: BankAccountDraft) in
                    Text(a.iban).monospacedDigit().lineLimit(1).foregroundStyle(.secondary)
                }
                .width(min: 120, ideal: 200)
            }
            .contextMenu(forSelectionType: String.self) { ids in
                if ids.count == 1, let id = ids.first {
                    Button("Edit…", systemImage: "pencil") { onEdit(id) }
                }
                if !ids.isEmpty {
                    Button("Remove…", systemImage: "trash", role: .destructive) { onRemove(ids) }
                }
            } primaryAction: { ids in
                if ids.count == 1, let id = ids.first { onEdit(id) }
            }
            .onDeleteCommand { if !selection.isEmpty { onRemove(selection) } }
            .overlay {
                if accounts.isEmpty {
                    EmptyState("No bank accounts yet", symbol: "building.columns",
                               message: "Add one to share it with customers who pay by transfer.",
                               action: (title: "Add account", run: onAdd))
                }
            }
            Divider()
            Text("Shared with customers who pay by transfer. Double-click an account to change it.")
                .font(.footnote).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20).padding(.vertical, 8)
        }
        .background(Theme.ground)
        .toolbar {
            // Add and Remove; changing an account is a double-click or the right-click menu (a Settings pane's toolbar is short).
            ToolbarItemGroup(placement: .primaryAction) {
                Button(action: onAdd) { Label("Add account", systemImage: "plus") }
                    .help("Add a bank account")
                Button { onRemove(selection) } label: { Label("Remove", systemImage: "trash") }
                    .disabled(selection.isEmpty)
                    .help("Remove the selected account")
            }
        }
    }
}

extension BankAccountSheet {
    /// A Mac sheet: the fields as a grouped form, Cancel (Esc) and Save (Return) in the footer.
    @ViewBuilder
    fileprivate var macBody: some View {
        VStack(spacing: 0) {
            Text(isNew ? "New bank account" : "Bank account")
                .font(.headline).frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20).padding(.top, 16)
            Form {
                Section {
                    TextField("Bank", text: $draft.bankName)
                    Picker("Choose from the list", selection: Binding(get: { "" }, set: { if !$0.isEmpty { draft.bankName = $0 } })) {
                        Text("Choose…").tag("")
                        ForEach(Self.banks, id: \.self) { Text($0).tag($0) }
                    }
                    TextField("Account name", text: $draft.accountName)
                    TextField("Account number", text: $draft.accountNumber)
                    TextField("IBAN", text: $draft.iban, prompt: Text("Optional"))
                        .autocorrectionDisabled()
                } footer: {
                    Text("The bank, the account name and the number are needed.")
                }
            }
            .formStyle(.grouped)
            .onSubmit { if draft.valid { commit() } }
            MacSheetFooter(confirm: "Save", busy: saving, disabled: !draft.valid, onCancel: { dismiss() }, onConfirm: commit)
        }
        .frame(minWidth: 520, idealWidth: 560, minHeight: 400)
        .failureAlert($error, title: "Not saved")
        .interactiveDismissDisabled(saving)
    }

    private func commit() {
        Task {
            saving = true
            error = nil
            if let said = await save(draft) { error = said } else { dismiss() }
            saving = false
        }
    }
}
#endif
