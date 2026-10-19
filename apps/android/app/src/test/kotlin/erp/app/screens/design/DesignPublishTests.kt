package erp.app.screens.design

import erp.app.screens.marketing.MarketingValue
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DesignPublishTests {
    private fun page(id: String, label: String, w: Double, h: Double, format: String = "square") =
        DesignPageState(id, label, format, w, h, if (id == "p1") "master" else "resized", if (id == "p1") null else "p1", 0, DesignWork.blankDoc(w, h))

    private val story = page("p1", "Stories & reels 9:16", 1080.0, 1920.0, "story")
    private val whatsapp = page("p2", "WhatsApp 1:1", 1080.0, 1080.0)
    private val website = page("p3", "Website 1:1", 1080.0, 1080.0)
    private val portrait = page("p4", "Feed 4:5", 1080.0, 1350.0, "portrait")

    @Test fun eachPlaceTakesTheShapeTheWebSays() {
        val n = DesignDestinations.needs
        assertEquals("1:1", n.getValue("website").ratio)
        assertEquals(3000, n.getValue("website").maxPx)
        assertEquals("1:1", n.getValue("whatsapp").ratio)
        assertEquals(1600, n.getValue("whatsapp").maxPx)
        assertEquals("9:16", n.getValue("instagram-story").ratio)
        assertEquals(1440, n.getValue("instagram-post").maxPx)
        assertEquals("any", n.getValue("meta-ad").ratio)
        assertEquals(DesignDestinations.order.toSet(), n.keys)
        assertEquals(DesignDestinations.order.toSet(), DesignDestinations.sizeId.keys)
    }

    @Test fun theMasterIsUsedWhenItFits() {
        val pick = DesignDestinations.pageFor(listOf(story, whatsapp), "p1", "instagram-story")
        assertEquals("p1", pick.page?.id)
        assertNull(pick.missing)
    }

    @Test fun aSquareIsFoundBeforeOneIsMade() {
        assertEquals("p2", DesignDestinations.pageFor(listOf(story, whatsapp), "p1", "whatsapp").page?.id)
        assertEquals("p2", DesignDestinations.pageFor(listOf(story, whatsapp), "p1", "instagram-post").page?.id)
    }

    @Test fun theWebsiteTakesItsOwnPageBeforeAnyOtherSquare() {
        assertEquals("p3", DesignDestinations.pageFor(listOf(story, whatsapp, website), "p1", "website").page?.id)
        assertEquals("p3", DesignDestinations.pageFor(listOf(story, whatsapp, website), "p1", "site-replace").page?.id)
        // without one, the other square will do
        assertEquals("p2", DesignDestinations.pageFor(listOf(story, whatsapp), "p1", "website").page?.id)
    }

    @Test fun aShapeThePageLacksIsTheOneToMake() {
        val pick = DesignDestinations.pageFor(listOf(story), "p1", "whatsapp")
        assertNull(pick.page)
        assertEquals("whatsapp", pick.missing?.id)
        assertEquals("1:1", pick.missing?.ratio)
        // a Meta ad takes any shape, so something is always there
        assertEquals("p1", DesignDestinations.pageFor(listOf(story), "p1", "meta-ad").page?.id)
        assertEquals("story", DesignDestinations.storyPage(listOf(whatsapp, story))?.format)
        assertNull(DesignDestinations.storyPage(listOf(whatsapp, portrait)))
    }

    @Test fun aSlightlyOffSquareStillCountsAsASquare() {
        val near = page("p9", "Custom", 1080.0, 1085.0, "custom")
        assertTrue(DesignDestinations.matches(near, "1:1"))
        assertFalse(DesignDestinations.matches(portrait, "1:1"))
        assertTrue(DesignDestinations.matches(portrait, "any"))
        assertTrue(DesignDestinations.matches(story, "9:16"))
    }

    @Test fun thePictureIsDrawnAtTheWidthThePlaceTakes() {
        assertEquals(3000, DesignDestinations.outputPx("website", website))
        assertEquals(1600, DesignDestinations.outputPx("whatsapp", whatsapp))
        assertEquals(1080, DesignDestinations.outputPx("instagram-story", story))
        // "any": the format's own width, held to the place's most
        assertEquals(1080, DesignDestinations.outputPx("meta-ad", portrait))
        assertEquals(1200, DesignDestinations.outputPx("meta-ad", page("p5", "Link", 1080.0, 565.0, "landscape")))
        assertEquals(1080, DesignDestinations.outputPx("nowhere", portrait))
    }

    @Test fun aFileIsNamedFromTheHeadline() {
        assertEquals("Ruby-Rani-Set", DesignDestinations.slug("Ruby Rani Set!"))
        assertEquals("design", DesignDestinations.slug("!!!"))
        assertEquals("design", DesignDestinations.slug(""))
        assertEquals(60, DesignDestinations.slug("a".repeat(100)).length)
        assertEquals("Eid-gifts-for-her", DesignDestinations.slug("  Eid   gifts for her "))
    }

    @Test fun theMaisonsFolderIsKnownWhereverItIs() {
        assertTrue(DesignDestinations.isMaisonFolder("The Maisons"))
        assertTrue(DesignDestinations.isMaisonFolder("Sets/The Maisons"))
        assertFalse(DesignDestinations.isMaisonFolder("Sets/Maisons"))
    }

    @Test fun eachKindTicksItsOwnPlaces() {
        val piece = DesignPublishModel.defaults("piece")
        assertTrue(piece.website && piece.wa && piece.story && !piece.post && !piece.meta)
        val ad = DesignPublishModel.defaults("ad")
        assertTrue(ad.meta && !ad.website && !ad.wa)
        val post = DesignPublishModel.defaults("post")
        assertTrue(post.wa && post.post && !post.story)
        assertTrue(DesignPublishModel.defaults("site").website)
        val none = DesignPublishModel.defaults("custom")
        assertFalse(none.website || none.wa || none.story || none.post || none.meta)
    }

    @Test fun aRowIsReadFromTheServersWords() {
        val r = DesignPublishModel.Row(
            MarketingValue.of(
                mapOf(
                    "id" to "whatsapp", "label" to "WhatsApp groups", "available" to true,
                    "targets" to listOf(mapOf("key" to "g1", "label" to "Customers")), "mode" to "", "connectable" to true,
                ),
            ),
        )
        assertEquals("whatsapp", r.id)
        assertTrue(r.available)
        assertNull(r.reason)
        assertNull(r.mode)
        assertEquals("g1", r.targets.single().key)
        assertTrue(r.connectable)
        val gone = DesignPublishModel.Row(MarketingValue.of(mapOf("id" to "channel", "available" to false, "reason" to "No channel.")))
        assertFalse(gone.available)
        assertEquals("No channel.", gone.reason)
    }

    @Test fun aCollectionTitleDropsADoubleName() {
        assertEquals("Gold Rings", DesignPublishModel.SiteCollection("Rings/Gold Rings", "Gold Rings", "Gold Rings").title)
        assertEquals("Rings · Gold Rings", DesignPublishModel.SiteCollection("Rings/Gold Rings", "Rings", "Gold Rings").title)
    }

    @Test fun theNameOnTheWebsiteIsTheTypedOneElseTheHeadline() {
        assertEquals("Ruby", DesignPublishModel.siteBase("", " Ruby "))
        assertEquals("Own name", DesignPublishModel.siteBase("Own name", "Ruby"))
        assertEquals("Ruby", DesignPublishModel.siteBase("   ", "Ruby"))
    }

    @Test fun aScheduledTimeIsWholeSecondsAndZ() {
        assertEquals("2026-10-20T09:30:00Z", DesignPublishModel.isoSeconds(java.time.Instant.parse("2026-10-20T09:30:00.987Z")))
    }

    // MARK: The AI rules

    @Test fun aResultIsTrustedOnlyIfItIsTheSamePieceAndSure() {
        fun check(same: Boolean, confidence: Double? = null) =
            MarketingValue.of(linkedMapOf<String, Any?>("samePiece" to same).apply { if (confidence != null) put("confidence", confidence) })
        assertTrue(DesignAIRules.checkOK(check(true)))
        assertTrue(DesignAIRules.checkOK(check(true, 0.8)))
        assertFalse(DesignAIRules.checkOK(check(true, 0.79)))
        assertFalse(DesignAIRules.checkOK(check(false, 0.99)))
        assertFalse(DesignAIRules.checkOK(null))
        assertFalse(DesignAIRules.checkOK(MarketingValue.NULL))
    }

    @Test fun everyGoalHasItsHint() {
        for (g in listOf("whatsapp", "messages", "instagram_dm", "website", "sales", "channel", "profile", "engagement", "reach")) assertNotNull(DesignAIRules.goalHints[g])
    }

    @Test fun theNearestShapeTheAIKnows() {
        assertEquals("4:5", DesignAspect.nearest(1080.0, 1350.0))
        assertEquals("9:16", DesignAspect.nearest(1080.0, 1920.0))
        assertEquals("1:1", DesignAspect.nearest(1080.0, 1080.0))
        assertEquals("16:9", DesignAspect.nearest(1080.0, 565.0))
        assertEquals("21:9", DesignAspect.nearest(1080.0, 463.0))
        assertEquals("1:1", DesignAspect.nearest(0.0, 0.0))
    }
}
