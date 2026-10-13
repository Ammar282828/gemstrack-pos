package erp.app.screens.ads

import erp.app.ui.ShopDate

// Which campaigns the Campaigns page shows, in what order, and the lines it writes (AdsCampaigns.swift). Pure, so the
// rules are tested on the JVM.

enum class AdsFilter(val label: String) { all("All"), running("Running"), paused("Paused"), problems("Problems") }

/** The gallery's orders (the web's sort box). */
enum class AdsSort(val key: String, val label: String) {
    spend("spend", "Most spent"), results("results", "Most results"), cost("cost", "Cheapest result"), ctr("ctr", "Best click-through"), byName("name", "Name"),
}

object AdsCampaignsLogic {
    fun isProblem(status: String, issues: List<String>): Boolean =
        status in listOf("DISAPPROVED", "WITH_ISSUES", "PENDING_BILLING_INFO") || issues.isNotEmpty()

    /** The campaigns that match the words typed (every word, anywhere in a campaign's, ad set's or ad's name) and the filter. */
    fun shown(campaigns: List<AdCampaign>, filter: AdsFilter, search: String): List<AdCampaign> {
        val words = search.lowercase().split(' ').filter { it.isNotEmpty() }
        return campaigns.filter { c ->
            if (words.isNotEmpty()) {
                val names = ArrayList<String>()
                names.add(c.name)
                for (s in c.adsets) {
                    names.add(s.name)
                    for (a in s.ads) names.add(a.name)
                }
                val text = names.joinToString(" ").lowercase()
                if (!words.all { text.contains(it) }) return@filter false
            }
            when (filter) {
                AdsFilter.all -> true
                AdsFilter.running -> c.effectiveStatus == "ACTIVE"
                AdsFilter.paused -> c.effectiveStatus == "PAUSED"
                AdsFilter.problems ->
                    isProblem(c.effectiveStatus, c.issues) ||
                        c.adsets.any { s -> isProblem(s.effectiveStatus, s.issues) || s.ads.any { a -> isProblem(a.effectiveStatus, a.issues) } }
            }
        }
    }

    /** "All campaigns: PKR 12,000 spent · 45k views". */
    fun summary(count: Int, all: Int, spent: Double, views: Double, cur: String): String {
        val which = if (count == all) "All campaigns" else "$count of $all campaigns"
        return "$which: ${AdsFormat.money(spent, cur)} spent · ${AdsFormat.compact(views)} views"
    }

    /** Every ad of the shown campaigns under the same status filter, in the chosen order (the gallery). */
    fun gallery(campaigns: List<AdCampaign>, filter: AdsFilter, sort: AdsSort): List<AdItem> {
        val ads = campaigns.flatMap { it.adsets }.flatMap { it.ads }.filter { ad ->
            when (filter) {
                AdsFilter.all -> true
                AdsFilter.running -> ad.effectiveStatus == "ACTIVE"
                AdsFilter.paused -> ad.effectiveStatus == "PAUSED"
                AdsFilter.problems -> isProblem(ad.effectiveStatus, ad.issues)
            }
        }
        fun results(a: AdItem) = AdsResults.of(a.metrics, null)?.value ?: 0.0
        fun cost(a: AdItem) = results(a).let { if (it > 0) a.metrics.spend / it else Double.POSITIVE_INFINITY }
        return when (sort) {
            AdsSort.byName -> ads.sortedWith { a, b -> a.name.compareTo(b.name, ignoreCase = true) }
            AdsSort.results -> ads.sortedByDescending { results(it) }
            AdsSort.cost -> ads.sortedBy { cost(it) }
            AdsSort.ctr -> ads.sortedByDescending { it.metrics.ctr }
            AdsSort.spend -> ads.sortedByDescending { it.metrics.spend }
        }
    }

    /** The budget in words: "PKR 1,000 a day", "PKR 30,000 in total", else nothing. */
    fun budget(daily: Double?, lifetime: Double?, cur: String): String {
        if (daily != null && daily > 0) return "${AdsFormat.money(daily, cur)} a day"
        if (lifetime != null && lifetime > 0) return "${AdsFormat.money(lifetime, cur)} in total"
        return ""
    }

    /** "PKR 12,000 · up 18% on before · 45 chats started · PKR 266 each · 12.3k reached". */
    fun numbers(m: AdMetrics, goal: String?, before: AdMetrics?, cur: String): String {
        val parts = ArrayList<String>()
        parts.add(AdsFormat.money(m.spend, cur))
        AdsFormat.change(m.spend, before?.spend)?.let { parts.add(it) }
        AdsResults.of(m, goal)?.let { r ->
            parts.add("${AdsFormat.count(r.value)} ${r.label.lowercase()}")
            if (r.value > 0) parts.add("${AdsFormat.money(m.spend / r.value, cur)} each")
        }
        parts.add("${AdsFormat.compact(m.reach)} reached")
        return parts.joinToString(" · ")
    }

    /** "Traffic · 2 ad sets · ends Tue 20 Oct". */
    fun campaignBits(c: AdCampaign): String = listOf(
        AdsObjective.label(c.objective),
        "${c.adsets.size} ad set${if (c.adsets.size == 1) "" else "s"}",
        c.stopTime?.let { AdsDays.say(it) }?.takeIf { it.isNotEmpty() }?.let { "ends $it" } ?: "",
    ).filter { it.isNotEmpty() }.joinToString(" · ")

    /** The path of a campaign's, ad set's or ad's own page. */
    fun objectPath(level: String, id: String): String = "/ads/object?level=$level&id=${AdsQuery.escape(id)}"
}

/** What the budget sheet changes: a campaign (a budget on the campaign) or an ad set (a budget of its own). */
data class AdsBudgetTarget(
    /** "campaign" or "adset". */
    val level: String,
    val id: String,
    val name: String,
    val daily: Double?,
    val lifetime: Double?,
    /** Meta's stop time (a campaign) or end time (an ad set), or null for none. */
    val end: String?,
    val currency: String,
)
