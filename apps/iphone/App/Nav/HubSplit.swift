import SwiftUI

/// What the app's menu bar and keyboard shortcuts ask of the open window (⌘1…⌘5, ⌘N, ⇧⌘N, ⌘F). The scene's
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

    /// The item the list picked: the detail stack's root.
    @State private var picked: Route?
    /// Pages opened from the item.
    @State private var deeper: [Route] = []
    /// The narrow window's own stack.
    @State private var stacked: [Route] = []

    /// Below this the two columns would each be too tight to read.
    private static var wideEnough: CGFloat { 700 }

    var body: some View {
        GeometryReader { geo in
            if geo.size.width >= Self.wideEnough {
                HStack(spacing: 0) {
                    NavigationStack(path: intercept) {
                        hub()
                            .navigationDestination(for: Route.self) { _ in EmptyView() }
                    }
                    .frame(width: min(420, max(340, geo.size.width * 0.38)))
                    Divider().ignoresSafeArea()
                    NavigationStack(path: $deeper) {
                        Group {
                            if let picked {
                                PlaceScreen(path: picked.path).id(picked)
                            } else {
                                ContentUnavailableView(prompt.title, systemImage: prompt.symbol)
                                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                                    .modifier(HouseGround())
                            }
                        }
                        .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
                    }
                    .frame(maxWidth: .infinity)
                }
                // Rows in the list never grow into a page that is in another column.
                .environment(\.zoomNamespace, nil)
            } else {
                NavigationStack(path: $stacked) {
                    hub()
                        .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
                }
            }
        }
    }

    private var intercept: Binding<[Route]> {
        Binding(
            get: { [] },
            set: { path in
                guard let route = path.last else { return }
                picked = route
                deeper = []
            })
    }
}
