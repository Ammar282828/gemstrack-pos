package erp.core

import erp.core.logic.LabelAlign
import erp.core.logic.LabelAxis
import erp.core.logic.LabelBitmap
import erp.core.logic.LabelBox
import erp.core.logic.LabelEditing
import erp.core.logic.LabelGeometry
import erp.core.logic.LabelHandle
import erp.core.logic.LabelHistory
import erp.core.logic.LabelMeasure
import erp.core.logic.LabelOrder
import erp.core.logic.LabelPlaceholders
import erp.core.logic.LabelUnits
import erp.core.logic.Zpl
import erp.core.models.LabelFieldType
import erp.core.models.LabelLayout
import erp.core.models.LabelLayoutField
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The tag designer's arithmetic (LabelGeometry, LabelEditing, LabelPlaceholders). All values are made up. (LabelDesignerTests.swift.) */
class LabelDesignerTests {
    private val m = LabelMeasure.estimate

    private fun text(
        id: String = "a", x: Int = 10, y: Int = 20, rotation: Int = 0, data: String = "ABCD", fs: Int = 20,
        width: Int? = null, lines: Int? = null, align: String? = null,
    ) = LabelLayoutField(id = id, type = LabelFieldType.text, x = x, y = y, rotation = rotation, data = data, fontSize = fs, width = width, lines = lines, align = align)

    private fun box(id: String, x: Int, y: Int, w: Int, h: Int) = LabelLayoutField(id = id, type = LabelFieldType.box, x = x, y = y, width = w, height = h)

    private val layout get() = LabelLayout(id = "t", name = "T", widthDots = 400, heightDots = 200)

    @Test
    fun testTextBoundsSwapAtQuarterTurns() {
        // estimate: 4 letters x 20 x 0.5 = 40 wide, 20 tall
        assertEquals(LabelBox(10.0, 20.0, 40.0, 20.0), LabelGeometry.bounds(text(), m))
        assertEquals(LabelBox(10.0, 20.0, 20.0, 40.0), LabelGeometry.bounds(text(rotation = 90), m))
        assertEquals(LabelBox(10.0, 20.0, 40.0, 20.0), LabelGeometry.bounds(text(rotation = 180), m))
        assertEquals(270, LabelGeometry.placement(text(rotation = 270), m).turn)
    }

    @Test
    fun testStackedLinesRunDownAndBlockHeightFollowsLines() {
        val t = text(data = "AB\nCD\nEF")
        val l = LabelGeometry.textLines(t, m)
        assertEquals(listOf(0.0, 20.0, 40.0), l.lines.map { it.y })
        assertEquals(60.0, l.height)
        val block = text(data = "AB", width = 100, lines = 5)
        assertEquals(100.0, LabelGeometry.bounds(block, m).h)
        assertEquals(100.0, LabelGeometry.bounds(block, m).w)
    }

    @Test
    fun testBlockWrapsAndAligns() {
        val t = text(data = "AAAA BBBB CCCC", width = 90, lines = 3, align = "R")
        val l = LabelGeometry.textLines(t, m).lines
        assertEquals(listOf("AAAA BBBB", "CCCC"), l.map { it.text })
        assertEquals(50.0, l[1].x)
        // lines held to the field's count
        val held = LabelGeometry.textLines(text(data = "AAAA BBBB CCCC", width = 45, lines = 2), m).lines
        assertEquals(2, held.size)
    }

    @Test
    fun testShapesNeverTurnAndPicturesTurnHalf() {
        val b = box("b", 5, 6, 30, 10).copy(rotation = 90)
        assertEquals(LabelBox(5.0, 6.0, 30.0, 10.0), LabelGeometry.placement(b, m).bounds)
        assertEquals(0, LabelGeometry.placement(b, m).turn)
        var i = LabelLayoutField(id = "i", type = LabelFieldType.image, rotation = 180, width = 8, height = 8, bitmap = "AA==")
        assertEquals(180, LabelGeometry.placement(i, m).turn)
        i = i.copy(rotation = 90)
        assertEquals(0, LabelGeometry.placement(i, m).turn)
    }

    @Test
    fun testQRSizeIsModulesTimesMagnification() {
        val q = LabelLayoutField(id = "q", type = LabelFieldType.qr, data = "ABC", qrMagnification = 3)
        assertEquals((21 * 3).toDouble(), LabelGeometry.bounds(q, m).w)
    }

    @Test
    fun testRotateKeepsTheCentre() {
        val r = LabelEditing.rotated(text(), 90, m)
        assertEquals(90, r.rotation)
        val a = LabelGeometry.bounds(text(), m)
        val b = LabelGeometry.bounds(r, m)
        assertEquals(a.midX, b.midX)
        assertEquals(a.midY, b.midY)
        assertEquals(270, LabelEditing.rotated(text(rotation = 0), -90, m).rotation)
        val s = LabelEditing.rotated(box("b", 0, 0, 40, 10), measure = m)
        assertEquals(10, s.width)
        assertEquals(40, s.height)
        assertEquals(15, s.x)
        assertEquals(-15, s.y)
        assertEquals(180, LabelEditing.rotated(LabelLayoutField(id = "i", type = LabelFieldType.image, width = 4, height = 4), measure = m).rotation)
    }

    @Test
    fun testResizeBoxFromTopLeftKeepsFarCorner() {
        val b = box("b", 10, 10, 50, 20)
        val r = LabelEditing.resized(b, LabelHandle.topLeft, LabelBox(0.0, 5.0, 60.0, 25.0), m)
        assertEquals(listOf(0, 5, 60, 25), listOf(r.x, r.y, r.width!!, r.height!!))
    }

    @Test
    fun testResizeTextSetsWidthAndFontSize() {
        val t = text(data = "ABCDEFGH")
        val wide = LabelEditing.resized(t, LabelHandle.right, LabelBox(10.0, 20.0, 120.0, 20.0), m)
        assertEquals(120, wide.width)
        assertEquals(20, wide.fontSize)
        val tall = LabelEditing.resized(t, LabelHandle.bottom, LabelBox(10.0, 20.0, 80.0, 40.0), m)
        assertEquals(40, tall.fontSize)
        assertNull(tall.width)
    }

    @Test
    fun testResizeQRStepsMagnification() {
        val q = LabelLayoutField(id = "q", type = LabelFieldType.qr, x = 0, y = 0, data = "ABC", qrMagnification = 2)
        val r = LabelEditing.resized(q, LabelHandle.bottomRight, LabelBox(0.0, 0.0, 130.0, 130.0), m)
        assertEquals(6, r.qrMagnification)
        val top = LabelEditing.resized(q, LabelHandle.topLeft, LabelBox(-84.0, -84.0, 126.0, 126.0), m)
        assertEquals(6, top.qrMagnification)
        assertEquals(42 - 126, top.x)
        assertEquals(42 - 126, top.y)
    }

    @Test
    fun testResizeBarcodeHeight() {
        val b = LabelLayoutField(id = "b", type = LabelFieldType.barcode, data = "AB", height = 40, moduleWidth = 2, showText = true)
        val r = LabelEditing.resized(b, LabelHandle.bottom, LabelBox(0.0, 0.0, 114.0, 100.0), m)
        assertEquals(80, r.height)
    }

    @Test
    fun testLockedFieldsDoNotMove() {
        val a = text("a").copy(locked = true)
        val out = LabelEditing.moved(listOf(a, text("b")), setOf("a", "b"), 5, 5)
        assertEquals(10, out[0].x)
        assertEquals(15, out[1].x)
        assertEquals(a, LabelEditing.resized(a, LabelHandle.right, LabelBox(0.0, 0.0, 99.0, 99.0), m))
    }

    @Test
    fun testAlignAndDistribute() {
        val f = listOf(box("a", 0, 0, 10, 10), box("b", 30, 5, 20, 10), box("c", 100, 9, 10, 10))
        val left = LabelEditing.aligned(f, setOf("a", "b", "c"), LabelAlign.right, measure = m)
        assertEquals(listOf(110, 110, 110), left.map { it.x + it.width!! })
        val mid = LabelEditing.aligned(f, setOf("b"), LabelAlign.centre, within = LabelBox(0.0, 0.0, 400.0, 200.0), measure = m)
        assertEquals(190, mid[1].x)
        val d = LabelEditing.distributed(f, setOf("a", "b", "c"), LabelAxis.horizontal, m)
        // span 110, widths 40, gap 35
        assertEquals(listOf(0, 45, 100), d.map { it.x })
    }

    @Test
    fun testStackOrder() {
        val f = listOf("a", "b", "c", "d").map { text(it) }
        assertEquals(listOf("a", "c", "b", "d"), LabelEditing.reordered(f, setOf("b"), LabelOrder.forward).map { it.id })
        assertEquals(listOf("b", "a", "c", "d"), LabelEditing.reordered(f, setOf("b"), LabelOrder.backward).map { it.id })
        assertEquals(listOf("c", "d", "a", "b"), LabelEditing.reordered(f, setOf("a", "b"), LabelOrder.front).map { it.id })
        assertEquals(listOf("c", "d", "a", "b"), LabelEditing.reordered(f, setOf("c", "d"), LabelOrder.back).map { it.id })
        assertEquals(listOf("a", "b", "c", "d"), LabelEditing.reordered(f, setOf("d"), LabelOrder.forward).map { it.id })
        // layers list shows d c b a; dragging "d" (row 0) below "c" (destination 2)
        assertEquals(listOf("a", "b", "d", "c"), LabelEditing.reorderedByLayerList(f, setOf(0), 2).map { it.id })
    }

    @Test
    fun testDuplicateGivesFreshIds() {
        val now = Instant.ofEpochSecond(1000)
        val r = LabelEditing.duplicated(listOf(text("field-1000000")), setOf("field-1000000"), now = now)
        assertEquals(2, r.fields.size)
        assertEquals(20, r.fields[1].x)
        assertEquals(listOf("field-1000000-2"), r.ids)
    }

    @Test
    fun testClipboardRoundTrips() {
        val s = LabelEditing.clipboardText(listOf(text("a", data = "{sku}")))
        assertEquals("{sku}", LabelEditing.fields(s).firstOrNull()?.data)
        assertTrue(LabelEditing.fields("hello").isEmpty())
    }

    @Test
    fun testSnap() {
        val label = LabelBox(0.0, 0.0, 400.0, 200.0)
        val g = LabelEditing.snap(LabelBox(13.0, 27.0, 10.0, 10.0), emptyList(), label, 8, 4.0)
        assertEquals(3.0, g.dx)
        assertEquals(-3.0, g.dy)
        val o = LabelEditing.snap(LabelBox(198.0, 50.0, 10.0, 10.0), emptyList(), label, null, 4.0)
        assertEquals(200.0, o.guideX)
        assertEquals(2.0, o.dx) // its left edge (198) to the label centre (200)
        assertNull(o.guideY)
    }

    @Test
    fun testResampleBitmap() {
        // 2x2: black top-left and bottom-right -> 4x4 doubles each dot
        val src = LabelBitmap.base64Encode(intArrayOf(0x80, 0x40))
        val out = LabelEditing.resampledBitmap(src, 2, 2, 4, 4)!!
        assertContentEquals(intArrayOf(0xC0, 0xC0, 0x30, 0x30), LabelBitmap.base64Decode(out)!!)
    }

    @Test
    fun testHistoryCoalescesAndUndoes() {
        val h = LabelHistory()
        var l = layout
        val t0 = Instant.ofEpochSecond(0)
        h.record(l, "drag", t0)
        l = l.copy(name = "1")
        h.record(l, "drag", t0.plusMillis(300))
        l = l.copy(name = "2")
        assertEquals(1, h.past.size)
        val back = h.undo(l)!!
        assertEquals("T", back.name)
        assertTrue(h.canRedo)
        assertEquals("2", h.redo(back)?.name)
        h.record(l, null, t0.plusSeconds(5))
        assertFalse(h.canRedo)
    }

    @Test
    fun testUnitsAndChips() {
        assertEquals(671, LabelUnits.dots(84.0, 203))
        assertEquals(312, LabelUnits.dots(39.0, 203))
        assertEquals("84", LabelUnits.mmText(671.0, 203))
        assertEquals(listOf("{metal_type_1}", "{metal_type_2}"), LabelPlaceholders.tokens("csv:metal_type", 2))
        assertEquals(listOf("{sku}"), LabelPlaceholders.tokens("sku", 1))
        assertEquals(listOf("{sku|upper}", "{date}"), LabelPlaceholders.tokens("a {sku|upper} b {date} {x"))
        // Every chip means something to Zpl with the sample values.
        val pieces = listOf(LabelPlaceholders.sampleValues(1), LabelPlaceholders.sampleValues(2))
        for (c in LabelPlaceholders.pieceChips(2) + LabelPlaceholders.csvChips(2)) {
            assertNotEquals(c.token, Zpl.resolveText(c.token, pieces), c.token)
        }
    }
}
