package erp.app.screens.marketing

import erp.core.Json
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The shapes of GET /api/website/shopify-analytics and /live (lib/website/shopify-analytics.ts), over made-up numbers.
class ShopifyModelsTests {
    private val report = """
    {"range":"30d","from":"2026-10-05","to":"2026-11-03","previous":{"from":"2026-09-05","to":"2026-10-04"},
     "shop":{"name":"Mina Demo","currency":"PKR","timezone":"Asia/Karachi"},
     "sections":{
       "traffic":{"data":{"sessions":{"value":1200,"before":1000},"bounceRate":{"value":0.42,"before":0.5},"completedCheckout":{"value":30,"before":null}}},
       "sales":{"missingScope":"read_reports","note":"Level 2 data too."},
       "series":{"data":{"grain":"day","points":[{"at":"2026-11-02T00:00:00+05:00","sessions":40,"visitors":30,"sales":12000,"orders":2},{"at":"2026-11-03","sessions":10}]}},
       "funnel":{"data":[{"key":"sessions","label":"Sessions","value":1200,"before":1000},{"key":"addedToCart","label":"Added to cart","value":120}]},
       "products":{"data":[{"key":"Ruby ring","label":"Ruby ring","value":90000,"before":50000,"extra":{"net_items_sold":9,"orders":null}},{"label":"No key","value":"x"}]},
       "places":{"data":[{"key":"PK|Lahore","label":"Lahore, Pakistan","code":"PK","value":300}]},
       "sources":{"error":"Shopify is busy"}
     }}"""

    private val parsed = ShopReport.from(Json.parse(report))!!

    @Test fun kpisCarryTheirChangeAndAMissingNameIsZero() {
        val t = (parsed.traffic as ShopSection.Ready).data
        assertEquals(1200.0, t.value("sessions"))
        assertEquals(1000.0, t.before("sessions"))
        assertNull(t.before("completedCheckout"), "no before when the period was not compared")
        assertEquals(0.0, t.value("conversionRate"))
        assertEquals(0.42, t.value("bounceRate"))
    }

    @Test fun aSectionIsDataAMissingScopeAnErrorOrAbsent() {
        val missing = parsed.sales as ShopSection.Missing
        assertEquals("read_reports", missing.scope)
        assertEquals("Level 2 data too.", missing.note)
        assertEquals("Shopify is busy", (parsed.sources as ShopSection.Failed).message)
        assertTrue(parsed.devices is ShopSection.Absent, "a key the answer lacks")
        assertEquals(listOf("read_reports"), ShopWords.missing(parsed.all).map { it.scope }, "each scope is asked for once")
    }

    @Test fun theSeriesReadsShopifysTimestampByItsCharacters() {
        val s = (parsed.series as ShopSection.Ready).data
        assertEquals("day", s.grain)
        assertEquals(2, s.points.size)
        assertEquals("2026-11-02", s.points[0].day)
        assertEquals(12000.0, s.points[0].sales)
        assertNull(s.points[1].hour, "a bare day has no hour")
        assertEquals(0, ShopSeriesPoint(at = "2026-11-03T00:00:00+05:00").hour)
        assertEquals(14, ShopSeriesPoint(at = "2026-11-03T14:07:00+05:00").hour)
        assertEquals("14:07", ShopSeriesPoint(at = "2026-11-03T14:07:00+05:00").clock)
    }

    @Test fun listsAndTheFunnelDecodeLeniently() {
        val rows = (parsed.products as ShopSection.Ready).data
        assertEquals("Ruby ring", rows[0].label)
        assertEquals(50000.0, rows[0].before)
        assertEquals(mapOf("net_items_sold" to 9.0), rows[0].extra, "a null extra is left out")
        assertEquals(0.0, rows[1].value, "a value that is not a number is zero")
        val steps = (parsed.funnel as ShopSection.Ready).data
        assertEquals(listOf("Sessions", "Added to cart"), steps.map { it.label })
        assertNull(steps[1].before)
        assertEquals("Mina Demo", parsed.storeName)
        assertEquals("2026-09-05", parsed.previousFrom)
    }

    @Test fun rankedRowsSayMoneyInTheStoresCurrencyAndCountsPlain() {
        val rows = (parsed.products as ShopSection.Ready).data
        assertEquals("PKR 90,000", ShopRanks.rows(rows, "PKR", money = true)[0].text)
        assertEquals("USD 90,000", ShopRanks.rows(rows, "USD", money = true)[0].text)
        assertEquals("PKR 90,000", ShopRanks.rows(rows, "", money = true)[0].text, "PKR when the answer names none")
        assertEquals("90,000", ShopRanks.rows(rows, "PKR")[0].text)
        val place = ShopRanks.rows((parsed.places as ShopSection.Ready).data, "", lead = true)[0]
        assertEquals("🇵🇰", place.lead)
        assertEquals("Lahore, Pakistan", place.label)
    }

    @Test fun anAnswerThatIsNotAnObjectIsNotAReport() {
        assertNull(ShopReport.from(Json.parse("[]")))
        assertNull(ShopLive.from(null))
        val bare = ShopReport.from(Json.parse("""{"range":"7d"}"""))!!
        assertTrue(bare.sales is ShopSection.Absent && bare.series is ShopSection.Absent)
    }

    @Test fun liveCarriesTheHalfHourTodayAndTheRecentOrdersAndCheckouts() {
        val live = ShopLive.from(Json.parse("""
        {"at":1,"windowMinutes":30,"live":{"sessionsLastHalfHour":7,"note":"No Live View API."},
         "sections":{
          "sessions":{"data":{"grain":"minute","points":[{"at":"2026-11-03T14:07:00+05:00","sessions":3}]}},
          "places":{"data":[{"key":"PK|Karachi","label":"Karachi, Pakistan","code":"PK","value":4}]},
          "today":{"data":{"sessions":{"value":55},"addedToCart":{"value":9}}},
          "recent":{"data":[{"kind":"order","ago":30000,"label":"#1012","amount":8500,"currency":"PKR","place":"Lahore, PK","items":[{"title":"Ruby ring","quantity":2}],"status":"PAID"},
                            {"kind":"checkout","ago":600000,"label":"Checkout started","amount":null,"currency":"PKR","place":"","items":[]}]}}}"""))!!
        assertEquals(7, live.lastHalfHour)
        assertEquals(30, live.windowMinutes)
        assertEquals("minute", (live.sessions as ShopSection.Ready).data.grain)
        assertEquals(55.0, (live.today as ShopSection.Ready).data.value("sessions"))
        val recent = (live.recent as ShopSection.Ready).data
        assertEquals(listOf("order", "checkout"), recent.map { it.kind })
        assertEquals(listOf("Ruby ring" to 2), recent[0].items)
        assertNull(recent[1].amount)
        assertEquals("just now", ShopWords.ago(recent[0].ago))
        assertEquals("10 min ago", ShopWords.ago(recent[1].ago))
    }

    @Test fun theLiveScopeForOrdersIsAskedForAlongsideReports() {
        val live = ShopLive.from(Json.parse("""
        {"sections":{"sessions":{"missingScope":"read_reports"},"places":{"missingScope":"read_reports"},"today":{"missingScope":"read_reports"},
                     "recent":{"missingScope":"read_orders"}}}"""))!!
        assertEquals(listOf("read_reports", "read_orders"), ShopWords.missing(live.all).map { it.scope })
        assertNull(live.lastHalfHour)
    }
}
