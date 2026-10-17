import SwiftUI
import ERPCore

/// Given items (src/app/given/page.tsx): samples, repairs, anything given to karigars or customers, and whether it
/// has come back. Owners record a new one (+), mark one returned (swipe, or "Got back"), edit one (its date, what it
/// is, who has it, a note) and delete one (the delete code); each is a write through the ERP (`addGivenItem`,
/// `markGivenReturned`, `updateGivenItem`, `deleteGivenItem`).
struct WorkshopGivenScreen: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var query = ""
    @State private var filter: Filter = .all
    @State private var adding = false
    @State private var editing: GivenItem?
    @State private var deletion: OwnerDeletion?
    @State private var note: OwnerNote?
    /// Items with a write in flight.
    @State private var busy: Set<String> = []
    @State private var failure: String?
    @State private var opened: WorkshopPlace?

    private enum Filter: String, CaseIterable, Identifiable {
        case all, out, returned
        var id: String { rawValue }
        var title: String {
            switch self {
            case .all: return "All"
            case .out: return "Still out"
            case .returned: return "Returned"
            }
        }
    }

    var body: some View {
        ShelfState(loaded: book.givenItems.loaded, error: book.givenItems.error, offline: book.givenItems.offline) {
            content
        }
        .navigationTitle("Given items")
        .navigationBarTitleDisplayMode(.large)
        .modifier(HouseGround())
        .searchable(text: $query, prompt: "Item or recipient")
        .toolbar { givenToolbar }
        .sheet(isPresented: $adding) {
            WorkshopGivenSheet(karigars: workshopLive(book.karigars.items), customers: liveCustomers,
                               takenBy: session.shop.takenBy, me: session.shop.person)
        }
        .sheet(item: $editing) { (item: GivenItem) in
            WorkshopGivenSheet(karigars: workshopLive(book.karigars.items), customers: liveCustomers,
                               takenBy: session.shop.takenBy, me: session.shop.person, item: item) {
                Note.show(OwnerNote(title: "Updated", detail: "Item updated."), in: $note, reduce: reduceMotion)
            }
        }
        .sheet(item: $deletion) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) {
                Note.show(OwnerNote(title: "Deleted"), in: $note, reduce: reduceMotion)
            }
        }
        .ownerNote($note)
        .workshopPlaceDestination($opened)
        .workshopFailureAlert($failure)
        .onAppear {
            book.givenItems.need()
            // Only an owner records an item, and only the sheet's name suggestions read these two.
            if session.isOwner {
                book.karigars.need()
                book.customers.need()
            }
        }
    }

    private var liveCustomers: [Customer] { book.customers.items.filter { ($0.deletedAt ?? "").isEmpty } }

    // MARK: The list

    @ViewBuilder
    private var content: some View {
        let all = book.givenItems.items
        let shown = all.filter { matches($0) }
        List { Group {
            summarySection(all)
            filterSection
            if !shown.isEmpty {
                Section {
                    WorkshopCards(items: shown) { item in
                        row(item)
                    }
                } header: {
                    LedgerHeading(title: filter == .returned ? "Returned items" : "Items", count: shown.count)
                }
            } else {
                Section { emptyState.listRowBackground(Color.clear) }
            }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
    }

    private func matches(_ g: GivenItem) -> Bool {
        switch filter {
        case .all: break
        case .out: if g.status != .out { return false }
        case .returned: if g.status != .returned { return false }
        }
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if q.isEmpty { return true }
        return g.description.localizedCaseInsensitiveContains(q)
            || g.recipientName.localizedCaseInsensitiveContains(q)
            || (g.notes ?? "").localizedCaseInsensitiveContains(q)
    }

    private func summarySection(_ all: [GivenItem]) -> some View {
        let out = all.filter { $0.status == .out }.count
        let back = all.filter { $0.status == .returned }.count
        return Section {
            FigureRow {
                FigureTile(label: "Still out", value: "\(out)", tint: out > 0 ? Tone.owed.color : Color.primary)
                FigureTile(label: "Returned", value: "\(back)")
            }
            .padding(.vertical, 4)
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
        }
    }

    private var filterSection: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Filter.allCases) { f in
                        FilterChip(title: f.title, chosen: filter == f) { filter = f }
                    }
                }
            }
            .chipRowInList()
        }
    }

    // MARK: A row

    /// Two lines (rule 15): what it is, and "Out" in amber while it is (back is the expected end: nothing); then one quiet
    /// line of when, who and by whom. The note is in the menu.
    private func row(_ item: GivenItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(item.description).font(.headline).lineLimit(1)
                        Spacer(minLength: 4)
                        if item.status == .out {
                            Text("Out").font(.caption.weight(.semibold)).foregroundStyle(Tone.owed.color)
                        }
                    }
                    Text(recipientWords(item)).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
                Menu { itemMenu(item) } label: {
                    Image(systemName: "ellipsis").frame(width: 44, height: 44)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Actions for " + item.description)
            }
            if canReturn(item) {
                gotBack(item)
            }
        }
        .padding(.vertical, 4)
        // No swipe actions: the cards share one list row (WorkshopCards' grid), so a swipe would act on whichever
        // card the row picked. The … menu and the long press carry the same actions, on the right piece.
        .contextMenu { itemMenu(item) }
    }

    @ViewBuilder
    private func itemMenu(_ item: GivenItem) -> some View {
            if let notes = item.notes, !notes.isEmpty {
                Section { Text(notes) }
            }
            if canReturn(item) {
                Button { markReturned(item) } label: {
                    Label("Got back", systemImage: "checkmark.circle")
                }
            }
            if let place = recipientPlace(item) {
                Button { opened = place } label: {
                    Label("Open " + item.recipientName, systemImage: icon(item.recipientType))
                }
            }
            if session.isOwner {
                Button { editing = item } label: {
                    Label("Edit", systemImage: "pencil")
                }
                Button(role: .destructive) { askDelete(item) } label: {
                    Label("Delete", systemImage: "trash")
                }
            }
    }

    private func canReturn(_ item: GivenItem) -> Bool {
        session.isOwner && item.status == .out
    }

    /// "3 Oct 2026 · Ustad Demo · by Ammar", and "· back 9 Oct" once it is.
    private func recipientWords(_ item: GivenItem) -> String {
        let when = item.date.isEmpty ? "" : ShopDate.say(item.date)
        let who = item.recipientName.isEmpty ? "—" : item.recipientName
        let by = (item.givenBy ?? "").isEmpty ? "" : " · by " + (item.givenBy ?? "")
        var back = ""
        if item.status == .returned {
            let on = (item.returnedDate ?? "").isEmpty ? "" : ShopDate.say(item.returnedDate ?? "")
            back = on.isEmpty ? " · back" : " · back " + on
        }
        return (when.isEmpty ? who : when + " · " + who) + by + back
    }

    private func icon(_ t: GivenItemRecipientType) -> String {
        switch t {
        case .karigar: return "hammer"
        case .customer: return "person.2"
        case .other, .unknown: return "person"
        }
    }

    /// The karigar's page, or the customer's, when the entry is linked to one.
    private func recipientPlace(_ item: GivenItem) -> WorkshopPlace? {
        guard let rid = item.recipientId, !rid.isEmpty else { return nil }
        switch item.recipientType {
        case .karigar: return WorkshopPlace.karigar(rid)
        case .customer: return WorkshopPlace(path: "/customers/" + WorkshopLogic.piece(rid))
        case .other, .unknown: return nil
        }
    }

    private func gotBack(_ item: GivenItem) -> some View {
        HStack {
            Spacer()
            if busy.contains(item.id) {
                SkeletonLoading()
            } else {
                Button { markReturned(item) } label: {
                    Label("Got back", systemImage: "checkmark.circle")
                        .font(.subheadline)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.bordered)
            }
        }
    }

    private var emptyState: some View {
        let filtering = !query.isEmpty || filter != .all
        return ContentUnavailableView(
            "Nothing here yet",
            systemImage: "shippingbox",
            description: Text(filtering ? "No items match your filter." : "Tap + to record an item given.")
        )
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var givenToolbar: some ToolbarContent {
        if session.isOwner {
            ToolbarItem(placement: .primaryAction) {
                Button { adding = true } label: {
                    Label("Record item given", systemImage: "plus")
                }
            }
        }
    }

    // MARK: Writes

    /// The web's "Delete this entry?": the entry goes for good; nothing else is touched.
    private func askDelete(_ item: GivenItem) {
        let who = item.recipientName.isEmpty ? "" : " \u{2014} given to \(item.recipientName)."
        deletion = OwnerDeletion(
            what: "Delete given item \"\(item.description.isEmpty ? item.id : item.description)\"",
            detail: "\u{201C}\(item.description)\u{201D}\(who.isEmpty ? "." : who)"
        ) { code in
            _ = try await ERPAPI.shared.write("deleteGivenItem", ["id": item.id, "deleteCode": code])
        }
    }

    private func markReturned(_ item: GivenItem) {
        if busy.contains(item.id) { return }
        busy.insert(item.id)
        Task { @MainActor in
            do {
                _ = try await ERPAPI.shared.write("markGivenReturned", ["id": item.id, "returnedDate": ERPDate.iso(Date())])
            } catch {
                failure = error.localizedDescription
            }
            busy.remove(item.id)
        }
    }
}

// MARK: Record an item given

/// The form of the Given page: the date, what it is, who it went to, and a note. The recipient is picked from the
/// karigars or customers or typed; a name that is exactly one live karigar's or customer's is linked by id, so a
/// customer merge and the karigar's page can find it (lib/given.ts `resolveRecipientId`). With an `item` it is
/// "Edit Given Item": its fields to start from, and an edit whose name no longer resolves to one clears the old link,
/// as the web's does. Whether it came back is not changed by an edit.
struct WorkshopGivenSheet: View {
    let karigars: [Karigar]
    let customers: [Customer]
    /// The house's counter names (`Session.Shop.takenBy`): who at the shop gave it is one of them.
    var takenBy: [String] = []
    /// The signed-in person's counter name, where a new entry's "Given by" starts.
    var me: String? = nil
    /// The entry being edited; nil records a new one.
    var item: GivenItem? = nil
    /// Told once an edit is saved.
    var onSaved: () -> Void = {}

    @Environment(\.dismiss) private var dismiss

    @State private var date = Date()
    @State private var what = ""
    @State private var type: GivenItemRecipientType = .karigar
    @State private var name = ""
    /// The record the name was picked from; dropped when the name is typed over.
    @State private var pickedId: String?
    @State private var pickedName = ""
    @State private var notes = ""
    /// Who at the shop handed it over; "" is nobody.
    @State private var givenBy = ""
    @State private var saving = false
    @State private var error: String?

    private let types: [GivenItemRecipientType] = [.karigar, .customer, .other]

    init(karigars: [Karigar], customers: [Customer], takenBy: [String] = [], me: String? = nil,
         item: GivenItem? = nil, onSaved: @escaping () -> Void = {}) {
        self.karigars = karigars
        self.customers = customers
        self.takenBy = takenBy
        self.me = me
        self.item = item
        self.onSaved = onSaved
        // A new entry starts on the signed-in person, as Taken by does; an edit on who it says.
        _givenBy = State(initialValue: item?.givenBy ?? me ?? "")
        if let item {
            _date = State(initialValue: ERPDate.parse(item.date) ?? Date())
            _what = State(initialValue: item.description)
            // A type the form does not know is offered as Other.
            let known: GivenItemRecipientType
            switch item.recipientType {
            case .karigar: known = .karigar
            case .customer: known = .customer
            case .other, .unknown: known = .other
            }
            _type = State(initialValue: known)
            _name = State(initialValue: item.recipientName)
            _notes = State(initialValue: item.notes ?? "")
        }
    }

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canSave: Bool {
        !what.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !trimmedName.isEmpty && !saving
    }

    var body: some View {
        NavigationStack {
            Form { Group {
                LedgerSection("Date given") {
                    DatePicker("Date given", selection: $date, in: ...Date(), displayedComponents: .date)
                }
                LedgerSection("Item / description") {
                    TextField("e.g. Gold ring sample, Silver bangle repair", text: $what)
                }
                recipientSection
                LedgerSection("Given by") {
                    givenByRow
                }
                LedgerSection("Notes (optional)") {
                    TextField("Any extra details", text: $notes, axis: .vertical)
                        .lineLimit(2...4)
                }
                if let error {
                    Section { Text(error).foregroundStyle(Tone.problem.color) }
                }
                }
                .houseRows()
            }
            .navigationTitle(item == nil ? "Record item given" : "Edit Given Item")
            .modifier(HouseGround())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(role: .confirm) { save() }
                        .disabled(!canSave)
                }
            }
        }
        .presentationDetents([.large])
        .presentationSizing(.page)
        .interactiveDismissDisabled(saving)
    }

    // MARK: Who gave it

    /// One of the house's names (as New order's Taken by), or typed where the house has no list.
    @ViewBuilder
    private var givenByRow: some View {
        if takenBy.isEmpty {
            // No list for this house: the ERP records who is signed in, and takes no typed name.
            LabeledContent("Given by", value: givenBy.isEmpty ? "Who is signed in" : givenBy)
        } else {
            Picker("Given by", selection: $givenBy) {
                Text("Not set").tag("")
                // An older entry's name that is no longer on the list is still shown as it is.
                if !givenBy.isEmpty && !takenBy.contains(givenBy) {
                    Text(givenBy).tag(givenBy)
                }
                ForEach(takenBy, id: \.self) { name in
                    Text(name).tag(name)
                }
            }
        }
    }

    // MARK: Who it went to

    private var recipientSection: some View {
        LedgerSection("Given to") {
            Picker("Given to", selection: $type) {
                ForEach(types, id: \.rawValue) { t in
                    Text(typeWords(t)).tag(t)
                }
            }
            .pickerStyle(.segmented)
            .onChange(of: type) { _, _ in
                name = ""
                pickedId = nil
                pickedName = ""
            }
            TextField("Name", text: $name)
                .onChange(of: name) { _, new in
                    // Typing over a picked name makes it a typed one again.
                    if pickedId != nil && new != pickedName { pickedId = nil }
                }
            ForEach(suggestions) { s in
                Button { pick(s) } label: {
                    HStack {
                        Text(s.name)
                        Spacer()
                        if let hint = s.hint {
                            Text(hint).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .buttonStyle(.borderless)
            }
        }
    }

    private struct Suggestion: Identifiable {
        let id: String
        let name: String
        let hint: String?
    }

    /// Up to six people matching what is typed; a karigar list is short enough to show before any typing.
    private var suggestions: [Suggestion] {
        if pickedId != nil { return [] }
        let q = trimmedName
        switch type {
        case .karigar:
            let hits = karigars.filter { q.isEmpty || $0.name.localizedCaseInsensitiveContains(q) }
            return hits.prefix(6).map { Suggestion(id: $0.id, name: $0.name, hint: $0.contact) }
        case .customer:
            if q.isEmpty { return [] }
            let hits = customers.filter { $0.name.localizedCaseInsensitiveContains(q) }
            return hits.prefix(6).map { Suggestion(id: $0.id, name: $0.name, hint: $0.phone) }
        default:
            return []
        }
    }

    private func pick(_ s: Suggestion) {
        pickedId = s.id
        pickedName = s.name
        name = s.name
    }

    private func typeWords(_ t: GivenItemRecipientType) -> String {
        switch t {
        case .karigar: return "Karigar"
        case .customer: return "Customer"
        case .other, .unknown: return "Other"
        }
    }

    /// Linked when the name is one live karigar's or customer's, exactly (lib/given.ts); two of one name stay
    /// unlinked rather than guessed.
    private func recipientId() -> String? {
        if type == .other { return nil }
        if let pickedId, pickedName == trimmedName { return pickedId }
        let wanted = WorkshopPosition.norm(trimmedName)
        if type == .karigar {
            let hits = karigars.filter { WorkshopPosition.norm($0.name) == wanted }
            return hits.count == 1 ? hits[0].id : nil
        }
        let hits = customers.filter { WorkshopPosition.norm($0.name) == wanted }
        return hits.count == 1 ? hits[0].id : nil
    }

    // MARK: Save

    private func save() {
        if !canSave { return }
        var fields: [String: Any] = [
            "date": ERPDate.iso(date),
            "description": what.trimmingCharacters(in: .whitespacesAndNewlines),
            "recipientType": type.rawValue,
            "recipientName": trimmedName,
        ]
        if let rid = recipientId() { fields["recipientId"] = rid }
        let note = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        // An edit writes the note even when blank, as the web's does, and sending no id clears the old link.
        if item != nil || !note.isEmpty { fields["notes"] = note }
        // Who gave it: a new entry sends a name or nothing; an edit sends nobody as null, which clears it.
        let by = givenBy.trimmingCharacters(in: .whitespacesAndNewlines)
        // The ERP takes only a name on the house's list: a new entry sends one when chosen; an edit sends "Given by"
        // only when it was changed, so an old entry whose giver has left the list still saves its other fields.
        if let item {
            if by != (item.givenBy ?? "") { fields["givenBy"] = by.isEmpty ? NSNull() : by }
        } else if !by.isEmpty {
            fields["givenBy"] = by
        }
        let sent = fields
        let editing = item
        saving = true
        error = nil
        Task { @MainActor in
            do {
                if let editing {
                    _ = try await ERPAPI.shared.write("updateGivenItem", ["id": editing.id, "item": sent])
                    onSaved()
                } else {
                    _ = try await ERPAPI.shared.write("addGivenItem", sent)
                }
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
            saving = false
        }
    }
}
