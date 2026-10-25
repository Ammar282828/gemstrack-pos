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
    /// The jobs and the rows worked out once per change of the books, the search, the filter and the sort.
    @State private var macJobsMemo = Memo<[WorkshopJob]>()
    @State private var macRowsMemo = Memo<MacKarigarRows>()
    /// The rows in the table's order: a change of sort sorts again, it never works out his cash again.
    @State private var macSortedMemo = Memo<[MacKarigarRow]>()
    @State private var macPositionMemo = Memo<WorkshopPosition>()
    /// Pay… asked for: the same sheet as his page's Add payment.
    @State private var paying: MacKarigarPay?
    @State private var note: Note?
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
        #if os(macOS)
        .macSearchable(text: $query, prompt: "Search Karigars")
        #else
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
        #endif
        .onAppear {
            book.karigars.need()
            book.orders.need()
            book.invoices.need()
            book.karigarJobs.need()
            // The pay batches are the owner's books: the staff's copy comes without them.
            if session.isOwner { book.karigarBatches.need() }
            #if os(macOS)
            // The inspector's Now: what has been handed to him, his hisaab cash, and Pay…'s categories.
            book.givenItems.need()
            if session.isOwner {
                book.hisaab.need()
                book.expenses.need()
            }
            #endif
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
        #if os(macOS)
        macContent
        #else
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
/// A karigar as a table row: what he holds, how late, his hisaab cash and his open hisaab.
private struct MacKarigarRow: Identifiable {
    let karigar: Karigar
    let load: WorkshopLoad?
    let batch: KarigarBatch?
    /// His hisaab cash, positive when he holds the shop's money (WorkshopPosition.cashBalance); 0 for staff, who do not read it.
    let cash: Double
    var id: String { karigar.id }
    var name: String { karigar.name }
    var contact: String { karigar.contact ?? "" }
    var active: Int { load?.active ?? 0 }
    var critical: Int { load?.critical ?? 0 }
    var late: Int { load?.late ?? 0 }
    /// Active pieces 7 days old or more (late, and the critical ones among them).
    var overdue: Int { load?.overdue ?? 0 }
    var grams: Double { load?.totalWeightG ?? 0 }
    var hisaab: String { batch?.label ?? "" }
}

/// The rows, and the figures over every karigar, worked out once.
private struct MacKarigarRows {
    var rows: [MacKarigarRow] = []
    var byId: [String: MacKarigarRow] = [:]
    var pieces = 0
    var critical = 0
    var hisaabs = 0
    var grams = 0.0
}

/// Pay… asked for on a karigar with a pay batch open.
private struct MacKarigarPay: Identifiable {
    let karigar: Karigar
    let batch: KarigarBatch
    var id: String { karigar.id }
}

// The Mac's karigars (docs/features/mac-design.md, "Workshop"): a Table (name, contact, pieces out, over 14 days, late, metal out,
// what he holds of ours or we owe him, his open hisaab), sortable, the picked karigar in the inspector (his Now, his details,
// Pay…), a summary bar at the foot, and his actions declared once for the Karigar menu, the toolbar and the right-click menu.
// Return or a double-click opens his page in a window of its own.
extension WorkshopKarigarsList {
    var macContent: some View {
        let data = macData()
        return macTable(data)
            .overlay {
                if data.rows.isEmpty { macEmpty.allowsHitTesting(false) }
            }
            .macSummaryBar(macSummary(data))
            .toolbar { macToolbar(data) }
            .macInspector { macInspectorPanel(data) }
            .macRecordMenu(MacRecordMenu(title: "Karigar", groups: macGroups(Array(macPicked), data)))
            .navigationSubtitle("\(data.rows.count) karigar\(data.rows.count == 1 ? "" : "s")")
            .sheet(item: $paying) { (p: MacKarigarPay) in
                WorkshopPaySheet(
                    karigar: p.karigar, batch: p.batch,
                    categories: ExpenseFigures.formCategories(shop: session.shop.expenseCategories, expenses: book.expenses.items),
                    partnership: session.shop.partnership,
                    onSaved: { (n: Note) in Note.show(n, in: $note, reduce: reduceMotion) }
                )
            }
            .noteToast($note)
    }

    // MARK: The rows, worked out once

    private func macJobs() -> [WorkshopJob] {
        let key: [Int] = [book.orders.revision, book.invoices.revision, book.karigars.revision, book.karigarJobs.revision]
        return macJobsMemo(key) {
            WorkshopLogic.buildJobs(
                orders: book.orders.items,
                karigarJobs: book.karigarJobs.items,
                karigars: workshopLive(book.karigars.items),
                invoices: book.invoices.items
            )
        }
    }

    private func macData() -> MacKarigarRows {
        let jobs = macJobs()
        // His cash is worked out for every karigar, so the rows wait for a change of the books and keep it across a sort.
        let key: [Int] = [book.orders.revision, book.invoices.revision, book.karigars.revision, book.karigarJobs.revision,
                   book.karigarBatches.revision, book.hisaab.revision, query.hashValue, show.rawValue.hashValue,
                   session.isOwner ? 1 : 0]
        let base = macRowsMemo(key) {
            let live = workshopLive(book.karigars.items)
            let loads = loadsById(jobs)
            let owner = session.isOwner
            let batches = owner ? WorkshopLogic.openBatches(book.karigarBatches.items) : [:]
            let khata: [HisaabEntry] = owner ? book.hisaab.items : []
            var out = MacKarigarRows()
            for k in live {
                if let l = loads[k.id] {
                    out.pieces += l.active
                    out.critical += l.critical
                    out.grams += l.totalWeightG
                }
            }
            out.hisaabs = batches.count
            let rows = live
                .filter { matches($0) }
                .map { (k: Karigar) -> MacKarigarRow in
                    let cash = owner
                        ? WorkshopPosition(karigarId: k.id, karigarName: k.name, jobs: [], givenItems: [], hisaab: khata).cashBalance
                        : 0
                    return MacKarigarRow(karigar: k, load: loads[k.id], batch: batches[k.id], cash: cash)
                }
                .filter { show == .everyone || (show == .working) == ($0.active > 0) }
            out.rows = rows
            for r in rows { out.byId[r.id] = r }
            return out
        }
        var out = base
        out.rows = macSortedMemo(key + [macSort.hashValue]) { base.rows.sorted(using: macSort) }
        return out
    }

    private func macSummary(_ data: MacKarigarRows) -> [String] {
        let picked = macPicked.compactMap { data.byId[$0] }
        if !picked.isEmpty {
            let pieces = picked.reduce(0) { $0 + $1.active }
            return ["\(picked.count) selected", WorkshopLogic.pieces(pieces) + " out"]
        }
        var parts = ["\(data.rows.count) karigar\(data.rows.count == 1 ? "" : "s")", WorkshopLogic.pieces(data.pieces) + " out"]
        if data.critical > 0 { parts.append("\(data.critical) over \(WorkshopLogic.criticalDays) days") }
        if data.grams > 0 { parts.append(WorkshopLogic.number(data.grams, digits: 0) + "g of metal") }
        if session.isOwner { parts.append("\(data.hisaabs) open hisaab\(data.hisaabs == 1 ? "" : "s")") }
        return parts
    }

    // MARK: The table

    /// Seven columns, the name the wide one; his over-14-day pieces are the Late column's red, his whole page the inspector's.
    private func macTable(_ data: MacKarigarRows) -> some View {
        Table(data.rows, selection: $macPicked, sortOrder: $macSort) {
            TableColumn("Name", value: \.name) { (r: MacKarigarRow) in
                Label(r.name, systemImage: "hammer").fontWeight(.medium).lineLimit(1)
            }
            .width(min: 120, ideal: 200)
            TableColumn("Contact", value: \.contact) { (r: MacKarigarRow) in
                Text(r.contact).monospacedDigit().lineLimit(1).foregroundStyle(.secondary)
            }
            .width(min: 100, ideal: 130)
            TableColumn("Pieces", value: \.active) { (r: MacKarigarRow) in
                Text(r.active > 0 ? "\(r.active)" : "").monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 56, ideal: 64)
            TableColumn("Late", value: \.overdue) { (r: MacKarigarRow) in
                Text(r.overdue > 0 ? "\(r.overdue)" : "").monospacedDigit()
                    .foregroundStyle(r.critical > 0 ? Tone.late.color : Tone.owed.color)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .help(r.critical > 0 ? "\(r.critical) of them over \(WorkshopLogic.criticalDays) days" : "")
            }
            .width(min: 48, ideal: 56)
            TableColumn("Metal", value: \.grams) { (r: MacKarigarRow) in
                Text(r.grams > 0 ? WorkshopLogic.number(r.grams, digits: 1) + "g" : "").monospacedDigit().lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 70, ideal: 90)
            // Empty for staff: the hisaab is the owner's book.
            TableColumn("Cash", value: \.cash) { (r: MacKarigarRow) in
                Text(macCashWords(r.cash)).monospacedDigit().lineLimit(1).foregroundStyle(r.cash.rounded() < 0 ? Tone.owed.color : Color.primary)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 90, ideal: 120)
            TableColumn("Hisaab", value: \.hisaab) { (r: MacKarigarRow) in
                Text(r.hisaab).foregroundStyle(Theme.accent).lineLimit(1)
            }
            .width(min: 90, ideal: 140)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if !ids.isEmpty { MacActionItems(groups: macGroups(Array(ids), data)) }
        } primaryAction: { ids in
            for id in ids.sorted().prefix(5) { macOpenRoute(WorkshopLogic.karigarPath(id)) }
        }
    }

    /// "Holds 5,000", "We owe 3,000" (digits: the header says it is cash); nothing for staff or when square.
    private func macCashWords(_ cash: Double) -> String {
        guard session.isOwner else { return "" }
        let rounded = cash.rounded()
        if rounded > 0 { return "Holds " + Money.grouped(rounded) }
        if rounded < 0 { return "We owe " + Money.grouped(-rounded) }
        return ""
    }

    /// The Mac's empty list: what is missing and how to make one (the key).
    @ViewBuilder
    private var macEmpty: some View {
        if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            ContentUnavailableView.search(text: query)
        } else {
            switch show {
            case .working: ContentUnavailableView("Nobody Is Working", systemImage: "person.2", description: Text("Nothing is on any bench."))
            case .free: ContentUnavailableView("Nobody Is Free", systemImage: "person.2", description: Text("Every karigar has work."))
            case .everyone:
                ContentUnavailableView("No Karigars Yet", systemImage: "person.2",
                                       description: Text(session.isOwner ? "Add one with \u{2303}\u{2318}N." : "The owner adds karigars."))
            }
        }
    }

    // MARK: The toolbar and the actions

    @ToolbarContentBuilder
    private func macToolbar(_ data: MacKarigarRows) -> some ToolbarContent {
        // New and the one filter; the picked karigar's Pay… is the inspector's, the Karigar menu's and the right-click menu's.
        ToolbarItemGroup(placement: .automatic) {
            MacToolbarAction(action: macNewAction)
            macFilterMenu
        }
    }

    private var macFilterMenu: some View {
        Menu {
            Picker("Show", selection: $show) {
                ForEach(Show.allCases) { (s: Show) in Text(s.title).tag(s) }
            }
            .pickerStyle(.inline)
        } label: {
            Label("Filter", systemImage: show == .everyone ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
        }
        .help("Everyone, only those with work, or only those with none")
    }

    private var macNewAction: MacAction {
        MacAction("New Karigar\u{2026}", symbol: "plus", shortcut: KeyboardShortcut("n", modifiers: [.control, .command]),
                  enabled: session.isOwner) { macOpenRoute("/karigars/add") }
    }

    private func macPayAction(_ ids: [String], _ data: MacKarigarRows) -> MacAction {
        let row: MacKarigarRow? = ids.count == 1 ? ids.first.flatMap { data.byId[$0] } : nil
        return MacAction("Pay\u{2026}", symbol: "banknote", enabled: session.isOwner && row != nil) {
            guard let row else { return }
            if let batch = row.batch {
                paying = MacKarigarPay(karigar: row.karigar, batch: batch)
            } else {
                // No pay batch is open: his page starts one.
                macOpenRoute(WorkshopLogic.karigarPath(row.karigar.id))
            }
        }
    }

    /// Every action of a karigar, for the Karigar menu (the ones picked) and the right-click menu (the ones clicked).
    private func macGroups(_ ids: [String], _ data: MacKarigarRows) -> [[MacAction]] {
        let one = ids.count == 1
        let row: MacKarigarRow? = one ? ids.first.flatMap { data.byId[$0] } : nil
        let some = !ids.isEmpty
        let phone = row?.karigar.contact.map { WorkshopLogic.dialable($0) } ?? ""
        let opening = MacAction("Open Karigar", symbol: "hammer", enabled: some) {
            for id in ids.sorted().prefix(5) { macOpenRoute(WorkshopLogic.karigarPath(id)) }
        }
        let editing = MacAction("Edit\u{2026}", symbol: "pencil", shortcut: KeyboardShortcut("e", modifiers: .command),
                                enabled: session.isOwner && one) {
            if let row { macOpenRoute(WorkshopLogic.karigarPath(row.karigar.id) + "/edit") }
        }
        let calling = MacAction("Call", symbol: "phone", enabled: !phone.isEmpty) {
            if let url = URL(string: "tel:" + phone) { UIApplication.shared.open(url) }
        }
        let preview = MacAction("Their View", symbol: "eye", enabled: session.isOwner && one) {
            if let row { macOpenRoute("/my-work?preview=" + WorkshopLogic.piece(row.karigar.id)) }
        }
        let creating: [MacAction] = [macNewAction]
        let visiting: [MacAction] = [opening, macPayAction(ids, data)]
        let changing: [MacAction] = [editing, calling, preview]
        return [creating, visiting, changing]
    }

    /// A karigar's page opens in a window of its own where the window can; otherwise in this one, as before.
    private func macOpenRoute(_ path: String) {
        if let openPlace { openPlace(Route(path: path)) } else { opened = Route(path: path) }
    }

    // MARK: The inspector

    @ViewBuilder
    private func macInspectorPanel(_ data: MacKarigarRows) -> some View {
        let picked = macPicked.compactMap { data.byId[$0] }
        if picked.count == 1, let row = picked.first {
            macKarigarInspector(row, data)
        } else if picked.isEmpty {
            MacInspectorEmpty(title: "No Karigar Selected", detail: "Pick a karigar to see what he holds of ours and his details.")
        } else {
            MacInspectorEmpty(title: "\(picked.count) Karigars", detail: "Pick one to see his page.")
        }
    }

    private func macKarigarInspector(_ row: MacKarigarRow, _ data: MacKarigarRows) -> some View {
        let k = row.karigar
        let position = macPosition(k)
        let headline: MacHeadline? = session.isOwner ? MacKarigarFigures.headline(cash: position.cashBalance) : nil
        var tone: Tone = .quiet
        if row.critical > 0 { tone = .late } else if row.active > 0 { tone = .working }
        let status = MacStatus(row.active > 0 ? WorkshopLogic.pieces(row.active) + " out" : "Free", tone: tone)
        return Form {
            Section {
                MacInspectorHeader(
                    title: k.name,
                    subtitle: [k.contact ?? "", k.specialty ?? ""].filter { !$0.isEmpty }.joined(separator: " \u{00B7} "),
                    status: status,
                    headline: headline,
                    actions: [
                        MacAction("Open", isDefault: true) { macOpenRoute(WorkshopLogic.karigarPath(k.id)) },
                        macPayAction([k.id], data),
                    ]
                )
            }
            Section("Now") { macNowRows(row, position) }
            Section("Details") { MacKarigarDetailRows(karigar: k) }
        }
        .formStyle(.grouped)
    }

    /// His position, worked out for the one karigar picked (his bench, the metal, the khata, what was handed to him).
    private func macPosition(_ k: Karigar) -> WorkshopPosition {
        let key: [Int] = [book.orders.revision, book.invoices.revision, book.karigars.revision, book.karigarJobs.revision,
                   book.givenItems.revision, book.hisaab.revision, k.id.hashValue, session.isOwner ? 1 : 0]
        return macPositionMemo(key) {
            WorkshopPosition(karigarId: k.id, karigarName: k.name, jobs: macJobs(), givenItems: book.givenItems.items,
                             hisaab: session.isOwner ? book.hisaab.items : [])
        }
    }

    @ViewBuilder
    private func macNowRows(_ row: MacKarigarRow, _ p: WorkshopPosition) -> some View {
        LabeledContent("On his bench") {
            Text(p.bench.isEmpty ? "nothing open" : WorkshopLogic.pieces(p.bench.count) + " \u{00B7} oldest \(p.bench[0].ageDays) d")
                .monospacedDigit()
        }
        LabeledContent("Pieces weigh (est.)") {
            Text(p.metals.isEmpty ? "\u{2014}" : p.metals.map { WorkshopLogic.grams3($0.grams) }.joined(separator: " \u{00B7} ")).monospacedDigit()
        }
        if session.isOwner {
            LabeledContent("Gold khata") {
                Text(WorkshopLogic.grams3(p.khataNet)).monospacedDigit().foregroundStyle(p.khataNet > 0.0005 ? Tone.owed.color : Color.primary)
            }
        }
        if !p.given.isEmpty {
            LabeledContent("Handed to him, not back", value: "\(p.given.count)")
        }
        if let batch = row.batch, !batch.label.isEmpty {
            LabeledContent("Open hisaab", value: batch.label)
        }
    }
}
#endif
