package erp.app.screens.design

import erp.app.screens.marketing.MarketingValue
import erp.app.screens.marketing.PostDraft
import erp.app.screens.marketing.PostPhoto
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DesignModelTests {
    private fun doc(tag: String) = DesignWork.blankDoc(1080.0, 1920.0).with("meta", MarketingValue.obj("tag" to tag))

    /** A piece: the story is the master, WhatsApp's square is made from it. */
    private fun piece(): DesignWork = DesignWork.new("piece", emptyList(), fields = mapOf("headline" to "Ruby Rani Set"))

    // MARK: Who sees what

    @Test fun theGateIsTheWebs() {
        assertTrue(DesignAccess("owner").ads && DesignAccess("marketing").ads)
        assertTrue(DesignAccess("staff").post && !DesignAccess("staff").ads)
        assertFalse(DesignAccess("karigar").post)
        assertFalse(DesignAccess("none").post)
    }

    @Test fun staffAreNotOfferedTheBoardOrTheLibrary() {
        assertEquals(listOf("make", "photos", "saved"), DesignSection.offered(DesignAccess("staff")).map { it.id })
        assertEquals(listOf("make", "photos", "board", "saved"), DesignSection.offered(DesignAccess("owner")).map { it.id })
        assertEquals(DesignSection.Make, DesignSection.of("board", DesignAccess("staff")))
        assertEquals(DesignPhotoPart.Site, DesignPhotoPart.of("library", DesignAccess("staff")))
        assertEquals(DesignPhotoPart.Library, DesignPhotoPart.of("library", DesignAccess("marketing")))
        assertEquals(listOf("site"), DesignPhotoPart.offered(DesignAccess("staff")).map { it.id })
    }

    // MARK: Kinds and sizes

    @Test fun eachKindStartsWithItsOwnSizes() {
        assertEquals(listOf("story", "whatsapp"), DesignKinds.card("piece").sizes)
        assertEquals(listOf("portrait"), DesignKinds.card("ad").sizes)
        assertEquals("ads", DesignKinds.scope("ad"))
        assertEquals("shop", DesignKinds.scope("story"))
        assertEquals("Design", DesignKinds.label("nonsense"))
        // an unknown kind is a post
        assertEquals("post", DesignKinds.card("nonsense").kind)
        assertTrue(DesignKinds.cards.filter { it.ads }.map { it.kind } == listOf("ad"))
    }

    @Test fun theSizeTableIsTheWebs() {
        assertEquals(listOf("portrait", "square", "story", "landscape"), DesignSizes.feed.map { it.id })
        assertEquals(listOf(1350.0, 1080.0, 1920.0, 565.0), DesignSizes.feed.map { it.h })
        assertEquals(11, DesignSizes.more.size + DesignSizes.feed.size)
        assertEquals(13, DesignSizes.all.size)
        // WhatsApp and the website only ever get 1:1, at their own widths
        assertEquals(1600.0, DesignSizes.whatsapp.px)
        assertEquals(3000.0, DesignSizes.website.px)
        assertEquals("square", DesignSizes.website.format)
        assertTrue(DesignSizes.isCatalogue("Website 1:1"))
        assertFalse(DesignSizes.isCatalogue("WhatsApp 1:1"))
    }

    @Test fun aCustomShapeIsReducedAndKeptBetweenTheLimits() {
        val a = DesignSizes.custom(4, 5)
        assertEquals("Custom 4:5", a.label)
        assertEquals(1350.0, a.h)
        assertEquals(1080.0, a.px)
        val b = DesignSizes.custom(7, 3)
        assertEquals("7:3", b.ratio)
        assertEquals(463.0, b.h)
        assertEquals(2519.0, b.px)
        // too flat is held at 360 high, drawn 3240 wide
        val c = DesignSizes.custom(100, 1)
        assertEquals(360.0, c.h)
        assertEquals(3240.0, c.px)
        // 6:8 is 3:4
        assertEquals("3:4", DesignSizes.custom(6, 8).ratio)
        assertEquals(2400.0, DesignSizes.custom(1, 100).h)
    }

    @Test fun onlyAStoryHasSafeZones() {
        assertEquals(269.0 to 672.0, DesignSizes.safeZone(1920.0))
        assertEquals(0.0 to 0.0, DesignSizes.safeZone(1350.0))
        assertEquals(0.0 to 0.0, DesignSizes.safeZone(1080.0))
    }

    // MARK: Starting

    @Test fun aNewPieceHasItsMasterAndAPageMadeFromIt() {
        val w = piece()
        assertTrue(w.fresh)
        assertEquals(listOf("p1", "p2"), w.pages.map { it.id })
        assertEquals("master", w.pages[0].origin)
        assertEquals("resized", w.pages[1].origin)
        assertEquals("p1", w.pages[1].syncedFrom)
        assertEquals("Stories & reels 9:16", w.pages[0].label)
        assertEquals("WhatsApp 1:1", w.pages[1].label)
        assertEquals("shop", w.scope)
        assertEquals("p1", w.master)
        assertEquals("Ruby Rani Set", w.fields["headline"])
        assertEquals("", w.fields["kicker"])
        // a blank page has the photo as its ground and an empty list of placements
        assertEquals("photo", w.pages[0].doc["bg"].s("photoId"))
        assertTrue(w.pages[0].doc["placements"].obj.isEmpty())
        assertEquals(1920.0, w.pages[0].doc["frame"].n("h"))
    }

    @Test fun anAdIsOfTheAdsScope() {
        assertEquals("ads", DesignWork.new("ad", emptyList()).scope)
        assertEquals("portrait", DesignWork.new("ad", emptyList()).pages[0].format)
    }

    @Test fun onlyTheFourWordsAreKept() {
        val w = DesignWork.new("post", emptyList(), fields = mapOf("headline" to "A", "junk" to "x"))
        assertEquals(setOf("kicker", "headline", "weight", "details"), w.fields.keys)
    }

    @Test fun theNameIsTheNameThenTheHeadlineThenUntitled() {
        assertEquals("Untitled design", DesignWork.new("post", emptyList()).displayName)
        assertEquals("Ruby Rani Set", piece().displayName)
        assertEquals("Eid set", piece().copy(name = "  Eid set ").displayName)
    }

    // MARK: Edits

    private fun laidOut(): DesignWork = piece().copy(fresh = false)

    @Test fun editingTheMasterLeavesThePagesMadeFromItBehind() {
        val w = laidOut().editDoc("p1", doc("a"))
        assertEquals(listOf("p2"), w.stale)
        assertEquals(1, w.pages[0].rev)
        assertTrue(w.dirty)
        assertEquals("Behind the master", w.stripNote(w.pages[1]))
        assertEquals("Master", w.stripNote(w.pages[0]))
        // the same document again changes nothing
        assertEquals(w, w.editDoc("p1", doc("a")))
    }

    @Test fun editingAMadePageMakesItThePersonsOwn() {
        val w = laidOut().editDoc("p1", doc("a")).editDoc("p2", doc("b"))
        assertEquals("manual", w.pages[1].origin)
        assertEquals(emptyList(), w.stale)
        assertEquals("Edited", w.stripNote(w.pages[1]))
    }

    @Test fun redoingFromTheMasterPutsAPageBackInStep() {
        val w = laidOut().editDoc("p1", doc("a")).redoFromMaster("p2", doc("c"))
        assertEquals(emptyList(), w.stale)
        assertEquals("resized", w.pages[1].origin)
        assertEquals("p1", w.pages[1].syncedFrom)
        assertEquals("From the master", w.stripNote(w.pages[1]))
        assertEquals("c", w.pages[1].doc["meta"].s("tag"))
    }

    @Test fun pagesAreAddedUniquelyAndTheLastBecomesActive() {
        val extra = NewDesignPage(null, "Feed 4:5", "portrait", 1080.0, 1350.0, doc("n"))
        val w = laidOut().addPages(listOf(extra, NewDesignPage("p3", "Link", "landscape", 1080.0, 565.0, doc("m"), origin = "manual")))
        assertEquals(listOf("p1", "p2", "p3", "p4"), w.pages.map { it.id })
        // "p3" was free (the first got it), so the asked-for one fell to the next free id
        assertEquals("p4", w.active)
        assertEquals("p1", w.pages[2].syncedFrom)
        assertNull(w.pages[3].syncedFrom)
        // a name asked for that is not an id the web accepts is not used
        val bad = laidOut().addPages(listOf(NewDesignPage("no good", "x", "square", 1080.0, 1080.0, doc("q"))))
        assertEquals("p3", bad.pages.last().id)
        assertEquals(laidOut(), laidOut().addPages(emptyList()))
    }

    @Test fun aDesignTakesNoMoreThanTwentyFourPages() {
        var w = laidOut()
        repeat(40) { w = w.addPages(listOf(NewDesignPage(null, "s$it", "square", 1080.0, 1080.0, doc("x")))) }
        assertEquals(24, w.pages.size)
    }

    @Test fun takingTheMasterOutPromotesTheNextAndKeepsOneAlive() {
        val w = laidOut().removePage("p1")
        assertEquals(listOf("p2"), w.pages.map { it.id })
        assertEquals("p2", w.master)
        assertEquals("master", w.pages[0].origin)
        assertNull(w.pages[0].syncedFrom)
        assertEquals("p2", w.active)
        // the last page cannot go
        assertEquals(w, w.removePage("p2"))
    }

    @Test fun takingAPageOutLeavesThoseMadeFromItOnTheirOwn() {
        val w = laidOut().addPages(listOf(NewDesignPage(null, "Feed", "portrait", 1080.0, 1350.0, doc("f"), syncedFrom = "p2")))
        val gone = w.removePage("p2")
        assertEquals("manual", gone.pages.first { it.id == "p3" }.origin)
        assertNull(gone.pages.first { it.id == "p3" }.syncedFrom)
    }

    @Test fun anotherPageCanBeTheMaster() {
        val w = laidOut().setMaster("p2")
        assertEquals("p2", w.master)
        assertEquals("master", w.pages[1].origin)
        assertEquals("manual", w.pages[0].origin)
        assertEquals(emptyList(), w.stale)
        assertEquals(w, w.setMaster("p2"))
        assertEquals(w, w.setMaster("nope"))
    }

    // MARK: The save

    @Test fun theSaveMetaIsExactlyTheWebs() {
        val w = laidOut().copy(name = "Eid set", source = mapOf("siteId" to "Rings/R-1.webp"), copy = mapOf("price" to "PKR 12,000", "goal" to "whatsapp", "junk" to "x", "wa" to "hello"))
        val m = w.meta("data:image/jpeg;base64,AA==")
        assertEquals("Eid set", m.s("name"))
        assertEquals("piece", m.s("kind"))
        assertEquals("shop", m.s("scope"))
        assertTrue(m["folder"].isNull)
        assertEquals("Rings/R-1.webp", m["source"].s("siteId"))
        assertEquals(setOf("kicker", "headline", "weight", "details"), m["fields"].obj.keys)
        assertEquals(setOf("price", "wa", "goal"), m["copy"].obj.keys)
        assertEquals("p1", m.s("master"))
        assertEquals(2, m["pages"].array.size)
        assertEquals(1080.0, m["pages"].array[0]["frame"].n("w"))
        assertEquals(1920.0, m["pages"].array[0]["frame"].n("h"))
        assertEquals("p1", m["pages"].array[1].s("syncedFrom"))
        assertTrue(m["pages"].array[0]["syncedFrom"].isNull)
        assertEquals("data:image/jpeg;base64,AA==", m.s("thumb"))
    }

    @Test fun theSaveMetaHoldsTheWebsLimits() {
        val w = laidOut().copy(name = "n".repeat(300), fields = mapOf("headline" to "h".repeat(500)), copy = mapOf("wa" to "w".repeat(5000), "price" to "p".repeat(100)))
        val m = w.meta("t")
        assertEquals(120, m.s("name").length)
        assertEquals(300, m["fields"].s("headline").length)
        assertEquals(2000, m["copy"].s("wa").length)
        assertEquals(40, m["copy"].s("price").length)
    }

    // MARK: Kept on the device

    @Test fun aDraftReadsBackAsItWasKept() {
        val w = laidOut().editDoc("p1", doc("a")).copy(name = "Eid", folder = "f1", copy = mapOf("wa" to "hi"), source = mapOf("siteId" to "s"))
        val back = DesignWork.fromValue(MarketingValue.parse(w.toValue().text))
        assertEquals(w, back)
    }

    @Test fun aDraftWithNoPagesIsNothing() {
        assertNull(DesignWork.fromValue(MarketingValue.obj("id" to "x")))
    }

    // MARK: A saved design

    private fun record(): DesignRecord = DesignRecord(
        MarketingValue.of(
            mapOf(
                "id" to "d1", "name" to "Eid", "folder" to "", "kind" to "ad", "scope" to "ads", "fields" to mapOf("headline" to "Eid", "kicker" to 3),
                "copy" to mapOf("price" to "PKR 1"),
                "pages" to listOf(
                    mapOf("id" to "p1", "label" to "Feed 4:5", "format" to "portrait", "frame" to mapOf("w" to 1080, "h" to 1350), "origin" to "master", "rev" to 2),
                    mapOf("id" to "p2", "label" to "Stories", "format" to "story", "frame" to mapOf("w" to 1080, "h" to 1920), "origin" to "resized", "syncedFrom" to "p1", "rev" to 0),
                ),
                "master" to "p2", "files" to mapOf("doc:p1" to 1, "doc:p2" to 1, "image:p1" to 1), "thumb" to "data:image/jpeg;base64,AA==", "updated" to "2026-10-10T10:00:00Z",
            ),
        ),
    )

    @Test fun aRecordIsReadLeniently() {
        val r = record()
        assertNull(r.folder)
        assertEquals("ads", r.scope)
        // a field that is not text is not kept
        assertEquals(mapOf("headline" to "Eid"), r.fields)
        assertEquals(1350.0, r.pages[0].h)
        assertEquals("p1", r.pages[1].syncedFrom)
        assertTrue(r.canOpen)
        assertFalse(r.isLegacy)
        assertTrue(DesignRecord(MarketingValue.obj("id" to "saved:abc")).isLegacy)
        assertFalse(DesignRecord(MarketingValue.obj("id" to "saved:abc", "files" to mapOf("image:p1" to 1))).canOpen)
    }

    @Test fun aRecordOpensWithEachPagesLayout() {
        val docs = mapOf("p1" to doc("1"), "p2" to doc("2"))
        val w = DesignWork.from(record(), docs)!!
        assertEquals("p2", w.master)
        assertEquals("p2", w.active)
        assertFalse(w.fresh)
        assertFalse(w.dirty)
        assertEquals("Eid", w.fields["headline"])
        assertEquals("", w.fields["kicker"])
        assertEquals("headline", w.template)
        // a page without its layout cannot be opened again
        assertNull(DesignWork.from(record(), mapOf("p1" to doc("1"))))
    }

    @Test fun theTemplateComesFromTheMastersLayout() {
        val docs = mapOf("p1" to doc("1"), "p2" to DesignWork.blankDoc(1080.0, 1920.0).withPath(listOf("meta", "template"), MarketingValue.string("rate-board")))
        assertEquals("rate-board", DesignWork.from(record(), docs)!!.template)
    }

    @Test fun aThumbnailDecodesOnlyFromAnImageAddress() {
        assertNotNull(DesignThumb.bytes("data:image/jpeg;base64,AAAA"))
        assertNull(DesignThumb.bytes("https://example.com/a.jpg"))
        assertNull(DesignThumb.bytes("data:text/plain;base64,AAAA"))
        assertNull(DesignThumb.bytes(""))
    }

    // MARK: Ids and photographs

    @Test fun anIdIsWhatTheWebAccepts() {
        assertTrue(DesignRecords.idOK("abc_-1"))
        assertTrue(DesignRecords.idOK("a".repeat(40)))
        assertFalse(DesignRecords.idOK("a".repeat(41)))
        assertFalse(DesignRecords.idOK(""))
        assertFalse(DesignRecords.idOK("a b"))
        assertFalse(DesignRecords.idOK("saved:abc"))
    }

    @Test fun theOtherPhotographsAreWhatTheLayoutsDraw() {
        val a = DesignWork.blankDoc(1080.0, 1080.0).with(
            "layers",
            MarketingValue.of(
                listOf(
                    mapOf("kind" to "image", "photoId" to "more-1"),
                    mapOf("kind" to "image", "photoId" to "photo"),
                    mapOf("kind" to "image", "photoId" to "cutout", "src" to "data:image/png;base64,AA=="),
                    mapOf("kind" to "text", "photoId" to "ignored"),
                    mapOf("kind" to "image", "photoId" to "bad id"),
                ),
            ),
        ).withPath(listOf("bg", "photoId"), MarketingValue.string("bg-2"))
        assertEquals(listOf("bg-2", "more-1"), DesignRecords.otherPhotoIds(listOf(a)))
        assertTrue(DesignRecords.docUses(a, "more-1"))
        assertTrue(DesignRecords.docUses(a, "bg-2"))
        assertFalse(DesignRecords.docUses(a, "cutout"))
    }

    @Test fun anIdWithAColonTravelsEscaped() {
        assertEquals("/api/design/designs/saved%3Aabc", DesignRecords.base("saved:abc"))
    }

    // MARK: Where a photograph comes from

    @Test fun aCameraFileNameIsNoHeadline() {
        assertEquals("", DesignPhotoSources.headline("DSC_0912"))
        assertEquals("", DesignPhotoSources.headline("IMG 22"))
        assertEquals("", DesignPhotoSources.headline("whatsapp image 2026-10-01"))
        assertEquals("", DesignPhotoSources.headline("12345"))
        assertEquals("", DesignPhotoSources.headline("   "))
        assertEquals("Ruby ring", DesignPhotoSources.headline(" Ruby ring "))
    }

    @Test fun aWebsitePieceStartsAPhotographWithItsWords() {
        val p = DesignPhotoSources.site(MarketingValue.of(mapOf("id" to "Rings/R-1.webp", "name" to "Ruby Ring", "collection" to "Rings", "facts" to listOf("21K", "", "12.3g"))))
        assertEquals("Ruby Ring", p.fields["headline"])
        assertEquals("Rings", p.fields["kicker"])
        assertEquals("21K · 12.3g", p.fields["weight"])
        assertEquals("Rings/R-1.webp", p.source["siteId"])
        // a piece with no separate source photograph carries the marks
        assertTrue(p.marked)
        val own = DesignPhotoSources.site(MarketingValue.of(mapOf("id" to "x", "name" to "N", "collection" to "Website", "photoSource" to "src.jpg", "sourceMarked" to false)))
        assertFalse(own.marked)
        assertEquals("", own.fields["kicker"])
    }

    @Test fun aLibraryPhotographPrefersItsAssessmentsHeadline() {
        val a = DesignPhotoSources.library(
            MarketingValue.of(mapOf("id" to "up:1", "name" to "File", "assessment" to mapOf("headline" to "Pearl Haar", "burnedText" to true), "specs" to "18K", "source" to "drive")),
        )
        assertEquals("Pearl Haar", a.fields["headline"])
        assertEquals("18K", a.fields["weight"])
        assertEquals("up:1", a.source["assetId"])
        // burned-in lettering means the photograph carries marks
        assertTrue(a.marked)
        // a clean original carries none
        assertFalse(DesignPhotoSources.library(MarketingValue.of(mapOf("id" to "up:2", "original" to mapOf("id" to "orig"), "source" to "site"))).marked)
    }

    // MARK: Earlier Post a piece drafts

    private fun postDraft(formats: String = "both", withStory: Boolean = true, withSquare: Boolean = true): PostDraft {
        val layer = MarketingValue.of(mapOf("id" to "t1", "kind" to "text", "text" to "Hello"))
        val image = MarketingValue.of(mapOf("id" to "i1", "kind" to "image", "photoId" to "ph1"))
        var story = DesignWork.blankDoc(1080.0, 1920.0).withPath(listOf("bg", "photoId"), MarketingValue.string("ph1"))
        if (withStory) story = story.with("layers", MarketingValue.array(listOf(layer, image)))
        var square = DesignWork.blankDoc(1080.0, 1080.0).withPath(listOf("bg", "photoId"), MarketingValue.string("ph1"))
            .with("placements", MarketingValue.obj("ph1" to MarketingValue.obj("mode" to "fill")))
        if (withSquare) square = square.with("layers", MarketingValue.array(listOf(layer)))
        val words = PostDraft.defaultWords.with("headline", "Ruby set").with("weight", " 12.5g ").with("weightEach", true).with("formats", formats)
            .with("caption", "Come see").with("metal", "21K").with("stones", "Ruby")
        return PostDraft(
            photos = listOf(PostPhoto("ph1", "lead", ByteArray(3), source = MarketingValue.obj("id" to "Rings/R-1.webp")), PostPhoto("ph2", "side", ByteArray(2))),
            words = words, story = story, square = square,
        )
    }

    @Test fun anEarlierDraftBecomesAPieceWithItsStoryAsMaster() {
        val c = DesignOldDraft.convert(postDraft())!!
        val w = c.work
        assertEquals(listOf("p1", "p2"), w.pages.map { it.id })
        assertEquals("Stories & reels 9:16", w.pages[0].label)
        assertEquals("WhatsApp 1:1", w.pages[1].label)
        assertEquals("master", w.pages[0].origin)
        assertEquals("manual", w.pages[1].origin)
        assertEquals("Ruby set", w.fields["headline"])
        assertEquals("12.5g each", w.fields["weight"])
        assertEquals("21K | Ruby", w.fields["details"])
        assertEquals("Come see", w.copy["wa"])
        assertEquals("Rings/R-1.webp", w.source["siteId"])
        assertTrue(w.dirty)
        assertFalse(w.fresh)
        // the lead photograph is the design's own; the others keep their ids
        assertEquals(setOf("photo", "ph2"), c.photos.keys)
        assertEquals("photo", w.pages[0].doc["bg"].s("photoId"))
        assertEquals("photo", w.pages[0].doc["layers"].array[1].s("photoId"))
        assertEquals(setOf("photo"), w.pages[1].doc["placements"].obj.keys)
    }

    @Test fun anEarlierDraftOfOneShapeIsOnePage() {
        val storyOnly = DesignOldDraft.convert(postDraft(formats = "story"))!!.work
        assertEquals(listOf("Stories & reels 9:16"), storyOnly.pages.map { it.label })
        val squareOnly = DesignOldDraft.convert(postDraft(formats = "square"))!!.work
        assertEquals(listOf("WhatsApp 1:1"), squareOnly.pages.map { it.label })
        assertEquals("master", squareOnly.pages[0].origin)
    }

    @Test fun anEarlierDraftWithNothingDrawnOpensNothing() {
        assertNull(DesignOldDraft.convert(postDraft(withStory = false, withSquare = false)))
        assertNull(DesignOldDraft.convert(postDraft(formats = "story", withStory = false)))
    }

    @Test fun aWeightThatIsNotANumberIsLeftOff() {
        val d = postDraft()
        val c = DesignOldDraft.convert(d.copy(words = d.words.with("weight", "heavy")))!!
        assertEquals("", c.work.fields["weight"])
    }
}
