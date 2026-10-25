package erp.app.screens.ads

import erp.app.data.ErpApi
import erp.app.data.JsonText
import erp.app.ui.AppClock
import erp.core.Json
import java.time.Instant
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * What the iPhone added on 2026-10-17 (AdsTests.swift, AdsNewAdSources.swift, AdsKit.swift's sales), on made-up numbers:
 * sales and ROAS, the CSV's address, website audiences, a video's upload, a creator's post, the catalogue, bidding and
 * hours, A/B tests. The JSON the routes take is held key for key.
 */
class AdsSourcesTests {
    private val now = Instant.parse("2026-10-12T08:00:00Z")

    @Before fun pin() { AppClock.pinned = now }

    @After fun unpin() { AppClock.pinned = null }

    private fun text(v: Any?) = JsonText.of(v, sorted = true)

    // MARK: Sales and ROAS

    private val sold = AdMetrics.from(
        Json.parse("""{"spend":38400,"reach":71000,"actions":{"omni_purchase":9,"offsite_conversion.fb_pixel_purchase":7,"link_click":2400},"values":{"omni_purchase":223000,"purchase":210000}}"""),
    )!!

    @Test fun salesTakeTheBiggestNameForAPurchaseNeverTheirSum() {
        val s = AdsResults.sales(sold)
        assertEquals(9.0, s.purchases)
        assertEquals(223000.0, s.value)
        assertEquals(223000.0 / 38400.0, s.roas!!, 1e-9)
        assertEquals(38400.0 / 9.0, s.costPerPurchase!!, 1e-9)
    }

    @Test fun noSpendHasNoRoasAndNoPurchasesNoCostEach() {
        val s = AdsResults.sales(AdMetrics(spend = 0.0, values = mapOf("omni_purchase" to 500.0)))
        assertNull(s.roas)
        assertNull(AdsResults.sales(AdMetrics(spend = 100.0)).costPerPurchase)
        assertEquals(0.0, AdsResults.sales(AdMetrics()).value)
    }

    @Test fun roasReadsLikeTheWeb() {
        assertEquals("5.8×", AdsResults.roasText(5.807))
        assertEquals("12×", AdsResults.roasText(12.4))
        assertEquals("0.0×", AdsResults.roasText(0.0))
        assertEquals("—", AdsResults.roasText(null))
        assertEquals("—", AdsResults.roasText(Double.POSITIVE_INFINITY))
    }

    @Test fun metricsReadTheirValuesLeniently() {
        assertEquals(mapOf("omni_purchase" to 223000.0, "purchase" to 210000.0), sold.values)
        assertTrue(AdMetrics.from(Json.parse("""{"spend":1,"values":"nope"}"""))!!.values.isEmpty())
        assertEquals(12.5, AdMetrics.from(Json.parse("""{"values":{"omni_purchase":"12.5","x":{}}}"""))!!.values["omni_purchase"])
    }

    @Test fun purchasesLeadTheHeadlineResult() {
        val chats = "onsite_conversion.messaging_conversation_started_7d"
        val h = AdsResults.headlineResult(AdMetrics(actions = mapOf(chats to 40.0, "omni_purchase" to 3.0)))
        assertEquals("omni_purchase", h.key)
        assertEquals("Purchases", h.label)
        assertEquals("Chats started", AdsResults.headlineResult(AdMetrics(actions = mapOf(chats to 40.0))).label)
        // The pixel's own name counts too, and a sale of none falls through.
        assertEquals("offsite_conversion.fb_pixel_purchase", AdsResults.headlineResult(AdMetrics(actions = mapOf("offsite_conversion.fb_pixel_purchase" to 2.0))).key)
        assertEquals("link_click", AdsResults.headlineResult(AdMetrics(actions = mapOf("omni_purchase" to 0.0, "link_click" to 9.0))).key)
    }

    @Test fun aCampaignsLineAddsSalesAndRoasWhenThereAreSales() {
        val line = AdsCampaignsLogic.numbers(sold, "CONVERSATIONS", null, "PKR")
        assertTrue(line.contains("PKR 2.23 lac sales · 5.8× ROAS"), line)
        assertTrue(line.endsWith("71k reached"), line)
        assertFalse(AdsCampaignsLogic.numbers(AdMetrics(spend = 100.0), null, null, "PKR").contains("ROAS"))
    }

    @Test fun theTopAdsLineCarriesRoasToo() {
        val ad = AdTop("1", "Ring", "Bridal", null, "OFFSITE_CONVERSIONS", sold)
        assertTrue(resultLine(ad, "PKR").endsWith(" · 5.8× ROAS"), resultLine(ad, "PKR"))
        assertEquals("5,000 reached", resultLine(AdTop("2", "Set", "Bridal", null, null, AdMetrics(reach = 5000.0)), "PKR"))
    }

    @Test fun bestRoasIsASortOfTheGallery() {
        fun ad(id: String, spend: Double, value: Double?) = AdItem(
            id, id, "ACTIVE", "ACTIVE", null, emptyList(),
            AdMetrics(spend = spend, values = if (value == null) emptyMap() else mapOf("omni_purchase" to value)),
        )
        assertEquals("roas", AdsSort.roas.key)
        assertEquals("Best ROAS", AdsSort.roas.label)
        // Order: 4x, 2x, then the two with no sales (no spend and no value are last).
        val ranked = listOf(ad("a", 100.0, 200.0), ad("b", 100.0, 400.0), ad("c", 100.0, null), ad("d", 0.0, null))
            .sortedByDescending { AdsResults.sales(it.metrics).roas ?: -1.0 }
        assertEquals(listOf("b", "a", "c"), ranked.take(3).map { it.id })
        assertEquals("d", ranked.last().id)
    }

    // MARK: The CSV

    @Test fun theCsvIsTheServersOwnForTheRange() {
        assertEquals("/api/ads/campaigns?range=last_7d&format=csv", AdsCampaignsLogic.csvPath("last_7d", false))
        assertEquals("/api/ads/campaigns?range=this_month&format=csv&archived=1", AdsCampaignsLogic.csvPath("this_month", true))
        assertEquals("ads-last_7d-2026-10-12.csv", AdsCampaignsLogic.csvName("last_7d", "2026-10-12"))
    }

    // MARK: Website audiences

    @Test fun theWebsiteAudienceBodyIsKindDaysEvent() {
        assertEquals("""{"days":180,"event":"Purchase","kind":"website"}""", text(AdsAudiencesLogic.websiteBody("Purchase", 180)))
    }

    @Test fun theAudiencesAnswerCarriesTheWebsiteEventsAndWhetherThereIsAPixel() {
        val a = AdsAudiencesAnswer.from(
            Json.parse("""{"audiences":[],"segments":[],"events":[],"websiteEvents":[{"key":"Purchase","label":"Bought","hint":"Ordered"},{"key":"","label":"x"}],"pixel":true}"""),
        )!!
        assertEquals(listOf("Purchase"), a.websiteEvents.map { it.key })
        assertEquals("Ordered", a.websiteEvents[0].hint)
        assertTrue(a.pixel)
        val none = AdsAudiencesAnswer.from(Json.parse("{}"))!!
        assertTrue(none.websiteEvents.isEmpty())
        assertFalse(none.pixel)
    }

    // MARK: A new video

    private class Fake(val file: ByteArray) : AdsVideoSource {
        override val size: Long get() = file.size.toLong()
        override fun read(start: Long, length: Int): ByteArray = file.copyOfRange(start.toInt(), minOf(file.size, start.toInt() + length))
    }

    private class VideoBackend(
        val size: Int,
        val piece: Int,
        val failFirst: Int = 0,
        val statuses: List<AdsVideoStatus>,
    ) : AdsBackend by AdsAPI {
        val sent = ArrayList<Pair<Int, Int>>()
        var finished: Pair<String, String>? = null
        var failures = 0
        var polls = 0

        override suspend fun videoStart(size: Int) = AdsVideoStarted("sess", "vid9", 0, minOf(piece, size))

        override suspend fun videoPiece(session: String, start: Int, chunk: ByteArray): AdsVideoRange {
            if (failures < failFirst) { failures += 1; throw ErpApi.Failure(502, "The ERP answered 502.") }
            sent.add(start to chunk.size)
            val next = start + chunk.size
            return AdsVideoRange(next, if (next >= size) next else minOf(size, next + piece))
        }

        override suspend fun videoFinish(session: String, name: String) { finished = session to name }

        override suspend fun videoStatus(id: String): AdsVideoStatus = statuses[minOf(polls++, statuses.size - 1)]
    }

    private fun upload(b: VideoBackend, bytes: Int = 10): List<AdsVideoDraft> {
        val seen = ArrayList<AdsVideoDraft>()
        runBlocking { AdsVideoUpload.send(Fake(ByteArray(bytes) { it.toByte() }), "Video", b, { seen.add(it) }, pause = {}) }
        return seen
    }

    @Test fun aVideoGoesInTheLengthsMetaAsksForThenWaitsForTheCover() {
        val b = VideoBackend(10, 4, statuses = listOf(AdsVideoStatus("processing", "", null, null), AdsVideoStatus("ready", "hash1", "https://img.example/c.jpg", null)))
        val seen = upload(b)
        assertEquals(listOf(0 to 4, 4 to 4, 8 to 2), b.sent)
        assertEquals("sess" to "Video", b.finished)
        assertEquals(listOf(0.4, 0.8, 1.0), seen.take(3).map { it.sent })
        assertEquals(AdsVideoDraft.Phase.processing, seen[3].phase)
        val ready = seen.last()
        assertEquals(AdsVideoDraft.Phase.ready, ready.phase)
        assertEquals("""{"kind":"video","name":"Video","thumb":"https://img.example/c.jpg","thumbHash":"hash1","videoId":"vid9"}""", text(ready.json))
    }

    @Test fun aPieceThatFailsIsTriedAgainThreeTimesThenTheErrorStays() {
        val ok = VideoBackend(10, 10, failFirst = 2, statuses = listOf(AdsVideoStatus("ready", "h", null, null)))
        assertEquals(AdsVideoDraft.Phase.ready, upload(ok).last().phase)
        val bad = VideoBackend(10, 10, failFirst = 3, statuses = listOf(AdsVideoStatus("ready", "h", null, null)))
        val last = upload(bad).last()
        assertEquals(AdsVideoDraft.Phase.failed, last.phase)
        assertEquals("The ERP answered 502.", last.error)
    }

    @Test fun metaRefusingTheVideoSaysToTryAnMp4() {
        val last = upload(VideoBackend(10, 10, statuses = listOf(AdsVideoStatus("error", "", null, "bad codec")))).last()
        assertEquals(AdsVideoDraft.Phase.failed, last.phase)
        assertEquals("Meta couldn't process the video (bad codec). Try exporting it as an MP4.", last.error)
    }

    @Test fun anEmptyVideoNeverStarts() {
        val seen = ArrayList<AdsVideoDraft>()
        val b = VideoBackend(0, 4, statuses = listOf(AdsVideoStatus("ready", "h", null, null)))
        runBlocking { AdsVideoUpload.send(Fake(ByteArray(0)), "Video", b, { seen.add(it) }, pause = {}) }
        assertEquals("That video is empty.", seen.single().error)
        assertTrue(b.sent.isEmpty())
    }

    @Test fun theCoverHashIsEmptyUntilTheVideoIsReady() {
        val d = AdsVideoDraft("V", AdsVideoDraft.Phase.processing, videoId = "9", thumbHash = "h")
        assertEquals("", d.json["thumbHash"])
        assertTrue(d.busy)
        assertFalse(d.copy(phase = AdsVideoDraft.Phase.ready).busy)
    }

    // MARK: Each source in the plan

    private val lists = AdsNewAdLists.from(
        Json.parse(
            """{"goals":[
              {"key":"whatsapp","label":"WhatsApp chats","hint":"","objective":"OUTCOME_ENGAGEMENT","optimization":"CONVERSATIONS","newAd":true},
              {"key":"website","label":"Website visits","hint":"","objective":"OUTCOME_TRAFFIC","optimization":"LINK_CLICKS","toSite":true,"photosOnly":true,"newAd":true},
              {"key":"engagement","label":"Engagement","hint":"","objective":"OUTCOME_ENGAGEMENT","optimization":"POST_ENGAGEMENT","postOnly":true,"newAd":true},
              {"key":"profile","label":"Profile visits","hint":"","objective":"OUTCOME_TRAFFIC","optimization":"PROFILE_VISIT","newAd":true},
              {"key":"sales","label":"Online orders","hint":"","objective":"OUTCOME_SALES","optimization":"OFFSITE_CONVERSIONS","toSite":true,"newAd":true},
              {"key":"reach","label":"Reach","hint":"","objective":"OUTCOME_AWARENESS","optimization":"REACH","newAd":true}],
             "buttons":[],"igPositions":[],"links":{"website":"https://made-up.example","shop":"","waChannel":""},"sitePieces":true,"quiet":[]}""",
        ),
    )!!

    private fun keys(d: AdsNewAdDraft) = d.offered(lists).map { it.key }

    @Test fun goalsOfferedFollowEachSource() {
        assertEquals(listOf("whatsapp", "engagement", "profile", "sales", "reach"), keys(AdsNewAdDraft(kind = AdsKind.post)))
        assertEquals(listOf("whatsapp", "website", "profile", "sales", "reach"), keys(AdsNewAdDraft(kind = AdsKind.photos)))
        // A video can't be a post-only goal nor a photos-only one.
        assertEquals(listOf("whatsapp", "profile", "sales", "reach"), keys(AdsNewAdDraft(kind = AdsKind.video)))
        // A creator's post: no profile visits or engagement, and no photos-only goal.
        assertEquals(listOf("whatsapp", "sales", "reach"), keys(AdsNewAdDraft(kind = AdsKind.partner)))
        assertEquals(listOf("sales"), keys(AdsNewAdDraft(kind = AdsKind.catalog)))
    }

    @Test fun aGoalTheSourceCannotCarryMovesToWhatsAppOrTheFirstItCan() {
        assertEquals("whatsapp", AdsNewAdDraft(kind = AdsKind.video, goalKey = "website").fitGoal(lists).goalKey)
        assertEquals("sales", AdsNewAdDraft(kind = AdsKind.catalog, goalKey = "whatsapp").fitGoal(lists).goalKey)
        assertEquals("reach", AdsNewAdDraft(kind = AdsKind.partner, goalKey = "reach").fitGoal(lists).goalKey)
    }

    @Test fun thePostAndTheCreatorsPostKeepTheirOwnWords() {
        assertTrue(AdsNewAdDraft(kind = AdsKind.post).asIs)
        assertTrue(AdsNewAdDraft(kind = AdsKind.partner).asIs)
        assertFalse(AdsNewAdDraft(kind = AdsKind.video).asIs)
        assertEquals(3, AdsNewAdDraft(kind = AdsKind.partner).step(4))
        assertEquals(4, AdsNewAdDraft(kind = AdsKind.catalog).step(4))
    }

    @Test fun thePlanOfAVideoNamesItsCover() {
        val d = AdsNewAdDraft(kind = AdsKind.video, video = AdsVideoDraft("Clip", AdsVideoDraft.Phase.ready, 1.0, "vid9", "hash1", "https://img.example/c.jpg"))
        val source = d.plan(now)["source"] as Map<*, *>
        assertEquals("""{"kind":"video","name":"Clip","thumb":"https://img.example/c.jpg","thumbHash":"hash1","videoId":"vid9"}""", text(source))
        // Before a video is chosen the plan still has the shape, empty.
        assertEquals("""{"kind":"video","thumbHash":"","videoId":""}""", text(AdsNewAdDraft(kind = AdsKind.video).plan(now)["source"]))
    }

    @Test fun thePlanOfACreatorsPostCarriesTheCodeAndWhatMetaSaidOfIt() {
        val checked = AdsPartnerCheck("kF3m", true, "m9", "madeupmaker", "https://example.com/p", null, null)
        val d = AdsNewAdDraft(kind = AdsKind.partner, partnerCode = "  kF3m ", partnerCheck = checked)
        assertEquals("""{"adCode":"kF3m","creator":"madeupmaker","kind":"partner","mediaId":"m9"}""", text(d.plan(now)["source"]))
        // A check of another code is forgotten.
        assertEquals("""{"adCode":"zzz","kind":"partner"}""", text(d.copy(partnerCode = "zzz").plan(now)["source"]))
    }

    @Test fun thePlanOfTheCatalogueNamesTheSetAndWhoItFinds() {
        val choice = AdsCatalogChoice(
            catalogs = listOf(AdsCatalogRow("c1", "Shop", 5)), catalogId = "c1",
            sets = listOf(AdsCatalogRow("s1", "All pieces", 412), AdsCatalogRow("s2", "Rings", 96)), setId = "s2", who = "everyone",
        )
        assertEquals("""{"catalogId":"c1","kind":"catalog","setId":"s2","setName":"Rings","who":"everyone"}""", text(choice.json))
        // No set read yet: no name to send.
        assertEquals("""{"catalogId":"c1","kind":"catalog","setId":"","who":"viewers"}""", text(AdsCatalogChoice(catalogId = "c1").json))
        assertEquals("Rings · 96 pieces", choice.sets!![1].words)
        assertEquals("Plain", AdsCatalogRow("x", "Plain", null).words)
    }

    @Test fun theCatalogueAnswersAreReadLeniently() {
        val a = AdsCatalogsAnswer.from(Json.parse("""{"catalogs":[{"id":"c1","name":"Shop","products":"12"},{"name":"no id"}],"sets":[{"id":"s1","name":"All"}]}"""))!!
        assertEquals(listOf("c1"), a.catalogs.map { it.id })
        assertEquals(12, a.catalogs[0].products)
        assertNull(a.sets[0].products)
    }

    @Test fun aPartnerCheckKeepsTheCodeItWasFor() {
        val backend = object : AdsBackend by AdsAPI {
            override suspend fun partnerCheck(code: String) = AdsPartnerCheck.from(Json.parse("""{"ok":true,"mediaId":"m1","creator":"someone"}"""))!!
        }
        val ok = runBlocking { AdsPartnerCheck.check(backend, "abc") }
        assertEquals("abc", ok.code)
        assertTrue(ok.ok)
        val down = object : AdsBackend by AdsAPI {
            override suspend fun partnerCheck(code: String): AdsPartnerCheck = throw ErpApi.Failure(500, "Meta didn't answer.")
        }
        val bad = runBlocking { AdsPartnerCheck.check(down, "abc") }
        assertFalse(bad.ok)
        assertEquals("Meta didn't answer.", bad.why)
        assertEquals("abc", bad.code)
    }

    @Test fun whatIsReadyToPreviewDependsOnTheSource() {
        assertFalse(AdsNewAdDraft(kind = AdsKind.video, video = AdsVideoDraft("V")).previewable)
        assertTrue(AdsNewAdDraft(kind = AdsKind.video, video = AdsVideoDraft("V", AdsVideoDraft.Phase.ready)).previewable)
        assertFalse(AdsNewAdDraft(kind = AdsKind.partner, partnerCode = "  ").previewable)
        assertTrue(AdsNewAdDraft(kind = AdsKind.partner, partnerCode = "x").previewable)
        assertFalse(AdsNewAdDraft(kind = AdsKind.catalog).previewable)
        assertTrue(AdsNewAdDraft(kind = AdsKind.catalog, catalog = AdsCatalogChoice(setId = "s")).previewable)
    }

    @Test fun theSendingVideoHoldsTheMakeButton() {
        assertTrue(AdsNewAdDraft(kind = AdsKind.video, video = AdsVideoDraft("V")).stillUploading)
        assertFalse(AdsNewAdDraft(kind = AdsKind.video, video = AdsVideoDraft("V", AdsVideoDraft.Phase.failed)).stillUploading)
    }

    // MARK: Bidding and hours

    @Test fun biddingIsLowestUnlessChosen() {
        assertEquals("""{"kind":"lowest"}""", text(AdsAdvanced().bidding))
        assertEquals("""{"amount":300,"kind":"cost_cap"}""", text(AdsAdvanced(bid = "cost_cap", amount = "300").bidding))
        assertEquals("""{"amount":1250,"kind":"bid_cap"}""", text(AdsAdvanced(bid = "bid_cap", amount = "1,250").bidding))
        assertEquals("""{"kind":"min_roas","roas":3.5}""", text(AdsAdvanced(bid = "min_roas", roas = "3.5").bidding))
        // Unreadable is zero, which the server says is not a bid.
        assertEquals("""{"amount":0,"kind":"cost_cap"}""", text(AdsAdvanced(bid = "cost_cap", amount = "x").bidding))
    }

    @Test fun hoursAreMinutesFromMidnightOrNothing() {
        assertNull(AdsAdvanced().hours)
        val h = AdsAdvanced(hoursOn = true, days = setOf(5, 1, 3), from = 10, to = 24).hours
        assertEquals("""{"days":[1,3,5],"from":600,"to":1440}""", text(h))
    }

    @Test fun thePlanCarriesBiddingAndHours() {
        val p = AdsNewAdDraft(advanced = AdsAdvanced(bid = "bid_cap", amount = "90", hoursOn = true)).plan(now)
        assertEquals("""{"amount":90,"kind":"bid_cap"}""", text(p["bidding"]))
        assertEquals("""{"days":[0,1,2,3,4,5,6],"from":600,"to":1380}""", text(p["hours"]))
        val plain = AdsNewAdDraft().plan(now)
        assertEquals("""{"kind":"lowest"}""", text(plain["bidding"]))
        assertTrue(plain.containsKey("hours"))
        assertNull(plain["hours"])
    }

    @Test fun theAdvancedLinesSayWhatEachChoiceDoes() {
        assertFalse(AdsAdvanced().isSet)
        assertTrue(AdsAdvanced(hoursOn = true).isSet)
        assertTrue(AdsAdvanced(bid = "bid_cap").isSet)
        assertEquals("Meta spends the budget for as many results as it can (the usual choice).", AdsAdvanced().note)
        assertTrue(AdsAdvanced(bid = "cost_cap", hoursOn = true).note.endsWith("Meta runs set hours only with a total budget."))
    }

    // MARK: A/B tests

    @Test fun twoToFiveAdSetsLetteredInOrder() {
        var picked = emptyList<String>()
        for (id in listOf("a", "b", "c", "d", "e", "f")) picked = AdsTestsLogic.toggle(picked, id)
        assertEquals(listOf("a", "b", "c", "d", "e"), picked)
        assertEquals(listOf("a", "c", "d", "e"), AdsTestsLogic.toggle(picked, "b"))
        assertEquals(listOf("A", "B", "C", "D", "E"), AdsTestsLogic.letters)
    }

    @Test fun aTestNeedsAName_TwoAdSets_AndNothingMidway() {
        assertFalse(AdsTestsLogic.mayStart("", listOf("a", "b"), false))
        assertFalse(AdsTestsLogic.mayStart("  ", listOf("a", "b"), false))
        assertFalse(AdsTestsLogic.mayStart("Name", listOf("a"), false))
        assertFalse(AdsTestsLogic.mayStart("Name", listOf("a", "b"), true))
        assertTrue(AdsTestsLogic.mayStart("Name", listOf("a", "b"), false))
    }

    @Test fun theTestBodyIsNameAdsetIdsDatesAndWhatToJudgeOn() {
        val body = AdsTestsLogic.body(" Packshot vs on-hand ", listOf("6001", "6002"), Instant.parse("2026-10-12T08:15:30.987Z"), Instant.parse("2026-10-19T08:00:00Z"), true)
        assertEquals("""{"adsetIds":["6001","6002"],"end":"2026-10-19T08:00:00Z","name":"Packshot vs on-hand","purchases":true,"start":"2026-10-12T08:15:30Z"}""", text(body))
    }

    @Test fun adSetsAreFoundByAnyWordOfTheirOwnOrTheirCampaignsName() {
        val sets = listOf(AdsTestAdset("1", "Karachi women", "Bridal season", "ACTIVE"), AdsTestAdset("2", "Lahore", "Eid gifts", "PAUSED"))
        assertEquals(listOf("1"), AdsTestsLogic.shown(sets, "bridal karachi").map { it.id })
        assertEquals(2, AdsTestsLogic.shown(sets, "  ").size)
        assertTrue(AdsTestsLogic.shown(sets, "pearl").isEmpty())
        assertEquals("campaign paused", AdsTestsLogic.status("CAMPAIGN_PAUSED"))
    }

    @Test fun theTestsAnswerIsReadLeniently() {
        val a = AdsTestsAnswer.from(
            Json.parse(
                """{"tests":[{"id":"t1","name":"X vs Y","start":"2026-10-08T09:00:00Z","end":"2026-10-15T09:00:00Z","running":true,"ahead":"B",
                    "cells":[{"name":"A","adsets":[{"name":"One"},{"name":"Two"}],"spend":100,"result":4,"resultLabel":"Chats started","costPerResult":25,"roas":null},{"name":"B","adsets":[]}]},{"name":"no id"}],
                   "adsets":[{"id":"6001","name":"One","campaign":"C","status":"ACTIVE"},{"name":"no id"}]}""",
            ),
        )!!
        assertEquals("PKR", a.currency)
        assertEquals(listOf("t1"), a.tests.map { it.id })
        val cells = a.tests[0].cells
        assertEquals(listOf("One", "Two"), cells[0].adsets)
        assertEquals(25.0, cells[0].costPerResult)
        assertNull(cells[0].roas)
        assertEquals("Results", cells[1].resultLabel)
        assertEquals(0.0, cells[1].spend)
        assertEquals("B", a.tests[0].ahead)
        assertEquals(listOf("6001"), a.adsets.map { it.id })
    }

    @Test fun theConfirmationAndTheVerdictLink() {
        assertEquals(
            "https://adsmanager.facebook.com/adsmanager/manage/experiments?act=123",
            AdsTestsLogic.verdictUrl("act_123"),
        )
        val say = AdsTestsLogic.confirmMessage(3, Instant.parse("2026-10-12T08:15:00Z"), Instant.parse("2026-10-19T08:15:00Z"))
        assertTrue(say.startsWith("3 ad sets, an even split, "), say)
        assertTrue(say.endsWith("Meta keeps the people who see each one apart; the ad sets spend their own budgets as before."), say)
        assertEquals(
            "B is ahead on cost per result so far. Give it the full run before deciding; Meta's verdict says how sure it is.",
            AdsTestsLogic.aheadLine("B"),
        )
    }
}
