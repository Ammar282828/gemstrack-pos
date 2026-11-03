package erp.app.nav

/**
 * Where the person was when the business changed (owner, 2026-11-03: "switched business should open at the same page if possible").
 * `Businesses.switchTo` rebuilds every screen on the new id, so the tab and each tab's chosen sub-page are kept here, outside the
 * composition, and the new business's screens read them as they are made. Only the places both businesses have are kept: a tab the
 * other business lacks falls back to the first tab (RootScaffold's selection), a sub-page that is not in its tabs falls back to the
 * tab's first. A record's page (an invoice, a customer) is not carried: its id is the old business's, so the tab opens on its list.
 * Plain statics (the screens read them in their initialisers). (BusinessCarry.swift.)
 */
object BusinessCarry {
    /** The tab open now, kept current by RootScaffold. */
    private var tab: String? = null

    /** Each root place's chosen sub-page (the title menu or section picker), by the place's own path. */
    private var subs: Map<String, String> = emptyMap()

    /** What the switch in flight carries; null when the app opened cold. */
    private var carried: Pair<String?, Map<String, String>>? = null

    @Synchronized fun noteTab(id: String) { tab = id }

    @Synchronized
    fun noteSub(root: String, chosen: String?) {
        val key = ScreenRoute.bare(root)
        subs = if (chosen == null) subs - key else subs + (key to chosen)
    }

    /** A business switch begins: what is open now is what the next business opens on. */
    @Synchronized
    fun arm() {
        carried = tab to subs
        // What a tab not drawn yet had chosen stays known; the next business's pages note their own as they appear.
    }

    /** The new business's first screen has been drawn from it. */
    @Synchronized fun settled() { carried = null }

    @Synchronized fun carriedTab(): String? = carried?.first

    /** The sub-page chosen under `root` in the business left, if this business has it among that place's tabs. */
    @Synchronized
    fun carriedSub(root: String): String? {
        val chosen = carried?.second?.get(ScreenRoute.bare(root)) ?: return null
        val entry = NavMap.current.entry(root) ?: return null
        return chosen.takeIf { c -> (entry.tabs ?: emptyList()).any { ScreenRoute.bare(it.href) == ScreenRoute.bare(c) } }
    }
}
