package erp.app.screens.ads

import erp.app.screens.ads.AdsStatusWords.Level
import erp.core.Json
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The Ads pages' words and models (AdsKit.swift, AdsModels.swift) on made-up numbers. */
class AdsModelsTests {
    @Test fun moneyInThePkrWordsAndAnotherCurrencyByItsCode() {
        assertEquals("PKR 1,500", AdsFormat.money(1500.0, "PKR"))
        assertEquals("PKR 4.5 lac", AdsFormat.money(450_000.0, "pkr"))
        assertEquals("PKR 12", AdsFormat.money(12.345, "PKR"))
        assertEquals("PKR 0", AdsFormat.money(Double.NaN, "PKR"))
        assertEquals("USD 1,235", AdsFormat.money(1234.5, "usd"))
        assertEquals("USD 4.5", AdsFormat.money(4.5, "USD"))
    }

    @Test fun countsCompactFiguresAndPercents() {
        assertEquals("12,345", AdsFormat.count(12_345.0))
        assertEquals("12.3k", AdsFormat.compact(12_300.0))
        assertEquals("10k", AdsFormat.compact(10_000.0))
        assertEquals("1.25M", AdsFormat.compact(1_250_000.0))
        assertEquals("950", AdsFormat.compact(950.0))
        assertEquals("1.50%", AdsFormat.pct(1.5))
    }

    @Test fun changeAgainstBeforeSaysUpDownOrSame() {
        assertEquals("up 18% on before", AdsFormat.change(118.0, 100.0))
        assertEquals("down 6% on before", AdsFormat.change(94.0, 100.0))
        assertEquals("same as before", AdsFormat.change(100.2, 100.0))
        assertNull(AdsFormat.change(5.0, null))
        assertNull(AdsFormat.change(5.0, 0.0))
    }

    @Test fun statusesInTheShopsWordsAndTones() {
        assertEquals("Running", AdsStatusWords.of("ACTIVE").label)
        assertEquals(Level.good, AdsStatusWords.of("ACTIVE").tone)
        assertEquals(Level.bad, AdsStatusWords.of("DISAPPROVED").tone)
        assertEquals("Needs payment info", AdsStatusWords.of("PENDING_BILLING_INFO").label)
        assertEquals("Some new state", AdsStatusWords.of("SOME_NEW_STATE").label)
        assertEquals("Unknown", AdsStatusWords.of("").label)
        assertEquals("Payment due", AdsStatusWords.ofAccount(3).label)
        assertEquals("Status 55", AdsStatusWords.ofAccount(55).label)
        assertNull(AdsStatusWords.accountFix(1))
        assertTrue(AdsStatusWords.accountFix(2)!!.startsWith("Meta has disabled"))
    }

    @Test fun resultsByGoalAndTheHeadline() {
        val chats = "onsite_conversion.messaging_conversation_started_7d"
        val m = AdMetrics(spend = 900.0, reach = 5000.0, impressions = 8000.0, actions = mapOf(chats to 12.0, "link_click" to 40.0, "post_engagement" to 70.0))
        assertEquals("Chats started", AdsResults.of(m, "CONVERSATIONS")!!.label)
        assertEquals(12.0, AdsResults.of(m, "CONVERSATIONS")!!.value)
        assertEquals(5000.0, AdsResults.of(m, "REACH")!!.value)
        assertEquals(8000.0, AdsResults.of(m, "IMPRESSIONS")!!.value)
        // Profile visits are the least documented: no action, no result worth showing.
        assertNull(AdsResults.of(m, "PROFILE_VISIT"))
        assertNull(AdsResults.of(m, "NOT_A_GOAL"))
        assertNull(AdsResults.of(m, null))
        assertEquals(chats, AdsResults.headlineResult(m).key)
        assertEquals("link_click", AdsResults.headlineResult(AdMetrics(actions = mapOf("link_click" to 3.0))).key)
        assertEquals("reach", AdsResults.headlineResult(AdMetrics(reach = 10.0)).key)
        assertEquals(12.0, AdsResults.value(m, chats))
        assertEquals(5000.0, AdsResults.value(m, "reach"))
        // Link clicks are part of post engagement: both are listed, once each, chats first.
        assertEquals(listOf("Chats started", "Link clicks", "Post engagement"), AdsResults.headlineActions(m).map { it.label })
        assertEquals("Saves", AdsResults.label("onsite_conversion.post_save"))
        assertEquals("Some thing", AdsResults.label("offsite_conversion.some_thing"))
    }

    @Test fun objectivesAsTheOwnerWouldSayThem() {
        assertEquals("Sales", AdsObjective.label("OUTCOME_SALES"))
        assertEquals("Traffic", AdsObjective.label("LINK_CLICKS"))
        assertEquals("Brand lift", AdsObjective.label("OUTCOME_BRAND_LIFT"))
    }

    @Test fun rangesHaveTheirLabels() {
        assertEquals(8, AdsRange.all.size)
        assertEquals("Last 7 days", AdsRange.label("last_7d"))
        assertEquals("all_time_x", AdsRange.label("all_time_x"))
    }

    private val overviewJson = """
        {
          "account": {"id":"act_1","name":"Made Up Jewels","currency":"PKR","status":1,"amountSpent":"250000","spendCap":null,"funding":"Visa 4242","minDailyBudget":500},
          "since":"2026-10-06","until":"2026-10-12",
          "totals":{"spend":12000,"impressions":50000,"reach":"20000","ctr":1.25,"cpm":240,"cpc":8,"clicks":1500,
                    "actions":{"link_click":1200,"onsite_conversion.messaging_conversation_started_7d":"45","junk":{}}},
          "previous":{"since":"2026-09-29","until":"2026-10-05","metrics":{"spend":10000,"reach":18000}},
          "daily":[{"date":"2026-10-06","metrics":{"spend":1500}},{"date":"2026-10-07","metrics":{"spend":2500}}],
          "topAds":[{"id":"9","name":"Ruby ring","campaign":"Rings","thumbnail":null,"goal":"CONVERSATIONS","metrics":{"spend":4000}}],
          "breakdowns":{"ageGender":[{"key":"25-34|female","label":"Women 25-34","metrics":{"spend":3000}}],"placement":[],"region":[]},
          "attention":[
            {"severity":"warn","title":"Spent 2 days' budget","why":"No result.","action":{"do":"pause","level":"adset","id":"77","name":"Test set"}},
            {"severity":"tip","title":"Open it","why":"Look.","action":{"do":"open","href":"/ads/campaigns?ad=9"}},
            {"severity":"tip","title":"Just a word","why":"Nothing to tap."}
          ],
          "month":{"spent":30000,"projected":90000,"lastMonth":80000,"dayOfMonth":10,"daysInMonth":31},
          "at":"2026-10-12T08:00:00.000Z"
        }
    """.trimIndent()

    @Test fun anOverviewIsReadLeniently() {
        val d = AdOverview.from(Json.parse(overviewJson))
        assertNotNull(d)
        assertEquals("Made Up Jewels", d.account.name)
        assertEquals(250_000.0, d.account.amountSpent)
        assertNull(d.account.spendCap)
        assertEquals(500.0, d.account.minDailyBudget)
        assertEquals(20_000.0, d.totals.reach)
        assertEquals(45.0, d.totals.actions["onsite_conversion.messaging_conversation_started_7d"])
        assertFalse(d.totals.actions.containsKey("junk"))
        assertEquals(10_000.0, d.before!!.spend)
        assertEquals("2026-09-29", d.beforeSince)
        assertEquals(2, d.daily.size)
        assertNull(d.topAds[0].thumbnail)
        assertEquals("Women 25-34", d.ageGender[0].label)
        assertEquals(3, d.attention.size)
        assertEquals("pause", d.attention[0].doing)
        assertEquals("77", d.attention[0].targetId)
        assertEquals("open", d.attention[1].doing)
        assertEquals("/ads/campaigns?ad=9", d.attention[1].href)
        assertEquals("", d.attention[2].doing)
        assertEquals(31, d.month!!.daysInMonth)
    }

    @Test fun anOverviewWithoutAnAccountIsNotRead() {
        assertNull(AdOverview.from(Json.parse("""{"totals":{}}""")))
        assertNull(AdCampaigns.from(Json.parse("""{"campaigns":[]}""")))
        assertNull(AdOverview.from(Json.parse("[]")))
    }

    @Test fun theCampaignTreeKeepsEffectiveStatusAndDropsNamelessIds() {
        val json = """
            {"account":{"id":"a","currency":"PKR"},
             "campaigns":[
               {"id":"1","name":"Rings","status":"PAUSED","objective":"OUTCOME_ENGAGEMENT","dailyBudget":1000,
                "adsets":[{"id":"2","name":"Set","status":"ACTIVE","effectiveStatus":"CAMPAIGN_PAUSED","optimizationGoal":"CONVERSATIONS","endTime":"2026-10-20T00:00:00+0000",
                           "ads":[{"id":"3","name":"Ad","status":"ACTIVE","thumbnail":"https://x/y.jpg","issues":["Fix the link"]}]}]},
               {"id":"","name":"Nobody"}
             ]}
        """.trimIndent()
        val t = AdCampaigns.from(Json.parse(json))!!
        assertEquals(1, t.campaigns.size)
        val c = t.campaigns[0]
        assertEquals("PAUSED", c.effectiveStatus)
        assertEquals(1000.0, c.dailyBudget)
        assertNull(c.lifetimeBudget)
        assertEquals("CAMPAIGN_PAUSED", c.adsets[0].effectiveStatus)
        assertEquals("https://x/y.jpg", c.adsets[0].ads[0].image)
        assertEquals(listOf("Fix the link"), c.adsets[0].ads[0].issues)
    }
}
