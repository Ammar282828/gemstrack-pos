import Foundation

/// The ERP's map (src/lib/nav.ts, exported per house to Resources/nav-<house>.json): every place
/// the ERP has, in its groups and tabs, with who may open it. The app's menus are drawn from this,
/// so nothing the ERP has is missing from the app.
struct NavPlace: Decodable, Hashable, Identifiable {
    let href: String
    let label: String
    let heading: String?
    let icon: String?
    let staff: Bool?
    let keywords: [String]?
    let match: [String]?
    var id: String { href }
    var title: String { heading ?? label }
}

struct NavEntry: Decodable, Hashable, Identifiable {
    let id: String
    let group: String
    let href: String
    let label: String
    let heading: String?
    let icon: String?
    let staff: Bool?
    let keywords: [String]?
    /// Other paths that belong to this row (nav.ts `match`): /cart is Invoices', for old links.
    let match: [String]?
    let tabs: [NavPlace]?
    let pages: [NavPlace]?
    let count: String?

    var place: NavPlace { NavPlace(href: href, label: label, heading: heading, icon: icon, staff: staff, keywords: keywords, match: match) }
}

struct NavMap: Decodable {
    struct Group: Decodable, Hashable { let key: String; let label: String }
    let groups: [Group]
    /// Nil for anyone but an owner: the server saves sales for owners alone, so staff would only meet a lock.
    let newSale: NavEntry?
    let entries: [NavEntry]
    /// Nil for anyone but an owner: nav.ts SETTINGS has no `staff`, so the web keeps it to them.
    let settings: NavEntry?
    let actions: [NavPlace]

    static let current: NavMap = {
        guard let url = Bundle.main.url(forResource: "nav-\(House.id)", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let map = try? JSONDecoder().decode(NavMap.self, from: data) else {
            fatalError("Resources/nav-\(House.id).json is missing: run `npm run nav:export`.")
        }
        return map
    }()

    /// The map as a person sees it (src/lib/nav.ts forRole): owners everything; staff only the places
    /// marked for them; a marketing account the Marketing group whole and nothing else.
    func visible(to role: String) -> NavMap {
        if role == "owner" { return self }
        if role == "marketing" {
            // Every entry of the group with all its tabs and pages, `staff` or not (Ads has none); no
            // Settings, no New sale and nothing to create.
            return NavMap(groups: groups, newSale: nil, entries: self.entries.filter { $0.group == "marketing" }, settings: nil, actions: [])
        }
        func keep(_ p: NavPlace) -> Bool { p.staff == true }
        let mine = entries.compactMap { e -> NavEntry? in
            guard e.staff == true else { return nil }
            let tabs = e.tabs?.filter(keep)
            // An entry whose tabs are all the owners' is not theirs; otherwise it opens the first tab they may see.
            if tabs?.isEmpty == true { return nil }
            return NavEntry(id: e.id, group: e.group, href: tabs?.first?.href ?? e.href, label: e.label, heading: e.heading, icon: e.icon, staff: e.staff,
                            keywords: e.keywords, match: e.match, tabs: tabs, pages: e.pages?.filter(keep), count: e.count)
        }
        // New sale is out of Create too: it is the same sale the server will not save for staff.
        return NavMap(groups: groups, newSale: nil, entries: mine, settings: nil,
                      actions: actions.filter { keep($0) && $0.href != newSale?.href })
    }

    /// The entry a path belongs to (its own href, a tab's, a page's, a `match`, or beneath one): the one
    /// that claims it longest, as nav.ts `locate` does, so /settings/printer is Stock's Labels, not Settings.
    func entry(for path: String) -> NavEntry? {
        let p = path.split(separator: "?").first.map(String.init) ?? path
        func weight(_ href: String) -> Int {
            let h = href.split(separator: "?").first.map(String.init) ?? href
            return (p == h || (h != "/" && p.hasPrefix(h + "/"))) ? h.count : -1
        }
        func claim(_ place: NavPlace) -> Int { ([place.href] + (place.match ?? [])).map(weight).max() ?? -1 }
        var best: (entry: NavEntry, score: Int)?
        for e in entries + [settings].compactMap({ $0 }) {
            let score = max(claim(e.place), (e.tabs ?? []).map(claim).max() ?? -1, (e.pages ?? []).map(claim).max() ?? -1)
            if score >= 0, score > (best?.score ?? -1) { best = (e, score) }
        }
        return best?.entry
    }

    /// Everything this person may open, flat: for search.
    var allPlaces: [NavHit] {
        var out: [NavHit] = actions.map { NavHit(place: $0, entry: nil) }
        for e in [newSale].compactMap({ $0 }) + entries + [settings].compactMap({ $0 }) {
            out.append(NavHit(place: e.place, entry: e))
            for t in (e.tabs ?? []) + (e.pages ?? []) where t.href != e.href { out.append(NavHit(place: t, entry: e)) }
        }
        var seen = Set<String>()
        return out.filter { seen.insert($0.id).inserted }
    }
}

/// A place found by search, with the entry it sits under.
struct NavHit: Identifiable {
    let place: NavPlace
    let entry: NavEntry?
    var id: String { place.href + "|" + place.label }
}
