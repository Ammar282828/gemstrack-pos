import SwiftUI
import ERPCore

/// One piece being typed: kept as text until it is saved.
struct RepairsDraftPiece: Identifiable {
    let id = UUID()
    var item = ""
    var work = ""
    var weight = ""
    var price = ""
}

/// New repair (the form in src/app/repairs/page.tsx, new ticket): who it is for, the pieces left to be
/// mended, when they will be ready, an advance if one is taken, and (out of the way on the web, one
/// section here) the karigar, who took it and a note for the shop. A walk-in is a ticket with no name.
///
/// Saving is `addRepair` (owners only): the ERP numbers the ticket REP-000001 on, writes any advance to
/// Extra revenue in the same commit, and answers with the ticket. The form then leaves and the list
/// opens that ticket's sheet. The receipt prints from the ERP's page, not from here.
struct RepairsForm: View {
    /// The new ticket's id, and the ticket as the ERP answered it.
    let onSaved: (String, Repair?) -> Void

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var customerId: String?
    @State private var name = ""
    @State private var phone = ""
    @State private var pieces: [RepairsDraftPiece] = [RepairsDraftPiece()]
    @State private var hasDate = true
    @State private var promised = RepairsKit.days(adding: 7)
    @State private var karigarId = ""
    @State private var takenBy = ""
    /// "Taken by" starts on the signed-in person once, as the form opens; after that it is the person's to change.
    @State private var takenBySeeded = false
    @State private var note = ""
    @State private var advance = ""
    @State private var method = "Cash"
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form { Group {
                customerSection
                piecesSection
                whenSection
                advanceSection
                shopSection
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
                }
                .houseRows()
            }
            .navigationTitle("New repair")
            .navigationBarTitleDisplayMode(.inline)
            .scrollDismissesKeyboard(.interactively)
            .disabled(saving)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(!canSave)
                }
            }
        }
        .interactiveDismissDisabled(saving)
        .onAppear {
            book.customers.need()
            book.karigars.need()
            book.repairs.need()
            book.orders.need()
            seedTakenBy()
        }
    }

    /// New work starts on whoever is signed in (docs/decisions.md "Signed-in defaults"), when they are on the
    /// house's list; Not set is one tap away, since a device handed across the counter must not credit
    /// everything to whoever signed in.
    private func seedTakenBy() {
        if takenBySeeded { return }
        takenBySeeded = true
        guard let person = session.shop.person, !person.isEmpty else { return }
        let names = session.shop.takenBy
        if names.isEmpty || names.contains(person) { takenBy = person }
    }

    // MARK: What can be saved

    private var hasPiece: Bool {
        pieces.contains { !RepairsKit.trimmed($0.item).isEmpty || !RepairsKit.trimmed($0.work).isEmpty }
    }

    private var canSave: Bool { hasPiece && !saving }

    /// The customers a ticket can be pinned to: not removed, and not the old "Walk-in Customer" records
    /// (lib/walk-in.ts: a walk-in is the absence of a customer).
    private var people: [Customer] {
        book.customers.items.filter { (c: Customer) -> Bool in
            RepairsKit.filled(c.deletedAt) == nil && !isWalkInName(c.name)
        }
    }

    private var karigars: [Karigar] {
        book.karigars.items.filter { (k: Karigar) -> Bool in RepairsKit.filled(k.deletedAt) == nil }
    }

    private var total: Double {
        pieces.reduce(0.0) { (sum: Double, p: RepairsDraftPiece) -> Double in sum + (Self.number(p.price) ?? 0) }
    }

    private var advanceAmount: Double { Self.number(advance) ?? 0 }

    /// A number typed in the field: commas ignored, nothing or 0 is nothing (sale-flow fields show 0 as blank).
    private static func number(_ text: String) -> Double? {
        let t = text.replacingOccurrences(of: ",", with: "").trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty, let v = Double(t), v > 0 else { return nil }
        return v
    }

    /// Who has taken tickets and orders lately, newest first, for one tap instead of typing.
    private var recentNames: [String] {
        let fromRepairs: [String] = book.repairs.items.prefix(60).compactMap { $0.takenBy }
        let fromOrders: [String] = book.orders.items.prefix(60).compactMap { $0.takenBy }
        var seen = Set<String>()
        var out: [String] = []
        for raw in fromRepairs + fromOrders {
            let n = RepairsKit.trimmed(raw)
            if n.isEmpty || seen.contains(n) { continue }
            seen.insert(n)
            out.append(n)
        }
        return Array(out.prefix(8))
    }

    // MARK: Who

    private var nameBinding: Binding<String> {
        Binding(
            get: { name },
            set: { newName in
                // Typing over a picked name lets go of the customer, as the web's autocomplete does.
                if newName != name { customerId = nil }
                name = newName
            }
        )
    }

    private var customerSection: some View {
        Section {
            NavigationLink {
                RepairsCustomerPicker(customers: people) { c in pick(c) }
            } label: {
                Label("Pick from your customers", systemImage: "person.crop.circle")
            }
            TextField("Name", text: nameBinding)
                .textContentType(.name)
                .textInputAutocapitalization(.words)
            TextField("Phone", text: $phone)
                .keyboardType(.phonePad)
                .textContentType(.telephoneNumber)
        } header: {
            Text("Customer")
        } footer: {
            Text(customerId == nil ? "Leave both blank for a walk-in." : "Linked to \(name) in the book.")
        }
    }

    private func pick(_ c: Customer) {
        customerId = c.id
        name = c.name
        if let p = RepairsKit.filled(c.phone) { phone = p }
    }

    // MARK: The pieces

    private var piecesSection: some View {
        Section {
            ForEach($pieces) { $piece in
                pieceFields($piece)
                    .swipeActions {
                        if pieces.count > 1 {
                            Button(role: .destructive) { remove(piece.id) } label: {
                                Label("Remove", systemImage: "trash")
                            }
                        }
                    }
            }
            Button {
                pieces.append(RepairsDraftPiece())
            } label: {
                Label("Add another piece", systemImage: "plus.circle")
            }
            if total > 0 {
                LabeledContent("Total") {
                    MoneyText(amount: total, exact: true).fontWeight(.semibold)
                }
            }
        } header: {
            Text("Pieces")
        } footer: {
            if !hasPiece { Text("What was brought in: \"gold ring\", \"chain\".") }
        }
    }

    private func pieceFields(_ piece: Binding<RepairsDraftPiece>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Piece (gold ring)", text: piece.item)
                .textInputAutocapitalization(.sentences)
            TextField("What to do (resize to 14)", text: piece.work)
                .textInputAutocapitalization(.sentences)
            HStack(spacing: 12) {
                TextField("Weight g", text: piece.weight)
                    .keyboardType(.decimalPad)
                TextField("Price", text: piece.price)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
            }
        }
        .padding(.vertical, 2)
    }

    private func remove(_ id: UUID) {
        pieces.removeAll { $0.id == id }
    }

    // MARK: When

    private var whenSection: some View {
        Section {
            Toggle("Ready by a date", isOn: $hasDate)
            if hasDate {
                // Stored as yyyy-MM-dd, Karachi's day.
                DatePicker("Ready by", selection: $promised, displayedComponents: .date)
                    .environment(\.timeZone, ERPDate.karachi)
                HStack(spacing: 8) {
                    quickDate(3, "3 days")
                    quickDate(7, "1 week")
                    quickDate(14, "2 weeks")
                }
            }
        } header: {
            Text("When")
        }
    }

    private func quickDate(_ days: Int, _ title: String) -> some View {
        Button(title) { promised = RepairsKit.days(adding: days) }
            .buttonStyle(.bordered)
            .controlSize(.small)
    }

    // MARK: Advance

    private var advanceSection: some View {
        Section {
            TextField("Amount in rupees", text: $advance)
                .keyboardType(.numberPad)
            if advanceAmount > 0 {
                Text(Money.pkrLac(advanceAmount)).foregroundStyle(.secondary)
                Picker("How it was paid", selection: $method) {
                    ForEach(PaymentMethods.all, id: \.self) { Text($0) }
                }
                .pickerStyle(.segmented)
            }
        } header: {
            Text("Advance taken now (optional)")
        }
    }

    // MARK: The shop

    private var shopSection: some View {
        Section {
            Picker("Karigar", selection: $karigarId) {
                Text("Done in the shop").tag("")
                ForEach(karigars) { k in
                    Text(k.name).tag(k.id)
                }
            }
            takenByRow
            TextField("Note for the shop", text: $note, axis: .vertical)
                .lineLimit(2...5)
        } header: {
            Text("Karigar, taken by, note")
        } footer: {
            Text("The note is for the shop only: it is never printed or sent.")
        }
    }

    /// The house's counter names, one to pick (the web's list: a name typed three ways is three people to
    /// a filter). Typing is for a house that has not named its counter people.
    @ViewBuilder
    private var takenByRow: some View {
        let names = session.shop.takenBy
        if names.isEmpty {
            TextField("Taken by", text: $takenBy)
                .textInputAutocapitalization(.words)
            if !recentNames.isEmpty {
                Menu("Names used lately") {
                    ForEach(recentNames, id: \.self) { n in
                        Button(n) { takenBy = n }
                    }
                }
            }
        } else {
            Picker("Taken by", selection: $takenBy) {
                Text("Not set").tag("")
                ForEach(names, id: \.self) { n in Text(n).tag(n) }
            }
        }
    }

    // MARK: Save

    private func save() async {
        if !canSave { return }
        saving = true
        error = nil
        do {
            let out = try await ERPAPI.shared.write("addRepair", ["repair": payload()])
            let doc = out["repair"] as? [String: Any] ?? [:]
            let newId = doc["id"] as? String ?? ""
            if !newId.isEmpty {
                let seed: Repair? = DocJSON.decode(Repair.self, id: newId, data: doc)
                onSaved(newId, seed)
            }
            saving = false
            dismiss()
        } catch {
            self.error = error.localizedDescription
            saving = false
        }
    }

    /// `addRepair`'s `repair`: a blank name stays blank, as the web saves `name.trim()` (the screens say
    /// "Walk-in" for it; nothing writes that word), an empty piece is dropped, and a piece with only the
    /// work typed is called "Piece", as the web does.
    private func payload() -> [String: Any] {
        var kept: [[String: Any]] = []
        for p in pieces {
            let item = RepairsKit.trimmed(p.item)
            let work = RepairsKit.trimmed(p.work)
            if item.isEmpty && work.isEmpty { continue }
            var doc: [String: Any] = ["item": item.isEmpty ? "Piece" : item, "work": work]
            if let w = Self.number(p.weight) { doc["weightG"] = w }
            if let price = Self.number(p.price) { doc["price"] = price }
            kept.append(doc)
        }
        var repair: [String: Any] = ["customerName": RepairsKit.trimmed(name), "pieces": kept]
        if let cid = customerId, !cid.isEmpty { repair["customerId"] = cid }
        let number = RepairsKit.trimmed(phone)
        if !number.isEmpty { repair["customerContact"] = RepairsKit.normalizePhone(number) }
        if hasDate { repair["promisedDate"] = ERPDate.karachiDay(promised) }
        if let k = karigars.first(where: { $0.id == karigarId }) {
            repair["karigarId"] = k.id
            repair["karigarName"] = k.name
        }
        let by = RepairsKit.trimmed(takenBy)
        if !by.isEmpty { repair["takenBy"] = by }
        let remark = RepairsKit.trimmed(note)
        if !remark.isEmpty { repair["internalNote"] = remark }
        if advanceAmount > 0 {
            repair["advance"] = advanceAmount
            repair["advanceMethod"] = method
        }
        return repair
    }
}

/// Pick a customer from the book, with search by name or number.
struct RepairsCustomerPicker: View {
    let customers: [Customer]
    let onPick: (Customer) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var shown: [Customer] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if q.isEmpty { return customers }
        return customers.filter { (c: Customer) -> Bool in
            c.name.lowercased().contains(q) || (c.phone ?? "").lowercased().contains(q)
        }
    }

    var body: some View {
        List { Group {
            ForEach(shown) { c in
                Button {
                    onPick(c)
                    dismiss()
                } label: {
                    TwoLine(title: c.name, subtitle: c.phone)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .overlay {
            if shown.isEmpty {
                if query.isEmpty {
                    ContentUnavailableView("No customers yet", systemImage: "person.2")
                } else {
                    ContentUnavailableView.search(text: query)
                }
            }
        }
        .navigationTitle("Customers")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: "Name or phone")
    }
}
