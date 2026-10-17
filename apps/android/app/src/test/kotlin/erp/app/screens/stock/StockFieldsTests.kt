package erp.app.screens.stock

import kotlinx.coroutines.runBlocking
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The product form's own rules (product-form.tsx), as the iPhone's form keeps them. */
class StockFieldsTests {
    private fun gold(extra: StockPieceFields.() -> StockPieceFields = { this }) =
        StockPieceFields(categoryId = "cat001", metalType = "gold", weight = "5.75").settle().extra()

    @Test fun aNewPieceOpensOnTheWebsDefaults() {
        val f = StockPieceFields(metalType = "gold").settle()
        assertEquals("21k", f.karat)
        assertEquals("10", f.wastage)
        assertTrue(f.hasStones)
        assertFalse(f.hasDiamonds)
        assertFalse(f.fixed)
    }

    @Test fun diamondsRaiseTheWastageAndNoDiamondsTakeTheirChargesAway() {
        val d = gold().copy(hasDiamonds = true).settle()
        assertEquals("25", d.wastage)
        val no = d.copy(hasDiamonds = false, diamondCharges = "5000", diamondDetails = "VS1").settle()
        assertEquals("10", no.wastage)
        assertEquals("", no.diamondCharges)
        assertEquals("", no.diamondDetails)
        // An edit opens on the piece's own wastage.
        assertEquals("12", gold().copy(wastage = "12", hasDiamonds = true).settle(keepWastage = true).wastage)
    }

    @Test fun noStonesNoStoneWeight() {
        val f = gold().copy(stoneWeight = "0.5", stoneDetails = "ruby", hasStones = false).settle()
        assertEquals("", f.stoneWeight)
        assertEquals("", f.stoneDetails)
    }

    @Test fun aGoldCoinCarriesNothingButItsMetal() {
        val f = StockPieceFields(categoryId = "cat017", metalType = "gold", karat = "21k", making = "500", miscCharges = "50", stoneCharges = "10", hasDiamonds = true, diamondCharges = "9").settle()
        assertTrue(f.isGoldCoin)
        assertEquals("24k", f.karat)
        assertEquals("0", f.wastage)
        assertEquals("", f.making)
        assertEquals("", f.miscCharges)
        assertEquals("", f.diamondCharges)
        assertFalse(f.hasDiamonds)
        assertFalse(f.hasStones)
        // A silver coin is no gold coin.
        assertFalse(StockPieceFields(categoryId = "cat017", metalType = "silver").isGoldCoin)
    }

    @Test fun silverHasNoWastageOrMakingAndNoKarat() {
        val f = StockPieceFields(categoryId = "cat001", metalType = "silver", karat = "21k", wastage = "10", making = "500").settle()
        assertEquals("0", f.wastage)
        assertEquals("", f.making)
        assertEquals("", f.karat)
    }

    @Test fun aKaratIsForGoldOnly() {
        assertEquals("", gold().copy(metalType = "platinum").settle().karat)
        assertEquals("21k", gold().copy(karat = "").settle().karat)
    }

    @Test fun aSecondMetalIsForAMensRingOnly() {
        val ring = gold().copy(categoryId = "cat018", secondMetal = "gold", secondKarat = "18k", secondWeight = "1").settle()
        assertEquals("gold", ring.secondMetal)
        assertEquals("18k", ring.secondKarat)
        val other = ring.copy(categoryId = "cat001").settle()
        assertEquals("", other.secondMetal)
        assertEquals("", other.secondKarat)
        assertEquals("", other.secondWeight)
        // A second silver carries no karat.
        assertEquals("", ring.copy(secondMetal = "silver").settle().secondKarat)
    }

    @Test fun theFirstRefusalIsTheWebFormsOwn() {
        assertEquals("Category is required", StockPieceFields().problem)
        assertEquals("Metal weight must be a positive number", gold().copy(weight = "").problem)
        assertEquals("Metal weight must be non-negative", gold().copy(weight = "-1").problem)
        assertEquals("Wastage must be between 0 and 100", gold().copy(wastage = "101").problem)
        assertEquals("Making charges must be non-negative", gold().copy(making = "-5").problem)
        assertEquals("Karat is required for gold items.", gold().copy(karat = "").problem)
        assertEquals("Stone weight cannot be greater than the total metal weight.", gold().copy(stoneWeight = "6").problem)
        assertNull(gold().problem)
        val men = gold().copy(categoryId = "cat018").settle()
        assertEquals("A positive weight is required for secondary metal.", men.copy(secondMetal = "silver").problem)
        assertEquals("Karat is required for secondary gold metal.", men.copy(secondMetal = "gold", secondWeight = "1").problem)
        assertNull(men.copy(secondMetal = "gold", secondKarat = "18k", secondWeight = "1").problem)
    }

    @Test fun aFixedPriceNeedsADescriptionAndAPrice() {
        val f = StockPieceFields(categoryId = "cat001", fixed = true)
        assertEquals("Description is required for custom priced items.", f.problem)
        assertEquals("Description is required for custom priced items.", f.copy(description = "ab").problem)
        assertEquals("A positive price is required.", f.copy(description = "Turkish ring").problem)
        // No weight is asked of a fixed price.
        assertNull(f.copy(description = "Turkish ring", customPrice = "15000").problem)
    }

    @Test fun thePieceIsEveryFieldTheFormEdits() {
        val piece = gold().copy(name = " Twist ", making = "5000", size = " 14 ").piece
        assertEquals("Twist", piece["name"])
        assertEquals("cat001", piece["categoryId"])
        assertEquals("gold", piece["metalType"])
        assertEquals("21k", piece["karat"])
        assertEquals(5.75, piece["metalWeightG"])
        assertEquals(5000.0, piece["makingCharges"])
        assertEquals(10.0, piece["wastagePercentage"])
        assertEquals("14", piece["size"])
        assertEquals(false, piece["isCustomPrice"])
        assertEquals(0.0, piece["customPrice"])
        assertEquals(26, piece.size)
        // No karat when there is none.
        assertFalse(gold().copy(metalType = "silver", karat = "").piece.containsKey("karat"))
    }

    @Test fun anEditOpensOnThePiecesOwnFigures() {
        val p = StockFix.product("RNG-1", mapOf("wastagePercentage" to 12.5, "silverRatePerGram" to 0.0, "size" to "14", "hasStones" to true, "stoneWeightG" to 0.25))
        val f = StockPieceFields.of(p).settle(keepWastage = true)
        assertEquals("12.5", f.wastage)
        assertEquals("3.4", f.weight)
        assertEquals("5000", f.making)
        assertEquals("", f.silverRate)
        assertEquals("14", f.size)
        assertEquals("0.25", f.stoneWeight)
        assertEquals("cat001", f.categoryId)
        // Saving it unchanged sends the same figures.
        assertEquals(12.5, f.piece["wastagePercentage"])
        assertEquals(3.4, f.piece["metalWeightG"])
    }

    @Test fun theFormPricesAsTheErpWillOnceSaved() {
        val rates = StockKit.rates(StockFix.settings())!!
        val priced = { f: StockPieceFields -> erp.core.logic.calculateProductCosts(f.priced, rates).totalPrice }
        val plain = gold().copy(making = "5000")
        assertEquals(StockKit.costs(StockFix.product("A", mapOf("metalWeightG" to 5.75)), rates).totalPrice, priced(plain), 0.01)
        // A coin's charges are nothing whatever is typed.
        val coin = StockPieceFields(categoryId = "cat017", metalType = "gold", weight = "10", making = "9999").settle().copy(making = "9999")
        assertEquals(10 * 30_000.0, priced(coin), 0.01)
        // Gold without a karat is priced at 21k.
        assertEquals(priced(plain), priced(plain.copy(karat = "")), 0.01)
        // A fixed price is its price.
        assertEquals(15_000.0, priced(StockPieceFields(categoryId = "cat001", fixed = true, customPrice = "15000", description = "Ring")), 0.01)
    }

    // Bulk

    @Test fun pastedWeightsAreEveryNumberAboveZero() {
        assertEquals(listOf(4.2, 5.1, 6.75), StockBulk.weights("4.2 5.1\n6.75"))
        assertEquals(listOf(4.2, 5.1), StockBulk.weights("4.2g, 0, 5.1 g"))
        assertEquals(listOf(1.0, 0.5), StockBulk.weights("1. then .5"))
        // 1.2.3 is no number; a lone dot is none.
        assertTrue(StockBulk.weights("1.2.3 . ... abc").isEmpty())
        assertEquals(listOf(12.0), StockBulk.weights("#12"))
        assertTrue(StockBulk.weights("").isEmpty())
    }

    @Test fun aPieceIsNamedPrefixThenSuffix() {
        assertEquals("Ring A", StockBulk.name(" Ring ", "A "))
        assertEquals("Ring", StockBulk.name("Ring", ""))
        assertEquals("A", StockBulk.name("", "A"))
        assertEquals("", StockBulk.name(" ", " "))
    }

    @Test fun theBulkSetupStartsAtNothing() {
        val s = StockBulk.freshSetup()
        // Silver (Mina's metal) carries no wastage at all: "0", as the iPhone's settle() has it.
        assertEquals(if (s.metalType == "silver") "0" else "", s.wastage)
        assertFalse(s.hasStones)
        assertEquals("21k".takeIf { s.metalType == "gold" } ?: "", s.karat)
        // The product form's rules hold, but wastage stays what was typed.
        assertEquals(if (s.metalType == "silver") "0" else "", s.copy(hasDiamonds = true).settle(keepWastage = true).wastage)
    }

    @Test fun theBulkChecksSayWhichRowIsWrong() {
        val shared = StockBulk.freshSetup().copy(categoryId = "cat001")
        val rows = listOf(StockBulkRow(weight = "4.2"), StockBulkRow(weight = ""), StockBulkRow(weight = "5"))
        assertEquals("Piece 2: Metal weight must be a positive number", StockBulk.firstProblem(shared, "", rows))
        assertEquals("Category is required", StockBulk.firstProblem(shared.copy(categoryId = ""), "", rows))
        assertEquals("At least one item is required", StockBulk.firstProblem(shared, "", emptyList()))
        assertNull(StockBulk.firstProblem(shared, "Ring", rows.filter { it.weight.isNotEmpty() }))
    }

    private val shared = StockBulk.freshSetup().copy(categoryId = "cat001")

    @Test fun weightsGoTwentyToARequestAndEachRequestIsNamed() = runBlocking {
        val rows = (1..45).map { StockBulkRow(weight = "$it", suffix = "n$it") }
        val sent = ArrayList<Map<String, Any?>>()
        val out = StockBulk.add(rows, shared, "Ring", "batch-1") { op, fields ->
            assertEquals("addProducts", op)
            sent += fields
            val pieces = fields["pieces"] as List<*>
            mapOf("products" to pieces.indices.map { mapOf("sku" to "S${sent.size}-$it") })
        }
        assertNull(out.stopped)
        assertEquals(45, out.added.size)
        assertEquals(45, out.next)
        assertEquals(listOf(20, 20, 5), sent.map { (it["pieces"] as List<*>).size })
        assertEquals(listOf(0, 20, 40), sent.map { it["part"] })
        assertTrue(sent.all { it["batch"] == "batch-1" })
        @Suppress("UNCHECKED_CAST")
        val first = (sent[0]["pieces"] as List<Map<String, Any?>>)[0]
        assertEquals("Ring n1", first["name"])
        assertEquals(1.0, first["metalWeightG"])
    }

    @Test fun aRefusalPartwayLeavesWhatWentInInStock() = runBlocking {
        val rows = (1..45).map { StockBulkRow(weight = "$it") }
        var calls = 0
        val out = StockBulk.add(rows, shared, "", "b") { _, fields ->
            calls++
            if (calls == 2) throw erp.app.data.ErpApi.Failure(500, "The ERP is busy.")
            mapOf("products" to (fields["pieces"] as List<*>).indices.map { mapOf("sku" to "S$it") })
        }
        assertEquals("The ERP is busy.", out.stopped)
        assertEquals(20, out.added.size)
        assertEquals(20, out.next)
        assertEquals(25, rows.drop(out.next).size)
    }

    @Test fun aPartialAnswerStopsWhereTheErpStopped() = runBlocking {
        val rows = (1..30).map { StockBulkRow(weight = "$it") }
        val out = StockBulk.add(rows, shared, "", "b") { _, _ ->
            mapOf("products" to listOf(mapOf("sku" to "A1"), mapOf("sku" to "A2")), "partial" to true, "error" to "Row 3 failed.")
        }
        assertEquals("Row 3 failed.", out.stopped)
        assertEquals(listOf("A1", "A2"), out.added)
        assertEquals(2, out.next)
        val none = StockBulk.add(rows, shared, "", "b") { _, _ -> mapOf("products" to emptyList<Any>(), "partial" to true) }
        assertEquals("Not saved.", none.stopped)
        assertEquals(0, none.next)
    }
}
