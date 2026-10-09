import SwiftUI
import ERPCore

/// Customers (src/app/customers/page.tsx): who owes, who bought lately, and everyone else.
/// "Owed" is the ERP's one figure (lib/owed.ts, decisions "One screen per question"): invoices
/// with a balance, walk-ins and typed names in the total but on their own lines, and, for an
/// owner, the hisaab's hand-written balances. Staff have no hisaab (the ERP's server sends them
/// none), so for them it is invoices alone, as on their web page.
struct CustomersList: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL
    @State private var search = ""
    @State private var showing: Showing = .everyone
    @State private var merging = false

    init() {}

    /// The web's "Everyone / Owing / Recent".
    private enum Showing: String, CaseIterable, Identifiable {
        case everyone = "Everyone"
        case owing = "Owing"
        case recent = "Recent"
        var id: String { rawValue }
    }

    private struct Figures {
        let customerCount: Int
        let owed: Owed
        let stats: [String: CustomerKit.Stats]
        let groups: CustomerKit.Groups
        let lifetime: Double
        let matchedCount: Int
    }

    private var ledger: [HisaabEntry]? { session.isOwner ? book.hisaab.items : nil }

    private var loaded: Bool {
        book.customers.loaded && book.invoices.loaded && book.orders.loaded && (!session.isOwner || book.hisaab.loaded)
    }

    private var failure: String? {
        book.customers.error ?? book.invoices.error ?? book.orders.error ?? (session.isOwner ? book.hisaab.error : nil)
    }

    private var offline: Bool { book.customers.offline || book.invoices.offline }

    var body: some View {
        ShelfState(loaded: loaded, error: failure, offline: offline) {
            list
        }
        .navigationTitle("Customers")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $search, prompt: "Search by name, phone, or email")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                NavigationLink(value: Route(path: "/customers/add")) {
                    Label("Add customer", systemImage: "plus")
                }
            }
        }
        .sheet(isPresented: $merging) {
            CustomerMergeSheet()
        }
        .task {
            book.customers.need()
            book.invoices.need()
            book.orders.need()
            if session.isOwner { book.hisaab.need() }
        }
    }

    /// What each customer owes and has bought, reckoned once per change of the books, not per keystroke
    /// in the search (which only narrows the list).
    private struct Reckoned {
        let live: [Customer]
        let owed: Owed
        let stats: [String: CustomerKit.Stats]
        let lifetime: Double
    }

    @State private var reckoned = Memo<Reckoned>()

    private func figures() -> Figures {
        let key = [book.customers.revision, book.invoices.revision, book.orders.revision, book.hisaab.revision, session.isOwner ? 1 : 0]
        let r = reckoned(key) {
            let live = book.customers.items.filter { !CustomerKit.isRemoved($0) }
            let owed = CustomerKit.owed(invoices: book.invoices.items, customers: book.customers.items, ledger: ledger)
            let stats = CustomerKit.stats(invoices: book.invoices.items, orders: book.orders.items, owed: owed)
            var lifetime = 0.0
            for c in live { lifetime += stats[c.id]?.spent ?? 0 }
            return Reckoned(live: live, owed: owed, stats: stats, lifetime: lifetime)
        }
        let matched = r.live.filter { CustomerKit.matches($0, search) }
        return Figures(customerCount: r.live.count, owed: r.owed, stats: r.stats,
                       groups: CustomerKit.groups(matched, stats: r.stats), lifetime: r.lifetime, matchedCount: matched.count)
    }

    private func visible(_ g: CustomerKit.Groups) -> CustomerKit.Groups {
        switch showing {
        case .everyone: return g
        case .owing: return CustomerKit.Groups(owing: g.owing, active: [], quiet: [])
        case .recent: return CustomerKit.Groups(owing: [], active: g.active, quiet: [])
        }
    }

    // MARK: The list

    private var list: some View {
        let f = figures()
        let shown = visible(f.groups)
        return List {
            Section {
                CustSummary(
                    customerCount: f.customerCount,
                    owed: f.owed,
                    owingCount: f.groups.owing.count,
                    boughtRecently: f.groups.active.count + f.groups.owing.count,
                    lifetime: f.lifetime,
                    showHisaab: session.isOwner
                )
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }
            Section {
                chips
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            if shown.owing.isEmpty && shown.active.isEmpty && shown.quiet.isEmpty {
                Section { empty(matched: f.matchedCount) }
                    .listRowBackground(Color.clear)
            } else {
                group("Owing money", "most owed first", shown.owing, f.stats)
                group("Recent", "bought in the last \(CustomerKit.dormantAfterMonths) months", shown.active, f.stats)
                group("Quiet", "no sale in a year", shown.quiet, f.stats)
            }
            // Clearing up the book is an owner's: the web's merge and removals are browser writes the shop floor cannot make.
            if session.isOwner {
                Section {
                    Button { merging = true } label: {
                        Label("Merge duplicates", systemImage: "person.2")
                    }
                    // The spam finder (gibberish names and addresses with no number, history or address) stays the ERP's.
                    NavigationLink(value: Route(path: "/customers?web=1")) {
                        Label("Clean up spam", systemImage: "trash")
                    }
                } footer: {
                    Text("Merging moves one customer's invoices, orders and hisaab to another, and asks for the delete code. Cleaning up spam opens on the ERP's own page.")
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Showing.allCases) { option in
                    chip(option)
                }
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 2)
        }
    }

    @ViewBuilder private func chip(_ option: Showing) -> some View {
        if option == showing {
            Button(option.rawValue) { showing = option }.buttonStyle(.houseProminent)
        } else {
            Button(option.rawValue) { showing = option }.buttonStyle(.glass)
        }
    }

    @ViewBuilder private func group(_ title: String, _ hint: String, _ people: [Customer], _ stats: [String: CustomerKit.Stats]) -> some View {
        if !people.isEmpty {
            Section {
                ForEach(people) { c in
                    row(c, stats[c.id])
                }
            } header: {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(title)
                    Text(hint).font(.caption).foregroundStyle(.tertiary)
                    Spacer(minLength: 8)
                    Text("\(people.count)").monospacedDigit()
                }
                .textCase(nil)
            }
        }
    }

    private func row(_ c: Customer, _ s: CustomerKit.Stats?) -> some View {
        NavigationLink(value: CustomerKit.route(c.id)) {
            CustRowLabel(customer: c, stats: s)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            swipe(c)
        }
        .contextMenu {
            contactButtons(c)
        }
    }

    // MARK: Call, WhatsApp, Message

    @ViewBuilder private func swipe(_ c: Customer) -> some View {
        if let url = CustomerKit.whatsAppURL(c.phone) {
            Button { openURL(url) } label: { Label("WhatsApp", systemImage: "message.fill") }
                .tint(.green)
        }
        if let url = CustomerKit.callURL(c.phone) {
            Button { openURL(url) } label: { Label("Call", systemImage: "phone.fill") }
                .tint(.blue)
        }
    }

    @ViewBuilder private func contactButtons(_ c: Customer) -> some View {
        if let url = CustomerKit.callURL(c.phone) {
            Button { openURL(url) } label: { Label("Call", systemImage: "phone") }
        }
        if let url = CustomerKit.whatsAppURL(c.phone) {
            Button { openURL(url) } label: { Label("WhatsApp", systemImage: "message") }
        }
        if let url = CustomerKit.messageURL(c.phone) {
            Button { openURL(url) } label: { Label("Message", systemImage: "text.bubble") }
        }
    }

    // MARK: Nothing to show

    @ViewBuilder private func empty(matched: Int) -> some View {
        if matched == 0 && !CustomerKit.trim(search).isEmpty {
            ContentUnavailableView.search(text: search)
        } else if matched == 0 {
            ContentUnavailableView("No customers found", systemImage: "person.2", description: Text("Add a customer to begin."))
        } else if showing == .owing {
            ContentUnavailableView("Nobody owes you", systemImage: "checkmark.circle", description: Text("Every customer is settled."))
        } else {
            ContentUnavailableView("No recent buyers", systemImage: "clock", description: Text("Nobody here has bought in the last \(CustomerKit.dormantAfterMonths) months."))
        }
    }
}

/// The four figures over the list: customers, owed to you, bought lately, lifetime sales.
private struct CustSummary: View {
    let customerCount: Int
    let owed: Owed
    let owingCount: Int
    let boughtRecently: Int
    let lifetime: Double
    let showHisaab: Bool

    private var owedDetail: String {
        var parts = ["\(owingCount) customer\(owingCount == 1 ? "" : "s")"]
        if owed.walkIn > 0 { parts.append("walk-ins \(Money.pkr(owed.walkIn))") }
        if owed.nameOnly > 0 { parts.append("typed names \(Money.pkr(owed.nameOnly))") }
        if showHisaab && owed.ledger > 0 { parts.append("hisaab \(Money.pkr(owed.ledger))") }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            FigureTile(label: "Customers", value: "\(customerCount)")
            FigureTile(label: "Owed to you", value: Money.pkr(owed.total), detail: owedDetail, tint: owed.total > 0 ? .red : .primary)
            FigureTile(label: "Bought in \(CustomerKit.dormantAfterMonths)m", value: "\(boughtRecently)")
            FigureTile(label: "Lifetime sales", value: Money.pkrLac(lifetime), tint: Color.accentColor)
        }
    }
}

/// One customer in the list: name, number, what they owe (or, if nothing, what they have spent).
private struct CustRowLabel: View {
    let customer: Customer
    let stats: CustomerKit.Stats?

    private var subtitle: String {
        var lines: [String] = []
        if let phone = CustomerKit.filled(customer.phone) { lines.append(phone) }
        if let s = stats, s.count > 0 {
            var sales = "\(s.count) sale\(s.count == 1 ? "" : "s")"
            let last = CustomerKit.monthYear(s.lastAt)
            if !last.isEmpty { sales += " · last \(last)" }
            lines.append(sales)
        }
        return lines.joined(separator: "\n")
    }

    private var trailing: String? {
        guard let s = stats else { return nil }
        if s.owed > 0 { return Money.pkr(s.owed) }
        if s.spent > 0 { return Money.pkrLac(s.spent) }
        return nil
    }

    private var owes: Bool { (stats?.owed ?? 0) > 0 }

    var body: some View {
        // What is owed leads: it is the reason you look a customer up.
        TwoLine(title: CustomerKit.shown(customer), subtitle: subtitle, trailing: trailing, trailingTint: owes ? .red : .secondary)
    }
}
