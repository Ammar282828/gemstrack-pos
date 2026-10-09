import SwiftUI
import ERPCore

/// New customer (src/components/customer/customer-form.tsx, add mode). The ERP's server takes a
/// name, number, email, address and source (`addCustomer`); the form's second number, city,
/// sizes, dates and notes are the ERP's own edit form, offered once they are saved.
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

    /// The web's `z.string().email()`, loosely: something, an @, something with a dot.
    private var emailOK: Bool {
        let e = CustomerKit.trim(email)
        if e.isEmpty { return true }
        let parts = e.split(separator: "@", omittingEmptySubsequences: false)
        return parts.count == 2 && !parts[0].isEmpty && parts[1].contains(".") && !e.contains(" ")
    }

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
            if saved == nil {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(!canSave)
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
        .navigationDestination(item: $editing) { target in
            WebScreen(path: CustomerKit.path(target.id, suffix: "/edit"))
        }
        .sensoryFeedback(.success, trigger: saved)
        .interactiveDismissDisabled(saving)
        .task { book.customers.need() }
    }

    // MARK: The form

    private var form: some View {
        Form { Group {
            Section {
                TextField("Full name", text: $name, prompt: Text("Optional"))
                    .textContentType(.name)
                    .textInputAutocapitalization(.words)
            } header: {
                Text("Name")
            } footer: {
                if walkIn {
                    Text("A walk-in is not a customer: a sale to nobody in particular is left without one.")
                        .foregroundStyle(.red)
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
            } header: {
                Text("Phone")
            }

            Section {
                TextField("Email address", text: $email, prompt: Text("Optional"))
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } header: {
                Text("Email")
            } footer: {
                if !emailOK { Text("That doesn't look like an email address.").foregroundStyle(.red) }
            }

            Section {
                TextField("Address", text: $address, prompt: Text("Optional"), axis: .vertical)
                    .lineLimit(2...5)
                    .textContentType(.fullStreetAddress)
            } header: {
                Text("Address")
            }

            Section {
                Picker("Referral source", selection: $source) {
                    Text("Not specified").tag("")
                    ForEach(CustomerKit.sources, id: \.rawValue) { s in
                        Text(CustomerKit.sourceLabel(s)).tag(s.rawValue)
                    }
                }
            } footer: {
                Text("Where they came from: used for walk-in and referral analytics.")
            }

            if let error {
                Section { Text(error).foregroundStyle(.red) }
            }
            }
            .houseRows()
        }
        .disabled(saving)
    }

    // MARK: Saved

    private func savedPage(_ s: Saved) -> some View {
        List {
            Section {
                VStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 48))
                        .foregroundStyle(.green)
                    Text("Saved").font(.title2.weight(.semibold))
                    Text("\(s.name) is on file.").foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .listRowBackground(Color.clear)
            }
            Section {
                if !s.id.isEmpty {
                    Button { editing = EditTarget(id: s.id) } label: {
                        Label("Add sizes, birthday and notes", systemImage: "ruler")
                    }
                }
                Button { startAnother() } label: {
                    Label("Add another customer", systemImage: "person.badge.plus")
                }
            } footer: {
                Text("Sizes, dates and notes are filled in on the ERP's own edit page.")
            }
        }
        .listStyle(.insetGrouped)
        .safeAreaInset(edge: .bottom) {
            if !s.id.isEmpty {
                Button { opened = s.id } label: {
                    Text("Open \(s.name)").frame(maxWidth: .infinity)
                }
                .buttonStyle(.houseProminent)
                .controlSize(.large)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
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
