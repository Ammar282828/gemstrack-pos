package erp.core

import erp.core.logic.LineCost
import erp.core.logic.Margin
import erp.core.logic.MarginLine
import erp.core.logic.MarginSettings
import erp.core.logic.goldCostPerGram
import erp.core.logic.invoiceMargin
import erp.core.logic.lineCost
import erp.core.logic.marginOf
import erp.core.logic.orderMargin
import erp.core.logic.percentLabel
import erp.core.models.Invoice
import erp.core.models.Order
import kotlin.math.pow
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** src/lib/margin.test.ts, case for case (Taheri's settings, the code's default). */
class MarginTests {
    private fun invoice(fields: Map<String, Any?>): Invoice = ERPDecode.model<Invoice>(fields)!!
    private fun order(fields: Map<String, Any?>): Order = ERPDecode.model<Order>(fields)!!

    /** Jest's `toBeCloseTo(expected, digits)`: within 10^-digits / 2. */
    private fun assertClose(a: Double, b: Double, digits: Int) {
        assertEquals(b, a, 0.5 * 10.0.pow(-digits.toDouble()))
    }

    // MARK: what the shop earns

    @Test
    fun testCostsAGramOfJewelleryAtThe24kRateLess6Ratti() {
        assertClose(goldCostPerGram(38538.0), 36129.375, 3)
    }

    @Test
    fun testWorksOutASaleFromThe24kRateTypedWhenItWasMade() {
        // 10 g of 21k at 34,000 + 10% wastage + 15,500 making = 389,500; cost 10 × 36,129.375.
        val m = invoiceMargin(
            invoice(
                mapOf(
                    "items" to listOf(mapOf("metalType" to "gold", "karat" to "21k", "metalWeightG" to 10, "stoneWeightG" to 0, "quantity" to 1, "itemTotal" to 389500)),
                    "subtotal" to 389500, "discountAmount" to 0, "costRate24k" to 38538,
                ),
            ),
        )
        assertFalse(m.assumed)
        assertClose(m.cost, 361293.75, 2)
        assertClose(m.percent, 7.2417, 3)
        assertEquals("7.2%", percentLabel(m))
    }

    @Test
    fun testAssumes10PercentWithoutA24kRateEverySaleRecordedBefore() {
        val m = invoiceMargin(invoice(mapOf("items" to listOf(mapOf("metalType" to "gold", "metalWeightG" to 10, "itemTotal" to 389500)), "subtotal" to 389500)))
        assertTrue(m.assumed)
        assertEquals(10.0, m.percent)
        assertClose(m.profit, 38950.0, 6)
    }

    @Test
    fun testTakesTheDiscountOffWhatWasEarnedAndStonesAndDiamondsAtWhatTheyWereCharged() {
        val m = invoiceMargin(
            invoice(
                mapOf(
                    "items" to listOf(mapOf("metalType" to "gold", "karat" to "21k", "metalWeightG" to 10.5, "stoneWeightG" to 0.5, "quantity" to 1, "itemTotal" to 440000, "stoneChargesIfAny" to 50000)),
                    "subtotal" to 440000, "discountAmount" to 10000, "costRate24k" to 38538,
                ),
            ),
        )
        // Cost: 10 g × 36,129.375 + 50,000 stones = 411,293.75; worth 430,000.
        assertClose(m.cost, 411293.75, 2)
        assertClose(m.profit, 18706.25, 2)
    }

    @Test
    fun testTakesAPieceItCannotCostNoWeightNotGoldAt10PercentAndSaysHowMuchWasCosted() {
        val m = marginOf(
            listOf(
                MarginLine(metalType = "gold", karat = "21k", weightG = 10.0, price = 389500.0),
                MarginLine(metalType = "gold", weightG = 0.0, price = 100000.0),
            ),
            revenue = 489500.0, rate24k = 38538.0,
        )
        assertClose(m.cost, 361293.75 + 90000, 2)
        assertClose(m.costedShare, 389500.0 / 489500.0, 6)
    }

    @Test
    fun testPricesAnOrderFromItsAgreedOrEstimatedPiecesOrTheLiveFiguresOnTheForm() {
        val fields: Map<String, Any?> = mapOf(
            "items" to listOf(mapOf("metalType" to "gold", "karat" to "21k", "estimatedWeightG" to 10, "stoneWeightG" to 0, "totalEstimate" to 389500)),
            "subtotal" to 389500, "costRate24k" to 38538,
        )
        assertClose(orderMargin(order(fields)).percent, 7.2417, 3)
        assertClose(orderMargin(order(fields), prices = listOf(400000.0)).percent, (400000 - 361293.75) / 400000 * 100, 6)
        val noRate = fields - "costRate24k"
        assertEquals(10.0, orderMargin(order(noRate)).percent)
    }

    // MARK: a fixed price with its weight (2026-10-07)

    private val rate = 38538.0 // 10 g costs 361,293.75

    @Test
    fun testPlainGoldAtAFixedPriceIsCostedFromItsGold() {
        val m = invoiceMargin(
            invoice(
                mapOf(
                    "items" to listOf(mapOf("metalType" to "gold", "karat" to "21k", "metalWeightG" to 10, "itemTotal" to 400000, "isCustomPrice" to true)),
                    "subtotal" to 400000, "costRate24k" to rate,
                ),
            ),
        )
        assertFalse(m.assumed)
        assertEquals(1.0, m.costedShare)
        assertClose(m.cost, 361293.75, 2)
    }

    @Test
    fun testWithDiamondsOrStonesInThePriceStaysAt10PercentTheirCostIsWrittenNowhere() {
        val extras: List<Map<String, Any?>> = listOf(
            mapOf("hasDiamonds" to true), mapOf("diamondDetails" to "0.5ct round"), mapOf("stoneDetails" to "4 rubies"), mapOf("stoneWeightG" to 0.4), mapOf("hasStones" to true),
        )
        for (extra in extras) {
            val item = mutableMapOf<String, Any?>("metalType" to "gold", "karat" to "18k", "metalWeightG" to 4, "itemTotal" to 500000, "isCustomPrice" to true)
            item.putAll(extra)
            val m = invoiceMargin(invoice(mapOf("items" to listOf(item), "subtotal" to 500000, "costRate24k" to rate)))
            assertEquals(0.0, m.costedShare, "$extra")
            assertClose(m.percent, 10.0, 6)
        }
    }

    @Test
    fun testAPiecePricedByWeightWithStonesIsStillCostedItsChargesAreOnIt() {
        val m = invoiceMargin(
            invoice(
                mapOf(
                    "items" to listOf(mapOf("metalType" to "gold", "karat" to "21k", "metalWeightG" to 10, "itemTotal" to 440000, "stoneChargesIfAny" to 50000, "stoneDetails" to "4 rubies")),
                    "subtotal" to 440000, "costRate24k" to rate,
                ),
            ),
        )
        assertEquals(1.0, m.costedShare)
    }

    @Test
    fun testAnOrderAtAFixedPriceWithDiamondsStaysAt10Percent() {
        val m = orderMargin(
            order(
                mapOf(
                    "items" to listOf(mapOf("metalType" to "gold", "karat" to "18k", "estimatedWeightG" to 4, "isManualPrice" to true, "manualPrice" to 500000, "hasDiamonds" to true)),
                    "costRate24k" to rate,
                ),
            ),
        )
        assertEquals(0.0, m.costedShare)
    }

    // MARK: not in the TS tests

    @Test
    fun testAGoldCoinIsCostedAtItsOwnKaratNotJewelleryCost() {
        // 10 g of 22k pure metal at 38,538: 38,538 × 22 / 24 a gram.
        val coin = invoice(
            mapOf(
                "items" to listOf(mapOf("metalType" to "gold", "karat" to "22k", "metalWeightG" to 10, "itemTotal" to 360000, "categoryId" to "cat017")),
                "subtotal" to 360000, "costRate24k" to 38538,
            ),
        )
        assertClose(invoiceMargin(coin).cost, 38538.0 * 22 / 24 * 10, 6)
        // The line's quantity multiplies the cost of one piece; a fixed price is not multiplied.
        val two = marginOf(listOf(MarginLine(metalType = "gold", karat = "21k", weightG = 5.0, quantity = 2.0, price = 400000.0)), revenue = 400000.0, rate24k = 38538.0)
        assertClose(two.cost, 5 * 36129.375 * 2, 6)
        val unweighed = lineCost(MarginLine(metalType = "silver", weightG = 5.0, quantity = 2.0, price = 1000.0), rate24k = 38538.0)
        assertEquals(LineCost(cost = 900.0, costed = false), unweighed)
    }

    @Test
    fun testMinaDoesNotCostByGoldAndAssumes40Percent() {
        val sale = invoice(
            mapOf(
                "items" to listOf(mapOf("metalType" to "gold", "karat" to "21k", "metalWeightG" to 10, "itemTotal" to 389500)),
                "subtotal" to 389500, "costRate24k" to 38538,
            ),
        )
        val m = invoiceMargin(sale, settings = MarginSettings.mina)
        assertTrue(m.assumed)
        assertEquals(40.0, m.percent)
        assertClose(m.profit, 389500 * 0.4, 6)
    }

    @Test
    fun testTheHousesVariablesAreReadAsTheEnvironmentReadsThem() {
        assertEquals(MarginSettings.taheri, MarginSettings.parse(costRattiLess = null, estMargin = null))
        assertEquals(MarginSettings.taheri, MarginSettings.parse(costRattiLess = "", estMargin = ""))
        assertEquals(MarginSettings.mina, MarginSettings.parse(costRattiLess = "none", estMargin = "0.40"))
        assertEquals(MarginSettings(rattiLess = 4.0, assumedMargin = 0.25), MarginSettings.parse(costRattiLess = " 4 ", estMargin = "0.25"))
        // Out of range falls back: ratti off, margin 10%.
        assertEquals(MarginSettings(rattiLess = null, assumedMargin = 0.10), MarginSettings.parse(costRattiLess = "96", estMargin = "1"))
        assertEquals(MarginSettings(rattiLess = 0.0, assumedMargin = 0.0), MarginSettings.parse(costRattiLess = "0", estMargin = "0"))
    }

    @Test
    fun testPercentLabelIsOneDecimalUnder10AndNoneAbove() {
        fun label(p: Double): String = percentLabel(Margin(percent = p, revenue = 0.0, cost = 0.0, profit = 0.0, assumed = false, costedShare = 0.0))
        assertEquals("7.2%", label(7.2417))
        assertEquals("7.3%", label(7.25)) // toFixed: a tie goes up
        assertEquals("10%", label(10.0))
        assertEquals("18%", label(18.2))
        assertEquals("19%", label(18.5))
        assertEquals("-12%", label(-12.5)) // Math.round: halves go up
        assertEquals("-3.0%", label(-3.04))
        assertEquals("0.0%", label(0.0))
    }
}
