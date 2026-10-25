import SwiftUI
import ERPCore

/// The karigars (src/app/karigars/page.tsx): not a phone book but a list of what each one is holding right now.
/// Working first, the busiest and most overdue on top, then the free ones; each row says how many pieces are on
/// the bench and how many are overdue. A new karigar is the karigar form (owners).
struct WorkshopKarigarsList: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var query = ""
    @State private var show: Show = .everyone
    #if os(macOS)
    @State private var macPicked = Set<String>()
    @State private var macSort = [KeyPathComparator(\MacKarigarRow.active, order: .reverse)]
    @State private var opened: Route?
    @Environment(\.openPlaceWindow) private var openPlace
    #endif

    private enum Show: String, CaseIterable, Identifiable {
        case everyone, working, free
        var id: String { rawValue }
        var title: String {
            switch self {
            case .everyone: return "Everyone"
            case .working: return "Working"
            case .free: return "Free"
            }
        }
    }

    var body: some View {
        ShelfState(loaded: loaded, error: firstError, offline: book.karigars.offline) {
            content
        }
        .navigationTitle("Karigars")
        .hubTitleDisplay()
        .modifier(HouseGround())
        #if os(macOS)
        .navigationDestination(item: $opened) { (r: Route) in PlaceScreen(path: r.path) }
        #endif
        .searchable(text: $query, prompt: "Name or contact")
        .toolbar {
            if session.isOwner {
                ToolbarItem(placement: .primaryAction) {
                    // The karigar form: an owner's, as the ERP's menu has it.
                    NavigationLink(value: Route(path: "/karigars/add")) {
                        Label("Add karigar", systemImage: "plus")
                    }
                }
            }
        }
        .onAppear {
            book.karigars.need()
            book.orders.need()
            book.invoices.need()
            book.karigarJobs.need()
            // The pay batches are the owner's books: the staff's copy comes without them.
            if session.isOwner { book.karigarBatches.need() }
        }
    }

    private var loaded: Bool {
        let books = book.karigars.loaded && book.orders.loaded && book.invoices.loaded && book.karigarJobs.loaded
        return session.isOwner ? books && book.karigarBatches.loaded : books
    }

    private var firstError: String? {
        let books = book.karigars.error ?? book.orders.error ?? book.invoices.error ?? book.karigarJobs.error
        return session.isOwner ? books ?? book.karigarBatches.error : books
    }

    // MARK: The list

    @ViewBuilder
    private var content: some View {
        let live = workshopLive(book.karigars.items)
        let jobs = WorkshopLogic.buildJobs(
            orders: book.orders.items,
            karigarJobs: book.karigarJobs.items,
            karigars: live,
            invoices: book.invoices.items
        )
        let loads = loadsById(jobs)
        // Who has a hisaab open, and under what name (karigars/page.tsx activeHisaabMap).
        let batches = session.isOwner ? WorkshopLogic.openBatches(book.karigarBatches.items) : [:]
        #if os(macOS)
        macTable(live, loads, batches)
        #else
        list(live, loads, batches)
        #endif
    }

    private func loadsById(_ jobs: [WorkshopJob]) -> [String: WorkshopLoad] {
        var out: [String: WorkshopLoad] = [:]
        for l in WorkshopLogic.groupByKarigar(jobs) { out[l.karigarId] = l }
        return out
    }

    private func list(_ live: [Karigar], _ loads: [String: WorkshopLoad], _ batches: [String: KarigarBatch]) -> some View {
        let matched = live.filter { matches($0) }
        let working = matched
            .filter { (loads[$0.id]?.active ?? 0) > 0 }
            .sorted { busier($0, $1, loads) }
        let free = matched.filter { (loads[$0.id]?.active ?? 0) == 0 }
        return List { Group {
            figures(live, loads, batches)
            showPicker
            if show != .free { section("Working", people: working, loads, batches) }
            if show != .working { section("Free", people: free, loads, batches) }
        }.houseRows()
        }
        .listStyle(.insetGrouped)
        .overlay {
            if (show == .working && working.isEmpty) || (show == .free && free.isEmpty) || matched.isEmpty {
                emptyState.allowsHitTesting(false)
            }
        }
    }

    /// The one holding the most, and the most overdue, is the one to look at.
    private func busier(_ a: Karigar, _ b: Karigar, _ loads: [String: WorkshopLoad]) -> Bool {
        let ca = loads[a.id]?.critical ?? 0
        let cb = loads[b.id]?.critical ?? 0
        if ca != cb { return ca > cb }
        let na = loads[a.id]?.active ?? 0
        let nb = loads[b.id]?.active ?? 0
        if na != nb { return na > nb }
        return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
    }

    private func matches(_ k: Karigar) -> Bool {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if q.isEmpty { return true }
        if k.name.localizedCaseInsensitiveContains(q) { return true }
        // Numbers compare by their digits, so "0300 1234567" finds "+92 300 1234567".
        let wanted = Self.digits(q)
        if wanted.count >= 3 {
            let have = Self.digits(k.contact ?? "")
            return have.contains(wanted) || (wanted.hasPrefix("0") && have.contains(wanted.dropFirst()))
        }
        return (k.contact ?? "").contains(q)
    }

    private static func digits(_ s: String) -> String { s.filter(\.isNumber) }

    // MARK: Figures

    private func figures(_ live: [Karigar], _ loads: [String: WorkshopLoad], _ batches: [String: KarigarBatch]) -> some View {
        var pieces = 0
        var critical = 0
        var grams = 0.0
        for k in live {
            guard let l = loads[k.id] else { continue }
            pieces += l.active
            critical += l.critical
            grams += l.totalWeightG
        }
        // Who is working and who is free are the sections' counts below (rule 15: not said twice).
        return Section {
            FigureGrid {
                FigureTile(label: "Pieces out", value: "\(pieces)", detail: grams > 0 ? WorkshopLogic.number(grams, digits: 0) + "g of metal" : nil)
                FigureTile(label: "Over \(WorkshopLogic.criticalDays) days", value: "\(critical)", tint: critical > 0 ? Tone.late.color : Color.primary)
                if session.isOwner {
                    FigureTile(label: "Open hisaabs", value: "\(batches.count)")
                }
            }
            .padding(.vertical, pt(4))
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
        }
    }

    private var showPicker: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: pt(8)) {
                    ForEach(Show.allCases) { s in
                        FilterChip(title: s.title, chosen: show == s) { Motion.run(reduce: reduceMotion) { show = s } }
                    }
                }
            }
            .chipRowInList()
        }
        .listRowBackground(Color.clear)
    }

    // MARK: Sections and rows

    @ViewBuilder
    private func section(_ title: String, people: [Karigar], _ loads: [String: WorkshopLoad], _ batches: [String: KarigarBatch]) -> some View {
        if !people.isEmpty {
            Section {
                WorkshopCards(items: people) { k in
                    row(k, loads[k.id], batches[k.id])
                }
            } header: {
                LedgerHeading(title: title, count: people.count)
            }
        }
    }

    private func row(_ k: Karigar, _ load: WorkshopLoad?, _ batch: KarigarBatch?) -> some View {
        NavigationLink(value: Route(path: WorkshopLogic.karigarPath(k.id))) {
            VStack(alignment: .leading, spacing: pt(14)) {
                HStack(alignment: .top, spacing: pt(8)) {
                    Text(k.name).font(.headline).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                }
                bench(load)
                if let batch, !batch.label.isEmpty {
                    Label(batch.label, systemImage: "book.closed")
                        .font(.caption).foregroundStyle(Theme.accent)
                }
                if let contact = k.contact, !contact.isEmpty {
                    Label(contact, systemImage: "phone").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .buttonStyle(.plain)
        .zoomSource(id: WorkshopLogic.karigarPath(k.id))
        // The same actions as the page, on a long press (the cards share one list row, so no swipe).
        .contextMenu {
            NavigationLink(value: Route(path: WorkshopLogic.karigarPath(k.id))) {
                Label("Open " + k.name, systemImage: "hammer")
            }
            if let contact = k.contact, !contact.isEmpty, let url = URL(string: "tel:" + Self.digits(contact)) {
                Link(destination: url) { Label("Call", systemImage: "phone") }
            }
            if session.isOwner {
                NavigationLink(value: Route(path: WorkshopLogic.karigarPath(k.id) + "/edit")) {
                    Label("Edit", systemImage: "pencil")
                }
            }
        }
    }

    /// What this karigar is holding, in one line: "3 pieces · 1 over 14d · 2 late · 8.5g out". Free says nothing: he
    /// sits under Free.
    @ViewBuilder
    private func bench(_ load: WorkshopLoad?) -> some View {
        if let load, load.active > 0 {
            VStack(alignment: .leading, spacing: pt(8)) {
                Text(WorkshopLogic.pieces(load.active)).font(.subheadline.weight(.semibold)).monospacedDigit()
                FigureRow(spacing: pt(8)) {
                    if load.critical > 0 { Pill("\(load.critical) over \(WorkshopLogic.criticalDays)d", tone: .late) }
                    if load.late > 0 { Pill("\(load.late) late", tone: .owed) }
                }
                if load.totalWeightG > 0 {
                    Text(WorkshopLogic.number(load.totalWeightG, digits: 1) + "g out")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            ContentUnavailableView.search(text: query)
        } else {
            switch show {
            case .working: EmptyState("Nobody is working", symbol: "person.2", message: "Nothing is on any bench.")
            case .free: EmptyState("Nobody is free", symbol: "person.2", message: "Every karigar has work.")
            case .everyone: EmptyState("No karigars yet", symbol: "person.2", message: session.isOwner ? "Tap + to add one." : nil)
            }
        }
    }
}

#if os(macOS)
/// A karigar as a table row: what he holds, how late, and his open hisaab.
private struct MacKarigarRow: Identifiable {
    let karigar: Karigar
    let load: WorkshopLoad?
    let batch: KarigarBatch?
    var id: String { karigar.id }
    var name: String { karigar.name }
    var contact: String { karigar.contact ?? "" }
    var active: Int { load?.active ?? 0 }
    var critical: Int { load?.critical ?? 0 }
    var late: Int { load?.late ?? 0 }
    var grams: Double { load?.totalWeightG ?? 0 }
    var hisaab: String { batch?.label ?? "" }
}

// The Mac's karigars: a Table (name, contact, pieces out, over 14 days, late, metal out, open hisaab), sortable, with the
// figures in a strip above; Working / Free in the toolbar. Double-click or Return opens a karigar's page, right-click opens it in
// a window of its own, calls, or edits (owners), as the card's long press does on the iPhone.
extension WorkshopKarigarsList {
    func macTable(_ live: [Karigar], _ loads: [String: WorkshopLoad], _ batches: [String: KarigarBatch]) -> some View {
        let rows = live
            .filter { matches($0) }
            .map { MacKarigarRow(karigar: $0, load: loads[$0.id], batch: batches[$0.id]) }
            .filter { show == .everyone || (show == .working) == ($0.active > 0) }
            .sorted(using: macSort)
        return VStack(spacing: 0) {
            macFigures(live, loads, batches)
            Divider()
            Table(rows, selection: $macPicked, sortOrder: $macSort) {
                TableColumn("Name", value: \.name) { (r: MacKarigarRow) in Label(r.name, systemImage: "hammer").fontWeight(.medium) }
                    .width(min: 160, ideal: 220)
                TableColumn("Contact", value: \.contact) { (r: MacKarigarRow) in Text(r.contact).monospacedDigit().foregroundStyle(.secondary) }
                    .width(min: 110, ideal: 150)
                TableColumn("Pieces out", value: \.active) { (r: MacKarigarRow) in Text(r.active > 0 ? "\(r.active)" : "").monospacedDigit() }
                    .width(min: 80, ideal: 90)
                TableColumn("Over \(WorkshopLogic.criticalDays) days", value: \.critical) { (r: MacKarigarRow) in
                    Text(r.critical > 0 ? "\(r.critical)" : "").monospacedDigit().foregroundStyle(Tone.late.color)
                }
                .width(min: 90, ideal: 110)
                TableColumn("Late", value: \.late) { (r: MacKarigarRow) in
                    Text(r.late > 0 ? "\(r.late)" : "").monospacedDigit().foregroundStyle(Tone.owed.color)
                }
                .width(min: 50, ideal: 70)
                TableColumn("Metal out", value: \.grams) { (r: MacKarigarRow) in
                    Text(r.grams > 0 ? WorkshopLogic.number(r.grams, digits: 1) + "g" : "").monospacedDigit()
                }
                .width(min: 80, ideal: 100)
                // Empty for staff: the pay batches are the owner's books.
                TableColumn("Open hisaab", value: \.hisaab) { (r: MacKarigarRow) in
                    Text(r.hisaab).foregroundStyle(Theme.accent).lineLimit(1)
                }
                .width(min: 120, ideal: 180)
            }
            .contextMenu(forSelectionType: String.self) { ids in
                if ids.count == 1, let id = ids.first, let k = live.first(where: { $0.id == id }) {
                    Button("Open " + k.name) { opened = Route(path: WorkshopLogic.karigarPath(k.id)) }
                    Button("Open in New Window") { openPlace?(Route(path: WorkshopLogic.karigarPath(k.id))) }
                    if let contact = k.contact, !contact.isEmpty, let url = URL(string: "tel:" + Self.digits(contact)) {
                        Link(destination: url) { Label("Call", systemImage: "phone") }
                    }
                    if session.isOwner {
                        Divider()
                        Button("Edit") { opened = Route(path: WorkshopLogic.karigarPath(k.id) + "/edit") }
                    }
                }
            } primaryAction: { ids in
                if ids.count == 1, let id = ids.first { opened = Route(path: WorkshopLogic.karigarPath(id)) }
            }
            .overlay {
                if rows.isEmpty { emptyState.allowsHitTesting(false) }
            }
        }
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("Show", selection: $show) {
                    ForEach(Show.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
            }
        }
    }

    private func macFigures(_ live: [Karigar], _ loads: [String: WorkshopLoad], _ batches: [String: KarigarBatch]) -> some View {
        var pieces = 0
        var critical = 0
        var grams = 0.0
        for k in live {
            guard let l = loads[k.id] else { continue }
            pieces += l.active
            critical += l.critical
            grams += l.totalWeightG
        }
        return HStack(alignment: .top, spacing: 10) {
            FigureTile(label: "Pieces out", value: "\(pieces)", detail: grams > 0 ? WorkshopLogic.number(grams, digits: 0) + "g of metal" : nil)
            FigureTile(label: "Over \(WorkshopLogic.criticalDays) days", value: "\(critical)", tint: critical > 0 ? Tone.late.color : Color.primary)
            if session.isOwner {
                FigureTile(label: "Open hisaabs", value: "\(batches.count)")
            }
        }
        .frame(maxWidth: 640)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16).padding(.vertical, 12)
    }
}
#endif
