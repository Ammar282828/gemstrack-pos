import SwiftUI

/// An Analytics tab's page. On a phone (and an iPad at compact width) one List: the period chips, then the
/// left sections, then the right ones, in that order. On an iPad's wide window the chips and an optional
/// head (the figure tiles, four across) sit over two Lists side by side, so the charts and the tables
/// stand next to each other instead of one long scroll. The closures are told whether the page is wide.
struct AnaSplit<Head: View, Left: View, Right: View>: View {
    let bar: AnaPeriodBar
    @ViewBuilder let head: (Bool) -> Head
    @ViewBuilder let left: (Bool) -> Left
    @ViewBuilder let right: (Bool) -> Right

    @Environment(\.layoutWidthClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var width: CGFloat = 0

    private var wide: Bool { sizeClass.isPadLayout && width >= 820 && !typeSize.isAccessibilitySize }

    var body: some View {
        #if os(macOS)
        macBody
        #else
        phoneBody
        #endif
    }

    @ViewBuilder
    private var phoneBody: some View {
        Group {
            if wide {
                VStack(spacing: 0) {
                    bar.padding(.top, pt(8))
                    head(true)
                        .padding(.horizontal, pt(20))
                        .padding(.vertical, pt(8))
                    HStack(alignment: .top, spacing: 0) {
                        List { left(true) }.listStyle(.insetGrouped)
                        List { right(true) }.listStyle(.insetGrouped)
                    }
                }
            } else {
                List {
                    Section {
                        bar
                            .listRowInsets(EdgeInsets())
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }
                    left(false)
                    right(false)
                }
                .listStyle(.insetGrouped)
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }
}

#if os(macOS)
extension AnaSplit {
    /// The Mac's report: the head (the figure tiles, when the tab has them) across the top, then the tab's two columns
    /// side by side, each its own scrolling list. The period is not chips here but the toolbar's menu (AnaPages).
    @ViewBuilder
    fileprivate var macBody: some View {
        VStack(spacing: 0) {
            head(true)
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
            HStack(alignment: .top, spacing: 0) {
                List { left(true) }.listStyle(.inset)
                Divider()
                List { right(true) }.listStyle(.inset)
            }
        }
    }
}
#endif
