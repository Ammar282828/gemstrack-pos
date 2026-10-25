package erp.app.shots

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.navigation3.runtime.rememberNavBackStack
import erp.app.ErpApp
import erp.app.nav.Route
import erp.app.nav.StackHost
import erp.app.screens.ads.AdCampaigns
import erp.app.screens.ads.AdOverview
import erp.app.screens.ads.AdsAPI
import erp.app.screens.ads.AdsAdsetsInfo
import erp.app.screens.ads.AdsAudience
import erp.app.screens.ads.AdsEstimate
import erp.app.screens.ads.AdsPixelAnswer
import erp.app.screens.ads.AdsAudiencesAnswer
import erp.app.screens.ads.AdsBackend
import erp.app.screens.ads.AdsMediaAnswer
import erp.app.screens.ads.AdsNewAdLists
import erp.app.screens.ads.AdsRulesAnswer
import erp.app.screens.ads.AdsSetupAssets
import erp.app.screens.ads.AdsSitePiece
import erp.app.screens.ads.AdsStatusAnswer
import erp.app.screens.ads.AdsTestsAnswer
import erp.app.screens.ads.AdsAdvanced
import erp.app.screens.ads.AdsAdvancedSection
import erp.app.screens.ads.AdsCampaignsContent
import erp.app.screens.ads.AdsCatalogChoice
import erp.app.screens.ads.AdsCatalogRow
import erp.app.screens.ads.AdsCatalogSection
import erp.app.screens.ads.AdsCsv
import erp.app.screens.ads.AdsFilter
import erp.app.screens.ads.AdsPage
import erp.app.screens.ads.AdsPartnerCheck
import erp.app.screens.ads.AdsPartnerSection
import erp.app.screens.ads.AdsSort
import erp.app.screens.ads.AdsVideoDraft
import erp.app.screens.ads.AdsVideoSection
import erp.app.screens.ads.LocalAdsBackend
import erp.core.Json
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Ads, as the owner: the Overview, Campaigns and New ad's first step, drawn from made-up answers (the ERP's routes are
 * not reachable from a test, so the screens read a backend the test fills). Taheri's look is the baseline.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = ErpApp::class)
class AdsShots(config: ShotConfig) : ShotBase(config) {
    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun configs(): Collection<Array<Any>> {
            ShotEnv.demo()
            return ShotConfigs.all.map { arrayOf<Any>(it) }
        }
    }

    /** A screen of Ads on its own back stack, over the made-up ERP. */
    private fun showAds(path: String, below: List<String> = emptyList()) = show {
        CompositionLocalProvider(LocalAdsBackend provides AdsFixtures.backend) {
            val stack = rememberNavBackStack(*(below + path).mapIndexed { i, p -> Route(p, i) }.toTypedArray())
            StackHost(stack, Modifier.fillMaxSize(), onClose = null)
        }
    }

    @Test fun ads_overview() {
        onlyTaheri()
        showAds("/ads")
        shoot("ads-overview")
    }

    @Test fun ads_campaigns() {
        onlyTaheri()
        showAds("/ads/campaigns", below = listOf("/ads"))
        shoot("ads-campaigns")
    }

    @Test fun ads_setup() {
        onlyTaheri()
        showAds("/ads/setup", below = listOf("/ads"))
        shoot("ads-setup")
    }

    @Test fun ads_rules() {
        onlyTaheri()
        showAds("/ads/rules", below = listOf("/ads", "/ads/setup"))
        shoot("ads-rules")
    }

    @Test fun ads_audiences() {
        onlyTaheri()
        showAds("/ads/audiences", below = listOf("/ads", "/ads/setup"))
        shoot("ads-audiences")
    }

    @Test fun ads_tests() {
        onlyTaheri()
        showAds("/ads/tests", below = listOf("/ads", "/ads/setup"))
        shoot("ads-tests")
    }

    @Test fun ads_new_ad_other_sources() {
        onlyTaheri()
        show {
            CompositionLocalProvider(LocalAdsBackend provides AdsFixtures.backend) {
                AdsPage {
                    AdsVideoSection(AdsVideoDraft("Video Mon 12 Oct, 10:40", AdsVideoDraft.Phase.sending, sent = 0.64), {})
                    AdsPartnerSection(
                        code = "kF3mQ9xYpLw2", onCode = {},
                        checked = AdsPartnerCheck("kF3mQ9xYpLw2", true, "m9", "madeupmaker", null, null, null), onChecked = {},
                        link = "", onLink = {}, button = "SHOP_NOW", onButton = {}, toSite = false, buttons = emptyList(),
                    )
                    AdsCatalogSection(
                        AdsCatalogChoice(
                            catalogs = listOf(AdsCatalogRow("c1", "Made Up Jewellers", 412), AdsCatalogRow("c2", "Made Up Old", 12)), catalogId = "c1",
                            sets = listOf(AdsCatalogRow("s1", "All pieces", 412), AdsCatalogRow("s2", "Rings", 96)), setId = "s1",
                        ),
                    ) {}
                    AdsAdvancedSection(AdsAdvanced(open = true, bid = "min_roas", roas = "3", hoursOn = true, days = setOf(1, 2, 3, 4, 5), from = 10, to = 22), {}, {}, sales = true, currency = "PKR")
                }
            }
        }
        shoot("ads-new-ad-other-sources")
    }

    @Test fun ads_campaigns_csv() {
        onlyTaheri()
        show {
            CompositionLocalProvider(LocalAdsBackend provides AdsFixtures.backend) {
                var campaigns by remember { mutableStateOf<AdCampaigns?>(null) }
                LaunchedEffect(Unit) { campaigns = AdsFixtures.backend.campaigns("last_7d", false) }
                campaigns?.let { d ->
                    AdsCampaignsContent(
                        d = d, problem = null, filter = AdsFilter.all, onFilter = {}, search = "", onSearch = {}, gallery = true, onGallery = {},
                        sort = AdsSort.roas, onSort = {}, allExpanded = false, expanded = emptyList(), onExpand = { _, _ -> }, busy = null,
                        onSwitch = { _, _ -> }, onBudget = {}, onDetails = { _, _ -> },
                        csv = AdsCsv("ads-last_7d-2026-10-12.csv", ByteArray(0)),
                    )
                }
            }
        }
        shoot("ads-campaigns-csv")
    }

    @Test fun ads_ad_sets() {
        onlyTaheri()
        showAds("/ads/adset?campaign=5001&ads=9001", below = listOf("/ads", "/ads/campaigns"))
        shoot("ads-ad-sets")
    }

    @Test fun ads_ad_page() {
        onlyTaheri()
        showAds("/ads/object?level=adset&id=6001", below = listOf("/ads", "/ads/campaigns"))
        shoot("ads-adset-page")
    }

    @Test fun ads_new_ad_step_1() {
        onlyTaheri()
        showAds("/ads/new", below = listOf("/ads"))
        shoot("ads-new-ad-step-1")
    }
}

/** What the ERP would answer, made up: a jeweller's account with a few ads. */
object AdsFixtures {
    private fun parse(json: String): Any? = Json.parse(json)

    private val overview = """
        {
          "account": {"id":"act_1","name":"Made Up Jewellers","currency":"PKR","status":1,"amountSpent":412500,"spendCap":null,"funding":"Visa ending 4242","minDailyBudget":500},
          "since":"2026-10-06","until":"2026-10-12",
          "totals":{"spend":38400,"impressions":186000,"reach":71200,"clicks":3120,"linkClicks":2400,"ctr":1.68,"cpm":206,"cpc":12.3,
                    "actions":{"onsite_conversion.messaging_conversation_started_7d":96,"link_click":2400,"post_engagement":5100,"post_reaction":740,"comment":58,"omni_purchase":9},
                    "values":{"omni_purchase":223000}},
          "previous":{"since":"2026-09-29","until":"2026-10-05","metrics":{"spend":33800,"reach":69400,"actions":{"onsite_conversion.messaging_conversation_started_7d":80,"omni_purchase":7},"values":{"omni_purchase":168000}}},
          "daily":[
            {"date":"2026-10-06","metrics":{"spend":4800}},{"date":"2026-10-07","metrics":{"spend":5600}},{"date":"2026-10-08","metrics":{"spend":5200}},
            {"date":"2026-10-09","metrics":{"spend":6900}},{"date":"2026-10-10","metrics":{"spend":7400}},{"date":"2026-10-11","metrics":{"spend":4700}},{"date":"2026-10-12","metrics":{"spend":3800}}
          ],
          "topAds":[
            {"id":"9001","name":"Bridal diamond ring, reel","campaign":"Bridal season","thumbnail":null,"goal":"CONVERSATIONS","metrics":{"spend":14200,"reach":22000,"actions":{"onsite_conversion.messaging_conversation_started_7d":41,"omni_purchase":6},"values":{"omni_purchase":158000}}},
            {"id":"9002","name":"Eid gold kara, photo","campaign":"Eid gifts","thumbnail":null,"goal":"LINK_CLICKS","metrics":{"spend":9100,"reach":18000,"actions":{"link_click":820}}},
            {"id":"9003","name":"Pearl set, carousel","campaign":"Bridal season","thumbnail":null,"goal":"REACH","metrics":{"spend":5400,"reach":15000}}
          ],
          "breakdowns":{
            "ageGender":[{"key":"25-34|female","label":"Women 25–34","metrics":{"spend":14800,"impressions":70000}},{"key":"35-44|female","label":"Women 35–44","metrics":{"spend":9600,"impressions":41000}},{"key":"25-34|male","label":"Men 25–34","metrics":{"spend":5200,"impressions":24000}}],
            "placement":[{"key":"ig_stories","label":"Instagram Stories","metrics":{"spend":16900,"impressions":80000}},{"key":"ig_feed","label":"Instagram Feed","metrics":{"spend":12100,"impressions":58000}},{"key":"ig_reels","label":"Instagram Reels","metrics":{"spend":9400,"impressions":48000}}],
            "region":[{"key":"Sindh","label":"Sindh","metrics":{"spend":21000,"impressions":99000}},{"key":"Punjab","label":"Punjab","metrics":{"spend":13400,"impressions":64000}}]
          },
          "attention":[
            {"severity":"warn","title":"Pearl set test spent 2 days' budget with no result","why":"It has cost PKR 4,000 and brought no chats. Pausing it keeps the money for the ones that work.","action":{"do":"pause","level":"adset","id":"7001","name":"Pearl set test"}},
            {"severity":"tip","title":"A paused ad set was cheaper than what runs","why":"Eid kara to Lahore got chats at PKR 310 each; the running ones cost PKR 520.","action":{"do":"resume","level":"adset","id":"7002","name":"Eid kara to Lahore"}},
            {"severity":"tip","title":"Bridal season ends in 2 days","why":"Its last day is Wednesday 14 Oct.","action":{"do":"open","href":"/ads/campaigns"}}
          ],
          "month":{"spent":98200,"projected":242000,"lastMonth":205000,"dayOfMonth":12,"daysInMonth":31},
          "at":"2026-10-12T08:00:00.000Z"
        }
    """.trimIndent()

    private val campaigns = """
        {"account":{"id":"act_1","name":"Made Up Jewellers","currency":"PKR","status":1,"amountSpent":412500},
         "campaigns":[
          {"id":"5001","name":"Bridal season","status":"ACTIVE","effectiveStatus":"ACTIVE","objective":"OUTCOME_ENGAGEMENT","dailyBudget":3000,"stopTime":"2026-10-14T18:59:00+0000",
           "metrics":{"spend":24600,"reach":41000,"impressions":98000,"actions":{"onsite_conversion.messaging_conversation_started_7d":64,"omni_purchase":8},"values":{"omni_purchase":196000}},
           "previous":{"spend":21000},
           "adsets":[
             {"id":"6001","name":"Karachi women 25–40","status":"ACTIVE","effectiveStatus":"ACTIVE","optimizationGoal":"CONVERSATIONS","dailyBudget":2000,"learning":"Learning",
              "metrics":{"spend":16900,"reach":27000,"impressions":61000,"actions":{"onsite_conversion.messaging_conversation_started_7d":44}},
              "ads":[{"id":"9001","name":"Bridal diamond ring, reel","status":"ACTIVE","effectiveStatus":"ACTIVE","metrics":{"spend":14200}},{"id":"9003","name":"Pearl set, carousel","status":"ACTIVE","effectiveStatus":"ACTIVE","metrics":{"spend":2700}}]},
             {"id":"7001","name":"Pearl set test","status":"ACTIVE","effectiveStatus":"ACTIVE","optimizationGoal":"CONVERSATIONS","dailyBudget":1000,
              "metrics":{"spend":7700,"reach":14000,"impressions":37000,"actions":{"onsite_conversion.messaging_conversation_started_7d":20}},
              "ads":[{"id":"9004","name":"Pearl set, photo","status":"ACTIVE","effectiveStatus":"WITH_ISSUES","issues":["The ad's image has too much text."],"metrics":{"spend":7700}}]}
           ]},
          {"id":"5002","name":"Eid gifts","status":"PAUSED","effectiveStatus":"PAUSED","objective":"OUTCOME_TRAFFIC","lifetimeBudget":30000,
           "metrics":{"spend":13800,"reach":30000,"impressions":88000,"actions":{"link_click":1580}},
           "adsets":[
             {"id":"7002","name":"Eid kara to Lahore","status":"PAUSED","effectiveStatus":"PAUSED","optimizationGoal":"LINK_CLICKS","lifetimeBudget":30000,
              "metrics":{"spend":13800,"reach":30000,"impressions":88000,"actions":{"link_click":1580}},
              "ads":[{"id":"9002","name":"Eid gold kara, photo","status":"PAUSED","effectiveStatus":"PAUSED","metrics":{"spend":9100}}]}
           ]}
         ]}
    """.trimIndent()

    private val status = """
        {"app":{"id":"1075984878628188","secret":true,"tokenStore":{"exists":true,"write":true}},
         "connection":{"connected":true,"kind":"user","userName":"Made Up","daysLeft":45},
         "settings":{"adAccountId":"act_1","adAccountName":"Made Up Jewellers","pageId":"55","pageName":"Made Up Jewellers","instagramUserId":"88","instagramUsername":"madeupjewellers"},
         "houseInstagram":"madeupjewellers",
         "account":{"id":"act_1","name":"Made Up Jewellers","currency":"PKR","status":1,"amountSpent":412500,"minDailyBudget":500}}
    """.trimIndent()

    private val lists = """
        {"goals":[
          {"key":"whatsapp","label":"WhatsApp chats","hint":"People message the shop on WhatsApp","objective":"OUTCOME_ENGAGEMENT","optimization":"CONVERSATIONS","newAd":true},
          {"key":"messages","label":"Instagram messages","hint":"People message the shop on Instagram or WhatsApp, whichever they use","objective":"OUTCOME_ENGAGEMENT","optimization":"CONVERSATIONS","newAd":true},
          {"key":"website","label":"Website visits","hint":"People open a page on the shop's site","objective":"OUTCOME_TRAFFIC","optimization":"LINK_CLICKS","toSite":true,"photosOnly":true,"newAd":true},
          {"key":"engagement","label":"Engagement","hint":"Likes, comments and saves on an existing post","objective":"OUTCOME_ENGAGEMENT","optimization":"POST_ENGAGEMENT","postOnly":true,"newAd":true},
          {"key":"reach","label":"Reach","hint":"As many people as the budget finds","objective":"OUTCOME_AWARENESS","optimization":"REACH","newAd":true}
         ],
         "buttons":[{"key":"SHOP_NOW","label":"Shop now"},{"key":"LEARN_MORE","label":"Learn more"}],
         "igPositions":[{"key":"stream","label":"Feed"},{"key":"story","label":"Stories"},{"key":"reels","label":"Reels"}],
         "links":{"website":"https://made-up.example","shop":"","waChannel":""},
         "sitePieces":true,"quiet":[]}
    """.trimIndent()

    private val media = """
        {"media":[
          {"id":"m1","caption":"Bridal diamond ring, in 18k","type":"REEL","boostable":true},
          {"id":"m2","caption":"Eid gold kara","type":"IMAGE","boostable":true},
          {"id":"m3","caption":"Pearl set","type":"CAROUSEL_ALBUM","boostable":true},
          {"id":"m4","caption":"A story highlight","type":"VIDEO","boostable":false},
          {"id":"m5","caption":"Gold chain, 22k","type":"IMAGE","boostable":true},
          {"id":"m6","caption":"Ruby pendant","type":"IMAGE","boostable":true}
        ],"after":null}
    """.trimIndent()

    private val adsets = """{"campaign":{"id":"5001","name":"Bridal season","objective":"OUTCOME_ENGAGEMENT","budgeted":false},"ads":["9001"],"currency":"PKR","minDaily":500}"""

    private val audiences = """
        {"audiences":[
          {"id":"a1","name":"Buyers, last year","kind":"Customer list","size":[1000,1500],"ready":true,"created":"2026-09-20T08:00:00.000Z"},
          {"id":"a2","name":"Instagram engagers, 365 days","kind":"Engagement","size":[8000,12000],"ready":true,"created":"2026-09-22T08:00:00.000Z"},
          {"id":"a3","name":"Lookalike 1% of buyers","kind":"Lookalike","size":[300000,420000],"ready":false,"status":"Meta is still filling it","created":"2026-10-10T08:00:00.000Z"}],
         "segments":[{"key":"all","label":"Every customer","hint":"Everyone in the customer book"},{"key":"buyers","label":"Bought","hint":"Customers who have bought something"},{"key":"lastyear","label":"Bought in the last year","hint":"Bought in the last 12 months"},{"key":"lapsed","label":"Lapsed","hint":"Bought, but not in the last year"}],
         "events":[{"key":"ig_business_profile_all","label":"Everyone who engaged"},{"key":"ig_business_profile_visit","label":"Visited the profile"}],
         "websiteEvents":[
          {"key":"Purchase","label":"Bought","hint":"People who ordered from the website"},
          {"key":"AddToCart","label":"Added to cart","hint":"People who added a piece to the cart"},
          {"key":"PageView","label":"Visited the website","hint":"Anyone the pixel saw"}],
         "pixel":true,
         "instagram":"madeupjewellers"}
    """.trimIndent()

    private val tests = """
        {"currency":"PKR",
         "tests":[
          {"id":"t1","name":"Packshot vs on-hand","start":"2026-10-08T09:00:00.000Z","end":"2026-10-15T09:00:00.000Z","running":true,"ahead":"B",
           "cells":[
            {"name":"A","adsets":[{"name":"Karachi women 25–40"}],"spend":9800,"result":21,"resultLabel":"Chats started","costPerResult":467,"roas":2.4},
            {"name":"B","adsets":[{"name":"Karachi women 25–40, on-hand"}],"spend":9600,"result":29,"resultLabel":"Chats started","costPerResult":331,"roas":3.9}]}],
         "adsets":[
          {"id":"6001","name":"Karachi women 25–40","campaign":"Bridal season","status":"ACTIVE"},
          {"id":"6002","name":"Karachi women 25–40, on-hand","campaign":"Bridal season","status":"ACTIVE"},
          {"id":"7002","name":"Eid kara to Lahore","campaign":"Eid gifts","status":"PAUSED"},
          {"id":"7003","name":"Pearl set, Lahore","campaign":"Bridal season","status":"CAMPAIGN_PAUSED"}]}
    """.trimIndent()

    private val rules = """
        {"rules":[
          {"id":"r1","name":"Pause what's wasting money — PKR 3,000","enabled":true,"summary":"ad sets · today · spent > PKR 3,000 · results < 1 → pause it, every 30 min"},
          {"id":"r2","name":"Tell me what's not working — PKR 500","enabled":false,"summary":"ad sets · today · spent > PKR 500 · results < 1 → notify me"}],
         "kinds":[
          {"key":"pause_no_results","label":"Pause what's wasting money","hint":"Pauses an ad set that spent this much today with no result.","needs":"spend"},
          {"key":"notify_no_results","label":"Tell me what's not working","hint":"Sends a notification when an ad set spent above this today with no result.","needs":"spend"},
          {"key":"notify_cost","label":"Tell me when results get dear","hint":"Sends a notification when a result costs above this.","needs":"cost"}],
         "currency":"PKR",
         "log":[
          {"id":"l1","at":"2026-10-11T09:00:00.000Z","by":"owner@example.com","action":"budget","target":"6001","name":"Karachi women 25–40","detail":{"daily":2000,"currency":"PKR"}},
          {"id":"l2","at":"2026-10-10T10:30:00.000Z","by":"owner@example.com","action":"schedule","target":"5001","name":"Bridal season","detail":{"end":"2026-10-14T18:59:00.000Z"}}]}
    """.trimIndent()

    private val assets = """
        {"accounts":[{"id":"act_1","name":"Made Up Jewellers","currency":"PKR","status":1,"business":"Made Up Group"},{"id":"act_2","name":"Made Up Old","currency":"PKR","status":2}],
         "pages":[{"id":"55","name":"Made Up Jewellers","canAdvertise":true,"instagram":{"username":"madeupjewellers"},"whatsapp":"+92 300 0000000"}],
         "instagram":[{"id":"88","username":"madeupjewellers","via":"page","pageId":"55"}],
         "settings":{"adAccountId":"act_1","adAccountName":"Made Up Jewellers","pageId":"55","pageName":"Made Up Jewellers","instagramUserId":"88","instagramUsername":"madeupjewellers","whatsappGreeting":"Hi! I saw your ad."}}
    """.trimIndent()

    private val pixel = """
        {"pixels":[{"id":"555","name":"Website","lastFired":"2026-10-12T06:00:00.000Z"}],
         "state":{"id":"555","lastFired":"2026-10-12T06:00:00.000Z","live":true,"onSite":true,"site":"made-up.example","sites":[{"url":"https://made-up.example","ids":["555"],"loader":true}],
                  "events":{"PageView":1204,"AddToCart":31,"Purchase":4}}}
    """.trimIndent()

    private val adsetPage = """
        {"currency":"PKR","adset":{"id":"6001","name":"Karachi women 25–40","status":"ACTIVE","effective_status":"ACTIVE","optimization_goal":"CONVERSATIONS","daily_budget":2000,"end_time":"2026-10-14T23:59:00+0500",
          "targeting":{"age_min":25,"age_max":40,"genders":[2],"geo_locations":{"cities":[{"name":"Karachi","radius":25}]}}},
         "budget":{"daily":2000,"lifetime":0},
         "audience":{"places":[{"type":"city","key":"1","name":"Karachi","radiusKm":25}],"ageMin":25,"ageMax":40,"gender":"women"}}
    """.trimIndent()

    val backend: AdsBackend = object : AdsBackend by AdsAPI {
        override suspend fun overview(range: String, fresh: Boolean) = AdOverview.from(parse(overview))!!
        override suspend fun campaigns(range: String, archived: Boolean) = AdCampaigns.from(parse(campaigns))!!
        override suspend fun status(fresh: Boolean) = AdsStatusAnswer.from(parse(status))!!
        override suspend fun newAdLists() = AdsNewAdLists.from(parse(lists))!!
        override suspend fun media(after: String?) = AdsMediaAnswer.from(parse(media))!!
        override suspend fun sitePieces(): List<AdsSitePiece> = emptyList()
        override suspend fun adsetsInfo(campaign: String?, from: String?) = AdsAdsetsInfo.from(parse(adsets))!!
        override suspend fun audiences() = AdsAudiencesAnswer.from(parse(audiences))!!
        override suspend fun rules() = AdsRulesAnswer.from(parse(rules))!!
        override suspend fun tests() = AdsTestsAnswer.from(parse(tests))!!
        override suspend fun setupAssets() = AdsSetupAssets.from(parse(assets))!!
        override suspend fun pixel() = AdsPixelAnswer.from(parse(pixel))!!
        override suspend fun objectDetail(id: String, level: String): Map<String, Any?> {
            @Suppress("UNCHECKED_CAST")
            return parse(adsetPage) as Map<String, Any?>
        }
        override suspend fun estimate(draft: AdsAudience, goal: String) = AdsEstimate(42_000.0, 61_000.0)
    }
}
