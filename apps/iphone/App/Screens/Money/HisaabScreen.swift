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
    @State private var macSort = [KeyPathComparator(\HisaabMacRow.name)]
    @State private var macPick = Set<String>()
    #endif

    var body: some View {
        if session.isOwner {
            owners
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
            ToolbarItem(placement: .primaryAction) {
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
        let customerIds = Set(book.customers.items.map { $0.id })
        let summary = HisaabBook.summary(entries: book.hisaab.items, invoices: book.invoices.items, customerIds: customerIds)
        let onInvoices = owedToYou(book.invoices.items).total
        let scoped = scope(summary.accounts)
        let shown = ordered(scoped.filter { chip.matches($0) })
        #if os(macOS)
        macTable(summary, onInvoices: onInvoices, scoped: scoped)
        #else
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
        return FigureRow(alignment: .top, spacing: 10) {
            FigureTile(label: "You will get", value: Money.pkr(s.receivable), detail: getLines.joined(separator: "\n"), tint: Tone.owed.color)
            FigureTile(label: "You will give", value: Money.pkr(s.payable), detail: giveLines.isEmpty ? nil : giveLines.joined(separator: "\n"), tint: Tone.credit.color)
        }
        .padding(.vertical, 4)
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

// MARK: - The Mac table

/// One account as a table row, to sort by.
private struct HisaabMacRow: Identifiable {
    let account: HisaabAccount
    var id: String { account.id }
    var name: String { account.name }
    var kind: String { account.isWalkIn ? "Walk-ins" : (account.isCustomer ? "Customer" : "Karigar") }
    var invoices: Int { account.unpaid.count }
    var gold: Double { account.gold }
    var cash: Double { account.cash }
}

/// Hisaab as a Mac page: what the shop will get and give across the top, then every account as a sortable table. The side
/// (all, you will get, you will give) is the segmented control, who (everyone, customers, karigars) a pop-up menu, both
/// in the toolbar with the Summary PDF. Double-click opens a person's ledger in a window of its own.
extension HisaabScreen {
    private func macTable(_ summary: HisaabSummary, onInvoices: Double, scoped: [HisaabAccount]) -> some View {
        let shown = scoped.filter { chip.matches($0) }.map(HisaabMacRow.init).sorted(using: macSort)
        return VStack(spacing: 0) {
            tiles(summary, onInvoices: onInvoices)
                .padding(14)
            Table(shown, selection: $macPick, sortOrder: $macSort) {
                TableColumn("Name", value: \.name) { (r: HisaabMacRow) in
                    HStack(spacing: 8) {
                        Monogram(name: r.name, size: 24)
                        Text(r.name)
                    }
                }
                .width(min: 160, ideal: 240)
                TableColumn("Who", value: \.kind) { (r: HisaabMacRow) in Text(r.kind).foregroundStyle(.secondary) }
                    .width(min: 80, ideal: 100)
                TableColumn("Invoices owing", value: \.invoices) { (r: HisaabMacRow) in
                    Text(r.invoices == 0 ? "" : "\(r.invoices)").monospacedDigit()
                }
                .width(min: 90, ideal: 110)
                TableColumn(MoneyWords.metal.capitalized, value: \.gold) { (r: HisaabMacRow) in
                    Text(r.gold == 0 ? "" : "\(MoneyFormat.grams(abs(r.gold))) g \(r.gold > 0 ? "to receive" : "to pay")")
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                .width(min: 120, ideal: 150)
                TableColumn("Balance", value: \.cash) { (r: HisaabMacRow) in
                    if r.account.hasCash {
                        Text("\(Money.pkr(abs(r.cash))) \(r.cash > 0 ? "you will get" : "you will give")")
                            .monospacedDigit()
                            .foregroundStyle(r.cash > 0 ? Tone.owed.color : Tone.credit.color)
                    }
                }
                .width(min: 150, ideal: 190)
            }
            .contextMenu(forSelectionType: String.self) { ids in
                if let id = ids.first, let a = shown.first(where: { $0.id == id })?.account {
                    macMenu(a)
                }
            } primaryAction: { ids in
                for id in ids.prefix(5) {
                    if let a = shown.first(where: { $0.id == id })?.account { macOpen(a, inWindow: true) }
                }
            }
            .overlay { if shown.isEmpty { emptyState } }
        }
        .background(Theme.ground)
        .navigationSubtitle("\(shown.count) account\(shown.count == 1 ? "" : "s")")
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("Side", selection: $chip) {
                    ForEach(HisaabChip.allCases) { (c: HisaabChip) in
                        Text("\(c.title) (\(scoped.filter { c.matches($0) }.count))").tag(c)
                    }
                }
                .pickerStyle(.segmented)
                .help("All accounts, only those who owe the shop, or only those the shop owes")
            }
            ToolbarItem(placement: .automatic) {
                Picker("Show", selection: $kind) {
                    ForEach(HisaabKind.allCases) { (k: HisaabKind) in Text(k.title).tag(k) }
                }
                .pickerStyle(.menu)
                .help("Customers, karigars or everyone")
            }
            ToolbarItem(placement: .automatic) {
                // Everyone outstanding whose name matches the search, as the ERP prints it; the sides are not applied.
                Button {
                    summaryPDF = InvoicePDFTarget(path: MoneyPaths.hisaabSummary(search: search),
                                                  fileName: "Hisaab-Summary-\(MoneyCalendar.pickedDay(Date())).pdf",
                                                  title: "Hisaab summary")
                } label: {
                    Label("Summary PDF", systemImage: "doc.richtext")
                }
                .help("The summary of everyone outstanding, as a PDF")
            }
        }
    }

    @ViewBuilder
    private func macMenu(_ a: HisaabAccount) -> some View {
        if a.isWalkIn {
            ForEach(a.unpaid) { (inv: HisaabUnpaid) in
                Button("Open invoice \(inv.id)") { go = Route(path: MoneyPaths.invoice(inv.id)) }
            }
        } else {
            Button("Open ledger") { macOpen(a, inWindow: false) }
            Button("Open Ledger in New Window") { macOpen(a, inWindow: true) }
        }
    }

    private func macOpen(_ a: HisaabAccount, inWindow: Bool) {
        let route = a.isWalkIn
            ? a.unpaid.first.map { Route(path: MoneyPaths.invoice($0.id)) }
            : Route(path: MoneyPaths.ledger(a.id, isCustomer: a.isCustomer))
        guard let route else { return }
        if inWindow { openPlace?(route) } else { go = route }
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
        HStack(alignment: .top, spacing: 12) {
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
        HStack(alignment: .firstTextBaseline, spacing: 8) {
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
        HStack(alignment: .firstTextBaseline, spacing: 8) {
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
