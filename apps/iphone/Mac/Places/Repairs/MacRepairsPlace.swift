#if os(macOS)
import SwiftUI
import ERPCore

// The Repairs place (docs/features/mac-design.md, "Repairs"): a sortable, multi-select table of the tickets, the picked one in
// the inspector beside it, a summary bar at the foot. The sidebar's saved lists (In the Shop, Ready, Collected) are this
// place's path with `?list=`. Every action is a `MacAction`, declared once in `MacRepairsModel` and drawn in the toolbar, the
// menu bar's Repair menu, the right-click menu and the inspector. Return or a double-click opens the ticket in a window of its
// own (`/repairs?id=`); the writes are the phone's.

/// One ticket as a row of the table, worked out once when the rows are made (never while drawing).
struct MacRepairsRow: Identifiable {
    let repair: Repair
    /// The status the desk shows (a step just taken is shown at once).
    let status: RepairStatus
    let number: String
    let summary: String
    let customer: String
    let statusLabel: String
    let statusTone: Tone
    let received: String
    /// Sorts undated last.
    let promised: String
    let readyBy: String
    let readyByTone: Tone
    let owed: Double
    let karigar: String

    var id: String { number }

    init(_ r: Repair, status: RepairStatus, now: Date) {
        repair = r
        self.status = status
        number = r.id
        summary = RepairsKit.repairSummary(r)
        customer = RepairsKit.customer(r)
        statusLabel = RepairsKit.label(status)
        statusTone = RepairsKit.tone(status)
        received = r.receivedAt
        let day = RepairsKit.filled(r.promisedDate)
        promised = day ?? "9999"
        owed = status == .cancelled ? 0 : RepairsKit.repairBalance(r)
        karigar = RepairsKit.filled(r.karigarName) ?? ""
        // Ready by: the day, and for a ticket still in the shop how late it is (late in red, the day itself in orange).
        var words = day.map { ShopDate.say($0) } ?? ""
        var tone = Tone.quiet
        if status == .received, let t = RepairsKit.timing(r, now: now) {
            switch t.state {
            case .late: tone = .late
            case .today: tone = .owed
            default: tone = .quiet
            }
            let when = timingLabel(t)
            if t.state == .late && !when.isEmpty { words += " \u{00B7} " + when }
        }
        readyBy = words
        readyByTone = tone
    }
}

struct MacRepairsPlace: View {
    /// The place's path: "/repairs", or "/repairs?list=ready" for a saved list.
    let path: String

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.openPlaceWindow) private var openPlace
    @Environment(\.openURL) private var openURL
    @State private var model = MacRepairsModel()
    @State private var query = ""
    @State private var selection = Set<String>()
    @State private var sort = [KeyPathComparator(\MacRepairsRow.promised)]
    @State private var made = Memo<[MacRepairsRow]>()
    @State private var summed = Memo<[String]>()
    /// New Repair where there is no window to open it in (the place shown in a sheet or a pushed page).
    @State private var newSheet = false

    var body: some View {
        let list = MacLists.list(in: path)
        let rows = tableRows(list)
        let groups = actions()
        let line = summed(rowsKey(list) + [selection.hashValue]) { summary(rows) }
        ShelfState(loaded: book.repairs.loaded, error: book.repairs.error, offline: book.repairs.offline) {
            table(rows)
        }
        .navigationTitle(title(list))
        .navigationSubtitle(count(rows.count))
        .macSearchable(text: $query, prompt: "Name, phone, piece or REP no.")
        .macSummaryBar(line)
        .macInspector { ticketPanel() }
        .toolbar { placeToolbar() }
        .macRecordMenu(MacRecordMenu(title: "Repair", groups: groups))
        .modifier(MacRepairsDialogs(model: model))
        .sheet(isPresented: $newSheet) {
            RepairsForm { id, _ in selection = [id] }
        }
        .onChange(of: model.deleted) { _, gone in
            if gone {
                selection = []
                model.deleted = false
            }
        }
        .onAppear { book.repairs.need() }
    }

    // MARK: The rows

    private func title(_ list: String?) -> String {
        guard let list, let found = MacLists.lists(for: "/repairs").first(where: { $0.id == list }) else { return "Repairs" }
        return found.title
    }

    private func count(_ n: Int) -> String { n == 1 ? "1 repair" : "\(n) repairs" }

    /// The tickets of the saved list, the ones that match the search, sorted: made once per change of the books, the search,
    /// the sort, the list, a step just taken or the hour (a promise turns late).
    private func tableRows(_ list: String?) -> [MacRepairsRow] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return made(rowsKey(list)) { () -> [MacRepairsRow] in
            let now = Date()
            var base = MacLists.repairs(book.repairs.items, list: list)
            // Without a saved list the place is the work in hand; a search looks through every ticket there is.
            if list == nil && q.isEmpty {
                base = base.filter { $0.status == .received || $0.status == .ready }
            }
            let found = q.isEmpty ? base : base.filter { RepairsKit.matches($0, q) }
            let rows = found.map { MacRepairsRow($0, status: model.desk.status($0), now: now) }
            return rows.sorted(using: sort)
        }
    }

    /// What the rows were made from: a change of any makes them again.
    private func rowsKey(_ list: String?) -> [Int] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let hour = Int(Date().timeIntervalSince1970 / 3600)
        return [book.repairs.revision, q.hashValue, sort.hashValue, (list ?? "").hashValue, model.desk.moves, hour]
    }

    private func summary(_ rows: [MacRepairsRow]) -> [String] {
        let chosen = rows.filter { selection.contains($0.id) }
        let used = chosen.isEmpty ? rows : chosen
        let owing = used.reduce(0.0) { (sum: Double, r: MacRepairsRow) -> Double in sum + r.owed }
        var parts: [String] = [chosen.isEmpty ? count(rows.count) : "\(chosen.count) of \(rows.count) selected"]
        if owing >= 1 { parts.append("\(Money.pkr(owing)) due") }
        return parts
    }

    // MARK: The table

    private func table(_ rows: [MacRepairsRow]) -> some View {
        Table(rows, selection: $selection, sortOrder: $sort) {
            TableColumn("Number", value: \.number) { (r: MacRepairsRow) in
                Text(r.number).monospacedDigit().lineLimit(1)
            }
            .width(min: 76, ideal: 100)
            TableColumn("Piece", value: \.summary) { (r: MacRepairsRow) in
                Text(r.summary)
                    .foregroundStyle(r.status == .collected || r.status == .cancelled ? Color.secondary : Color.primary)
                    .lineLimit(1)
            }
            .width(min: 120, ideal: 180)
            TableColumn("Customer", value: \.customer) { (r: MacRepairsRow) in
                Text(r.customer).lineLimit(1)
            }
            .width(min: 100, ideal: 140)
            TableColumn("Status", value: \.statusLabel) { (r: MacRepairsRow) in
                MacStatus(r.statusLabel, tone: r.statusTone)
            }
            .width(min: 90, ideal: 120)
            TableColumn("Ready by", value: \.promised) { (r: MacRepairsRow) in
                Text(r.readyBy).foregroundStyle(r.readyByTone == .quiet ? Color.primary : r.readyByTone.color).lineLimit(1)
            }
            .width(min: 80, ideal: 130)
            TableColumn("Owed", value: \.owed) { (r: MacRepairsRow) in
                MacAmount(r.owed >= 1 ? r.owed : nil, tone: .owed)
            }
            .width(min: 70, ideal: 90)
            TableColumn("Karigar", value: \.karigar) { (r: MacRepairsRow) in
                Text(r.karigar).lineLimit(1).foregroundStyle(.secondary)
            }
            .width(min: 70, ideal: 100)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            menu(ids)
        } primaryAction: { ids in
            for id in ids.sorted().prefix(5) { openTicket(id) }
        }
        .overlay { if rows.isEmpty { empty } }
    }

    @ViewBuilder
    private var empty: some View {
        let typed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !typed.isEmpty {
            ContentUnavailableView.search(text: typed)
        } else if book.repairs.items.isEmpty {
            ContentUnavailableView("No Repairs Yet", systemImage: "wrench.and.screwdriver",
                                   description: Text(session.isOwner ? "Take one in with New Repair (\u{2325}\u{2318}N)." : "Repairs the shop takes in will show here."))
        } else {
            ContentUnavailableView("Nothing Here", systemImage: "wrench.and.screwdriver",
                                   description: Text("No ticket is on this list."))
        }
    }

    // MARK: Actions

    private var pickedRepairs: [Repair] {
        selection.sorted().compactMap { book.repairs.item($0) }
    }

    private func actions() -> [[MacAction]] {
        model.groups(pickedRepairs, owner: session.isOwner, shopName: session.shop.name, open: { openURL($0) })
    }

    private func openTicket(_ id: String) {
        openPlace?(Route(path: repairsTicketPath(id)))
    }

    /// The form is a document in a window of its own; where the place has no window to open it in, a sheet.
    private func newRepair() {
        if let openPlace {
            openPlace(Route(path: "/repairs?new=1"))
        } else {
            newSheet = true
        }
    }

    @ViewBuilder
    private func menu(_ ids: Set<String>) -> some View {
        let picked = ids.sorted().compactMap { book.repairs.item($0) }
        if !picked.isEmpty {
            Button {
                for r in picked.prefix(5) { openTicket(r.id) }
            } label: {
                Label("Open in New Window", systemImage: "macwindow.badge.plus")
            }
            Divider()
            MacActionItems(groups: model.groups(picked, owner: session.isOwner, shopName: session.shop.name, open: { openURL($0) }))
        }
    }

    /// New Repair, and nothing else: the picked ticket's steps are the inspector's head, the Repair menu's and the
    /// right-click menu's (a Tahoe toolbar of capsules overflowed a 13-inch screen).
    @ToolbarContentBuilder
    private func placeToolbar() -> some ToolbarContent {
        if session.isOwner {
            ToolbarItemGroup(placement: .primaryAction) {
                Button { newRepair() } label: { Label("New Repair", systemImage: "plus") }
                    .help("Take a repair in (\u{2325}\u{2318}N)")
            }
        }
    }

    // MARK: The inspector

    @ViewBuilder
    private func ticketPanel() -> some View {
        if selection.count == 1, let id = selection.first {
            MacRepairsTicket(id: id, seed: nil, model: model).id(id)
        } else if selection.count > 1 {
            let owing = pickedRepairs.reduce(0.0) { (sum: Double, r: Repair) -> Double in sum + RepairsKit.repairBalance(r) }
            MacInspectorEmpty(title: "\(selection.count) Repairs Picked",
                              detail: owing >= 1 ? "\(Money.pkr(owing)) due on them. Pick one to read it." : "Pick one to read it.")
        } else {
            MacInspectorEmpty(title: "No Repair Picked", detail: "Pick a repair in the table to read it here.")
        }
    }
}
#endif
