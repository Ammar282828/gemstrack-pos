package erp.app.nav

import erp.app.ErpApp
import erp.app.config.House
import erp.core.Json

/**
 * The ERP's map (src/lib/nav.ts, exported per house to nav-<house>.json): every place the ERP has, in its
 * groups and tabs, with who may open it. The app's menus are drawn from this, so nothing the ERP has is
 * missing from the app.
 */
data class NavPlace(
    val href: String,
    val label: String,
    val heading: String?,
    val icon: String?,
    val staff: Boolean?,
    val keywords: List<String>?,
    val match: List<String>?,
    /** nav.ts `moved`: the address redirects (Post a piece, the Studio, into Design); search lists no row for it. */
    val moved: Boolean? = null,
    /** nav.ts `section`: the sub-section of an entry whose tabs are grouped (Analytics: Sales, Website, Social, Ads; Settings: Shop, Connections, Records). */
    val section: String? = null,
    /** nav.ts `marketing`: the marketing account may open this tab from outside the Marketing group. */
    val marketing: Boolean? = null,
) {
    val title: String get() = heading ?: label
}

data class NavEntry(
    val id: String,
    val group: String,
    val href: String,
    val label: String,
    val heading: String?,
    val icon: String?,
    val staff: Boolean?,
    val keywords: List<String>?,
    /** Other paths that belong to this row (nav.ts `match`): /cart is Invoices', for old links. */
    val match: List<String>?,
    val tabs: List<NavPlace>?,
    val pages: List<NavPlace>?,
    val count: String?,
) {
    val place: NavPlace get() = NavPlace(href, label, heading, icon, staff, keywords, match)

    /** The tabs' sections in order of first appearance; empty when the tabs are not grouped. */
    val sections: List<String> get() = (tabs ?: emptyList()).mapNotNull { it.section }.distinct()

    /** The tabs of one section, in the JSON's order. */
    fun tabsIn(section: String): List<NavPlace> = (tabs ?: emptyList()).filter { it.section == section }
}

/** A place found by search, with the entry it sits under. */
data class NavHit(val place: NavPlace, val entry: NavEntry?) {
    val id: String get() = place.href + "|" + place.label
}

data class NavMap(
    val groups: List<Group>,
    /** Null for anyone but an owner: the server saves sales for owners alone, so staff would only meet a lock. */
    val newSale: NavEntry?,
    val entries: List<NavEntry>,
    /** Null for anyone but an owner: nav.ts SETTINGS has no `staff`, so the web keeps it to them. */
    val settings: NavEntry?,
    val actions: List<NavPlace>,
) {
    data class Group(val key: String, val label: String)

    /**
     * The map as a person sees it (src/lib/nav.ts forRole): owners everything; staff only the places marked for
     * them; a marketing account the Marketing group whole and nothing else.
     */
    fun visible(role: String): NavMap {
        if (role == "owner") return this
        if (role == "marketing") {
            // The Marketing group whole, with all its tabs and pages, `staff` or not (Ads has none). Outside it, as nav.ts
            // forRole does, only the tabs marked `marketing` (Analytics' Website, Social and Ads), and the entry only if it
            // has any. No Settings, no New sale and nothing to create.
            val theirs = entries.mapNotNull { e ->
                if (e.group == "marketing") return@mapNotNull e
                val tabs = (e.tabs ?: emptyList()).filter { it.marketing == true }
                val first = tabs.firstOrNull() ?: return@mapNotNull null
                e.copy(href = first.href, tabs = tabs, pages = emptyList())
            }
            return NavMap(groups, null, theirs, null, emptyList())
        }
        fun keep(p: NavPlace) = p.staff == true
        val mine = entries.mapNotNull { e ->
            if (e.staff != true) return@mapNotNull null
            val tabs = e.tabs?.filter(::keep)
            // An entry whose tabs are all the owners' is not theirs; otherwise it opens the first tab they may see.
            if (tabs != null && tabs.isEmpty()) return@mapNotNull null
            e.copy(href = tabs?.firstOrNull()?.href ?: e.href, tabs = tabs, pages = e.pages?.filter(::keep))
        }
        // New sale is out of Create too: it is the same sale the server will not save for staff.
        return NavMap(groups, null, mine, null, actions.filter { keep(it) && it.href != newSale?.href })
    }

    /**
     * The entry a path belongs to (its own href, a tab's, a page's, a `match`, or beneath one): the one that
     * claims it longest, as nav.ts `locate` does, so /settings/printer is Stock's Labels, not Settings.
     */
    fun entry(path: String): NavEntry? {
        val p = path.substringBefore('?')
        fun weight(href: String): Int {
            val h = href.substringBefore('?')
            return if (p == h || (h != "/" && p.startsWith("$h/"))) h.length else -1
        }
        fun claim(place: NavPlace) = (listOf(place.href) + (place.match ?: emptyList())).maxOf(::weight)
        var best: NavEntry? = null
        var bestScore = -1
        for (e in entries + listOfNotNull(settings)) {
            val score = maxOf(claim(e.place), e.tabs?.maxOfOrNull(::claim) ?: -1, e.pages?.maxOfOrNull(::claim) ?: -1)
            if (score >= 0 && score > bestScore) { best = e; bestScore = score }
        }
        return best
    }

    /** Everything this person may open, flat: for search. */
    val allPlaces: List<NavHit>
        get() {
            val out = ArrayList<NavHit>()
            actions.forEach { out.add(NavHit(it, null)) }
            for (e in listOfNotNull(newSale) + entries + listOfNotNull(settings)) {
                out.add(NavHit(e.place, e))
                for (t in (e.tabs ?: emptyList()) + (e.pages ?: emptyList())) if (t.href != e.href && t.moved != true) out.add(NavHit(t, e))
            }
            val seen = HashSet<String>()
            return out.filter { seen.add(it.id) }
        }

    /** Places by name, by the words people use for them, or by the row they sit under. */
    fun search(text: String): List<NavHit> {
        val q = text.trim().lowercase()
        if (q.isEmpty()) return emptyList()
        return allPlaces.filter { item ->
            item.place.label.lowercase().contains(q) || (item.place.keywords ?: emptyList()).any { it.lowercase().contains(q) } ||
                (item.entry?.label?.lowercase()?.contains(q) ?: false)
        }
    }

    companion object {
        /** This house's map, bundled as assets/nav-<house>.json (`npm run nav:export`). */
        val current: NavMap by lazy {
            val text = runCatching {
                ErpApp.instance.assets.open("nav-${House.id}.json").bufferedReader().use { it.readText() }
            }.getOrNull() ?: error("nav-${House.id}.json is missing: run `npm run nav:export`.")
            parse(text) ?: error("nav-${House.id}.json can't be read.")
        }

        fun parse(text: String): NavMap? {
            val m = Json.parse(text) as? Map<*, *> ?: return null
            val groups = (m["groups"] as? List<*>).orEmpty().mapNotNull { g ->
                val gm = g as? Map<*, *> ?: return@mapNotNull null
                Group(gm["key"] as? String ?: return@mapNotNull null, gm["label"] as? String ?: "")
            }
            return NavMap(
                groups = groups,
                newSale = entry(m["newSale"]),
                entries = (m["entries"] as? List<*>).orEmpty().mapNotNull { entry(it) },
                settings = entry(m["settings"]),
                actions = (m["actions"] as? List<*>).orEmpty().mapNotNull { place(it) },
            )
        }

        private fun strings(v: Any?): List<String>? = (v as? List<*>)?.mapNotNull { it as? String }

        private fun place(v: Any?): NavPlace? {
            val m = v as? Map<*, *> ?: return null
            return NavPlace(
                href = m["href"] as? String ?: return null, label = m["label"] as? String ?: return null,
                heading = m["heading"] as? String, icon = m["icon"] as? String, staff = m["staff"] as? Boolean,
                keywords = strings(m["keywords"]), match = strings(m["match"]),
                moved = m["moved"] as? Boolean, section = m["section"] as? String, marketing = m["marketing"] as? Boolean,
            )
        }

        private fun entry(v: Any?): NavEntry? {
            val m = v as? Map<*, *> ?: return null
            return NavEntry(
                id = m["id"] as? String ?: return null, group = m["group"] as? String ?: return null,
                href = m["href"] as? String ?: return null, label = m["label"] as? String ?: return null,
                heading = m["heading"] as? String, icon = m["icon"] as? String, staff = m["staff"] as? Boolean,
                keywords = strings(m["keywords"]), match = strings(m["match"]),
                tabs = (m["tabs"] as? List<*>)?.mapNotNull { place(it) }, pages = (m["pages"] as? List<*>)?.mapNotNull { place(it) },
                count = m["count"] as? String,
            )
        }
    }
}
