import SwiftUI
import ERPCore

/// Edit customer (src/app/customers/[id]/edit/page.tsx, components/customer/customer-form.tsx in edit mode):
/// every field the web form has, the name, both numbers, email, address, city and country, the four sizes,
/// the birthday and anniversary, preferences, notes and the referral source.
///
/// Saving is `updateCustomer` (owners only, as the browser's direct write is): the ERP checks the fields as the
/// web form does, makes the numbers E.164, merges them into the profile and writes "Updated customer" to the
/// activity log. Only what was changed is sent, so a field this form cannot show faithfully (an old import's
/// date written another way, the tags, the Shopify id) is never overwritten with a blank. A name left blank
/// becomes "Customer - <number>", or "Unnamed Customer", which the ERP does with the number it normalised.
///
/// A rename changes this one profile, as in the browser: invoices, orders and hisaab rows keep the name they
/// were written with. After saving the screen goes back; the book brings the change in by itself.
struct EditCustomer: View {
    let id: String
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    /// A customer just made on this phone, shown until the shelf brings them (staff poll every 25 seconds).
    private let seed: Customer?

    init(id: String, seed: Customer? = nil) {
        self.id = id
        self.seed = seed
    }

    // `items`, not `item(_:)`: the shelf's lookup is not observed (as CustomerScreen).
    private var customer: Customer? { book.customers.items.first { $0.id == id } ?? seed }

    var body: some View {
        ShelfState(loaded: seed != nil || book.customers.loaded, error: book.customers.error, offline: book.customers.offline) {
            if !session.isOwner {
                ContentUnavailableView("Only an owner can change a customer", systemImage: "lock", description: Text("Ask an owner to make the change."))
            } else if let c = customer, !CustomerKit.isRemoved(c) {
                EditCustomerForm(customer: c)
            } else {
                ContentUnavailableView("Customer not found", systemImage: "person.crop.circle.badge.questionmark",
                                       description: Text("They may have been removed. Settings, Recently removed puts them back."))
            }
        }
        .navigationTitle("Edit customer")
        .navigationBarTitleDisplayMode(.inline)
        .task { book.customers.need() }
    }
}

/// What is typed, as text, from the profile on file. Dates are the ERP's "yyyy-mm-dd", or "" for none.
private struct CustomerDraft: Equatable {
    var name = ""
    var phone = ""
    var altPhone = ""
    var email = ""
    var address = ""
    var city = ""
    var country = ""
    /// A `CUSTOMER_SOURCES` word, or "" for not specified.
    var source = ""
    var ringSize = ""
    var bangleSize = ""
    var braceletSize = ""
    var chainLength = ""
    var birthday = ""
    var anniversary = ""
    var preference = ""
    var notes = ""

    init(_ c: Customer) {
        name = c.name
        phone = c.phone ?? ""
        altPhone = c.altPhone ?? ""
        email = c.email ?? ""
        address = c.address ?? ""
        city = c.city ?? ""
        country = c.country ?? ""
        source = c.source?.rawValue ?? ""
        ringSize = c.ringSize ?? ""
        bangleSize = c.bangleSize ?? ""
        braceletSize = c.braceletSize ?? ""
        chainLength = c.chainLength ?? ""
        birthday = c.birthday ?? ""
        anniversary = c.anniversary ?? ""
        preference = c.preference ?? ""
        notes = c.notes ?? ""
    }
}

private struct EditCustomerForm: View {
    let customer: Customer
    @Environment(\.dismiss) private var dismiss

    @State private var draft: CustomerDraft
    @State private var saving = false
    @State private var error: String?

    /// The form opens on the profile as it is when this screen is made, once: a change arriving from the book
    /// meanwhile must not throw away what is being typed.
    init(customer: Customer) {
        self.customer = customer
        _draft = State(initialValue: CustomerDraft(customer))
    }

    // MARK: What can be saved

    /// What differs from the profile on file, as `updateCustomer` takes it. A field left as it was is not sent.
    private var patch: [String: String] {
        var out: [String: String] = [:]
        func put(_ key: String, _ now: String, _ was: String?) {
            let n = CustomerKit.trim(now)
            if n != CustomerKit.trim(was) { out[key] = n }
        }
        put("name", draft.name, customer.name)
        put("phone", draft.phone, customer.phone)
        put("altPhone", draft.altPhone, customer.altPhone)
        put("email", draft.email, customer.email)
        put("address", draft.address, customer.address)
        put("city", draft.city, customer.city)
        put("country", draft.country, customer.country)
        put("source", draft.source, customer.source?.rawValue)
        put("ringSize", draft.ringSize, customer.ringSize)
        put("bangleSize", draft.bangleSize, customer.bangleSize)
        put("braceletSize", draft.braceletSize, customer.braceletSize)
        put("chainLength", draft.chainLength, customer.chainLength)
        put("birthday", draft.birthday, customer.birthday)
        put("anniversary", draft.anniversary, customer.anniversary)
        put("preference", draft.preference, customer.preference)
        put("notes", draft.notes, customer.notes)
        // A blank name is named after the number: the ERP needs the number to say it, changed or not.
        if out["name"] == "" { out["phone"] = CustomerKit.trim(draft.phone) }
        return out
    }

    private var emailOK: Bool { CustomerKit.validEmail(draft.email) }

    private var canSave: Bool { !saving && emailOK && !patch.isEmpty }

    // MARK: Body

    var body: some View {
        Form { Group {
            nameSection
            phoneSection
            emailSection
            addressSection
            sizesSection
            datesSection
            aboutSection
            sourceSection
            if let error {
                Section { Text(error).foregroundStyle(.red) }
            }
            }
            .houseRows()
        }
        .disabled(saving)
        .scrollDismissesKeyboard(.interactively)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { Task { await save() } }
                    .disabled(!canSave)
            }
        }
    }

    private var nameSection: some View {
        Section {
            TextField("Full name", text: $draft.name, prompt: Text("Optional"))
                .textContentType(.name)
                .textInputAutocapitalization(.words)
        } header: {
            Text("Name")
        }
    }

    private var phoneSection: some View {
        Section {
            TextField("Phone number", text: $draft.phone, prompt: Text("Optional"))
                .keyboardType(.phonePad)
                .textContentType(.telephoneNumber)
            TextField("Second number", text: $draft.altPhone, prompt: Text("Optional"))
                .keyboardType(.phonePad)
        } header: {
            Text("Phone")
        } footer: {
            Text("The spare slot. A contact import fills this rather than overwriting the number above.")
        }
    }

    private var emailSection: some View {
        Section {
            TextField("Email address", text: $draft.email, prompt: Text("Optional"))
                .keyboardType(.emailAddress)
                .textContentType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        } header: {
            Text("Email")
        } footer: {
            if !emailOK { Text("That doesn't look like an email address.").foregroundStyle(.red) }
        }
    }

    private var addressSection: some View {
        Section {
            TextField("Address", text: $draft.address, prompt: Text("Optional"), axis: .vertical)
                .lineLimit(2...5)
                .textContentType(.fullStreetAddress)
            TextField("City", text: $draft.city, prompt: Text("e.g. Karachi"))
            TextField("Country", text: $draft.country, prompt: Text("e.g. Pakistan"))
        } header: {
            Text("Address")
        }
    }

    private var sizesSection: some View {
        Section {
            sizeRow("Ring", $draft.ringSize, example: "e.g. 12.5")
            sizeRow("Bangle", $draft.bangleSize, example: "e.g. 2.6")
            sizeRow("Bracelet", $draft.braceletSize, example: "e.g. 7 in")
            sizeRow("Chain", $draft.chainLength, example: "e.g. 18 in")
        } header: {
            Text("Sizes")
        } footer: {
            Text("What the shop needs before it can make anything. Written the way it is quoted at the counter, not forced into a number.")
        }
    }

    private func sizeRow(_ title: String, _ text: Binding<String>, example: String) -> some View {
        LabeledContent(title) {
            TextField("\(title) size", text: text, prompt: Text(example))
                .multilineTextAlignment(.trailing)
        }
    }

    private var datesSection: some View {
        Section {
            EditDayRow(title: "Birthday", day: $draft.birthday)
            EditDayRow(title: "Anniversary", day: $draft.anniversary)
        } header: {
            Text("Dates")
        } footer: {
            Text("What the dashboard watches for, so a regular gets a message before the day rather than after it.")
        }
    }

    private var aboutSection: some View {
        Section {
            TextField("Preferences", text: $draft.preference, prompt: Text("e.g. no rose gold, prefers heavier sets"), axis: .vertical)
                .lineLimit(1...3)
            TextField("Notes", text: $draft.notes, prompt: Text("Anything worth remembering"), axis: .vertical)
                .lineLimit(3...8)
        } header: {
            Text("Preferences and notes")
        }
    }

    private var sourceSection: some View {
        Section {
            Picker("Referral source", selection: $draft.source) {
                Text("Not specified").tag("")
                ForEach(CustomerKit.sources, id: \.rawValue) { s in
                    Text(CustomerKit.sourceLabel(s)).tag(s.rawValue)
                }
                // A word the app does not know (written by something else) stays choosable, so it is not lost.
                if let raw = customer.source?.rawValue, !CustomerKit.sources.contains(where: { $0.rawValue == raw }) {
                    Text(raw).tag(raw)
                }
            }
        } footer: {
            Text("Where they came from: used for walk-in and referral analytics.")
        }
    }

    // MARK: Save

    private func save() async {
        guard canSave else { return }
        saving = true
        error = nil
        do {
            try await ERPAPI.shared.write("updateCustomer", ["customerId": customer.id, "patch": patch])
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}

/// An optional date, as the web's date input: nothing yet, or a day to change or take off. Karachi's day.
private struct EditDayRow: View {
    let title: String
    @Binding var day: String

    var body: some View {
        if day.isEmpty {
            Button { day = EditDay.string(Date()) } label: {
                Label("Add \(title.lowercased())", systemImage: "plus.circle")
            }
        } else if let date = EditDay.date(day) {
            DatePicker(title, selection: Binding(get: { date }, set: { day = EditDay.string($0) }), displayedComponents: .date)
                .environment(\.timeZone, ERPDate.karachi)
            Button(role: .destructive) { day = "" } label: {
                Text("Remove \(title.lowercased())")
            }
        } else {
            // Written another way by an old import: shown as it is, until a day is set in its place.
            LabeledContent(title) { Text(day).foregroundStyle(.secondary) }
            Button { day = EditDay.string(Date()) } label: {
                Text("Set \(title.lowercased())")
            }
            Button(role: .destructive) { day = "" } label: {
                Text("Remove \(title.lowercased())")
            }
        }
    }
}

/// "yyyy-MM-dd" and the midnight it starts in Karachi, so the day picked is the day saved.
private enum EditDay {
    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = ERPDate.karachi
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func string(_ d: Date) -> String { formatter.string(from: d) }

    /// The day in the first ten characters ("1990-06-30", or an instant written "1990-06-30T…"); nil if there is none.
    static func date(_ s: String) -> Date? { s.count >= 10 ? formatter.date(from: String(s.prefix(10))) : nil }
}
