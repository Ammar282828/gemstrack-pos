package erp.app.screens.marketing

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ArtworkOpsTests {
    private fun layerMap(id: String, x: Double = 0.0, group: String = "", locked: Boolean = false): Map<String, Any?> =
        mapOf("id" to id, "x" to x, "y" to 0, "group" to group, "locked" to locked, "kind" to "text", "text" to id)

    private fun layer(id: String, x: Double = 0.0, group: String = "", locked: Boolean = false) = MarketingValue.of(layerMap(id, x, group, locked))

    private fun docOf(vararg layers: Map<String, Any?>) = NativeArtwork.blank().with("layers", MarketingValue.of(layers.toList()))
    private fun ids(d: MarketingValue) = ArtworkOps.layers(d).map { it.s("id") }

    @Test fun aTapSelectsTheLayerAndItsGroup() {
        val layers = listOf(layer("a", group = "g"), layer("b", group = "g"), layer("c"))
        assertEquals(setOf("a", "b"), ArtworkOps.select(layers, emptySet(), "a", false))
        assertEquals(setOf("c"), ArtworkOps.select(layers, setOf("a", "b"), "c", false))
        // tapping one of several chosen keeps them, so they can be moved together
        assertEquals(setOf("a", "b"), ArtworkOps.select(layers, setOf("a", "b"), "a", false))
    }

    @Test fun aLongPressAddsOrTakesAway() {
        val layers = listOf(layer("a"), layer("b"))
        assertEquals(setOf("a", "b"), ArtworkOps.select(layers, setOf("a"), "b", true))
        assertEquals(setOf("a"), ArtworkOps.select(layers, setOf("a", "b"), "b", true))
    }

    @Test fun frontAndBackKeepTheChosenOrder() {
        val d = docOf(layerMap("a"), layerMap("b"), layerMap("c"), layerMap("d"))
        assertEquals(listOf("a", "d", "b", "c"), ids(ArtworkOps.reorder(d, setOf("b", "c"), front = true)))
        assertEquals(listOf("b", "c", "a", "d"), ids(ArtworkOps.reorder(d, setOf("b", "c"), front = false)))
    }

    @Test fun oneStepUpOrDownMovesTheChosenOnePlace() {
        val d = docOf(layerMap("a"), layerMap("b"), layerMap("c"))
        assertEquals(listOf("a", "c", "b"), ids(ArtworkOps.step(d, setOf("b"), 1)))
        assertEquals(listOf("b", "a", "c"), ids(ArtworkOps.step(d, setOf("b"), -1)))
        // at the top there is nowhere to go; two neighbours move together
        assertEquals(listOf("a", "b", "c"), ids(ArtworkOps.step(d, setOf("c"), 1)))
        assertEquals(listOf("c", "a", "b"), ids(ArtworkOps.step(d, setOf("a", "b"), 1)))
    }

    @Test fun duplicateMakesUnlockedCopiesBesideTheOriginalsWithNewGroups() {
        var n = 0
        val d = docOf(layerMap("a", 10.0, group = "g", locked = true), layerMap("b", 20.0, group = "g"))
        val (made, newIds) = ArtworkOps.duplicate(d, ArtworkOps.layers(d)) { "n${++n}" }
        assertEquals(4, ArtworkOps.layers(made).size)
        val copies = ArtworkOps.layers(made).drop(2)
        assertEquals(2, newIds.size)
        assertEquals(34.0, copies[0].n("x"))
        assertEquals(24.0, copies[0].n("y"))
        assertFalse(copies[0]["locked"].bool)
        // both copies share one new group, which is not the old one
        assertEquals(copies[0].s("group"), copies[1].s("group"))
        assertTrue(copies[0].s("group") != "g")
    }

    @Test fun removeLeavesALockedLayer() {
        val d = docOf(layerMap("a"), layerMap("b", locked = true), layerMap("c"))
        assertEquals(listOf("b", "c"), ids(ArtworkOps.remove(d, setOf("a", "b"))))
    }

    @Test fun lockAndMirrorSkipLockedLayers() {
        val d = docOf(layerMap("a"), layerMap("b", locked = true))
        val set = ArtworkOps.setSelected(d, setOf("a", "b"), mapOf("group" to MarketingValue.string("g")))
        assertEquals("g", ArtworkOps.layers(set)[0].s("group"))
        assertEquals("", ArtworkOps.layers(set)[1].s("group"))
        val flipped = ArtworkOps.flip(d, setOf("a", "b"), "flipX")
        assertTrue(ArtworkOps.layers(flipped)[0]["flipX"].bool)
        assertTrue(ArtworkOps.layers(flipped)[1]["flipX"].isNull)
    }

    @Test fun aDragMovesFromWhereItStartedAndLetsGoOfFlow() {
        val d = docOf(layerMap("a", 100.0) + ("flow" to "stack"), layerMap("b", 50.0, locked = true))
        val moved = ArtworkOps.dragged(d, setOf("a", "b"), 30.0, -10.0)
        val a = ArtworkOps.layers(moved)[0]
        assertEquals(130.0, a.n("x"))
        assertEquals(-10.0, a.n("y"))
        assertTrue(a["flow"].isNull)
        assertEquals(50.0, ArtworkOps.layers(moved)[1].n("x"))
        // dragging again from the same start does not add up
        assertEquals(125.0, ArtworkOps.layers(ArtworkOps.dragged(d, setOf("a"), 25.0, 0.0))[0].n("x"))
    }

    @Test fun aLayerIsNamedByItsNameItsFieldItsWordsOrItsKind() {
        assertEquals("Logo", ArtworkOps.name(MarketingValue.obj("name" to "Logo", "text" to "x")))
        assertEquals("Headline", ArtworkOps.name(MarketingValue.obj("bind" to "headline")))
        assertEquals("Ruby", ArtworkOps.name(MarketingValue.obj("text" to "Ruby", "kind" to "text")))
        assertEquals("Rect", ArtworkOps.name(MarketingValue.obj("kind" to "rect")))
        assertEquals("Photo 2", ArtworkOps.photoName(listOf("b", "a", "c"), "b"))
    }

    @Test fun theCropLivesPerPhotoInASquareAndInTheBackgroundOtherwise() {
        val story = NativeArtwork.blank("p1")
        assertEquals("fill", ArtworkOps.placement(story).s("mode"))
        val zoomed = ArtworkOps.withPlacement(story, MarketingValue.obj("mode" to "fit", "zoom" to 2))
        assertEquals("fit", zoomed["bg"]["placement"].s("mode"))
        val square = NativeArtwork.blank("p1", 1080.0)
        assertEquals(1.0, ArtworkOps.placement(square).n("zoom"))
        val set = ArtworkOps.withPlacement(square, MarketingValue.obj("mode" to "fit", "zoom" to 3))
        assertEquals(3.0, set["placements"]["p1"].n("zoom"))
        assertEquals(3.0, ArtworkOps.placement(set).n("zoom"))
        // no photo chosen: the crop is the background's own
        val bare = NativeArtwork.blank(null, 1080.0)
        assertEquals(1.0, ArtworkOps.withPlacement(bare, MarketingValue.obj("zoom" to 1))["bg"]["placement"].n("zoom"))
    }

    @Test fun undoStepsAndFoldsASlidersSteps() {
        val h = ArtworkHistory()
        val a = docOf(layerMap("a"))
        val b = a.with("size", 10)
        val c = a.with("size", 11)
        val d = a.with("size", 12)
        assertFalse(h.change(a, a, nowMillis = 0))
        assertTrue(h.change(a, b, "size", 1000))
        // the same slider within 1.2 s is the same step
        assertTrue(h.change(b, c, "size", 1500))
        assertTrue(h.change(c, d, "size", 2000))
        assertEquals(a, h.back(d))
        assertNull(h.back(a))
        assertEquals(d, h.forward(a))
        assertFalse(h.canRedo)
        // later is a new step
        assertTrue(h.change(d, c, "size", 9000))
        assertEquals(d, h.back(c))
    }

    @Test fun theStackStopsAtEighty() {
        val h = ArtworkHistory()
        var cur = docOf(layerMap("a"))
        repeat(90) { i ->
            val next = cur.with("n", i)
            h.change(cur, next, null, i * 10_000L)
            cur = next
        }
        var steps = 0
        var at = cur
        while (true) { at = h.back(at) ?: break; steps++ }
        assertEquals(80, steps)
    }

    @Test fun aGestureIsOneStepIfItMovedAnything() {
        val h = ArtworkHistory()
        val a = docOf(layerMap("a"))
        h.gesture(a, a)
        assertFalse(h.canUndo)
        h.gesture(a, ArtworkOps.dragged(a, setOf("a"), 5.0, 5.0))
        assertTrue(h.canUndo)
    }
}
