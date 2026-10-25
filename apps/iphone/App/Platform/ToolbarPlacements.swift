import SwiftUI

extension ToolbarItemPlacement {
    /// A screen's own actions at the bar's trailing end, on both platforms. The iPhone's is `.primaryAction`; on a Mac
    /// `.primaryAction` is the toolbar's leading edge (Apple's ToolbarItemPlacement docs), where it pushed the window's
    /// title over the sidebar, so the Mac's is `.automatic`, which a Mac toolbar lays out at the trailing end.
    static var trailingAction: ToolbarItemPlacement {
        #if os(macOS)
        return .automatic
        #else
        return .primaryAction
        #endif
    }
}
