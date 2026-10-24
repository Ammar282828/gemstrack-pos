import SwiftUI
#if os(macOS)
import AppKit
#endif

// What differs between an iPad's pointer and a Mac's, and the few list and search details only one has. Each is one
// modifier that does the iPhone's exact old thing on iOS, so no screen forks for the Mac.
extension View {
    /// The highlight under an iPad's pointer over a card that opens something, shaped as the card. A Mac's rows and cards
    /// are clicked, not hovered: the shape still decides where a click lands.
    @ViewBuilder
    func pointerHover<S: Shape>(_ shape: S, highlight: Bool = false) -> some View {
        #if os(iOS)
        if highlight {
            contentShape(.hoverEffect, shape).hoverEffect(.highlight)
        } else {
            contentShape(.hoverEffect, shape).hoverEffect()
        }
        #else
        contentShape(shape).modifier(MacHoverHighlight(shape: AnyShape(shape)))
        #endif
    }

    @ViewBuilder
    func pointerHover(highlight: Bool = false) -> some View {
        #if os(iOS)
        if highlight { hoverEffect(.highlight) } else { hoverEffect() }
        #else
        modifier(MacHoverHighlight(shape: AnyShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))))
        #endif
    }

    /// The room between a list's sections (an iPhone's; a Mac's inset list keeps its own).
    @ViewBuilder
    func sectionSpacing24() -> some View {
        #if os(iOS)
        listSectionSpacing(24)
        #else
        self
        #endif
    }
}

extension SearchFieldPlacement {
    /// A search field that never hides: under the title on an iPhone, in the window's toolbar on a Mac.
    static var alwaysShownSearch: SearchFieldPlacement {
        #if os(iOS)
        .navigationBarDrawer(displayMode: .always)
        #else
        .toolbar
        #endif
    }
}

#if os(macOS)
/// A card that opens something, under a Mac's pointer: a faint wash of the accent and the pointing hand, as Finder and
/// Mail mark what a click will open.
struct MacHoverHighlight: ViewModifier {
    let shape: AnyShape
    @State private var hovering = false

    func body(content: Content) -> some View {
        content
            .overlay { shape.fill(Theme.accent.opacity(hovering ? 0.07 : 0)).allowsHitTesting(false) }
            .onHover { inside in
                hovering = inside
                if inside { NSCursor.pointingHand.push() } else { NSCursor.pop() }
            }
            .animation(.easeOut(duration: 0.12), value: hovering)
    }
}
#endif
