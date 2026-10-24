import SwiftUI
import ERPCore

// The Search tab (title "Search"): a find-anything screen. Idle it is a plain grouped list: the ERP's whole map by
// group, then the account, all in the house accent; typed into it finds places, customers, invoices, orders, stock and
// repairs. CONVENTIONS rules 9, 12, 15, 16.

// MARK: The screen

struct SearchView: View {
    @Environment(Session.self) private var session
    @Environment(Book.self) private var book
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.accessibilityReduceMotion) private var reduce
    let map: NavMap
    @State private var text = ""
    /// `text` after a pause in typing: what the results are worked out from.
    @State private var query = ""
    @State private var confirmingSignOut = false
    @State private var expanded: Set<String> = []
    @FocusState private var searchFocused: Bool

    private var typed: String { text.trimmingCharacters(in: .whitespaces).lowercased() }
    /// Marketing has no Firestore and the server refuses it the books: nothing to read for them.
    private var readsBooks: Bool { session.role != "marketing" }

    var body: some View {
        Group {
            if typed.isEmpty { idle } else { found }
        }
        .navigationTitle("Search")
        .hubTitleDisplay()
        .searchable(text: $text, prompt: "Customers, invoices, orders, stock, places")
        .searchFocused($searchFocused)
        // ⌘F: the field takes the keyboard (the tab may have only just been made).
        .onChange(of: ShellCommands.shared.searchWanted) { _, wanted in focusIfWanted(wanted) }
        .confirmDestructive(isPresented: $confirmingSignOut, title: "Sign out?",
                            message: "You will need to sign in with Google again.", action: "Sign out") {
            session.signOut()
        }
        .toolbar {
            if !sizeClass.isPadLayout { ToolbarItem(placement: .topBarLeading) { BusinessChip() } }
        }
        .onAppear {
            focusIfWanted(ShellCommands.shared.searchWanted)
        }
        // Debounced; the shelves are asked for only once someone types.
        .task(id: text) {
            let next = typed
            if next.isEmpty { query = ""; expanded = []; return }
            if readsBooks { needShelves() }
            try? await Task.sleep(for: .milliseconds(150))
            if Task.isCancelled { return }
            query = next
        }
    }

    private func focusIfWanted(_ wanted: Bool) {
        guard wanted else { return }
        ShellCommands.shared.searchWanted = false
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(250))
            searchFocused = true
        }
    }

    private func needShelves() {
        book.customers.need()
        book.invoices.need()
        book.orders.need()
        book.products.need()
        book.repairs.need()
    }

    // MARK: Nothing typed

    private var idle: some View {
        List {
            ForEach(groups, id: \.group.key) { g in groupSection(g.group, g.entries) }
            accountSection
        }
        .listStyle(.insetGrouped)
        .scrollDismissesKeyboard(.interactively)
        .modifier(HouseGround())
    }

    private var versionLine: String {
        let info = Bundle.main.infoDictionary
        let v = info?["CFBundleShortVersionString"] as? String ?? ""
        let b = info?["CFBundleVersion"] as? String ?? ""
        return "\(session.shop.name) \u{00B7} \(v) (\(b))"
    }

    private var groups: [(group: NavMap.Group, entries: [NavEntry])] {
        // The unlabelled group is Home's: Home is a tab, but Analytics lives beside it (nav.ts) and was listed nowhere
        // (owner, 2026-10-24: "where is the analytics tab"). It leads the list, under its own name.
        map.groups.compactMap { g in
            let entries = map.entries.filter { $0.group == g.key && $0.id != "home" }
            guard !entries.isEmpty else { return nil }
            return g.label.isEmpty ? (NavMap.Group(key: g.key, label: "Overview"), entries) : (g, entries)
        }
    }

    private func groupSection(_ g: NavMap.Group, _ entries: [NavEntry]) -> some View {
        Section {
            ForEach(entries) { e in
                entryRow(e)
                sectionRows(e)
            }
        } header: {
            LedgerHeading(title: g.label)
        }
        .houseRows()
    }

    private func entryRow(_ e: NavEntry) -> some View {
        let symbol = NavIcon.symbol(for: e.icon)
        let subs = subPlaces(e)
        return NavigationLink(value: Route(path: e.href)) {
            Label { Text(e.label) } icon: { Image(systemName: symbol).foregroundStyle(Theme.accent) }
                .frame(minHeight: 44)
        }
        .zoomSource(id: e.href)
        .contextMenu {
            if e.sections.count > 1 {
                ForEach(e.sections, id: \.self) { name in
                    Section(name) { ForEach(subs.filter { $0.section == name }) { p in subLink(p, in: e) } }
                }
            } else {
                ForEach(subs) { p in subLink(p, in: e) }
            }
        }
    }

    private func subLink(_ p: NavPlace, in e: NavEntry) -> some View {
        NavigationLink(value: Route(path: p.href)) {
            Label(p.label, systemImage: NavIcon.symbol(for: p.icon ?? e.icon))
        }
    }

    /// A sectioned entry (Analytics) also lists each section after its first as a quiet row opening that section's first page.
    private func sectionRows(_ e: NavEntry) -> some View {
        ForEach(Array(e.sections.dropFirst()), id: \.self) { name in
            if let first = e.tabs(in: name).first {
                NavigationLink(value: Route(path: first.href)) {
                    Label { Text("\(e.label): \(name)").foregroundStyle(.secondary) } icon: {
                        Image(systemName: NavIcon.symbol(for: first.icon ?? e.icon)).foregroundStyle(Theme.accent)
                    }
                    .frame(minHeight: 44)
                }
            }
        }
    }

    /// An entry's tabs and pages, without the entry itself.
    private func subPlaces(_ e: NavEntry) -> [NavPlace] {
        var seen = Set<String>([e.href])
        return ((e.tabs ?? []) + (e.pages ?? [])).filter { $0.moved != true && seen.insert($0.href).inserted }
    }

    // MARK: Account

    private var accountSection: some View {
        Section {
            accountLink("Businesses", "building.2", "/app/businesses")
            if session.isOwner { accountLink("This phone", "iphone", "/app/phone") }
            if let s = map.settings { accountLink(s.label, NavIcon.symbol(for: s.icon), s.href) }
            if let email = session.me?.email, !email.isEmpty {
                Text("Signed in as \(email)").font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                    .frame(minHeight: 44, alignment: .leading)
            }
            Button(role: .destructive) { confirmingSignOut = true } label: {
                Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right").frame(minHeight: 44)
            }
        } header: {
            LedgerHeading(title: "Account")
        } footer: {
            Text(versionLine).font(.caption).frame(maxWidth: .infinity)
        }
        .houseRows()
    }

    private func accountLink(_ title: String, _ symbol: String, _ path: String) -> some View {
        NavigationLink(value: Route(path: path)) {
            Label { Text(title) } icon: { Image(systemName: symbol).foregroundStyle(Theme.accent) }
                .frame(minHeight: 44)
        }
    }

    // MARK: Something typed

    private var results: SearchResults {
        SearchResults(q: query, map: map, book: book, readsBooks: readsBooks)
    }

    private var found: some View {
        let r = results
        let settled = query == typed
        return List {
            placesSection(r)
            customersSection(r)
            invoicesSection(r)
            ordersSection(r)
            stockSection(r)
            repairsSection(r)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Theme.ground.ignoresSafeArea())
        .scrollDismissesKeyboard(.interactively)
        .overlay {
            if settled, r.isEmpty { ContentUnavailableView.search(text: text) }
        }
    }

    private func page<Item: Identifiable, Row: View>(
        _ title: String, _ items: [Item], path: @escaping (Item) -> String,
        @ViewBuilder row: @escaping (Item) -> Row
    ) -> some View {
        SearchSection(title: title, items: items, isExpanded: expanded.contains(title), path: path,
                      row: row,
                      expand: { Motion.run(reduce: reduce) { _ = expanded.insert(title) } })
    }

    private func placesSection(_ r: SearchResults) -> some View {
        page("Places", r.places, path: { $0.place.href }) { h in
            Label {
                VStack(alignment: .leading, spacing: 1) {
                    Text(h.place.label)
                    if let e = h.entry, e.label != h.place.label {
                        Text(e.label).font(.caption).foregroundStyle(.secondary)
                    }
                }
            } icon: { Image(systemName: NavIcon.symbol(for: h.place.icon)) }
        }
    }

    private func customersSection(_ r: SearchResults) -> some View {
        page("Customers", r.customers, path: { "/customers/" + SearchPath.encode($0.id) }) { c in
            HStack(spacing: 12) {
                Monogram(name: c.name, size: Monogram.Size.row)
                VStack(alignment: .leading, spacing: 2) {
                    Text(c.name)
                    if let p = c.phone, !p.isEmpty { Text(p).font(.caption).foregroundStyle(.secondary) }
                }
            }
        }
    }

    private func invoicesSection(_ r: SearchResults) -> some View {
        page("Invoices", r.invoices, path: { "/invoices/" + SearchPath.encode($0.id) }) { i in
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(i.id)
                    Text(invoiceLine(i)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 8)
                RowAmount(amount: i.balanceDue > 0 ? i.balanceDue : i.grandTotal, tone: i.balanceDue > 0 ? Tone.owed.color : Color.primary)
            }
        }
    }

    private func invoiceLine(_ i: Invoice) -> String {
        [i.customerName, ShopDate.say(i.createdAt)].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private func ordersSection(_ r: SearchResults) -> some View {
        page("Orders", r.orders, path: { "/orders/" + SearchPath.encode($0.id) }) { o in
            let due = OrdersLogic.balance(o)
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(o.id)
                    Text(o.customerName ?? "").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    Text(o.status.rawValue).font(.caption).foregroundStyle(Tone(status: o.status).color)
                }
                Spacer(minLength: 8)
                if due > 0 { RowAmount(amount: due, tone: Tone.owed.color) }
            }
        }
    }

    private func stockSection(_ r: SearchResults) -> some View {
        page("Stock", r.stock, path: { "/products/" + SearchPath.encode($0.sku) }) { p in
            VStack(alignment: .leading, spacing: 2) {
                Text(p.name.isEmpty ? p.sku : p.name)
                if !p.name.isEmpty { Text(p.sku).font(.caption).foregroundStyle(.secondary) }
            }
        }
    }

    private func repairsSection(_ r: SearchResults) -> some View {
        page("Repairs", r.repairs, path: { "/repairs?id=" + SearchPath.encode($0.id) }) { x in
            VStack(alignment: .leading, spacing: 2) {
                Text(x.id)
                Text(x.customerName).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
        }
    }
}

// MARK: Paths and matching

private enum SearchPath {
    /// The same characters the sale's own links keep (SaleKit).
    static func encode(_ s: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-_.")
        return s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
    }
}

/// What matches the typed words, per kind, worked out once per drawing. A shelf the person cannot read (it
/// answered an error and holds nothing) gives no rows, so its section is left out without a word.
@MainActor
private struct SearchResults {
    var places: [NavHit] = []
    var customers: [Customer] = []
    var invoices: [Invoice] = []
    var orders: [Order] = []
    var stock: [Product] = []
    var repairs: [Repair] = []

    var isEmpty: Bool {
        places.isEmpty && customers.isEmpty && invoices.isEmpty && orders.isEmpty && stock.isEmpty && repairs.isEmpty
    }

    init(q: String, map: NavMap, book: Book, readsBooks: Bool) {
        guard !q.isEmpty else { return }
        places = map.allPlaces.filter { item in
            let label = item.place.label.lowercased()
            if label.contains(q) { return true }
            let words: [String] = item.place.keywords ?? []
            if words.contains(where: { $0.lowercased().contains(q) }) { return true }
            let under: String = item.entry?.label.lowercased() ?? ""
            return under.contains(q)
        }
        guard readsBooks else { return }
        let digits = q.filter(\.isNumber)
        let byPhone = digits.count >= 4
        if book.customers.error == nil || !book.customers.items.isEmpty {
            customers = book.customers.items.filter { c in
                guard c.deletedAt == nil || c.deletedAt == "" else { return false }
                if c.name.lowercased().contains(q) { return true }
                guard byPhone else { return false }
                let phones: [String] = [c.phone ?? "", c.altPhone ?? ""]
                return phones.contains { $0.filter(\.isNumber).contains(digits) }
            }
        }
        if book.invoices.error == nil || !book.invoices.items.isEmpty {
            invoices = book.invoices.items.filter { $0.id.lowercased().contains(q) || $0.customerName.lowercased().contains(q) }
        }
        if book.orders.error == nil || !book.orders.items.isEmpty {
            orders = book.orders.items.filter { $0.id.lowercased().contains(q) || ($0.customerName ?? "").lowercased().contains(q) }
        }
        if book.products.error == nil || !book.products.items.isEmpty {
            stock = book.products.items.filter { $0.sku.lowercased().contains(q) || $0.name.lowercased().contains(q) }
        }
        if book.repairs.error == nil || !book.repairs.items.isEmpty {
            repairs = book.repairs.items.filter { $0.id.lowercased().contains(q) || $0.customerName.lowercased().contains(q) }
        }
    }
}

// MARK: A section of results

/// Up to five rows, then "Show all N".
private struct SearchSection<Item: Identifiable, Row: View>: View {
    let title: String
    let items: [Item]
    let isExpanded: Bool
    let path: (Item) -> String
    @ViewBuilder let row: (Item) -> Row
    let expand: () -> Void

    let cap = 5

    var body: some View {
        if !items.isEmpty {
            Section {
                ForEach(isExpanded ? items : Array(items.prefix(cap))) { item in
                    NavigationLink(value: Route(path: path(item))) { row(item) }
                }
                if !isExpanded, items.count > cap {
                    Button("Show all \(items.count)", action: expand)
                }
            } header: {
                Text(title)
            }
            .houseRows()
            .transition(.opacity.combined(with: .move(edge: .top)))
        }
    }
}
