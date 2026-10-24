import SwiftUI

/// A detail page's lists on an iPad's wide window: the summary, hero and actions in a left column, the lines,
/// payments and history in a right one (each its own List, so each scrolls and swipes as it does on a phone).
/// Narrower than 820 pt, or at an accessibility text size, it is the phone's single List: left then right.
/// The window's width decides (onGeometryChange), so Split View and a resized window follow.
struct WideDetailList<Left: View, Right: View>: View {
    var leftWidth: CGFloat = 380
    /// The width from which the two columns stand (a page sheet is narrower than the window, so it asks for less).
    var wideFrom: CGFloat = 820
    @ViewBuilder let left: () -> Left
    @ViewBuilder let right: () -> Right

    @Environment(\.layoutWidthClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var width: CGFloat = 0

    private var wide: Bool { sizeClass.isPadLayout && width >= wideFrom && !typeSize.isAccessibilitySize }

    var body: some View {
        Group {
            if wide {
                HStack(spacing: 0) {
                    List { left() }
                        .listStyle(.insetGrouped)
                        .modifier(HouseGround())
                        .frame(width: leftWidth)
                    Divider()
                    List { right() }
                        .listStyle(.insetGrouped)
                        .modifier(HouseGround())
                        .frame(maxWidth: .infinity)
                }
            } else {
                List {
                    left()
                    right()
                }
                .listStyle(.insetGrouped)
                .modifier(HouseGround())
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }
}
