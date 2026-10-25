#if os(macOS)
import SwiftUI

// The Mac's Home and Today's cash share one small kit: a row that opens a place is also right-clickable ("Open",
// "Open in New Window"), as Finder and Mail rows are, and Return or a double-click opens it in a window of its own.
// Nothing here reads or writes the books.

/// Right-click on anything that opens a Route: Open, and Open in New Window (MacShell's `openPlaceWindow`).
struct MacOpenMenu: ViewModifier {
    let path: String?
    @Environment(\.openPlaceWindow) private var openPlace

    func body(content: Content) -> some View {
        content.contextMenu {
            if let path {
                NavigationLink(value: Route(path: path)) { Text("Open") }
                if let openPlace {
                    Button("Open in New Window") { openPlace(Route(path: path)) }
                }
            }
        }
    }
}

/// A table's or list's rows that each open a place: the right-click menu (Open, Open in New Window) and, for the picked
/// rows, Return or a double-click opening them in windows of their own (five at most).
struct MacOpenSelection: ViewModifier {
    /// The place a row (by its id) opens; nil is a row that opens nothing.
    let path: (String) -> String?
    @Environment(\.openPlaceWindow) private var openPlace

    func body(content: Content) -> some View {
        content.contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
            if let place = ids.sorted().compactMap({ path($0) }).first {
                NavigationLink(value: Route(path: place)) { Text("Open") }
                if let openPlace {
                    Button("Open in New Window") { openPlace(Route(path: place)) }
                }
            }
        } primaryAction: { (ids: Set<String>) in
            for place in ids.sorted().compactMap({ path($0) }).prefix(5) {
                openPlace?(Route(path: place))
            }
        }
    }
}

extension View {
    /// A row's right-click menu for the place it opens (nil: a row that opens a sheet, which has no menu).
    func macOpenMenu(_ path: String?) -> some View { modifier(MacOpenMenu(path: path)) }

    /// Rows that open places: the menu and Return or a double-click (see `MacOpenSelection`).
    func macOpenSelection(_ path: @escaping (String) -> String?) -> some View { modifier(MacOpenSelection(path: path)) }
}
#endif
