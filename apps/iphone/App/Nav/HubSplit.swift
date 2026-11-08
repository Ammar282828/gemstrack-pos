import SwiftUI

/// What the app's menu bar and keyboard shortcuts ask of the open window (⌘1…⌘5, ⌘N, ⇧⌘N, ⌘F, ⌘K). The scene's
/// `.commands` (ERPApp) write here; RootView reads and acts, because only it knows the tabs and who is signed in.
@MainActor @Observable
final class ShellCommands {
    static let shared = ShellCommands()

    enum Kind: Equatable { case tab(Int), newSale, newOrder, search }
    struct Request: Equatable { let id: Int; let kind: Kind }

    /// The latest ask. A counter makes the same shortcut twice in a row two changes.
    private(set) var request: Request?
    private var count = 0
    /// Set by ⌘F, cleared by the search field once it has taken focus (the Search tab may not exist yet).
    var searchWanted = false
    /// The first five tabs' names, for the Go menu.
    var tabTitles: [String] = []

    func send(_ kind: Kind) {
        count += 1
        request = Request(id: count, kind: kind)
    }
}

/// The scene's menu bar: Go (tabs and Search) and the New items, ⌘N and ⇧⌘N. They are the only place these
/// shortcuts live; the create menu in a toolbar carries none, so nothing answers a key twice.
struct ShellMenu: Commands {
    private var shell: ShellCommands { .shared }

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Sale") { shell.send(.newSale) }.keyboardShortcut("n", modifiers: .command)
            Button("New Order") { shell.send(.newOrder) }.keyboardShortcut("n", modifiers: [.command, .shift])
        }
        CommandMenu("Go") {
            ForEach(0..<5, id: \.self) { i in
                Button(i < shell.tabTitles.count ? shell.tabTitles[i] : "Tab \(i + 1)") { shell.send(.tab(i)) }
                    .keyboardShortcut(KeyEquivalent(Character(String(i + 1))), modifiers: .command)
            }
            Divider()
            Button("Search") { shell.send(.search) }.keyboardShortcut("f", modifiers: .command)
            // ⌘K: the same ask as ⌘F (open Search, the field takes the keyboard), the name other apps give it.
            Button("Quick find") { shell.send(.search) }.keyboardShortcut("k", modifiers: .command)
        }
    }
}

/// Which hub tabs split into a list and the item beside it on an iPad's wide window, and what the empty
/// right-hand side says. Keyed by the tab's path.
enum HubSplitKind {
    static func prompt(for path: String) -> (title: String, symbol: String)? {
        switch ScreenRoute.bare(path) {
        case "/orders": return ("Choose an order", "list.clipboard")
        case "/invoices": return ("Choose an invoice", "doc.text")
        case "/customers": return ("Choose a customer", "person.2")
        case "/products": return ("Choose a piece", "diamond")
        case "/repairs": return ("Choose a repair", "wrench.and.screwdriver")
        default: return nil
        }
    }
}

/// A hub tab on an iPad's wide window: the hub as the list column, the picked item in a stack of its own beside it.
///
/// Our own two columns, not a NavigationSplitView: inside the tab sidebar the split view folded to the list alone,
/// stretched across the window, until something was picked (owner, 2026-10-24: "if I haven't selected anything
/// … it should leave empty space"). Here the right-hand side is always there while the window is wide enough.
///
/// The hub's rows stay `NavigationLink(value: Route)`. The list column is a NavigationStack whose path binding
/// never keeps anything: a tapped row appends its Route, the setter takes it as the detail's new root and the
/// getter answers "empty", so the list never pushes and every row lands in the detail column. Pages opened from
/// the item (a customer's invoice, an invoice's order) push on the detail's own stack and keep its back button.
/// No zoom crosses the columns: neither stack has a zoom namespace here. A narrow window (Split View, Slide Over)
/// is the phone's one stack.
struct HubSplit<Hub: View>: View {
    let prompt: (title: String, symbol: String)
    @ViewBuilder let hub: () -> Hub

    /// The item the list picked (or the New the toolbar asked for): the detail stack's root. A new `Pick` each time, so
    /// New order pressed again is a blank form again, not the one already on screen.
    @State private var picked: Pick?
    /// Whether the window is wide enough for two columns. Kept as a flag, read from the window's width only when it
    /// crosses the line: a GeometryReader here redrew both columns (the whole list and the form beside it) on every
    /// change of size, the keyboard's rise included.
    @State private var wide = true

    /// Below this the two columns would each be too tight to read.
    private static var wideEnough: CGFloat { 700 }

    var body: some View {
        Group {
            if wide {
                HStack(spacing: 0) {
                    NavigationStack(path: intercept) {
                        hub()
                            .navigationDestination(for: Route.self) { _ in EmptyView() }
                    }
                    // The list's rows (RouteLink) and the toolbar's New open in the item column, in place of what was
                    // there. Only this column: pages in the item column push on their own stack as anywhere else.
                    .environment(\.openInPlace, OpenInPlace { show($0) })
                    .frame(width: listWidth)
                    Divider().ignoresSafeArea()
                    // No path kept for this stack, as on a phone: its pages (an order's Edit, an invoice's) are pushed
                    // by the screens' own destinations, which a stack driven by a path did not hold steady (the edit
                    // form stopped answering on an iPad, owner 2026-11-08). A new pick makes a new stack, so whatever
                    // was opened beneath the old item goes with it.
                    NavigationStack {
                        Group {
                            if let picked {
                                PlaceScreen(path: picked.route.path)
                            } else {
                                ContentUnavailableView(prompt.title, systemImage: prompt.symbol)
                                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                                    .modifier(HouseGround())
                            }
                        }
                        .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
                    }
                    .id(picked?.token)
                    .frame(maxWidth: .infinity)
                }
                // Rows in the list never grow into a page that is in another column.
                .environment(\.zoomNamespace, nil)
            } else {
                // A narrow window (Split View, Slide Over) is the phone's one stack; New opens over it as on a phone.
                NavigationStack {
                    hub()
                        .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
                }
            }
        }
        .onGeometryChange(for: Bool.self) { $0.size.width >= Self.wideEnough } action: { now in
            if now != wide { wide = now }
        }
        .onGeometryChange(for: CGFloat.self) { proxy in
            (min(440, max(360, proxy.size.width * 0.42)) / 10).rounded() * 10
        } action: { now in
            if now != listWidth { listWidth = now }
        }
    }

    /// The list column's width, in steps of 10 points so a resize redraws it only now and then.
    @State private var listWidth: CGFloat = 380

    private var intercept: Binding<[Route]> {
        Binding(
            get: { [] },
            set: { path in
                guard let route = path.last else { return }
                show(route)
            })
    }

    /// A page as the item column's new root: anything opened beneath the old one goes with it, without a slide.
    private func show(_ route: Route) {
        var quiet = Transaction()
        quiet.disablesAnimations = true
        withTransaction(quiet) { picked = Pick(route: route) }
    }
}

/// One choice of the item column: the same page chosen twice is two picks (a fresh New order each time).
private struct Pick: Equatable {
    let route: Route
    let token = UUID()
}

/// Opens a page in the open tab's own column on an iPad (HubSplit's item column, or the tab's stack) instead of a sheet
/// over the whole window (owner, 2026-11-08: "pressing a new order sometimes doesn't replace the current screen": a sheet
/// asked for while the New menu was still closing was dropped by the system, and the sheet redrew the sidebar).
struct OpenInPlace {
    let open: (Route) -> Void
    init(_ open: @escaping (Route) -> Void) { self.open = open }
    func callAsFunction(_ route: Route) { open(route) }
}

private struct OpenInPlaceKey: EnvironmentKey { static let defaultValue: OpenInPlace? = nil }

extension EnvironmentValues {
    var openInPlace: OpenInPlace? {
        get { self[OpenInPlaceKey.self] }
        set { self[OpenInPlaceKey.self] = newValue }
    }
}

/// A row's way to its page: a NavigationLink, except in an iPad's list column, where it hands the page to the item column
/// beside it. A NavigationLink there asked the list's own stack to push and was turned aside afterwards, and the list
/// showed an empty white page for a moment on every tap (owner, 2026-11-08: "why does the sidebar become white every
/// time I press an order or invoice on iPad").
struct RouteLink<Label: View>: View {
    let value: Route
    /// A row (the words in their own colours across the whole row) or a button (a toolbar's, a prominent one: as drawn).
    let row: Bool
    @ViewBuilder let label: () -> Label
    @Environment(\.openInPlace) private var openInPlace

    init(value: Route, row: Bool = true, @ViewBuilder label: @escaping () -> Label) {
        self.value = value
        self.row = row
        self.label = label
    }

    var body: some View {
        if let openInPlace {
            if row {
                // The words keep their own colours (a List would tint a button's label), and the whole row is the target.
                Button { openInPlace(value) } label: {
                    label()
                        .foregroundStyle(Color.primary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                }
            } else {
                Button { openInPlace(value) } label: { label() }
            }
        } else {
            NavigationLink(value: value, label: label)
        }
    }
}
