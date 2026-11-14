package erp.core.entry

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNotSame
import kotlin.test.assertTrue

/**
 * What is typed into the entry forms is what the phone keeps and what is sent: weight, making, wastage and the rates survive the
 * draft's save and reopen, a copy of a draft or of the line editor's fields shares nothing with it, and the wastage chosen is the
 * wastage on the request.
 */
class FormPersistenceTests {
    private fun piece(wastage: String) = NewOrderPieceDraft(
        category = "cat001", description = "Ring", metal = "gold", karat = "21k", weight = "5.250", hasStones = true, stoneWeight = "0.4",
        wastage = wastage, making = "1500", stones = "200", hasDiamonds = true, diamond = "9000",
    )

    private fun order(wastage: String): NewOrderDraft = NewOrderDraft(customerName = "Ayesha", rates = linkedMapOf("gold21k" to "21500", "gold24k" to "24600")).also {
        it.pieces.add(piece(wastage))
        it.ratesSeeded = true
    }

    @Test
    fun anOrderKeptOnThePhoneComesBackWithEveryTypedFigure() {
        for (w in listOf("10", "12", "15", "25", "13", "7.5")) {
            val back = assertNotNull(NewOrderDraftStore.decode(assertNotNull(NewOrderDraftStore.encode(order(w)))))
            val p = back.pieces.single()
            assertEquals(w, p.wastage)
            assertEquals("5.250", p.weight)
            assertEquals("1500", p.making)
            assertEquals("200", p.stones)
            assertEquals("0.4", p.stoneWeight)
            assertEquals("9000", p.diamond)
            assertTrue(p.hasStones && p.hasDiamonds)
            assertEquals("21500", back.rates["gold21k"])
            assertEquals("24600", back.rates["gold24k"])
        }
    }

    @Test
    fun theWastageChosenIsTheWastageOnTheRequest() {
        for (w in listOf("10", "12", "15", "25", "13")) {
            val sent = NewOrderMath.item(piece(w), erp.core.logic.PricingRates(goldRatePerGram21k = 20000.0), photo = false)
            assertEquals(w.toDouble(), sent["wastagePercentage"])
        }
    }

    @Test
    fun aCopyOfADraftSharesNothingWithIt() {
        val a = order("10")
        val b = a.copy()
        b.pieces[0].wastage = "15"
        b.rates["gold21k"] = "1"
        assertNotSame(a.pieces[0], b.pieces[0])
        assertEquals("10", a.pieces[0].wastage)
        assertEquals("21500", a.rates["gold21k"])
    }

    @Test
    fun theLineEditorsFieldsCopyEveryFieldAndShareNothing() {
        val line = SaleLine.blankFor("silver", "X-1")
        val a = SaleLineFields(line)
        a.name = "Chain"; a.categoryId = "cat002"; a.size = "7"; a.karat = ""; a.weight = "12.5"; a.hasStones = true; a.stoneWeight = "0.2"
        a.wastage = "12"; a.making = "300"; a.hasDiamonds = true; a.diamondCharges = "50"; a.stoneCharges = "60"; a.miscCharges = "70"
        a.stoneDetails = "s"; a.diamondDetails = "d"; a.billDescription = "b"; a.platingType = "Other"; a.platingNote = "n"
        a.nickelFree = true; a.silverRate = "310"; a.fixed = true; a.customPrice = "9000"; a.referenceImage = "https://x/y.jpg"; a.printReference = true
        val b = a.copy()
        assertNotSame(a, b)
        assertEquals(a.applied(line).toMap(), b.applied(line).toMap())
        b.wastage = "25"; b.weight = "1"
        assertEquals("12", a.wastage)
        assertEquals("12.5", a.weight)
        assertEquals(25.0, b.applied(line).wastagePercentage)
    }

    @Test
    fun anOrderOpenedForEditingHoldsItsPiecesWastageAndSendsTheChangedOne() {
        for ((stored, shown) in listOf(10.0 to "10", 15.0 to "15", 13.5 to "13.5", 25.0 to "25")) {
            val order = erp.core.models.Order.fromMap(
                mapOf("id" to "ORD-1", "items" to listOf(mapOf("description" to "Ring", "metalType" to "gold", "karat" to "21k", "estimatedWeightG" to 5.0, "wastagePercentage" to stored))),
            )
            val piece = NewOrderEdit(order).draft.pieces.single()
            assertEquals(shown, piece.wastage)
            piece.wastage = "12"
            val sent = NewOrderMath.item(piece, erp.core.logic.PricingRates(goldRatePerGram21k = 20000.0), photo = false)
            assertEquals(12.0, sent["wastagePercentage"])
        }
    }

    @Test
    fun aSaleKeptOnThePhoneComesBackWithItsTypedFigures() {
        val line = SaleLine.blankFor("gold", "X-1")
        val f = SaleLineFields(line)
        f.name = "Ring"; f.weight = "6.1"; f.wastage = "15"; f.making = "900"
        val d = SaleDraft(customerName = "Ali", rates = linkedMapOf("gold21k" to "22000"))
        d.lines.add(f.applied(line))
        val back = assertNotNull(SaleDraftStore.decode(assertNotNull(SaleDraftStore.encode(d))))
        val l = back.lines.single()
        assertEquals(6.1, l.metalWeightG)
        assertEquals(15.0, l.wastagePercentage)
        assertEquals(900.0, l.makingCharges)
        assertEquals("22000", back.rates["gold21k"])
    }
}
