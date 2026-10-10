import SwiftUI
import ERPCore

/// New karigar and edit karigar (src/app/karigars/add/page.tsx, src/app/karigars/[id]/edit,
/// components/karigar/karigar-form.tsx): one form for both. The name (required), the contact number, the
/// Google login, the specialty, a second number, the workshop, the city, the address and notes.
///
/// Saving is `addKarigar` or `updateKarigar` (owners only, as the browser's direct write is): the ERP checks the
/// fields as the web form does, keeps the login email in lower case (it is matched against the Google account's
/// address on every karigar-portal request), makes the contact number E.164 and writes "Created karigar" or
/// "Updated karigar" to the activity log. A new karigar is sent whole, as the web form sends it; an edit sends only
/// what was changed, so a field this form does not show (the country) is never touched.
///
/// A rename changes this one karigar, as in the browser: his jobs, given items and hisaab rows keep the name they
/// were written with. After saving the screen goes back; the book brings the change in by itself.
struct KarigarForm: View {
    /// The karigar being edited, or nil for a new one.
    let id: String?
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    init(id: String? = nil) {
        self.id = id
    }

    var body: some View {
        Group {
            if !session.isOwner {
                ContentUnavailableView("Only an owner can change a karigar", systemImage: "lock", description: Text("Ask an owner to make the change."))
            } else if let id {
                editing(id)
            } else {
                KarigarFormBody(karigar: nil)
            }
        }
        .navigationTitle(id == nil ? "New karigar" : "Edit karigar")
        .navigationBarTitleDisplayMode(.inline)
        .modifier(HouseGround())
        .task { book.karigars.need() }
    }

    private func editing(_ id: String) -> some View {
        ShelfState(loaded: book.karigars.loaded, error: book.karigars.error, offline: book.karigars.offline) {
            // `items`, not `item(_:)`: the shelf's lookup is not observed.
            if let k = book.karigars.items.first(where: { $0.id == id }), (k.deletedAt ?? "").isEmpty {
                KarigarFormBody(karigar: k)
            } else {
                ContentUnavailableView("Karigar not found", systemImage: "person.crop.circle.badge.questionmark",
                                       description: Text("They may have been removed. Settings, Recently removed puts them back."))
            }
        }
    }
}

/// What is typed, as text, from the karigar on file (or nothing, for a new one).
private struct KarigarDraft: Equatable {
    var name = ""
    var contact = ""
    var email = ""
    var specialty = ""
    var altPhone = ""
    var workshop = ""
    var city = ""
    var address = ""
    var notes = ""

    init(_ k: Karigar?) {
        guard let k else { return }
        name = k.name
        contact = k.contact ?? ""
        email = k.email ?? ""
        specialty = k.specialty ?? ""
        altPhone = k.altPhone ?? ""
        workshop = k.workshop ?? ""
        city = k.city ?? ""
        address = k.address ?? ""
        notes = k.notes ?? ""
    }
}

private struct KarigarFormBody: View {
    /// The karigar on file, or nil for a new one.
    let karigar: Karigar?
    @Environment(\.dismiss) private var dismiss

    @State private var draft: KarigarDraft
    @State private var saving = false
    @State private var error: String?

    /// The form opens on the karigar as it is when this screen is made, once: a change arriving from the book
    /// meanwhile must not throw away what is being typed.
    init(karigar: Karigar?) {
        self.karigar = karigar
        _draft = State(initialValue: KarigarDraft(karigar))
    }

    // MARK: What can be saved

    private func trim(_ s: String?) -> String { (s ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }

    /// What `addKarigar` or `updateKarigar` takes: for a new karigar every field of the form; for an edit only
    /// what differs from the karigar on file.
    private var patch: [String: String] {
        var out: [String: String] = [:]
        func put(_ key: String, _ now: String, _ was: String?, lower: Bool = false) {
            let n = lower ? trim(now).lowercased() : trim(now)
            let old = lower ? trim(was).lowercased() : trim(was)
            if karigar == nil || n != old { out[key] = n }
        }
        put("name", draft.name, karigar?.name)
        put("contact", draft.contact, karigar?.contact)
        put("email", draft.email, karigar?.email, lower: true)
        put("specialty", draft.specialty, karigar?.specialty)
        put("altPhone", draft.altPhone, karigar?.altPhone)
        put("workshop", draft.workshop, karigar?.workshop)
        put("city", draft.city, karigar?.city)
        put("address", draft.address, karigar?.address)
        put("notes", draft.notes, karigar?.notes)
        return out
    }

    /// The web's `z.string().email()`, loosely: something, an @, something with a dot. Blank is fine.
    private var emailOK: Bool {
        let e = trim(draft.email)
        if e.isEmpty { return true }
        let parts = e.split(separator: "@", omittingEmptySubsequences: false)
        return parts.count == 2 && !parts[0].isEmpty && parts[1].contains(".") && !e.contains(" ")
    }

    private var nameOK: Bool { !trim(draft.name).isEmpty }

    private var canSave: Bool { !saving && nameOK && emailOK && !patch.isEmpty }

    // MARK: Body

    var body: some View {
        Form { Group {
            nameSection
            contactSection
            loginSection
            workSection
            whereSection
            notesSection
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
            TextField("Full name", text: $draft.name, prompt: Text("Required"))
                .textContentType(.name)
                .textInputAutocapitalization(.words)
        } header: {
            LedgerHeading(title: "Name")
        } footer: {
            if !nameOK && !draft.name.isEmpty { Text("Name is required.").foregroundStyle(.red) }
        }
    }

    private var contactSection: some View {
        Section {
            TextField("Contact number", text: $draft.contact, prompt: Text("Optional"))
                .keyboardType(.phonePad)
                .textContentType(.telephoneNumber)
            TextField("Second number", text: $draft.altPhone, prompt: Text("Workshop line, or a son's phone"))
        } header: {
            LedgerHeading(title: "Phone")
        }
    }

    private var loginSection: some View {
        Section {
            TextField("Google login", text: $draft.email, prompt: Text("karigar@gmail.com"))
                .keyboardType(.emailAddress)
                .textContentType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        } header: {
            LedgerHeading(title: "Google login")
        } footer: {
            if !emailOK {
                Text("Enter a valid email.").foregroundStyle(.red)
            } else {
                Text("Adding a Gmail lets this karigar sign in and see only their own work list and account. They cannot see customers, prices, or any other karigar. The first time, Firebase must allow new accounts while he signs in (Authentication, Settings, User actions, Enable create), or Google refuses him.")
            }
        }
    }

    private var workSection: some View {
        Section {
            TextField("Specialty", text: $draft.specialty, prompt: Text("What he makes: setting, polish, chain, meena"))
            TextField("Workshop", text: $draft.workshop, prompt: Text("Where the bench is"))
        } header: {
            LedgerHeading(title: "Work")
        }
    }

    private var whereSection: some View {
        Section {
            TextField("City", text: $draft.city, prompt: Text("e.g. Karachi"))
            TextField("Address", text: $draft.address, prompt: Text("Street address"), axis: .vertical)
                .lineLimit(1...4)
                .textContentType(.fullStreetAddress)
        } header: {
            LedgerHeading(title: "Where")
        }
    }

    private var notesSection: some View {
        Section {
            TextField("Notes", text: $draft.notes, prompt: Text("Any relevant notes, e.g. specialization, address, etc."), axis: .vertical)
                .lineLimit(3...8)
        } header: {
            LedgerHeading(title: "Notes")
        }
    }

    // MARK: Save

    private func save() async {
        guard canSave else { return }
        saving = true
        error = nil
        do {
            if let karigar {
                try await ERPAPI.shared.write("updateKarigar", ["karigarId": karigar.id, "patch": patch])
            } else {
                try await ERPAPI.shared.write("addKarigar", ["karigar": patch])
            }
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}
