package erp.app.screens.ads

import erp.app.ui.AppClock
import erp.core.Json
import java.time.Instant
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The rules of the Campaigns, Budget, Audience, Rules and Setup pages (AdsCampaigns.swift … AdsSetup.swift). */
class AdsPagesTests {
    private val now = Instant.parse("2026-10-12T08:00:00Z")

    @Before fun pin() { AppClock.pinned = now }

    @After fun unpin() { AppClock.pinned = null }

    private fun metrics(spend: Double, ctr: Double = 0.0, chats: Double = 0.0) =
        AdMetrics(spend = spend, ctr = ctr, reach = 1000.0, impressions = 3000.0, actions = if (chats > 0) mapOf("onsite_conversion.messaging_conversation_started_7d" to chats) else emptyMap())

    private fun ad(id: String, name: String, status: String = "ACTIVE", spend: Double = 0.0, ctr: Double = 0.0, issues: List<String> = emptyList()) =
        AdItem(id, name, status, status, null, issues, metrics(spend, ctr))

    private fun adset(id: String, name: String, ads: List<AdItem>, status: String = "ACTIVE") =
        AdSet(id, name, status, status, "CONVERSATIONS", 1000.0, null, null, null, emptyList(), metrics(100.0), ads)

    private fun campaign(id: String, name: String, sets: List<AdSet>, status: String = "ACTIVE", spend: Double = 0.0, issues: List<String> = emptyList()) =
        AdCampaign(id, name, status, status, "OUTCOME_ENGAGEMENT", 1000.0, null, null, issues, metrics(spend), null, sets)

    private val tree = listOf(
        campaign("1", "Bridal rings", listOf(adset("11", "Karachi", listOf(ad("111", "Ruby ring", spend = 500.0, ctr = 2.0), ad("112", "Pearl set", "PAUSED", 900.0, 1.0)))), spend = 1400.0),
        campaign("2", "Eid gifts", listOf(adset("21", "Lahore", listOf(ad("211", "Gift box", "DISAPPROVED", 100.0, 3.0)))), status = "PAUSED", spend = 100.0),
        campaign("3", "Quiet one", listOf(adset("31", "All", listOf(ad("311", "Chain", issues = listOf("The link is broken"))))), spend = 50.0),
    )

    @Test fun campaignsAreFilteredByStatusOrProblem() {
        assertEquals(listOf("1", "3"), AdsCampaignsLogic.shown(tree, AdsFilter.running, "").map { it.id })
        assertEquals(listOf("2"), AdsCampaignsLogic.shown(tree, AdsFilter.paused, "").map { it.id })
        // A problem anywhere underneath counts: a rejected ad, an ad with issues.
        assertEquals(listOf("2", "3"), AdsCampaignsLogic.shown(tree, AdsFilter.problems, "").map { it.id })
        assertEquals(3, AdsCampaignsLogic.shown(tree, AdsFilter.all, "").size)
    }

    @Test fun searchNeedsEveryWordSomewhereInTheTree() {
        assertEquals(listOf("1"), AdsCampaignsLogic.shown(tree, AdsFilter.all, "karachi pearl").map { it.id })
        assertEquals(emptyList(), AdsCampaignsLogic.shown(tree, AdsFilter.all, "karachi chain").map { it.id })
        assertEquals(listOf("2"), AdsCampaignsLogic.shown(tree, AdsFilter.all, "  EID ").map { it.id })
    }

    @Test fun theGalleryIsEveryAdInTheChosenOrder() {
        assertEquals(listOf("112", "111", "211", "311"), AdsCampaignsLogic.gallery(tree, AdsFilter.all, AdsSort.spend).map { it.id })
        assertEquals(listOf("211", "111", "112", "311"), AdsCampaignsLogic.gallery(tree, AdsFilter.all, AdsSort.ctr).map { it.id })
        assertEquals(listOf("311", "211", "112", "111"), AdsCampaignsLogic.gallery(tree, AdsFilter.all, AdsSort.byName).map { it.id })
        assertEquals(listOf("112"), AdsCampaignsLogic.gallery(tree, AdsFilter.paused, AdsSort.spend).map { it.id })
        assertEquals(listOf("211", "311"), AdsCampaignsLogic.gallery(tree, AdsFilter.problems, AdsSort.spend).map { it.id })
    }

    @Test fun theLinesACampaignWrites() {
        assertEquals("All campaigns: PKR 1,550 spent · 9,000 views", AdsCampaignsLogic.summary(3, 3, 1550.0, 9000.0, "PKR"))
        assertEquals("2 of 3 campaigns: PKR 1,500 spent · 12k views", AdsCampaignsLogic.summary(2, 3, 1500.0, 12_000.0, "PKR"))
        assertEquals("PKR 1,000 a day", AdsCampaignsLogic.budget(1000.0, null, "PKR"))
        assertEquals("PKR 30,000 in total", AdsCampaignsLogic.budget(null, 30_000.0, "PKR"))
        assertEquals("", AdsCampaignsLogic.budget(0.0, 0.0, "PKR"))
        val m = metrics(12_000.0, chats = 45.0)
        assertEquals(
            "PKR 12,000 · up 20% on before · 45 chats started · PKR 267 each · 1,000 reached",
            AdsCampaignsLogic.numbers(m, "CONVERSATIONS", AdMetrics(spend = 10_000.0), "PKR"),
        )
        assertEquals("PKR 12,000 · 1,000 reached", AdsCampaignsLogic.numbers(m, null, null, "PKR"))
        assertEquals("/ads/object?level=adset&id=1200%2F3", AdsCampaignsLogic.objectPath("adset", "1200/3"))
        assertEquals("Engagement · 1 ad set", AdsCampaignsLogic.campaignBits(tree[0]))
    }

    // MARK: Budget

    private fun target(daily: Double? = 1000.0, lifetime: Double? = null, end: String? = null) =
        AdsBudgetTarget("campaign", "5", "Rings", daily, lifetime, end, "PKR")

    @Test fun aDailyBudgetOpensOnItsOwnAmountAndEndsNowhere() {
        val m = AdsBudgetModel.start(target())
        assertTrue(m.isDaily)
        assertEquals("1000", m.amount)
        assertFalse(m.hasEnd)
        assertEquals("PKR 1,000 a day", m.nowLine)
        assertEquals("no end", m.endsLine)
        assertNull(m.endAfter)
        // Nothing changes until it has: no amount change, no end change.
        assertFalse(m.budgetChanged)
        assertFalse(m.endChanged)
    }

    @Test fun aTotalBudgetNeedsAnEndAndKeepsItsKind() {
        val m = AdsBudgetModel.start(target(daily = null, lifetime = 30_000.0, end = "2026-10-20T10:00:00.000Z"))
        assertFalse(m.isDaily)
        assertEquals("30000", m.amount)
        assertNotNull(m.endAfter)
        assertEquals("PKR 30,000 in total", m.nowLine)
        // The chosen day's last minute in Karachi: 23:59 +05:00 on the 20th.
        assertEquals(Instant.parse("2026-10-20T18:59:00Z"), m.endAfter)
        assertFalse(m.endChanged)
    }

    @Test fun reviewSaysBeforeAndAfterInMoney() {
        val m = AdsBudgetModel(target(), "2,500", hasEnd = true, endDay = Instant.parse("2026-10-20T10:00:00Z"))
        assertEquals(2500.0, m.after)
        assertTrue(m.budgetChanged)
        assertTrue(m.endChanged)
        val lines = m.review.split("\n")
        assertEquals("Budget: PKR 1,000 a day → PKR 2,500 a day", lines[0])
        assertEquals("About PKR 76,000 a month (was PKR 30,400)", lines[1])
        assertTrue(lines[2].startsWith("Ends: no end → "))
        assertEquals("Meta starts spending at the new budget at once.", lines.last())
        assertEquals(listOf("About PKR 76,000 a month at this budget." to false, "That more than doubles what it spends." to true), m.noteLines)
    }

    @Test fun anAmountThatIsNotAboveZeroCannotBeReviewed() {
        assertNull(AdsBudgetModel(target(), "", false, now).after)
        assertNull(AdsBudgetModel(target(), "0", false, now).after)
        assertNull(AdsBudgetModel(target(), "abc", false, now).after)
        assertEquals(listOf("A budget above zero." to false), AdsBudgetModel(target(), "", false, now).noteLines)
        assertFalse(AdsBudgetModel(target(), "1000.001", false, now).budgetChanged)
    }

    @Test fun plainAmountsKeepCentsOnlyWhenThereAreSome() {
        assertEquals("1000", AdsBudgetModel.plain(1000.0))
        assertEquals("1000.50", AdsBudgetModel.plain(1000.5))
    }

    // MARK: Who sees it

    @Test fun aCityTakesAMarginAndReplacesALonePakistan() {
        val karachi = AdsPlace("city", "2490299", "Karachi", "Sindh, Pakistan")
        val a = AdsAudienceEdit.add(AdsAudience(), karachi)
        assertEquals(listOf("Karachi"), a.places.map { it.name })
        assertEquals(25.0, a.places[0].radiusKm)
        // A second place beside a city keeps both; a country beside many places keeps them all.
        val b = AdsAudienceEdit.add(a, AdsPlace("city", "1", "Lahore"))
        assertEquals(listOf("Karachi", "Lahore"), b.places.map { it.name })
        assertEquals(listOf("Karachi", "Lahore", "Pakistan"), AdsAudienceEdit.add(b, AdsPlace.pakistan).places.map { it.name })
        // The same place twice is one.
        assertEquals(2, AdsAudienceEdit.add(b, karachi).places.size)
        assertEquals(listOf("Lahore"), AdsAudienceEdit.remove(b, karachi).places.map { it.name })
        assertEquals(40.0, AdsAudienceEdit.setRadius(b, karachi, 40.0).places[0].radiusKm)
        assertNull(AdsAudienceEdit.setRadius(b, karachi, null).places[0].radiusKm)
    }

    @Test fun anAgeRangeNeverEndsBeforeItStarts() {
        val a = AdsAudienceEdit.ageFrom(AdsAudience(ageMin = 18, ageMax = 30), 40)
        assertEquals(40, a.ageMin)
        assertEquals(40, a.ageMax)
        assertEquals(30, AdsAudienceEdit.ageFrom(AdsAudience(ageMin = 18, ageMax = 50), 30).ageMax - 20)
    }

    @Test fun theShopsAudiencesAreReachedLeftOutOrNotUsed() {
        val row = AdsAudienceRow("120", "Buyers", "Customer list", 1000.0, 1500.0, true, null, null)
        var a = AdsAudienceEdit.setUse(AdsAudience(), row, "include")
        assertEquals("include", AdsAudienceEdit.use(a, "120"))
        assertEquals(listOf(AdsNamed("120", "Buyers")), a.include)
        a = AdsAudienceEdit.setUse(a, row, "exclude")
        assertEquals("exclude", AdsAudienceEdit.use(a, "120"))
        assertTrue(a.include.isEmpty())
        a = AdsAudienceEdit.setUse(a, row, "off")
        assertEquals("off", AdsAudienceEdit.use(a, "120"))
        assertEquals("1,000–1,500", row.sizeWords)
        assertEquals("12k–15k", row.copy(lower = 12_000.0, upper = 15_000.0).sizeWords)
    }

    @Test fun instagramPositionsAreSwitchedOneByOne() {
        val a = AdsAudienceEdit.position(AdsAudience(), "reels", false)
        assertEquals(listOf("stream", "story"), a.igPositions)
        assertEquals(listOf("stream", "story", "profile_feed"), AdsAudienceEdit.position(a, "profile_feed", true).igPositions)
        assertEquals(listOf("stream", "story"), AdsAudienceEdit.position(a, "story", true).igPositions)
        assertEquals(listOf(17, 25, 40, 60, 80), AdsAudienceEdit.radiusOptions("city"))
        assertEquals(1, AdsAudienceEdit.radiusOptions("pin").first())
    }

    // MARK: Rules

    private val kinds = listOf(AdsHinted("pause_no_results", "Pause what's wasting money", "Pauses an ad set that spent this much with no results.", "spend"))

    @Test fun aRuleSaysWhatItWillDoWithTheAmountIn() {
        val k = kinds[0]
        assertEquals("Pause what's wasting money — PKR 500", AdsRulesLogic.newRuleName(k, 500.0, "PKR"))
        val words = AdsRulesLogic.newRuleWords("pause_no_results", k, 500.0, "PKR")
        assertTrue(words.startsWith("Pauses an ad set that spent PKR 500 with no results.\nMeta checks it itself around the clock"))
        assertTrue(words.contains("It pauses ad sets by itself"))
        assertTrue(AdsRulesLogic.newRuleWords("notify_cost", k, 500.0, "PKR").contains("It only sends a Facebook notification"))
        assertEquals("Rule — PKR 0", AdsRulesLogic.newRuleName(null, null, "PKR"))
    }

    @Test fun theLogReadsInWords() {
        fun row(json: String) = AdsLogRow.from(Json.parse(json))!!
        assertEquals("budget → PKR 1,500 a day", row("""{"id":"1","action":"budget","detail":{"daily":1500}}""").words("PKR"))
        assertEquals("budget → PKR 30,000 in total", row("""{"id":"2","action":"budget","detail":{"lifetime":30000,"currency":"PKR"}}""").words("USD"))
        assertEquals("renamed “New name”", row("""{"id":"3","action":"rename","detail":{"name":"New name"}}""").words("PKR"))
        assertEquals("no end date", row("""{"id":"4","action":"schedule","detail":{"end":null}}""").words("PKR"))
        assertTrue(row("""{"id":"5","action":"schedule","detail":{"end":"2026-10-20T10:00:00.000Z"}}""").words("PKR").startsWith("end date "))
        assertEquals("status", row("""{"id":"6","action":"status"}""").words("PKR"))
    }

    // MARK: Setup

    private fun status(json: String) = AdsStatusAnswer.from(Json.parse(json))!!

    @Test fun readyNeedsAConnectionAndAnAdAccount() {
        assertFalse(status("""{"connection":{"connected":true},"settings":{}}""").ready)
        assertFalse(status("""{"connection":{"connected":false},"settings":{"adAccountId":"1"}}""").ready)
        val s = status("""{"connection":{"connected":true},"settings":{"adAccountId":" act_1 "},"account":{"id":"act_1","currency":"USD"}}""")
        assertTrue(s.ready)
        assertEquals("act_1", s.settings!!.adAccountId)
        assertEquals("USD", s.currency)
    }

    @Test fun whatIsStillWrongIsToldFirst() {
        val s = status(
            """{"app":{"id":"123","secret":true,"tokenSecret":"meta-ads-token","tokenStore":{"exists":true,"write":false},"live":{"privacyPolicyUrl":"","category":"x","icon":true}},
                "connection":{"connected":true,"missingScopes":["ads_management","pages_show_list"]},"settings":{"adAccountId":"1"}}""",
        )
        val pixel = AdsPixelAnswer.from(Json.parse("""{"pixels":[],"state":{"id":null,"live":false,"sites":[{"url":"https://www.made-up.example/","ids":["555"],"loader":false}]}}"""))
        val lines = AdsSetupLogic.readiness(s, pixel)
        assertEquals(4, lines.size)
        assertTrue(lines[0].startsWith("The Meta app is still in Development"))
        assertTrue(lines[1].startsWith("This ERP can't save the Meta login (meta-ads-token)"))
        assertEquals("The Facebook login lacks ads_management, pages_show_list: add them to the login configuration and connect again.", lines[2])
        assertEquals("The shop's site already carries a Meta pixel (555) but ads don't use it yet: choose it in step 8.", lines[3])
        // Not connected: nothing to say yet.
        assertTrue(AdsSetupLogic.readiness(status("""{"app":{"id":"1"}}"""), null).isEmpty())
    }

    @Test fun theConnectionAndTheTokenStoreAreSaidPlainly() {
        assertEquals("Connected as Made Up.", AdsSetupLogic.connectedLine(AdsStatusAnswer.Connection(true, "user", "Made Up", 30, emptyList(), null)))
        assertEquals("Connected (a system user: never expires).", AdsSetupLogic.connectedLine(AdsStatusAnswer.Connection(true, "system", null, null, emptyList(), null)))
        val app = AdsStatusAnswer.App.fromMap(mapOf("tokenSecret" to "meta-ads-token", "project" to "made-up-project", "tokenStore" to mapOf("exists" to false, "write" to false)))
        assertTrue(AdsSetupLogic.tokenLine(app).startsWith("The connection store meta-ads-token doesn't exist in made-up-project yet"))
        assertEquals("Connection store meta-ads-token is ready.", AdsSetupLogic.tokenLine(app.copy(tokenStoreWrite = true)))
        assertTrue(AdsSetupLogic.wrongHouse("houseofmina__", "collectionstaheri"))
        assertFalse(AdsSetupLogic.wrongHouse("houseofmina__", "HouseOfMina__"))
        assertFalse(AdsSetupLogic.wrongHouse(null, "x"))
    }

    @Test fun thePixelLineListsWhatThePixelSaw() {
        val st = AdsPixelState.from(Json.parse("""{"id":"555","live":true,"events":{"Purchase":4,"PageView":1204,"AddToCart":31,"Search":0,"Custom":2}}"""))!!
        assertEquals("1,204 page views · 31 added to cart · 4 orders · 2 Custom", st.eventLine)
        assertEquals(4.0, st.purchases)
        assertEquals("nothing", AdsPixelState.from(Json.parse("""{"events":{}}"""))!!.eventLine)
        assertEquals("", AdsPixelState.from(Json.parse("""{"id":"1"}"""))!!.eventLine)
        val sites = AdsPixelState.from(Json.parse("""{"sites":[{"url":"https://www.a.example/x","ids":["1","2"]},{"url":"https://b.example","ids":null}]}"""))!!
        assertEquals(listOf("1", "2"), sites.carried)
        assertEquals("a.example", sites.sitesCarrying("2"))
        assertEquals("b.example", sites.sites[1].host)
    }

    // MARK: The account's alerts

    @Test fun anAccountInTroubleIsToldAtTheTopOfEveryPage() {
        val trouble = status("""{"account":{"id":"1","name":"Made Up","status":3,"amountSpent":95,"spendCap":100},"connection":{"connected":true,"kind":"user","daysLeft":2},"accountError":"No answer."}""")
        val alerts = adsAlerts(trouble)
        assertEquals(4, alerts.size)
        assertEquals("Made Up: Payment due. A payment failed. Settle the balance in Ads Manager → Billing, and ads start again.", alerts[0].text)
        assertTrue(alerts[0].bad)
        assertTrue(alerts[1].text.startsWith("The account has spent 95% of its spending limit."))
        assertFalse(alerts[1].bad)
        assertEquals("The Meta connection runs out in 2 days. Connect again on Setup to keep the Ads pages working (running ads are not affected).", alerts[2].text)
        assertTrue(alerts[2].bad)
        assertEquals("Meta didn't answer for the ad account: No answer.", alerts[3].text)
        assertTrue(adsAlerts(status("""{"account":{"id":"1","status":1},"connection":{"connected":true,"kind":"system","daysLeft":1}}""")).isEmpty())
    }

    @Test fun notReadySaysWhichStepIsNext() {
        assertEquals("Meta ads aren't set up for this shop yet", notReadyTitle(status("{}")))
        assertEquals("Connect the shop's Meta ad account", notReadyTitle(status("""{"app":{"id":"1","secret":true}}""")))
        assertEquals("Connect again on Setup.", notReadyDetail(status("""{"app":{"id":"1","secret":true},"connection":{"connected":false}}""")))
        assertEquals("Choose the ad account for this shop", notReadyTitle(status("""{"app":{"id":"1","secret":true},"connection":{"connected":true}}""")))
    }

    // MARK: Who may use the pages

    @Test fun theAdsPagesAnswerOwnersAndMarketingAccountsOnly() {
        assertTrue(adsMayUse("owner"))
        assertTrue(adsMayUse("marketing"))
        assertFalse(adsMayUse("staff"))
        assertFalse(adsMayUse("karigar"))
        assertFalse(adsMayUse("none"))
    }

    @Test fun metasTimesWithoutAColonAreRead() {
        // Meta writes "+0500", the ERP's own dates "+05:00" or "Z": all the same instant.
        assertEquals(Instant.parse("2026-10-14T18:59:00Z"), AdsDays.parse("2026-10-14T23:59:00+0500"))
        assertEquals(Instant.parse("2026-10-14T18:59:00Z"), AdsDays.parse("2026-10-14T23:59:00+05:00"))
        assertEquals(Instant.parse("2026-10-14T18:59:00Z"), AdsDays.parse("2026-10-14T18:59:00.000Z"))
        assertEquals(Instant.parse("2026-10-14T00:00:00Z"), AdsDays.parse("2026-10-14"))
        assertNull(AdsDays.parse(null))
        assertNull(AdsDays.parse("soon"))
        assertEquals("ends Wed 14 Oct", AdsCampaignsLogic.campaignBits(tree[0].copy(stopTime = "2026-10-14T23:59:00+0500")).substringAfterLast(" · "))
    }

    @Test fun karachiDaysStartAndEndAtTheirOwnMidnights() {
        // 2026-10-12 08:00Z is 13:00 in Karachi: that day began at 19:00Z the day before and ends a minute before the next.
        assertEquals(Instant.parse("2026-10-11T19:00:00Z"), AdsDays.startOfDay(now))
        assertEquals(Instant.parse("2026-10-12T18:59:00Z"), AdsDays.endOfDay(now))
    }

    @Test fun detailsAreTitledLikeTheWebsKeys() {
        assertEquals("Effective Status", adsTitleCase("effective_status"))
        assertEquals("5", adsPrint(5.0))
        assertEquals("5.5", adsPrint(5.5))
        assertEquals("text", adsPrint("text"))
    }

    @Test fun websitePiecesShowNewArrivalsFirstAndSearchReachesTheRest() {
        fun piece(id: String, name: String, new: Boolean = false) = AdsSitePiece(id, name, "", "", "Rings", null, listOf("Gold"), new, false)
        val all = listOf(piece("1", "Old kara"), piece("2", "New ruby ring", true), piece("3", "Pearl"))
        assertEquals(listOf("2", "1", "3"), adsShownPieces(all, "").map { it.id })
        assertEquals(listOf("1"), adsShownPieces(all, "kara gold").map { it.id })
        assertEquals(30, adsShownPieces(List(40) { piece("$it", "P$it") }, "").size)
    }
}
