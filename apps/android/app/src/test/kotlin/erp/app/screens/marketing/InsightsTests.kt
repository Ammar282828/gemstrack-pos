package erp.app.screens.marketing

import erp.core.Json
import java.time.LocalDate
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Insights' answers, words and rules (Insights.swift): what the three screens read and how they choose what to show. */
class InsightsTests {
    private fun parse(text: String) = Json.parse(text)

    // MARK: Answers

    @Test fun theOverviewReadsItsAccountsTotalsAndHistory() {
        val d = InsightsOverview.from(
            parse(
                """{"instagram":{"account":{"username":"example.studio","followers":"12480"},"totals":{"reach":48200,"views":"131500","odd":"x"},
                    "previous":{"reach":41000},"reach":{"ads":18400,"organic":36100,"adsShare":0.34,"bySurface":[{"key":"REEL","value":21000}]},
                    "nonFollowerReach":0.62,"follows":{"follows":310,"unfollows":120,"net":190},"daily":[{"date":"2026-10-01","reach":900},{"date":"2026-10-02","reach":1100}]},
                   "facebook":{"page":{"name":"Example Studio","followers":3920},"totals":{"page_media_view":22400},"daily":[{"date":"2026-10-01","views":300}]},
                   "paid":{"now":[{"platform":"instagram","metrics":{"spend":42000,"impressions":52000}}],"before":[{"platform":"instagram","metrics":{"spend":35000}}]},
                   "history":[{"date":"2026-10-01","igFollowers":12290},{"date":"2026-10-02"},{"date":"2026-10-03","igFollowers":12300}],
                   "currency":"PKR","since":"2026-09-17","until":"2026-10-14","previous":{"since":"2026-08-20","until":"2026-09-16"},"at":"2026-10-14T11:20:00+05:00"}""",
            ),
        )!!
        val ig = d.instagram!!
        assertEquals("example.studio", ig.username)
        assertEquals(12480.0, ig.followers)
        // A value that is not a number is left out, one that reads as a number is kept.
        assertEquals(mapOf("reach" to 48200.0, "views" to 131500.0), ig.totals)
        assertEquals(36100.0, ig.reach!!.organic)
        assertEquals(0.34, ig.reach!!.adsShare)
        assertEquals("REEL", ig.reach!!.bySurface.single().key)
        assertNull(ig.views)
        assertEquals(190.0, ig.follows!!.net)
        assertEquals(listOf(900.0, 1100.0), ig.daily.map { it.value })
        assertEquals("Example Studio", d.facebook!!.name)
        assertEquals(42000.0, d.paid.single().metrics.spend)
        assertEquals(35000.0, d.paidBefore.single().metrics.spend)
        // A day without a follower count is not a point on the line.
        assertEquals(listOf("2026-10-01", "2026-10-03"), d.followerDays.map { it.date })
        assertEquals("2026-08-20", d.beforeSince)
        assertEquals("PKR", d.currency)
    }

    @Test fun anEmptyOverviewIsStillAnOverview() {
        val d = InsightsOverview.from(parse("{}"))!!
        assertNull(d.instagram)
        assertNull(d.facebook)
        assertEquals("PKR", d.currency)
        assertTrue(d.paid.isEmpty())
    }

    @Test fun theFindingsPartIsAListOfTonedLines() {
        val f = InsightFinding.list(parse("""{"findings":[{"tone":"good","title":"A","why":"b"},{"title":"C"}]}"""))
        assertEquals(listOf("good", "info"), f.map { it.tone })
        assertEquals("b", f[0].why)
        assertTrue(InsightFinding.list(null).isEmpty())
    }

    @Test fun aPostKeepsOnlyTheFiguresMetaGave() {
        val p = InsightPost.from(parse("""{"id":"p1","kind":"reel","at":"2026-10-12T18:30:00+05:00","caption":"Words","views":21400,"reach":"9800","rate":0.07,"avgWatchMs":6400,"older":true}"""))!!
        assertEquals(21400.0, p.views)
        assertEquals(9800.0, p.reach)
        assertNull(p.saves)
        assertTrue(p.older)
        val stats = InsightsLogic.stats(p).toMap()
        assertEquals("21.4k", stats["Views"])
        assertEquals("—", stats["Likes"])
        assertEquals("7.0%", stats["Rate"])
        assertEquals("6.4s", stats["Avg watch"])
        assertFalse(stats.containsKey("Saves"))
    }

    @Test fun theAudienceReadsItsThreeGroupsAndTheHours() {
        val a = InsightsAudience.from(
            parse("""{"audience":{"followers":{"age":[{"key":"25-34","value":41}],"gender":[{"key":"F","value":78}]},"reached":{"city":[{"key":"Karachi","value":5}]},"online":[0,1,"2"]}}"""),
        )!!
        assertEquals("25-34", a.followers!!.age.single().key)
        assertEquals(listOf("Karachi"), a.reached!!.city.map { it.key })
        assertNull(a.engaged)
        assertEquals(listOf(0.0, 1.0, 2.0), a.online)
        assertNull(InsightsAudience.from(parse("{}"))!!.followers)
    }

    // MARK: Words and rules

    @Test fun theRangeIsItsOwnAndInstagramStopsAtThirtyDays() {
        assertEquals(listOf("last_7d", "last_14d", "last_28d", "this_month"), InsightRange.all.map { it.key })
        assertEquals("Last 28 days", InsightRange.label("last_28d"))
        assertEquals("last_90d", InsightRange.label("last_90d"))
        assertEquals("/api/insights?part=overview&range=last_28d", InsightRange.path("overview", "last_28d", false))
        assertEquals("/api/insights?part=posts&range=this_month&fresh=1", InsightRange.path("posts", "this_month", true))
    }

    @Test fun onlyOwnersAndMarketingRead() {
        assertTrue(InsightsLogic.mayRead("owner"))
        assertTrue(InsightsLogic.mayRead("marketing"))
        assertFalse(InsightsLogic.mayRead("staff"))
        assertFalse(InsightsLogic.mayRead("none"))
    }

    @Test fun hoursAreSaidOnAClock() {
        assertEquals("12am", InsightWords.hour(0))
        assertEquals("9am", InsightWords.hour(9))
        assertEquals("12pm", InsightWords.hour(12))
        assertEquals("5pm", InsightWords.hour(17))
        assertEquals("11pm", InsightWords.hour(23))
    }

    @Test fun postsAreFilteredByKindAndSorted() {
        val d = InsightsDemo.posts(LocalDate.parse("2026-10-14"))
        val all = InsightsLogic.shown(d, "all", "at")
        assertEquals(6, all.size)
        // Newest first: the live story of today leads.
        assertEquals("s1", all.first().id)
        assertEquals(listOf("p1", "p5"), InsightsLogic.shown(d, "reel", "at").map { it.id })
        assertEquals(listOf("p5"), InsightsLogic.shown(d, "older", "views").map { it.id })
        assertEquals(listOf("s1"), InsightsLogic.shown(d, "story", "at").map { it.id })
        // By a figure: highest first.
        val byViews = InsightsLogic.shown(d, "all", "views").map { it.views }
        assertEquals(byViews.sortedByDescending { it }, byViews)
        // A post that has no figure goes last, not first.
        val saves = InsightsLogic.shown(d, "all", "saves")
        assertNull(saves.last().saves)
    }

    @Test fun aBreakdownShowsItsTopEightAsShares() {
        val parts = (1..10).map { InsightPart("k$it", it.toDouble()) }
        val (top, biggest) = InsightsLogic.topShares(parts)
        assertEquals(8, top.size)
        assertEquals("k10", top.first().key)
        assertEquals(10.0, biggest)
        // Shares are of the whole (55), not of the eight shown.
        assertEquals(18, top.first().percent)
        val (none, one) = InsightsLogic.topShares(emptyList())
        assertTrue(none.isEmpty())
        assertEquals(1.0, one)
    }

    @Test fun followsAndLinkTapsAreSaidShortly() {
        assertEquals("+190 · 310 in, 120 out", InsightsLogic.followsLine(InsightFollows(310.0, 120.0, 190.0)))
        assertEquals("−5 · 10 in, 15 out", InsightsLogic.followsLine(InsightFollows(10.0, 15.0, -5.0)))
        assertEquals("8.0% of visits", InsightsLogic.linkShare(mapOf("profile_views" to 2300.0, "website_clicks" to 184.0)))
        assertNull(InsightsLogic.linkShare(mapOf("website_clicks" to 4.0)))
        assertEquals(34, InsightsLogic.percentOf(0.34))
        assertEquals("34.0%", InsightWords.percent(0.34))
        assertEquals("—", InsightWords.percent(null))
    }

    @Test fun theDemoAnswersAreWholeAndDatedFromTheClock() {
        val today = LocalDate.parse("2026-10-14")
        val o = InsightsDemo.overview(today)
        assertEquals("2026-10-14", o.until)
        assertEquals(28, o.instagram!!.daily.size)
        assertEquals("2026-09-17", o.instagram!!.daily.first().date)
        assertTrue(InsightsDemo.findings().isNotEmpty())
        assertEquals(24, InsightsDemo.audience().online!!.size)
    }
}
