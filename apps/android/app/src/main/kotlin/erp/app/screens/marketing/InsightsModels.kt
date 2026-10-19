package erp.app.screens.marketing

import erp.app.screens.ads.AdMetrics
import erp.app.screens.ads.AdsFormat
import erp.app.screens.ads.AdsRange
import erp.core.Container
import erp.core.Decodable
import erp.core.swiftRounded
import java.util.Locale

// Insights (Insights.swift; src/app/insights, docs/features/insights.md): the house's Instagram and Facebook, organic
// beside paid, read from /api/insights (owners and marketing accounts, like Ads). What the numbers say comes worked out
// from the server (`part=findings`, shape.ts findingsFor), so the phone and the web never disagree; nothing here decides.

/** A map of text to number, any odd value left out (`numbers`). */
private fun numbers(m: Map<String, Any?>, key: String): Map<String, Double> {
    val raw = m[key] as? Map<*, *> ?: return emptyMap()
    val out = LinkedHashMap<String, Double>()
    for ((k, v) in raw) Container(mapOf("v" to v)).double("v")?.let { out[k.toString()] = it }
    return out
}

private fun obj(m: Map<String, Any?>, key: String): Map<String, Any?>? {
    @Suppress("UNCHECKED_CAST")
    return m[key] as? Map<String, Any?>
}

data class InsightPart(val key: String, val value: Double) {
    companion object : Decodable<InsightPart> {
        override fun fromMap(m: Map<String, Any?>): InsightPart = Container(m).let { InsightPart(it.string("key", ""), it.double("value", 0.0)) }
    }
}

data class InsightSplit(val ads: Double, val organic: Double, val adsShare: Double?, val bySurface: List<InsightPart>) {
    companion object : Decodable<InsightSplit> {
        override fun fromMap(m: Map<String, Any?>): InsightSplit = Container(m).let {
            InsightSplit(it.double("ads", 0.0), it.double("organic", 0.0), it.double("adsShare"), it.list("bySurface", InsightPart))
        }
    }
}

data class InsightFollows(val follows: Double, val unfollows: Double, val net: Double) {
    companion object : Decodable<InsightFollows> {
        override fun fromMap(m: Map<String, Any?>): InsightFollows = Container(m).let {
            InsightFollows(it.double("follows", 0.0), it.double("unfollows", 0.0), it.double("net", 0.0))
        }
    }
}

data class InsightDay(val date: String, val value: Double)

data class InstagramInsight(
    val username: String = "",
    val picture: String? = null,
    val followers: Double = 0.0,
    val totals: Map<String, Double> = emptyMap(),
    val previous: Map<String, Double> = emptyMap(),
    val reach: InsightSplit? = null,
    val views: InsightSplit? = null,
    val interactions: InsightSplit? = null,
    val nonFollowerReach: Double? = null,
    val follows: InsightFollows? = null,
    val previousFollows: InsightFollows? = null,
    /** Accounts reached each day, ads included. */
    val daily: List<InsightDay> = emptyList(),
) {
    companion object : Decodable<InstagramInsight> {
        override fun fromMap(m: Map<String, Any?>): InstagramInsight {
            val c = Container(m)
            val a = obj(m, "account")?.let { Container(it) }
            return InstagramInsight(
                username = a?.string("username", "") ?: "", picture = a?.string("picture"), followers = a?.double("followers", 0.0) ?: 0.0,
                totals = numbers(m, "totals"), previous = numbers(m, "previous"),
                reach = c.obj("reach", InsightSplit), views = c.obj("views", InsightSplit), interactions = c.obj("interactions", InsightSplit),
                nonFollowerReach = c.double("nonFollowerReach"), follows = c.obj("follows", InsightFollows), previousFollows = c.obj("previousFollows", InsightFollows),
                daily = c.list("daily") { v -> (v as? Map<*, *>)?.let { d -> Container(d.entries.associate { it.key.toString() to it.value }).let { x -> InsightDay(x.string("date", ""), x.double("reach", 0.0)) } } },
            )
        }
    }
}

data class FacebookInsight(
    val name: String = "",
    val followers: Double = 0.0,
    val totals: Map<String, Double> = emptyMap(),
    val previous: Map<String, Double> = emptyMap(),
    /** Page views each day. */
    val daily: List<InsightDay> = emptyList(),
) {
    companion object : Decodable<FacebookInsight> {
        override fun fromMap(m: Map<String, Any?>): FacebookInsight {
            val c = Container(m)
            val p = obj(m, "page")?.let { Container(it) }
            return FacebookInsight(
                name = p?.string("name", "") ?: "", followers = p?.double("followers", 0.0) ?: 0.0,
                totals = numbers(m, "totals"), previous = numbers(m, "previous"),
                daily = c.list("daily") { v -> (v as? Map<*, *>)?.let { d -> Container(d.entries.associate { it.key.toString() to it.value }).let { x -> InsightDay(x.string("date", ""), x.double("views", 0.0)) } } },
            )
        }
    }
}

data class InsightPlatform(val platform: String, val metrics: AdMetrics) {
    companion object : Decodable<InsightPlatform> {
        override fun fromMap(m: Map<String, Any?>): InsightPlatform =
            InsightPlatform(Container(m).string("platform", ""), Container(m).obj("metrics", AdMetrics) ?: AdMetrics())
    }
}

data class InsightsOverview(
    val instagram: InstagramInsight? = null,
    val facebook: FacebookInsight? = null,
    val paid: List<InsightPlatform> = emptyList(),
    val paidBefore: List<InsightPlatform> = emptyList(),
    /** The ERP writes Instagram's follower count down every day (`history`); Meta keeps none. */
    val followerDays: List<InsightDay> = emptyList(),
    val currency: String = "PKR",
    val since: String = "",
    val until: String = "",
    val beforeSince: String = "",
    val beforeUntil: String = "",
    val at: String = "",
) {
    companion object : Decodable<InsightsOverview> {
        override fun fromMap(m: Map<String, Any?>): InsightsOverview {
            val c = Container(m)
            val paid = obj(m, "paid")?.let { Container(it) }
            val before = obj(m, "previous")?.let { Container(it) }
            return InsightsOverview(
                instagram = c.obj("instagram", InstagramInsight), facebook = c.obj("facebook", FacebookInsight),
                paid = paid?.list("now", InsightPlatform) ?: emptyList(), paidBefore = paid?.list("before", InsightPlatform) ?: emptyList(),
                followerDays = c.list("history") { v ->
                    val x = (v as? Map<*, *>)?.let { d -> Container(d.entries.associate { it.key.toString() to it.value }) }
                    val f = x?.double("igFollowers")
                    if (x == null || f == null) null else InsightDay(x.string("date", ""), f)
                },
                currency = c.string("currency", "PKR"), since = c.string("since", ""), until = c.string("until", ""),
                beforeSince = before?.string("since", "") ?: "", beforeUntil = before?.string("until", "") ?: "", at = c.string("at", ""),
            )
        }
    }
}

data class InsightFinding(val tone: String, val title: String, val why: String) {
    companion object : Decodable<InsightFinding> {
        override fun fromMap(m: Map<String, Any?>): InsightFinding = Container(m).let { InsightFinding(it.string("tone", "info"), it.string("title", ""), it.string("why", "")) }

        /** The `findings` part's answer. */
        fun list(answer: Any?): List<InsightFinding> = (answer as? Map<*, *>)?.let { Container(it.entries.associate { e -> e.key.toString() to e.value }).list("findings", InsightFinding) } ?: emptyList()
    }
}

data class InsightPost(
    val id: String, val platform: String, val kind: String, val at: String, val caption: String, val thumb: String?, val link: String?,
    val reach: Double?, val views: Double?, val likes: Double?, val comments: Double?, val shares: Double?, val saves: Double?, val interactions: Double?,
    val profileVisits: Double?, val follows: Double?, val avgWatchMs: Double?, val facebookViews: Double?, val clicks: Double?, val replies: Double?,
    val rate: Double?, val older: Boolean,
) {
    companion object : Decodable<InsightPost> {
        override fun fromMap(m: Map<String, Any?>): InsightPost {
            val c = Container(m)
            return InsightPost(
                c.string("id", ""), c.string("platform", ""), c.string("kind", "post"), c.string("at", ""), c.string("caption", ""), c.string("thumb"), c.string("link"),
                c.double("reach"), c.double("views"), c.double("likes"), c.double("comments"), c.double("shares"), c.double("saves"), c.double("interactions"),
                c.double("profileVisits"), c.double("follows"), c.double("avgWatchMs"), c.double("facebookViews"), c.double("clicks"), c.double("replies"),
                c.double("rate"), c.bool("older", false),
            )
        }
    }
}

data class InsightsPosts(val posts: List<InsightPost> = emptyList(), val stories: List<InsightPost> = emptyList(), val live: Set<String> = emptySet(), val lastPostAt: String? = null) {
    companion object : Decodable<InsightsPosts> {
        override fun fromMap(m: Map<String, Any?>): InsightsPosts = Container(m).let {
            InsightsPosts(it.list("posts", InsightPost), it.list("stories", InsightPost), it.strings("liveStories").toSet(), it.string("lastPostAt"))
        }
    }
}

data class InsightDims(val age: List<InsightPart>, val gender: List<InsightPart>, val city: List<InsightPart>, val country: List<InsightPart>) {
    companion object : Decodable<InsightDims> {
        override fun fromMap(m: Map<String, Any?>): InsightDims = Container(m).let {
            InsightDims(it.list("age", InsightPart), it.list("gender", InsightPart), it.list("city", InsightPart), it.list("country", InsightPart))
        }
    }
}

data class InsightsAudience(val followers: InsightDims? = null, val reached: InsightDims? = null, val engaged: InsightDims? = null, val online: List<Double>? = null) {
    companion object : Decodable<InsightsAudience> {
        override fun fromMap(m: Map<String, Any?>): InsightsAudience {
            val a = obj(m, "audience") ?: return InsightsAudience()
            val c = Container(a)
            val hours = (a["online"] as? List<*>)?.map { Container(mapOf("v" to it)).double("v") ?: 0.0 }
            return InsightsAudience(c.obj("followers", InsightDims), c.obj("reached", InsightDims), c.obj("engaged", InsightDims), hours)
        }
    }
}

// MARK: Words and the few rules the screens share

object InsightRange {
    /** Instagram stops at 30 days, so this is not Ads' range. */
    val all: List<AdsRange.Option> = listOf(
        AdsRange.Option("last_7d", "Last 7 days"), AdsRange.Option("last_14d", "Last 14 days"),
        AdsRange.Option("last_28d", "Last 28 days"), AdsRange.Option("this_month", "This month"),
    )

    fun label(key: String): String = all.firstOrNull { it.key == key }?.label ?: key

    /** `GET /api/insights?part=…&range=…[&fresh=1]`. */
    fun path(part: String, range: String, fresh: Boolean): String = "/api/insights?part=$part&range=$range${if (fresh) "&fresh=1" else ""}"
}

object InsightWords {
    val surface = mapOf("POST" to "Posts", "CAROUSEL_CONTAINER" to "Carousels", "REEL" to "Reels", "STORY" to "Stories", "AD" to "Ads")
    val kind = mapOf("post" to "Photo post", "carousel" to "Carousel", "reel" to "Reel", "story" to "Story", "fb" to "Facebook post")
    val platform = mapOf("instagram" to "Instagram", "facebook" to "Facebook", "messenger" to "Messenger", "audience_network" to "Audience Network", "threads" to "Threads")
    val gender = mapOf("F" to "Women", "M" to "Men", "U" to "Not said")
    val country = mapOf(
        "PK" to "Pakistan", "AE" to "UAE", "SA" to "Saudi Arabia", "GB" to "United Kingdom", "US" to "United States", "CA" to "Canada",
        "AU" to "Australia", "IN" to "India", "BD" to "Bangladesh", "DE" to "Germany", "QA" to "Qatar",
    )

    fun optional(v: Double?): String = v?.let { AdsFormat.compact(it) } ?: "—"
    fun percent(v: Double?): String = v?.let { String.format(Locale.US, "%.1f%%", it * 100) } ?: "—"
    fun hour(h: Int): String = "${(h + 11) % 12 + 1}${if (h < 12) "am" else "pm"}"
}

object InsightsLogic {
    val filters = listOf("all" to "All", "reel" to "Reels", "post" to "Photos", "carousel" to "Carousels", "story" to "Stories", "fb" to "Facebook", "older" to "Older, still earning")
    val sorts = listOf("at" to "Newest", "views" to "Views", "reach" to "Reach", "interactions" to "Interactions", "rate" to "Engagement rate", "shares" to "Shares", "saves" to "Saves")

    /** Owners and marketing accounts read Insights (gate.ts, like Ads). */
    fun mayRead(role: String): Boolean = role == "owner" || role == "marketing"

    private fun value(p: InsightPost, sort: String): Double = when (sort) {
        "views" -> p.views; "reach" -> p.reach; "interactions" -> p.interactions; "rate" -> p.rate; "shares" -> p.shares; "saves" -> p.saves
        else -> 0.0
    } ?: -1.0

    /** Posts and stories together, the chosen kind, then newest first or the chosen figure high to low (a missing one last). */
    fun shown(d: InsightsPosts, filter: String, sort: String): List<InsightPost> {
        val rows = (d.posts + d.stories).filter { if (filter == "all") true else if (filter == "older") it.older else it.kind == filter }
        return if (sort == "at") rows.sortedByDescending { it.at } else rows.sortedByDescending { value(it, sort) }
    }

    /** A post's figures under it, in the web's order, only those Meta gave. */
    fun stats(p: InsightPost): List<Pair<String, String>> = buildList {
        add("Views" to InsightWords.optional(p.views)); add("Reach" to InsightWords.optional(p.reach)); add("Likes" to InsightWords.optional(p.likes))
        add("Comments" to InsightWords.optional(p.comments)); add("Shares" to InsightWords.optional(p.shares)); add("Rate" to InsightWords.percent(p.rate))
        p.saves?.let { add("Saves" to AdsFormat.compact(it)) }
        p.profileVisits?.let { add("Profile visits" to AdsFormat.compact(it)) }
        p.follows?.let { add("Follows" to AdsFormat.compact(it)) }
        p.avgWatchMs?.let { add("Avg watch" to String.format(Locale.US, "%.1fs", it / 1000)) }
        p.facebookViews?.let { add("On Facebook" to AdsFormat.compact(it)) }
        p.clicks?.let { add("Clicks" to AdsFormat.compact(it)) }
    }

    /** The follower tile's note: "+12 · 40 in, 28 out". */
    fun followsLine(f: InsightFollows): String = "${if (f.net >= 0) "+" else "−"}${AdsFormat.count(kotlin.math.abs(f.net))} · ${AdsFormat.count(f.follows)} in, ${AdsFormat.count(f.unfollows)} out"

    fun percentOf(share: Double): Int = swiftRounded(share * 100).toInt()

    /** The top eight of a breakdown by size, each with its share of the whole. */
    class Share(val key: String, val value: Double, val percent: Int)

    fun topShares(parts: List<InsightPart>): Pair<List<Share>, Double> {
        val total = maxOf(1.0, parts.sumOf { it.value })
        val top = parts.sortedByDescending { it.value }.take(8)
        return top.map { Share(it.key, it.value, swiftRounded(it.value / total * 100).toInt()) } to maxOf(top.firstOrNull()?.value ?: 1.0, 1.0)
    }

    fun linkShare(totals: Map<String, Double>): String? {
        val visits = totals["profile_views"] ?: 0.0
        return if (visits > 0) String.format(Locale.US, "%.1f%% of visits", 100 * (totals["website_clicks"] ?: 0.0) / visits) else null
    }
}
