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
    @State private var note: Note?
    /// Bumped when an item is marked back: the success tap.
    @State private var returnedTick = 0
    /// Items with a write in flight.
    @State private var busy: Set<String> = []
    /// Items just marked back: shown as back before the shelf says so.
    @State private var returnedNow: Set<String> = []
    @State private var failure: String?
    @State private var opened: WorkshopPlace?
    #if os(macOS)
    @State private var macPick = Set<String>()
    @State private var macSort = [KeyPathComparator(\GivenItem.date, order: .reverse)]
    #endif

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
                Note.show(Note(title: "Updated", detail: "Item updated."), in: $note, reduce: reduceMotion)
            }
        }
        .sheet(item: $deletion) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) {
                Note.show(Note(title: "Deleted"), in: $note, reduce: reduceMotion)
            }
        }
        .noteToast($note)
        .savedFeedback(trigger: returnedTick)
        .onChange(of: Outbox.shared.failure?.id) { _, _ in returnedNow = [] }
        .sensoryFeedback(.warning, trigger: deletion != nil) { _, now in now }
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
        #if os(macOS)
        macTable(all, shown)
        #else
        List { Group {
            filterSection(all)
            if !shown.isEmpty {
                Section {
                    WorkshopCards(items: shown) { item in
                        row(item)
                    }
                } header: {
                    LedgerHeading(title: filter == .returned ? "Returned items" : "Items", count: shown.count)
                }
            }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .overlay {
            if shown.isEmpty { emptyState.allowsHitTesting(false) }
        }
        #endif
    }

    private func isOut(_ g: GivenItem) -> Bool { g.status == .out && !returnedNow.contains(g.id) }

    private func matches(_ g: GivenItem) -> Bool {
        switch filter {
        case .all: break
        case .out: if !isOut(g) { return false }
        case .returned: if isOut(g) { return false }
        }
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if q.isEmpty { return true }
        return g.description.localizedCaseInsensitiveContains(q)
            || g.recipientName.localizedCaseInsensitiveContains(q)
            || (g.notes ?? "").localizedCaseInsensitiveContains(q)
    }

    /// The chips carry the one count that asks for a hand (what is still out); no tiles repeat it.
    private func filterSection(_ all: [GivenItem]) -> some View {
        let out = all.filter { isOut($0) }.count
        return Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: pt(8)) {
                    ForEach(Filter.allCases) { f in
                        FilterChip(title: f.title, count: f == .out && out > 0 ? out : nil, chosen: filter == f) {
                            Motion.run(reduce: reduceMotion) { filter = f }
                        }
                    }
                }
            }
            .chipRowInList()
        }
    }

    // MARK: A row

    private func row(_ item: GivenItem) -> some View {
        VStack(alignment: .leading, spacing: pt(14)) {
            HStack(alignment: .top, spacing: pt(8)) {
                Text(item.description).font(.headline).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                Menu { itemMenu(item) } label: {
                    Image(systemName: "ellipsis").frame(width: Metrics.tap, height: Metrics.tap)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Actions for " + item.description)
            }
            statusBadge(item)
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
        .padding(.vertical, pt(4))
        // No swipe actions: the cards share one list row (WorkshopCards' grid), so a swipe would act on whichever
        // card the row picked. The … menu and the long press carry the same actions, on the right piece.
        .contextMenu { itemMenu(item) }
        .motion(isOut(item))
    }

    @ViewBuilder
    private func itemMenu(_ item: GivenItem) -> some View {
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
        session.isOwner && isOut(item)
    }

    /// "3 Oct 2026 · Ustad Demo · by Ammar".
    private func recipientWords(_ item: GivenItem) -> String {
        let when = item.date.isEmpty ? "" : ShopDate.say(item.date)
        let who = item.recipientName.isEmpty ? "—" : item.recipientName
        let by = (item.givenBy ?? "").isEmpty ? "" : " · by " + (item.givenBy ?? "")
        return (when.isEmpty ? who : when + " · " + who) + by
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
        if isOut(item) {
            // Out is the expected state: a badge only once it has been out a week; before that a quiet word.
            let days = daysOut(item)
            if days >= 7 {
                Pill("Out \(days) days", tone: .owed)
            } else {
                Text("Still out").font(.caption2).foregroundStyle(.secondary)
            }
        } else {
            // Back is the expected end: no badge (rule 15), only when.
            if let back = item.returnedDate, !back.isEmpty {
                Text("Back " + ShopDate.say(back)).font(.caption2).foregroundStyle(.secondary)
            }
        }
    }

    private func daysOut(_ item: GivenItem) -> Int {
        guard let given = ERPDate.parse(item.date) else { return 0 }
        return max(0, ERPDate.karachiCalendar.dateComponents([.day], from: given, to: Date()).day ?? 0)
    }

    private func gotBack(_ item: GivenItem) -> some View {
        HStack {
            Spacer()
            Button { markReturned(item) } label: {
                Label("Got back", systemImage: "checkmark.circle")
                    .font(.subheadline)
                    .frame(minHeight: Metrics.tap)
            }
            .buttonStyle(.bordered)
            .tint(Tone.settled.color)
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            ContentUnavailableView.search(text: query)
        } else {
            switch filter {
            case .out: EmptyState("Nothing is out", symbol: "shippingbox", message: "Every item given has come back.")
            case .returned: EmptyState("Nothing has come back yet", symbol: "shippingbox")
            case .all: EmptyState("Nothing here yet", symbol: "shippingbox",
                                  message: session.isOwner ? "Tap + to record an item given." : nil)
            }
        }
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

    /// Not money: marked at once (the row leaves "out" with the shelf's next copy) and the Outbox carries it.
    private func markReturned(_ item: GivenItem) {
        if returnedNow.contains(item.id) { return }
        Motion.run(Motion.enter, reduce: reduceMotion) { returnedNow.insert(item.id) }
        returnedTick += 1
        Outbox.shared.send(op: "markGivenReturned", fields: ["id": item.id, "returnedDate": ERPDate.iso(Date())],
                           business: House.business, label: "Returned: \(item.description)")
    }
}

#if os(macOS)
// The Mac's Given items: a Table (what, to whom, when, where it stands, who gave it, the note), sortable; Still out / Returned in
// the toolbar with Record item given and Got back; right-click carries the same actions as the iPhone's menu, Return or a
// double-click edits (owners), and Delete asks for the delete code.
extension WorkshopGivenScreen {
    func macTable(_ all: [GivenItem], _ shown: [GivenItem]) -> some View {
        let ordered = shown.sorted(using: macSort)
        let picked = macPicked(all)
        return Table(ordered, selection: $macPick, sortOrder: $macSort) {
            TableColumn("What", value: \.description) { (g: GivenItem) in Text(g.description).fontWeight(.medium).lineLimit(1) }
                .width(min: 180, ideal: 280)
            TableColumn("Given to", value: \.recipientName) { (g: GivenItem) in
                Label(g.recipientName.isEmpty ? "\u{2014}" : g.recipientName, systemImage: icon(g.recipientType))
                    .lineLimit(1)
            }
            .width(min: 140, ideal: 200)
            TableColumn("Given", value: \.date) { (g: GivenItem) in Text(g.date.isEmpty ? "" : ShopDate.say(g.date)) }
                .width(min: 90, ideal: 110)
            TableColumn("Where it stands") { (g: GivenItem) in macStanding(g) }
                .width(min: 110, ideal: 150)
            TableColumn("Given by") { (g: GivenItem) in Text(g.givenBy ?? "").foregroundStyle(.secondary) }
                .width(min: 80, ideal: 110)
            TableColumn("Note") { (g: GivenItem) in Text(g.notes ?? "").foregroundStyle(.secondary).lineLimit(1) }
                .width(min: 120, ideal: 240)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if ids.count == 1, let id = ids.first, let item = all.first(where: { $0.id == id }) { itemMenu(item) }
        } primaryAction: { ids in
            if session.isOwner, ids.count == 1, let id = ids.first, let item = all.first(where: { $0.id == id }) { editing = item }
        }
        .onDeleteCommand { if session.isOwner, let picked { askDelete(picked) } }
        .overlay {
            if shown.isEmpty { emptyState.allowsHitTesting(false) }
        }
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("Show", selection: $filter) {
                    ForEach(Filter.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
            }
            if session.isOwner {
                ToolbarItem(placement: .automatic) {
                    Button { if let picked { markReturned(picked) } } label: { Label("Got back", systemImage: "checkmark.circle") }
                        .disabled(picked.map { !canReturn($0) } ?? true)
                        .help("The picked item has come back")
                }
            }
        }
    }

    private func macPicked(_ all: [GivenItem]) -> GivenItem? {
        guard macPick.count == 1, let id = macPick.first else { return nil }
        return all.first { $0.id == id }
    }

    /// Out is the expected state: a coloured word only once it has been out a week; back says when.
    @ViewBuilder
    private func macStanding(_ g: GivenItem) -> some View {
        if isOut(g) {
            let days = daysOut(g)
            if days >= 7 {
                Pill("Out \(days) days", tone: .owed)
            } else {
                Text("Still out").foregroundStyle(.secondary)
            }
        } else if let back = g.returnedDate, !back.isEmpty {
            Text("Back " + ShopDate.say(back)).foregroundStyle(.secondary)
        } else {
            Text("Back").foregroundStyle(.secondary)
        }
    }
}
#endif

// MARK: Record an item given

/// The form of the Given page: the date, what it is, who it went to, and a note. The recipient is picked from the
/// karigars or customers or typed; a name that is exactly one live karigar's or customer's is linked by id, so a
/// customer merge and the karigar's page can find it (lib/given.ts `resolveRecipientId`). With an `item` it is
/// "Edit given item": its fields to start from, and an edit whose name no longer resolves to one clears the old link,
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

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
    @State private var savedTick = 0

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
                LedgerSection("What was given") {
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
                }
                .houseRows()
            }
            .scrollDismissesKeyboard(.interactively)
            #if os(macOS)
            .formStyle(.grouped)
            #endif
            .failureAlert($error, title: "Not saved")
            .navigationTitle(item == nil ? "Record item given" : "Edit given item")
            .modifier(HouseGround())
            .navigationBarTitleDisplayMode(.inline)
            .savedFeedback(trigger: savedTick)
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
        .presentationDetents([.medium, .large])
        .presentationSizing(.page)
        .interactiveDismissDisabled(saving)
        #if os(macOS)
        .frame(minWidth: 520, idealWidth: 560, minHeight: 540, idealHeight: 600)
        #endif
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
                .personName()
                .onChange(of: name) { _, new in
                    // Typing over a picked name makes it a typed one again.
                    if pickedId != nil && new != pickedName { pickedId = nil }
                }
            ForEach(suggestions) { s in
                Button { Motion.run(reduce: reduceMotion) { pick(s) } } label: {
                    HStack {
                        Text(s.name)
                        Spacer()
                        if let hint = s.hint {
                            Text(hint).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .buttonStyle(.borderless)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .motion(suggestions.map(\.id))
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
        if let editing = item {
            Outbox.shared.send(op: "updateGivenItem", fields: ["id": editing.id, "item": sent],
                               business: House.business, label: "Given item: \(what)")
            onSaved()
        } else {
            Outbox.shared.send(op: "addGivenItem", fields: sent, business: House.business, label: "Given item: \(what)")
            // The edit says "Updated" in a toast (which taps); only an add needs its own tap.
            savedTick += 1
        }
        dismiss()
    }
}
