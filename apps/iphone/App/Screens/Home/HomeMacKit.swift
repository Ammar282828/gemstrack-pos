#if os(macOS)
import SwiftUI

// The Mac's Home and Today's cash share one small kit: a row that opens a place is also right-clickable ("Open",
// "Open in New Window"), as Finder and Mail rows are. Nothing here reads or writes the books.

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

extension View {
    /// A row's right-click menu for the place it opens (nil: a row that opens a sheet, which has no menu).
    func macOpenMenu(_ path: String?) -> some View { modifier(MacOpenMenu(path: path)) }
}

/// A panel's "Show more / Show less", quiet and a link, not a phone's tall tap target.
struct MacRevealButton: View {
    @Binding var expanded: Bool
    let count: Int

    var body: some View {
        Button(expanded ? "Show less" : "Show \(count) more") { expanded.toggle() }
            .buttonStyle(.link)
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 4)
    }
}
#endif
