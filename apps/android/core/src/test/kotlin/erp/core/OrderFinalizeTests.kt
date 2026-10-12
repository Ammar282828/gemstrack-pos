package erp.core

import erp.core.logic.FinalizedItem
import erp.core.logic.InvoiceRates
import erp.core.logic.JS
import erp.core.logic.finalizedItemCosts
import erp.core.logic.netMetalG
import erp.core.logic.orderInvoiceRates
import erp.core.logic.takesWastageAndMaking
import erp.core.logic.wastageGramsFor
import erp.core.logic.wastagePercentFor
import erp.core.models.KaratValue
import erp.core.models.MetalType
import erp.core.models.Order
import erp.core.models.OrderItem
import erp.core.models.Settings
import kotlin.math.pow
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** src/lib/order-finalize.test.ts, case for case. */
class OrderFinalizeTests {
    private inline fun <reified T : Any> decode(fields: Map<String, Any?>): T = ERPDecode.model<T>(fields)!!

    /** Jest's `toBeCloseTo(expected, digits)`: within 10^-digits / 2. */
    private fun assertClose(a: Double, b: Double, digits: Int) {
        assertEquals(b, a, 0.5 * 10.0.pow(-digits.toDouble()))
    }

    // `orderInvoiceRates({} as Pick<Order, 'ratesApplied'>, settings)`: an order with no rates kept takes today's.
    private val rates: InvoiceRates by lazy {
        orderInvoiceRates(
            decode<Order>(emptyMap()),
            decode<Settings>(
                mapOf(
                    "goldRatePerGram24k" to 0, "goldRatePerGram22k" to 0, "goldRatePerGram21k" to 34000, "goldRatePerGram18k" to 0,
                    "palladiumRatePerGram" to 0, "platinumRatePerGram" to 0, "silverRatePerGram" to 300,
                ),
            ),
        )
    }

    private val ring: OrderItem by lazy {
        decode<OrderItem>(
            mapOf(
                "description" to "Ruby ring", "metalType" to "gold", "karat" to "21k", "estimatedWeightG" to 6, "stoneWeightG" to 0, "hasStones" to false,
                "wastagePercentage" to 12, "makingCharges" to 10000, "diamondCharges" to 0, "stoneCharges" to 0, "hasDiamonds" to false,
                "sampleGiven" to false, "isCompleted" to true,
            ),
        )
    }

    private fun typed(wastage: Double? = 10.0, diamonds: Double = 0.0, manual: Boolean = false, manualPrice: Double? = null) = FinalizedItem(
        description = "Ruby ring", metalType = MetalType.gold, karat = KaratValue.k21, finalWeightG = 6.5, finalWastagePercentage = wastage,
        finalMakingCharges = 15000.0, finalDiamondCharges = diamonds, finalStoneCharges = 0.0,
        isManualPrice = manual, finalManualPrice = manualPrice,
    )

    @Test
    fun testPricesThePieceAtTheWastageAndMakingTypedNotTheOrders() {
        // 6.5 g × 34,000 = 221,000; 10% wastage 22,100; making 15,000.
        val c = finalizedItemCosts(ring, typed(), rates)
        assertEquals(258100.0, c.price)
        assertEquals(10.0, c.wastagePercentage)
        assertEquals(15000.0, c.makingCharges)
    }

    @Test
    fun testKeepsTheOrdersWastageWhenNoneIsSent() {
        assertEquals(12.0, finalizedItemCosts(ring, typed(wastage = null), rates).wastagePercentage)
    }

    @Test
    fun testCountsADiamondChargeTypedHereEvenIfTheOrderNeverTickedDiamonds() {
        assertEquals(308100.0, finalizedItemCosts(ring, typed(diamonds = 50000.0), rates).price)
    }

    @Test
    fun testTakesAFixedPriceAsItIs() {
        assertEquals(99000.0, finalizedItemCosts(ring, typed(manual = true, manualPrice = 99000.0), rates).price)
    }

    @Test
    fun testTurnsTheKarigarsGramsIntoThePercentageAndBackOnTheMetalLessItsStones() {
        assertEquals(10.0, wastagePercentFor(0.65, 6.5))
        assertClose(wastageGramsFor(10.0, 6.5), 0.65, 6)
        assertEquals(10.0, wastagePercentFor(0.62, 6.5, 0.3))
        assertEquals(0.0, wastagePercentFor(0.5, 0.0))
        assertClose(wastageGramsFor(wastagePercentFor(0.65, 6.37), 6.37), 0.65, 6)
        // 2 g typed on 20.3 g at 35,000/g is 70,000 of wastage, to the rupee.
        assertEquals(70000.0, JS.round(20.3 * 35000 * wastagePercentFor(2.0, 20.3) / 100))
    }

    // MARK: Beyond the TypeScript's own cases (figures printed by the TypeScript)

    @Test
    fun testAFixedPriceKeepsTheOrdersWastagePercentageAndPricesNoPart() {
        val c = finalizedItemCosts(ring, typed(manual = true, manualPrice = 99000.0), rates)
        assertEquals(12.0, c.wastagePercentage)
        assertEquals(0.0, c.metalCost)
        assertEquals(0.0, c.wastageCost)
        assertEquals(0.0, c.makingCharges)
    }

    @Test
    fun testSilverIsItsWeightAtTheOneRateWhateverWastageAndMakingAreTyped() {
        val silver = decode<OrderItem>(mapOf("description" to "Silver bangle", "metalType" to "silver", "estimatedWeightG" to 10, "wastagePercentage" to 15))
        val f = FinalizedItem(
            description = "Silver bangle", metalType = MetalType.silver, finalWeightG = 10.5, finalWastagePercentage = 20.0,
            finalMakingCharges = 4000.0, finalDiamondCharges = 0.0, finalStoneCharges = 600.0,
        )
        val c = finalizedItemCosts(silver, f, rates)
        // 10.5 g × 300 + 600 of stones; wastage and making are not part of silver's price.
        assertEquals(3750.0, c.price)
        assertEquals(3150.0, c.metalCost)
        assertEquals(0.0, c.wastageCost)
        assertEquals(0.0, c.makingCharges)
        assertEquals(600.0, c.stoneCharges)
        assertEquals(20.0, c.wastagePercentage)
        assertFalse(takesWastageAndMaking(MetalType.silver))
        assertTrue(takesWastageAndMaking(MetalType.gold))
        assertTrue(takesWastageAndMaking(MetalType.palladium))
    }

    @Test
    fun testAnOrderKeepsTheRatesItWasBookedAtNotTodays() {
        val order = decode<Order>(mapOf("ratesApplied" to mapOf("goldRatePerGram21k" to 30000, "silverRatePerGram" to 250)))
        val settings = decode<Settings>(mapOf("goldRatePerGram21k" to 34000, "silverRatePerGram" to 300, "palladiumRatePerGram" to 14500, "palladiumRatePerGram18k" to 15200))
        val booked = orderInvoiceRates(order, settings)
        assertEquals(30000.0, booked.goldRatePerGram21k)
        assertEquals(250.0, booked.silverRatePerGram)
        // 6.5 g × 30,000 = 195,000; 10% wastage 19,500; making 15,000.
        assertEquals(229500.0, finalizedItemCosts(ring, typed(), booked).price)
    }

    @Test
    fun testAnOrderWithNoRatesKeptTakesTodaysSevenWithPalladiumFlat() {
        val settings = decode<Settings>(
            mapOf(
                "goldRatePerGram24k" to 41520, "goldRatePerGram21k" to 34000, "palladiumRatePerGram" to 14500,
                "palladiumRatePerGram18k" to 15200, "palladiumRatePerGram12k" to 10100, "platinumRatePerGram" to 21000, "silverRatePerGram" to 300,
            ),
        )
        val today = orderInvoiceRates(decode<Order>(emptyMap()), settings)
        assertEquals(41520.0, today.goldRatePerGram24k)
        assertEquals(21000.0, today.platinumRatePerGram)
        // The TS copies seven rates; the two per-karat palladium ones are not among them.
        assertEquals(14500.0, today.palladiumRatePerGram)
        assertEquals(0.0, today.palladiumRatePerGram18k)
        assertEquals(0.0, today.palladiumRatePerGram12k)
        assertEquals(today, orderInvoiceRates(ratesApplied = null, settings = settings))
    }

    @Test
    fun testTheNetMetalIsNeverBelowZero() {
        assertEquals(6.5, netMetalG(6.5))
        assertEquals(6.2, netMetalG(6.5, 0.3))
        assertEquals(0.0, netMetalG(2.0, 3.0))
        assertEquals(0.0, netMetalG(Double.NaN, 1.0))
        assertEquals(0.62, wastageGramsFor(10.0, 6.5, 0.3), 1e-12)
    }
}
