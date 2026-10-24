#if os(macOS)
import SwiftUI
import ERPCore

/// The five hubs a Mac shows as tables (Orders, Invoices, Customers, Stock, Repairs), by their sidebar path.
enum MacHubKind: String, CaseIterable {
    case orders = "/orders", invoices = "/invoices", customers = "/customers", stock = "/products", repairs = "/repairs"

    init?(path: String) { self.init(rawValue: ScreenRoute.bare(path)) }
}

/// A hub on the Mac: the list beside the picked item (HubSplit, the iPad's columns).
struct MacHub: View {
    let kind: MacHubKind
    let rootPath: String

    var body: some View {
        if let prompt = HubSplitKind.prompt(for: rootPath) {
            HubSplit(prompt: prompt) {
                PlaceScreen(path: rootPath, isRoot: true)
            }
        } else {
            PlaceScreen(path: rootPath, isRoot: true)
        }
    }
}
#endif
