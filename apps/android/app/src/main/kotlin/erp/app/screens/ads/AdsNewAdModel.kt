package erp.app.screens.ads

import erp.core.ERPDate
import java.time.Instant

// New ad's draft and what it makes of it (AdsNewAd.swift's computed properties), as plain data so the JSON the routes
// take is tested on the JVM key for key. Nothing here decides whether an ad can be made or what it costs: that is the
// server's (/api/ads/plan, then /api/ads/create, which checks again).

enum class AdsKind { post, photos, site }

data class AdsNewAdDraft(
    val kind: AdsKind = AdsKind.post,
    val post: AdsMedia? = null,
    val photos: List<AdsPhoto> = emptyList(),
    /** A 9:16 version of a single photo (from "Make one like this"): one ad, each place its own size. */
    val vertical: AdsPhoto? = null,
    val goalKey: String = "whatsapp",
    val text: String = "",
    val headline: String = "",
    val link: String = "",
    val button: String = "SHOP_NOW",
    val audience: AdsAudience = AdsAudience(),
    val budgetKind: String = "daily",
    val amount: String = "1000",
    val days: Int? = 7,
    val startLater: Boolean = false,
    val start: Instant = Instant.EPOCH,
    val launch: String = "paused",
    val name: String = "",
) {
    val readyPhotos: List<AdsPhoto> get() = photos.filter { it.ready }
    val stillUploading: Boolean get() = photos.any { it.uploading }

    /** The goals New ad offers here, for what is being promoted (a boosted post can't carry some, new photos others). */
    fun offered(l: AdsNewAdLists): List<AdsGoal> =
        l.goals.filter { g -> g.newAd && (if (kind == AdsKind.post) !g.photosOnly else !g.postOnly) }

    /** A goal a boosted post can't carry (or new photos can't) goes back to WhatsApp chats. */
    fun fitGoal(l: AdsNewAdLists): AdsNewAdDraft = if (offered(l).none { it.key == goalKey }) copy(goalKey = "whatsapp") else this

    /** Steps after the words move up one when a post is promoted (it keeps its own words). */
    fun step(n: Int): Int = if (kind == AdsKind.post) n - 1 else n

    fun budget(now: Instant): AdsBudget {
        val from = if (startLater) start else now
        return AdsBudget(
            kind = budgetKind,
            amount = AdsAmount.parse(amount) ?: 0.0,
            start = if (startLater) AdsTime.iso(start) else null,
            end = days?.let { AdsTime.iso(from.plusSeconds(it * 86_400L)) },
        )
    }

    /** The ad as the routes take it (plan.ts AdPlan). */
    fun plan(now: Instant): Map<String, Any?> {
        val source = LinkedHashMap<String, Any?>()
        if (kind == AdsKind.post) {
            source["kind"] = "post"
            source["mediaId"] = post?.id ?: ""
            post?.permalink?.let { source["permalink"] = it }
            source["thumb"] = post?.thumb
            source["caption"] = post?.caption ?: ""
        } else {
            val ready = readyPhotos
            source["kind"] = "photos"
            source["photos"] = ready.map { it.json }
            source["vertical"] = if (vertical != null && ready.size == 1) vertical.json else null
        }
        val p = LinkedHashMap<String, Any?>()
        p["goal"] = goalKey
        p["source"] = source
        p["text"] = text
        p["headline"] = headline
        p["link"] = link
        p["button"] = button
        p["audience"] = audience.json
        p["budget"] = budget(now).json
        p["launch"] = launch
        p["name"] = name.trim()
        return p
    }

    /** The days it would run through that the house keeps free of product ads (Taheri's Bohra calendar). */
    fun quietInRange(lists: AdsNewAdLists?, now: Instant): List<AdsQuietDay> {
        if (lists == null || lists.quiet.isEmpty()) return emptyList()
        val from = if (startLater) start else now
        val to = days?.let { from.plusSeconds(it * 86_400L) } ?: now.plusSeconds(30 * 86_400L)
        val a = ERPDate.karachiDay(from)
        val b = ERPDate.karachiDay(to)
        return lists.quiet.filter { it.date >= a && it.date <= b }
    }

    /** What the confirmation says: the server's lines, the name, and any quiet days the ad would run through. */
    fun confirmText(check: AdsPlanCheck?, lists: AdsNewAdLists?, now: Instant): String {
        val c = check ?: return ""
        val lines = ArrayList(c.summary)
        lines.add("Name: ${c.name}")
        val q = quietInRange(lists, now)
        q.firstOrNull()?.let { first ->
            lines.add("It would run through ${q.size} day${if (q.size == 1) "" else "s"} the house keeps free of product ads, from ${erp.app.ui.ShopDate.say(first.date)}.")
        }
        return lines.joinToString("\n")
    }

    /** What the budget can spend, as the web says it under the budget (the server's lines come at Review). */
    fun budgetNote(currency: String, minDailyBudget: Double?): String {
        val v = AdsAmount.parse(amount) ?: return "A budget above zero."
        var line: String
        if (budgetKind == "daily") {
            line = if (days != null) {
                "At most about ${AdsFormat.money(v * days, currency)} over $days days (Meta may spend a little more on a good day and less on others)."
            } else {
                "About ${AdsFormat.money(v * 30, currency)} a month until it's paused."
            }
            if (minDailyBudget != null && minDailyBudget > 0 && v < minDailyBudget) {
                line += " Meta's smallest daily budget for this account is ${AdsFormat.money(minDailyBudget, currency)}."
            }
        } else {
            line = "About ${AdsFormat.money(v / maxOf(1, days ?: 1), currency)} a day over ${days ?: 1} days."
        }
        return line
    }

    /** The quick amounts under the field. */
    val quickAmounts: List<Double>
        get() = if (budgetKind == "daily") listOf(500.0, 1000.0, 2000.0, 3000.0, 5000.0) else listOf(3000.0, 5000.0, 10000.0, 20000.0, 50000.0)

    /** The path of "Test it on another audience" after an ad is made. */
    companion object {
        fun adSetPath(m: AdsMade): String {
            val q = ArrayList<String>()
            if (m.campaignId.isNotEmpty()) q.add("campaign=${m.campaignId}")
            if (m.adId.isNotEmpty()) q.add("ads=${m.adId}")
            return "/ads/adset" + (if (q.isEmpty()) "" else "?" + q.joinToString("&"))
        }

        /** A website piece or a photo of the ad: up to ten photos make a carousel. */
        const val MAX_PHOTOS = 10
    }
}

/** One ad set of the designer (lib/ads/adset-design.ts AdSetDraft), with its dates as the phone picks them. */
data class AdsSetDraft(
    val key: String,
    val name: String,
    val goal: String,
    val audience: AdsAudience,
    val budgetKind: String = "daily",
    val amount: String = "1000",
    val start: Instant? = null,
    val end: Instant? = null,
) {
    /** The next card: the one before it with a new name, so a test changes one thing at a time (nextAdSet). */
    fun next(n: Int, key: String): AdsSetDraft = copy(key = key, name = "Ad set $n")

    val json: Map<String, Any?>
        get() {
            val b = AdsBudget(kind = budgetKind, amount = AdsAmount.parse(amount) ?: 0.0, start = start?.let { AdsTime.iso(it) }, end = end?.let { AdsTime.iso(it) })
            val o = LinkedHashMap<String, Any?>()
            o["key"] = key
            o["name"] = name
            o["goal"] = goal
            o["audience"] = audience.json
            o["budget"] = b.json
            return o
        }
}

/** The designer's whole design (adset/page.tsx), as the routes take it. */
data class AdsDesign(
    /** "new" or an existing campaign's id. */
    val target: String,
    val campaignName: String,
    val campaign: AdsAdsetsInfo.Campaign?,
    val sets: List<AdsSetDraft>,
    /** "copy" or "post". */
    val adsKind: String,
    val adIds: List<String>,
    val post: String,
    val link: String,
    val launch: String,
) {
    val budgeted: Boolean get() = target != "new" && (campaign?.budgeted ?: false)

    val adCount: Int get() = sets.size * (if (adsKind == "copy") adIds.size else 1)

    /** The goals an ad set can have here: Meta fixes the objective per campaign (goalsForObjective), and a boosted post can't carry some goals, copies of ads others. */
    fun allowed(lists: AdsNewAdLists?): List<AdsGoal> {
        val all = lists?.goals ?: emptyList()
        val base = if (target != "new" && campaign != null) all.filter { it.objective == campaign.objective } else all
        return base.filter { if (adsKind == "post") !it.photosOnly else !it.postOnly }
    }

    fun json(): Map<String, Any?> {
        val c = LinkedHashMap<String, Any?>()
        if (target == "new") {
            c["kind"] = "new"
            c["name"] = campaignName
        } else {
            c["kind"] = "existing"
            c["id"] = target
            c["objective"] = campaign?.objective ?: ""
            c["budgeted"] = campaign?.budgeted ?: false
            c["name"] = campaign?.name ?: ""
        }
        val ads = LinkedHashMap<String, Any?>()
        if (adsKind == "copy") {
            ads["kind"] = "copy"
            ads["ids"] = adIds
        } else {
            ads["kind"] = "post"
            ads["mediaId"] = post
            ads["link"] = link
        }
        val d = LinkedHashMap<String, Any?>()
        d["campaign"] = c
        d["adsets"] = sets.map { it.json }
        d["ads"] = ads
        d["launch"] = launch
        return d
    }
}
