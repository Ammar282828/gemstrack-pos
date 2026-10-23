import SwiftUI
import ERPCore

/// New customer (src/components/customer/customer-form.tsx, add mode). The ERP's server takes a
/// name, number, email, address and source (`addCustomer`); the form's second number, city,
/// sizes, dates and notes are the edit form's (EditCustomer), offered once they are saved.
///
/// Like the web form, a name is optional: left blank it becomes "Customer - <number>", or
/// "Unnamed Customer" (the server refuses a nameless customer). Unlike a sale, this never makes a
/// walk-in a customer (lib/walk-in.ts): that placeholder is the absence of one.
///
/// After saving, the form is replaced by a "Saved" page that opens the new customer's page with
/// one tap (a push, so Back returns to it), because this screen can be a sheet (New customer, above
/// the tab bar) or a pushed page (Customers' plus), and dismissing would be wrong for the second.
struct AddCustomer: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var phone = ""
    @State private var email = ""
    @State private var address = ""
    /// A `CUSTOMER_SOURCES` word, or "" for not specified.
    @State private var source = ""
    @State private var saving = false
    @State private var error: String?
    @State private var saved: Saved?
    /// The customer page to push (the one just saved, or the one already on file under this number).
    @State private var opened: String?
    @State private var editing: EditTarget?

    init() {}

    /// Its own type, so the two pushes below are plainly two destinations.
    private struct EditTarget: Hashable { let id: String }

    private struct Saved: Equatable {
        let id: String
        let name: String
        let customer: Customer?
    }

    // MARK: What can be saved

    private var nameToSave: String {
        let n = CustomerKit.trim(name)
        if !n.isEmpty { return n }
        let p = CustomerKit.trim(phone)
        return p.isEmpty ? "Unnamed Customer" : "Customer - \(p)"
    }

    private var walkIn: Bool { !shouldCreateCustomer(id: nil, name: nameToSave) }

    private var emailOK: Bool { CustomerKit.validEmail(email) }

    private var canSave: Bool { !saving && !walkIn && emailOK }

    /// A number already on file is that customer (lib/walk-in.ts), but two people can share a phone: a hint, not a block.
    private var sameNumber: Customer? {
        let key = phoneKey(phone)
        if key.isEmpty { return nil }
        return book.customers.items.first { c in
            !CustomerKit.isRemoved(c) && !isWalkInName(c.name) && phoneKey(c.phone) == key
        }
    }

    // MARK: Body

    var body: some View {
        Group {
            if let saved {
                savedPage(saved)
            } else {
                form
            }
        }
        .navigationTitle(saved == nil ? "New customer" : "Saved")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // No Cancel of its own: the sheet's Close or the pushed page's Back already leaves, and a second
            // way out stood beside each of them.
            if saved == nil {
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await save() } } label: {
                        if saving { ProgressView() } else { Text("Save") }
                    }
                    .disabled(!canSave)
                    .keyboardShortcut("s", modifiers: .command)
                }
            }
            if saved != nil {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        // Local, so they work in a sheet's own stack as well as a tab's.
        .navigationDestination(item: $opened) { customerId in
            CustomerScreen(id: customerId, seed: saved?.customer)
        }
        // The edit form, over the customer just saved: the shelf may not have them yet, so they come along.
        .navigationDestination(item: $editing) { target in
            EditCustomer(id: target.id, seed: saved?.customer)
        }
        .sensoryFeedback(.success, trigger: saved)
        .interactiveDismissDisabled(saving)
        .failureAlert($error, title: "Could not save")
        .task { book.customers.need() }
    }

    // MARK: The form

    private var form: some View {
        Form { Group {
            Section {
                TextField("Full name", text: $name, prompt: Text("Optional"))
                    .autocorrectionDisabled()
                    .textContentType(.name)
                    .textInputAutocapitalization(.words)
            } footer: {
                if walkIn {
                    Text("A walk-in is not a customer: a sale to nobody in particular is left without one.")
                        .foregroundStyle(Tone.problem.color)
                }
            }

            Section {
                TextField("Phone number", text: $phone, prompt: Text("Optional"))
                    .keyboardType(.phonePad)
                    .textContentType(.telephoneNumber)
                if let match = sameNumber {
                    Button {
                        opened = match.id
                    } label: {
                        Label("Already on file: \(CustomerKit.shown(match))", systemImage: "person.fill.checkmark")
                    }
                }
            }

            Section {
                TextField("Email address", text: $email, prompt: Text("Optional"))
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } footer: {
                if !emailOK { Text("That doesn't look like an email address.").foregroundStyle(Tone.problem.color) }
            }

            Section {
                TextField("Address", text: $address, prompt: Text("Optional"), axis: .vertical)
                    .lineLimit(2...5)
                    .textContentType(.fullStreetAddress)
            }

            Section {
                Picker("Referral source", selection: $source) {
                    Text("Not specified").tag("")
                    ForEach(CustomerKit.sources, id: \.rawValue) { s in
                        Text(CustomerKit.sourceLabel(s)).tag(s.rawValue)
                    }
                }
            }

            }
            .houseRows()
        }
        .scrollDismissesKeyboard(.interactively)
        .keyboardDone()
        .disabled(saving)
    }

    // MARK: Saved

    private func savedPage(_ s: Saved) -> some View {
        List {
            Section {
                VStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.largeTitle)
                        .imageScale(.large)
                        .foregroundStyle(Tone.settled.color)
                    Text("Saved").font(.title2.weight(.semibold))
                    Text("\(s.name) is on file.").foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .listRowBackground(Color.clear)
            }
            Section {
                // Editing a profile is an owner's (the shop floor has no write to it, in the ERP or here).
                if !s.id.isEmpty && session.isOwner {
                    Button { editing = EditTarget(id: s.id) } label: {
                        Label("Add sizes, birthday and notes", systemImage: "ruler")
                    }
                }
                Button { startAnother() } label: {
                    Label("Add another customer", systemImage: "person.badge.plus")
                }
            } footer: {
                if session.isOwner {
                    Text("The second number, city, sizes, dates and notes are filled in on the edit page.")
                }
            }
        }
        .listStyle(.insetGrouped)
        .modifier(OpenBar(show: !s.id.isEmpty, title: "Open \(s.name)") { opened = s.id })
    }

    /// The saved page's one action, pinned; absent when the server gave no id to open.
    private struct OpenBar: ViewModifier {
        let show: Bool
        let title: String
        let open: () -> Void
        func body(content: Content) -> some View {
            if show {
                content.actionBar(primary: ActionBar.Action(title, action: open))
            } else {
                content
            }
        }
    }

    private func startAnother() {
        name = ""
        phone = ""
        email = ""
        address = ""
        source = ""
        error = nil
        saved = nil
    }

    // MARK: Save

    private func save() async {
        guard canSave else { return }
        saving = true
        error = nil
        var fields: [String: Any] = ["name": nameToSave]
        if let v = CustomerKit.filled(phone) { fields["phone"] = v }
        if let v = CustomerKit.filled(email) { fields["email"] = v }
        if let v = CustomerKit.filled(address) { fields["address"] = v }
        if !source.isEmpty { fields["source"] = source }
        do {
            let out = try await ERPAPI.shared.write("addCustomer", fields)
            let doc = out["customer"] as? [String: Any]
            let newId = doc?["id"] as? String ?? ""
            let made: Customer? = newId.isEmpty ? nil : DocJSON.decode(Customer.self, id: newId, data: doc ?? [:])
            saved = Saved(id: newId, name: made?.name ?? nameToSave, customer: made)
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}
