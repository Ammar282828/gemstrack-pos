package erp.app.screens.marketing

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The site report's words, rows and rankings (WebsiteAnalyticsKit.swift, WebsiteInterest.swift; site-kit.tsx on the web). */
class SiteReportTests {
    @Test
    fun sourcesAreNamedAsTheWebNamesThem() {
        assertEquals("Direct", SiteWords.source("direct"))
        assertEquals("Instagram ads", SiteWords.source("paid:Instagram"))
        assertEquals("Google search", SiteWords.source("search:Google"))
        assertEquals("Facebook", SiteWords.source("social:Facebook"))
        assertEquals("Other sites", SiteWords.channel("referral"))
        assertEquals("Ads", SiteWords.channel("paid"))
    }

    @Test
    fun pagesDevicesAndPlacesRead() {
        assertEquals("Front page", SiteWords.page("/"))
        assertEquals("rings-bands › band-147", SiteWords.page("/rings-bands/band-147"))
        assertEquals("Phone", SiteWords.device("mobile"))
        assertEquals("Computer", SiteWords.device("desktop"))
        assertEquals("Pakistan", SiteWords.countryName("PK"))
        assertEquals("Unknown", SiteWords.countryName("??"))
        assertEquals("🇵🇰", SiteWords.flag("PK"))
        assertEquals("🌐", SiteWords.flag(""))
    }

    @Test
    fun sharesAndDurations() {
        assertEquals("12%", SiteWords.pct(0.12))
        assertEquals("4.5%", SiteWords.pct(0.045, 1))
        // A share under 10% keeps a decimal at zero digits, as the web's `pct`.
        assertEquals("5.0%", SiteWords.pct(0.05))
        assertEquals("0s", SiteWords.duration(0.0))
        assertEquals("45s", SiteWords.duration(45_000.0))
        assertEquals("3m 20s", SiteWords.duration(200_000.0))
        assertEquals("1h 5m", SiteWords.duration(3_900_000.0))
        assertEquals("9 Oct → 12 Oct", SiteWords.span("2026-10-09", "2026-10-12"))
        assertEquals("9 Oct", SiteWords.span("2026-10-09", "2026-10-09"))
        assertEquals("now", SiteWords.ago(59_000.0))
        assertEquals("3m ago", SiteWords.ago(180_000.0))
        assertEquals("1 page", SiteWords.pages(1))
        assertEquals("2 pages", SiteWords.pages(2))
        assertEquals("1m 20s", SiteWords.secs(80_000.0))
        assertEquals("45s", SiteWords.secs(45_000.0))
    }

    @Test
    fun aFigureMovesAgainstThePeriodBefore() {
        assertNull(SiteDeltaLogic.change(10.0, 0.0))
        assertTrue(SiteDeltaLogic.same(100.0, 100.2))
        assertNull(SiteDeltaLogic.change(100.0, 100.2))
        val up = SiteDeltaLogic.change(150.0, 100.0)!!
        assertTrue(up.up && up.good)
        assertEquals("50%", up.text)
        // Bounce rate: down is good.
        val down = SiteDeltaLogic.change(0.3, 0.4, invert = true)!!
        assertTrue(!down.up && down.good)
        assertEquals("25%", down.text)
        assertEquals("3.5×", SiteDeltaLogic.change(350.0, 100.0)!!.text)
        assertEquals("12×", SiteDeltaLogic.change(1200.0, 100.0)!!.text)
        assertEquals("down 25% on the period before", down.spoken)
    }

    @Test
    fun citiesAreFlatWithWhatIsLeftOverOfACountry() {
        val countries = listOf(SiteCount("PK", 100), SiteCount("AE", 12), SiteCount("GB", 5))
        val cities = listOf(SiteCity("PK", "Sindh", "Karachi", 60), SiteCity("PK", "Punjab", "Lahore", 20))
        val rows = SiteRanks.cityRows(countries, cities)
        assertEquals(listOf("Karachi", "Lahore", "Other cities", "United Arab Emirates", "United Kingdom"), rows.map { it.label })
        assertEquals("Sindh, Pakistan", rows[0].sub)
        // 100 in Pakistan, 80 of them in listed cities.
        assertEquals(20, rows.first { it.id == "other/PK" }.value)
        // A country with no city known is itself a row, no "Other cities".
        assertEquals(12, rows.first { it.id == "country/AE" }.value)
    }

    @Test
    fun sourcesSaySoWhenSomeoneAsked() {
        val rows = SiteRanks.sourceRows(listOf(SiteSource("paid:Instagram", "paid", "Instagram", 50, 20, 5, 3), SiteSource("direct", "direct", "Direct", 30, 10, 1, 0)))
        assertEquals("3 asked", rows[0].sub)
        assertNull(rows[1].sub)
    }

    @Test
    fun theLiveCitiesReadTheirKeys() {
        val live = SiteLive(cities = listOf(SiteCount("PK|Sindh|Karachi", 3), SiteCount("AE||Dubai", 1)))
        assertEquals(listOf(SiteCity("PK", "Sindh", "Karachi", 3), SiteCity("AE", "", "Dubai", 1)), live.cityRows)
    }

    @Test
    fun theReportReadsLeniently() {
        val r = SiteReport.from(mapOf("from" to "2026-10-01", "to" to "2026-10-05", "now" to mapOf("sessions" to "12", "funnel" to mapOf("enquire" to 2)), "hours" to emptyList<Any>()))!!
        assertEquals(12, r.now.sessions)
        assertEquals(2, r.now.funnel.enquire)
        assertEquals(0, r.before.sessions)
        assertNull(r.hours)
        assertTrue(r.visitorsExact)
    }

    private fun piece(id: String, saves: Int = 0, asks: Int = 0, looks: Int = 0, avg: Double = 0.0, views: Int = 0) =
        WebsiteInterestPiece(piece = id, netSaves = saves, enquiries = asks, dwellN = looks, avgDwellMs = avg, views = views)

    @Test
    fun theRankingsKeepTheWebsRules() {
        val all = listOf(piece("a", saves = 2, asks = 5), piece("b", saves = 9, asks = 0), piece("c", saves = 2, asks = 1, looks = 2, avg = 90_000.0), piece("d", looks = 3, avg = 30_000.0))
        // Highest first, ties in the server's order, none at zero.
        assertEquals(listOf("b", "a", "c"), WebsiteInterestList.Saved.ranked(all).map { it.piece })
        assertEquals(listOf("a", "c"), WebsiteInterestList.Asked.ranked(all).map { it.piece })
        // A minimum of three looks, so one long stare does not top the list.
        assertEquals(listOf("d"), WebsiteInterestList.Longest.ranked(all).map { it.piece })
        assertEquals(40, WebsiteInterestList.Opened.ranked((1..60).map { piece("p$it", views = it) }).size)
        assertEquals("2 saved", WebsiteInterestList.Saved.say(all[0]))
        assertEquals("5 on WhatsApp", WebsiteInterestList.Asked.say(all[0]))
        assertEquals("30s on average · 3 looks", WebsiteInterestList.Longest.say(all[3]))
    }

    @Test
    fun theDemoReportMakesSense() {
        val now = java.time.Instant.parse("2026-10-12T08:00:00Z")
        val week = WebsiteDemo.siteReport("7d", now)
        assertEquals(7, week.series.size)
        assertNull(week.hours)
        val today = WebsiteDemo.siteReport("today", now)
        assertEquals(24, today.hours?.size)
        assertTrue(today.series.isEmpty())
        assertEquals(today.from, today.to)
    }
}
