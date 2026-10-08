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
    let tabs: [NavPlace]?
    let pages: [NavPlace]?
    let count: String?

    var place: NavPlace { NavPlace(href: href, label: label, heading: heading, icon: icon, staff: staff, keywords: keywords, match: nil) }
}

struct NavMap: Decodable {
    struct Group: Decodable, Hashable { let key: String; let label: String }
    let groups: [Group]
    let newSale: NavEntry
    let entries: [NavEntry]
    let settings: NavEntry
    let actions: [NavPlace]

    static let current: NavMap = {
        guard let url = Bundle.main.url(forResource: "nav-\(House.id)", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let map = try? JSONDecoder().decode(NavMap.self, from: data) else {
            fatalError("Resources/nav-\(House.id).json is missing: run `npm run nav:export`.")
        }
        return map
    }()

    /// The map as a person sees it (src/lib/nav.ts forRole): staff only the places marked for them.
    func visible(to role: String) -> NavMap {
        guard role != "owner" else { return self }
        func keep(_ p: NavPlace) -> Bool { p.staff == true }
        let entries = entries.compactMap { e -> NavEntry? in
            guard e.staff == true else { return nil }
            return NavEntry(id: e.id, group: e.group, href: e.href, label: e.label, heading: e.heading, icon: e.icon, staff: e.staff,
                            keywords: e.keywords, tabs: e.tabs?.filter(keep), pages: e.pages?.filter(keep), count: e.count)
        }
        return NavMap(groups: groups, newSale: newSale, entries: entries, settings: settings, actions: actions.filter(keep))
    }

    /// The entry a path belongs to (its own href, a tab's, a page's, or beneath one).
    func entry(for path: String) -> NavEntry? {
        let p = path.split(separator: "?").first.map(String.init) ?? path
        func within(_ href: String) -> Bool { let h = href.split(separator: "?").first.map(String.init) ?? href; return p == h || (h != "/" && p.hasPrefix(h + "/")) }
        return (entries + [settings]).first { e in
            within(e.href) || (e.tabs ?? []).contains { within($0.href) || ($0.match ?? []).contains(where: within) } || (e.pages ?? []).contains { within($0.href) }
        }
    }

    /// Everything, flat: for search.
    var allPlaces: [NavHit] {
        var out: [NavHit] = actions.map { NavHit(place: $0, entry: nil) }
        for e in [newSale] + entries + [settings] {
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
