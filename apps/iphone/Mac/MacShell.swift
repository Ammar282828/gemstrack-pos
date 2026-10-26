#if os(macOS)
import SwiftUI
import AppKit

/// What the Mac's menus ask of the frontmost window (MacCommands): the window that has focus answers, because only it
/// knows who is signed in and which place it shows.
@MainActor @Observable
final class MacShellModel {
    /// The sidebar's place (an entry's href, or "search").
    var selection: String? = "/"
    /// Pages opened from it, the detail's stack. A page opened (or closed) by anything but Back and Forward (a link in
    /// a page, ⌘K) is a step of its own: the way forward is dropped, as a browser's is.
    var stack: [Route] {
        get { pages }
        set {
            // NavigationStack writes its path back unchanged at times: that is no step.
            guard newValue != pages else { return }
            pages = newValue
            if !retracing { future = [] }
        }
    }
    private var pages: [Route] = []
    /// Back or Forward is moving the window: its own changes to the stack keep the way forward.
    @ObservationIgnored private var retracing = false
    /// New sale, New order, Scan, a repair: opened in a window of its own (`MacPlaceWindow`).
    var creating: Route?
    var voice = false
    var pendingRoute: Route?
    /// ⌘K's panel is over the window (MacQuickOpen).
    var quickOpen = false
    /// Help › Send Page Snapshots… was chosen for this window (MacSnapshots).
    var snapshots = false

    /// The place this window shows now, deepest first: what ⌘P prints and "Open in New Window" opens.
    var current: Route? {
        if let last = stack.last { return last }
        guard let s = selection, s != MacShell.searchID else { return nil }
        return Route(path: s)
    }

    /// Where this window has been and, after Back, where it was going: ⌘[ and ⌘], the toolbar's ‹ › (as Finder's).
    struct Visit: Equatable {
        let selection: String?
        let stack: [Route]
    }
    private(set) var history: [Visit] = []
    private(set) var future: [Visit] = []

    func go(_ path: String) {
        guard path != selection || !stack.isEmpty else { return }
        history.append(Visit(selection: selection, stack: stack))
        if history.count > 50 { history.removeFirst(history.count - 50) }
        future = []
        stack = []
        selection = path
    }

    var canGoBack: Bool { !stack.isEmpty || !history.isEmpty }
    var canGoForward: Bool { !future.isEmpty }

    /// Out of the page opened inside a place first, then to the place before.
    func goBack() {
        guard canGoBack else { return }
        retracing = true
        defer { retracing = false }
        future.append(Visit(selection: selection, stack: stack))
        if !stack.isEmpty {
            stack.removeLast()
        } else if let last = history.popLast() {
            selection = last.selection
            stack = last.stack
        }
    }

    func goForward() {
        guard let next = future.popLast() else { return }
        retracing = true
        defer { retracing = false }
        // Deeper in the same place is the page Back closed; another place is a visit of its own.
        if next.selection != selection { history.append(Visit(selection: selection, stack: stack)) }
        selection = next.selection
        stack = next.stack
    }

    /// A role that may no longer open some places (or another business's map): visits to them leave the history and
    /// the way forward, so Back never reaches a page the person can no longer see.
    func forget(keeping allowed: Set<String>) {
        func ok(_ v: Visit) -> Bool { v.selection.map { allowed.contains($0) || $0 == MacShell.searchID } ?? false }
        history = history.filter(ok)
        future = future.filter(ok)
    }

    /// Where the window is and how it got there, to put back after it has been walked (Send Page Snapshots).
    struct Memento {
        let selection: String?
        let stack: [Route]
        let history: [Visit]
        let future: [Visit]
    }
    var memento: Memento { Memento(selection: selection, stack: stack, history: history, future: future) }
    func restore(_ m: Memento) {
        retracing = true
        defer { retracing = false }
        selection = m.selection
        stack = m.stack
        history = m.history
        future = m.future
    }
}

/// The signed-in Mac: the ERP's whole map down the sidebar (src/lib/nav.ts, exported per house), the chosen place in
/// the detail with its own stack; the business, New Sale, New Order and Search at the sidebar's head, the rate at its foot.
struct MacShell: View {
    static let searchID = "search"

    /// Where a window starts and Go › Today goes: Today, or the first place of a role without it.
    static func home(_ sections: [MacSidebarSection]) -> String {
        MacSidebarMap.allPaths(sections).contains("/") ? "/" : (MacSidebarMap.places(sections).first?.id ?? "/")
    }

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
            MacSidebar(sections: sections,
                       selection: Binding(get: { model.selection }, set: { if let s = $0 { model.go(s) } }),
                       commands: commands(map),
                       showsRate: session.role != "marketing") {
                openWindow(id: MacWindows.place, value: $0)
            }
            .navigationSplitViewColumnWidth(min: 220, ideal: 250, max: 320)
        } detail: {
            NavigationStack(path: $model.stack) {
                detailRoot
                    .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
            }
            // A hub's row opened in a window of its own (its context menu or a double-click) comes through here.
            .environment(\.openPlaceWindow, OpenPlaceWindow { openWindow(id: MacWindows.place, value: $0) })
        }
        // The window's only toolbar items: Back and Forward, ahead of the title as Finder's are. A Mac toolbar with nothing
        // before the title drew the title over the sidebar (owner's screenshots, 2026-10-25). The rest of the toolbar is
        // the place's own (its New, its filter, its search); New Sale, New Order and Search are the sidebar's first rows.
        .toolbar {
            ToolbarItemGroup(placement: .navigation) {
                Button { model.goBack() } label: { Label("Back", systemImage: "chevron.left") }
                    .disabled(!model.canGoBack)
                    .help("Back (\u{2318}[)")
                Button { model.goForward() } label: { Label("Forward", systemImage: "chevron.right") }
                    .disabled(!model.canGoForward)
                    .help("Forward (\u{2318}])")
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
        // Tables and lists without zebra stripes, as Mail's, Notes' and Reminders' on Tahoe: striped, an empty or short
        // table read as a page of blank rows (owner's screenshot of Drafts, 2026-10-25).
        .alternatingRowBackgrounds(.disabled)
        .focusedSceneValue(\.macShell, model)
        .focusedSceneValue(\.macMap, map)
        .focusedSceneValue(\.macPlaces, MacSidebarMap.places(sections).map { MacPlaceLink(title: $0.title, path: $0.id) })
        // A new sale, order or repair is a window of its own, as a new document is on a Mac: the main window stays
        // usable beside it (look up a customer, check the stock), and two can be open at once.
        .onChange(of: model.creating) { _, r in
            guard let r else { return }
            openWindow(id: MacWindows.place, value: MacWindows.fresh(r))
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
            let sections = sidebarSections(map)
            let allowed = MacSidebarMap.allPaths(sections)
            model.forget(keeping: allowed)
            let s = model.selection ?? "/"
            if allowed.contains(s) || s == Self.searchID { model.stack = [] } else { model.go(Self.home(sections)) }
        }
        // Locked: nothing of the books stays drawn over the lock (the ⌘K panel, the voice sheet).
        .onChange(of: AppLock.shared.locked) { _, locked in
            if locked { model.quickOpen = false; model.voice = false }
        }
        .onChange(of: model.selection) { _, s in if restored { savedPlace = s ?? "/" } }
        .onChange(of: model.snapshots) { _, asked in
            guard asked else { return }
            model.snapshots = false
            let stops = MacSnapshots.stops(sections)
            let business = Businesses.shared.current.id
            Task { @MainActor in MacSnapshots.ask(shell: model, stops: stops, business: business) }
        }
        // Every list a shop opens all day is read in the background once the window is up, so the first click on
        // Orders, Invoices, Customers, Stock or Repairs shows its table at once, never a spinner. A Mac has the memory;
        // each shelf paints from its own file on disk first.
        .task(id: session.role) {
            // Only once the ERP has said who this is: the map and the shelves are by role.
            guard session.role != "none" else { return }
            // Back where this window was when the app last quit (a place this person can still open).
            if !restored {
                restored = true
                if House.isDemo, let p = UserDefaults.standard.string(forKey: "ERPDemoOpen"), p.hasPrefix("/") {
                    // The UI tests open one page at launch (`-ERPDemoOpen /orders?list=late`), as the iPhone's do.
                    model.go(p)
                } else if savedPlace != "/", MacSidebarMap.allPaths(sidebarSections(map)).contains(savedPlace) {
                    model.selection = savedPlace
                }
            }
            // A role with no Today (marketing) opens on its first place, never on a dashboard of books it may not see.
            let sections = sidebarSections(map)
            if let s = model.selection, s != Self.searchID, !MacSidebarMap.allPaths(sections).contains(s) {
                model.selection = Self.home(sections)
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

    /// The sidebar's head: New Sale and New Order for those who sell, Search for everyone.
    private func commands(_ map: NavMap) -> MacSidebarCommands {
        let model = self.model
        let sells = session.role != "marketing"
        var out = MacSidebarCommands(search: { model.quickOpen = true })
        if sells {
            if map.newSale != nil { out.newSale = { model.creating = Route(path: "/invoices/new") } }
            out.newOrder = { model.creating = Route(path: "/orders/add") }
        }
        return out
    }

    // MARK: The detail

    /// The Mac's own places (docs/features/mac-design.md), by the sidebar's path; nil for a place drawn by its screen.
    /// A place (or one of its saved lists) opened in a window of its own is drawn by the same view, so the window shows
    /// the list it was opened from, not every record.
    static func macPlace(_ path: String) -> AnyView? {
        switch ScreenRoute.bare(path) {
        case "/orders": return AnyView(MacOrdersPlace(path: path))
        case "/invoices": return AnyView(MacInvoicesPlace(path: path))
        case "/customers": return AnyView(MacCustomersPlace(path: path))
        case "/repairs": return AnyView(MacRepairsPlace(path: path))
        case "/products": return AnyView(MacStockPlace(path: path))
        default: return nil
        }
    }

    @ViewBuilder
    private var detailRoot: some View {
        let selection = model.selection ?? "/"
        if selection == Self.searchID {
            SearchView(map: map).modifier(TeamNotePresentation())
        } else if session.role != "marketing", let place = Self.macPlace(selection) {
            // Orders, Invoices, Customers, Repairs, Stock (and their saved lists): the place's table with the inspector.
            place.id(selection)
        } else {
            PlaceScreen(path: selection, isRoot: true)
                .id(selection)
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
    @Environment(\.dismiss) private var dismiss
    /// The business this window was opened on. Its books are that business's: a switch to another closes the window
    /// rather than draw the same path (an order number, a half-made sale) from the other business's books.
    @State private var openedOn: String?

    var body: some View {
        let business = Businesses.shared.current
        let session = Sessions.shared.session(for: business)
        Group {
            if let route, session.state == .signedIn, openedOn == nil || openedOn == business.id {
                NavigationStack(path: $stack) {
                    root(route, role: session.role)
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
        .alternatingRowBackgrounds(.disabled)
        .modifier(MacLockCover())
        .environment(\.locale, Locale(identifier: "en_PK"))
        .frame(minWidth: 640, minHeight: 520)
        .onAppear { if openedOn == nil { openedOn = business.id } }
        .onChange(of: business.id) { _, now in if let openedOn, now != openedOn { dismiss() } }
    }

    @ViewBuilder
    private func root(_ route: Route, role: String) -> some View {
        if role != "marketing", let place = MacShell.macPlace(route.path) {
            place
        } else {
            PlaceScreen(path: route.path)
        }
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
