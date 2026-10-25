#if os(macOS)
import SwiftUI
import ERPCore

// The Mac's sidebar (docs/features/mac-design.md, "The sidebar"): every place of the ERP's map, every tab as a row under
// its place (nothing hidden in the title's menu), the saved lists under the places people chase, and their counts. It
// is drawn from the map the role sees (nav.ts), so nobody meets a place the web would not show them; the Mac only
// arranges it: the analytics tabs move to the places they report on, Money's tabs and Today's cash become Money's rows,
// Calendar joins the workshop, and Settings leaves for the Settings window.

/// One row of the sidebar: a place, a tab or a saved list. `id` is the path it opens (and its selection tag).
struct MacSidebarRow: Identifiable, Hashable {
    let id: String
    let title: String
    let symbol: String
    var children: [MacSidebarRow] = []
    /// What its count says (nil: none).
    var count: MacSidebarCount?
}

enum MacSidebarCount: Hashable {
    /// A saved list's size (`MacLists.count`).
    case list(href: String, list: String)
    /// Online orders waiting for a person.
    case online
    /// Invoices still owed on.
    case unpaid
    /// Repairs in the shop.
    case repairsIn
}

struct MacSidebarSection: Identifiable {
    let id: String
    let title: String
    var rows: [MacSidebarRow]
}

enum MacSidebarMap {
    /// Tabs that are things to do, not places to be: they live in the toolbar and the File menu.
    private static let actionTabs: Set<String> = ["/products/bulk-add", "/scan", "/ads/new", "/new", "/orders/add"]

    static func sections(_ map: NavMap, websiteSelling: Bool, role: String) -> [MacSidebarSection] {
        var sections: [MacSidebarSection] = []
        var analytics = map.entries.first { $0.id == "analytics" || ScreenRoute.bare($0.href) == "/analytics" }
        let home = map.entries.first { ScreenRoute.bare($0.href) == "/" }
        let homeTabs = (home?.tabs ?? []).filter { ScreenRoute.bare($0.href) != "/" }
        let calendar = homeTabs.first { ScreenRoute.bare($0.href).hasPrefix("/calendar") }
        let cash = homeTabs.first { ScreenRoute.bare($0.href).hasPrefix("/today") }

        // The analytics tabs by section: Sales stays with Analytics; Website, Social and Ads go to their places.
        let anaTabs = analytics?.tabs ?? []
        func section(_ name: String) -> [NavPlace] { anaTabs.filter { $0.section == name } }
        let websiteTabs = section("Website"), socialTabs = section("Social"), adsTabs = section("Ads")
        var salesTabs = section("Sales")
        if salesTabs.isEmpty, !anaTabs.isEmpty, anaTabs.allSatisfy({ $0.section == nil }) { salesTabs = anaTabs }
        let entryHrefs = Set(map.entries.map { ScreenRoute.bare($0.href) })
        let hasWebsite = map.entries.contains { ScreenRoute.bare($0.href).hasPrefix("/website") }
        let hasAds = map.entries.contains { ScreenRoute.bare($0.href).hasPrefix("/ads") }

        // Today heads the sidebar on its own.
        if let home {
            sections.append(MacSidebarSection(id: "today", title: "", rows: [
                MacSidebarRow(id: home.href, title: "Today", symbol: "sun.max")
            ]))
        }

        for g in map.groups where g.key != "home" {
            var rows: [MacSidebarRow] = []
            for e in map.entries where e.group == g.key {
                let bare = ScreenRoute.bare(e.href)
                if bare == "/expenses" || e.id == "money" {
                    // Money's tabs are Money's rows; Today's cash leads them.
                    if let cash { rows.append(row(cash.href, cash.label, cash.icon)) }
                    for t in e.tabs ?? [] { rows.append(row(t.href, t.label, t.icon)) }
                    continue
                }
                var children = (e.tabs ?? []).filter { ScreenRoute.bare($0.href) != bare && !actionTabs.contains(ScreenRoute.bare($0.href)) && $0.moved != true }
                    .map { row($0.href, $0.label, $0.icon) }
                children += (e.pages ?? []).filter { $0.moved != true && !actionTabs.contains(ScreenRoute.bare($0.href)) }
                    .map { row($0.href, $0.label, $0.icon) }
                if bare.hasPrefix("/website") { children += websiteTabs.map { row($0.href, $0.label, $0.icon) } }
                if bare.hasPrefix("/ads") { children += adsTabs.map { row($0.href, $0.label, $0.icon) } }
                // The saved lists of the places people chase.
                if bare == "/orders" {
                    if websiteSelling && (role == "owner" || role == "staff") {
                        children.insert(MacSidebarRow(id: "/orders/online", title: "Online", symbol: "globe", count: .online), at: 0)
                    }
                    children += MacLists.lists(for: bare).map { savedRow(bare, $0) }
                } else if ["/invoices", "/repairs", "/customers"].contains(bare) {
                    children += MacLists.lists(for: bare).map { savedRow(bare, $0) }
                }
                var r = row(e.href, e.label, e.icon)
                r.children = dedupe(children)
                if bare == "/orders", websiteSelling, role == "owner" || role == "staff" { r.count = .online }
                if bare == "/invoices" { r.count = .unpaid }
                if bare == "/repairs" { r.count = .repairsIn }
                rows.append(r)
            }
            // Calendar sits with the workshop's places; Social and Analytics join their sections.
            if g.key == "workshop", let calendar { rows.append(row(calendar.href, calendar.label, calendar.icon)) }
            if g.key == "marketing", !socialTabs.isEmpty, let first = socialTabs.first {
                var social = row(first.href, "Social", "person.2")
                social.children = socialTabs.dropFirst().map { row($0.href, $0.label, $0.icon) }
                rows.append(social)
            }
            if g.key == "money", let a = analytics, !salesTabs.isEmpty {
                var r = row(a.href, a.label, a.icon)
                r.children = salesTabs.filter { ScreenRoute.bare($0.href) != ScreenRoute.bare(a.href) }.map { row($0.href, $0.label, $0.icon) }
                rows.append(r)
                analytics = nil
            }
            if !rows.isEmpty { sections.append(MacSidebarSection(id: g.key, title: g.label, rows: rows)) }
        }

        // What found no home above (a role without Money that still has Analytics' sales; Website or Social tabs whose
        // place this role does not have): Analytics on its own, after Today.
        if let a = analytics {
            var leftovers = salesTabs
            if !hasWebsite { leftovers += websiteTabs }
            if !entryHrefs.contains(where: { $0.hasPrefix("/posts") }) && sections.allSatisfy({ !$0.rows.contains { $0.title == "Social" } }) {
                leftovers += socialTabs
            }
            if !hasAds { leftovers += adsTabs }
            if !leftovers.isEmpty {
                var r = row(a.href, a.label, a.icon)
                r.children = leftovers.filter { ScreenRoute.bare($0.href) != ScreenRoute.bare(a.href) }.map { row($0.href, $0.label, $0.icon) }
                if let i = sections.firstIndex(where: { $0.id == "today" }) {
                    sections[i].rows.append(r)
                } else {
                    sections.insert(MacSidebarSection(id: "analytics", title: "", rows: [r]), at: 0)
                }
            }
        }
        return sections
    }

    /// The top-level rows in the sidebar's order: ⌘1–⌘9.
    static func places(_ sections: [MacSidebarSection]) -> [MacSidebarRow] {
        sections.flatMap(\.rows)
    }

    /// Every row's path, children included: what a restored selection may be.
    static func allPaths(_ sections: [MacSidebarSection]) -> Set<String> {
        var out = Set<String>()
        for s in sections { for r in s.rows { out.insert(r.id); for c in r.children { out.insert(c.id) } } }
        return out
    }

    private static func row(_ href: String, _ label: String, _ icon: String?) -> MacSidebarRow {
        MacSidebarRow(id: href, title: label, symbol: NavIcon.symbol(for: icon))
    }

    private static func savedRow(_ href: String, _ list: MacSavedList) -> MacSidebarRow {
        MacSidebarRow(id: MacLists.path(href, list), title: list.title, symbol: list.symbol, count: .list(href: href, list: list.id))
    }

    private static func dedupe(_ rows: [MacSidebarRow]) -> [MacSidebarRow] {
        var seen = Set<String>()
        return rows.filter { seen.insert($0.id).inserted }
    }
}

/// The sidebar: the business menu at its head, then the sections; a place with rows under it discloses them.
struct MacSidebar: View {
    let sections: [MacSidebarSection]
    @Binding var selection: String?
    let open: (Route) -> Void

    @Environment(Book.self) private var book
    @AppStorage("mac.sidebar.open") private var openRaw = "/orders|/invoices"
    @State private var counted = Memo<[MacSidebarCount: Int]>()
    private var inbox: OnlineInbox { .shared }

    var body: some View {
        let counts = self.counts
        List(selection: $selection) {
            ForEach(sections) { s in
                if s.title.isEmpty {
                    ForEach(s.rows) { r in place(r, counts) }
                } else {
                    Section(s.title) {
                        ForEach(s.rows) { r in place(r, counts) }
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .safeAreaInset(edge: .top, spacing: 0) {
            MacBusinessMenu()
                .padding(.horizontal, 12).padding(.top, 6).padding(.bottom, 4)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .contextMenu(forSelectionType: String.self) { picked in
            if let p = picked.first {
                Button("Open in New Window") { open(Route(path: p)) }
            }
        }
    }

    @ViewBuilder
    private func place(_ r: MacSidebarRow, _ counts: [MacSidebarCount: Int]) -> some View {
        if r.children.isEmpty {
            label(r, counts).tag(r.id)
        } else {
            DisclosureGroup(isExpanded: expanded(r.id)) {
                ForEach(r.children) { c in label(c, counts).tag(c.id) }
            } label: {
                label(r, counts).tag(r.id)
            }
        }
    }

    private func label(_ r: MacSidebarRow, _ counts: [MacSidebarCount: Int]) -> some View {
        Label(r.title, systemImage: r.symbol)
            .badge(r.count.flatMap { counts[$0] } ?? 0)
    }

    private func expanded(_ id: String) -> Binding<Bool> {
        Binding(
            get: { openRaw.split(separator: "|").contains { String($0) == id } },
            set: { on in
                var set = Set(openRaw.split(separator: "|").map(String.init))
                if on { set.insert(id) } else { set.remove(id) }
                openRaw = set.sorted().joined(separator: "|")
            })
    }

    /// Every count the sidebar shows, worked out once per change of the books.
    private var counts: [MacSidebarCount: Int] {
        let wanted = Set(sections.flatMap { $0.rows.flatMap { [$0.count] + $0.children.map(\.count) } }.compactMap { $0 })
        let key = [book.orders.revision, book.invoices.revision, book.repairs.revision, book.customers.revision,
                   inbox.waiting, Int(Date().timeIntervalSince1970 / 3600)]
        return counted(key) {
            var out: [MacSidebarCount: Int] = [:]
            for c in wanted {
                switch c {
                case .list(let href, let list): out[c] = MacLists.count(href, list, book: book)
                case .online: out[c] = inbox.waiting
                case .unpaid: out[c] = MacLists.invoices(book.invoices.items, list: "unpaid").count
                case .repairsIn: out[c] = MacLists.repairs(book.repairs.items, list: "shop").count
                }
            }
            return out
        }
    }
}

/// The business at the head of the sidebar: a menu of the businesses on this Mac (a tick on the open one) and Manage
/// Businesses…, as Slack's or Xcode's switcher.
struct MacBusinessMenu: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let store = Businesses.shared
        let current = store.current
        Menu {
            ForEach(store.list) { b in
                Button {
                    guard b.id != current.id else { return }
                    Motion.run(Motion.travel, reduce: reduceMotion) { Businesses.shared.switch(to: b.id) }
                } label: {
                    if b.id == current.id { Label(b.displayName, systemImage: "checkmark") } else { Text(b.displayName) }
                }
            }
            Divider()
            Button("Manage Businesses…") { store.switcherOpen = true }
        } label: {
            HStack(spacing: 8) {
                BusinessBadge(business: current, size: 22)
                Text(current.displayName).font(.headline).lineLimit(1)
                Image(systemName: "chevron.up.chevron.down").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            }
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .help("Switch business (⇧⌘B manages them)")
    }
}
#endif
