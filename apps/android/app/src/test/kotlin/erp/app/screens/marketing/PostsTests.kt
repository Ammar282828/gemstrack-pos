package erp.app.screens.marketing

import erp.app.nav.NavMap
import erp.app.nav.ScreenRoute
import erp.app.ui.AppClock
import erp.core.Json
import java.io.File
import java.time.Instant
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PostsTests {
    // Karachi is UTC+5: 08:00Z is 13:00 on the 12th.
    private val now = Instant.parse("2026-10-12T08:00:00Z")

    @Before fun pin() { AppClock.pinned = now }
    @After fun unpin() { AppClock.pinned = null }

    private fun parse(text: String) = Json.parse(text)

    // MARK: Models

    @Test fun aPieceReadsLeniently() {
        val p = PostPiece.from(parse("""{"id":"Rings/R1.webp","name":"Ring","image":"https://x/i.webp","weightGrams":"3.5","facts":["a",2],"added":1760000000000,"newArrival":true}"""))!!
        assertEquals("Rings/R1.webp", p.id)
        // no thumb: the photo itself
        assertEquals("https://x/i.webp", p.thumb)
        assertEquals(3.5, p.weightGrams)
        assertEquals(listOf("a", "2"), p.facts)
        assertEquals(1760000000000.0, p.added)
        assertTrue(p.newArrival)
        assertFalse(p.hidden)
        assertEquals("", p.collection)
    }

    @Test fun theSitePiecesAnswerDropsPiecesWithoutAnId() {
        val a = PostPiecesAnswer.from(parse("""{"site":"https://www.example.test","pieces":[{"id":"a","name":"A"},{"name":"no id"}],"posted":{"a":"2026-10-12T06:00:00Z","b":5,"c":null}}"""))!!
        assertEquals(listOf("a"), a.pieces.map { it.id })
        assertEquals("2026-10-12T06:00:00Z", a.posted["a"])
        assertEquals("5", a.posted["b"])
        assertFalse(a.posted.containsKey("c"))
    }

    @Test fun aQueuedPieceReadsItsSendsItsGoneAndItsFailures() {
        val e = PostQueueEntry.from(parse(
            """{"id":"q1","status":"failed","createdAt":"2026-10-12T05:00:00Z","headline":"Ring","instagram":true,"whatsapp":["diamonds","channel"],
               "units":["site-0","instagram","wa:diamonds:0"],"done":{"site-0":{"at":"x"}},"errors":{"instagram":{"message":"Token expired"},"wa:diamonds:0":{"message":""}},
               "caption":"Words","website":{"collection":"Rings","names":["ring-1"],"featured":true},"counts":{"site":1,"wa":2}}""",
        ))!!
        assertTrue(e.toWebsite)
        assertTrue(e.toInstagram)
        assertEquals(3, e.units)
        assertEquals(1, e.done)
        assertEquals(setOf("site-0"), e.doneKeys)
        assertEquals(mapOf("instagram" to "Token expired"), e.unitErrors)
        assertEquals("Token expired", e.lastError)
        assertEquals("Rings", e.websiteCollection)
        assertTrue(e.websiteFeatured)
        assertEquals(1, e.sitePhotos)
        assertEquals(2, e.waPhotos)
        assertEquals("Words", e.caption)
    }

    @Test fun noWebsiteMeansNoWebsite() {
        assertFalse(PostQueueEntry.from(parse("""{"id":"q","status":"held","website":null}"""))!!.toWebsite)
        assertFalse(PostQueueEntry.from(parse("""{"id":"q","status":"held"}"""))!!.toWebsite)
        assertTrue(PostQueueEntry.from(parse("""{"id":"q","status":"held","website":{}}"""))!!.toWebsite)
    }

    @Test fun theAudienceNamesTheCommunityAndTheGroups() {
        val a = PostAudience.from(parse("""{"community":{"name":"Demo Announcements"},"groups":[{"key":"diamonds","label":"Diamonds","name":"Demo D"},{"key":"ann","label":"Announcements","name":"Demo Announcements"}]}"""))!!
        assertEquals("Demo Announcements", a.communityName)
        assertEquals(2, a.groups.size)
    }

    // MARK: The day

    private fun state(): PostsState = PostsDemo.state(now)

    @Test fun todayIsWhatWentOutOnKarachisDay() {
        val s = state()
        assertEquals(listOf("Solitaire ring", "Jhumka pair"), s.sentToday(now).map { it.title })
        assertEquals("Kara bangle", s.lastEarlier(now)?.title)
        assertNull(PostsState(sent = emptyList()).lastEarlier(now))
    }

    @Test fun theQueueShowsWhatIsStillToGoFailedFirst() {
        val s = state()
        assertEquals(listOf("failed", "scheduled", "held"), s.queueShown(now).map { it.status })
        // a sent piece shows only on the day it went
        val sent = s.queue.first().copy0(status = "sent", sentAt = "2026-10-12T06:00:00Z")
        val old = s.queue.first().copy0(status = "sent", sentAt = "2026-10-10T06:00:00Z")
        assertEquals(4, s.copy(queue = s.queue + sent).queueShown(now).size)
        assertEquals(3, s.copy(queue = s.queue + old).queueShown(now).size)
    }

    @Test fun placesAreNamedInTheCountersWords() {
        val s = state()
        assertEquals("Announcements", s.placeName("whatsapp-community"))
        assertEquals("Channel", s.placeName("whatsapp-channel"))
        assertEquals("Instagram story", s.placeName("instagram-story"))
        assertEquals("Diamonds", s.placeName("whatsapp-group:diamonds"))
        assertEquals("unknown", s.placeName("whatsapp-group:unknown"))
        assertEquals("Website, Instagram story, Diamonds, Channel", s.queueWhere(s.queue.first()))
        assertEquals("the website", PostsState().siteName)
        assertEquals("example.test", s.siteName)
    }

    @Test fun onlyAFailedCheckStopsTheHub() {
        assertEquals(listOf("Instagram"), state().failingChecks.map { it.group })
    }

    @Test fun theGoldPostSaysEachPartSentOrWaiting() {
        assertEquals("Group 11:00 am · Teaser waiting · Story waiting", goldLine(state()))
        assertEquals("Not here yet: the routine files it after 11:00.", goldLine(PostsState()))
    }

    // MARK: Words and ages

    @Test fun agesAreCountedInWholeDays() {
        assertEquals(0, MarketingTime.daysAgo("2026-10-12T06:00:00Z", now))
        assertEquals(1, MarketingTime.daysAgo("2026-10-11T07:00:00Z", now))
        assertEquals(12, MarketingTime.daysAgo("2026-09-30T08:00:00Z", now))
        assertEquals("posted today", MarketingTime.postedAgo("2026-10-12T06:00:00Z", now))
        assertEquals("posted yesterday", MarketingTime.postedAgo("2026-10-11T07:00:00Z", now))
        assertEquals("posted 12 days ago", MarketingTime.postedAgo("2026-09-30T08:00:00Z", now))
        assertNull(MarketingTime.postedAgo(null, now))
    }

    @Test fun theClockIsKarachisInLowerCase() {
        assertEquals("1:00 pm", MarketingTime.clock("2026-10-12T08:00:00Z"))
        assertEquals("12:05 am", MarketingTime.clock("2026-10-11T19:05:00Z"))
        assertEquals("Monday", MarketingTime.weekday("2026-10-12T08:00:00Z"))
        assertTrue(MarketingTime.isToday("2026-10-12T06:00:00Z", now))
        // 20:00Z on the 11th is 01:00 on the 12th in Karachi
        assertTrue(MarketingTime.isToday("2026-10-11T20:00:00Z", now))
        assertFalse(MarketingTime.isToday("2026-10-11T18:00:00Z", now))
    }

    // MARK: Paths

    @Test fun aPieceTravelsFullyEscapedInTheQuery() {
        val id = "Rings/DSC 0912 é.webp"
        val path = MarketingKit.piecePath(id)
        assertEquals("/marketing/piece?id=Rings%2FDSC%200912%20%C3%A9%2Ewebp", path)
        assertEquals(id, MarketingKit.pieceId(path))
        assertNull(MarketingKit.pieceId("/marketing/piece"))
        assertEquals("a b", MarketingKit.query("x", "/p?y=1&x=a%20b"))
        assertNull(MarketingKit.query("x", "/p?x="))
    }

    private fun map(house: String) = NavMap.parse(File("../../iphone/App/Resources/nav-$house.json").readText())!!

    @Test fun aPlaceIsThereOnlyWhereTheMapHasIt() {
        val t = map("taheri")
        assertTrue(MarketingKit.has("/website/post", "marketing", t))
        assertTrue(MarketingKit.has("/website/investments", "owner", t))
        assertTrue(MarketingKit.has("/website/photos", "marketing", t))
        // Mina's map has no Investments
        assertFalse(MarketingKit.has("/website/investments", "owner", map("mina")))
        assertEquals(listOf("Add photos"), MarketingKit.tabs("website", "marketing", t).map { it.label }.take(1))
    }

    @Test fun theMarketingRoutesAreTheseScreensOnly() {
        fun matches(path: String) = MarketingRoutes.any { it.matches(path) }
        assertTrue(matches("/posts"))
        assertTrue(matches("/posts?x=1"))
        assertTrue(matches("/website/post?new=1"))
        assertTrue(matches("/marketing/queue?id=q1"))
        assertTrue(matches("/marketing/pieces"))
        assertTrue(matches("/marketing/piece?id=a"))
        assertTrue(matches("/website/from-site"))
        // other pages of the group are not here yet: they fall through to the ERP page
        assertFalse(matches("/ads"))
        assertFalse(matches("/website/photos"))
        assertFalse(matches("/orders"))
        assertEquals("/website/from-site", ScreenRoute.bare("/website/from-site?x"))
    }

    // MARK: Pieces screen

    @Test fun thePiecesGridHidesWhatWentOutLatelyAndOpensOnNewArrivals() {
        val s = state()
        val shown = PostPiecesLogic.filtered(s.pieces, s.posted, "", PostPiecesLogic.NEW_KEY, true, now)
        // four new arrivals; three of them went out lately (R-101 today, E-201 today, B-301 yesterday)
        assertEquals(listOf("Eternity band"), shown.map { it.name })
        assertEquals(8, PostPiecesLogic.filtered(s.pieces, emptyMap(), "", "", false, now).size)
        assertEquals(listOf("Signet ring"), PostPiecesLogic.filtered(s.pieces, emptyMap(), "signet", "", false, now).map { it.name })
        // a word matches the name, the collection or a fact
        assertEquals(5, PostPiecesLogic.filtered(s.pieces, emptyMap(), "ring", "", false, now).size)
        assertEquals(listOf("Jhumka pair"), PostPiecesLogic.filtered(s.pieces, emptyMap(), "jhumka", "Earrings", false, now).map { it.name })
        assertEquals(listOf("Bangles", "Earrings", "Pendants", "Rings"), PostPiecesLogic.collections(s.pieces))
    }

    @Test fun aSiteWithNoDatesShowsEverythingInsteadOfNewArrivals() {
        val plain = state().pieces.map { it.copy0(newArrival = false) }
        assertEquals("", PostPiecesLogic.showing(PostPiecesLogic.NEW_KEY, plain))
        assertEquals(PostPiecesLogic.NEW_KEY, PostPiecesLogic.showing(PostPiecesLogic.NEW_KEY, state().pieces))
    }

    @Test fun weightsAndLastPostedAreSaidPlainly() {
        assertEquals("3.84", PostPiecesLogic.trimmed(3.84))
        assertEquals("12", PostPiecesLogic.trimmed(12.0))
        assertEquals("2.5", PostPiecesLogic.trimmed(2.5))
        assertEquals("Today", PostPiecesLogic.lastPosted("2026-10-12T06:00:00Z", now))
        assertEquals("3 days ago", PostPiecesLogic.lastPosted("2026-10-09T06:00:00Z", now))
        assertEquals("Never from here", PostPiecesLogic.lastPosted(null, now))
        assertEquals("/website/edit?id=Rings%2FR1%2Ewebp", PostPiecesLogic.editPath(state().pieces.first().copy0(id = "Rings/R1.webp")))
    }

    // Small copies of the models (data classes with the one field changed).
    private fun PostQueueEntry.copy0(status: String = this.status, sentAt: String? = this.sentAt) = copy(status = status, sentAt = sentAt)
    private fun PostPiece.copy0(newArrival: Boolean = this.newArrival, id: String = this.id) = copy(newArrival = newArrival, id = id)
}
