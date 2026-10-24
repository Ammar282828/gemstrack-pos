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
    @State private var cleaning = false
    #if os(macOS)
    @Environment(\.openPlaceWindow) private var openPlace
    @State private var macSort = [KeyPathComparator(\CustomersMacRow.owed, order: .reverse)]
    @State private var macPick = Set<String>()
    @State private var macGo: Route?
    #endif

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
            #if os(macOS)
            macList
            #else
            list
            #endif
        }
        .navigationTitle("Customers")
        .hubTitleDisplay()
        .searchable(text: $search, prompt: "Search by name, phone, or email")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                NavigationLink(value: Route(path: "/customers/add")) {
                    Label("Add customer", systemImage: "plus")
                }
            }
            // Clearing up the book is an owner's: the web's merge and removals are browser writes the shop floor cannot make.
            if session.isOwner {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { merging = true } label: {
                            Label("Merge duplicates", systemImage: "person.2")
                        }
                        // The spam finder: gibberish names or emails with no number, address or history (lib/customer-spam.ts).
                        Button { cleaning = true } label: {
                            Label("Clean up spam", systemImage: "person.crop.circle.badge.xmark")
                        }
                    } label: {
                        Label("Tidy up", systemImage: "ellipsis.circle")
                    }
                }
            }
        }
        .sheet(isPresented: $merging) {
            CustomerMergeSheet()
                .presentationSizing(.page)
        }
        .sheet(isPresented: $cleaning) {
            CustomerSpamSheet()
                .presentationSizing(.page)
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
                    .chipRowInList()
            }
            if shown.owing.isEmpty && shown.active.isEmpty && shown.quiet.isEmpty {
                Section { empty(matched: f.matchedCount) }
                    .listRowBackground(Color.clear)
            } else {
                group("Owing money", nil, shown.owing, f.stats)
                group("Recent", nil, shown.active, f.stats)
                group("Quiet", "no sale in a year", shown.quiet, f.stats)
            }
        }
        .listStyle(.insetGrouped)
        .motion(showing, Motion.travel)
    }

    private var chips: some View {
        ChipRow {
            ForEach(Showing.allCases) { option in
                FilterChip(title: option.rawValue, chosen: option == showing) { showing = option }
            }
        }
    }

    @ViewBuilder private func group(_ title: String, _ hint: String?, _ people: [Customer], _ stats: [String: CustomerKit.Stats]) -> some View {
        if !people.isEmpty {
            Section {
                ForEach(people) { c in
                    row(c, stats[c.id])
                }
            } header: {
                LedgerHeading(title: title, count: people.count, trailing: hint)
            }
            .houseRows()
        }
    }

    private func row(_ c: Customer, _ s: CustomerKit.Stats?) -> some View {
        NavigationLink(value: CustomerKit.route(c.id)) {
            CustRowLabel(customer: c, stats: s)
        }
        .zoomSource(id: CustomerKit.path(c.id))
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
                .tint(Tone.settled.color)
        }
        if let url = CustomerKit.callURL(c.phone) {
            Button { openURL(url) } label: { Label("Call", systemImage: "phone.fill") }
                .tint(Theme.accent)
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
    let boughtRecently: Int
    let lifetime: Double
    let showHisaab: Bool

    private var owedDetail: String {
        // How many owe is the Owing money heading's count, said there once (rule 15).
        var parts: [String] = []
        if owed.walkIn > 0 { parts.append("walk-ins \(Money.pkr(owed.walkIn))") }
        if owed.nameOnly > 0 { parts.append("typed names \(Money.pkr(owed.nameOnly))") }
        if showHisaab && owed.ledger > 0 { parts.append("hisaab \(Money.pkr(owed.ledger))") }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Owed to you").font(.subheadline).foregroundStyle(.secondary)
                HeroAmount(amount: owed.total)
                if !owedDetail.isEmpty {
                    Text(owedDetail).font(.footnote).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Divider()
            DisclosureGroup("Customer overview") {
                VStack(spacing: 12) {
                    TwoLine(title: "Customers", trailing: "\(customerCount)")
                    TwoLine(title: "Bought in \(CustomerKit.dormantAfterMonths) months", trailing: "\(boughtRecently)")
                    TwoLine(title: "Lifetime sales", trailing: Money.pkrLac(lifetime))
                }
                .padding(.top, 12)
            }
            .font(.subheadline)
        }
        .heroSheen()
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
        if s.owed >= 1 { return Money.pkr(s.owed) }
        if s.spent > 0 { return Money.pkrLac(s.spent) }
        return nil
    }

    private var owes: Bool { (stats?.owed ?? 0) > 0 }

    var body: some View {
        // What is owed leads: it is the reason you look a customer up.
        HStack(alignment: .top, spacing: 12) {
            Monogram(name: CustomerKit.shown(customer))
            TwoLine(title: CustomerKit.shown(customer), subtitle: subtitle,
                    trailing: trailing, trailingTint: owes ? Tone.owed.color : .primary,
                    trailingLabel: owes ? "Owed" : "Lifetime sales")
        }
        .padding(.vertical, 8)
    }
}

#if os(macOS)

// MARK: - The Mac table

/// One customer as a table row: the figures the hub's grouped list showed under each name, as columns to sort by.
private struct CustomersMacRow: Identifiable {
    let customer: Customer
    let stats: CustomerKit.Stats?
    var id: String { customer.id }
    var name: String { CustomerKit.shown(customer) }
    var phone: String { CustomerKit.filled(customer.phone) ?? "" }
    var sales: Int { stats?.count ?? 0 }
    var last: String { stats?.lastAt ?? "" }
    var spent: Double { stats?.spent ?? 0 }
    var owed: Double { stats?.owed ?? 0 }
}

/// The Overview of Customers as a Mac page: the four figures across the top, then everyone as a sortable table (the
/// Everyone / Owing / Recent filter is in the toolbar), with Call, WhatsApp and Message on the right-click menu and
/// a double-click that opens the customer in a window of their own.
extension CustomersList {
    @ViewBuilder
    private var macList: some View {
        let f = figures()
        let shown = visible(f.groups)
        let people = shown.owing + shown.active + shown.quiet
        let rows = people.map { CustomersMacRow(customer: $0, stats: f.stats[$0.id]) }.sorted(using: macSort)
        return VStack(spacing: 0) {
            macFigures(f)
            Table(rows, selection: $macPick, sortOrder: $macSort) {
                TableColumn("Name", value: \.name) { (r: CustomersMacRow) in
                    HStack(spacing: 8) {
                        Monogram(name: r.name, size: 24)
                        Text(r.name)
                    }
                }
                .width(min: 160, ideal: 240)
                TableColumn("Phone", value: \.phone) { (r: CustomersMacRow) in Text(r.phone).monospacedDigit() }
                    .width(min: 110, ideal: 130)
                TableColumn("Sales", value: \.sales) { (r: CustomersMacRow) in
                    Text(r.sales == 0 ? "" : "\(r.sales)").monospacedDigit()
                }
                .width(min: 50, ideal: 60)
                TableColumn("Last sale", value: \.last) { (r: CustomersMacRow) in Text(CustomerKit.monthYear(r.stats?.lastAt)) }
                    .width(min: 80, ideal: 100)
                TableColumn("Spent", value: \.spent) { (r: CustomersMacRow) in
                    Text(r.spent > 0 ? Money.pkrLac(r.spent) : "").monospacedDigit()
                }
                .width(min: 90, ideal: 110)
                TableColumn("Owed", value: \.owed) { (r: CustomersMacRow) in
                    // Only what needs someone is coloured.
                    Text(r.owed >= 1 ? Money.pkr(r.owed) : "").monospacedDigit().foregroundStyle(Tone.owed.color)
                }
                .width(min: 90, ideal: 110)
            }
            .contextMenu(forSelectionType: String.self) { ids in
                if let id = ids.first, let c = people.first(where: { $0.id == id }) {
                    Button("Open") { macGo = CustomerKit.route(id) }
                    Button("Open in New Window") { openPlace?(CustomerKit.route(id)) }
                    Divider()
                    contactButtons(c)
                    Divider()
                    Button("Copy phone number") { UIPasteboard.general.string = CustomerKit.filled(c.phone) ?? "" }
                        .disabled(CustomerKit.filled(c.phone) == nil)
                }
            } primaryAction: { ids in
                for id in ids.prefix(5) { openPlace?(CustomerKit.route(id)) }
            }
            .overlay { if rows.isEmpty { empty(matched: f.matchedCount) } }
        }
        .background(Theme.ground)
        .navigationDestination(item: $macGo) { (r: Route) in PlaceScreen(path: r.path) }
        .navigationSubtitle("\(f.customerCount) customers")
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("Show", selection: $showing) {
                    ForEach(Showing.allCases) { (o: Showing) in Text(o.rawValue).tag(o) }
                }
                .pickerStyle(.segmented)
                .help("Everyone, only those who owe, or those who bought in the last year")
            }
        }
    }

    private func macFigures(_ f: Figures) -> some View {
        var detail: [String] = []
        if f.owed.walkIn > 0 { detail.append("walk-ins \(Money.pkr(f.owed.walkIn))") }
        if f.owed.nameOnly > 0 { detail.append("typed names \(Money.pkr(f.owed.nameOnly))") }
        if session.isOwner && f.owed.ledger > 0 { detail.append("hisaab \(Money.pkr(f.owed.ledger))") }
        return HStack(alignment: .top, spacing: 12) {
            FigureTile(label: "Owed to you", value: Money.pkr(f.owed.total), detail: detail.isEmpty ? nil : detail.joined(separator: " \u{00B7} "), tint: Tone.owed.color)
            FigureTile(label: "Customers", value: "\(f.customerCount)")
            FigureTile(label: "Bought in \(CustomerKit.dormantAfterMonths) months", value: "\(f.groups.active.count + f.groups.owing.count)")
            FigureTile(label: "Lifetime sales", value: Money.pkrLac(f.lifetime))
        }
        .padding(14)
    }
}
#endif
