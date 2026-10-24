package erp.app.screens.marketing

import erp.core.ERPDate
import java.time.Instant

/**
 * The Website pages in the demo, which has no server (CONVENTIONS.md rule 13): made-up pieces, collections, weights and
 * gold posts, dated from the clock so a baseline does not age. Names and times are invented.
 */
object WebsiteDemo {
    fun settings(house: String): WebsiteSettings = WebsiteSettings(
        site = "https://www.example.test", siteName = "example.test", featured = house == "taheri",
        weights = house == "taheri", edit = true, investments = house == "taheri",
    )

    fun featured(house: String): WebsiteFeatured? =
        if (house == "taheri") WebsiteFeatured("Rings/R-102.webp", "Our newest eternity band.", "Rings", "R-102", "") else null

    val collections: List<WebsiteCollection> = listOf(
        WebsiteCollection("Rings", "Rings", 48, "Rings/Rings", null),
        WebsiteCollection("Solitaire", "Rings", 21, "Rings/Solitaire", "/rings/solitaire"),
        WebsiteCollection("Jhumki", "Earrings", 33, "Earrings/Jhumki", null),
        WebsiteCollection("Studs", "Earrings", 0, "Earrings/Studs", null),
        WebsiteCollection("Kara", "Bangles", 17, "Bangles/Kara", null),
        WebsiteCollection("Drops", "Pendants", 12, "Pendants/Drops", null),
    )

    private fun piece(
        id: String, name: String, collection: String, grams: Double?, hidden: Boolean = false, tags: Boolean = true,
        photo: Boolean = false, words: Boolean = false, at: String? = null,
    ): WebsiteEditPiece {
        val own = WebsiteWords(name = name, about = "A made-up piece for the demo.", facts = if (tags) emptyList() else listOf("Stone: Emerald", "Setting: Prong"), stone = if (tags) "Diamond" else "", metal = if (tags) "Gold" else "", karat = if (tags) "18k" else "", cut = if (tags) "Round" else "", style = if (tags) "Classic" else "")
        val keys = buildSet {
            if (photo) add("photo")
            if (words) add("name")
            if (grams != null && tags) add("weightGrams")
        }
        return WebsiteEditPiece(
            id = id, name = name, url = "https://www.example.test/${id.lowercase()}", image = "", thumb = "", collection = collection,
            weightGrams = grams, weightOnPhoto = false, facts = own.facts, imagePath = null, source = if (tags) "attributes" else "pieces",
            own = own, words = own, change = if (keys.isEmpty()) null else WebsiteEditChange(keys, photo, at, if (tags) grams else null, false),
            hidden = hidden, photoSource = null, sourceMarked = false,
        )
    }

    fun edits(house: String, now: Instant): WebsiteEditsAnswer {
        val tags = house == "taheri"
        val at = ERPDate.iso(now.minusSeconds(3 * 3600))
        val pieces = listOf(
            piece("Rings/R-101.webp", "Solitaire ring", "Rings", 4.2, tags = tags, photo = true, at = at),
            piece("Rings/R-102.webp", "Eternity band", "Rings", 3.1, tags = tags),
            piece("Earrings/E-201.webp", "Jhumka pair", "Earrings", 11.8, tags = tags, words = true, at = at),
            piece("Bangles/B-301.webp", "Kara bangle", "Bangles", 24.5, hidden = true, tags = tags, at = at),
            piece("Pendants/P-401.webp", "Drop pendant", "Pendants", 5.6, tags = tags),
            piece("Rings/R-103.webp", "Signet ring", "Rings", null, tags = tags),
        )
        val recent = listOf(
            WebsiteEditRecent("Rings/R-101.webp", "Solitaire ring", listOf("new photo"), "owner@example.test", at),
            WebsiteEditRecent("Bangles/B-301.webp", "Kara bangle", listOf("hidden"), "counter", ERPDate.iso(now.minusSeconds(26 * 3600))),
        )
        return WebsiteEditsAnswer("https://www.example.test", pieces, recent)
    }

    fun weights(): List<WebsiteWeightPiece> = listOf(
        WebsiteWeightPiece("Rings/Solitaire/R-101.webp", "Rings", "R-101.webp", "", null, null, null, null, null),
        WebsiteWeightPiece("Rings/Solitaire/R-102.webp", "Rings", "R-102.webp", "", null, null, null, null, null),
        WebsiteWeightPiece("Rings/Solitaire/R-103.webp", "Rings", "R-103.webp", "", 7.0, "pos", null, "counter", null),
        WebsiteWeightPiece("Earrings/Jhumki/E-201.webp", "Earrings", "E-201.webp", "", null, "label", 11.8, null, null).copy(weightGrams = 11.8),
        WebsiteWeightPiece("Bangles/Kara/B-301.webp", "Bangles", "B-301.webp", "", null, null, null, null, null),
        WebsiteWeightPiece("Pendants/Drops/P-401.webp", "Pendants", "P-401.webp", "", null, null, null, null, null),
    )

    /** A tray the demo opens with (nothing can be picked without a phone's Photos): one waiting, one that failed, one sent. */
    fun tray(): List<WebsitePhotoItem> {
        val jpg = MarketingPhotos.Kind("jpg", "image/jpeg")
        return listOf(
            WebsitePhotoItem("demo-1", ByteArray(4_404_019), jpg, null, "IMG-20261012-130000-1a1a"),
            WebsitePhotoItem("demo-2", ByteArray(839_680), jpg, null, "IMG-20261012-130010-2b2b", status = WebsitePhotoItem.Status.Failed, error = "The ERP answered 500."),
            WebsitePhotoItem("demo-3", ByteArray(1_572_864), jpg, null, "IMG-20261012-130020-3c3c", status = WebsitePhotoItem.Status.Done, rel = "Rings/Solitaire/IMG-20261012-130020-3c3c.webp"),
        )
    }

    fun targets(): List<WebsiteGoldStatus.Target> = listOf(
        WebsiteGoldStatus.Target("group", "Post + square card", "the Investments group"),
        WebsiteGoldStatus.Target("channel", "Post + square card", "the Investments channel"),
        WebsiteGoldStatus.Target("teaser", "Teaser", "the community's announcements"),
        WebsiteGoldStatus.Target("instagram", "Story card", "Instagram"),
    )

    fun gold(now: Instant): Triple<WebsiteGoldAnswer, WebsiteGoldSchedule, WebsiteGoldStatus> {
        val today = ERPDate.karachiDay(now)
        fun day(back: Long) = ERPDate.karachiDay(now.minusSeconds(back * 86_400))
        fun post(back: Long, headline: String, sent: Map<String, WebsiteGoldPost.Went>, hold: Boolean = false) = WebsiteGoldPost(
            id = day(back), date = day(back), post = "*$headline*\nA made-up rate line for the demo.\n_Not advice._", teaser = "A made-up teaser for the demo.",
            cards = listOf("square", "story"), receivedAt = ERPDate.iso(now.minusSeconds(back * 86_400 + 2 * 3600)), source = "routine", editedAt = null,
            sent = sent, hold = hold, approvedAt = null,
        )
        val went = { hours: Long, by: String -> WebsiteGoldPost.Went(ERPDate.iso(now.minusSeconds(hours * 3600)), by) }
        val posts = listOf(
            post(0, "Gold holds steady", mapOf("group" to went(1, "schedule"))),
            post(1, "Gold eases a little", targets().associate { it.id to went(25, "schedule") }),
            post(2, "Gold rises on the week", mapOf("group" to went(49, "owner@example.test"), "teaser" to went(48, "schedule")), hold = false),
        )
        val schedule = WebsiteGoldSchedule(
            enabled = true, days = listOf(1, 2, 3, 4, 5, 6), mode = "auto", targets = WebsiteGoldSchedule.defaults,
            lateUntil = "20:00", updatedBy = "owner@example.test", lastTick = ERPDate.iso(now.minusSeconds(120)),
        )
        val status = WebsiteGoldStatus(
            today = today, enabled = true, mode = "auto", lastTick = schedule.lastTick, targets = targets(), dayId = today,
            parts = mapOf(
                "group" to WebsiteGoldStatus.Part("sent", "Sent 1 h ago", "ok"),
                "teaser" to WebsiteGoldStatus.Part("waiting", "Goes at 12:00 pm", "muted"),
            ),
        )
        return Triple(WebsiteGoldAnswer(posts, today), schedule, status)
    }

    // MARK: The site's report, Live and the piece rankings (made-up, as everything here)

    private fun cnt(vararg p: Pair<String, Int>) = p.map { SiteCount(it.first, it.second) }

    /** A summary of [n] sessions: the same made-up shares at any size, so the periods compare. */
    private fun summary(n: Int, better: Double = 1.0): SiteSummary {
        fun k(x: Double) = (n * x * better).toInt()
        fun share(list: List<Pair<String, Double>>) = list.map { SiteCount(it.first, (n * it.second).toInt()) }.filter { it.value > 0 }
        val enquire = k(0.045)
        return SiteSummary(
            sessions = n, visitors = (n * 0.78).toInt(), pageviews = (n * 3.4).toInt(), bounces = (n * 0.38).toInt(), durMs = n * 154_000.0,
            newSessions = (n * 0.7).toInt(), returningSessions = (n * 0.3).toInt(), newVisitors = (n * 0.55).toInt(), bounceRate = 0.38, avgSessionMs = 154_000.0 * better,
            pagesPerSession = 3.4, funnel = SiteFunnel(n, k(0.52), k(0.12), enquire), conversion = if (n > 0) enquire.toDouble() / n else 0.0,
            sources = listOf(
                SiteSource("direct", "direct", "Direct", (n * 0.34).toInt(), k(0.2), k(0.04), k(0.015)),
                SiteSource("paid:Instagram", "paid", "Instagram", (n * 0.26).toInt(), k(0.16), k(0.04), k(0.018)),
                SiteSource("search:Google", "search", "Google", (n * 0.18).toInt(), k(0.09), k(0.02), k(0.008)),
                SiteSource("social:Facebook", "social", "Facebook", (n * 0.1).toInt(), k(0.04), k(0.008), k(0.003)),
                SiteSource("referral:example-blog.test", "referral", "example-blog.test", (n * 0.07).toInt(), k(0.03), k(0.005), 0),
                SiteSource("email", "email", "Email", (n * 0.05).toInt(), k(0.02), k(0.004), k(0.001)),
            ).filter { it.sessions > 0 },
            channels = share(listOf("direct" to 0.34, "paid" to 0.26, "search" to 0.18, "social" to 0.1, "referral" to 0.07, "email" to 0.05)),
            campaigns = listOf(SiteCampaign("eid-rings", (n * 0.14).toInt(), k(0.09), k(0.02), k(0.011)), SiteCampaign("gold-rate", (n * 0.06).toInt(), k(0.03), k(0.005), k(0.002))).filter { it.value > 0 },
            countries = share(listOf("PK" to 0.7, "AE" to 0.12, "GB" to 0.08, "US" to 0.06, "SA" to 0.04)),
            cities = listOf(
                SiteCity("PK", "Sindh", "Karachi", (n * 0.42).toInt()), SiteCity("PK", "Punjab", "Lahore", (n * 0.16).toInt()),
                SiteCity("PK", "Islamabad", "Islamabad", (n * 0.06).toInt()), SiteCity("AE", "Dubai", "Dubai", (n * 0.08).toInt()),
            ).filter { it.sessions > 0 },
            devices = share(listOf("mobile" to 0.82, "desktop" to 0.15, "tablet" to 0.03)),
            os = share(listOf("Android" to 0.6, "iOS" to 0.27, "Windows" to 0.1, "macOS" to 0.03)),
            browsers = share(listOf("Chrome" to 0.5, "Instagram" to 0.2, "Safari" to 0.15, "Facebook" to 0.1, "Samsung Internet" to 0.05)),
            landing = share(listOf("/" to 0.4, "/rings/solitaire" to 0.2, "/earrings/jhumki" to 0.15, "/bangles/kara" to 0.1)),
            exits = share(listOf("/" to 0.25, "/rings/solitaire/r-101" to 0.2, "/contact" to 0.12)),
            pages = share(listOf("/" to 1.1, "/rings/solitaire" to 0.7, "/earrings/jhumki" to 0.5, "/rings/solitaire/r-101" to 0.4, "/bangles/kara" to 0.3)),
            collections = share(listOf("/rings/solitaire" to 0.7, "/earrings/jhumki" to 0.5, "/bangles/kara" to 0.3)),
            notFound = share(listOf("/rings/old-piece" to 0.01)),
            searches = share(listOf("eternity band" to 0.03, "jhumka" to 0.02, "ring size 14" to 0.01)),
        )
    }

    /** The report for a period, dated back from [now] (Karachi's day) so a baseline does not age. */
    fun siteReport(range: String, now: Instant, customFrom: String = "", customTo: String = ""): SiteReport {
        val today = java.time.LocalDate.parse(ERPDate.karachiDay(now))
        val (from, to) = when (range) {
            "today" -> today to today
            "yesterday" -> today.minusDays(1) to today.minusDays(1)
            "7d" -> today.minusDays(6) to today
            "90d" -> today.minusDays(89) to today
            "all" -> today.minusDays(51) to today
            "custom" -> (runCatching { java.time.LocalDate.parse(customFrom) }.getOrNull() ?: today.minusDays(29)) to (runCatching { java.time.LocalDate.parse(customTo) }.getOrNull() ?: today)
            else -> today.minusDays(29) to today
        }
        val days = (java.time.temporal.ChronoUnit.DAYS.between(from, to) + 1).toInt()
        val prevTo = from.minusDays(1)
        val prevFrom = prevTo.minusDays(days - 1L)
        val series = (0 until days).map { i ->
            val s = 40 + (i * 37 % 23) * 3 + if (i % 7 == 5) 30 else 0
            SiteDay(from.plusDays(i.toLong()).toString(), s, (s * 0.78).toInt(), (s * 3.4).toInt(), (s * 0.045).toInt() + (i % 3))
        }
        val sessions = series.sumOf { it.sessions }
        val hours = if (days == 1) (0..23).map { h -> SiteHour(h, if (h in 9..22) 4 + (h * 7 % 9) else h % 3, if (h in 9..22) 3 + (h * 5 % 8) else h % 2) } else null
        return SiteReport(
            range = range, from = from.toString(), to = to.toString(), days = days, previous = SitePeriodRange(prevFrom.toString(), prevTo.toString()),
            today = today.toString(), since = "2026-10-23", visitorsExact = days == 1, now = summary(if (hours != null) hours.sumOf { it.sessions } else sessions),
            before = summary(if (hours != null) hours.sumOf { it.before } else (sessions * 0.86).toInt(), better = 0.9), series = if (days == 1) emptyList() else series, hours = hours,
        )
    }

    fun live(): SiteLive = SiteLive(
        at = 0.0, visitors = 7, newVisitors = 4,
        pages = cnt("/" to 3, "/rings/solitaire" to 2, "/earrings/jhumki/e-201" to 1, "/bangles/kara" to 1),
        countries = cnt("PK" to 5, "AE" to 1, "GB" to 1),
        cities = cnt("PK|Sindh|Karachi" to 3, "PK|Punjab|Lahore" to 1, "AE|Dubai|Dubai" to 1),
        sources = cnt("paid:Instagram" to 3, "direct" to 2, "search:Google" to 1, "social:Facebook" to 1),
        devices = cnt("mobile" to 6, "desktop" to 1),
        sessions = listOf(
            SiteLiveVisit("/rings/solitaire/r-101", "piece", "PK", "Sindh", "Karachi", "mobile", "Instagram", "paid:Instagram", true, 4, 185_000.0, 20_000.0),
            SiteLiveVisit("/", "home", "PK", "Punjab", "Lahore", "mobile", "Chrome", "direct", false, 2, 62_000.0, 75_000.0),
            SiteLiveVisit("/earrings/jhumki/e-201", "piece", "AE", "Dubai", "Dubai", "mobile", "Safari", "search:Google", true, 6, 410_000.0, 130_000.0),
            SiteLiveVisit("/bangles/kara", "collection", "GB", "", "", "desktop", "Chrome", "social:Facebook", true, 1, 0.0, 240_000.0),
        ),
        today = SiteLiveToday(sessions = 96, visitors = 74, pageviews = 331, enquiries = 5, saves = 12, pieces = 51, conversion = 0.052, bounceRate = 0.37, avgSessionMs = 148_000.0),
    )

    fun interest(): List<WebsiteInterestPiece> = listOf(
        WebsiteInterestPiece("Rings/R-101.webp", "Solitaire ring", "", "https://www.example.test/rings/r-101", "Rings", 210, 41, 3, 38, 9, 960_000.0, 24, 40_000.0),
        WebsiteInterestPiece("Earrings/E-201.webp", "Jhumka pair", "", "https://www.example.test/earrings/e-201", "Earrings", 168, 29, 2, 27, 6, 1_240_000.0, 20, 62_000.0),
        WebsiteInterestPiece("Bangles/B-301.webp", "Kara bangle", "", "https://www.example.test/bangles/b-301", "Bangles", 133, 17, 1, 16, 4, 540_000.0, 12, 45_000.0),
        WebsiteInterestPiece("Pendants/P-401.webp", "Drop pendant", "", "https://www.example.test/pendants/p-401", "Pendants", 96, 11, 0, 11, 2, 300_000.0, 5, 60_000.0),
        WebsiteInterestPiece("Rings/R-102.webp", "Eternity band", "", "https://www.example.test/rings/r-102", "Rings", 74, 6, 1, 5, 3, 90_000.0, 2, 45_000.0),
    )
}
