package erp.app.screens.marketing

import erp.app.ui.AppClock
import java.io.File
import java.nio.file.Files
import java.time.Instant
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PostComposerTests {
    @Before fun pin() { AppClock.pinned = Instant.parse("2026-10-12T08:00:00Z") }
    @After fun unpin() { AppClock.pinned = null }

    private fun photo(id: String, site: Boolean = true, wa: Boolean = true) = PostPhoto(id = id, name = id, data = byteArrayOf(1, 2, 3), toSite = site, toWhatsApp = wa)

    /** A draft ready to go to the website and one WhatsApp group. */
    private fun ready(): PostDraft {
        var d = PostDraft(photos = listOf(photo("p1"), photo("p2", site = false)))
        d = d.copy(story = d.story.withPath(listOf("bg", "photoId"), MarketingValue.string("p1")))
        return d.word("headline", "Ruby set").word("toWebsite", true).word("folder", "Rings").word("toWhatsApp", true)
            .word("waTargets", listOf("diamonds")).word("caption", "A caption")
    }

    // MARK: The words on the pictures

    @Test fun aWeightIsATypedNumberAboveZero() {
        fun weight(text: String, each: Boolean = false) = PostComposerRules.validWeight(PostDraft.defaultWords.with("weight", text).with("weightEach", each))
        assertEquals("12.5g", weight("12.5"))
        assertEquals("12.5g", weight(" 12.5g "))
        assertEquals("12.5g each", weight("12.5G", each = true))
        // a space left inside is not a number
        assertEquals("", weight("12 .5"))
        assertEquals("", weight("0"))
        assertEquals("", weight("-3"))
        assertEquals("", weight("heavy"))
        assertEquals("", weight(""))
    }

    @Test fun theFieldsAreTheHeadlineKickerWeightAndDetails() {
        val w = PostDraft.defaultWords.with("headline", "Ruby").with("kicker", "New").with("weight", "4").with("metal", "22k gold").with("stones", "Ruby")
        assertEquals(mapOf("headline" to "Ruby", "kicker" to "New", "weight" to "4g", "details" to "22k gold | Ruby"), PostComposerRules.fields(w))
        assertEquals("22k gold", PostComposerRules.fields(w.with("stones", ""))["details"])
        assertEquals("", PostComposerRules.fields(w.with("metal", "").with("stones", ""))["details"])
    }

    @Test fun postAndStoryAreOneChoice() {
        val both = PostDraft.defaultWords
        assertTrue(PostComposerRules.makeSquare(both) && PostComposerRules.makeStory(both))
        assertFalse(PostComposerRules.makeStory(both.with("formats", "square")))
        assertFalse(PostComposerRules.makeSquare(both.with("formats", "story")))
    }

    // MARK: Where it goes

    @Test fun theLeadPhotoIsTheStorysAndGoesFirst() {
        val d = ready().copy(photos = listOf(photo("p0"), photo("p1"), photo("p2")))
        assertEquals("p1", PostComposerRules.hero(d)?.id)
        assertEquals(listOf("p1", "p0", "p2"), PostComposerRules.sitePhotos(d).map { it.id })
        // no photo named: the first
        assertEquals("p0", PostComposerRules.hero(d.copy(story = NativeArtwork.blank()))?.id)
        assertNull(PostComposerRules.hero(PostDraft()))
    }

    @Test fun aPieceGoesOnlyWhereItIsAskedAndAble() {
        val d = ready()
        assertTrue(PostComposerRules.siteOn(d))
        assertEquals(listOf("diamonds"), PostComposerRules.waKeys(d))
        // Instagram needs the connection too
        val ig = d.word("toInstagram", true)
        assertFalse(PostComposerRules.igOn(ig, instagramConnected = false))
        assertTrue(PostComposerRules.igOn(ig, instagramConnected = true))
        // a story that goes nowhere is shared by hand
        assertTrue(PostComposerRules.manualStory(ig, instagramConnected = false))
        assertFalse(PostComposerRules.manualStory(ig, instagramConnected = true))
        // story only: no website, no WhatsApp
        val story = d.word("formats", "story")
        assertFalse(PostComposerRules.siteOn(story))
        assertEquals(emptyList(), PostComposerRules.waKeys(story))
        // post only: no story
        assertFalse(PostComposerRules.manualStory(d.word("formats", "square"), false))
    }

    @Test fun aReadyPieceHasNothingStoppingIt() {
        assertEquals(emptyList(), PostComposerRules.problems(ready(), false))
    }

    @Test fun whatStopsAPostIsSaidInOrder() {
        assertEquals(listOf("Add a photo.", "Give the piece a headline."), PostComposerRules.problems(PostDraft(), false))
        val noSitePhoto = ready().copy(photos = listOf(photo("p1", site = false)))
        assertEquals(listOf("Choose a photo for the website."), PostComposerRules.problems(noSitePhoto, false))
        assertEquals(listOf("Choose a website collection."), PostComposerRules.problems(ready().word("folder", ""), false))
        val maisons = ready().word("folder", "Jewellery/The Maisons")
        assertEquals(listOf("Choose the piece’s house for The Maisons."), PostComposerRules.problems(maisons, false))
        assertEquals(emptyList(), PostComposerRules.problems(maisons.word("maisonHouse", "Noor"), false))
        val wa = ready().word("waTargets", emptyList<String>()).word("caption", " ").copy(photos = listOf(photo("p1", wa = false)))
        assertEquals(listOf("Choose a photo for WhatsApp.", "Choose a WhatsApp destination.", "Write the WhatsApp caption."), PostComposerRules.problems(wa, false))
    }

    @Test fun aPaintedStoryMustBelongToTheLeadPhoto() {
        val d = ready().copy(paintedStory = byteArrayOf(9), paintedStoryFor = "p2")
        assertEquals(listOf("The painted story belongs to another photo. Repaint it or use the original design."), PostComposerRules.problems(d, false))
        assertEquals(emptyList(), PostComposerRules.problems(d.copy(paintedStoryFor = "p1"), false))
    }

    // MARK: The queue

    @Test fun theQueueFileIsNamedAfterThePiece() {
        assertEquals("ruby-set", PostComposerRules.fileBase("Ruby Set!"))
        assertEquals("piece", PostComposerRules.fileBase("!!!"))
        assertEquals("kara-22k_gold", PostComposerRules.fileBase("  Kara 22K_gold "))
        assertEquals(120, PostComposerRules.fileBase("a".repeat(300)).length)
    }

    @Test fun theQueueBodyIsTheWebsKeyForKey() {
        val folders = listOf(MarketingValue.obj("folder" to "Rings", "collection" to "Rings and bands", "path" to "/rings"))
        val from = MarketingValue.obj("id" to "Rings/R1.webp", "name" to "Ring", "url" to "https://x", "marked" to true)
        val d = ready().copy(photos = listOf(photo("p1").copy(source = from), photo("p2", site = false)))
        val body = PostComposerRules.queueBody(d, instagramConnected = false, folders = folders, featuredOn = true, names = listOf("ruby-set-1"), thumb = "AAAA")
        assertEquals("Ruby set", body["headline"])
        assertEquals("A caption", body["caption"])
        assertEquals("ruby-set", body["fileBase"])
        assertEquals(mapOf("site" to 1, "wa" to 2, "story" to false), body["counts"])
        assertEquals(mapOf("folder" to "Rings", "collection" to "Rings and bands", "names" to listOf("ruby-set-1"), "featured" to false), body["website"])
        assertEquals(false, body["instagram"])
        assertEquals(listOf("diamonds"), body["whatsapp"])
        assertEquals("AAAA", body["thumb"])
        assertEquals("Rings/R1.webp", body["sitePiece"])
        // the set of the day only where the house has one and the counter asked
        val featured = PostComposerRules.queueBody(d.word("feature", true), false, folders, true, emptyList(), "")
        assertEquals(true, (featured["website"] as Map<*, *>)["featured"])
        // no website: null, and a collection nobody listed is its folder
        assertNull(PostComposerRules.queueBody(d.word("toWebsite", false), false, folders, true, emptyList(), "")["website"])
        assertEquals("Elsewhere", ((PostComposerRules.queueBody(d.word("folder", "Elsewhere"), false, folders, false, emptyList(), "")["website"]) as Map<*, *>)["collection"])
        assertFalse(PostComposerRules.queueBody(ready(), false, folders, false, emptyList(), "").containsKey("sitePiece"))
    }

    @Test fun theConfirmationNamesEveryPlaceAndWhatNeedsAttention() {
        val d = ready().word("toInstagram", true)
        val checks = listOf(MarketingValue.obj("status" to "fail", "label" to "Instagram", "fix" to "Connect it again."), MarketingValue.obj("status" to "ok", "label" to "Site"))
        val words = PostComposerRules.publishWords(d, "Demo site", "demo_shop", true, checks, sendsNow = true)
        assertEquals(
            "Demo site · Rings\nInstagram story · @demo_shop\nWhatsApp · diamonds\n\nNeeds attention:\nInstagram: Connect it again.\n\nThis sends now. A published post cannot be taken back.",
            words,
        )
        assertTrue(PostComposerRules.publishWords(d, "Demo site", "x", false, emptyList(), sendsNow = false).endsWith("It stays held until you send or schedule it."))
    }

    @Test fun anAIVersionIsCheckedAgainstTheOriginal() {
        assertTrue(PostComposerRules.needsComparing(MarketingValue.NULL))
        assertTrue(PostComposerRules.needsComparing(MarketingValue.obj("samePiece" to true, "confidence" to 0.5)))
        assertTrue(PostComposerRules.needsComparing(MarketingValue.obj("samePiece" to false, "confidence" to 0.95)))
        assertFalse(PostComposerRules.needsComparing(MarketingValue.obj("samePiece" to true, "confidence" to 0.8)))
    }

    // MARK: AI parameters

    private val config = MarketingValue.parse("""{"site":"https://www.example.test","posting":{"whatsappNumbers":["0300 0000000"]}}""")

    @Test fun aCaptionAsksWithTheWordsAndTheShopsNumbers() {
        val d = ready().word("weight", "4").word("metal", "Gold")
        val p = PostAIParams.build(PostAIRequest("caption", "captions", null), PostAIParams.Form("warm"), d, config)
        assertEquals("warm", p["instruction"])
        assertEquals("warm", p["brief"])
        assertEquals(true, p["tidy"])
        assertEquals("9:16", p["aspect"])
        assertEquals("Ruby set", p["headline"])
        assertEquals("4g", p["weight"])
        assertEquals("Rings", p["collection"])
        assertEquals(listOf("0300 0000000"), p["numbers"])
        assertEquals("https://www.example.test", p["link"])
        assertFalse(p.containsKey("rawPrompt"))
    }

    @Test fun paintingAndLetteringAskForTheDesignsFields() {
        val d = ready().word("weight", "4").word("metal", "Gold").word("stones", "Ruby")
        val story = PostAIParams.build(PostAIRequest("paint", "story", null), PostAIParams.Form("bold", aspect = "4:5"), d, config)
        assertEquals("9:16", story["aspect"])
        assertEquals("Gold | Ruby | 4g", story["specs"])
        assertEquals("bold", story["style"])
        assertEquals("#FFFFFF", story["headlineColour"])
        assertEquals("top-right", story["markCorner"])
        assertEquals("Ruby set", story["headline"])
        assertEquals("1:1", PostAIParams.build(PostAIRequest("paint", "post", null), PostAIParams.Form(), d, config)["aspect"])
        // reframe takes the chosen shape
        assertEquals("4:5", PostAIParams.build(PostAIRequest("reframe", "x", null), PostAIParams.Form(aspect = "4:5", rawPrompt = "  "), d, config)["aspect"])
        assertEquals("my prompt", PostAIParams.build(PostAIRequest("custom", "x", null), PostAIParams.Form(rawPrompt = "my prompt"), d, config)["rawPrompt"])
    }

    @Test fun aNewSettingIsAScenesIdOrTheBriefItself() {
        val d = ready()
        assertEquals("on a velvet tray", PostAIParams.build(PostAIRequest("restage", "x", null), PostAIParams.Form("on a velvet tray"), d, config)["scene"])
        val chosen = PostAIParams.build(PostAIRequest("restage", "x", null), PostAIParams.Form("ignored", scene = "velvet"), d, config)
        assertEquals("velvet", chosen["sceneId"])
        assertFalse(chosen.containsKey("scene"))
    }

    @Test fun theWholeStoryUsesTheAIsLayoutAndScene() {
        val c = MarketingValue.obj("align" to "center", "paletteId" to "ivory", "weightOwnLine" to true, "sceneId" to "tray", "sceneBrief" to "soft light")
        assertEquals(mapOf("action" to "preset", "value" to "center", "palette" to "ivory", "weightOwnLine" to true), PostAIParams.wholeStoryLayout(c))
        assertEquals("stack-left", PostAIParams.wholeStoryLayout(MarketingValue.obj("align" to "left"))["value"])
        assertEquals(mapOf("aspect" to "9:16", "sceneId" to "tray", "scene" to "soft light"), PostAIParams.wholeStoryScene(c))
        assertEquals(mapOf("aspect" to "9:16", "sceneId" to "tray"), PostAIParams.wholeStoryScene(MarketingValue.obj("sceneId" to "tray")))
    }

    // MARK: Drafts on the device

    private fun temp(): File = Files.createTempDirectory("drafts").toFile()

    @Test fun aDraftComesBackAsItWasSavedPhotosIncluded() {
        val dir = temp()
        val disk = PostDraftDisk(dir)
        val from = MarketingValue.obj("id" to "Rings/R1.webp", "marked" to true)
        val d = ready().copy(
            photos = listOf(photo("p1").copy(source = from, check = MarketingValue.obj("samePiece" to true)), photo("p2", site = false, wa = false)),
            paintedSquare = byteArrayOf(7, 8), paintedSquareFor = "p1", queuedID = "q9", queueReady = false, updated = System.currentTimeMillis(),
        )
        disk.save(d)
        val back = disk.list().single()
        assertEquals(d.id, back.id)
        assertEquals(d.words, back.words)
        assertEquals(d.story, back.story)
        assertEquals(d.square, back.square)
        assertEquals(listOf("p1", "p2"), back.photos.map { it.id })
        assertContentEquals(byteArrayOf(1, 2, 3), back.photos[0].data)
        assertTrue(back.photos[0].toSite)
        assertFalse(back.photos[1].toSite)
        assertFalse(back.photos[1].toWhatsApp)
        assertEquals(from, back.photos[0].source)
        assertTrue(back.photos[0].check?.get("samePiece")?.bool == true)
        assertContentEquals(byteArrayOf(7, 8), back.paintedSquare)
        assertNull(back.paintedStory)
        assertEquals("p1", back.paintedSquareFor)
        assertEquals("q9", back.queuedID)
        assertEquals(false, back.queueReady)
        dir.deleteRecursively()
    }

    @Test fun savingAgainDropsWhatTheDraftNoLongerHolds() {
        val dir = temp()
        val disk = PostDraftDisk(dir)
        val d = ready().copy(paintedStory = byteArrayOf(1), paintedStoryFor = "p1")
        disk.save(d)
        disk.save(d.copy(photos = listOf(photo("p1")), paintedStory = null, paintedStoryFor = null))
        val files = File(dir, d.id).list()!!.sorted()
        assertEquals(listOf("p1.photo"), files)
        assertEquals(1, disk.list().single().photos.size)
        dir.deleteRecursively()
    }

    @Test fun draftsComeNewestFirstAndOldOnesAreDropped() {
        val dir = temp()
        var clock = 1_000_000_000_000L
        val disk = PostDraftDisk(dir) { clock }
        disk.save(PostDraft(id = "old", updated = clock - 31 * 86_400_000L))
        disk.save(PostDraft(id = "a", updated = clock - 1000))
        disk.save(PostDraft(id = "b", updated = clock - 10))
        assertEquals(listOf("b", "a"), disk.list().map { it.id })
        assertFalse(File(dir, "old.json").exists())
        disk.remove("a")
        assertEquals(listOf("b"), disk.list().map { it.id })
        dir.deleteRecursively()
    }

    @Test fun aBrokenDraftFileIsSkippedNotFatal() {
        val dir = temp()
        val disk = PostDraftDisk(dir)
        disk.save(PostDraft(id = "good"))
        File(dir, "bad.json").writeText("{ not json")
        assertEquals(listOf("good"), disk.list().map { it.id })
        dir.deleteRecursively()
    }

    @Test fun aNewDraftIsEmptyAndTitledUntitled() {
        val d = PostDraft()
        assertEquals("Untitled piece", d.title)
        assertEquals("both", d.words.s("formats"))
        assertEquals(1920.0, d.story["frame"].n("h"))
        assertEquals(1080.0, d.square["frame"].n("h"))
        assertEquals("Ruby", d.word("headline", "Ruby").title)
        assertNotNull(d.id)
        assertEquals(d, d.copy())
    }

    // MARK: The queue sheet

    private val state = PostsDemo.state(Instant.parse("2026-10-12T08:00:00Z"))

    @Test fun everyPlaceIsSaidWithItsPhotosAndWhatHasGone() {
        val q1 = state.queue.first { it.id == "q1" }
        val places = PostQueueLogic.places(q1, state)
        assertEquals(listOf("Website", "Instagram story", "Diamonds", "Channel"), places.map { it.title })
        assertEquals("example.test · Rings · 2 photos", places[0].detail)
        assertEquals("WhatsApp · 1 photo, the caption on the first", places[2].detail)
        assertEquals(listOf("site-0", "site-1"), places[0].units)
        assertEquals(listOf("channel"), places.drop(3).map { it.kind })
    }

    @Test fun theSendSaysEveryPlaceStillToGetItAndThatItCannotBeTakenBack() {
        val q2 = state.queue.first { it.id == "q2" }
        assertEquals(
            "It goes now to:\nDiamonds (WhatsApp · 2 photos, the caption on the first)\n\nWhat already went is not sent again.\n\nA post cannot be taken back.",
            PostQueueLogic.sendWords(q2, state),
        )
        val q1 = state.queue.first { it.id == "q1" }
        assertTrue(PostQueueLogic.sendWords(q1, state).startsWith("It goes now to:\nWebsite (example.test · Rings · 2 photos)\nInstagram story (The story picture)"))
        assertFalse(PostQueueLogic.sendWords(q1, state).contains("already went"))
    }

    @Test fun whatCanBeDoneDependsOnWhereItIs() {
        fun e(status: String) = PostQueueEntry.from(mapOf("id" to "x", "status" to status))!!
        for (s in listOf("held", "scheduled", "failed")) { assertTrue(PostQueueLogic.canSend(e(s))); assertTrue(PostQueueLogic.canTime(e(s))) }
        for (s in listOf("sending", "sent", "draft")) { assertFalse(PostQueueLogic.canSend(e(s))); assertFalse(PostQueueLogic.canTime(e(s))) }
        assertEquals("Held: it waits for you", PostQueueLogic.statusWords(e("held")))
        assertEquals("Not all of it went", PostQueueLogic.statusWords(e("failed")))
        assertEquals("Still arriving from the device that made it", PostQueueLogic.statusWords(e("draft")))
        assertEquals("What already went stays where it is; the rest will not go.", PostQueueLogic.removeWords(state.queue.first { it.id == "q2" }))
        assertEquals("Nothing of it has gone. Its photos are deleted with it.", PostQueueLogic.removeWords(state.queue.first { it.id == "q1" }))
    }

    @Test fun anAnswerIsWrittenInWholeSeconds() {
        assertEquals("2026-10-12T08:00:00Z", PostsStore.isoSeconds(Instant.parse("2026-10-12T08:00:00.789Z")))
    }
}
