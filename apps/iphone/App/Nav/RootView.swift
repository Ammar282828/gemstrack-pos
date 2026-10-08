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
                // A karigar's own work portal (the ERP's /my-work, shown at its root for them).
                NavigationStack { WebScreen(path: "/") }
            } else {
                RootView()
            }
        }
    }
}

/// The app: the shop's four most-used places as tabs, the ERP's whole map under Search, and New sale / New order / Scan always one tap away above the tab bar.
/// Liquid Glass comes with the system's TabView, toolbars and sheets (CONVENTIONS.md rule 4).
struct RootView: View {
    @Environment(Session.self) private var session
    // The simulator check opens each tab in turn (`-ERPDemoTab orders`).
    @State private var tab = UserDefaults.standard.string(forKey: "ERPDemoTab") ?? "home"
    @State private var creating: Route?

    private var map: NavMap { NavMap.current.visible(to: session.role) }
    private static let primary = ["home", "orders", "invoices", "customers"]

    var body: some View {
        let map = map
        TabView(selection: $tab) {
            ForEach(Self.primary.compactMap { id in map.entries.first { $0.id == id } }) { e in
                Tab(e.id == "home" ? "Home" : e.label, systemImage: NavIcon.symbol(for: e.icon), value: e.id) {
                    PlaceStack(root: e.href)
                }
            }
            // Search is also the way to everything else: idle, it lists the ERP's whole map (the web's
            // sidebar) with Settings and the account; typed into, it finds any place by name or by the
            // words people use. An iPhone shows five tabs at most, and a sixth would fold both away.
            Tab("Search", systemImage: "magnifyingglass", value: "search", role: .search) {
                NavigationStack { SearchView(map: map) .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) } }
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .tabViewBottomAccessory {
            CreateBar(map: map) { creating = Route(path: $0) }
        }
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
        // A tapped notification opens its page over whatever is showing.
        .onChange(of: AppRouter.shared.open) { _, r in
            if let r { creating = r; AppRouter.shared.open = nil }
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
    /// A tab's first screen: it carries the rate chip, as every page of the ERP does in its top bar.
    var isRoot = false
    @Environment(Session.self) private var session
    @State private var chosen: String?

    var body: some View {
        let bare = ScreenRoute.bare(path)
        let entry = NavMap.current.entry(for: path)
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
            .toolbar {
                if isRoot && session.isOwner {
                    ToolbarItem(placement: .topBarLeading) { RateChip() }
                }
            }
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
/// palette's Create group).
struct CreateBar: View {
    let map: NavMap
    let open: (String) -> Void

    var body: some View {
        HStack(spacing: 0) {
            item("New sale", "plus.circle.fill", map.newSale.href)
            Divider().frame(height: 18)
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
