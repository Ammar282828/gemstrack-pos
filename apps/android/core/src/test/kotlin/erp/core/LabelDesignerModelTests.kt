package erp.core

import erp.core.logic.LabelAlign
import erp.core.logic.LabelBox
import erp.core.logic.LabelDesignerModel
import erp.core.logic.LabelHandle
import erp.core.logic.LabelMeasure
import erp.core.logic.LabelNewKind
import erp.core.logic.LabelOrder
import erp.core.models.LabelFieldType
import erp.core.models.LabelLayout
import erp.core.models.LabelLayoutField
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** What the designer's screen does to a layout, without the screen (LabelDesignerModel.swift's behaviour). All values are made up. */
class LabelDesignerModelTests {
    private val m = LabelMeasure.estimate
    private val t0 = Instant.ofEpochSecond(1_700_000_000)

    private fun text(id: String, x: Int, y: Int, data: String = "ABCD") = LabelLayoutField(id = id, type = LabelFieldType.text, x = x, y = y, data = data, fontSize = 20)
    private fun model(vararg fields: LabelLayoutField, tags: Int? = null) =
        LabelDesignerModel(LabelLayout(id = "t", name = "T", widthDots = 400, heightDots = 200, tags = tags, fields = fields.toList()), m).also { it.stageW = 444.0; it.stageH = 288.0 }

    @Test
    fun everyChangeIsAnUndoStepAndASaveCallback() {
        val md = model(text("a", 10, 10))
        val saved = ArrayList<LabelLayout>()
        md.onChange = { saved.add(it) }
        md.select(setOf("a"))
        val before = md.revision
        md.nudge(5, 0)
        assertEquals(15, md.layout.fields[0].x)
        assertTrue(md.edited)
        assertTrue(md.revision > before)
        assertEquals(1, saved.size)
        md.undo()
        assertEquals(10, md.layout.fields[0].x)
        assertTrue(md.canRedo)
        md.redo()
        assertEquals(15, md.layout.fields[0].x)
        // A change that changes nothing is no step.
        val steps = md.history.past.size
        md.nudge(0, 0)
        assertEquals(steps, md.history.past.size)
    }

    @Test
    fun readOnlyChangesNothing() {
        val md = model(text("a", 10, 10))
        md.readOnly = true
        md.select(setOf("a"))
        md.nudge(5, 5)
        md.deleteSelection()
        md.add(LabelNewKind.Text)
        assertEquals(listOf(10), md.layout.fields.map { it.x })
        assertFalse(md.edited)
        assertFalse(md.canUndo)
    }

    @Test
    fun addingCentresANewFieldAndSelectsIt() {
        val md = model()
        md.add(LabelNewKind.Qr, t0)
        val f = md.layout.fields.single()
        assertEquals(LabelFieldType.qr, f.type)
        assertEquals("field-1700000000000", f.id)
        assertEquals(setOf(f.id), md.selection)
        // 21 modules x magnification 3 = 63 dots square, centred on 400 x 200 (a half goes up).
        assertEquals(listOf(169, 69), listOf(f.x, f.y))
        md.add(LabelNewKind.Variable("{sku}"), t0)
        assertEquals("field-1700000000000-2", md.layout.fields.last().id)
    }

    @Test
    fun deletingKeepsLockedFieldsAndTheSelectionFollows() {
        val md = model(text("a", 0, 0), text("b", 10, 0).copy(locked = true), text("c", 20, 0))
        md.selectAll()
        md.deleteSelection()
        assertEquals(listOf("b"), md.layout.fields.map { it.id })
        assertEquals(setOf("b"), md.selection)
    }

    @Test
    fun duplicatePasteAndCopyCarryTheFieldsOver() {
        val md = model(text("a", 10, 10, "{sku}"))
        md.select(setOf("a"))
        md.duplicateSelection(t0)
        assertEquals(2, md.layout.fields.size)
        assertEquals(20, md.layout.fields[1].x)
        assertEquals(setOf(md.layout.fields[1].id), md.selection)
        md.select(setOf("a"))
        val clip = md.copyText()
        assertTrue(md.canPaste(clip))
        assertFalse(md.canPaste("hello"))
        md.paste(clip, t0.plusSeconds(5))
        assertEquals(3, md.layout.fields.size)
        assertEquals("{sku}", md.layout.fields[2].data)
        assertNull(model().copyText())
    }

    @Test
    fun aDragMovesTheSelectionByTheOffsetFromWhereItStarted() {
        val md = model(text("a", 10, 10), text("b", 50, 10))
        md.place(mapOf("a" to (10 to 10), "b" to (50 to 10)), 7, 3, "drag-1")
        md.place(mapOf("a" to (10 to 10), "b" to (50 to 10)), 12, 4, "drag-1")
        assertEquals(listOf(22, 62), md.layout.fields.map { it.x })
        assertEquals(listOf(14, 14), md.layout.fields.map { it.y })
        // The whole drag is one undo step.
        assertEquals(1, md.history.past.size)
    }

    @Test
    fun aHandleResizesFromTheFieldAsItWasWhenTheDragBegan() {
        val start = LabelLayoutField(id = "b", type = LabelFieldType.box, x = 10, y = 10, width = 50, height = 20)
        val md = model(start)
        md.resize(start, LabelHandle.topLeft, LabelBox(0.0, 5.0, 60.0, 25.0), "resize-1")
        md.resize(start, LabelHandle.topLeft, LabelBox(2.0, 6.0, 58.0, 24.0), "resize-1")
        val f = md.layout.fields[0]
        assertEquals(listOf(2, 6, 58, 24), listOf(f.x, f.y, f.width!!, f.height!!))
    }

    @Test
    fun aTextKeepsItsPlaceholdersWhenItIsTurned() {
        val md = model(text("a", 10, 10, "{sku}"))
        md.select(setOf("a"))
        md.rotateSelection()
        val f = md.layout.fields[0]
        assertEquals(90, f.rotation)
        assertEquals("{sku}", f.data)
    }

    @Test
    fun alignOrderAndLayersWork() {
        val md = model(text("a", 10, 10), text("b", 100, 40), text("c", 200, 70))
        md.select(setOf("a", "b"))
        md.align(LabelAlign.left)
        assertEquals(listOf(10, 10, 200), md.layout.fields.map { it.x })
        md.select(setOf("a"))
        md.order(LabelOrder.front)
        assertEquals(listOf("b", "c", "a"), md.layout.fields.map { it.id })
        // The layers list is top first: the field on top is row 0.
        md.moveLayers(setOf(0), 3)
        assertEquals(listOf("a", "b", "c"), md.layout.fields.map { it.id })
        md.setHidden("b", true)
        md.setLocked("c", true)
        assertTrue(md.layout.fields[1].hidden)
        assertTrue(md.layout.fields[2].locked)
        // A locked field does not move.
        md.selectAll()
        md.nudge(5, 0)
        assertEquals(listOf(15, 15, 200), md.layout.fields.map { it.x })
    }

    @Test
    fun theInspectorChangesOnlyFieldsOfTheSameKindAsTheLastPicked() {
        val md = model(text("a", 0, 0), LabelLayoutField(id = "q", type = LabelFieldType.qr, data = "{sku}"), text("c", 0, 0))
        md.select(setOf("a", "q", "c"))
        md.setProperty("fs") { it.copy(fontSize = 33) }
        // The last picked is the text "c": both texts change, the QR does not.
        assertEquals(listOf(33, null, 33), md.layout.fields.map { it.fontSize })
        md.setX(77)
        assertEquals(listOf(77, 77, 77), md.layout.fields.map { it.x })
    }

    @Test
    fun aBoxSizeTypedInDotsGoesThroughTheHandleThatWouldChangeIt() {
        val md = model(LabelLayoutField(id = "b", type = LabelFieldType.box, x = 10, y = 10, width = 50, height = 20))
        md.select(setOf("b"))
        md.setBoxSize(w = 80)
        assertEquals(listOf(80, 20), listOf(md.layout.fields[0].width, md.layout.fields[0].height))
        md.setBoxSize(h = 35)
        assertEquals(listOf(80, 35), listOf(md.layout.fields[0].width, md.layout.fields[0].height))
        assertEquals(listOf(10, 10), listOf(md.layout.fields[0].x, md.layout.fields[0].y))
    }

    @Test
    fun theViewFitsZoomsAroundAPointAndComesBack() {
        val md = model()
        // 444 x 288 stage, 44 margin: (444-88)/400 = 0.89 and (288-88)/200 = 1.0 -> 0.89.
        assertEquals(0.89, md.effectiveZoom(), 1e-9)
        md.setZoom(2.0, 222.0, 144.0)
        assertEquals(2.0, md.currentZoom(), 1e-9)
        assertEquals("200%", md.zoomText)
        // The dot under the middle of the stage stays there: the label's middle is still in the middle.
        val ox = (444.0 - 400 * 2.0) / 2 + md.panX
        assertEquals(222.0, ox + 200 * 2.0, 1e-9)
        md.zoomIn()
        assertEquals(2.5, md.currentZoom(), 1e-9)
        md.setZoom(1000.0)
        assertEquals(16.0, md.currentZoom())
        md.zoomFit()
        assertNull(md.zoom)
        assertEquals(0.0, md.panX)
        assertNotEquals("200%", md.zoomText)
    }

    @Test
    fun theBooksLayoutReplacesTheScreensWithoutAnUndoStep() {
        val md = model(text("a", 10, 10), text("b", 20, 20))
        md.select(setOf("a", "b"))
        md.nudge(1, 1)
        md.adopt(LabelLayout(id = "t", name = "Other", widthDots = 300, heightDots = 100, fields = listOf(text("b", 0, 0))))
        assertEquals("Other", md.layout.name)
        assertFalse(md.edited)
        assertEquals(setOf("b"), md.selection)
    }

    @Test
    fun thePreviewIsMadeUpValuesUntilPiecesAreChosen() {
        val md = model(text("a", 0, 0, "{SKU_1}/{SKU_2}"), tags = 2)
        assertEquals("SAMPLE-0001/SAMPLE-0002", md.resolved[0].data)
        assertEquals("{SKU_1}/{SKU_2}", md.layout.fields[0].data)
        md.setPreview(emptyList(), null)
        assertTrue(md.previewValues.isEmpty())
    }
}
