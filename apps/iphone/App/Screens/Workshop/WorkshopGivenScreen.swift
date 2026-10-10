import SwiftUI
import ERPCore

/// Given items (src/app/given/page.tsx): samples, repairs, anything given to karigars or customers, and whether it
/// has come back. Owners record a new one (+), mark one returned (swipe, or "Got back"), edit one (its date, what it
/// is, who has it, a note) and delete one (the delete code); each is a write through the ERP (`addGivenItem`,
/// `markGivenReturned`, `updateGivenItem`, `deleteGivenItem`).
struct WorkshopGivenScreen: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

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
        .searchable(text: $query, prompt: "Item or recipient")
        .toolbar { givenToolbar }
        .sheet(isPresented: $adding) {
            WorkshopGivenSheet(karigars: workshopLive(book.karigars.items), customers: liveCustomers)
        }
        .sheet(item: $editing) { (item: GivenItem) in
            WorkshopGivenSheet(karigars: workshopLive(book.karigars.items), customers: liveCustomers, item: item) {
                withAnimation { note = OwnerNote(title: "Updated", detail: "Item updated.") }
            }
        }
        .sheet(item: $deletion) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) {
                withAnimation { note = OwnerNote(title: "Deleted") }
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
                    ForEach(shown) { item in
                        row(item)
                    }
                } footer: {
                    Text("Samples, repairs, or anything given to karigars or customers.")
                }
            }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .overlay {
            if shown.isEmpty { emptyState }
        }
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
        let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]
        return Section {
            LazyVGrid(columns: columns, spacing: 10) {
                FigureTile(label: "Still out", value: "\(out)", tint: out > 0 ? Color.orange : Color.primary)
                FigureTile(label: "Returned", value: "\(back)", tint: back > 0 ? Color.green : Color.primary)
                FigureTile(label: "Total", value: "\(all.count)")
            }
            .padding(.vertical, 4)
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
        }
    }

    private var filterSection: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                GlassEffectContainer(spacing: 8) {
                    HStack(spacing: 8) {
                        ForEach(Filter.allCases) { f in
                            chip(f)
                        }
                    }
                }
            }
            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
            .listRowBackground(Color.clear)
        }
    }

    @ViewBuilder
    private func chip(_ f: Filter) -> some View {
        if filter == f {
            Button(f.title) { filter = f }
                .buttonStyle(.houseProminent)
        } else {
            Button(f.title) { filter = f }
                .buttonStyle(.glass)
        }
    }

    // MARK: A row

    private func row(_ item: GivenItem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(item.description).font(.headline).lineLimit(2)
                Spacer(minLength: 4)
                statusBadge(item)
            }
            Label {
                Text(recipientWords(item))
            } icon: {
                Image(systemName: icon(item.recipientType))
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
            if let notes = item.notes, !notes.isEmpty {
                Text(notes).font(.caption).foregroundStyle(.secondary)
            }
            if canReturn(item) {
                gotBack(item)
            }
        }
        .padding(.vertical, 4)
        .opacity(item.status == .returned ? 0.6 : 1)
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            if canReturn(item) {
                Button { markReturned(item) } label: {
                    Label("Got back", systemImage: "checkmark.circle")
                }
                .tint(.green)
            }
            if session.isOwner {
                Button(role: .destructive) { askDelete(item) } label: {
                    Label("Delete", systemImage: "trash")
                }
            }
        }
        .swipeActions(edge: .leading) {
            if session.isOwner {
                Button { editing = item } label: {
                    Label("Edit", systemImage: "pencil")
                }
            }
        }
        .contextMenu {
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
    }

    private func canReturn(_ item: GivenItem) -> Bool {
        session.isOwner && item.status == .out
    }

    /// "3 Oct 2026 · Ustad Demo".
    private func recipientWords(_ item: GivenItem) -> String {
        let when = item.date.isEmpty ? "" : ShopDate.say(item.date)
        let who = item.recipientName.isEmpty ? "—" : item.recipientName
        return when.isEmpty ? who : when + " · " + who
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

    @ViewBuilder
    private func statusBadge(_ item: GivenItem) -> some View {
        if item.status == .out {
            StatusBadge("Out", color: .orange)
        } else {
            VStack(alignment: .trailing, spacing: 2) {
                StatusBadge("Returned", color: .green)
                if let back = item.returnedDate, !back.isEmpty {
                    Text(ShopDate.say(back)).font(.caption2).foregroundStyle(.secondary)
                }
            }
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
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .tint(.green)
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
    @State private var saving = false
    @State private var error: String?

    private let types: [GivenItemRecipientType] = [.karigar, .customer, .other]

    init(karigars: [Karigar], customers: [Customer], item: GivenItem? = nil, onSaved: @escaping () -> Void = {}) {
        self.karigars = karigars
        self.customers = customers
        self.item = item
        self.onSaved = onSaved
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
                LedgerSection("Notes (optional)") {
                    TextField("Any extra details", text: $notes, axis: .vertical)
                        .lineLimit(2...4)
                }
                if let error {
                    Section { Text(error).foregroundStyle(Color.red) }
                }
                }
                .houseRows()
            }
            .navigationTitle(item == nil ? "Record item given" : "Edit Given Item")
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
