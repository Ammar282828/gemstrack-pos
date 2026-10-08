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

enum HisaabOrder: String, CaseIterable, Identifiable {
    case owesFirst, name

    var id: String { rawValue }

    var title: String {
        switch self {
        case .owesFirst: return "Who owes you first"
        case .name: return "By name"
        }
    }
}

/// Money → Hisaab (src/app/hisaab/page.tsx): customers' and karigars' outstanding accounts, what the
/// shop will get and what it will give. Every figure is debit less credit over a person's rows, as the
/// web works it. Opening a person shows their ledger; adding an entry and deleting one stay the ERP's page.
struct HisaabScreen: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    @State private var search = ""
    @State private var chip: HisaabChip = .all
    @State private var kind: HisaabKind = .everyone
    @State private var order: HisaabOrder = .owesFirst

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
                NavigationLink(value: Route(path: MoneyPaths.hisaabWeb)) {
                    Label("Add entry", systemImage: "plus")
                }
            }
        }
        .task {
            book.hisaab.need()
            book.invoices.need()
            book.customers.need()
            book.karigars.need()
        }
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        let customerIds = Set(book.customers.items.map { $0.id })
        let summary = HisaabBook.summary(entries: book.hisaab.items, invoices: book.invoices.items, customerIds: customerIds)
        let onInvoices = owedToYou(book.invoices.items).total
        let scoped = scope(summary.accounts)
        let shown = ordered(scoped.filter { chip.matches($0) })
        List {
            Section {
                tiles(summary, onInvoices: onInvoices)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            } header: {
                Text("Outstanding accounts for customers and karigars.").textCase(nil)
            } footer: {
                Text("On invoices counts walk-in sales too. The dashboard's “Owed to you” adds the hand-written balances here.")
            }
            if shown.isEmpty {
                Section { emptyState }
            } else {
                Section {
                    ForEach(shown) { account in rows(account) }
                }
            }
            Section {
                NavigationLink(value: Route(path: MoneyPaths.hisaabWeb)) {
                    Label("Add an entry or export the report", systemImage: "safari")
                }
            } footer: {
                Text("Adding an entry and deleting one ask for the delete code, so they stay on the ERP's page.")
            }
        }
        .listStyle(.insetGrouped)
        .safeAreaInset(edge: .top, spacing: 0) { chipRow(scoped) }
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

    /// Who owes the shop first, the biggest debt first, then those the shop owes, the biggest first;
    /// or by name, as the web lists them.
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
        return HStack(alignment: .top, spacing: 10) {
            FigureTile(label: "You will get", value: Money.pkr(s.receivable), detail: getLines.joined(separator: "\n"), tint: .green)
            FigureTile(label: "You will give", value: Money.pkr(s.payable), detail: giveLines.isEmpty ? nil : giveLines.joined(separator: "\n"), tint: .red)
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

    private func chipRow(_ scoped: [HisaabAccount]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(HisaabChip.allCases) { (c: HisaabChip) in
                    chipButton(c, count: scoped.filter { c.matches($0) }.count)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 6)
        }
    }

    @ViewBuilder
    private func chipButton(_ c: HisaabChip, count: Int) -> some View {
        if c == chip {
            Button { chip = c } label: { chipLabel(c, count: count) }
                .buttonStyle(.glassProminent)
        } else {
            Button { chip = c } label: { chipLabel(c, count: count) }
                .buttonStyle(.glass)
        }
    }

    private func chipLabel(_ c: HisaabChip, count: Int) -> some View {
        HStack(spacing: 5) {
            Text(c.title)
            Text("\(count)").font(.caption).monospacedDigit().opacity(0.7)
        }
        .font(.subheadline.weight(.medium))
    }

    private var filterMenu: some View {
        let filtering = kind != .everyone || order != .owesFirst
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

/// A person (or the walk-in line) with what they owe or are owed, the metal beside the cash, and the
/// invoices still owing (the web's card).
private struct HisaabAccountRow: View {
    let account: HisaabAccount
    /// A customer's card lists the invoices that are owing; the walk-in's are rows of their own.
    let listInvoices: Bool

    private static let invoicesShown = 3

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: account.isCustomer ? "person.fill" : "briefcase.fill")
                .foregroundStyle(Theme.accent)
                .frame(width: 36, height: 36)
                .background(Theme.accent.opacity(0.14), in: .circle)
            VStack(alignment: .leading, spacing: 3) {
                top
                middle
                if account.gold != 0 { goldLine }
                if listInvoices && !account.unpaid.isEmpty { invoices }
            }
        }
    }

    private var tint: Color { account.cash > 0 ? Color.green : Color.red }

    private var top: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(account.name).font(.body.weight(.medium)).lineLimit(1)
            Spacer(minLength: 8)
            if account.hasCash {
                MoneyText(amount: abs(account.cash), exact: true)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(tint)
            }
        }
    }

    private var middle: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(account.isWalkIn ? "Sales with no customer named" : (account.isCustomer ? "Customer" : "Karigar"))
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer(minLength: 8)
            if account.hasCash {
                Text(account.cash > 0 ? "to receive" : "to pay")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var goldLine: some View {
        let word = account.gold > 0 ? "to receive" : "to pay"
        return Text("\(MoneyFormat.grams(abs(account.gold))) \(MoneyWords.metal) \(word)")
            .font(.caption)
            .monospacedDigit()
            .foregroundStyle(.secondary)
    }

    private var invoices: some View {
        let list = Array(account.unpaid.prefix(Self.invoicesShown))
        let more = account.unpaid.count - list.count
        return VStack(alignment: .leading, spacing: 2) {
            Divider().padding(.vertical, 2)
            ForEach(list) { inv in HisaabUnpaidLine(invoice: inv) }
            if more > 0 {
                Text("and \(more) more").font(.caption).foregroundStyle(.secondary)
            }
        }
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
