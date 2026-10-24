import SwiftUI
import ERPCore

// The Search tab (title "Search"): a find-anything screen. Idle it is a plain grouped list: the ERP's whole map by
// group, then the account, all in the house accent; typed into it finds places, customers, invoices, orders, stock and
// repairs. CONVENTIONS rules 9, 12, 15, 16.

// MARK: The screen

struct SearchView: View {
    @Environment(Session.self) private var session
    @Environment(Book.self) private var book
    @Environment(\.layoutWidthClass) private var sizeClass
    @Environment(\.accessibilityReduceMotion) private var reduce
    let map: NavMap
    @State private var text = ""
    /// `text` after a pause in typing: what the results are worked out from.
    @State private var query = ""
    @State private var confirmingSignOut = false
    @State private var expanded: Set<String> = []
    @FocusState private var searchFocused: Bool
    #if os(macOS)
    /// The window's model, to open a result from the keyboard (MacShell hands it down); the result Return opens.
    @FocusedValue(\.macShell) private var shell
    @State private var picked: String?
    #endif

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
        #if os(macOS)
        .onSubmit(of: .search) { macOpenPicked() }
        .onChange(of: query) { _, _ in picked = macPaths(results).first }
        #endif
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
        #if os(macOS)
        macIdle
        #else
        phoneIdle
        #endif
    }

    @ViewBuilder
    private var phoneIdle: some View {
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
            #if os(macOS)
            if session.isOwner { accountLink("This Mac", "desktopcomputer", "/app/phone") }
            #else
            if session.isOwner { accountLink("This phone", "iphone", "/app/phone") }
            #endif
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
        #if os(macOS)
        macFound
        #else
        phoneFound
        #endif
    }

    @ViewBuilder
    private var phoneFound: some View {
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
        #if os(macOS)
        MacSearchSection(title: title, items: items, isExpanded: expanded.contains(title), path: path,
                         row: row, picked: $picked, open: { macOpen($0) },
                         expand: { _ = expanded.insert(title) })
        #else
        SearchSection(title: title, items: items, isExpanded: expanded.contains(title), path: path,
                      row: row,
                      expand: { Motion.run(reduce: reduce) { _ = expanded.insert(title) } })
        #endif
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

// MARK: - The Mac

#if os(macOS)
/// One group of results, as the Mac lays them out: its heading, the paths its visible rows open (in the order the
/// keyboard walks them) and the section itself.
private struct MacSearchGroup {
    let title: String
    let paths: [String]
    let view: AnyView
}

extension SearchView {
    private static let macCap = 8

    /// The groups that have results, in the order Search reads them.
    private func macGroups(_ r: SearchResults) -> [MacSearchGroup] {
        func shown<T>(_ title: String, _ items: [T], _ path: (T) -> String) -> [String] {
            (expanded.contains(title) ? items : Array(items.prefix(Self.macCap))).map(path)
        }
        let all: [MacSearchGroup] = [
            MacSearchGroup(title: "Places", paths: shown("Places", r.places) { $0.place.href }, view: AnyView(placesSection(r))),
            MacSearchGroup(title: "Customers", paths: shown("Customers", r.customers) { "/customers/" + SearchPath.encode($0.id) }, view: AnyView(customersSection(r))),
            MacSearchGroup(title: "Invoices", paths: shown("Invoices", r.invoices) { "/invoices/" + SearchPath.encode($0.id) }, view: AnyView(invoicesSection(r))),
            MacSearchGroup(title: "Orders", paths: shown("Orders", r.orders) { "/orders/" + SearchPath.encode($0.id) }, view: AnyView(ordersSection(r))),
            MacSearchGroup(title: "Stock", paths: shown("Stock", r.stock) { "/products/" + SearchPath.encode($0.sku) }, view: AnyView(stockSection(r))),
            MacSearchGroup(title: "Repairs", paths: shown("Repairs", r.repairs) { "/repairs?id=" + SearchPath.encode($0.id) }, view: AnyView(repairsSection(r))),
        ]
        return all.filter { !$0.paths.isEmpty }
    }

    /// Two columns, each group given to the shorter one so far.
    private func macColumns(_ r: SearchResults) -> [[MacSearchGroup]] {
        var cols: [[MacSearchGroup]] = [[], []]
        var load = [0, 0]
        for g in macGroups(r) {
            let i = load[0] <= load[1] ? 0 : 1
            cols[i].append(g)
            load[i] += g.paths.count + 2
        }
        return cols
    }

    /// Every visible result, column by column, top to bottom: what the arrow keys walk.
    fileprivate func macPaths(_ r: SearchResults) -> [String] {
        macColumns(r).flatMap { $0.flatMap { $0.paths } }
    }

    fileprivate func macOpen(_ path: String) {
        picked = path
        shell?.stack.append(Route(path: path))
    }

    fileprivate func macOpenPicked() {
        let paths = macPaths(results)
        if let picked, paths.contains(picked) { macOpen(picked) } else if let first = paths.first { macOpen(first) }
    }

    private func macMove(_ step: Int) {
        let paths = macPaths(results)
        guard !paths.isEmpty else { return }
        let at = picked.flatMap { paths.firstIndex(of: $0) } ?? (step > 0 ? -1 : paths.count)
        picked = paths[min(max(at + step, 0), paths.count - 1)]
    }

    /// Nothing typed: the map in two columns, the account last.
    @ViewBuilder
    fileprivate var macIdle: some View {
        let g = groups
        let split = max(1, (g.count + 1) / 2)
        return HStack(alignment: .top, spacing: 0) {
            List {
                ForEach(Array(g.prefix(split)), id: \.group.key) { groupSection($0.group, $0.entries) }
            }
            .listStyle(.inset)
            Divider()
            List {
                ForEach(Array(g.dropFirst(split)), id: \.group.key) { groupSection($0.group, $0.entries) }
                accountSection
            }
            .listStyle(.inset)
        }
        .modifier(HouseGround())
    }

    /// Something typed: results grouped in two columns, the first one lit; ↑ and ↓ move, Return opens, a click opens.
    @ViewBuilder
    fileprivate var macFound: some View {
        let r = results
        let settled = query == typed
        let cols = macColumns(r)
        return ScrollViewReader { (scroll: ScrollViewProxy) in
            ScrollView {
                HStack(alignment: .top, spacing: 28) {
                    ForEach(cols.indices, id: \.self) { (c: Int) in
                        VStack(alignment: .leading, spacing: 18) {
                            ForEach(cols[c], id: \.title) { (g: MacSearchGroup) in g.view }
                        }
                        .frame(maxWidth: .infinity, alignment: .top)
                    }
                }
                .padding(.horizontal, 28)
                .padding(.vertical, 20)
                .frame(maxWidth: 1400)
                .frame(maxWidth: .infinity)
            }
            .onChange(of: picked) { _, now in
                if let now { scroll.scrollTo(now) }
            }
        }
        .focusable()
        .onKeyPress(.downArrow) { macMove(1); return .handled }
        .onKeyPress(.upArrow) { macMove(-1); return .handled }
        .onKeyPress(.return) { macOpenPicked(); return .handled }
        .background {
            // The same keys while the search field has the keyboard.
            Group {
                Button("") { macMove(1) }.keyboardShortcut(.downArrow, modifiers: [])
                Button("") { macMove(-1) }.keyboardShortcut(.upArrow, modifiers: [])
            }
            .opacity(0).allowsHitTesting(false).accessibilityHidden(true)
        }
        .background(Theme.ground.ignoresSafeArea())
        .overlay {
            if settled, r.isEmpty { ContentUnavailableView.search(text: text) }
        }
    }
}

/// A group of results in a Mac's column: up to eight rows, one lit by the keyboard, each a click away from opening
/// and a right-click away from a window of its own.
private struct MacSearchSection<Item: Identifiable, Row: View>: View {
    let title: String
    let items: [Item]
    let isExpanded: Bool
    let path: (Item) -> String
    @ViewBuilder let row: (Item) -> Row
    @Binding var picked: String?
    let open: (String) -> Void
    let expand: () -> Void

    @Environment(\.openPlaceWindow) private var openPlace
    private let cap = 8

    var body: some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                LedgerHeading(title: title, count: items.count).padding(.horizontal, 4)
                VStack(spacing: 0) {
                    ForEach(isExpanded ? items : Array(items.prefix(cap))) { (item: Item) in
                        let p = path(item)
                        Button { open(p) } label: {
                            row(item)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 10).padding(.vertical, 7)
                                .background(picked == p ? Theme.accent.opacity(0.16) : Color.clear, in: .rect(cornerRadius: 8, style: .continuous))
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .id(p)
                        .contextMenu {
                            Button("Open") { open(p) }
                            if let openPlace { Button("Open in New Window") { openPlace(Route(path: p)) } }
                        }
                    }
                    if !isExpanded, items.count > cap {
                        Button("Show all \(items.count)", action: expand)
                            .buttonStyle(.link)
                            .padding(.horizontal, 10).padding(.vertical, 6)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(4)
                .ledgerCard(padding: 0)
            }
        }
    }
}
#endif
