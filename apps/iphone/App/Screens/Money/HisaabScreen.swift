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
        .searchable(text: $search, prompt: "Search by name")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { filterMenu }
            ToolbarItem(placement: .primaryAction) {
                Button { picking = true } label: {
                    Label("Add entry", systemImage: "plus")
                }
            }
        }
        .sheet(isPresented: $picking, onDismiss: {
            if let next = pending {
                pending = nil
                go = next
            }
        }) {
            HisaabAccountPicker { (route: Route) in pending = route }
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
        List { Group {
            Section {
                tiles(summary, onInvoices: onInvoices)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            } footer: {
                Text("On invoices counts walk-in sales too.")
            }
            if shown.isEmpty {
                Section { emptyState }
            } else {
                Section {
                    ForEach(shown) { account in rows(account) }
                }
            }
            Section {
                Button {
                    summaryPDF = InvoicePDFTarget(path: MoneyPaths.hisaabSummary(search: search),
                                                  fileName: "Hisaab-Summary-\(MoneyCalendar.pickedDay(Date())).pdf",
                                                  title: "Hisaab summary")
                } label: {
                    Label("Summary PDF", systemImage: "doc.richtext")
                }
            } footer: {
                Text("Takes the search, not the chips.")
            }
        }.houseRows()
        }
        .listStyle(.insetGrouped)
        .safeAreaBar(edge: .top, spacing: 0) { chipRow }
    }

    /// Search and the kind of person: everything but the side, which the chips choose.
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
        }
    }

    // MARK: Chips and the menu

    private var chipRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(HisaabChip.allCases) { (c: HisaabChip) in
                    chipButton(c)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 6)
        }
    }

    private func chipButton(_ c: HisaabChip) -> some View {
        // No counts: the tiles above say what each side comes to, once (rule 15).
        FilterChip(title: c.title, chosen: c == chip) { chip = c }
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
        } label: {
            Label("Filter", systemImage: filtering ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
    }
}

// MARK: One account

/// A person (or the walk-in line), two lines (rule 15): the name and what they owe or are owed; under it one quiet
/// line, who they are, which way the money goes, the metal and how many invoices owe. Each invoice is on their ledger
/// (its balance row opens it); the walk-in's are rows of their own.
private struct HisaabAccountRow: View {
    let account: HisaabAccount
    /// A customer's line counts the invoices that are owing; the walk-in's are rows of their own.
    let listInvoices: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            top
            Text(line)
                .font(.caption)
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }

    private var tint: Color { account.cash > 0 ? Tone.owed.color : Tone.credit.color }

    private var top: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(account.name).font(.body.weight(.medium)).lineLimit(1)
            Spacer(minLength: 8)
            if account.hasCash {
                RowAmount(amount: abs(account.cash), tone: tint)
            }
        }
    }

    private var line: String {
        var parts = [account.isWalkIn ? "Sales with no customer named" : (account.isCustomer ? "Customer" : "Karigar")]
        if account.hasCash { parts.append(account.cash > 0 ? "to receive" : "to pay") }
        if account.gold != 0 {
            parts.append("\(MoneyFormat.grams(abs(account.gold))) \(MoneyWords.metal) \(account.gold > 0 ? "to receive" : "to pay")")
        }
        let n = account.unpaid.count
        if listInvoices && n > 0 { parts.append("\(n) invoice\(n == 1 ? "" : "s") owing") }
        return parts.joined(separator: " · ")
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
                .lineLimit(1)
                .minimumScaleFactor(0.8)
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
