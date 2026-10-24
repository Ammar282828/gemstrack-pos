import SwiftUI

/// A place in the ERP, by its path ("/orders/ORD-000123"): what NavigationStack pushes.
struct Route: Hashable, Identifiable, Codable {
    let path: String
    var id: String { path }
}

/// A native screen for some ERP paths.
struct ScreenRoute {
    let matches: (String) -> Bool
    let make: (String) -> AnyView

    /// Exactly this path (a query is ignored).
    static func exact<V: View>(_ path: String, _ make: @escaping () -> V) -> ScreenRoute {
        ScreenRoute(matches: { bare($0) == path }, make: { _ in AnyView(make()) })
    }

    /// "<prefix><id>": the rest of the path, decoded ("/orders/" → "ORD-000123").
    static func item<V: View>(_ prefix: String, _ make: @escaping (String) -> V) -> ScreenRoute {
        ScreenRoute(matches: { p in let b = bare(p); return b.hasPrefix(prefix) && !b.dropFirst(prefix.count).contains("/") && b.count > prefix.count },
                    make: { p in AnyView(make(String(bare(p).dropFirst(prefix.count)).removingPercentEncoding ?? "")) })
    }

    static func bare(_ p: String) -> String { p.split(separator: "?").first.map(String.init) ?? p }
}

/// Which ERP paths have a native screen. Every other path opens WebScreen: the ERP page itself,
/// inside the app and signed in, so no place the ERP has is ever missing (CONVENTIONS.md rule 5).
/// Each group of screens lists its own routes in its folder (Screens/<Group>/Routes.swift).
enum ScreenRegistry {
    static var routes: [ScreenRoute] { NativeScreens.all }

    static func hasNative(_ path: String) -> Bool { !wantsWeb(path) && routes.contains { $0.matches(path) } }

    /// `?web=1` asks for the ERP's own page even where a native screen exists: a native screen's
    /// "Open in the ERP" (edit, refund, delete, print: what is not native yet).
    static func wantsWeb(_ path: String) -> Bool {
        URLComponents(string: path)?.queryItems?.contains { $0.name == "web" && $0.value == "1" } ?? false
    }

    /// The path without `web=1`, for the page itself.
    static func withoutWebFlag(_ path: String) -> String {
        guard var c = URLComponents(string: path) else { return path }
        c.queryItems = c.queryItems?.filter { $0.name != "web" }
        if c.queryItems?.isEmpty == true { c.queryItems = nil }
        return c.string ?? path
    }

    /// How wide a native page reads on an iPad's wide window: nil fills the window (pages that lay out their
    /// own columns, grids or a form beside its summary), else the column its rows and fields sit in. A phone
    /// never reaches the limit, so it changes nothing there.
    static func readableWidth(for path: String) -> CGFloat? {
        let bare = ScreenRoute.bare(path)
        let fills: Set<String> = ["/", "/orders", "/invoices", "/workshop", "/karigars", "/products", "/calendar",
                                  "/my-work", "/given", "/orders/add", "/invoices/new", "/products/add", "/design",
                                  "/products/bulk-add", "/settings/printer", "/app/widgets", "/today"]
        if fills.contains(bare) { return nil }
        for prefix in ["/ads", "/website", "/posts", "/marketing", "/insights"] where bare == prefix || bare.hasPrefix(prefix + "/") { return nil }
        // The forms beside their summary (TransactionWorkspace): editing an order, a sale or a piece, and Finalize.
        if bare.hasSuffix("/edit") && (bare.hasPrefix("/orders/") || bare.hasPrefix("/invoices/") || bare.hasPrefix("/products/")) { return nil }
        if bare.hasSuffix("/finalize") { return nil }
        #if os(macOS)
        // A Mac window lays Analytics out as a wide report of its own (AnalyticsMacKit): it takes the whole window.
        if bare.hasPrefix("/analytics") { return nil }
        #else
        if bare.hasPrefix("/analytics") { return 980 }
        #endif
        // One order, invoice, customer, karigar, piece or repair: the page lays its own two columns out from its
        // width (summary beside the lines at 820 pt and up), so it takes the whole column it is in. That is the
        // detail side of a hub's split, or the full window from Home or Search.
        for prefix in ["/orders/", "/invoices/", "/customers/", "/karigars/", "/products/", "/repairs/", "/hisaab/"] where isItem(bare, prefix) { return nil }
        if bare == "/repairs" { return nil }
        // The rest of those families (a list's sub-pages): their figures sit side by side, so a little wider than a form.
        if bare.hasPrefix("/orders/") || bare.hasPrefix("/invoices/") || bare.hasPrefix("/customers/") || bare.hasPrefix("/repairs") { return 820 }
        return 720
    }

    /// "<prefix><id>": one item's own page, not a page beneath it (`/orders/ORD-1`, not `/orders/ORD-1/edit` or `/orders/add`).
    private static func isItem(_ bare: String, _ prefix: String) -> Bool {
        guard bare.hasPrefix(prefix) else { return false }
        let rest = bare.dropFirst(prefix.count)
        return !rest.isEmpty && !rest.contains("/") && !["add", "new", "bulk-add"].contains(String(rest))
    }

    @MainActor
    static func view(for path: String) -> AnyView {
        if wantsWeb(path) { return AnyView(WebScreen(path: withoutWebFlag(path))) }
        if let r = routes.first(where: { $0.matches(path) }) { return r.make(path) }
        return AnyView(WebScreen(path: path))
    }
}
