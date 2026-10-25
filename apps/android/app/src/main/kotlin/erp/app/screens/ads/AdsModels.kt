package erp.app.screens.ads

import erp.app.ui.PaymentText
import erp.app.ui.Tone
import erp.core.Container
import erp.core.Decodable
import erp.core.logic.Money
import erp.core.swiftRounded
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale
import kotlin.math.abs

// The Ads routes' answers (src/lib/ads/shape.ts, /api/ads/overview, /api/ads/campaigns), read leniently
// (AdsModels.swift). Money in them is already in the account's currency, whole units (the server converts Meta's
// minor units), so nothing here divides by 100.

/** A map's nested object, or null. */
internal fun Map<String, Any?>.obj(key: String): Map<String, Any?>? {
    @Suppress("UNCHECKED_CAST")
    return this[key] as? Map<String, Any?>
}

/** `[String: Lossy<Double>]`: numbers and numeric text kept, anything else dropped. */
internal fun numberMap(v: Any?): Map<String, Double>? {
    val m = v as? Map<*, *> ?: return null
    val out = LinkedHashMap<String, Double>()
    for ((k, value) in m) {
        val n = Container(mapOf("v" to value)).double("v") ?: continue
        out[k.toString()] = n
    }
    return out
}

/** A non-empty string or null (`.flatMap { $0.isEmpty ? nil : $0 }`). */
internal fun Container.text(key: String): String? = string(key)?.takeIf { it.isNotEmpty() }

/** A range's numbers for an account, a campaign, an ad set or an ad (shape.ts `Metrics`). */
data class AdMetrics(
    val spend: Double = 0.0,
    val impressions: Double = 0.0,
    val reach: Double = 0.0,
    val frequency: Double = 0.0,
    val clicks: Double = 0.0,
    val linkClicks: Double = 0.0,
    val ctr: Double = 0.0,
    val cpm: Double = 0.0,
    val cpc: Double = 0.0,
    /** Meta's action types ("link_click", "onsite_conversion.messaging_conversation_started_7d") and how many. */
    val actions: Map<String, Double> = emptyMap(),
    /** What the actions were worth (shape.ts `values`, Meta's action_values): purchases' order value, in the account's money. */
    val values: Map<String, Double> = emptyMap(),
) {
    companion object : Decodable<AdMetrics> {
        override fun fromMap(m: Map<String, Any?>): AdMetrics {
            val c = Container(m)
            return AdMetrics(
                spend = c.double("spend", 0.0), impressions = c.double("impressions", 0.0), reach = c.double("reach", 0.0),
                frequency = c.double("frequency", 0.0), clicks = c.double("clicks", 0.0), linkClicks = c.double("linkClicks", 0.0),
                ctr = c.double("ctr", 0.0), cpm = c.double("cpm", 0.0), cpc = c.double("cpc", 0.0),
                actions = numberMap(m["actions"]) ?: emptyMap(),
                values = numberMap(m["values"]) ?: emptyMap(),
            )
        }
    }
}

/** The ad account (shape.ts `AdsAccount`). */
data class AdAccount(
    val id: String,
    val name: String,
    val currency: String,
    val status: Int,
    val amountSpent: Double,
    val spendCap: Double?,
    val funding: String?,
    /** Meta's smallest daily budget for the account, in its currency (New ad's floor). */
    val minDailyBudget: Double?,
) {
    companion object : Decodable<AdAccount> {
        override fun fromMap(m: Map<String, Any?>): AdAccount {
            val c = Container(m)
            return AdAccount(
                id = c.string("id", ""), name = c.string("name", ""), currency = c.string("currency", "PKR"),
                status = c.int("status") ?: 0, amountSpent = c.double("amountSpent", 0.0), spendCap = c.double("spendCap"),
                funding = c.string("funding"), minDailyBudget = c.double("minDailyBudget"),
            )
        }
    }
}

data class AdDay(val date: String, val metrics: AdMetrics) {
    companion object : Decodable<AdDay> {
        override fun fromMap(m: Map<String, Any?>): AdDay =
            AdDay(Container(m).string("date", ""), Container(m).obj("metrics", AdMetrics) ?: AdMetrics())
    }
}

/** An ad that spent most in the range. */
data class AdTop(
    val id: String,
    val name: String,
    val campaign: String,
    val thumbnail: String?,
    val goal: String?,
    val metrics: AdMetrics,
) {
    companion object : Decodable<AdTop> {
        override fun fromMap(m: Map<String, Any?>): AdTop {
            val c = Container(m)
            return AdTop(
                c.string("id", ""), c.string("name", ""), c.string("campaign", ""), c.string("thumbnail"), c.string("goal"),
                c.obj("metrics", AdMetrics) ?: AdMetrics(),
            )
        }
    }
}

/** A row of "who saw them", "where" or "region". */
data class AdSplit(val key: String, val label: String, val metrics: AdMetrics) {
    companion object : Decodable<AdSplit> {
        override fun fromMap(m: Map<String, Any?>): AdSplit {
            val c = Container(m)
            return AdSplit(c.string("key", ""), c.string("label", ""), c.obj("metrics", AdMetrics) ?: AdMetrics())
        }
    }
}

/** One thing that needs a look (src/lib/ads/attention.ts `AttentionItem`). */
data class AdAttention(
    val severity: String,
    val title: String,
    val why: String,
    /** pause, resume or open; empty when there is nothing to tap. */
    val doing: String,
    val level: String,
    val targetId: String,
    val targetName: String,
    val href: String,
) {
    val id: String get() = "$title|$targetId|$why"

    companion object : Decodable<AdAttention> {
        override fun fromMap(m: Map<String, Any?>): AdAttention {
            val c = Container(m)
            val a = Container(m.obj("action") ?: emptyMap())
            return AdAttention(
                severity = c.string("severity", "tip"), title = c.string("title", ""), why = c.string("why", ""),
                doing = a.string("do", ""), level = a.string("level", ""), targetId = a.string("id", ""),
                targetName = a.string("name", ""), href = a.string("href", ""),
            )
        }
    }
}

data class AdMonth(val spent: Double, val projected: Double, val lastMonth: Double, val dayOfMonth: Int, val daysInMonth: Int) {
    companion object : Decodable<AdMonth> {
        override fun fromMap(m: Map<String, Any?>): AdMonth {
            val c = Container(m)
            return AdMonth(
                c.double("spent", 0.0), c.double("projected", 0.0), c.double("lastMonth", 0.0),
                c.int("dayOfMonth") ?: 1, maxOf(1, c.int("daysInMonth") ?: 30),
            )
        }
    }
}

/** GET /api/ads/overview. */
data class AdOverview(
    val account: AdAccount,
    val since: String?,
    val until: String?,
    val totals: AdMetrics,
    val before: AdMetrics?,
    val beforeSince: String?,
    val beforeUntil: String?,
    val daily: List<AdDay>,
    val topAds: List<AdTop>,
    val ageGender: List<AdSplit>,
    val placement: List<AdSplit>,
    val region: List<AdSplit>,
    val attention: List<AdAttention>,
    val month: AdMonth?,
    val at: String,
) {
    companion object : Decodable<AdOverview> {
        /** Null when the answer has no ad account (the Swift throws keyNotFound). */
        override fun from(value: Any?): AdOverview? {
            if (value !is Map<*, *>) return null
            @Suppress("UNCHECKED_CAST")
            val m = value as Map<String, Any?>
            if (m.obj("account") == null) return null
            return fromMap(m)
        }

        override fun fromMap(m: Map<String, Any?>): AdOverview {
            val c = Container(m)
            val p = m.obj("previous")
            val bc = Container(m.obj("breakdowns") ?: emptyMap())
            val pc = Container(p ?: emptyMap())
            return AdOverview(
                account = c.obj("account", AdAccount) ?: AdAccount.fromMap(emptyMap()),
                since = c.string("since"), until = c.string("until"),
                totals = c.obj("totals", AdMetrics) ?: AdMetrics(),
                before = if (p != null) pc.obj("metrics", AdMetrics) else null,
                beforeSince = pc.string("since"), beforeUntil = pc.string("until"),
                daily = c.list("daily", AdDay), topAds = c.list("topAds", AdTop),
                ageGender = bc.list("ageGender", AdSplit), placement = bc.list("placement", AdSplit), region = bc.list("region", AdSplit),
                attention = c.list("attention", AdAttention), month = c.obj("month", AdMonth), at = c.string("at", ""),
            )
        }
    }
}

// MARK: The campaign tree

data class AdItem(
    val id: String,
    val name: String,
    val status: String,
    val effectiveStatus: String,
    val image: String?,
    val issues: List<String>,
    val metrics: AdMetrics,
) {
    companion object : Decodable<AdItem> {
        override fun fromMap(m: Map<String, Any?>): AdItem {
            val c = Container(m)
            val state = c.string("status", "")
            return AdItem(
                c.string("id", ""), c.string("name", ""), state, c.string("effectiveStatus", state),
                c.string("image") ?: c.string("thumbnail"), c.strings("issues"), c.obj("metrics", AdMetrics) ?: AdMetrics(),
            )
        }
    }
}

data class AdSet(
    val id: String,
    val name: String,
    val status: String,
    val effectiveStatus: String,
    val optimizationGoal: String,
    val dailyBudget: Double?,
    val lifetimeBudget: Double?,
    val endTime: String?,
    val learning: String?,
    val issues: List<String>,
    val metrics: AdMetrics,
    val ads: List<AdItem>,
) {
    companion object : Decodable<AdSet> {
        override fun fromMap(m: Map<String, Any?>): AdSet {
            val c = Container(m)
            val state = c.string("status", "")
            return AdSet(
                c.string("id", ""), c.string("name", ""), state, c.string("effectiveStatus", state), c.string("optimizationGoal", ""),
                c.double("dailyBudget"), c.double("lifetimeBudget"), c.string("endTime"), c.string("learning"), c.strings("issues"),
                c.obj("metrics", AdMetrics) ?: AdMetrics(), c.list("ads", AdItem),
            )
        }
    }
}

data class AdCampaign(
    val id: String,
    val name: String,
    val status: String,
    val effectiveStatus: String,
    val objective: String,
    val dailyBudget: Double?,
    val lifetimeBudget: Double?,
    val stopTime: String?,
    val issues: List<String>,
    val metrics: AdMetrics,
    /** The same length of time before, for "up 18%". */
    val previous: AdMetrics?,
    val adsets: List<AdSet>,
) {
    companion object : Decodable<AdCampaign> {
        override fun fromMap(m: Map<String, Any?>): AdCampaign {
            val c = Container(m)
            val state = c.string("status", "")
            return AdCampaign(
                c.string("id", ""), c.string("name", ""), state, c.string("effectiveStatus", state), c.string("objective", ""),
                c.double("dailyBudget"), c.double("lifetimeBudget"), c.string("stopTime"), c.strings("issues"),
                c.obj("metrics", AdMetrics) ?: AdMetrics(), c.obj("previous", AdMetrics), c.list("adsets", AdSet),
            )
        }
    }
}

/** GET /api/ads/campaigns. */
data class AdCampaigns(val account: AdAccount, val campaigns: List<AdCampaign>) {
    companion object : Decodable<AdCampaigns> {
        override fun from(value: Any?): AdCampaigns? {
            if (value !is Map<*, *>) return null
            @Suppress("UNCHECKED_CAST")
            val m = value as Map<String, Any?>
            if (m.obj("account") == null) return null
            return fromMap(m)
        }

        override fun fromMap(m: Map<String, Any?>): AdCampaigns {
            val c = Container(m)
            return AdCampaigns(
                c.obj("account", AdAccount) ?: AdAccount.fromMap(emptyMap()),
                c.list("campaigns", AdCampaign).filter { it.id.isNotEmpty() },
            )
        }
    }
}

// MARK: Words (AdsKit.swift)

/** The ranges the Overview and Campaigns read (the web's chip row), remembered on the phone. */
object AdsRange {
    class Option(val key: String, val label: String)

    val all = listOf(
        Option("today", "Today"), Option("yesterday", "Yesterday"), Option("last_7d", "Last 7 days"), Option("last_14d", "Last 14 days"),
        Option("last_30d", "Last 30 days"), Option("this_month", "This month"), Option("last_month", "Last month"), Option("maximum", "All time"),
    )

    fun label(key: String): String = all.firstOrNull { it.key == key }?.label ?: key
}

/** The Ads pages' numbers and money in words (AdsKit.swift AdsFormat). */
object AdsFormat {
    /** "PKR 1,500", "PKR 4.5 lac" from a lac up, a few paise only under 100; another currency by its code. */
    fun money(amount: Double, currency: String): String {
        val v = if (amount.isFinite()) amount else 0.0
        val rounded = if (abs(v) >= 100) swiftRounded(v) else swiftRounded(v * 100) / 100
        if (currency.uppercase() == "PKR") {
            return if (abs(rounded) >= Money.lac) Money.pkrLac(rounded) else PaymentText.pkr(rounded)
        }
        val f = DecimalFormat(if (abs(rounded) >= 100) "#,##0" else "#,##0.##", DecimalFormatSymbols(Locale.US))
        f.roundingMode = RoundingMode.HALF_EVEN
        return "${currency.uppercase()} " + f.format(rounded)
    }

    /** 12,345. */
    fun count(v: Double): String = Money.grouped(if (v.isFinite()) v else 0.0)

    private fun trimmed(x: Double, digits: Int): String {
        var s = String.format(Locale.US, "%.${digits}f", x)
        while (s.contains('.') && s.endsWith("0")) s = s.dropLast(1)
        if (s.endsWith(".")) s = s.dropLast(1)
        return s
    }

    /** 12,300 → "12.3k", 1,250,000 → "1.25M": for tiles. */
    fun compact(v: Double): String {
        val a = abs(v)
        if (a >= 1_000_000) return trimmed(v / 1_000_000, 2) + "M"
        if (a >= 10_000) return trimmed(v / 1_000, 1) + "k"
        return count(v)
    }

    fun pct(v: Double): String = String.format(Locale.US, "%.2f%%", if (v.isFinite()) v else 0.0)

    /** "up 18% on before" / "down 6% on before": null when there is nothing to compare or it has not moved. */
    fun change(now: Double, before: Double?): String? {
        if (before == null || before == 0.0 || !now.isFinite()) return null
        val d = (now - before) / before * 100
        if (abs(d) < 0.5) return "same as before"
        return "${if (d > 0) "up" else "down"} ${swiftRounded(abs(d)).toInt()}% on before"
    }
}

/** A status in the shop's words and a tone (shape.ts STATUS, ACCOUNT_STATUS). */
object AdsStatusWords {
    enum class Level { good, idle, warn, bad }

    class Words(val label: String, val tone: Level)

    /** The kit's tone for a status level: good is settled, idle quiet, warn owed, bad a problem. */
    fun tone(l: Level): Tone = when (l) {
        Level.good -> Tone.settled
        Level.idle -> Tone.quiet
        Level.warn -> Tone.owed
        Level.bad -> Tone.problem
    }

    private val objects = mapOf(
        "ACTIVE" to Words("Running", Level.good), "PAUSED" to Words("Paused", Level.idle), "CAMPAIGN_PAUSED" to Words("Campaign paused", Level.idle),
        "ADSET_PAUSED" to Words("Ad set paused", Level.idle), "PENDING_REVIEW" to Words("In review", Level.warn), "IN_PROCESS" to Words("Processing", Level.warn),
        "PREAPPROVED" to Words("Pre-approved", Level.warn), "WITH_ISSUES" to Words("Has issues", Level.bad), "DISAPPROVED" to Words("Rejected", Level.bad),
        "PENDING_BILLING_INFO" to Words("Needs payment info", Level.bad), "ARCHIVED" to Words("Archived", Level.idle), "DELETED" to Words("Deleted", Level.idle),
    )

    fun of(status: String): Words {
        objects[status]?.let { return it }
        val words = if (status.isEmpty()) "unknown" else status.lowercase().replace("_", " ")
        return Words(words.take(1).uppercase() + words.drop(1), Level.idle)
    }

    private val accounts = mapOf(
        1 to Words("Active", Level.good), 2 to Words("Disabled", Level.bad), 3 to Words("Payment due", Level.bad),
        7 to Words("Under risk review", Level.warn), 8 to Words("Settling a payment", Level.warn), 9 to Words("Grace period", Level.warn),
        100 to Words("Closing", Level.bad), 101 to Words("Closed", Level.bad), 201 to Words("Active", Level.good), 202 to Words("Closed", Level.bad),
    )

    fun ofAccount(status: Int): Words = accounts[status] ?: Words("Status $status", Level.idle)

    /** What to do about an account's trouble (shape.ts ACCOUNT_STATUS `fix`). */
    fun accountFix(status: Int): String? = when (status) {
        2 -> "Meta has disabled this ad account. Open Account Quality in Meta Business Suite to see why and request a review."
        3 -> "A payment failed. Settle the balance in Ads Manager → Billing, and ads start again."
        7 -> "Meta is reviewing the account; ads wait until it finishes."
        9 -> "A payment is overdue. Pay it in Ads Manager → Billing before the grace period ends."
        101 -> "This ad account is closed. Choose another one on Setup."
        else -> null
    }
}

/** What the ads achieved, in the shop's words (shape.ts RESULT_FOR_GOAL, actionLabel, headlineActions). */
object AdsResults {
    private class Goal(val label: String, val actions: List<String>, val field: String? = null, val unsure: Boolean = false)

    private val purchases = listOf("omni_purchase", "offsite_conversion.fb_pixel_purchase", "purchase")
    private val profile = listOf("instagram_profile_visit", "ig_profile_visit")
    private val leads = listOf("onsite_conversion.lead_grouped", "lead")

    private val goals = mapOf(
        "CONVERSATIONS" to Goal("Chats started", listOf("onsite_conversion.messaging_conversation_started_7d")),
        "LINK_CLICKS" to Goal("Link clicks", listOf("link_click")),
        "LANDING_PAGE_VIEWS" to Goal("Landing page views", listOf("landing_page_view")),
        "OFFSITE_CONVERSIONS" to Goal("Purchases", purchases),
        "VALUE" to Goal("Purchases", purchases),
        "POST_ENGAGEMENT" to Goal("Post engagement", listOf("post_engagement")),
        "PROFILE_VISIT" to Goal("Profile visits", profile, unsure = true),
        "VISIT_INSTAGRAM_PROFILE" to Goal("Profile visits", profile, unsure = true),
        "THRUPLAY" to Goal("Video plays", listOf("video_view")),
        "LEAD_GENERATION" to Goal("Leads", leads),
        "QUALITY_LEAD" to Goal("Leads", leads),
        "PAGE_LIKES" to Goal("Page likes", listOf("like")),
        "REACH" to Goal("People reached", emptyList(), field = "reach"),
        "IMPRESSIONS" to Goal("Impressions", emptyList(), field = "impressions"),
        "AD_RECALL_LIFT" to Goal("People reached", emptyList(), field = "reach"),
    )

    class Result(val label: String, val value: Double)

    /** The result count and its name for an optimisation goal; null where the goal has none worth showing. */
    fun of(m: AdMetrics, goal: String?): Result? {
        val g = goals[goal ?: return null] ?: return null
        if (g.field != null) return Result(g.label, if (g.field == "reach") m.reach else m.impressions)
        if (g.unsure && g.actions.none { m.actions[it] != null }) return null
        val value = g.actions.fold(0.0) { best, a -> maxOf(best, m.actions[a] ?: 0.0) }
        return Result(g.label, value)
    }

    private val words = mapOf(
        "onsite_conversion.messaging_conversation_started_7d" to "Chats started",
        "onsite_conversion.total_messaging_connection" to "Messaging contacts",
        "onsite_conversion.messaging_first_reply" to "First replies",
        "onsite_conversion.messaging_user_depth_2_message_send" to "Chats with 2+ messages",
        "onsite_conversion.post_save" to "Saves", "onsite_conversion.lead_grouped" to "Leads", "lead" to "Leads",
        "link_click" to "Link clicks", "landing_page_view" to "Landing page views", "post_engagement" to "Post engagement",
        "page_engagement" to "Page engagement", "post_reaction" to "Reactions", "post_interaction_gross" to "Interactions",
        "comment" to "Comments", "post" to "Shares", "like" to "Page likes", "follow" to "Follows", "video_view" to "Video plays",
        "photo_view" to "Photo views", "omni_purchase" to "Purchases", "purchase" to "Purchases",
        "instagram_profile_visit" to "Profile visits", "ig_profile_visit" to "Profile visits",
    )

    fun label(type: String): String {
        words[type]?.let { return it }
        var s = type
        for (p in listOf("onsite_conversion.", "offsite_conversion.", "onsite_web.")) {
            if (s.startsWith(p)) { s = s.removePrefix(p); break }
        }
        s = s.replace(".", " ").replace("_", " ")
        return s.take(1).uppercase() + s.drop(1)
    }

    /** Actions that are part of another (link clicks are also post engagement) are left out of a list. */
    private val headline = listOf(
        "onsite_conversion.messaging_conversation_started_7d", "link_click", "landing_page_view", "instagram_profile_visit",
        "ig_profile_visit", "post_engagement", "post_reaction", "comment", "onsite_conversion.post_save", "post", "follow",
        "video_view", "onsite_conversion.lead_grouped", "omni_purchase",
    )

    class Line(val label: String, val value: Double)

    fun headlineActions(m: AdMetrics, limit: Int = 6): List<Line> {
        val seen = HashSet<String>()
        val out = ArrayList<Line>()
        for (type in headline) {
            val v = m.actions[type] ?: continue
            if (v <= 0) continue
            val name = label(type)
            if (seen.add(name)) out.add(Line(name, v))
        }
        return out.take(limit)
    }

    class Headline(val key: String, val label: String, val value: Double)

    /**
     * The result the account mostly buys: purchases if there are any, then chats, then clicks, then engagement
     * (ads/page.tsx mainAction; purchases lead since 2026-10-16, when a sales account read as link clicks).
     */
    fun headlineResult(m: AdMetrics): Headline {
        for (k in listOf("omni_purchase", "offsite_conversion.fb_pixel_purchase", "onsite_conversion.messaging_conversation_started_7d", "link_click", "instagram_profile_visit", "post_engagement")) {
            val v = m.actions[k]
            if (v != null && v > 0) return Headline(k, label(k), v)
        }
        return Headline("reach", "People reached", m.reach)
    }

    fun value(m: AdMetrics, key: String): Double = if (key == "reach") m.reach else (m.actions[key] ?: 0.0)

    /** Meta's names for one purchase (shape.ts PURCHASE_ACTIONS): the biggest is taken, never their sum. */
    val purchaseActions = listOf("omni_purchase", "offsite_conversion.fb_pixel_purchase", "purchase", "onsite_web_purchase")

    data class Sales(
        val purchases: Double,
        val value: Double,
        /** Sales per rupee spent (Ads Manager's "Purchase ROAS"); null when nothing was spent. */
        val roas: Double?,
        val costPerPurchase: Double?,
    )

    /** Purchases the ads brought and what they were worth (shape.ts salesOf), as Ads Manager's Purchases, conversion value and ROAS columns read them. */
    fun sales(m: AdMetrics): Sales {
        val purchases = purchaseActions.fold(0.0) { b, a -> maxOf(b, m.actions[a] ?: 0.0) }
        val value = purchaseActions.fold(0.0) { b, a -> maxOf(b, m.values[a] ?: 0.0) }
        return Sales(purchases, value, if (m.spend > 0) value / m.spend else null, if (purchases > 0) m.spend / purchases else null)
    }

    /** "5.8×" (shape.ts roasText). */
    fun roasText(r: Double?): String {
        if (r == null || !r.isFinite()) return "—"
        return if (r >= 10) String.format(Locale.US, "%.0f×", r) else String.format(Locale.US, "%.1f×", r)
    }
}

/** Meta's objectives, as the owner would say them (shape.ts objectiveLabel). */
object AdsObjective {
    private val words = mapOf(
        "OUTCOME_AWARENESS" to "Awareness", "OUTCOME_TRAFFIC" to "Traffic", "OUTCOME_ENGAGEMENT" to "Engagement", "OUTCOME_LEADS" to "Leads",
        "OUTCOME_SALES" to "Sales", "OUTCOME_APP_PROMOTION" to "App promotion", "MESSAGES" to "Messages", "LINK_CLICKS" to "Traffic",
        "POST_ENGAGEMENT" to "Engagement", "REACH" to "Reach", "BRAND_AWARENESS" to "Awareness", "CONVERSIONS" to "Sales", "VIDEO_VIEWS" to "Video views",
    )

    fun label(o: String): String {
        words[o]?.let { return it }
        var s = o
        if (s.startsWith("OUTCOME_")) s = s.removePrefix("OUTCOME_")
        s = s.lowercase().replace("_", " ")
        return s.take(1).uppercase() + s.drop(1)
    }
}
