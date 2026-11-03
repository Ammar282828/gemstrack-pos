import Foundation

/// Where the person was when the business changed (owner, 2026-11-03: "switched business should open at the same page if
/// possible"). `Businesses.switch(to:)` rebuilds every screen on the new id, so the tab and each tab's chosen sub-page are
/// kept here, outside the views, and the new business's screens read them as they are made. Only the places both
/// businesses have are kept: a tab the other business lacks falls back to Home (RootView's selection), a sub-page that
/// is not in its tabs falls back to the tab's first. A record's page (an invoice, a customer) is not carried: its id
/// is the old business's, so the tab opens on its list. Plain statics (the views read them in their initialisers).
enum BusinessCarry {
    /// The tab open now, kept current by RootView.
    nonisolated(unsafe) private static var tab: String?
    /// Each root place's chosen sub-page (the title menu or section picker), by the place's own path.
    nonisolated(unsafe) private static var subs: [String: String] = [:]
    /// What the switch in flight carries; nil when the app opened cold.
    nonisolated(unsafe) private static var carried: (tab: String?, subs: [String: String])?

    static func noteTab(_ id: String) { tab = id }

    static func noteSub(root: String, chosen: String?) {
        subs[ScreenRoute.bare(root)] = chosen
    }

    /// A business switch begins: what is open now is what the next business opens on.
    static func arm() {
        carried = (tab, subs)
        // The next business's pages note their own as they appear.
        subs = [:]
    }

    /// The new business's first screen has been drawn from it.
    static func settled() { carried = nil }

    static func carriedTab() -> String? { carried?.tab }

    /// The sub-page chosen under `root` in the business left, if this business has it among that place's tabs.
    static func carriedSub(for root: String) -> String? {
        guard let chosen = carried?.subs[ScreenRoute.bare(root)],
              let entry = NavMap.current.entry(for: root),
              (entry.tabs ?? []).contains(where: { ScreenRoute.bare($0.href) == ScreenRoute.bare(chosen) }) else { return nil }
        return chosen
    }
}
