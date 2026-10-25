#if os(macOS)
import SwiftUI

/// The Mac's menu bar. File: New Sale ⌘N, New Order ⇧⌘N, New Repair ⌥⌘N, Open in New Window ⌘O, Print ⌘P (a piece's tag
/// through Label LIVE, an invoice or an order's slip as its PDF). Go: the sidebar's first nine places ⌘1–⌘9, Back ⌘[,
/// Quick Open ⌘K, Search ⌘F. Each acts on the frontmost window, which publishes what it shows (MacShell, MacPlaceWindow).
struct MacCommands: Commands {
    @FocusedValue(\.macShell) private var shell
    @FocusedValue(\.macMap) private var map
    @FocusedValue(\.macPlace) private var place
    @FocusedValue(\.macStockSelection) private var stockSelection
    @Environment(\.openWindow) private var openWindow

    /// The page in front: a separate window's, else the main window's deepest.
    private var current: Route? { place ?? shell?.current }

    /// The sidebar's places in order, Home first, for ⌘1–⌘9.
    private var places: [NavEntry] { map?.entries ?? [] }

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Window") { openWindow(id: MacWindows.main) }
                .keyboardShortcut("n", modifiers: [.command, .option, .shift])
            Divider()
            Button("New Sale") { if let sale = map?.newSale { shell?.creating = Route(path: sale.href) } }
                .keyboardShortcut("n", modifiers: .command)
                .disabled(shell == nil || map?.newSale == nil)
            Button("New Order") { shell?.creating = Route(path: "/orders/add") }
                .keyboardShortcut("n", modifiers: [.command, .shift])
                .disabled(shell == nil || map?.actions.isEmpty != false)
            Button("New Repair") { shell?.creating = Route(path: "/repairs?new=1") }
                .keyboardShortcut("n", modifiers: [.command, .option])
                .disabled(shell == nil || map?.actions.isEmpty != false)
            Button("Scan a Tag…") { shell?.creating = Route(path: "/scan") }
                .keyboardShortcut("t", modifiers: [.command, .shift])
                .disabled(shell == nil || map?.actions.isEmpty != false)
            Divider()
            Button("Open in New Window") { if let r = current { openWindow(id: MacWindows.place, value: r) } }
                .keyboardShortcut("o", modifiers: .command)
                .disabled(current == nil)
        }
        CommandGroup(replacing: .printItem) {
            // Stock's table with pieces ticked prints their tags as one Label LIVE job; otherwise the page in front.
            if let skus = stockSelection?.skus, !skus.isEmpty, place == nil {
                Button(skus.count == 1 ? "Print Tag…" : "Print \(skus.count) Tags…") { Task { await MacPrint.printTags(skus) } }
                    .keyboardShortcut("p", modifiers: .command)
                Button(skus.count == 1 ? "Print Tag Now" : "Print \(skus.count) Tags Now") { Task { await MacPrint.printTags(skus, now: true) } }
                    .keyboardShortcut("p", modifiers: [.command, .option])
            } else {
                Button(MacPrint.title(for: current)) { if let r = current { MacPrint.print(r) } }
                    .keyboardShortcut("p", modifiers: .command)
                    .disabled(!MacPrint.canPrint(current))
            }
        }
        CommandMenu("Go") {
            Button("Home") { shell?.go("/") }
                .keyboardShortcut("h", modifiers: [.command, .shift])
                .disabled(shell == nil)
            ForEach(Array(places.prefix(9).enumerated()), id: \.element.id) { i, e in
                Button(e.id == "home" ? "Home" : e.label) { shell?.go(e.href) }
                    .keyboardShortcut(KeyEquivalent(Character(String(i + 1))), modifiers: .command)
                    .disabled(shell == nil)
            }
            Divider()
            Button("Back") { if shell?.stack.isEmpty == false { shell?.stack.removeLast() } }
                .keyboardShortcut("[", modifiers: .command)
                .disabled(shell?.stack.isEmpty != false)
            Button("Quick Open…") { shell?.quickOpen.toggle() }
                .keyboardShortcut("k", modifiers: .command)
                .disabled(shell == nil)
            Button("Search") {
                ShellCommands.shared.searchWanted = true
                shell?.go(MacShell.searchID)
            }
            .keyboardShortcut("f", modifiers: .command)
            .disabled(shell == nil)
            if let settings = map?.settings {
                Divider()
                Button(settings.label) { shell?.go(settings.href) }.disabled(shell == nil)
            }
        }
        CommandGroup(after: .sidebar) {
            Button("Businesses…") { Businesses.shared.switcherOpen = true }
                .keyboardShortcut("b", modifiers: [.command, .shift])
        }
        // Continuity Camera: "Import from iPhone" (Take Photo, Scan Documents) on the File menu, into whatever field has
        // focus and takes pictures (a piece's photo, a bill to read).
        ImportFromDevicesCommands()
    }
}
#endif
