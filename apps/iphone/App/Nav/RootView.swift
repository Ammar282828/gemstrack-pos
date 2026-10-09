import SwiftUI

/// Signed in or not, owner or karigar: which app this person gets.
struct RootGate: View {
    @Environment(Session.self) private var session

    var body: some View {
        switch session.state {
        case .starting:
            ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.ground)
        case .signedOut, .signingIn, .needsSetup:
            SignInView()
        case .signedIn:
            if session.role == "karigar" {
                // A karigar's own work, native (MyWorkScreen reads the portal's /api/karigar/me; the ERP's /my-work).
                NavigationStack { MyWorkScreen(path: "/my-work") }
            } else {
                RootView()
            }
        }
    }
}

/// The app: the shop's four most-used places as tabs, the ERP's whole map under Search, and New sale / New order / Scan always one tap away above the tab bar.
/// A marketing account gets its own three (Posts, Website, Ads) and no bar: the ERP gives it nothing else.
/// Liquid Glass comes with the system's TabView, toolbars and sheets (CONVENTIONS.md rule 4).
struct RootView: View {
    @Environment(Session.self) private var session
    // The simulator check opens each tab in turn (`-ERPDemoTab orders`).
    @State private var tab = UserDefaults.standard.string(forKey: "ERPDemoTab") ?? "home"
    @State private var creating: Route?

    private var map: NavMap { NavMap.current.visible(to: session.role) }
    private static let primary = ["home", "orders", "invoices", "customers"]
    private var online: OnlineInbox { .shared }

    /// The tabs before Search. Marketing has no dashboard: the ERP sends it to Posts, the first page it may open.
    private func tabEntries(_ map: NavMap) -> [NavEntry] {
        if session.role == "marketing" { return Array(map.entries.prefix(4)) }
        return Self.primary.compactMap { id in map.entries.first { $0.id == id } }
    }

    /// The chosen tab, or the first one when the remembered choice is not this person's (no Home for marketing).
    private func selection(_ entries: [NavEntry]) -> Binding<String> {
        Binding(
            get: { (entries.map(\.id) + ["search"]).contains(tab) ? tab : (entries.first?.id ?? "search") },
            set: { tab = $0 })
    }

    /// Online orders waiting beside Orders, as the web's sidebar counts them (nav.ts `count: 'online'`). Owners confirm them.
    private func badge(for e: NavEntry) -> Int {
        guard e.count == "online", session.isOwner, session.shop.websiteSelling else { return 0 }
        return online.waiting
    }

    /// Owners and staff are the accounts the server tells about online orders; marketing is refused.
    private var watchesOnline: Bool {
        session.shop.websiteSelling && (session.role == "owner" || session.role == "staff")
    }

    var body: some View {
        let map = map
        let entries = tabEntries(map)
        TabView(selection: selection(entries)) {
            ForEach(entries) { e in
                Tab(e.id == "home" ? "Home" : e.label, systemImage: NavIcon.symbol(for: e.icon), value: e.id) {
                    PlaceStack(root: e.href)
                }
                .badge(badge(for: e))
            }
            // Search is also the way to everything else: idle, it lists the ERP's whole map (the web's
            // sidebar) with Settings and the account; typed into, it finds any place by name or by the
            // words people use. An iPhone shows five tabs at most, and a sixth would fold both away.
            Tab("Search", systemImage: "magnifyingglass", value: "search", role: .search) {
                NavigationStack { SearchView(map: map) .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) } }
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .modifier(CreateAccessory(map: map, shown: session.role != "marketing") { creating = Route(path: $0) })
        .sheet(item: $creating) { r in
            NavigationStack {
                PlaceScreen(path: r.path)
                    .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Close", systemImage: "xmark") { creating = nil }
                        }
                    }
            }
        }
        // The one poll of the online-orders count (the dashboard and the Orders badge both read it).
        .task(id: watchesOnline) {
            if watchesOnline { await OnlineInbox.shared.keep() }
        }
        // The simulator check opens one page over the tabs (`-ERPDemoOpen /invoices/INV-D0002`).
        .task {
            if House.isDemo, let p = UserDefaults.standard.string(forKey: "ERPDemoOpen"), p.hasPrefix("/") { creating = Route(path: p) }
        }
        // A tapped notification opens its page over whatever is showing.
        .onChange(of: AppRouter.shared.open) { _, r in
            if let r { creating = r; AppRouter.shared.open = nil }
        }
    }
}

/// The bar above the tab bar, for the accounts that may create anything (not marketing).
private struct CreateAccessory: ViewModifier {
    let map: NavMap
    let shown: Bool
    let open: (String) -> Void

    func body(content: Content) -> some View {
        if shown {
            content.tabViewBottomAccessory { CreateBar(map: map, open: open) }
        } else {
            content
        }
    }
}

/// A tab's own stack, starting at an ERP place.
struct PlaceStack: View {
    let root: String
    var body: some View {
        NavigationStack {
            PlaceScreen(path: root, isRoot: true)
                .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
        }
    }
}

/// One ERP place: its tabs (the ERP's "one tab row per screen") as the title's menu, and the
/// screen for the chosen tab, native or the ERP page.
struct PlaceScreen: View {
    let path: String
    /// A tab's first screen: it carries the rate chip, as every page of the ERP does in its top bar (for everyone;
    /// an owner's opens the form, anyone else's a page to read).
    var isRoot = false
    @Environment(Session.self) private var session
    @State private var chosen: String?

    var body: some View {
        let bare = ScreenRoute.bare(path)
        // The map as this person sees it: staff are not offered Today's cash among Home's tabs.
        let entry = NavMap.current.visible(to: session.role).entry(for: path)
        let atTab = entry.map { e in bare == e.href || (e.tabs ?? []).contains { $0.href == bare } } ?? false
        let tabs = atTab ? (entry?.tabs ?? []) : []
        let current = chosen ?? path
        let title = tabs.first { $0.href == ScreenRoute.bare(current) }?.title
            ?? (entry?.href == ScreenRoute.bare(current) ? (entry?.heading ?? entry?.label) : nil)
        ScreenRegistry.view(for: current)
            .id(current)
            // A native screen names itself (and a hub keeps its large title); an ERP page is named from the map.
            .modifier(WebTitle(title: ScreenRegistry.hasNative(current) ? nil : (title ?? "")))
            .modifier(TabsMenu(tabs: tabs, chosen: $chosen))
            // Native screens sit on the house's ground; an ERP page brings its own (the same palette).
            .modifier(OptionalGround(on: ScreenRegistry.hasNative(current)))
            .toolbar {
                if isRoot {
                    ToolbarItem(placement: .topBarLeading) { RateChip() }
                }
                // The account, top right of Home as the system's own apps keep it: Settings (owners; anyone else
                // signs out from Search).
                if isRoot && bare == "/" && session.isOwner {
                    ToolbarItem(placement: .topBarTrailing) {
                        NavigationLink(value: Route(path: "/settings")) {
                            Initials(name: session.shop.person ?? session.me?.email ?? "", size: 32)
                        }
                        .accessibilityLabel("Settings")
                    }
                }
            }
    }
}

private struct OptionalGround: ViewModifier {
    let on: Bool
    func body(content: Content) -> some View {
        if on { content.modifier(HouseGround()) } else { content }
    }
}

private struct WebTitle: ViewModifier {
    let title: String?

    func body(content: Content) -> some View {
        if let title {
            content.navigationTitle(title).navigationBarTitleDisplayMode(.inline)
        } else {
            content
        }
    }
}

private struct TabsMenu: ViewModifier {
    let tabs: [NavPlace]
    @Binding var chosen: String?

    func body(content: Content) -> some View {
        if tabs.count > 1 {
            content.toolbarTitleMenu {
                ForEach(tabs) { t in
                    Button { chosen = t.href } label: { Label(t.label, systemImage: NavIcon.symbol(for: t.icon)) }
                }
            }
        } else {
            content
        }
    }
}

/// New sale, New order and Scan, always above the tab bar (the ERP's primary action and its
/// palette's Create group). New sale is the owners': the server saves sales for them alone, so the
/// map holds none for staff and the bar is Order and Scan.
struct CreateBar: View {
    let map: NavMap
    let open: (String) -> Void

    var body: some View {
        HStack(spacing: 0) {
            if let sale = map.newSale {
                item("New sale", "plus.circle.fill", sale.href)
                Divider().frame(height: 18)
            }
            item("Order", "list.clipboard", "/orders/add")
            Divider().frame(height: 18)
            item("Scan", "qrcode.viewfinder", "/scan")
        }
        .font(.subheadline.weight(.semibold))
    }

    private func item(_ title: String, _ symbol: String, _ path: String) -> some View {
        Button { open(path) } label: {
            Label(title, systemImage: symbol).frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
        .padding(.vertical, 6)
    }
}
