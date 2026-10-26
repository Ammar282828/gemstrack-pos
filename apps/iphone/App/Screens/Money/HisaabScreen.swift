import SwiftUI
import ERPCore

/// Which side of the book: everyone, only those who owe the shop, only those the shop owes.
enum HisaabChip: String, CaseIterable, Identifiable {
    case all, get, give

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "All"
        case .get: return "You will get"
        case .give: return "You will give"
        }
    }

    func matches(_ a: HisaabAccount) -> Bool {
        switch self {
        case .all: return true
        case .get: return a.side == .get
        case .give: return a.side == .give
        }
    }
}

enum HisaabKind: String, CaseIterable, Identifiable {
    case everyone, customers, karigars

    var id: String { rawValue }

    var title: String {
        switch self {
        case .everyone: return "Everyone"
        case .customers: return "Customers"
        case .karigars: return "Karigars"
        }
    }

    func matches(_ a: HisaabAccount) -> Bool {
        switch self {
        case .everyone: return true
        case .customers: return a.isCustomer
        case .karigars: return !a.isCustomer
        }
    }
}

/// By name is the web's order (hisaab/page.tsx sorts by name); who owes first is the phone's extra.
enum HisaabOrder: String, CaseIterable, Identifiable {
    case name, owesFirst

    var id: String { rawValue }

    var title: String {
        switch self {
        case .name: return "By name"
        case .owesFirst: return "Who owes you first"
        }
    }
}

/// Money → Hisaab (src/app/hisaab/page.tsx): customers' and karigars' outstanding accounts, what the
/// shop will get and what it will give. Every figure is debit less credit over a person's rows, as the
/// web works it. Opening a person shows their ledger, where entries are written and deleted (HisaabLedgerScreen);
/// Add entry here chooses the account first (HisaabAccountPicker). The Summary PDF is the page's own, drawn by the
/// ERP's server (src/lib/hisaab-pdf.ts, /api/app/pdf/hisaab) for the search on screen, as the page's prints its search.
struct HisaabScreen: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    @State private var search = ""
    @State private var chip: HisaabChip = .all
    @State private var kind: HisaabKind = .everyone
    @State private var order: HisaabOrder = .name
    /// The Hisaab page re-checks the books' outstanding balances on every visit (syncHisaabOutstandingBalances);
    /// once per opening of this list is the same.
    @State private var synced = false
    @State private var picking = false
    /// Where the account picker sends us once it has closed, and the place pushed for it.
    @State private var pending: Route?
    @State private var go: Route?
    @State private var summaryPDF: InvoicePDFTarget?
    #if os(macOS)
    @Environment(\.openPlaceWindow) private var openPlace
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var macPick = Set<String>()
    @State private var macMade = Memo<HisaabMacData>()
    @State private var macRowsMade = Memo<HisaabMacRows>()
    @State private var macLedgerMade = Memo<HisaabLedgerPage>()
    @State private var macEntry: HisaabMacEntry?
    @State private var macNote: Note?
    #endif

    var body: some View {
        if session.isOwner {
            #if os(macOS)
            macOwners
            #else
            owners
            #endif
        } else {
            MoneyOwnersOnly(title: "Hisaab")
        }
    }

    private var ready: Bool {
        book.hisaab.loaded && book.invoices.loaded && book.customers.loaded && book.karigars.loaded
    }

    private var owners: some View {
        ShelfState(loaded: ready, error: book.hisaab.error, offline: book.hisaab.offline) {
            content
        }
        .navigationTitle("Hisaab")
        .hubTitleDisplay()
        .searchable(text: $search, prompt: "Search by name")
        .toolbar {
            #if !os(macOS)
            ToolbarItem(placement: .topBarTrailing) { filterMenu }
            #endif
            ToolbarItem(placement: .trailingAction) {
                Button { picking = true } label: {
                    Label("Add entry", systemImage: "plus")
                }
                #if os(macOS)
                .keyboardShortcut("e", modifiers: [.command, .shift])
                .help("Add an entry: choose the account first (\u{21E7}\u{2318}E)")
                #endif
            }
        }
        .sheet(isPresented: $picking, onDismiss: {
            if let next = pending {
                pending = nil
                go = next
            }
        }) {
            HisaabAccountPicker { (route: Route) in pending = route }
                .presentationSizing(.form)
        }
        .navigationDestination(item: $go) { (r: Route) in
            HisaabDestination(path: r.path)
        }
        .navigationDestination(item: $summaryPDF) { t in
            PDFDocumentScreen(path: t.path, fileName: t.fileName, title: t.title)
        }
        .task {
            book.hisaab.need()
            book.invoices.need()
            book.customers.need()
            book.karigars.need()
            syncOnce()
        }
    }

    /// The ERP brings each customer's invoice balance rows up to date (an owner's write); the screen
    /// never waits for it, and the shelves show what it changed by themselves. Offline, or in the demo,
    /// it just does not happen.
    private func syncOnce() {
        if synced { return }
        synced = true
        Task { _ = try? await ERPAPI.shared.write("syncHisaab", [:]) }
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        #if os(macOS)
        macContent
        #else
        let customerIds = Set(book.customers.items.map { $0.id })
        let summary = HisaabBook.summary(entries: book.hisaab.items, invoices: book.invoices.items, customerIds: customerIds)
        let onInvoices = owedToYou(book.invoices.items).total
        let scoped = scope(summary.accounts)
        let shown = ordered(scoped.filter { chip.matches($0) })
        List { Group {
            Section {
                tiles(summary, onInvoices: onInvoices)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
            Section {
                chipRow(scoped)
                    .chipRowInList()
            }
            if shown.isEmpty {
                Section { emptyState }
            } else {
                Section {
                    ForEach(shown) { account in rows(account) }
                }
            }
        }.houseRows()
        }
        .listStyle(.insetGrouped)
        .motion(chip, Motion.travel)
        .motion(kind, Motion.travel)
        .motion(order, Motion.travel)
        #endif
    }

    /// Search and the kind of person: everything but the side, so each chip can count what it would show.
    private func scope(_ all: [HisaabAccount]) -> [HisaabAccount] {
        let q = search.trimmingCharacters(in: .whitespacesAndNewlines)
        var out: [HisaabAccount] = []
        for a in all {
            if !kind.matches(a) { continue }
            if !q.isEmpty && !a.name.localizedCaseInsensitiveContains(q) { continue }
            out.append(a)
        }
        return out
    }

    /// By name, as the web lists them; or who owes the shop first, the biggest debt first, then those
    /// the shop owes, the biggest first.
    private func ordered(_ list: [HisaabAccount]) -> [HisaabAccount] {
        switch order {
        case .name:
            return list.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        case .owesFirst:
            return list.sorted { (a: HisaabAccount, b: HisaabAccount) -> Bool in
                let sa = a.side == .get ? 0 : 1
                let sb = b.side == .get ? 0 : 1
                if sa != sb { return sa < sb }
                if a.hasCash != b.hasCash { return a.hasCash }
                if a.size != b.size { return a.size > b.size }
                return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
            }
        }
    }

    private var emptyState: some View {
        let searching = !search.isEmpty
        return ContentUnavailableView(
            searching ? "No accounts found" : "All settled",
            systemImage: "book.closed",
            description: Text(searching ? "No accounts match your search." : "All accounts are settled. No outstanding balances found.")
        )
    }

    // MARK: Figures

    private func tiles(_ s: HisaabSummary, onInvoices: Double) -> some View {
        var getLines: [String] = []
        if s.receivableGold > 0 { getLines.append("\(MoneyFormat.grams(s.receivableGold)) \(MoneyWords.metal)") }
        getLines.append("On invoices: \(Money.pkr(onInvoices))")
        var giveLines: [String] = []
        if s.payableGold > 0 { giveLines.append("\(MoneyFormat.grams(s.payableGold)) \(MoneyWords.metal)") }
        return FigureRow(alignment: .top, spacing: pt(10)) {
            FigureTile(label: "You will get", value: Money.pkr(s.receivable), detail: getLines.joined(separator: "\n"), tint: Tone.owed.color)
            FigureTile(label: "You will give", value: Money.pkr(s.payable), detail: giveLines.isEmpty ? nil : giveLines.joined(separator: "\n"), tint: Tone.credit.color)
        }
        .padding(.vertical, pt(4))
    }

    // MARK: Rows

    @ViewBuilder
    private func rows(_ a: HisaabAccount) -> some View {
        if a.isWalkIn {
            // Walk-ins have no account page; each of their invoices is the way in.
            HisaabAccountRow(account: a, listInvoices: false)
            ForEach(a.unpaid) { inv in
                NavigationLink(value: Route(path: MoneyPaths.invoice(inv.id))) {
                    HisaabUnpaidLine(invoice: inv)
                }
            }
        } else {
            NavigationLink(value: Route(path: MoneyPaths.ledger(a.id, isCustomer: a.isCustomer))) {
                HisaabAccountRow(account: a, listInvoices: true)
            }
            .zoomSource(id: MoneyPaths.ledger(a.id, isCustomer: a.isCustomer))
        }
    }

    // MARK: Chips and the menu

    private func chipRow(_ scoped: [HisaabAccount]) -> some View {
        ChipRow {
            ForEach(HisaabChip.allCases) { (c: HisaabChip) in
                chipButton(c, count: scoped.filter { c.matches($0) }.count)
            }
        }
    }

    private func chipButton(_ c: HisaabChip, count: Int) -> some View {
        FilterChip(title: c.title, count: count, chosen: c == chip) { chip = c }
    }

    private var filterMenu: some View {
        let filtering = kind != .everyone || order != .name
        return Menu {
            Picker("Order", selection: $order) {
                ForEach(HisaabOrder.allCases) { (o: HisaabOrder) in Text(o.title).tag(o) }
            }
            Picker("Show", selection: $kind) {
                ForEach(HisaabKind.allCases) { (k: HisaabKind) in Text(k.title).tag(k) }
            }
            Divider()
            // Everyone outstanding whose name matches the search, as the ERP prints it; the chips are not applied.
            Button {
                summaryPDF = InvoicePDFTarget(path: MoneyPaths.hisaabSummary(search: search),
                                              fileName: "Hisaab-Summary-\(MoneyCalendar.pickedDay(Date())).pdf",
                                              title: "Hisaab summary")
            } label: {
                Label("Summary PDF", systemImage: "doc.richtext")
            }
        } label: {
            Label("Filter", systemImage: filtering ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
    }
}

#if os(macOS)

// MARK: - The Mac place

/// One account as a table row, to sort by.
private struct HisaabMacRow: Identifiable {
    let account: HisaabAccount
    let name: String
    let kind: String
    let invoices: Int
    let gold: Double
    let cash: Double
    /// What the shop will get and will give, as two sortable columns of digits.
    let youGet: Double
    let youGive: Double
    /// The metal owed either way, in words ("12.5 g to receive"), made once with the row.
    let metal: String
    var id: String { account.id }

    init(_ a: HisaabAccount) {
        account = a
        name = a.name
        kind = a.isWalkIn ? "Walk-ins" : (a.isCustomer ? "Customer" : "Karigar")
        invoices = a.unpaid.count
        gold = a.gold
        cash = a.cash
        youGet = a.hasCash ? max(0, a.cash) : 0
        youGive = a.hasCash ? max(0, -a.cash) : 0
        metal = a.gold == 0 ? "" : "\(MoneyFormat.grams(abs(a.gold))) \(a.gold > 0 ? "to receive" : "to pay")"
    }
}

/// The books' hisaab worked out once per change of them (HisaabBook walks every ledger row and invoice).
private struct HisaabMacData {
    let summary: HisaabSummary
    let onInvoices: Double
    let byId: [String: HisaabAccount]
}

/// The rows of the table (search, who and side applied, sorted), and how many each side holds for the pop-up.
private struct HisaabMacRows {
    let rows: [HisaabMacRow]
    let all: Int
    let get: Int
    let give: Int
}

/// "You Gave…" or "You Got…" on the picked account: the entry sheet of the ledger page, over the table.
private struct HisaabMacEntry: Identifiable {
    let mode: HisaabEntryMode
    let personId: String
    let personName: String
    let isCustomer: Bool
    var id: String { mode.rawValue + personId }
}

/// Hisaab as a Mac place (docs/features/mac-design.md, "Money"): every account as a sortable table, what the shop will get and
/// give in the summary bar, the picked account's ledger in the inspector. The Hisaab menu is New Hisaab Entry… (choose the
/// account first), You Gave… (⇧⌘G) and You Got… (⇧⌘R) on the picked account, and Open Ledger (Return, or a double-click:
/// the ledger in a window of its own).
extension HisaabScreen {
    @ViewBuilder
    var macOwners: some View {
        let data = macData()
        ShelfState(loaded: ready, error: book.hisaab.error, offline: book.hisaab.offline) {
            macContent
        }
        .navigationTitle("Hisaab")
        .macSearchable(text: $search, prompt: "Search Hisaab")
        .macInspector { macPanel(data) }
        .toolbar { macToolbar(data) }
        .macRecordMenu(MacRecordMenu(title: "Hisaab", groups: macGroups(for: macPick, data)))
        .sheet(isPresented: $picking, onDismiss: {
            if let next = pending {
                pending = nil
                macOpen(next)
            }
        }) {
            HisaabAccountPicker { (route: Route) in pending = route }
                .presentationSizing(.form)
        }
        .sheet(item: $macEntry) { (e: HisaabMacEntry) in
            HisaabEntrySheet(mode: e.mode, personId: e.personId, personName: e.personName, isCustomer: e.isCustomer) { (saved: Note) in
                Note.show(saved, in: $macNote, reduce: reduceMotion)
            }
        }
        .navigationDestination(item: $go) { (r: Route) in
            HisaabDestination(path: r.path)
        }
        .navigationDestination(item: $summaryPDF) { t in
            PDFDocumentScreen(path: t.path, fileName: t.fileName, title: t.title)
        }
        .noteToast($macNote)
        .task {
            book.hisaab.need()
            book.invoices.need()
            book.customers.need()
            book.karigars.need()
            syncOnce()
        }
    }

    // MARK: Worked out once

    private func macData() -> HisaabMacData {
        let key = [book.hisaab.revision, book.invoices.revision, book.customers.revision]
        return macMade(key) {
            let customerIds = Set(book.customers.items.map { (c: Customer) in c.id })
            let summary = HisaabBook.summary(entries: book.hisaab.items, invoices: book.invoices.items, customerIds: customerIds)
            var byId: [String: HisaabAccount] = [:]
            for a in summary.accounts { byId[a.id] = a }
            return HisaabMacData(summary: summary, onInvoices: owedToYou(book.invoices.items).total, byId: byId)
        }
    }

    private func macRows(_ data: HisaabMacData) -> HisaabMacRows {
        let key = [book.hisaab.revision, book.invoices.revision, book.customers.revision, search.hashValue, kind.hashValue,
                   chip.hashValue, order.hashValue]
        return macRowsMade(key) {
            let scoped = scope(data.summary.accounts)
            let shown = ordered(scoped.filter { (a: HisaabAccount) in chip.matches(a) }).map { (a: HisaabAccount) in HisaabMacRow(a) }
            return HisaabMacRows(rows: shown,
                                 all: scoped.count,
                                 get: scoped.filter { (a: HisaabAccount) in HisaabChip.get.matches(a) }.count,
                                 give: scoped.filter { (a: HisaabAccount) in HisaabChip.give.matches(a) }.count)
        }
    }

    // MARK: The table

    @ViewBuilder
    var macContent: some View {
        let data = macData()
        let made = macRows(data)
        let rows = made.rows
        List(selection: $macPick) {
            // The rows are the iPhone's on the card colour, as Customers' and Invoices' are: the monogram, the name over one
            // line, the sum at the right. Every row is two lines, so the list keeps one rhythm.
            Section {
                ForEach(rows) { (r: HisaabMacRow) in
                    HisaabMacListRow(account: r.account)
                        .tag(r.id)
                }
            }
            .houseRows()
        }
        .listStyle(.inset)
        .modifier(HouseGround())
        .contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
            MacActionItems(groups: macGroups(for: ids, data))
        } primaryAction: { (ids: Set<String>) in
            for id in ids.prefix(5) {
                if let a = data.byId[id] { macOpenAccount(a) }
            }
        }
        .overlay { if rows.isEmpty { macEmptyState } }
        .macSummaryBar(macSummary(rows, data))
        .navigationSubtitle("\(rows.count) account\(rows.count == 1 ? "" : "s")")
    }

    @ViewBuilder
    private var macEmptyState: some View {
        if search.isEmpty && book.hisaab.items.isEmpty {
            ContentUnavailableView("No Accounts Yet", systemImage: "book.closed",
                                   description: Text("Write the first entry with \u{2303}\u{2318}N."))
        } else {
            emptyState
        }
    }

    /// What the page's tiles said, as the one line a list ends in; with accounts picked, what the picked ones come to.
    private func macSummary(_ rows: [HisaabMacRow], _ data: HisaabMacData) -> [String] {
        if macPick.count > 1 {
            let picked = rows.filter { (r: HisaabMacRow) in macPick.contains(r.id) }
            let get = picked.reduce(0.0) { (sum: Double, r: HisaabMacRow) in sum + max(0, r.cash) }
            let give = picked.reduce(0.0) { (sum: Double, r: HisaabMacRow) in sum + abs(min(0, r.cash)) }
            var parts = ["\(picked.count) selected"]
            if get >= 1 { parts.append("You will get \(Money.pkr(get))") }
            if give >= 1 { parts.append("You will give \(Money.pkr(give))") }
            return parts
        }
        let s = data.summary
        var parts = ["\(rows.count) account\(rows.count == 1 ? "" : "s")"]
        var get = "You will get \(Money.pkr(s.receivable))"
        if s.receivableGold > 0 { get += " + \(MoneyFormat.grams(s.receivableGold)) \(MoneyWords.metal)" }
        parts.append(get)
        var give = "You will give \(Money.pkr(s.payable))"
        if s.payableGold > 0 { give += " + \(MoneyFormat.grams(s.payableGold)) \(MoneyWords.metal)" }
        parts.append(give)
        parts.append("On invoices \(Money.pkr(data.onInvoices))")
        return parts
    }

    // MARK: The actions, declared once

    private func macAccount(_ ids: Set<String>, _ data: HisaabMacData) -> HisaabAccount? {
        guard ids.count == 1, let id = ids.first else { return nil }
        return data.byId[id]
    }

    /// Whether the person is a live record the ledger can be written on (the ledger page's own test): a removed one, and a
    /// walk-in, are not.
    private func macOnFile(_ a: HisaabAccount) -> Bool {
        if a.isWalkIn { return false }
        if a.isCustomer { return book.customers.item(a.id).map { (c: Customer) in !CustomerKit.isRemoved(c) } ?? false }
        return book.karigars.item(a.id).map { (k: Karigar) in (k.deletedAt ?? "").isEmpty } ?? false
    }

    private func macGroups(for ids: Set<String>, _ data: HisaabMacData) -> [[MacAction]] {
        let a = macAccount(ids, data)
        let writes = a.map { (x: HisaabAccount) in macOnFile(x) } ?? false
        let new = MacAction("New Hisaab Entry\u{2026}", symbol: "plus", shortcut: KeyboardShortcut("n", modifiers: [.control, .command]),
                            id: "new") { picking = true }
        let gave = MacAction("You Gave\u{2026}", symbol: "arrow.up", shortcut: KeyboardShortcut("g", modifiers: [.shift, .command]),
                             enabled: writes, id: "gave") {
            if let a { macEntry = HisaabMacEntry(mode: .gave, personId: a.id, personName: a.name, isCustomer: a.isCustomer) }
        }
        let got = MacAction("You Got\u{2026}", symbol: "arrow.down", shortcut: KeyboardShortcut("r", modifiers: [.shift, .command]),
                            enabled: writes, id: "got") {
            if let a { macEntry = HisaabMacEntry(mode: .got, personId: a.id, personName: a.name, isCustomer: a.isCustomer) }
        }
        let open = MacAction("Open Ledger", symbol: "book.closed", shortcut: KeyboardShortcut(.return, modifiers: []),
                             enabled: a != nil, id: "open") {
            if let a { macOpenAccount(a) }
        }
        // The summary of everyone outstanding whose name matches the search, as the ERP prints it; the sides are not applied.
        let pdf = MacAction("Summary PDF\u{2026}", symbol: "doc.richtext", id: "summary") {
            summaryPDF = InvoicePDFTarget(path: MoneyPaths.hisaabSummary(search: search),
                                          fileName: "Hisaab-Summary-\(MoneyCalendar.pickedDay(Date())).pdf",
                                          title: "Hisaab summary")
        }
        return [[new], [gave, got], [open], [pdf]]
    }

    /// New, and the one Filter menu (the side and the kind of person, inline in it). You Gave and You Got are the inspector's
    /// buttons, the Hisaab menu's and the right-click menu's, not the toolbar's.
    @ToolbarContentBuilder
    private func macToolbar(_ data: HisaabMacData) -> some ToolbarContent {
        let groups = macGroups(for: macPick, data)
        let counts = macRows(data)
        ToolbarItemGroup(placement: .automatic) {
            MacToolbarAction(action: groups[0][0])
            macFilterMenu(counts)
        }
    }

    private func macFilterMenu(_ counts: HisaabMacRows) -> some View {
        Menu {
            Section("Side") {
                Picker("Side", selection: $chip) {
                    Text("\(HisaabChip.all.title) (\(counts.all))").tag(HisaabChip.all)
                    Text("\(HisaabChip.get.title) (\(counts.get))").tag(HisaabChip.get)
                    Text("\(HisaabChip.give.title) (\(counts.give))").tag(HisaabChip.give)
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }
            Section("Show") {
                Picker("Show", selection: $kind) {
                    ForEach(HisaabKind.allCases) { (k: HisaabKind) in Text(k.title).tag(k) }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }
            Section("Sort by") {
                Picker("Sort by", selection: $order) {
                    ForEach(HisaabOrder.allCases) { (o: HisaabOrder) in Text(o.title).tag(o) }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }
        } label: {
            Label("Filter", systemImage: chip != .all || kind != .everyone || order != .name ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
        .help("All accounts, only those who owe the shop or only those the shop owes; customers, karigars or everyone")
    }

    /// A person's ledger in a window of its own; a walk-in has no ledger, so its first invoice owing opens instead.
    private func macOpenAccount(_ a: HisaabAccount) {
        let route = a.isWalkIn
            ? a.unpaid.first.map { (u: HisaabUnpaid) in Route(path: MoneyPaths.invoice(u.id)) }
            : Route(path: MoneyPaths.ledger(a.id, isCustomer: a.isCustomer))
        if let route { macOpen(route) }
    }

    private func macOpen(_ route: Route) {
        if let openPlace { openPlace(route) } else { go = route }
    }

    // MARK: The inspector

    @ViewBuilder
    private func macPanel(_ data: HisaabMacData) -> some View {
        if let a = macAccount(macPick, data) {
            HisaabMacInspector(
                account: a,
                page: macLedgerPage(a.id),
                actions: Array(macGroups(for: macPick, data)[1]),
                open: { macOpenAccount(a) },
                openInvoice: { (id: String) in macOpen(Route(path: MoneyPaths.invoice(id))) })
        } else if macPick.count > 1 {
            MacInspectorEmpty(title: "\(macPick.count) Accounts Selected")
        } else {
            MacInspectorEmpty(title: "No Account Selected", detail: "Pick an account to see its balance and every entry.")
        }
    }

    private func macLedgerPage(_ id: String) -> HisaabLedgerPage {
        macLedgerMade([book.hisaab.revision, id.hashValue]) {
            HisaabLedger.page(book.hisaab.items.filter { (e: HisaabEntry) in e.entityId == id })
        }
    }
}

/// One account in the list: the iPhone's row at a pointer's size. The name, then one line that joins what else there is to say
/// (a karigar, the metal owed either way, the invoices owing), then the cash at the right. A customer with nothing more to
/// say is "Customer", so no row is a line shorter than the rest.
private struct HisaabMacListRow: View {
    let account: HisaabAccount

    private var line: String {
        var parts: [String] = []
        if account.isWalkIn { parts.append("Sales with no customer named") } else if !account.isCustomer { parts.append("Karigar") }
        if account.gold != 0 {
            parts.append("\(MoneyFormat.grams(abs(account.gold))) \(MoneyWords.metal) \(account.gold > 0 ? "to receive" : "to pay")")
        }
        let n = account.unpaid.count
        if n > 0 { parts.append("\(n) invoice\(n == 1 ? "" : "s") owing") }
        return parts.isEmpty ? "Customer" : parts.joined(separator: " \u{00B7} ")
    }

    private var tint: Color { account.cash > 0 ? Tone.owed.color : Tone.credit.color }

    var body: some View {
        HStack(spacing: 12) {
            Monogram(name: account.name, size: Monogram.Size.row)
            VStack(alignment: .leading, spacing: 2) {
                Text(account.name).font(.body.weight(.medium)).lineLimit(1)
                Text(line).font(.callout).foregroundStyle(.secondary).monospacedDigit().lineLimit(1)
            }
            Spacer(minLength: 8)
            if account.hasCash { RowAmount(amount: abs(account.cash), tone: tint) }
        }
        .padding(.vertical, 3)
        .accessibilityElement(children: .combine)
    }
}

/// The picked account: its name and balance, You Gave and You Got, and the latest rows of its ledger as compact lines.
private struct HisaabMacInspector: View {
    let account: HisaabAccount
    let page: HisaabLedgerPage
    let actions: [MacAction]
    let open: () -> Void
    let openInvoice: (String) -> Void

    private static let shown = 12

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                head
                HStack(spacing: 8) {
                    MacActionButtons(actions: account.isWalkIn ? [] : actions)
                    Spacer(minLength: 0)
                }
                Button(account.isWalkIn ? "Open Invoice" : "Open Ledger", action: open)
                    .buttonStyle(.bordered)
                    .controlSize(.regular)
                if account.isWalkIn { walkInSection } else { ledgerSection }
            }
            .padding(16)
        }
        .background(Theme.ground)
    }

    /// The iPhone's record head: the monogram, the name, and the one big sum in the serif.
    private var head: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Monogram(name: account.name, size: Monogram.Size.hero)
                VStack(alignment: .leading, spacing: 2) {
                    Text(account.name).font(.system(.title3, design: .serif).weight(.semibold)).lineLimit(2).textSelection(.enabled)
                    Text(kindLine).font(.callout).foregroundStyle(.secondary)
                }
            }
            if account.hasCash {
                VStack(alignment: .leading, spacing: 2) {
                    Text(account.side == .get ? "You will get" : "You will give").font(.callout).foregroundStyle(.secondary)
                    HeroAmount(amount: abs(account.cash), tone: account.side == .get ? Tone.owed.color : Tone.credit.color)
                }
            }
            if account.gold != 0 {
                Text("\(MoneyFormat.grams(abs(account.gold))) \(MoneyWords.metal) \(account.gold > 0 ? "to receive" : "to pay")")
                    .font(.callout).monospacedDigit().foregroundStyle(.secondary)
            }
        }
    }

    private var kindLine: String {
        account.isWalkIn ? "Sales with no customer named" : (account.isCustomer ? "Customer" : "Karigar")
    }

    private var ledgerSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            LedgerHeading(title: "Latest in the ledger", count: page.lines.isEmpty ? nil : page.lines.count)
            VStack(alignment: .leading, spacing: 10) {
                if page.lines.isEmpty {
                    Text("No transactions found.").foregroundStyle(.secondary)
                }
                ForEach(Array(page.lines.prefix(Self.shown))) { (line: HisaabLedgerLine) in
                    HisaabMacLine(line: line, openInvoice: openInvoice)
                }
                if page.lines.count > Self.shown {
                    Text("\(page.lines.count) in all, in the ledger window.").font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .houseCard()
        }
    }

    private var walkInSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            LedgerHeading(title: "Invoices owing")
            VStack(alignment: .leading, spacing: 10) {
                ForEach(account.unpaid) { (inv: HisaabUnpaid) in
                    Button { openInvoice(inv.id) } label: {
                        HStack {
                            Text(inv.id).monospacedDigit()
                            Spacer(minLength: 8)
                            Text(Money.pkr(inv.balanceDue)).monospacedDigit().foregroundStyle(Tone.owed.color)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .houseCard()
        }
    }
}

/// One ledger row, compact: what was written and when, the cash or metal that moved; a click on an invoice's row opens it.
private struct HisaabMacLine: View {
    let line: HisaabLedgerLine
    let openInvoice: (String) -> Void

    var body: some View {
        if let invoice = CustomerKit.filled(line.entry.linkedInvoiceId) {
            Button { openInvoice(invoice) } label: { row }
                .buttonStyle(.plain)
                .help("Open invoice \(invoice) in a window")
        } else {
            row
        }
    }

    private var row: some View {
        let e = line.entry
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(e.description.isEmpty ? "No description" : e.description).lineLimit(1)
                Text(ShopDate.say(e.date)).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 1) {
                if e.cashDebit > 0 { Text("Gave \(Money.pkr(e.cashDebit))").foregroundStyle(Tone.owed.color) }
                if e.cashCredit > 0 { Text("Got \(Money.pkr(e.cashCredit))").foregroundStyle(Tone.settled.color) }
                if e.goldDebitGrams > 0 { Text("Gave \(MoneyFormat.grams(e.goldDebitGrams))").font(.caption).foregroundStyle(.secondary) }
                if e.goldCreditGrams > 0 { Text("Got \(MoneyFormat.grams(e.goldCreditGrams))").font(.caption).foregroundStyle(.secondary) }
            }
            .monospacedDigit()
        }
        .contentShape(Rectangle())
    }
}
#endif

// MARK: One account

/// A person (or the walk-in line) with what they owe or are owed, the metal beside the cash, and the
/// invoices still owing (the web's card).
private struct HisaabAccountRow: View {
    let account: HisaabAccount
    /// A customer's card lists the invoices that are owing; the walk-in's are rows of their own.
    let listInvoices: Bool

    var body: some View {
        HStack(alignment: .top, spacing: pt(12)) {
            Monogram(name: account.name, size: Monogram.Size.row)
            VStack(alignment: .leading, spacing: 3) {
                top
                middle
                if account.gold != 0 { goldLine }
                if listInvoices && !account.unpaid.isEmpty { invoices }
            }
        }
    }

    private var tint: Color { account.cash > 0 ? Tone.owed.color : Tone.credit.color }

    private var top: some View {
        HStack(alignment: .firstTextBaseline, spacing: pt(8)) {
            Text(account.name).font(.body.weight(.medium))
            Spacer(minLength: 8)
            if account.hasCash {
                RowAmount(amount: abs(account.cash), tone: tint)
            }
        }
    }

    @ViewBuilder private var middle: some View {
        // The obvious is unsaid: only a walk-in and a karigar (the exceptions) are named.
        if account.isWalkIn {
            Text("Sales with no customer named").font(.caption).foregroundStyle(.secondary)
        } else if !account.isCustomer {
            Text("Karigar").font(.caption).foregroundStyle(.secondary)
        }
    }

    private var goldLine: some View {
        let word = account.gold > 0 ? "to receive" : "to pay"
        return Text("\(MoneyFormat.grams(abs(account.gold))) \(MoneyWords.metal) \(word)")
            .font(.caption)
            .monospacedDigit()
            .foregroundStyle(.secondary)
    }

    /// How many invoices still owe; the ledger lists them.
    private var invoices: some View {
        let n = account.unpaid.count
        return Text("\(n) invoice\(n == 1 ? "" : "s") owing")
            .font(.caption)
            .foregroundStyle(.secondary)
    }
}

/// An invoice still owing: its number, what was paid of the total, and what is due.
private struct HisaabUnpaidLine: View {
    let invoice: HisaabUnpaid

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: pt(8)) {
            Text(invoice.id).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary).lineLimit(1)
            Spacer(minLength: 8)
            Text(figures)
                .font(.caption)
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.trailing)
        }
    }

    private var figures: String {
        "\(Money.pkr(invoice.amountPaid)) / \(Money.grouped(invoice.grandTotal)) · \(Money.pkr(invoice.balanceDue)) due"
    }
}

/// A place pushed from the account picker: a native screen sits on the house's ground, as a tab's places do.
private struct HisaabDestination: View {
    let path: String

    var body: some View {
        ScreenRegistry.view(for: path)
            .modifier(HouseGround())
    }
}
