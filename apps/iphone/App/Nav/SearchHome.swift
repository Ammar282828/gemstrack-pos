import SwiftUI
import ERPCore

// The Search tab (title "Search"): a find-anything screen. Idle it is the ERP's whole map as tiles with the
// recent picks and the quick actions above and the account below; typed into it finds places, customers,
// invoices, orders, stock and repairs. CONVENTIONS rules 9, 12, 15, 16.

// MARK: Recents

/// Something opened from this screen, kept per business (BizKey "search.recents"), newest first.
struct SearchRecent: Codable, Hashable, Identifiable {
    let path: String
    let label: String
    let symbol: String
    let kind: String
    var id: String { path }
}

enum SearchRecents {
    static let limit = 8
    private static var key: String { BizKey("search.recents") }

    static func load() -> [SearchRecent] {
        guard let data = UserDefaults.standard.data(forKey: key),
              let list = try? JSONDecoder().decode([SearchRecent].self, from: data) else { return [] }
        return list
    }

    static func save(_ list: [SearchRecent]) {
        UserDefaults.standard.set(try? JSONEncoder().encode(list), forKey: key)
    }

    static func adding(_ r: SearchRecent, to list: [SearchRecent]) -> [SearchRecent] {
        Array(([r] + list.filter { $0.path != r.path }).prefix(limit))
    }
}

// MARK: Look

/// A light press, for a tile.
private struct TilePress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(Motion.enter, value: configuration.isPressed)
    }
}

/// Each group's colour: from a small curated set that reads in light and dark, picked from the group's key
/// so a group keeps its colour. Never red (late / problem).
private enum SearchPalette {
    static var colours: [Color] { [Theme.accent, Tone.working.color, Tone.credit.color, Tone.settled.color, .purple, .indigo, Tone.owed.color] }

    static func colour(for key: String) -> Color {
        let all = colours
        let sum = key.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) % 9973 }
        return all[sum % all.count]
    }
}

/// Fades and lifts in, one after another; nothing moves under Reduce Motion.
private struct SearchEntrance: ViewModifier {
    let index: Int
    let shown: Bool
    @Environment(\.accessibilityReduceMotion) private var reduce

    func body(content: Content) -> some View {
        content
            .opacity(shown || reduce ? 1 : 0)
            .offset(y: shown || reduce ? 0 : 12)
            .animation(reduce ? nil : Motion.enter.delay(Double(min(index, 8)) * 0.04), value: shown)
    }
}

private extension View {
    func searchEntrance(_ index: Int, shown: Bool) -> some View { modifier(SearchEntrance(index: index, shown: shown)) }
}

/// An icon on a filled rounded square, with its words under it.
private struct SearchTile: View {
    let symbol: String
    let label: String
    let fill: Color
    @ScaledMetric(relativeTo: .body) private var side: CGFloat = 52

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: symbol)
                .font(.title3.weight(.medium))
                .foregroundStyle(Color.white)
                .frame(width: side, height: side)
                .background(fill, in: .rect(cornerRadius: Radius.tile, style: .continuous))
            Text(label)
                .font(.caption)
                .foregroundStyle(.primary)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}

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
    @State private var recents: [SearchRecent] = []
    @State private var shown = false
    @State private var expanded: Set<String> = []

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
        .confirmDestructive(isPresented: $confirmingSignOut, title: "Sign out?",
                            message: "You will need to sign in with Google again.", action: "Sign out") {
            session.signOut()
        }
        .toolbar {
            if !sizeClass.isPadLayout { ToolbarItem(placement: .topBarLeading) { BusinessChip() } }
        }
        .onAppear {
            recents = SearchRecents.load()
            shown = true
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

    private func needShelves() {
        book.customers.need()
        book.invoices.need()
        book.orders.need()
        book.products.need()
        book.repairs.need()
    }

    private func remember(_ r: SearchRecent) {
        recents = SearchRecents.adding(r, to: recents)
        SearchRecents.save(recents)
    }

    // MARK: Nothing typed

    private var idle: some View {
        ScrollView {
            VStack(spacing: 20) {
                if !recents.isEmpty { recentsRow.searchEntrance(0, shown: shown) }
                if !quick.isEmpty { quickRow.searchEntrance(1, shown: shown) }
                ForEach(Array(groups.enumerated()), id: \.element.group.key) { i, g in
                    groupCard(g.group, g.entries).searchEntrance(i + 2, shown: shown)
                }
                accountCard.searchEntrance(groups.count + 2, shown: shown)
                Text(versionLine)
                    .font(.caption).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.bottom, 8)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .scrollDismissesKeyboard(.interactively)
        .modifier(HouseGround())
    }

    private var versionLine: String {
        let info = Bundle.main.infoDictionary
        let v = info?["CFBundleShortVersionString"] as? String ?? ""
        let b = info?["CFBundleVersion"] as? String ?? ""
        return "\(session.shop.name) · \(v) (\(b))"
    }

    private var groups: [(group: NavMap.Group, entries: [NavEntry])] {
        map.groups.compactMap { g in
            let entries = map.entries.filter { $0.group == g.key }
            return g.label.isEmpty || entries.isEmpty ? nil : (g, entries)
        }
    }

    private var quick: [NavPlace] {
        var out: [NavPlace] = []
        if let s = map.newSale { out.append(s.place) }
        out.append(contentsOf: map.actions)
        var seen = Set<String>()
        return out.filter { seen.insert($0.href).inserted }
    }

    private var recentsRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            LedgerHeading(title: "Jump back in")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(recents) { r in recentChip(r) }
                }
            }
        }
    }

    private func recentChip(_ r: SearchRecent) -> some View {
        NavigationLink(value: Route(path: r.path)) {
            Label(r.label, systemImage: r.symbol)
                .font(.subheadline)
                .foregroundStyle(.primary)
                .lineLimit(1)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Theme.card, in: .rect(cornerRadius: Radius.chip, style: .continuous))
        }
        .buttonStyle(TilePress())
        .simultaneousGesture(TapGesture().onEnded { remember(r) })
        .contextMenu {
            Button("Remove", role: .destructive) {
                Motion.run(reduce: reduce) {
                    recents.removeAll { $0.path == r.path }
                    SearchRecents.save(recents)
                }
            }
        }
    }

    private var quickRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            LedgerHeading(title: "Start something")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(quick) { p in quickTile(p) }
                }
            }
        }
    }

    private func quickTile(_ p: NavPlace) -> some View {
        let symbol = NavIcon.symbol(for: p.icon)
        return NavigationLink(value: Route(path: p.href)) {
            SearchTile(symbol: symbol, label: p.label, fill: Theme.accent)
                .frame(width: 84)
        }
        .buttonStyle(TilePress())
        .zoomSource(id: p.href)
        .simultaneousGesture(TapGesture().onEnded {
            remember(SearchRecent(path: p.href, label: p.label, symbol: symbol, kind: "place"))
        })
    }

    private func groupCard(_ g: NavMap.Group, _ entries: [NavEntry]) -> some View {
        let fill = SearchPalette.colour(for: g.key)
        return VStack(alignment: .leading, spacing: 12) {
            LedgerHeading(title: g.label)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 8, alignment: .top)], spacing: 12) {
                ForEach(entries) { e in entryTile(e, fill: fill) }
            }
        }
        .ledgerCard()
    }

    private func entryTile(_ e: NavEntry, fill: Color) -> some View {
        let symbol = NavIcon.symbol(for: e.icon)
        let subs = subPlaces(e)
        return NavigationLink(value: Route(path: e.href)) {
            SearchTile(symbol: symbol, label: e.label, fill: fill)
        }
        .buttonStyle(TilePress())
        .zoomSource(id: e.href)
        .simultaneousGesture(TapGesture().onEnded {
            remember(SearchRecent(path: e.href, label: e.label, symbol: symbol, kind: "place"))
        })
        .contextMenu {
            ForEach(subs) { p in
                NavigationLink(value: Route(path: p.href)) {
                    Label(p.label, systemImage: NavIcon.symbol(for: p.icon ?? e.icon))
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

    private var accountCard: some View {
        let email = session.me?.email ?? ""
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Monogram(name: email, size: Monogram.Size.row)
                VStack(alignment: .leading, spacing: 2) {
                    Text(email).font(.subheadline.weight(.medium)).lineLimit(1)
                    Text(session.shop.name).font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .padding(.bottom, 8)
            accountLink("Businesses", "building.2", "/app/businesses")
            if session.isOwner { accountLink("This phone", "iphone", "/app/phone") }
            if let s = map.settings { accountLink(s.label, NavIcon.symbol(for: s.icon), s.href) }
            Divider()
            Button(role: .destructive) { confirmingSignOut = true } label: {
                Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 12)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(Tone.problem.color)
        }
        .ledgerCard()
    }

    private func accountLink(_ title: String, _ symbol: String, _ path: String) -> some View {
        VStack(spacing: 0) {
            Divider()
            NavigationLink(value: Route(path: path)) {
                HStack {
                    Label(title, systemImage: symbol).foregroundStyle(.primary)
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                }
                .padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
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
        _ title: String, _ items: [Item], path: @escaping (Item) -> String, recent: @escaping (Item) -> SearchRecent,
        @ViewBuilder row: @escaping (Item) -> Row
    ) -> some View {
        SearchSection(title: title, items: items, isExpanded: expanded.contains(title), path: path, recent: recent,
                      row: row, remember: remember,
                      expand: { Motion.run(reduce: reduce) { _ = expanded.insert(title) } })
    }

    private func placesSection(_ r: SearchResults) -> some View {
        page("Places", r.places, path: { $0.place.href }, recent: { h in
            SearchRecent(path: h.place.href, label: h.place.label, symbol: NavIcon.symbol(for: h.place.icon), kind: "place")
        }) { h in
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
        page("Customers", r.customers, path: { "/customers/" + SearchPath.encode($0.id) }, recent: { c in
            SearchRecent(path: "/customers/" + SearchPath.encode(c.id), label: c.name, symbol: "person.crop.circle", kind: "customer")
        }) { c in
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
        page("Invoices", r.invoices, path: { "/invoices/" + SearchPath.encode($0.id) }, recent: { i in
            SearchRecent(path: "/invoices/" + SearchPath.encode(i.id), label: i.id, symbol: "doc.text", kind: "invoice")
        }) { i in
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
        page("Orders", r.orders, path: { "/orders/" + SearchPath.encode($0.id) }, recent: { o in
            SearchRecent(path: "/orders/" + SearchPath.encode(o.id), label: o.id, symbol: "bag", kind: "order")
        }) { o in
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
        page("Stock", r.stock, path: { "/products/" + SearchPath.encode($0.sku) }, recent: { p in
            SearchRecent(path: "/products/" + SearchPath.encode(p.sku), label: p.name.isEmpty ? p.sku : p.name, symbol: "diamond", kind: "piece")
        }) { p in
            VStack(alignment: .leading, spacing: 2) {
                Text(p.name.isEmpty ? p.sku : p.name)
                if !p.name.isEmpty { Text(p.sku).font(.caption).foregroundStyle(.secondary) }
            }
        }
    }

    private func repairsSection(_ r: SearchResults) -> some View {
        page("Repairs", r.repairs, path: { "/repairs?id=" + SearchPath.encode($0.id) }, recent: { x in
            SearchRecent(path: "/repairs?id=" + SearchPath.encode(x.id), label: x.id, symbol: "wrench.and.screwdriver", kind: "repair")
        }) { x in
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
    let recent: (Item) -> SearchRecent
    @ViewBuilder let row: (Item) -> Row
    let remember: (SearchRecent) -> Void
    let expand: () -> Void

    let cap = 5

    var body: some View {
        if !items.isEmpty {
            Section {
                ForEach(isExpanded ? items : Array(items.prefix(cap))) { item in
                    NavigationLink(value: Route(path: path(item))) { row(item) }
                        .simultaneousGesture(TapGesture().onEnded { remember(recent(item)) })
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
