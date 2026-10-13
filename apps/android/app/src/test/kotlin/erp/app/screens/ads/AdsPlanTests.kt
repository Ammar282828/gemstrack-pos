package erp.app.screens.ads

import erp.app.data.JsonText
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

/** New ad's and the designer's payloads (AdsPlanModels.swift, AdsNewAd.swift): the JSON the routes take, key for key. */
class AdsPlanTests {
    private val now = Instant.parse("2026-10-12T08:00:00Z")

    @Before fun pin() { AppClock.pinned = now }

    @After fun unpin() { AppClock.pinned = null }

    private fun text(v: Any?) = JsonText.of(v, sorted = true)

    private val defaultAudience = """{"advantage":true,"ageMax":65,"ageMin":18,"exclude":[],"gender":"all","igPositions":["stream","story","reels"],"include":[],"interests":[],"placements":"instagram","places":[{"key":"PK","name":"Pakistan","type":"country"}]}"""

    @Test fun theDefaultAudienceIsPakistanOnInstagram() {
        assertEquals(defaultAudience, text(AdsAudience().json))
        assertEquals("Pakistan · 18–65+ · everyone · Advantage+ · Instagram only", AdsAudience().words)
    }

    @Test fun anAudienceIsReadLeniently() {
        val a = AdsAudience.from(Json.parse("""{"places":[],"ageMin":"30","ageMax":20,"gender":"robots","interests":[{"id":"6","name":"Gold"},{"name":"nobody"}],"placements":"x","igPositions":[]}"""))!!
        assertTrue(a.places.isEmpty())
        assertEquals(30, a.ageMin)
        assertEquals(30, a.ageMax)
        assertEquals("all", a.gender)
        assertEquals(listOf("Gold"), a.interests.map { it.name })
        assertEquals("instagram", a.placements)
        assertEquals(listOf("stream", "story", "reels"), a.igPositions)
        // A missing list of places is Pakistan; an empty one stays empty (New ad then asks for a place).
        assertEquals(listOf(AdsPlace.pakistan), AdsAudience.from(Json.parse("{}"))!!.places)
    }

    @Test fun placesLabelAndWriteLikeTheWeb() {
        val city = AdsPlace("city", "2490299", "Karachi", "Sindh, Pakistan", 25.0)
        assertEquals("Karachi +25 km", city.label)
        assertEquals("""{"detail":"Sindh, Pakistan","key":"2490299","name":"Karachi","radiusKm":25,"type":"city"}""", text(city.json))
        assertEquals("Karachi", city.copy(radiusKm = null).label)
        val pin = AdsPlace("pin", "", "Dropped pin", null, 200.0, 24.86, 67.01)
        assertEquals("Dropped pin +80 km", pin.label)
        assertEquals("pin:24.86,67.01", pin.id)
        assertEquals("""{"lat":24.86,"lng":67.01,"name":"Dropped pin","radiusKm":10,"type":"pin"}""", text(pin.copy(radiusKm = null).json))
    }

    private fun photosDraft() = AdsNewAdDraft(
        kind = AdsKind.photos,
        photos = listOf(
            AdsPhoto("a", hash = "h1", url = "https://img.example/1.jpg", headline = "One", link = " "),
            AdsPhoto("b", hash = "h2"),
            AdsPhoto("c", uploading = true),
            AdsPhoto("d", hash = "h4", error = "No."),
        ),
        goalKey = "website", text = "A ring", headline = "Rings", link = "https://made-up.example/ring", button = "SHOP_NOW",
        amount = "1,500", days = 7, name = "  My ad ",
    )

    @Test fun thePlanOfNewPhotosIsTheRoutesOwnShape() {
        val expected = """{"audience":$defaultAudience,"budget":{"amount":1500,"end":"2026-10-19T08:00:00Z","kind":"daily","start":null},"button":"SHOP_NOW","goal":"website","headline":"Rings","launch":"paused","link":"https://made-up.example/ring","name":"My ad","source":{"kind":"photos","photos":[{"hash":"h1","headline":"One","url":"https://img.example/1.jpg"},{"hash":"h2","url":null}],"vertical":null},"text":"A ring"}"""
        assertEquals(expected, text(photosDraft().plan(now)))
    }

    @Test fun aSinglePhotoCarriesItsStoryVersion() {
        val d = photosDraft().copy(photos = listOf(AdsPhoto("a", hash = "h1", url = "u")), vertical = AdsPhoto("v", hash = "hv", url = "uv"))
        val source = d.plan(now)["source"] as Map<*, *>
        assertEquals("""{"hash":"hv","url":"uv"}""", text(source["vertical"]))
        // Two photos make a carousel: no story version.
        val two = photosDraft().copy(photos = d.photos + AdsPhoto("b", hash = "h2"), vertical = AdsPhoto("v", hash = "hv"))
        assertNull((two.plan(now)["source"] as Map<*, *>)["vertical"])
    }

    @Test fun thePlanOfAPostNamesTheMedia() {
        val d = AdsNewAdDraft(kind = AdsKind.post, post = AdsMedia("178", "Made up caption", "IMAGE", "https://t/1", "https://instagram.example/p/1", true, null), launch = "live")
        val p = d.plan(now)
        assertEquals("""{"caption":"Made up caption","kind":"post","mediaId":"178","permalink":"https://instagram.example/p/1","thumb":"https://t/1"}""", text(p["source"]))
        assertEquals("live", p["launch"])
        val bare = AdsNewAdDraft(kind = AdsKind.post, post = AdsMedia("9", "", "IMAGE", null, null, true, null)).plan(now)["source"]
        assertEquals("""{"caption":"","kind":"post","mediaId":"9","thumb":null}""", text(bare))
    }

    @Test fun theBudgetStartsNowOrLaterAndRunsForItsDays() {
        val later = Instant.parse("2026-10-14T09:30:00Z")
        val b = AdsNewAdDraft(startLater = true, start = later, days = 3, amount = "2000").budget(now)
        assertEquals(AdsBudget("daily", 2000.0, "2026-10-14T09:30:00Z", "2026-10-17T09:30:00Z"), b)
        assertNull(AdsNewAdDraft(days = null).budget(now).end)
        assertEquals(0.0, AdsNewAdDraft(amount = "abc").budget(now).amount)
    }

    @Test fun stepsMoveUpWhenAPostKeepsItsOwnWords() {
        assertEquals(3, AdsNewAdDraft(kind = AdsKind.post).step(4))
        assertEquals(4, AdsNewAdDraft(kind = AdsKind.photos).step(4))
    }

    private val lists = AdsNewAdLists(
        goals = listOf(
            AdsGoal("whatsapp", "WhatsApp chats", "", "OUTCOME_ENGAGEMENT", "CONVERSATIONS", postOnly = false, photosOnly = false, toSite = false, newAd = true),
            AdsGoal("engagement", "Engagement", "", "OUTCOME_ENGAGEMENT", "POST_ENGAGEMENT", postOnly = true, photosOnly = false, toSite = false, newAd = true),
            AdsGoal("website", "Website visits", "", "OUTCOME_TRAFFIC", "LINK_CLICKS", postOnly = false, photosOnly = true, toSite = true, newAd = true),
            AdsGoal("hidden", "Hidden", "", "OUTCOME_SALES", "X", postOnly = false, photosOnly = false, toSite = false, newAd = false),
        ),
        buttons = emptyList(), igPositions = emptyList(), website = "https://made-up.example", shop = "", waChannel = "", sitePieces = true,
        quiet = listOf(
            AdsQuietDay("2026-10-13", "5 Rabi II", "Made-up day", near = false),
            AdsQuietDay("2026-10-30", "22 Rabi II", "Later day", near = true),
        ),
    )

    @Test fun goalsOfferedFollowWhatIsPromoted() {
        assertEquals(listOf("whatsapp", "engagement"), AdsNewAdDraft(kind = AdsKind.post).offered(lists).map { it.key })
        assertEquals(listOf("whatsapp", "website"), AdsNewAdDraft(kind = AdsKind.photos).offered(lists).map { it.key })
        // A goal the new source can't carry goes back to WhatsApp chats.
        assertEquals("whatsapp", AdsNewAdDraft(kind = AdsKind.photos, goalKey = "engagement").fitGoal(lists).goalKey)
        assertEquals("website", AdsNewAdDraft(kind = AdsKind.photos, goalKey = "website").fitGoal(lists).goalKey)
    }

    @Test fun quietDaysTheAdWouldRunThrough() {
        val d = AdsNewAdDraft(days = 7)
        assertEquals(listOf("2026-10-13"), d.quietInRange(lists, now).map { it.date })
        // Left running with no end, it looks 30 days ahead.
        assertEquals(listOf("2026-10-13", "2026-10-30"), AdsNewAdDraft(days = null).quietInRange(lists, now).map { it.date })
        assertTrue(d.quietInRange(null, now).isEmpty())
    }

    @Test fun theConfirmationReadsTheServersLinesThenTheNameThenTheQuietDays() {
        val check = AdsPlanCheck(emptyList(), listOf("Line one.", "Line two."), "Made Up Ad", "")
        val text = AdsNewAdDraft(days = 7).confirmText(check, lists, now)
        val lines = text.split("\n")
        assertEquals(listOf("Line one.", "Line two.", "Name: Made Up Ad"), lines.take(3))
        assertTrue(lines[3].startsWith("It would run through 1 day the house keeps free of product ads, from "))
        assertEquals("", AdsNewAdDraft().confirmText(null, lists, now))
    }

    @Test fun theBudgetNoteSaysWhatItCanSpend() {
        assertEquals("At most about PKR 10,500 over 7 days (Meta may spend a little more on a good day and less on others).", AdsNewAdDraft(amount = "1500", days = 7).budgetNote("PKR", null))
        assertEquals("About PKR 30,000 a month until it's paused. Meta's smallest daily budget for this account is PKR 1,200.", AdsNewAdDraft(amount = "1000", days = null).budgetNote("PKR", 1200.0))
        assertEquals("About PKR 1,000 a day over 5 days.", AdsNewAdDraft(budgetKind = "total", amount = "5000", days = 5).budgetNote("PKR", null))
        assertEquals("A budget above zero.", AdsNewAdDraft(amount = "0").budgetNote("PKR", null))
    }

    @Test fun madeAdsHandOverToTheDesigner() {
        assertEquals("/ads/adset?campaign=11&ads=22", AdsNewAdDraft.adSetPath(AdsMade("22", "11", false, emptyList())))
        assertEquals("/ads/adset", AdsNewAdDraft.adSetPath(AdsMade("", "", false, emptyList())))
    }

    @Test fun queriesAreReadAndEscapedLikeTheWebs() {
        assertEquals("Rings/DSC0912.webp", AdsQuery.value("piece", "/ads/new?piece=Rings%2FDSC0912.webp"))
        assertNull(AdsQuery.value("piece", "/ads/new?piece="))
        assertNull(AdsQuery.value("piece", "/ads/new"))
        assertEquals("1,2", AdsQuery.value("ads", "/ads/adset?x=1&ads=1%2C2"))
        // Letters of any language stay as they are, as Foundation's .alphanumerics keeps them; OkHttp encodes them on the wire.
        assertEquals("a%2Fb%20cé", AdsQuery.escape("a/b cé"))
        assertEquals("120012", AdsQuery.escape("120012"))
    }

    @Test fun amountsAreTypedInTheAccountsMoney() {
        assertEquals(1500.0, AdsAmount.parse("1,500"))
        assertNull(AdsAmount.parse("0"))
        assertNull(AdsAmount.parse("x"))
        assertEquals("1500", AdsAmount.field(1500.0))
        assertEquals("", AdsAmount.field(0.0))
    }

    @Test fun aWebsitePiecesFirstWords() {
        assertEquals("Ruby ring — 12.4g\nGold · 21k\n\nMessage us for today’s price.", AdsNewAdWords.pieceText("Ruby ring", 12.4, listOf("Gold", "21k"), "whatsapp", false))
        assertEquals("Kara — 30g\n\nSee it on the website.", AdsNewAdWords.pieceText("Kara", 30.0, emptyList(), "website", true))
        assertEquals("Kara", AdsNewAdWords.pieceText("Kara", null, emptyList(), "engagement", false))
        assertTrue(AdsNewAdWords.isChannelLink(" https://whatsapp.com/channel/0029Va "))
        assertFalse(AdsNewAdWords.isChannelLink("https://made-up.example"))
        assertTrue(AdsNewAdWords.isWebLink("https://made-up.example/ring"))
        assertFalse(AdsNewAdWords.isWebLink("made-up"))
    }

    @Test fun theTemplateIsReadFromItsEnvelope() {
        val t = AdsTemplate.from(Json.parse("""{"template":{"goal":"website","source":{"kind":"photos","photos":[{"hash":"h1","url":"u","headline":"One"},{"hash":""}],"vertical":{"hash":"hv","url":"uv"}},"text":"T","budget":{"kind":"total","amount":"5000"},"name":"Old ad"}}"""))
        assertNotNull(t)
        assertEquals("website", t.goal)
        assertEquals("photos", t.kind)
        assertEquals(listOf("h1"), t.photos.map { it.hash })
        assertEquals("hv", t.vertical!!.hash)
        assertEquals("SHOP_NOW", t.button)
        assertEquals(5000.0, t.budgetAmount)
        assertNull(AdsTemplate.from(Json.parse("""{"nope":1}""")))
    }

    // MARK: The ad set designer

    private fun set(key: String = "k1", extra: AdsSetDraft.() -> AdsSetDraft = { this }) =
        AdsSetDraft(key, "Ad set 1", "whatsapp", AdsAudience(), amount = "1000").extra()

    @Test fun anAdSetCopiesTheLastWithANewName() {
        val first = set()
        val next = first.next(2, "k2")
        assertEquals("k2", next.key)
        assertEquals("Ad set 2", next.name)
        assertEquals(first.audience, next.audience)
        assertEquals(first.amount, next.amount)
    }

    @Test fun theDesignOfNewAdSetsFromCopiesOfAds() {
        val design = AdsDesign(
            target = "new", campaignName = "Test", campaign = null,
            sets = listOf(set { copy(start = Instant.parse("2026-10-13T00:00:00Z"), end = Instant.parse("2026-10-19T23:59:00Z")) }),
            adsKind = "copy", adIds = listOf("5", "6"), post = "", link = "", launch = "live",
        )
        val expected = """{"ads":{"ids":["5","6"],"kind":"copy"},"adsets":[{"audience":$defaultAudience,"budget":{"amount":1000,"end":"2026-10-19T23:59:00Z","kind":"daily","start":"2026-10-13T00:00:00Z"},"goal":"whatsapp","key":"k1","name":"Ad set 1"}],"campaign":{"kind":"new","name":"Test"},"launch":"live"}"""
        assertEquals(expected, text(design.json()))
        assertEquals(2, design.adCount)
    }

    @Test fun theDesignIntoAnExistingCampaignWithAPost() {
        val campaign = AdsAdsetsInfo.Campaign("77", "Rings", "OUTCOME_TRAFFIC", budgeted = true)
        val design = AdsDesign("77", "", campaign, listOf(set(), set("k2")), "post", emptyList(), "178", "https://made-up.example", "paused")
        val json = design.json()
        assertEquals("""{"budgeted":true,"id":"77","kind":"existing","name":"Rings","objective":"OUTCOME_TRAFFIC"}""", text(json["campaign"]))
        assertEquals("""{"kind":"post","link":"https://made-up.example","mediaId":"178"}""", text(json["ads"]))
        assertTrue(design.budgeted)
        assertEquals(2, design.adCount)
        // Meta fixes the objective per campaign, and a boosted post can't carry a photos-only goal.
        assertTrue(design.allowed(lists).isEmpty())
        assertEquals(listOf("website"), design.copy(adsKind = "copy").allowed(lists).map { it.key })
    }

    @Test fun adIdsFromTheQueryAreNumbers() {
        assertEquals(listOf("12", "34"), AdsAdSetsLogic.adIdsFromQuery("12,x,,34"))
    }

    @Test fun theAdsToCopyShowChosenOnesFirst() {
        fun ad(id: String, name: String) = AdItem(id, name, "ACTIVE", "ACTIVE", null, emptyList(), AdMetrics())
        val tree = AdCampaigns(
            AdAccount("a", "Acct", "PKR", 1, 0.0, null, null, null),
            listOf(AdCampaign("1", "Rings", "ACTIVE", "ACTIVE", "OUTCOME_TRAFFIC", null, null, null, emptyList(), AdMetrics(), null,
                listOf(AdSet("2", "Karachi", "ACTIVE", "ACTIVE", "", null, null, null, null, emptyList(), AdMetrics(), listOf(ad("3", "Ruby"), ad("4", "Kara")))))),
        )
        assertEquals(listOf("4", "3"), AdsAdSetsLogic.shownAds(tree, listOf("4"), "").map { it.ad.id })
        assertEquals(listOf("3"), AdsAdSetsLogic.shownAds(tree, emptyList(), "rings ruby").map { it.ad.id })
        assertEquals("Rings › Karachi", AdsAdSetsLogic.shownAds(tree, emptyList(), "").first().place)
    }
}
