import SwiftUI

/// A place in the ERP, by its path ("/orders/ORD-000123"): what NavigationStack pushes.
struct Route: Hashable, Identifiable {
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

    @MainActor
    static func view(for path: String) -> AnyView {
        if wantsWeb(path) { return AnyView(WebScreen(path: withoutWebFlag(path))) }
        if let r = routes.first(where: { $0.matches(path) }) { return r.make(path) }
        return AnyView(WebScreen(path: path))
    }
}
