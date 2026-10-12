package erp.app.screens.stock

import erp.core.models.Invoice
import erp.core.models.Product
import erp.core.models.Settings
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

internal object StockFix {
    fun product(sku: String, extra: Map<String, Any?> = emptyMap()): Product = Product.fromMap(
        mapOf(
            "sku" to sku, "name" to "Twist band", "categoryId" to "cat001", "metalType" to "gold", "karat" to "21k",
            "metalWeightG" to 3.4, "wastagePercentage" to 10.0, "makingCharges" to 5000.0, "hasStones" to false,
        ) + extra,
    )

    fun settings(extra: Map<String, Any?> = emptyMap()): Settings = Settings.fromMap(
        mapOf(
            "id" to "global", "goldRatePerGram24k" to 30_000.0, "goldRatePerGram22k" to 27_500.0, "goldRatePerGram21k" to 26_000.0,
            "goldRatePerGram18k" to 22_000.0, "silverRatePerGram" to 300.0, "palladiumRatePerGram" to 9_000.0, "platinumRatePerGram" to 12_000.0,
        ) + extra,
    )
}

class StockKitTests {
    @Test fun pathsEncodeASkuAsOnePiece() {
        assertEquals("/products/RNG-0001", StockKit.piecePath("RNG-0001"))
        assertEquals("/products/RNG-0001?web=1", StockKit.piecePath("RNG-0001", web = true))
        assertEquals("/products/a%2Fb%3Fc%23d%25", StockKit.piecePath("a/b?c#d%"))
        assertEquals("/products/a%20b", StockKit.piecePath("a b"))
        assertEquals("/products/RNG-0001/edit", StockKit.editPath("RNG-0001"))
        assertEquals("/products/RNG-0001/edit?web=1", StockKit.editPath("RNG-0001") + "?web=1")
        assertEquals("a/b?", StockKit.editSku(StockKit.editPath("a/b?")))
    }

    @Test fun editSkuReadsOnlyTheFormsPath() {
        assertEquals("RNG-1", StockKit.editSku("/products/RNG-1/edit"))
        assertEquals("RNG-1", StockKit.editSku("/products/RNG-1/edit?web=1"))
        assertNull(StockKit.editSku("/products/RNG-1"))
        assertNull(StockKit.editSku("/products//edit"))
        assertNull(StockKit.editSku("/products/a/b/edit"))
        assertNull(StockKit.editSku("/orders/RNG-1/edit"))
        assertNull(StockKit.editSku("/products/edit"))
    }

    @Test fun theVoicePieceStaysTheErpsPage() {
        assertTrue(StockKit.fromVoice("/products/add?voice=1"))
        assertFalse(StockKit.fromVoice("/products/add"))
        assertFalse(StockKit.fromVoice("/products/add?voice=0"))
    }

    @Test fun theRoutesPickTheRightScreen() {
        fun matches(path: String) = StockRoutes.map { it.matches(path) }
        // list, add, edit, bulk, piece
        assertEquals(listOf(true, false, false, false, false), matches("/products"))
        assertEquals(listOf(false, true, false, false, false), matches("/products/add"))
        // The voice assistant's new piece stays the ERP's page.
        assertEquals(listOf(false, false, false, false, false), matches("/products/add?voice=1"))
        assertEquals(listOf(false, false, true, false, false), matches("/products/RNG-1/edit"))
        assertEquals(listOf(false, false, false, true, false), matches("/products/bulk-add"))
        assertEquals(listOf(false, false, false, false, true), matches("/products/RNG-1"))
        assertEquals(listOf(false, false, false, false, true), matches("/products/a%2Fb"))
    }

    @Test fun categoriesAreTheErpsOwn() {
        assertEquals(20, StockKit.categories.size)
        assertEquals("Rings", StockKit.categoryTitle("cat001"))
        assertEquals("Uncategorized", StockKit.categoryTitle(""))
        assertEquals("Hand typed", StockKit.categoryTitle("Hand typed"))
    }

    @Test fun chipsAreOnlyForCategoriesThatHoldAPiece() {
        val options = StockKit.categoryOptions(mapOf("cat007" to 2, "cat001" to 1, "zzz" to 1, "" to 3), keep = null)
        // The ERP's own in its order, any other id after them, then the pieces with none.
        assertEquals(listOf("cat001", "cat007", "zzz", ""), options.map { it.id })
        assertEquals("Uncategorized", options.last().title)
        // A chosen chip does not vanish when its category is emptied.
        assertEquals(listOf("cat018"), StockKit.categoryOptions(emptyMap(), keep = "cat018").map { it.id })
        assertEquals(listOf(""), StockKit.categoryOptions(emptyMap(), keep = "").map { it.id })
        assertTrue(StockKit.categoryOptions(emptyMap(), keep = null).isEmpty())
    }

    @Test fun aPieceReadsAsTheProductsPageSaysIt() {
        val p = StockFix.product("RNG-1")
        assertEquals("Gold 21K", StockKit.metalLine(p))
        assertEquals("3.4g", StockKit.grams(3.4))
        assertEquals("14.25g", StockKit.grams(14.25))
        assertEquals("10g", StockKit.grams(10.0))
        assertEquals("10%", StockKit.percent(10.0))
        assertEquals("Gold 21K · 3.4g · Rings", StockKit.detail(p))
        assertEquals("Silver", StockKit.metalLine(StockFix.product("S", mapOf("metalType" to "silver", "karat" to null))))
        assertEquals("Gold", StockKit.metalLine(StockFix.product("G", mapOf("karat" to null))))
        assertEquals("Palladium", StockKit.metalLine(StockFix.product("P", mapOf("metalType" to "palladium", "karat" to "18k"))))
        assertEquals("Gold", StockKit.capitalised("gold"))
        assertNull(StockKit.filled("  "))
        assertEquals("x", StockKit.filled(" x "))
    }

    @Test fun searchIsByNameOrSku() {
        val p = StockFix.product("RNG-0042")
        assertTrue(StockKit.matches(p, "twist"))
        assertTrue(StockKit.matches(p, "rng-00"))
        assertTrue(StockKit.matches(p, "BAND"))
        assertFalse(StockKit.matches(p, "bangle"))
    }

    @Test fun theRateAPieceIsPricedFrom() {
        val s = StockFix.settings()
        assertEquals(StockKit.RateLine("Gold rate (21K)", 26_000.0), StockKit.rateLine(StockFix.product("A"), s))
        assertEquals(StockKit.RateLine("Gold rate (24K)", 30_000.0), StockKit.rateLine(StockFix.product("A", mapOf("karat" to "24k")), s))
        assertEquals(StockKit.RateLine("Gold rate (12K)", 0.0), StockKit.rateLine(StockFix.product("A", mapOf("karat" to "12k")), s))
        assertNull(StockKit.rateLine(StockFix.product("A", mapOf("karat" to null)), s))
        val silver = mapOf("metalType" to "silver", "karat" to null)
        assertEquals(StockKit.RateLine("Silver rate (shop)", 300.0), StockKit.rateLine(StockFix.product("S", silver), s))
        assertEquals(StockKit.RateLine("This piece's silver rate", 275.0), StockKit.rateLine(StockFix.product("S", silver + ("silverRatePerGram" to 275.0)), s))
        assertEquals(StockKit.RateLine("Palladium rate", 9_000.0), StockKit.rateLine(StockFix.product("P", mapOf("metalType" to "palladium")), s))
        assertEquals(StockKit.RateLine("Platinum rate", 12_000.0), StockKit.rateLine(StockFix.product("P", mapOf("metalType" to "platinum")), s))
        assertNull(StockKit.rateLine(StockFix.product("U", mapOf("metalType" to "")), s))
    }

    @Test fun aPieceIsPricedAtTodaysRates() {
        val rates = StockKit.rates(StockFix.settings())!!
        val c = StockKit.costs(StockFix.product("RNG-1"), rates)
        // 3.4 g of 21k at 26,000 a gram, 10% wastage on the metal, 5,000 making.
        assertEquals(3.4 * 26_000.0, c.metalCost, 0.01)
        assertEquals(c.metalCost * 0.10, c.wastageCost, 0.01)
        assertEquals(5_000.0, c.makingCharges)
        assertEquals(c.metalCost + c.wastageCost + 5_000.0, c.totalPrice, 0.01)
        assertNull(StockKit.rates(null))
    }

    @Test fun worthIsADashUntilEveryPieceHasAPrice() {
        assertEquals(30.0, StockKit.worth(listOf(10.0, 20.0)))
        assertNull(StockKit.worth(listOf(10.0, null)))
        assertEquals(0.0, StockKit.worth(emptyList()))
    }

    @Test fun categoryCountsCountTheWholeStock() {
        val counts = categoryCounts(listOf(StockFix.product("A"), StockFix.product("B"), StockFix.product("C", mapOf("categoryId" to "cat007"))))
        assertEquals(mapOf("cat001" to 2, "cat007" to 1), counts)
    }

    @Test fun aSoldPieceIsFoundOnItsInvoices() {
        fun inv(id: String, sku: String, status: String? = null, name: String = "Sana Demo") = Invoice.fromMap(
            mapOf(
                "id" to id, "customerName" to name, "grandTotal" to 100.0, "createdAt" to "2026-10-01T06:00:00.000Z",
                "items" to listOf(mapOf("sku" to sku, "itemTotal" to 100.0)),
            ) + (if (status != null) mapOf("status" to status) else emptyMap()),
        )
        val book = listOf(inv("I1", "RNG-1"), inv("I2", "OTHER"), inv("I3", "RNG-1", status = "Refunded", name = "Walk-in Customer"))
        assertEquals(listOf("I1", "I3"), salesOf("RNG-1", book).map { it.id })
        assertTrue(salesOf("NONE", book).isEmpty())
        assertTrue(saleSubtitle(book[0]).startsWith("Sana Demo · "))
        assertTrue(saleSubtitle(book[2]).startsWith("Walk-in · "))
    }

    @Test fun totalLineSaysWhyThereIsNoPrice() {
        assertEquals("—", totalLine(null))
        assertEquals("Price N/A", totalLine(erp.core.logic.ProductCosts()))
        assertEquals("PKR 1,000", totalLine(erp.core.logic.ProductCosts(totalPrice = 1000.0)))
    }
}
