#if os(macOS)
import SwiftUI
import AppKit

/// The Mac's menu bar (docs/features/mac-design.md, "The menu bar"). Each item acts on the frontmost window, which
/// publishes what it shows (MacShell, MacPlaceWindow) and, for the record picked in it, its actions (`MacRecordMenu`):
/// the record's menu is drawn from them, so every action a record has is in the menu bar with its key.
struct MacCommands: Commands {
    @FocusedValue(\.macShell) private var shell
    @FocusedValue(\.macPlace) private var place
    @FocusedValue(\.macPlaces) private var places
    @FocusedValue(\.macRecordMenu) private var recordMenu
    @FocusedValue(\.macRefresh) private var refresh
    @Environment(\.openWindow) private var openWindow
    /// View › Show or Hide Inspector: the title follows the state, as Mail's "Hide Preview" does.
    @AppStorage(MacInspector.key) private var inspectorShown = true

    /// The page in front: a separate window's, else the main window's deepest.
    private var current: Route? { ready ? place ?? shell?.current : nil }
    /// The business in front's map, whatever window is key: a place window or Settings has no sidebar, and its menus
    /// still answer (⌘N from a New Sale window, Lock Now from Settings).
    private var map: NavMap? {
        let session = Sessions.shared.current
        return session.state == .signedIn ? NavMap.current.visible(to: session.navRole) : nil
    }
    private var signedIn: Bool { map != nil }
    /// Signed in and not behind the lock: the books' commands answer only then.
    private var ready: Bool { signedIn && !AppLock.shared.locked }
    private var isOwner: Bool { map?.settings != nil }
    private var sells: Bool { map?.actions.isEmpty == false }

    private func open(_ path: String) { openWindow(id: MacWindows.place, value: Route(path: path)) }

    /// A new sale, order, repair or scan: through the main window when it is in front (it remembers a voice's pick), else
    /// straight into a window of its own.
    private func create(_ path: String) {
        if let shell { shell.creating = Route(path: path) } else { openWindow(id: MacWindows.place, value: MacWindows.fresh(Route(path: path))) }
    }

    var body: some Commands {
        appMenu
        fileMenu
        editMenu
        viewMenu
        goMenu
        CommandMenu(recordMenu?.title ?? "Item") {
            if let recordMenu, ready {
                MacActionItems(groups: Self.withoutReserved(recordMenu.groups), context: false)
            } else {
                Button("Nothing Selected") {}.disabled(true)
            }
        }
        windowMenu
        // Grouped: a CommandsBuilder holds ten at most.
        Group {
            SidebarCommands()
            ToolbarCommands()
        }
        CommandGroup(replacing: .help) {
            Button("Keyboard Shortcuts") { MacShortcutsWindow.show() }
                .keyboardShortcut("/", modifiers: .command)
            Button("The ERP on the Web") {
                NSWorkspace.shared.open(House.business.url)
            }
            Divider()
            Button("Send Page Snapshots\u{2026}") { shell?.snapshots = true }
                .disabled(shell == nil || !ready || !isOwner || House.isDemo || MacSnapshots.running)
        }
        // Continuity Camera: "Import from iPhone" (Take Photo, Scan Documents) on the File menu, into whatever field has
        // focus and takes pictures (a piece's photo, a bill to read).
        ImportFromDevicesCommands()
    }

    // MARK: ERP

    private var appMenu: some Commands {
        CommandGroup(after: .appSettings) {
            Divider()
            Button("Lock Now") { AppLock.shared.lockNow() }
                .disabled(!ready || !AppLock.shared.enabled)
            Button("Sign Out…") { MacSignOut.ask() }
                .disabled(!signedIn)
        }
    }

    // MARK: File

    private var fileMenu: some Commands {
        Group {
            CommandGroup(replacing: .newItem) {
                // The counter's three jobs keep their keys whatever is in front (a new sale is a sale, not the chooser).
                Button("New Sale") { create("/invoices/new") }
                    .keyboardShortcut("n", modifiers: .command)
                    .disabled(!ready || map?.newSale == nil)
                Button("New Order") { create("/orders/add") }
                    .keyboardShortcut("n", modifiers: [.command, .shift])
                    .disabled(!ready || !sells)
                Button("New Repair") { create("/repairs?new=1") }
                    .keyboardShortcut("n", modifiers: [.command, .option])
                    .disabled(!ready || !sells)
                Menu("New") {
                    Button("Customer") { open("/customers/add") }.disabled(!sells)
                    Button("Piece") { open("/products/add") }.disabled(!isOwner)
                    Button("Pieces in Bulk") { open("/products/bulk-add") }.disabled(!isOwner)
                    Button("Karigar") { open("/karigars/add") }.disabled(!isOwner)
                }
                .disabled(!ready)
                Button("New Window") { openWindow(id: MacWindows.main) }
                Divider()
                Button("Open in New Window") { if let r = current { openWindow(id: MacWindows.place, value: r) } }
                    .keyboardShortcut("o", modifiers: .command)
                    .disabled(current == nil)
                Button("Scan a Tag…") { create("/scan") }
                    .keyboardShortcut("t", modifiers: [.command, .shift])
                    .disabled(!ready || !sells)
                Button("Voice Assistant…") { shell?.voice = true }
                    .disabled(shell == nil || !ready || !isOwner)
            }
            CommandGroup(after: .saveItem) {
                Menu("Import") {
                    Button("Contacts…") { open("/settings/contact-import") }
                    Button("Hisaab…") { open("/settings/hisaab-import") }
                    if House.business.art == "taheri" {
                        Button("Taheri Software Book…") { open("/settings/import-taheri") }
                    }
                }
                .disabled(!ready || !isOwner)
                Button("Backups…") { open("/settings/backups") }
                    .disabled(!ready || !isOwner)
            }
            CommandGroup(replacing: .printItem) {
                // The record in front prints: its record menu's own Print (an invoice, an order's slip, the picked
                // pieces' tags), else the page's PDF.
                if let print = recordPrint {
                    Button(print.title.hasSuffix("…") ? print.title : print.title + "…") { print.perform() }
                        .keyboardShortcut("p", modifiers: .command)
                        .disabled(!ready || !print.enabled)
                } else {
                    Button(MacPrint.title(for: current)) { if let r = current { MacPrint.print(r) } }
                        .keyboardShortcut("p", modifiers: .command)
                        .disabled(!MacPrint.canPrint(current))
                }
            }
        }
    }

    /// The record menu's own Print (an invoice, an order's slip, a piece's tag): what File › Print does when there is one.
    private var recordPrint: MacAction? {
        recordMenu?.groups.flatMap { $0 }.first { a in
            guard let s = a.shortcut else { return false }
            return s.key == "p" && s.modifiers == .command
        }
    }

    // MARK: Edit

    private var editMenu: some Commands {
        CommandGroup(after: .textEditing) {
            Divider()
            Button("Find") { MacFind.shared.ask() }
                .keyboardShortcut("f", modifiers: .command)
                .disabled(!ready)
            Button("Quick Open…") { shell?.quickOpen.toggle() }
                .keyboardShortcut("k", modifiers: .command)
                .disabled(shell == nil || !ready)
        }
    }

    // MARK: View

    private var viewMenu: some Commands {
        CommandGroup(after: .sidebar) {
            Button(inspectorShown ? "Hide Inspector" : "Show Inspector") { inspectorShown.toggle() }
                .keyboardShortcut("i", modifiers: [.command, .option])
            // The place's ways of showing its records, in its toolbar control's order (the HIG: every toolbar item in the
            // menu bar). No key: Control-key shortcuts are dropped (docs/design-audit.md). A place with one way disables them.
            let ways = viewWays
            ForEach(0..<3, id: \.self) { (i: Int) in
                let way = i < ways.choices.count ? ways.choices[i] : nil
                Button("as " + (way?.title ?? (i == 0 ? "List" : i == 1 ? "Cards" : "Board"))) {
                    if let way, let key = ways.key { UserDefaults.standard.set(way.raw, forKey: key) }
                }
                .disabled(way == nil || ways.key == nil)
            }
            Divider()
            Button("Refresh") {
                if let refresh { refresh.run() } else { ServerShelf.wake() }
            }
            .keyboardShortcut("r", modifiers: .command)
            .disabled(!ready)
            Divider()
            Button("Businesses…") { Businesses.shared.switcherOpen = true }
                .keyboardShortcut("b", modifiers: [.command, .shift])
            Divider()
        }
    }

    /// The place in front and the ways it shows its records (its stored key, and the choices in its toolbar's order).
    private var viewWays: (key: String?, choices: [MacLayoutChoice]) {
        switch ScreenRoute.bare(shell?.selection ?? "") {
        case "/orders": return ("mac.orders.view", [.list, .cards, .board])
        case "/invoices": return ("mac.invoices.view", [.list, .cards])
        case "/customers": return ("mac.customers.view", [.list, .cards])
        case "/repairs": return ("mac.repairs.view", [.list, .cards])
        case "/products": return ("mac.stock.view", [.list, MacLayoutChoice(raw: "gallery", title: "Gallery", symbol: "square.grid.2x2")])
        case "/workshop": return ("mac.workshop.view", [MacLayoutChoice(raw: "table", title: "Table", symbol: "tablecells"), .board])
        default: return (nil, [])
        }
    }

    // MARK: Go

    private var hasToday: Bool { places?.contains { $0.path == "/" } ?? true }

    /// "Set Today's Rates…" while the day's rate is not set (an owner can set it), else "Today's Rates…".
    private var ratesTitle: String {
        let s = Book.shared.settings.value
        let unset = s != nil && !RateKeys.setToday(s)
        return unset && isOwner ? "Set Today\u{2019}s Rates\u{2026}" : "Today\u{2019}s Rates\u{2026}"
    }

    private var goMenu: some Commands {
        CommandMenu("Go") {
            // Today, or the first place of a role without it (marketing).
            Button(hasToday ? "Today" : "Home") { shell?.go(hasToday ? "/" : places?.first?.path ?? "/") }
                .keyboardShortcut("h", modifiers: [.command, .shift])
                .disabled(shell == nil || !ready)
            Divider()
            ForEach(Array((places ?? []).prefix(9).enumerated()), id: \.element.path) { i, p in
                Button(p.title) { shell?.go(p.path) }
                    .keyboardShortcut(KeyEquivalent(Character(String(i + 1))), modifiers: .command)
                    .disabled(shell == nil || !ready)
            }
            Divider()
            Button("Back") { shell?.goBack() }
                .keyboardShortcut("[", modifiers: .command)
                .disabled(!ready || shell?.canGoBack != true)
            Button("Forward") { shell?.goForward() }
                .keyboardShortcut("]", modifiers: .command)
                .disabled(!ready || shell?.canGoForward != true)
            Divider()
            // The day's rates are in the sidebar's foot too; here they have a menu item and a key, whatever is in front.
            Button(ratesTitle) { shell?.rates = true }
                .keyboardShortcut("r", modifiers: [.command, .shift])
                .disabled(shell == nil || !ready || Sessions.shared.current.role == "marketing")
        }
    }

    // MARK: Window

    private var windowMenu: some Commands {
        CommandGroup(before: .windowList) {
            Button("Activity Log") { open("/activity-log") }
                .disabled(!ready || !isOwner)
            Button("Recently Removed") { open("/settings/recently-removed") }
                .disabled(!ready || !isOwner)
            Divider()
        }
    }

    /// The keys the File, Edit, View and Go menus own; a record menu's copy of one is drawn without it, so a key has
    /// one item (File › Print does the record's Print).
    private static func withoutReserved(_ groups: [[MacAction]]) -> [[MacAction]] {
        let reserved: [(KeyEquivalent, EventModifiers)] = [
            ("p", .command), ("n", .command), ("n", [.command, .shift]), ("n", [.command, .option]), ("o", .command),
            ("w", .command), ("k", .command), ("f", .command), ("r", .command), ("i", [.command, .option]), (",", .command),
            ("h", [.command, .shift]), ("[", .command), ("]", .command), ("t", [.command, .shift]), ("b", [.command, .shift]),
            ("r", [.command, .shift]), ("w", [.command, .shift]), ("a", [.command, .shift]), ("e", .command), ("p", [.command, .option]),
        ]
        return groups.map { group in
            group.map { a in
                guard let s = a.shortcut, reserved.contains(where: { $0.0 == s.key && $0.1 == s.modifiers }) else { return a }
                var copy = a
                copy.shortcut = nil
                return copy
            }
        }
    }
}

/// ERP › Sign Out…: asks, as a Mac app does, then signs out of the business in front.
enum MacSignOut {
    @MainActor static func ask() {
        let alert = NSAlert()
        alert.messageText = "Sign out of \(House.storeName)?"
        alert.informativeText = "You will need to sign in with Google again. This Mac's copy of the books is cleared."
        alert.addButton(withTitle: "Sign Out")
        alert.addButton(withTitle: "Cancel")
        alert.buttons.first?.hasDestructiveAction = true
        if alert.runModal() == .alertFirstButtonReturn {
            Sessions.shared.session(for: Businesses.shared.current).signOut()
        }
    }
}

/// Help › Keyboard Shortcuts: every key the app answers, in one window.
enum MacShortcutsWindow {
    @MainActor static func show() {
        let lines: [(String, String)] = [
            ("New Sale", "⌘N"), ("New Order", "⇧⌘N"), ("New Repair", "⌥⌘N"),
            ("Quick Open", "⌘K"), ("Find in the list", "⌘F"), ("Open in a window", "⌘O or Return"),
            ("The record's next step", "⌘↩"), ("Print", "⌘P"), ("Delete", "⌘⌫"),
            ("Show or hide the inspector", "⌥⌘I"), ("Show or hide the sidebar", "⌃⌘S"), ("Refresh", "⌘R"), ("Today\u{2019}s Rates", "⇧⌘R"),
            ("Today", "⇧⌘H"), ("The sidebar's places", "⌘1 – ⌘9"), ("Back", "⌘["), ("Forward", "⌘]"), ("Businesses", "⇧⌘B"),
            ("Settings", "⌘,"),
        ]
        let alert = NSAlert()
        alert.messageText = "Keyboard Shortcuts"
        alert.informativeText = lines.map { "\($0.1)\t\($0.0)" }.joined(separator: "\n")
        alert.addButton(withTitle: "Done")
        alert.runModal()
    }
}
#endif
