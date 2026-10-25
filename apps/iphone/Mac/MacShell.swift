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

    var body: some View {
        let map = map
        NavigationSplitView(columnVisibility: $columns) {
            sidebar(map)
                .navigationSplitViewColumnWidth(min: 200, ideal: 236, max: 320)
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
            if s == Self.searchID || map.entry(for: s) != nil { model.stack = [] } else { model.go("/") }
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
                if savedPlace != "/", savedPlace == Self.searchID || map.entry(for: savedPlace) != nil { model.selection = savedPlace }
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

    // MARK: The sidebar

    private func sidebar(_ map: NavMap) -> some View {
        List(selection: Binding(get: { model.selection }, set: { if let s = $0 { model.go(s) } })) {
            Label("Search", systemImage: "magnifyingglass").tag(Self.searchID)
            ForEach(map.groups, id: \.key) { group in
                let entries = map.entries.filter { $0.group == group.key }
                if !entries.isEmpty {
                    Section(group.label) {
                        ForEach(entries) { e in
                            row(e).tag(e.href)
                        }
                    }
                }
            }
            if let settings = map.settings {
                Section {
                    Label(settings.label, systemImage: NavIcon.symbol(for: settings.icon)).tag(settings.href)
                }
            }
        }
        .listStyle(.sidebar)
        .safeAreaInset(edge: .top) {
            BusinessChip(wide: true)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .contextMenu(forSelectionType: String.self) { picked in
            if let p = picked.first, p != Self.searchID {
                Button("Open in New Window") { openWindow(id: MacWindows.place, value: Route(path: p)) }
            }
        }
    }

    private func row(_ e: NavEntry) -> some View {
        Label(e.id == "home" ? "Home" : e.label, systemImage: NavIcon.symbol(for: e.icon))
            .badge(badge(for: e))
    }

    private func badge(for e: NavEntry) -> Int {
        guard e.count == "online", session.isOwner, session.shop.websiteSelling else { return 0 }
        return online.waiting
    }

    // MARK: The detail

    @ViewBuilder
    private var detailRoot: some View {
        let selection = model.selection ?? "/"
        if selection == Self.searchID {
            SearchView(map: map).modifier(TeamNotePresentation())
        } else if session.role != "marketing", let kind = MacHubKind(path: selection) {
            // Orders, Invoices, Customers, Stock, Repairs: a sortable table with the picked one beside it.
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
                if let sale = map.newSale {
                    Button("New sale", systemImage: "banknote") { open(sale.href) }
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

    var body: some View {
        let business = Businesses.shared.current
        let session = Sessions.shared.session(for: business)
        Group {
            if let route, session.state == .signedIn {
                NavigationStack(path: $stack) {
                    PlaceScreen(path: route.path)
                        .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
                }
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

extension FocusedValues {
    var macShell: MacShellModel? {
        get { self[MacShellKey.self] }
        set { self[MacShellKey.self] = newValue }
    }
    var macMap: NavMap? {
        get { self[MacMapKey.self] }
        set { self[MacMapKey.self] = newValue }
    }
    /// The place a separate window shows (its deepest page).
    var macPlace: Route? {
        get { self[MacPlaceKey.self] }
        set { self[MacPlaceKey.self] = newValue }
    }
}
#endif
