package erp.core.entry

import erp.core.DocJSON
import erp.core.contract.OrderCases
import erp.core.models.InvoiceItem
import erp.core.models.OrderItem
import erp.core.models.Settings
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Piece entry (decisions.md "Piece entry"): the catalogue reference photo on an order piece and a sale line, and what "Add stone details" does with a piece on file. */
class PieceEntryTests {
    private val shop = DocJSON.decode<Settings>("global", OrderCases.taheriSettings)

    private fun itemOf(p: NewOrderPieceDraft): Map<*, *> {
        val d = NewOrderDraft.fresh()
        d.seedRates(shop)
        d.customerName = "Test Customer"
        d.pieces.add(p)
        return (NewOrderMath.order(d, shop, emptyList())["items"] as List<*>).single() as Map<*, *>
    }

    private fun piece(): NewOrderPieceDraft = NewOrderPieceDraft().also {
        it.description = "Ruby ring"; it.weight = "5"; it.wastage = "12"; it.hasStones = false
    }

    @Test fun aPickedCataloguePictureIsSentWithTheFlag() {
        val p = piece()
        p.referenceImage = "  https://shop.example/pieces/ring-1.jpg "
        p.printReference = true
        val o = itemOf(p)
        assertEquals("https://shop.example/pieces/ring-1.jpg", o["referenceImage"])
        assertEquals(true, o["printReference"])
    }

    @Test fun noPickSendsNothingAndATakenOffPickSendsNull() {
        assertFalse(itemOf(piece()).containsKey("referenceImage"))
        val off = piece().also { it.hadReference = true; it.printReference = true }
        val o = itemOf(off)
        assertTrue(o.containsKey("referenceImage"))
        assertNull(o["referenceImage"], "the order on file had one: taking it off sends null")
        assertEquals(true, o["printReference"], "its own first photo prints")
    }

    @Test fun thePickSurvivesTheDraftOnThePhone() {
        val p = piece().also { it.referenceImage = "https://shop.example/a.jpg"; it.printReference = true; it.hadReference = true }
        val back = NewOrderPieceDraft.fromMap(p.toMap())
        assertEquals("https://shop.example/a.jpg", back.referenceImage)
        assertTrue(back.printReference)
        assertTrue(back.hadReference)
        assertEquals("https://shop.example/a.jpg", back.copy().referenceImage)
        // A draft saved before the fields existed reads as no pick.
        val old = NewOrderPieceDraft.fromMap(piece().toMap())
        assertNull(old.referenceImage)
        assertFalse(old.printReference)
    }

    @Test fun anOrderOnFileOpensWithItsPickAndItsStoneDetails() {
        val item = DocJSON.decode<OrderItem>(
            "",
            mapOf(
                "description" to "Ring", "metalType" to "gold", "karat" to "21k", "estimatedWeightG" to 5, "hasStones" to false,
                "stoneWeightG" to 0.4, "wastagePercentage" to 12, "referenceImage" to "https://shop.example/a.jpg", "printReference" to true,
            ),
        )
        assertEquals("https://shop.example/a.jpg", item.referenceImage)
        assertEquals(true, item.printReference)
        val p = NewOrderPieceDraft.onFile(item)
        assertEquals("https://shop.example/a.jpg", p.referenceImage)
        assertTrue(p.printReference)
        assertTrue(p.hadReference)
        assertTrue(p.hasStones, "a piece with stone weight opens with Add stone details on")
        val bare = NewOrderPieceDraft.onFile(DocJSON.decode<OrderItem>("", mapOf("description" to "Ring", "metalType" to "gold", "estimatedWeightG" to 5)))
        assertFalse(bare.hasStones, "and off where there is none")
        assertFalse(bare.hadReference)
        assertNull(bare.referenceImage)
    }

    @Test fun anInvoiceLineReadsItsPick() {
        val item = DocJSON.decode<InvoiceItem>("", mapOf("sku" to "NEW-1", "name" to "Ring", "referenceImage" to "https://shop.example/a.jpg", "printReference" to true))
        assertEquals("https://shop.example/a.jpg", item.referenceImage)
        assertEquals(true, item.printReference)
        assertNull(DocJSON.decode<InvoiceItem>("", mapOf("sku" to "X", "name" to "Ring")).printReference)
    }

    @Test fun aSaleLineSendsItsPick() {
        val line = SaleLine.blankFor("gold", "NEW-1")
        line.referenceImage = "https://shop.example/a.jpg"
        line.printReference = true
        val sent = line.payload()
        assertEquals("https://shop.example/a.jpg", sent["referenceImage"])
        assertEquals(true, sent["printReference"])
        assertFalse(SaleLine.blankFor("gold", "NEW-1").payload().containsKey("referenceImage"))
        val back = SaleLine.fromMap(line.toMap())!!
        assertEquals("https://shop.example/a.jpg", back.referenceImage)
        assertTrue(back.printReference)
    }

    @Test fun theLineEditorKeepsItsPickAndDropsABlankOne() {
        val line = SaleLine.blankFor("gold", "NEW-1").also { it.name = "Ring"; it.referenceImage = "https://shop.example/a.jpg"; it.printReference = true }
        val f = SaleLineFields(line)
        assertEquals("https://shop.example/a.jpg", f.referenceImage)
        assertTrue(f.printReference)
        f.referenceImage = null
        assertNull(f.applied(line).referenceImage)
        f.referenceImage = "   "
        assertNull(f.applied(line).referenceImage)
        f.referenceImage = "https://shop.example/b.jpg"
        f.printReference = false
        val out = f.applied(line)
        assertEquals("https://shop.example/b.jpg", out.referenceImage)
        assertFalse(out.printReference)
    }
}
