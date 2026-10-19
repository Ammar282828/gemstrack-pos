package erp.app.screens.marketing

import erp.app.screens.ads.AdMetrics
import java.time.LocalDate

/**
 * Insights in the demo, which has no server (CONVENTIONS.md rule 13): a made-up Instagram, Facebook and paid month,
 * dated back from [today] so a baseline does not age. Names and numbers are invented.
 */
object InsightsDemo {
    private fun days(today: LocalDate, n: Int, f: (Int) -> Double): List<InsightDay> =
        (0 until n).map { InsightDay(today.minusDays((n - 1 - it).toLong()).toString(), f(it)) }

    fun overview(today: LocalDate): InsightsOverview {
        val ig = InstagramInsight(
            username = "example.studio", followers = 12_480.0,
            totals = mapOf(
                "reach" to 48_200.0, "views" to 131_500.0, "accounts_engaged" to 3_940.0, "total_interactions" to 6_210.0, "likes" to 4_820.0,
                "comments" to 310.0, "shares" to 520.0, "saves" to 560.0, "replies" to 44.0, "profile_views" to 2_300.0, "website_clicks" to 184.0,
            ),
            previous = mapOf("reach" to 41_000.0, "views" to 140_200.0, "accounts_engaged" to 3_900.0, "profile_views" to 2_100.0),
            reach = InsightSplit(18_400.0, 36_100.0, 0.34, listOf(InsightPart("REEL", 21_000.0), InsightPart("POST", 9_800.0), InsightPart("AD", 18_400.0), InsightPart("STORY", 5_300.0))),
            views = InsightSplit(52_000.0, 79_500.0, 0.4, listOf(InsightPart("REEL", 60_000.0), InsightPart("AD", 52_000.0), InsightPart("POST", 19_500.0))),
            interactions = InsightSplit(900.0, 5_310.0, 0.14, listOf(InsightPart("POST", 3_200.0), InsightPart("REEL", 2_100.0), InsightPart("AD", 900.0))),
            nonFollowerReach = 0.62, follows = InsightFollows(310.0, 120.0, 190.0), previousFollows = InsightFollows(260.0, 140.0, 120.0),
            daily = days(today, 28) { 900.0 + (it * 53 % 17) * 120 + if (it % 7 == 5) 1_400 else 0 },
        )
        val fb = FacebookInsight(
            name = "Example Studio", followers = 3_920.0,
            totals = mapOf(
                "page_daily_follows_unique" to 44.0, "page_daily_unfollows_unique" to 9.0, "page_media_view" to 22_400.0, "page_total_media_view_unique" to 9_100.0,
                "page_post_engagements" to 810.0, "page_views_total" to 420.0,
            ),
            previous = mapOf("page_media_view" to 19_900.0, "page_post_engagements" to 860.0, "page_views_total" to 400.0),
            daily = days(today, 28) { 300.0 + (it * 37 % 11) * 60 },
        )
        fun m(spend: Double, reach: Double, views: Double, clicks: Double) = AdMetrics(spend = spend, reach = reach, impressions = views, linkClicks = clicks, actions = mapOf("link_click" to clicks, "onsite_conversion.messaging_conversation_started_7d" to 24.0))
        return InsightsOverview(
            instagram = ig, facebook = fb,
            paid = listOf(InsightPlatform("instagram", m(42_000.0, 18_400.0, 52_000.0, 160.0)), InsightPlatform("facebook", m(9_500.0, 5_600.0, 14_000.0, 41.0))),
            paidBefore = listOf(InsightPlatform("instagram", m(35_000.0, 15_000.0, 44_000.0, 120.0)), InsightPlatform("facebook", m(9_900.0, 5_800.0, 14_400.0, 44.0))),
            followerDays = days(today, 28) { 12_290.0 + it * 7 },
            currency = "PKR", since = today.minusDays(27).toString(), until = today.toString(),
            beforeSince = today.minusDays(55).toString(), beforeUntil = today.minusDays(28).toString(), at = today.toString() + "T11:20:00+05:00",
        )
    }

    fun findings(): List<InsightFinding> = listOf(
        InsightFinding("good", "Reels are carrying the reach", "Reels reached 21,000 accounts, more than twice the photo posts. Keep two a week."),
        InsightFinding("warn", "Link taps are low for the visits", "Of 2,300 profile visits, 184 tapped the link. The bio's link may need a clearer line."),
        InsightFinding("info", "Most of the reach is new people", "62% of the accounts reached were not following yet."),
    )

    fun posts(today: LocalDate): InsightsPosts {
        fun post(id: String, kind: String, ago: Int, caption: String, views: Double, reach: Double, rate: Double, older: Boolean = false) = InsightPost(
            id = id, platform = if (kind == "fb") "facebook" else "instagram", kind = kind, at = today.minusDays(ago.toLong()).toString() + "T18:30:00+05:00", caption = caption,
            thumb = null, link = "https://www.example.test/p/$id", reach = reach, views = views, likes = reach / 9, comments = reach / 160, shares = reach / 60,
            saves = if (kind == "fb") null else reach / 50, interactions = reach * rate, profileVisits = if (kind == "reel") reach / 40 else null, follows = if (kind == "reel") 14.0 else null,
            avgWatchMs = if (kind == "reel") 6_400.0 else null, facebookViews = null, clicks = if (kind == "fb") 31.0 else null, replies = null, rate = rate, older = older,
        )
        return InsightsPosts(
            posts = listOf(
                post("p1", "reel", 2, "A made-up reel about a new ring.", 21_400.0, 9_800.0, 0.071),
                post("p2", "post", 5, "A made-up photo of a pendant.", 6_100.0, 3_900.0, 0.052),
                post("p3", "carousel", 9, "A made-up carousel of bangles.", 8_800.0, 5_100.0, 0.064),
                post("p4", "fb", 12, "A made-up page post.", 2_300.0, 1_400.0, 0.031),
                post("p5", "reel", 40, "An older reel still earning.", 12_000.0, 4_200.0, 0.044, older = true),
            ),
            stories = listOf(post("s1", "story", 0, "", 1_900.0, 1_600.0, 0.02)),
            live = setOf("s1"), lastPostAt = today.minusDays(2).toString() + "T18:30:00+05:00",
        )
    }

    fun audience(): InsightsAudience {
        fun dims(scale: Double) = InsightDims(
            age = listOf(InsightPart("18-24", 22 * scale), InsightPart("25-34", 41 * scale), InsightPart("35-44", 24 * scale), InsightPart("45-54", 9 * scale), InsightPart("55-64", 4 * scale)),
            gender = listOf(InsightPart("F", 78 * scale), InsightPart("M", 21 * scale), InsightPart("U", 1 * scale)),
            city = listOf(InsightPart("Karachi", 52 * scale), InsightPart("Lahore", 18 * scale), InsightPart("Islamabad", 9 * scale), InsightPart("Dubai", 6 * scale)),
            country = listOf(InsightPart("PK", 88 * scale), InsightPart("AE", 6 * scale), InsightPart("GB", 3 * scale), InsightPart("US", 2 * scale)),
        )
        return InsightsAudience(dims(120.0), dims(80.0), dims(20.0), List(24) { h -> if (h in 18..22) 70.0 + h else 10.0 + h })
    }
}
