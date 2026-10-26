#if os(macOS)
import SwiftUI
import AppKit

/// The Mac's menu bar (docs/features/mac-design.md, "The menu bar"). Each item acts on the frontmost window, which
/// publishes what it shows (MacShell, MacPlaceWindow) and, for the record picked in it, its actions (`MacRecordMenu`):
/// the record's menu is drawn from them, so every action a record has is in the menu bar with its key.
struct MacCommands: Commands {
    @FocusedValue(\.macShell) private var shell
    @FocusedValue(\.macMap) private var map
    @FocusedValue(\.macPlace) private var place
    @FocusedValue(\.macPlaces) private var places
    @FocusedValue(\.macRecordMenu) private var recordMenu
    @FocusedValue(\.macRefresh) private var refresh
    @Environment(\.openWindow) private var openWindow

    /// The page in front: a separate window's, else the main window's deepest.
    private var current: Route? { place ?? shell?.current }
    private var signedIn: Bool { map != nil }
    private var isOwner: Bool { map?.settings != nil }
    private var sells: Bool { map?.actions.isEmpty == false }

    private func open(_ path: String) { openWindow(id: MacWindows.place, value: Route(path: path)) }

    var body: some Commands {
        appMenu
        fileMenu
        editMenu
        viewMenu
        goMenu
        CommandMenu(recordMenu?.title ?? "Item") {
            if let recordMenu {
                MacActionItems(groups: Self.withoutReserved(recordMenu.groups))
            } else {
                Button("Nothing Selected") {}.disabled(true)
            }
        }
        windowMenu
        CommandGroup(replacing: .help) {
            Button("Keyboard Shortcuts") { MacShortcutsWindow.show() }
                .keyboardShortcut("/", modifiers: .command)
            Button("The ERP on the Web") {
                NSWorkspace.shared.open(House.business.url)
            }
            Divider()
            Button("Send Page Snapshots\u{2026}") { shell?.snapshots = true }
                .disabled(shell == nil || !isOwner || MacSnapshots.running)
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
                .keyboardShortcut("l", modifiers: [.command, .control])
                .disabled(!signedIn || !AppLock.shared.enabled)
            Button("Sign Out…") { MacSignOut.ask() }
                .disabled(!signedIn)
        }
    }

    // MARK: File

    private var fileMenu: some Commands {
        Group {
            CommandGroup(replacing: .newItem) {
                // The counter's three jobs keep their keys whatever is in front (a new sale is a sale, not the chooser).
                Button("New Sale") { shell?.creating = Route(path: "/invoices/new") }
                    .keyboardShortcut("n", modifiers: .command)
                    .disabled(shell == nil || map?.newSale == nil)
                Button("New Order") { shell?.creating = Route(path: "/orders/add") }
                    .keyboardShortcut("n", modifiers: [.command, .shift])
                    .disabled(shell == nil || !sells)
                Button("New Repair") { shell?.creating = Route(path: "/repairs?new=1") }
                    .keyboardShortcut("n", modifiers: [.command, .option])
                    .disabled(shell == nil || !sells)
                Menu("New") {
                    Button("Customer") { open("/customers/add") }.disabled(!sells)
                    Button("Piece") { open("/products/add") }.disabled(!isOwner)
                    Button("Pieces in Bulk") { open("/products/bulk-add") }.disabled(!isOwner)
                    Button("Karigar") { open("/karigars/add") }.disabled(!isOwner)
                }
                .disabled(!signedIn)
                Button("New Window") { openWindow(id: MacWindows.main) }
                    .keyboardShortcut("n", modifiers: [.command, .option, .shift])
                Divider()
                Button("Open in New Window") { if let r = current { openWindow(id: MacWindows.place, value: r) } }
                    .keyboardShortcut("o", modifiers: .command)
                    .disabled(current == nil)
                Button("Scan a Tag…") { shell?.creating = Route(path: "/scan") }
                    .keyboardShortcut("t", modifiers: [.command, .shift])
                    .disabled(shell == nil || !sells)
                Button("Voice Assistant…") { shell?.voice = true }
                    .disabled(shell == nil || !isOwner)
            }
            CommandGroup(after: .saveItem) {
                Menu("Import") {
                    Button("Contacts…") { open("/settings/contact-import") }
                    Button("Hisaab…") { open("/settings/hisaab-import") }
                    if House.business.art == "taheri" {
                        Button("Taheri Software Book…") { open("/settings/import-taheri") }
                    }
                }
                .disabled(!isOwner)
                Button("Backups…") { open("/settings/backups") }
                    .disabled(!isOwner)
            }
            CommandGroup(replacing: .printItem) {
                // The record in front prints: its record menu's own Print (an invoice, an order's slip, the picked
                // pieces' tags), else the page's PDF.
                if let print = recordPrint {
                    Button(print.title.hasSuffix("…") ? print.title : print.title + "…") { print.perform() }
                        .keyboardShortcut("p", modifiers: .command)
                        .disabled(!print.enabled)
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
                .disabled(!signedIn)
            Button("Quick Open…") { shell?.quickOpen.toggle() }
                .keyboardShortcut("k", modifiers: .command)
                .disabled(shell == nil)
        }
    }

    // MARK: View

    private var viewMenu: some Commands {
        CommandGroup(after: .sidebar) {
            Button("Show or Hide Inspector") {
                let d = UserDefaults.standard
                d.set(!(d.object(forKey: MacInspector.key) as? Bool ?? true), forKey: MacInspector.key)
            }
            .keyboardShortcut("i", modifiers: [.command, .option])
            Button(viewKey?.first == "list" ? "as List" : "as Table") { setView(table: true) }
                .keyboardShortcut("1", modifiers: [.command, .control])
                .disabled(viewKey == nil)
            Button(viewKey?.other == "gallery" ? "as Gallery" : "as Board") { setView(table: false) }
                .keyboardShortcut("2", modifiers: [.command, .control])
                .disabled(viewKey == nil)
            Divider()
            Button("Refresh") {
                if let refresh { refresh.run() } else { ServerShelf.wake() }
            }
            .keyboardShortcut("r", modifiers: .command)
            .disabled(!signedIn)
            Divider()
            Button("Businesses…") { Businesses.shared.switcherOpen = true }
                .keyboardShortcut("b", modifiers: [.command, .shift])
            Divider()
        }
    }

    /// The place in front that shows its records two ways (its key, and the word for the other way).
    private var viewKey: (key: String, other: String, first: String)? {
        switch ScreenRoute.bare(shell?.selection ?? "") {
        // The first view is stored as "table" whatever it is drawn as (Orders' is a list since 2026-10-27).
        case "/orders": return ("mac.orders.view", "board", "list")
        case "/products": return ("mac.stock.view", "gallery", "table")
        case "/workshop": return ("mac.workshop.view", "board", "table")
        default: return nil
        }
    }

    private func setView(table: Bool) {
        guard let v = viewKey else { return }
        UserDefaults.standard.set(table ? "table" : v.other, forKey: v.key)
    }

    // MARK: Go

    private var goMenu: some Commands {
        CommandMenu("Go") {
            Button("Today") { shell?.go("/") }
                .keyboardShortcut("h", modifiers: [.command, .shift])
                .disabled(shell == nil)
            Divider()
            ForEach(Array((places ?? []).prefix(9).enumerated()), id: \.element.path) { i, p in
                Button(p.title) { shell?.go(p.path) }
                    .keyboardShortcut(KeyEquivalent(Character(String(i + 1))), modifiers: .command)
                    .disabled(shell == nil)
            }
            Divider()
            Button("Back") { shell?.goBack() }
                .keyboardShortcut("[", modifiers: .command)
                .disabled(shell?.canGoBack != true)
            Button("Forward") { shell?.goForward() }
                .keyboardShortcut("]", modifiers: .command)
                .disabled(shell?.canGoForward != true)
        }
    }

    // MARK: Window

    private var windowMenu: some Commands {
        CommandGroup(before: .windowList) {
            Button("Activity Log") { open("/activity-log") }
                .disabled(!isOwner)
            Button("Recently Removed") { open("/settings/recently-removed") }
                .disabled(!isOwner)
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
            ("New Sale", "⌘N"), ("New Order", "⇧⌘N"), ("New Repair", "⌥⌘N"), ("The place's own New", "⌃⌘N"),
            ("Quick Open", "⌘K"), ("Find in the list", "⌘F"), ("Open in a window", "⌘O or Return"),
            ("The record's next step", "⌘↩"), ("Edit", "⌘E"), ("Print", "⌘P"), ("Delete", "⌘⌫"),
            ("Show or hide the inspector", "⌥⌘I"), ("Show or hide the sidebar", "⌃⌘S"), ("Refresh", "⌘R"),
            ("Today", "⇧⌘H"), ("The sidebar's places", "⌘1 – ⌘9"), ("Back", "⌘["), ("Forward", "⌘]"), ("Businesses", "⇧⌘B"),
            ("Lock now", "⌃⌘L"), ("Settings", "⌘,"),
        ]
        let alert = NSAlert()
        alert.messageText = "Keyboard Shortcuts"
        alert.informativeText = lines.map { "\($0.1)\t\($0.0)" }.joined(separator: "\n")
        alert.addButton(withTitle: "Done")
        alert.runModal()
    }
}
#endif
