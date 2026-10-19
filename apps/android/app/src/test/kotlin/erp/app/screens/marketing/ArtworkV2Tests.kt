package erp.app.screens.marketing

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The designer's v2 pure parts (blend and effects, rich text, gradients, snapping and guides, match, QR, photo adjust). */
class ArtworkV2Tests {
    // MARK: Blend and effects

    @Test fun normalBlendIsNoBlend() {
        val l = MarketingValue.obj("id" to "a", "blend" to "multiply")
        assertEquals("screen", ArtworkFx.withBlend(l, "screen").s("blend"))
        assertTrue(ArtworkFx.withBlend(l, "normal")["blend"].isNull)
        assertFalse(ArtworkFx.withBlend(l, "normal").obj.containsKey("blend"))
        assertEquals(9, ArtworkFx.blends.size)
    }

    @Test fun anEffectSwitchesOnWithTheWebsDefaultsAndOffLeavesNoEmptyFx() {
        val l = MarketingValue.obj("id" to "a")
        val on = ArtworkFx.withFxToggled(l, "shadow", true)
        assertEquals("#000000", on["layerFx"]["shadow"].s("color"))
        assertEquals(12.0, on["layerFx"]["shadow"].n("y"))
        assertEquals(0.35, on["layerFx"]["shadow"].n("alpha"))
        val both = ArtworkFx.withFxToggled(on, "glow", true)
        assertEquals(setOf("shadow", "glow"), both["layerFx"].obj.keys)
        val off = ArtworkFx.withFxToggled(both, "glow", false)
        assertEquals(setOf("shadow"), off["layerFx"].obj.keys)
        // the last one off takes `layerFx` with it
        assertFalse(ArtworkFx.withFxToggled(off, "shadow", false).obj.containsKey("layerFx"))
    }

    @Test fun aValueSetOnAnEffectKeepsTheRestOfItsDefaults() {
        val l = ArtworkFx.withFxValue(MarketingValue.obj("id" to "a"), "outline", "width", MarketingValue.number(10.0))
        assertEquals(10.0, l["layerFx"]["outline"].n("width"))
        assertEquals("#FFFFFF", l["layerFx"]["outline"].s("color"))
    }

    @Test fun aTextEffectBeginsWithTheWebsDefaultsForItsKind() {
        val e = ArtworkFx.effectDefaults("outline", "#111111")
        assertEquals("#FFFFFF", e.s("color"))
        assertEquals(45.0, e.n("thickness"))
        assertEquals("#111111", ArtworkFx.effectDefaults("outline", "#FFFFFF").s("color"))
        assertEquals(40.0, ArtworkFx.effectDefaults("lift", "#fff").n("transparency"))
        assertEquals(35.0, ArtworkFx.effectDefaults("hollow", "#fff").n("thickness"))
        assertEquals("#C9973F", ArtworkFx.effectDefaults("splice", "#fff").s("color"))
        assertEquals("#abcdef", ArtworkFx.effectDefaults("neon", "#abcdef").s("color"))
        assertEquals(50.0, ArtworkFx.effectDefaults("neon", "#abcdef").n("blur"))
        assertEquals("echo", ArtworkFx.effectDefaults("echo", "#fff").s("kind"))
    }

    @Test fun aTextEffectShowsOnlyTheSlidersItsKindUses() {
        assertTrue(ArtworkFx.uses("shadow", "offset") && ArtworkFx.uses("shadow", "angle") && ArtworkFx.uses("shadow", "blur") && ArtworkFx.uses("shadow", "transparency"))
        assertTrue(ArtworkFx.uses("neon", "blur") && !ArtworkFx.uses("neon", "angle"))
        assertTrue(ArtworkFx.uses("glitch", "offset") && !ArtworkFx.uses("glitch", "color"))
        assertTrue(ArtworkFx.uses("hollow", "thickness") && !ArtworkFx.uses("hollow", "color"))
        assertTrue(ArtworkFx.uses("lift", "transparency") && !ArtworkFx.uses("lift", "offset"))
    }

    @Test fun pickingATextEffectSwitchesThePlainShadowOff() {
        val l = MarketingValue.obj("id" to "a", "color" to "#000000", "shadow" to true)
        val e = ArtworkFx.withTextEffect(l, "outline")
        assertEquals("outline", e["effect"].s("kind"))
        assertFalse(e["shadow"].bool)
        assertEquals("#FFFFFF", e["effect"].s("color"))
        val tuned = ArtworkFx.withEffectValue(e, "thickness", MarketingValue.number(60.0))
        assertEquals(60.0, tuned["effect"].n("thickness"))
        assertFalse(ArtworkFx.withTextEffect(tuned, "none").obj.containsKey("effect"))
    }

    // MARK: Photo adjust

    @Test fun theQuickFixesSetTheirFieldsOverWhatIsThere() {
        val a = ArtworkAdjust.quickFix(MarketingValue.NULL, mapOf("highlights" to -55.0, "shadows" to 25.0))
        assertEquals(-55.0, a.n("highlights"))
        // the six keys the web always writes are there too
        assertEquals(setOf("brightness", "contrast", "saturation", "warmth", "fade", "vignette", "highlights", "shadows"), a.obj.keys)
        val b = ArtworkAdjust.quickFix(a, mapOf("highlights" to -10.0))
        assertEquals(-10.0, b.n("highlights"))
        assertEquals(25.0, b.n("shadows"))
    }

    @Test fun everySliderTheEngineHasIsOffered() {
        assertEquals(13, ArtworkAdjust.groups.sumOf { it.sliders.size })
        assertEquals(listOf("Light", "Colour", "Detail"), ArtworkAdjust.groups.map { it.title })
        assertEquals(3, ArtworkAdjust.quick.size)
        assertEquals(5.0, ArtworkAdjust.put(MarketingValue.NULL, "sharpen", 5.0).n("sharpen"))
    }

    // MARK: Rich text

    @Test fun wordsAreCutWhereTheGapsAre() {
        val t = ArtworkRuns.tokens("Ruby  ring")
        assertEquals(listOf("Ruby", "  ", "ring"), t.map { it.text })
        assertEquals(listOf(true, false, true), t.map { it.word })
        assertEquals(listOf(0, 4, 6), t.map { it.from })
        assertEquals(10, t.last().to)
        assertEquals(emptyList(), ArtworkRuns.tokens(""))
    }

    private fun bold() = mapOf<String, MarketingValue?>("font" to MarketingValue.string("bold"))

    @Test fun styledLettersBecomeARun() {
        val runs = ArtworkRuns.set(emptyList(), 0, 4, bold(), 9)
        assertEquals(1, runs.size)
        assertEquals(0.0, runs[0].n("from"))
        assertEquals(4.0, runs[0].n("to"))
        assertEquals("bold", runs[0].s("font"))
    }

    @Test fun runsAreKeptInsideTheWordsAndNeverEmpty() {
        val raw = listOf(
            MarketingValue.obj("from" to -3, "to" to 4, "font" to "bold"),
            MarketingValue.obj("from" to 5, "to" to 5, "font" to "bold"),
            MarketingValue.obj("from" to 7, "to" to 99, "color" to "#fff"),
            MarketingValue.obj("to" to 3),
        )
        val n = ArtworkRuns.normalize(raw, 9)
        assertEquals(listOf(0 to 4, 7 to 9), n.map { it.from to it.to })
        assertEquals("#fff", n[1].style["color"]?.string)
    }

    @Test fun neighboursWithTheSameStyleJoin() {
        var runs = ArtworkRuns.set(emptyList(), 0, 4, bold(), 9)
        runs = ArtworkRuns.set(runs, 5, 9, bold(), 9)
        assertEquals(2, runs.size)
        runs = ArtworkRuns.set(runs, 4, 5, bold(), 9)
        assertEquals(1, runs.size)
        assertEquals(0.0, runs[0].n("from"))
        assertEquals(9.0, runs[0].n("to"))
    }

    @Test fun aNullPatchValueClearsThatKeyAndAnEmptyRunGoes() {
        var runs = ArtworkRuns.set(emptyList(), 0, 9, mapOf("font" to MarketingValue.string("bold"), "upper" to MarketingValue.bool(true)), 9)
        runs = ArtworkRuns.set(runs, 0, 4, mapOf("font" to null), 9)
        // letters 0…4 keep only `upper`, the rest keep both
        assertEquals(2, runs.size)
        assertFalse(runs[0].obj.containsKey("font"))
        assertTrue(runs[0]["upper"].bool)
        assertEquals("bold", runs[1].s("font"))
        runs = ArtworkRuns.set(runs, 0, 9, mapOf("font" to null, "upper" to null), 9)
        assertEquals(emptyList(), runs)
    }

    @Test fun aStyleOverSomethingStyledKeepsWhatIsUnderIt() {
        var runs = ArtworkRuns.set(emptyList(), 0, 9, mapOf("color" to MarketingValue.string("#111111")), 9)
        runs = ArtworkRuns.set(runs, 2, 5, bold(), 9)
        assertEquals(3, runs.size)
        assertEquals("#111111", runs[1].s("color"))
        assertEquals("bold", runs[1].s("font"))
        assertEquals(2.0, runs[1].n("from"))
        assertEquals(5.0, runs[1].n("to"))
        assertNull(runs[0].obj["font"])
    }

    @Test fun anEmptyRangeChangesNothingButTidiesTheRuns() {
        val runs = ArtworkRuns.set(listOf(MarketingValue.obj("from" to 2, "to" to 20, "font" to "bold")), 5, 5, bold(), 9)
        assertEquals(9.0, runs.single().n("to"))
    }

    @Test fun boldAndItalicHaveTheirPartners() {
        assertEquals("bold", ArtworkRuns.boldOf["regular"])
        assertEquals("regular", ArtworkRuns.boldOf["bold"])
        assertEquals("montserrat-bold", ArtworkRuns.boldOf["montserrat"])
        assertEquals("cormorant-italic", ArtworkRuns.italicOf["cormorant"])
        assertNull(ArtworkRuns.italicOf["futura"])
    }

    @Test fun twentyFacesAreNamedAsTheWebNamesThem() {
        assertEquals(20, ArtworkFont.faces.size)
        assertEquals("Didone italic", ArtworkFont.label("serif-italic"))
        assertEquals("Tenor Sans", ArtworkFont.label("tenor"))
        assertEquals("Some face", ArtworkFont.label("some-face"))
        // the generic property rows offer the same twenty
        assertEquals(ArtworkFont.faces.map { it.first }, ArtworkProperties.choices.getValue("font"))
    }

    // MARK: Gradients

    @Test fun stopsAreSortedClampedAndAtLeastTwo() {
        val g = MarketingValue.obj("stops" to listOf(MarketingValue.obj("at" to 1.4, "color" to "#fff"), MarketingValue.obj("at" to -1, "color" to "#000", "alpha" to 2), MarketingValue.obj("color" to "#bad")))
        val s = ArtworkGradients.stops(g)
        assertEquals(listOf(0.0, 1.0), s.map { it.at })
        assertEquals("#000", s[0].color)
        assertEquals(1.0, s[0].alpha)
        // none: black to white
        assertEquals(listOf("#000000", "#ffffff"), ArtworkGradients.stops(MarketingValue.NULL).map { it.color })
        // one stop gets a partner at the other end
        val one = ArtworkGradients.stops(MarketingValue.obj("stops" to listOf(MarketingValue.obj("at" to 0.2, "color" to "#abc"))))
        assertEquals(listOf(0.2, 1.0), one.map { it.at })
        val last = ArtworkGradients.stops(MarketingValue.obj("stops" to listOf(MarketingValue.obj("at" to 1, "color" to "#abc"))))
        assertEquals(listOf(0.0, 1.0), last.map { it.at })
    }

    @Test fun equalPositionsKeepTheirOrder() {
        val g = MarketingValue.obj("stops" to listOf(MarketingValue.obj("at" to 0.5, "color" to "#111"), MarketingValue.obj("at" to 0.5, "color" to "#222"), MarketingValue.obj("at" to 0, "color" to "#000")))
        assertEquals(listOf("#000", "#111", "#222"), ArtworkGradients.stops(g).map { it.color })
    }

    @Test fun aGradientIsWrittenAsTheWebReadsIt() {
        val g = ArtworkGradients.make(angle = 100.0, stops = listOf(ArtworkStop(0.0, "#111111"), ArtworkStop(1.0, "#ffffff", 0.5)))
        assertEquals("linear", g.s("type"))
        assertEquals(100.0, g.n("angle"))
        assertEquals(2, g["stops"].array.size)
        assertTrue(g["stops"].array[0]["alpha"].isNull)
        assertEquals(0.5, g["stops"].array[1].n("alpha"))
    }

    @Test fun theFoilsHaveTheWebsFiveStops() {
        assertEquals(5, ArtworkGradients.stops(ArtworkGradients.gold).size)
        assertEquals("#8C6A25", ArtworkGradients.stops(ArtworkGradients.gold)[0].color)
        assertEquals(3, ArtworkGradients.others.size)
        assertEquals("radial", ArtworkGradients.others[1].gradient.s("type"))
    }

    @Test fun aStopBetweenTwoMixesTheirColours() {
        assertEquals("#808080", ArtworkGradients.mix("#000000", "#ffffff", 0.5))
        assertEquals("#000000", ArtworkGradients.mix("#000000", "#ffffff", 0.0))
        assertEquals("#ff0000", ArtworkGradients.mix("#ff0000", "nonsense", 0.5))
    }

    // MARK: Snapping and guides

    @Test fun aDragCatchesTheNearestLineWithinReach() {
        val lines = ArtworkSnap.lines(1080.0, 1920.0, 96.0, listOf(ArtworkBox(300.0, 400.0, 200.0, 100.0)), 0.0, listOf(700.0), emptyList())
        // the box's left edge is 4 off the other layer's left edge (300): it is nudged there
        val n = ArtworkSnap.snap(ArtworkBox(304.0, 800.0, 100.0, 100.0), lines, 8.0)
        assertEquals(-4.0, n.dx)
        assertEquals(300.0, n.v)
        // nothing near on the other axis
        assertEquals(0.0, n.dy)
        assertNull(n.h)
    }

    @Test fun theNearestOfSeveralWins() {
        val lines = ArtworkSnap.Lines(listOf(100.0, 107.0), emptyList())
        val n = ArtworkSnap.snap(ArtworkBox(105.0, 0.0, 50.0, 50.0), lines, 8.0)
        assertEquals(2.0, n.dx)
        assertEquals(107.0, n.v)
    }

    @Test fun theCentreOfABoxSnapsToThePagesMiddle() {
        val lines = ArtworkSnap.lines(1080.0, 1920.0, 96.0, emptyList(), 0.0, emptyList(), emptyList())
        val n = ArtworkSnap.snap(ArtworkBox(440.0, 500.0, 200.0, 100.0), lines, 8.0)
        // centre is 540 = the page's middle already
        assertEquals(0.0, n.dx)
        assertEquals(540.0, n.v)
        val off = ArtworkSnap.snap(ArtworkBox(446.0, 500.0, 200.0, 100.0), lines, 8.0)
        assertEquals(-6.0, off.dx)
    }

    @Test fun theMarginIs96OnAStoryAnd45OnASquare() {
        assertEquals(96.0, ArtworkSnap.margin(1920.0))
        assertEquals(45.0, ArtworkSnap.margin(1080.0))
        val lines = ArtworkSnap.lines(1080.0, 1080.0, 45.0, emptyList(), 0.0, emptyList(), emptyList())
        assertTrue(lines.xs.containsAll(listOf(540.0, 45.0, 1035.0)))
    }

    @Test fun aGridAddsLinesButNeverMoreThanSixHundred() {
        val lines = ArtworkSnap.lines(1080.0, 1920.0, 96.0, emptyList(), 60.0, emptyList(), emptyList())
        assertTrue(lines.xs.contains(60.0) && lines.xs.contains(1020.0))
        assertFalse(lines.xs.contains(1080.0))
        assertTrue(ArtworkSnap.lines(1080.0, 1920.0, 96.0, emptyList(), 3.0, emptyList(), emptyList()).xs.size == 3)
        assertTrue(ArtworkSnap.lines(100000.0, 1920.0, 96.0, emptyList(), 4.0, emptyList(), emptyList()).xs.size <= 603)
    }

    @Test fun guidesBelongToTheDocumentAndStayOnThePage() {
        val doc = NativeArtwork.blank().withPath(listOf("meta", "guides", "x"), MarketingValue.of(listOf(540.2, 0, 2000, 540, 100)))
        assertEquals(listOf(100.0, 540.0), ArtworkSnap.guides(doc, "x"))
        assertEquals(emptyList(), ArtworkSnap.guides(doc, "y"))
        val moved = ArtworkSnap.withGuides(doc, "y", listOf(300.0))
        assertEquals(listOf(300.0), ArtworkSnap.guides(moved, "y"))
        assertEquals(listOf(100.0, 540.0), ArtworkSnap.guides(moved, "x"))
        assertEquals(0.0, ArtworkSnap.grid(doc))
        assertEquals(60.0, ArtworkSnap.grid(ArtworkSnap.withGrid(doc, 60.0)))
        assertEquals(0.0, ArtworkSnap.grid(ArtworkSnap.withGrid(ArtworkSnap.withGrid(doc, 60.0), null)))
        // the guides survive the grid going
        assertEquals(listOf(100.0, 540.0), ArtworkSnap.guides(ArtworkSnap.withGrid(ArtworkSnap.withGrid(doc, 60.0), null), "x"))
    }

    @Test fun theBoxesOfSeveralLayersAreOneBox() {
        val u = ArtworkBox.union(listOf(ArtworkBox(10.0, 20.0, 100.0, 50.0), ArtworkBox(200.0, 5.0, 30.0, 30.0)))!!
        assertEquals(10.0, u.x)
        assertEquals(5.0, u.y)
        assertEquals(220.0, u.w)
        assertEquals(65.0, u.h)
        assertNull(ArtworkBox.union(emptyList()))
    }

    // MARK: Match the first one picked

    private fun layer(id: String, kind: String, vararg more: Pair<String, Any?>) = MarketingValue.of(mapOf<String, Any?>("id" to id, "kind" to kind).plus(more))

    @Test fun theOthersTakeTheFirstOnesWidthAndHeight() {
        val layers = listOf(layer("ref", "rect", "x" to 0, "y" to 0, "w" to 200, "h" to 100), layer("b", "rect", "x" to 50, "y" to 50, "w" to 100, "h" to 100))
        val boxes = mapOf("ref" to ArtworkBox(0.0, 0.0, 200.0, 100.0), "b" to ArtworkBox(50.0, 50.0, 100.0, 100.0))
        val out = ArtworkMatch.apply("both", "ref", layers, setOf("ref", "b"), boxes)
        assertEquals(200.0, out[1].n("w"))
        assertEquals(100.0, out[1].n("h"))
        // the reference itself does not move
        assertEquals(layers[0], out[0])
    }

    @Test fun placeMovesByTheDifferenceOfBoxesNotOfFields() {
        val layers = listOf(layer("ref", "rect", "x" to 100, "y" to 100, "w" to 10, "h" to 10), layer("t", "text", "x" to 0, "y" to 0, "flow" to "stack"))
        val boxes = mapOf("ref" to ArtworkBox(100.0, 100.0, 10.0, 10.0), "t" to ArtworkBox(30.0, 40.0, 50.0, 20.0))
        val out = ArtworkMatch.apply("position", "ref", layers, setOf("ref", "t"), boxes)
        assertEquals(70.0, out[1].n("x"))
        assertEquals(60.0, out[1].n("y"))
        // a placed text is not flowed any more
        assertTrue(out[1]["flow"].isNull)
    }

    @Test fun aLockedLayerAndAnUnselectedOneStayPut() {
        val layers = listOf(layer("ref", "rect", "x" to 0, "y" to 0, "w" to 200, "h" to 100), layer("l", "rect", "w" to 10, "h" to 10, "locked" to true), layer("u", "rect", "w" to 10, "h" to 10))
        val boxes = mapOf("ref" to ArtworkBox(0.0, 0.0, 200.0, 100.0), "l" to ArtworkBox(0.0, 0.0, 10.0, 10.0), "u" to ArtworkBox(0.0, 0.0, 10.0, 10.0))
        val out = ArtworkMatch.apply("width", "ref", layers, setOf("ref", "l"), boxes)
        assertEquals(layers, out)
    }

    @Test fun aTextIsSizedByItsLineWidthWithinTheWebsLimits() {
        val layers = listOf(layer("ref", "rect", "w" to 4000, "h" to 10), layer("t", "text", "width" to 400))
        val boxes = mapOf("ref" to ArtworkBox(0.0, 0.0, 4000.0, 10.0), "t" to ArtworkBox(0.0, 0.0, 400.0, 20.0))
        val out = ArtworkMatch.apply("width", "ref", layers, setOf("ref", "t"), boxes)
        assertEquals(2400.0, out[1].n("width"))
        val small = ArtworkMatch.apply("width", "ref", listOf(layer("ref", "rect"), layer("t", "text", "width" to 400)), setOf("ref", "t"), mapOf("ref" to ArtworkBox(0.0, 0.0, 10.0, 10.0), "t" to ArtworkBox(0.0, 0.0, 400.0, 20.0)))
        assertEquals(80.0, small[1].n("width"))
    }

    @Test fun aPictureWithAHeightIsSizedBothWays() {
        val layers = listOf(layer("ref", "rect"), layer("i", "image", "w" to 100, "h" to 100), layer("n", "image", "w" to 100))
        val boxes = mapOf("ref" to ArtworkBox(0.0, 0.0, 300.0, 50.0), "i" to ArtworkBox(0.0, 0.0, 100.0, 100.0), "n" to ArtworkBox(0.0, 0.0, 100.0, 100.0))
        val out = ArtworkMatch.apply("both", "ref", layers, setOf("ref", "i", "n"), boxes)
        assertEquals(300.0, out[1].n("w"))
        assertEquals(50.0, out[1].n("h"))
        // with no height it stays square to its width: the stronger change wins
        assertEquals(300.0, out[2].n("w"))
        assertTrue(out[2]["h"].isNull)
    }

    @Test fun noReferenceBoxChangesNothing() {
        val layers = listOf(layer("a", "rect"))
        assertEquals(layers, ArtworkMatch.apply("both", "ghost", layers, setOf("a"), emptyMap()))
        assertEquals(6, ArtworkMatch.hows.size)
    }

    // MARK: QR codes

    @Test fun aQrLayerIsTheWebsNewQr() {
        val q = ArtworkQR.layer("https://taheri.shop", 1080.0, 1920.0, id = "qr-abc123")
        assertEquals("qr", q.s("kind"))
        assertEquals(300.0, q.n("w"))
        assertEquals(390.0, q.n("x"))
        assertEquals(714.0, q.n("y"))
        assertEquals("#111111", q.s("fg"))
        assertEquals("#FFFFFF", q.s("bg"))
        assertEquals(4.0, q.n("quiet"))
        assertEquals("cta", q.s("role"))
        // a narrow page keeps room round it
        assertEquals(200.0, ArtworkQR.layer("x", 360.0, 640.0, id = "q").n("w"))
    }

    @Test fun aCodeNeedsWordsAndHoldsOnlyWhatFits() {
        assertNotNull(ArtworkQR.problem(""))
        assertNull(ArtworkQR.problem("https://taheri.shop"))
        assertNull(ArtworkQR.problem("a".repeat(2000)))
        assertNotNull(ArtworkQR.problem("a".repeat(2001)))
        // counted in bytes, not letters
        assertNotNull(ArtworkQR.problem("é".repeat(1001)))
        assertEquals(120.0, ArtworkQR.MINIMUM)
    }
}
