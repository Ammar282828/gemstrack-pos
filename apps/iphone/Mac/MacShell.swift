#if os(macOS)
import SwiftUI
import AppKit

/// What the Mac's menus ask of the frontmost window (MacCommands): the window that has focus answers, because only it
/// knows who is signed in and which place it shows.
@MainActor @Observable
final class MacShellModel {
    /// The sidebar's place (an entry's href, or "search").
    var selection: String? = "/"
    /// Pages opened from it, the detail's stack.
    var stack: [Route] = []
    /// New sale, New order, Scan, a repair: opened in a window of its own (`MacPlaceWindow`).
    var creating: Route?
    var voice = false
    var pendingRoute: Route?
    /// ⌘K's panel is over the window (MacQuickOpen).
    var quickOpen = false

    /// The place this window shows now, deepest first: what ⌘P prints and "Open in New Window" opens.
    var current: Route? {
        if let last = stack.last { return last }
        guard let s = selection, s != MacShell.searchID else { return nil }
        return Route(path: s)
    }

    func go(_ path: String) {
        stack = []
        selection = path
    }
}

/// The signed-in Mac: the ERP's whole map down the sidebar (src/lib/nav.ts, exported per house), the chosen place in
/// the detail with its own stack, the business chip heading the sidebar, and New in the toolbar.
struct MacShell: View {
    static let searchID = "search"
    @Environment(Session.self) private var session
    @Environment(\.openWindow) private var openWindow
    @State private var model = MacShellModel()
    @State private var columns = NavigationSplitViewVisibility.all
    /// The window's place, kept across quitting: a Mac app reopens where it was left.
    @SceneStorage("mac.place") private var savedPlace = "/"
    @State private var restored = false

    private var map: NavMap { NavMap.current.visible(to: session.role) }
    private var online: OnlineInbox { .shared }

    /// Owners and staff are told of online orders; the count sits beside Orders, as the web's sidebar has it.
    private var watchesOnline: Bool {
        session.shop.websiteSelling && (session.role == "owner" || session.role == "staff")
    }

    private func sidebarSections(_ map: NavMap) -> [MacSidebarSection] {
        MacSidebarMap.sections(map, websiteSelling: session.shop.websiteSelling, role: session.role)
    }

    var body: some View {
        let map = map
        let sections = sidebarSections(map)
        NavigationSplitView(columnVisibility: $columns) {
            MacSidebar(sections: sections, selection: Binding(get: { model.selection }, set: { if let s = $0 { model.go(s) } })) {
                openWindow(id: MacWindows.place, value: $0)
            }
            .navigationSplitViewColumnWidth(min: 200, ideal: 230, max: 320)
        } detail: {
            NavigationStack(path: $model.stack) {
                detailRoot
                    .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
            }
            // A hub's row opened in a window of its own (its context menu or a double-click) comes through here.
            .environment(\.openPlaceWindow, OpenPlaceWindow { openWindow(id: MacWindows.place, value: $0) })
        }
        .toolbar {
            ToolbarItem(placement: .navigation) {
                MacCreateMenu(map: map, voiceShown: session.isOwner, shown: session.role != "marketing") { model.creating = Route(path: $0) } talk: { model.voice = true }
            }
            ToolbarItem(placement: .navigation) {
                Button { model.quickOpen = true } label: { Label("Quick Open", systemImage: "magnifyingglass") }
                    .help("Open a customer, invoice, order, piece or place (⌘K)")
            }
            // The shop's rate on every place, as the ERP's top bar has it: a click sets it (owners) or reads it.
            if session.role != "marketing" {
                ToolbarItem(placement: .navigation) { RateChip() }
            }
        }
        // ⌘K: the panel over the whole window; a click outside it, or Esc, puts it away.
        .overlay(alignment: .top) {
            if model.quickOpen {
                ZStack(alignment: .top) {
                    Color.black.opacity(0.08)
                        .contentShape(Rectangle())
                        .onTapGesture { model.quickOpen = false }
                    MacQuickOpen(map: map, model: model, canCreate: session.role != "marketing")
                        .padding(.top, 72)
                        .transition(.opacity.combined(with: .scale(scale: 0.98, anchor: .top)))
                }
                .ignoresSafeArea()
            }
        }
        .animation(.easeOut(duration: 0.12), value: model.quickOpen)
        .focusedSceneValue(\.macShell, model)
        .focusedSceneValue(\.macMap, map)
        .focusedSceneValue(\.macPlaces, MacSidebarMap.places(sections).map { MacPlaceLink(title: $0.title, path: $0.id) })
        // A new sale, order or repair is a window of its own, as a new document is on a Mac: the main window stays
        // usable beside it (look up a customer, check the stock), and two can be open at once.
        .onChange(of: model.creating) { _, r in
            guard let r else { return }
            openWindow(id: MacWindows.place, value: r)
            model.creating = nil
        }
        .sheet(isPresented: $model.voice, onDismiss: {
            if let p = model.pendingRoute { model.pendingRoute = nil; model.creating = p }
        }) {
            NavigationStack {
                NativeVoiceScreen { path in model.pendingRoute = Route(path: path); model.voice = false }
            }
            .frame(minWidth: 560, minHeight: 520)
        }
        .task(id: watchesOnline) {
            if watchesOnline { await OnlineInbox.shared.keep() }
        }
        .task {
            if let r = AppRouter.shared.open { model.creating = r; AppRouter.shared.open = nil }
        }
        .onChange(of: AppRouter.shared.open) { _, r in
            if let r { model.creating = r; AppRouter.shared.open = nil }
        }
        // Another role sees another map: a place it may no longer open goes Home (a role arriving at launch keeps the
        // place the window reopened on).
        .onChange(of: session.role) { _, _ in
            let s = model.selection ?? "/"
            if MacSidebarMap.allPaths(sidebarSections(map)).contains(s) { model.stack = [] } else { model.go("/") }
        }
        .onChange(of: model.selection) { _, s in if restored { savedPlace = s ?? "/" } }
        // Every list a shop opens all day is read in the background once the window is up, so the first click on
        // Orders, Invoices, Customers, Stock or Repairs shows its table at once, never a spinner. A Mac has the memory;
        // each shelf paints from its own file on disk first.
        .task(id: session.role) {
            // Only once the ERP has said who this is: the map and the shelves are by role.
            guard session.role != "none" else { return }
            // Back where this window was when the app last quit (a place this person can still open).
            if !restored {
                restored = true
                if savedPlace != "/", MacSidebarMap.allPaths(sidebarSections(map)).contains(savedPlace) { model.selection = savedPlace }
            }
            guard session.role != "marketing" else { return }
            try? await Task.sleep(for: .milliseconds(400))
            let book = Book.shared
            book.settings.need()
            book.orders.need()
            book.invoices.need()
            book.customers.need()
            book.products.need()
            book.repairs.need()
            if session.isOwner {
                book.expenses.need()
                book.revenue.need()
            }
        }
    }

    // MARK: The detail

    /// The Mac's own places (docs/features/mac-design.md), by the sidebar's path; nil for a place drawn by its screen.
    private func macPlace(_ path: String) -> AnyView? {
        switch ScreenRoute.bare(path) {
        case "/orders": return AnyView(MacOrdersPlace(path: path))
        case "/invoices": return AnyView(MacInvoicesPlace(path: path))
        case "/customers": return AnyView(MacCustomersPlace(path: path))
        case "/repairs": return AnyView(MacRepairsPlace(path: path))
        default: return nil
        }
    }

    @ViewBuilder
    private var detailRoot: some View {
        let selection = model.selection ?? "/"
        if selection == Self.searchID {
            SearchView(map: map).modifier(TeamNotePresentation())
        } else if session.role != "marketing", let place = macPlace(selection) {
            // Orders, Invoices, Customers, Repairs (and their saved lists): the place's table with the inspector.
            place.id(selection)
        } else if session.role != "marketing", let kind = MacHubKind(path: selection) {
            // Stock: a sortable table with the picked one beside it.
            MacHub(kind: kind, rootPath: selection)
                .id(selection)
        } else {
            PlaceScreen(path: selection, isRoot: true)
                .id(selection)
        }
    }
}

/// New: a sale, an order, a scan, or the voice assistant, from the toolbar (⌘N and ⇧⌘N are the menu bar's).
struct MacCreateMenu: View {
    let map: NavMap
    let voiceShown: Bool
    let shown: Bool
    let open: (String) -> Void
    let talk: () -> Void

    var body: some View {
        if shown {
            Menu {
                if map.newSale != nil {
                    // Straight to the sale: the iPhone's "What is it?" chooser is not the Mac's (⌘N, ⇧⌘N, ⌥⌘N say it).
                    Button("New sale", systemImage: "banknote") { open("/invoices/new") }
                }
                Button("New order", systemImage: "list.clipboard") { open("/orders/add") }
                Button("New repair", systemImage: "wrench.and.screwdriver") { open("/repairs?new=1") }
                Button("Scan a tag", systemImage: "barcode.viewfinder") { open("/scan") }
                if voiceShown {
                    Divider()
                    Button("Voice assistant", systemImage: "mic") { talk() }
                }
            } label: {
                Label("New", systemImage: "plus")
            }
            .help("New sale, order, repair or scan")
        }
    }
}

// MARK: - Opening a place in its own window

/// Lets a screen deep in the detail (a table's row) open a place in a window of its own without knowing the scene.
struct OpenPlaceWindow {
    let open: (Route) -> Void
    func callAsFunction(_ route: Route) { open(route) }
}

private struct OpenPlaceWindowKey: EnvironmentKey { static let defaultValue: OpenPlaceWindow? = nil }

extension EnvironmentValues {
    var openPlaceWindow: OpenPlaceWindow? {
        get { self[OpenPlaceWindowKey.self] }
        set { self[OpenPlaceWindowKey.self] = newValue }
    }
}

/// One place in a window of its own, signed in as the main window is, behind the same lock.
struct MacPlaceWindow: View {
    let route: Route?
    @State private var stack: [Route] = []
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        let business = Businesses.shared.current
        let session = Sessions.shared.session(for: business)
        Group {
            if let route, session.state == .signedIn {
                NavigationStack(path: $stack) {
                    PlaceScreen(path: route.path)
                        .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
                }
                // A record in this window opens another record in a window of its own, as the main window's do.
                .environment(\.openPlaceWindow, OpenPlaceWindow { openWindow(id: MacWindows.place, value: $0) })
                .focusedSceneValue(\.macPlace, stack.last ?? route)
            } else {
                ContentUnavailableView("Sign in in the main window", systemImage: "person.crop.circle.badge.questionmark")
            }
        }
        .environment(session)
        .environment(Book.shared)
        .tint(Theme.accent)
        .modifier(MacLockCover())
        .environment(\.locale, Locale(identifier: "en_PK"))
        .frame(minWidth: 640, minHeight: 520)
    }
}

// MARK: - What the menus read from the frontmost window

private struct MacShellKey: FocusedValueKey { typealias Value = MacShellModel }
private struct MacMapKey: FocusedValueKey { typealias Value = NavMap }
private struct MacPlaceKey: FocusedValueKey { typealias Value = Route }
private struct MacPlacesKey: FocusedValueKey { typealias Value = [MacPlaceLink] }

/// A sidebar place for the Go menu (⌘1–⌘9, in the sidebar's order).
struct MacPlaceLink: Hashable {
    let title: String
    let path: String
}

extension FocusedValues {
    var macShell: MacShellModel? {
        get { self[MacShellKey.self] }
        set { self[MacShellKey.self] = newValue }
    }
    var macMap: NavMap? {
        get { self[MacMapKey.self] }
        set { self[MacMapKey.self] = newValue }
    }
    /// The sidebar's places in order (the Go menu's ⌘1–⌘9).
    var macPlaces: [MacPlaceLink]? {
        get { self[MacPlacesKey.self] }
        set { self[MacPlacesKey.self] = newValue }
    }
    /// The place a separate window shows (its deepest page).
    var macPlace: Route? {
        get { self[MacPlaceKey.self] }
        set { self[MacPlaceKey.self] = newValue }
    }
}
#endif
