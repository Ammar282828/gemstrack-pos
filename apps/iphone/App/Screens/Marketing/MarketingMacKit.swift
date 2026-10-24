#if os(macOS)
import SwiftUI
import AppKit

// What the Marketing screens share on the Mac (docs/features/mac-app.md, Mac/MAC-CONVENTIONS.md): the right-click
// line that opens a place in a window of its own, a two-pane window (the list or photos on one side, the record or
// the words on the other), and a copy-to-clipboard line. No logic lives here; every screen keeps its own.

/// "Open in New Window" for a row that opens a Route.
struct MacOpenInWindow: View {
    let path: String
    @Environment(\.openPlaceWindow) private var openPlace

    var body: some View {
        if let openPlace {
            Button("Open in New Window", systemImage: "macwindow.badge.plus") { openPlace(Route(path: path)) }
        }
    }
}

/// A fixed-width pane beside a flexible one, divided by a hairline: the Mac's form of a phone's two stacked sections.
struct MacTwoPane<Side: View, Main: View>: View {
    var sideWidth: CGFloat = 380
    var sideOnRight = false
    @ViewBuilder let side: () -> Side
    @ViewBuilder let main: () -> Main

    var body: some View {
        HStack(spacing: 0) {
            if sideOnRight {
                main().frame(maxWidth: .infinity, maxHeight: .infinity)
                Divider()
                side().frame(width: sideWidth).frame(maxHeight: .infinity)
            } else {
                side().frame(width: sideWidth).frame(maxHeight: .infinity)
                Divider()
                main().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
}

enum MacClipboard {
    static func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}

extension View {
    /// A page's reading width on a wide window: centred, no wider than `width`.
    func macReadingWidth(_ width: CGFloat = 760) -> some View {
        frame(maxWidth: width).frame(maxWidth: .infinity)
    }
}
#endif
