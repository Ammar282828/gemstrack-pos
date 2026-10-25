package erp.app.screens.marketing

import erp.app.ui.AppClock
import erp.app.ui.Note
import erp.core.Json
import java.time.Instant
import java.time.LocalTime
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The Posts tray, Spread over the day, Send all and the photo editor's rules (PostTray.swift, PostQueueSpread.swift, WebsiteEditPhoto.swift). */
class PostTrayTests {
    // Karachi is UTC+5: 08:00Z is 13:00 on the 12th.
    private val now = Instant.parse("2026-10-12T08:00:00Z")

    @Before fun pin() { AppClock.pinned = now }
    @After fun unpin() { AppClock.pinned = null }

    private fun piece(json: String) = PostPiece.from(Json.parse(json))!!
    private val ring = piece("""{"id":"Rings/R-101.webp","name":"Solitaire ring","url":"https://www.example.test/rings/r-101","collection":"Rings","weightGrams":4.2,"source":"attributes"}""")

    // MARK: The routes and the models

    @Test fun theTrayIsANativeRouteAndStartsOnOnePiece() {
        assertEquals("/marketing/tray", MarketingKit.trayPath())
        assertEquals("/marketing/tray?id=Rings%2FR%2D101%2Ewebp", MarketingKit.trayPath("Rings/R-101.webp"))
        assertEquals("Rings/R-101.webp", MarketingKit.pieceId(MarketingKit.trayPath("Rings/R-101.webp")))
        assertTrue(MarketingRoutes.any { it.matches(MarketingKit.trayPath("Rings/R-101.webp")) })
        assertFalse(erp.app.nav.ScreenRegistry.wantsWeb(MarketingKit.trayPath()))
    }

    // The tray's "Design" and Edit a piece's "Open in Design" hand the same piece over: the site's id, escaped whole, which
    // the native Design reads back (`?site=`) and starts a Piece from (DesignRoutes `startFromSite`).
    @Test fun theTrayAndEditAPieceHandTheSamePieceToNativeDesign() {
        val id = "Rings/R-101 two.webp"
        val path = WebsiteEditLogic.designPath(id)
        assertEquals("/design?v=make&site=Rings%2FR%2D101%20two%2Ewebp", path)
        assertEquals("/design?v=make&site=" + MarketingKit.escape(id), path)
        assertEquals(id, MarketingKit.query("site", path))
        assertEquals("make", MarketingKit.query("v", path))
        // Native: the in-app designer answers it, not the ERP's page.
        assertTrue(erp.app.screens.design.DesignRoutes.any { it.matches(path) })
        assertFalse(erp.app.nav.ScreenRegistry.wantsWeb(path))
    }

    @Test fun aPieceKeepsWhatTheTrayNeedsOfIt() {
        val p = piece("""{"id":"a","weightOnPhoto":true,"source":"pieces","photoSource":"","sourceMarked":true}""")
        assertTrue(p.weightOnPhoto)
        assertEquals("pieces", p.source)
        // An empty photoSource is none (Swift: nil when empty).
        assertNull(p.photoSource)
        assertTrue(p.sourceMarked)
        assertFalse(ring.weightOnPhoto)
    }

    @Test fun theAudienceKnowsItsMembersItsChannelAndWhetherAnythingCanBeSent() {
        val a = PostAudience.from(Json.parse("""{"community":{"name":"Announcements"},"groups":[{"key":"diamonds","label":"Diamonds","name":"Demo","size":212},{"key":"gold","label":"Gold"}],"channel":{"name":"Demo Channel","followers":3560}}"""))!!
        assertTrue(a.canSend)
        assertEquals(listOf(212, null), a.groups.map { it.size })
        assertEquals("Demo Channel", a.channelName)
        assertEquals(3560, a.channelFollowers)
        val none = PostAudience.from(Json.parse("""{"groups":[]}"""))!!
        assertFalse(none.canSend)
        assertNull(none.channelName)
    }

    // MARK: The card

    @Test fun aCardStartsWithTheSitesWeightAndStampsOnlyWhereThePhotoDoesntShowIt() {
        val c = PostTrayCard(ring)
        assertEquals("4.2", c.weight)
        assertTrue(c.overlay)
        assertTrue(c.stamps)
        assertEquals("4.2g", c.grams)
        assertEquals("The photo with 4.2g on it", c.going)
        // A photo that already shows its weight is not stamped twice.
        assertFalse(PostTrayCard(piece("""{"id":"b","weightGrams":3,"weightOnPhoto":true}""")).overlay)
        // Without a weight there is nothing to stamp.
        val bare = PostTrayCard(piece("""{"id":"c"}"""))
        assertEquals("", bare.weight)
        assertFalse(bare.stamps)
        assertEquals("The photo as it is on the website", bare.going)
    }

    @Test fun aWeightTypedHereIsThePostsOwnOrKeptOnTheSite() {
        val c = PostTrayCard(ring)
        // The site has one and it differs: this post only.
        c.weight = "4.35"
        assertTrue(c.postOnly)
        assertNull(c.newWeight)
        c.weight = "4.20"
        assertFalse(c.postOnly)
        // taheri.shop's own photograph with no weight: sending keeps the typed one.
        val none = PostTrayCard(piece("""{"id":"d","source":"attributes"}"""))
        none.weight = "3.84"
        assertEquals(3.84, none.newWeight)
        assertFalse(none.postOnly)
    }

    @Test fun aDesignsWordsCarryTheWeightOnlyWhereNothingElseOnThePhotoDoes() {
        val c = PostTrayCard(ring)
        c.designName = "Solitaire"
        assertEquals(
            mapOf("kicker" to "Rings", "headline" to "Solitaire", "weight" to "4.2g", "details" to "Gold | 4.2g"),
            c.designFields("Gold"),
        )
        // A Maison's piece is not the house's own metal.
        val maison = PostTrayCard(piece("""{"id":"m","name":"Love","collection":"Maison Cartier","weightGrams":5}"""))
        assertEquals("5g", maison.designFields("Gold")["details"])
        // No weight typed: nothing in the line.
        c.weight = ""
        assertEquals("Gold", c.designFields("Gold")["details"])
    }

    // MARK: Words

    @Test fun theTrayTalksInCountsAndLists() {
        assertEquals("piece", PostTrayLogic.noun(1))
        assertEquals("pieces", PostTrayLogic.noun(2))
        assertEquals("", PostTrayLogic.listOf(emptyList()))
        assertEquals("a", PostTrayLogic.listOf(listOf("a")))
        assertEquals("a and b", PostTrayLogic.listOf(listOf("a", "b")))
        assertEquals("a, b and c", PostTrayLogic.listOf(listOf("a", "b", "c")))
        assertEquals("Send a piece", PostTrayLogic.title(1))
        assertEquals("3 to send", PostTrayLogic.title(3))
        assertEquals("Pick pieces", PostTrayLogic.pickTitle(0))
        assertEquals("2 picked", PostTrayLogic.pickTitle(2))
        assertEquals(3.5, PostTrayLogic.typedGrams(" 3.5 "))
        assertEquals(0.0, PostTrayLogic.typedGrams("x"))
    }

    @Test fun theFileIsNamedFromThePiecesOwnAddress() {
        assertEquals("r-101", PostTrayLogic.slug(ring))
        assertEquals("piece", PostTrayLogic.slug(piece("""{"id":"x","url":""}""")))
        assertEquals("a-b-c", PostTrayLogic.slug(piece("""{"id":"x","url":"https://e.test/rings/a b!c"}""")))
    }

    @Test fun theBarSaysWhereTheyGoAndWhatLaterDoes() {
        val label = { k: String -> if (k == "channel") "the channel" else k.replaceFirstChar { it.uppercase() } }
        assertEquals("Choose where they go.", PostTrayLogic.summary(2, emptyList(), label))
        assertEquals("To Diamonds and the channel. Later puts it in the queue.", PostTrayLogic.summary(1, listOf("diamonds", "channel"), label))
        assertEquals("To Diamonds, one after another. Later puts them in the queue.", PostTrayLogic.summary(2, listOf("diamonds"), label))
        assertEquals("Send it to Diamonds?", PostTrayLogic.confirmTitle(1, listOf("diamonds"), label))
        assertEquals("Send these 3 pieces to Diamonds and the channel?", PostTrayLogic.confirmTitle(3, listOf("diamonds", "channel"), label))
    }

    @Test fun theConfirmationSaysEveryPieceEveryPlaceAndWhatWillFail() {
        val words = PostTrayLogic.confirmWords(
            listOf(PostTrayLogic.Line("Solitaire ring", "The photo with 4.2g on it", "posted yesterday"), PostTrayLogic.Line("Kara", "Your design of the photo", null)),
            listOf("Diamonds — 212 members", "Demo Channel (channel) — 3,560 followers"), 2,
            listOf(PostCheck("c", "WhatsApp", "Channel", "fail", "Offline.", "Reconnect it.")),
        )
        assertEquals(
            "• Solitaire ring: the photo with 4.2g on it · posted yesterday\n• Kara: your design of the photo\n\n" +
                "Diamonds — 212 members\nDemo Channel (channel) — 3,560 followers\n\n" +
                "Each with its own caption and link, one after another: it stops at the first that fails. A post can't be unsent from here.\n\n" +
                "This will probably fail:\nChannel: Reconnect it.",
            words,
        )
        assertEquals("Diamonds — 212 members", PostTrayLogic.placeLine("diamonds", "Diamonds", "Demo Channel", 212))
        assertEquals("Demo Channel (channel) — 3,560 followers", PostTrayLogic.placeLine("channel", "the channel", "Demo Channel", 3560))
        assertEquals("Diamonds", PostTrayLogic.placeLine("diamonds", "Diamonds", null, null))
    }

    @Test fun theWeightNoteSaysWhatTheWeightDoesHere() {
        fun note(designed: Boolean = false, shows: Boolean = false, onPhoto: Boolean = false, overlay: Boolean = true, ok: Boolean = true, keep: Double? = null, site: Double? = null, only: Boolean = false) =
            PostTrayLogic.weightNote(designed, shows, onPhoto, overlay, ok, keep, site, only, "example.test")
        assertEquals("Top left, in the catalogue's own lettering. It also goes in the caption.", note())
        assertEquals("Type the weight to put it on.", note(ok = false))
        assertEquals("This photo already shows its weight: with this on it shows twice.", note(onPhoto = true))
        assertEquals("This photo already shows its weight.", note(onPhoto = true, overlay = false))
        assertEquals("Your design carries the weight. It also goes in the caption.", note(designed = true, shows = true))
        assertTrue(note(designed = true).startsWith("Your design has no weight on it"))
        assertTrue(note(keep = 3.84).endsWith("example.test has no weight for this piece: sending saves 3.84g to it too."))
        assertTrue(note(site = 4.2).endsWith("From example.test: 4.2g. Change it here for this post only."))
        assertTrue(note(site = 4.2, only = true).endsWith("For this post only: example.test keeps 4.2g."))
    }

    @Test fun theDesignNoteFollowsTheHouseAndThePhoto() {
        val marked = piece("""{"id":"a","photoSource":"x","sourceMarked":true}""")
        assertEquals("This photo carries the house's mark already: add nothing more.", PostTrayLogic.designNote("mina", marked))
        assertTrue(PostTrayLogic.designNote("mina", piece("""{"id":"a","photoSource":"x"}"""))!!.contains("the mark goes back top right"))
        assertNull(PostTrayLogic.designNote("taheri", marked))
        assertTrue(PostTrayLogic.designNote("taheri", piece("""{"id":"a","weightOnPhoto":true}"""))!!.contains("a stamp would show them twice"))
    }

    @Test fun oneToastSaysTheFirstThingWorthSayingWithTheRestAfterIt() {
        assertNull(PostTrayLogic.merge(emptyList()))
        val failed = Note("Brass didn't go", "Offline.", failed = true)
        val weight = Note("Weight saved on example.test", "Ring now shows its weight.")
        val merged = PostTrayLogic.merge(listOf(weight, failed))!!
        assertEquals("Brass didn't go", merged.title)
        assertTrue(merged.failed)
        assertEquals("Offline. Weight saved on example.test: Ring now shows its weight.", merged.detail)
        assertEquals(Note("Sent 1 piece", ""), PostTrayLogic.merge(listOf(Note("Sent 1 piece"))))
    }

    // MARK: Spread over the day

    @Test fun theFirstTimeIsTheNextFiveMinuteMarkAtLeastTenMinutesAway() {
        fun soon(iso: String) = PostQueueSpreadLogic.soon(10, Instant.parse(iso))
        // 13:03:20 Karachi + 10 minutes is 13:13:20: on to 13:15.
        assertEquals(Instant.parse("2026-10-12T08:15:00Z"), soon("2026-10-12T08:03:20Z"))
        // Exactly on a mark stays on it.
        assertEquals(Instant.parse("2026-10-12T08:10:00Z"), soon("2026-10-12T08:00:00Z"))
        assertEquals(Instant.parse("2026-10-12T09:00:00Z"), soon("2026-10-12T08:46:59Z"))
    }

    @Test fun aPickedTimeIsTodayOrTomorrowIfItHasPassed() {
        assertEquals(Instant.parse("2026-10-12T09:00:00Z"), PostQueueSpreadLogic.atTime(LocalTime.of(14, 0), now))
        assertEquals(Instant.parse("2026-10-12T08:00:00Z"), PostQueueSpreadLogic.atTime(LocalTime.of(13, 0), now))
        // A minute ago still counts as now; more than that is tomorrow.
        assertEquals(Instant.parse("2026-10-12T07:59:00Z"), PostQueueSpreadLogic.atTime(LocalTime.of(12, 59), now))
        assertEquals(Instant.parse("2026-10-13T07:00:00Z"), PostQueueSpreadLogic.atTime(LocalTime.of(12, 0), now))
        assertEquals(Instant.parse("2026-10-12T16:30:00Z"), PostQueueSpreadLogic.onDay(now, LocalTime.of(21, 30)))
    }

    @Test fun theTimesRunFromTheFirstToTheLastOnTheFirstsDay() {
        val times = PostQueueSpreadLogic.planned(3, LocalTime.of(13, 0), LocalTime.of(14, 0), now)
        assertEquals(listOf("2026-10-12T08:00:00Z", "2026-10-12T08:30:00Z", "2026-10-12T09:00:00Z").map { Instant.parse(it) }, times)
        // A last before the first sends them all at the first.
        val all = PostQueueSpreadLogic.planned(2, LocalTime.of(14, 0), LocalTime.of(13, 0), now)
        assertEquals(listOf(Instant.parse("2026-10-12T09:00:00Z"), Instant.parse("2026-10-12T09:00:00Z")), all)
        assertEquals("from 1:00 pm to 2:00 pm", PostQueueSpreadLogic.span(PostQueueSpreadLogic.planned(2, LocalTime.of(13, 0), LocalTime.of(14, 0), now)))
        assertEquals("at 2:00 pm", PostQueueSpreadLogic.span(listOf(Instant.parse("2026-10-12T09:00:00Z"))))
        assertEquals("13:05", PostQueueSpreadLogic.clock(LocalTime.of(13, 5)))
        assertEquals(LocalTime.of(9, 30), PostQueueSpreadLogic.time("09:30"))
    }

    // MARK: Send all

    @Test fun sendAllActsOnWhatIsWaitingInTheQueuesOrder() {
        val s = PostsDemo.state(now)
        // The queue's own order (q1 scheduled, q2 failed, q3 held), nothing sent, still arriving or going now.
        assertEquals(listOf("q1", "q2", "q3"), s.waiting.map { it.id })
        assertTrue(s.waiting.all { it.status in listOf("held", "scheduled", "failed") })
        val words = sendAllWords(s)
        assertTrue(words.startsWith("• "))
        assertTrue(words.contains("One after another, in this order. A post can't be unsent from here."))
        // The demo's failing Instagram check is said before anything goes.
        assertTrue(words.endsWith("This will probably fail:\nStory: Connect Instagram again from Post a piece."))
        assertEquals("• Eternity band → Website, Instagram story, Diamonds, Channel", words.lines().first { it.contains("Eternity") })
    }

    // MARK: The photo editor

    @Test fun theFrameIsThePhotosOwnShapeBetweenHalfAndTwiceAsTallOrTheSquare() {
        assertEquals(720.0, WebsitePhotoEdit.frame("own", 3000.0 to 2000.0).n("h"))
        assertEquals(2160.0, WebsitePhotoEdit.frame("own", 1000.0 to 3000.0).n("h"))
        assertEquals(540.0, WebsitePhotoEdit.frame("own", 4000.0 to 1000.0).n("h"))
        assertEquals(1080.0, WebsitePhotoEdit.frame("square", 3000.0 to 2000.0).n("h"))
        assertEquals(1080.0, WebsitePhotoEdit.frame("own", null).n("h"))
        assertEquals(1080.0, WebsitePhotoEdit.frame("own", 3000.0 to 2000.0).n("w"))
    }

    @Test fun onlyTheLayoutsThatShowTheWeightAreAskedForIt() {
        assertFalse(WebsitePhotoEdit.showsWeight("clean"))
        assertFalse(WebsitePhotoEdit.showsWeight("mark"))
        assertFalse(WebsitePhotoEdit.showsWeight("catalogue-t"))
        assertTrue(WebsitePhotoEdit.showsWeight("weight-tl"))
    }

    private fun design(vararg layers: Map<String, Any?>): MarketingValue = MarketingValue.of(
        mapOf(
            "bg" to mapOf("photoId" to "ai-x", "placement" to mapOf("mode" to "fill")),
            "placements" to mapOf("ai-x" to mapOf("zoom" to 2), "site" to mapOf("zoom" to 1)), "layers" to layers.toList(),
        ),
    )

    @Test fun aKeptDesignIsAlwaysOverTheSitesPhotoWithItsOwnCropAndNoUnsavedPictures() {
        val d = design(mapOf("kind" to "text", "bind" to "weight"), mapOf("kind" to "image", "src" to ""), mapOf("kind" to "image", "src" to "lib:up:1"))
        val kept = WebsitePhotoEdit.kept(d)
        assertEquals("site", kept["bg"].s("photoId"))
        // The crop of the photo that was on show (the AI one's), under the site's id.
        assertEquals(listOf("site"), kept["placements"].obj.keys.toList())
        assertEquals(2.0, kept["placements"]["site"].n("zoom"))
        assertEquals(listOf("text", "image"), kept["layers"].array.map { it.s("kind") })
        assertEquals("lib:up:1", kept["layers"].array.last().s("src"))
    }

    @Test fun theWeightIsStampedOnlyWhereALayerBoundToItShowsAndOneIsTyped() {
        val shown = design(mapOf("kind" to "text", "bind" to "weight"))
        assertTrue(WebsitePhotoEdit.stamped(shown, mapOf("weight" to "4.2g")))
        assertFalse(WebsitePhotoEdit.stamped(shown, mapOf("weight" to "")))
        assertFalse(WebsitePhotoEdit.stamped(design(mapOf("kind" to "text", "bind" to "weight", "hidden" to true)), mapOf("weight" to "4.2g")))
        assertFalse(WebsitePhotoEdit.stamped(design(mapOf("kind" to "text", "bind" to "headline")), mapOf("weight" to "4.2g")))
    }

    @Test fun thePhotoChangesWithTheDesignAndOnlyWithTheWordsItDraws() {
        val plain = design(mapOf("kind" to "text", "text" to "Fixed"))
        assertEquals(WebsitePhotoEdit.sig(plain, mapOf("headline" to "A")), WebsitePhotoEdit.sig(plain, mapOf("headline" to "B")))
        val bound = design(mapOf("kind" to "text", "bind" to "headline"))
        assertTrue(WebsitePhotoEdit.sig(bound, mapOf("headline" to "A")) != WebsitePhotoEdit.sig(bound, mapOf("headline" to "B")))
        assertTrue(WebsitePhotoEdit.sig(bound, mapOf("headline" to "A")) != WebsitePhotoEdit.sig(plain, mapOf("headline" to "A")))
    }

    @Test fun theWebsitePhotoFieldsReadTheFormAsTheEditorDoes() {
        val tagged = WebsiteEditPiece.from(Json.parse("""{"id":"a","name":"Ring","collection":"Rings","source":"attributes","words":{"name":"Ring","stone":"Diamond","metal":"Gold","karat":"18k"}}"""))!!
        val form = WebsiteEditLogic.formOf(tagged).copy(name = "Solitaire", weight = " 4,2 g")
        assertEquals("4.2g", WebsiteEditLogic.weightLabel(form.weight))
        val f = WebsiteEditLogic.photoFields(tagged, form)
        assertEquals("Rings", f["kicker"])
        assertEquals("Solitaire", f["headline"])
        assertEquals("4.2g", f["weight"])
        assertEquals("18k Gold | Diamond", f["details"])
        assertEquals("", WebsiteEditLogic.weightLabel("0"))
        assertEquals("", WebsiteEditLogic.weightLabel("abc"))
        assertEquals("12.4g", WebsiteEditLogic.weightLabel("12.4"))
        // The catalogue's own facts, where a piece has no tags.
        val catalogue = WebsiteEditPiece.from(Json.parse("""{"id":"b","source":"pieces","collection":"Kara","facts":["Stone: Ruby","Setting: Prong"]}"""))!!
        assertEquals("Stone: Ruby | Setting: Prong", WebsiteEditLogic.photoFields(catalogue, WebsiteEditLogic.formOf(catalogue))["details"])
    }

    @Test fun theSaveConfirmationLeadsWithThePhotoThatIsReplaced() {
        val p = WebsiteEditPiece.from(Json.parse("""{"id":"a","name":"Ring","words":{"name":"Ring"}}"""))!!
        val form = WebsiteEditLogic.formOf(p).copy(name = "Solitaire")
        val change = WebsiteEditLogic.PhotoChange(true, "4.2g", listOf("Enhanced", "Changed with AI"))
        val words = WebsiteEditLogic.confirmWords(WebsiteEditLogic.Confirm.Save, p, form, "example.test", change)
        assertTrue(words.startsWith("On example.test:\n• The photo is replaced, with 4.2g on it (enhanced, changed with ai). The original is kept.\n• Name: “Solitaire”"))
        val none = WebsiteEditLogic.confirmWords(WebsiteEditLogic.Confirm.Save, p, form, "example.test")
        assertTrue(none.startsWith("On example.test:\n• Name: “Solitaire”"))
        assertEquals("The photo is replaced. The original is kept.", WebsiteEditLogic.confirmWords(WebsiteEditLogic.Confirm.Save, p, form, "x", WebsiteEditLogic.PhotoChange(false, "", emptyList())).lines()[1].removePrefix("• "))
    }
}
