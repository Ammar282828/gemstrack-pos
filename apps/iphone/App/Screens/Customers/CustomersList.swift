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
    /// `search` after a 150 ms pause in typing: the list narrows on this, not on every keystroke.
    @State private var query = ""
    @State private var showing: Showing = .everyone
    @State private var merging = false
    @State private var cleaning = false

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
        #if os(macOS)
        // The Mac's Customers is its own place: a table with the picked customer in the inspector (MacCustomersPlace).
        MacCustomersPlace(path: "/customers")
        #else
        ShelfState(loaded: loaded, error: failure, offline: offline, shape: .list) {
            list
        }
        .navigationTitle("Customers")
        .hubTitleDisplay()
        .task(id: search) {
            let next = search
            if CustomerKit.trim(next).isEmpty { query = ""; return }
            try? await Task.sleep(for: .milliseconds(150))
            if Task.isCancelled { return }
            query = next
        }
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
        #endif
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
    /// The search applied and grouped: kept until the books, the query or the day change.
    @State private var narrowed = Memo<Figures>()

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
        // The groups read the clock only by months, so the day is the finest the key needs.
        let day = Int(Date().timeIntervalSince1970 / 86_400)
        return narrowed(key + [query.hashValue, day]) {
            let matched = r.live.filter { CustomerKit.matches($0, query) }
            return Figures(customerCount: r.live.count, owed: r.owed, stats: r.stats,
                           groups: CustomerKit.groups(matched, stats: r.stats), lifetime: r.lifetime, matchedCount: matched.count)
        }
    }

    private func visible(_ g: CustomerKit.Groups) -> CustomerKit.Groups {
        switch showing {
        case .everyone: return g
        case .owing: return CustomerKit.Groups(owing: g.owing, active: [], quiet: [])
        case .recent: return CustomerKit.Groups(owing: [], active: g.active, quiet: [])
        }
    }

    // MARK: The list

    /// One section of the list: who, and what they owe between them (the Owing money one).
    private struct CustSection: Identifiable {
        let id: String
        let title: String
        let hint: String
        let people: [Customer]
        let owed: Double
    }

    private func sections(_ shown: CustomerKit.Groups, _ stats: [String: CustomerKit.Stats]) -> [CustSection] {
        var out: [CustSection] = []
        if !shown.owing.isEmpty {
            var owed = 0.0
            for c in shown.owing { owed += stats[c.id]?.owed ?? 0 }
            out.append(CustSection(id: "owing", title: "Owing money", hint: "", people: shown.owing, owed: owed))
        }
        if !shown.active.isEmpty {
            out.append(CustSection(id: "recent", title: "Recent", hint: "", people: shown.active, owed: 0))
        }
        if !shown.quiet.isEmpty {
            out.append(CustSection(id: "quiet", title: "Quiet", hint: "no sale in a year", people: shown.quiet, owed: 0))
        }
        return out
    }

    /// The record lists' one layout (RecordList.swift): the chips, then a section per group, as rows on a phone and as a
    /// grid of cards on a wide iPad. No figures over the list (owner, 2026-11-03: Invoices and Orders lost theirs);
    /// what is owed is the Owing money heading and each row's own figure.
    private var list: some View {
        let f = figures()
        let shown = visible(f.groups)
        let groups = sections(shown, f.stats)
        return RecordListScaffold(search: $search, prompt: "Search by name, phone, or email", isEmpty: groups.isEmpty) {
            empty(matched: f.matchedCount)
        } rows: {
            head(f, inList: true)
            ForEach(groups) { group in
                Section {
                    ForEach(group.people) { c in row(c, f.stats[c.id]) }
                } header: {
                    header(group)
                }
                .houseRows()
            }
        } cards: { width in
            head(f, inList: false)
            ForEach(groups) { group in
                VStack(alignment: .leading, spacing: pt(16)) {
                    header(group)
                    RecordGrid(items: group.people, width: width) { c in card(c, f.stats[c.id]) }
                }
            }
        }
        .motion(showing, Motion.travel)
    }

    private func head(_ f: Figures, inList: Bool) -> some View {
        RecordListHead(figures: [], chips: chips(f), inList: inList)
    }

    private func header(_ group: CustSection) -> some View {
        ListSectionHeader(title: group.title, hint: group.hint, count: group.people.count,
                          trailing: group.owed >= 1 ? Money.pkr(group.owed) : nil, value: group.owed)
    }

    /// Everyone, Owing, Recent: the same three filters as before, as chips with how many each shows.
    private func chips(_ f: Figures) -> [ListChip] {
        Showing.allCases.map { option in
            let count: Int
            switch option {
            case .everyone: count = f.matchedCount
            case .owing: count = f.groups.owing.count
            case .recent: count = f.groups.active.count
            }
            return ListChip(id: option.rawValue, title: option.rawValue, count: count, chosen: option == showing) {
                showing = option
            }
        }
    }

    /// One customer as the record lists' row (RecordRow): who, their number and last sale, and what they owe (or, if
    /// nothing, what they have spent) on the trailing side.
    private func record(_ c: Customer, _ s: CustomerKit.Stats?) -> some View {
        RecordRow(name: CustomerKit.shown(c), title: CustomerKit.shown(c), subtitle: Text(subtitle(c, s)), money: money(s))
    }

    private func subtitle(_ c: Customer, _ s: CustomerKit.Stats?) -> String {
        var parts: [String] = []
        if let phone = CustomerKit.filled(c.phone) { parts.append(phone) }
        if let s, s.count > 0 {
            var sales = "\(s.count) sale\(s.count == 1 ? "" : "s")"
            let last = CustomerKit.monthYear(s.lastAt)
            if !last.isEmpty { sales += " · last \(last)" }
            parts.append(sales)
        }
        return parts.joined(separator: " · ")
    }

    private func money(_ s: CustomerKit.Stats?) -> RecordMoney? {
        guard let s else { return nil }
        // What is owed leads: it is the reason you look a customer up.
        if s.owed >= 1 { return RecordMoney(amount: s.owed, tone: .owed, detail: "owed", detailTone: .owed) }
        if s.spent > 0 { return RecordMoney(amount: s.spent, lac: true, detail: "spent") }
        return nil
    }

    private func row(_ c: Customer, _ s: CustomerKit.Stats?) -> some View {
        NavigationLink(value: CustomerKit.route(c.id)) {
            record(c, s)
        }
        .zoomSource(id: CustomerKit.path(c.id))
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            swipe(c)
        }
        .contextMenu {
            contactButtons(c)
        }
    }

    /// The iPad's card: the same row, then the contact menu. The card carries the row's actions (rule 16).
    private func card(_ c: Customer, _ s: CustomerKit.Stats?) -> some View {
        RecordCard {
            NavigationLink(value: CustomerKit.route(c.id)) {
                record(c, s)
            }
            .buttonStyle(.plain)
            .zoomSource(id: CustomerKit.path(c.id))
        } footer: {
            RecordCardFooter(label: "Contact \(CustomerKit.shown(c))") {
                EmptyView()
            } actions: {
                contactButtons(c)
            }
        }
        .contextMenu { contactButtons(c) }
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
        let searching = !CustomerKit.trim(search).isEmpty
        if matched > 0 && !searching && showing == .owing {
            ContentUnavailableView("Nobody owes you", systemImage: "checkmark.circle", description: Text("Every customer is settled."))
        } else if matched > 0 && !searching && showing == .recent {
            ContentUnavailableView("No recent buyers", systemImage: "clock", description: Text("Nobody here has bought in the last \(CustomerKit.dormantAfterMonths) months."))
        } else {
            RecordEmptyState(search: search, clear: showing != .everyone ? { search = ""; showing = .everyone } : nil,
                             title: "No customers found", symbol: "person.2",
                             message: "Add a customer to begin.",
                             action: .link("Add customer", Route(path: "/customers/add")))
        }
    }
}
