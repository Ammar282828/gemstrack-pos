package erp.core

import erp.core.logic.BalanceState
import erp.core.logic.PricedPiece
import erp.core.logic.PricingRates
import erp.core.logic.ProductCosts
import erp.core.logic.RoundOffOffer
import erp.core.logic.balanceLine
import erp.core.logic.calculateProductCosts
import erp.core.logic.discountWithOffer
import erp.core.logic.isCredit
import erp.core.logic.isOwing
import erp.core.logic.isSettled
import erp.core.logic.lineTotal
import erp.core.logic.owedToYou
import erp.core.logic.owesMoney
import erp.core.logic.pkr
import erp.core.logic.roundOffLabel
import erp.core.logic.roundOffOffers
import erp.core.logic.rupeeText
import erp.core.logic.rupees
import erp.core.logic.rupeesAny
import erp.core.logic.rupeesIn
import erp.core.logic.settleRemainderOffer
import erp.core.logic.wholeRupeesFromText
import erp.core.models.Invoice
import erp.core.models.KaratValue
import erp.core.models.MetalType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * src/lib/money-round.test.ts case for case (its input -> output tables included), and the whole-rupee
 * cases of src/lib/money.test.ts; the iPhone's MoneyRoundTests, same names. Amounts are made up.
 */
class MoneyRoundTests {
    private fun pairs(offers: List<RoundOffOffer>): List<List<Double>> = offers.map { listOf(it.target, it.extra) }
    private fun p(vararg x: Double): List<Double> = x.toList()

    // roundOffOffers

    @Test
    fun testOffersTheRoundDownsCoarsestFirstAtMostThree() {
        assertEquals(listOf(p(270_000.0, 2_340.0), p(272_000.0, 340.0), p(272_300.0, 40.0)), pairs(roundOffOffers(272_340.0)))
        assertEquals(listOf(p(95_000.0, 4_999.0), p(99_000.0, 999.0), p(99_500.0, 499.0)), pairs(roundOffOffers(99_999.0)))
        assertEquals(listOf(270_000.0, 271_000.0), roundOffOffers(271_050.0).map { it.target })
    }

    @Test
    fun testTakesTheThreeRoundestWhenMoreQualify() {
        // 10000/5000 -> 270,000, 1000 -> 273,000, 500 -> 273,500, 100 -> 273,600
        val o = roundOffOffers(273_640.0)
        assertEquals(3, o.size)
        assertEquals(listOf(270_000.0, 273_000.0, 273_500.0), o.map { it.target })
    }

    @Test
    fun testDedupesStepsThatLandOnTheSameTarget() {
        val o = roundOffOffers(12_300.0) // 100 -> itself (round), 5000/10000 -> 10,000, 500/1000 -> 12,000
        assertEquals(listOf(10_000.0, 12_000.0), o.map { it.target })
        assertEquals(300.0, o[1].extra)
    }

    @Test
    fun testOffersNothingForATotalThatIsAlreadyRound() {
        assertEquals(emptyList(), roundOffOffers(270_000.0))
        assertEquals(emptyList(), roundOffOffers(100.0))
    }

    @Test
    fun testOffersNothingUnder100RoundingDownWouldGiveTheBillAway() {
        assertEquals(emptyList(), roundOffOffers(99.0))
        assertEquals(emptyList(), roundOffOffers(1.0))
        assertEquals(emptyList(), roundOffOffers(0.0))
    }

    @Test
    fun testHandlesASmallBillWithARealRoundTarget() {
        assertEquals(listOf(p(1_000.0, 234.0), p(1_200.0, 34.0)), pairs(roundOffOffers(1_234.0)))
    }

    @Test
    fun testDrawsTheLineAt5000UnderIsACandidate5000ItselfNeverIs() {
        // 9,999 is 4,999 over 5,000: the coarsest step is offered first.
        assertEquals(listOf(p(5_000.0, 4_999.0), p(9_000.0, 999.0), p(9_500.0, 499.0)), pairs(roundOffOffers(9_999.0)))
        // 15,000 and 5,000 are round: the next step down would cost exactly 5,000 and is not offered.
        assertEquals(emptyList(), roundOffOffers(15_000.0))
        assertEquals(emptyList(), roundOffOffers(5_000.0))
        assertEquals(listOf(p(5_000.0, 99.0)), pairs(roundOffOffers(5_099.0)))
        assertEquals(listOf(4_000.0, 4_500.0, 4_900.0), roundOffOffers(4_999.0).map { it.target })
    }

    @Test
    fun testNeverOffersMoreThan4999Off() {
        for (t in listOf(10_001.0, 49_999.0, 123_456.0, 999_999.0)) {
            for (o in roundOffOffers(t)) {
                assertTrue(o.extra > 0)
                assertTrue(o.extra < 5_000)
                assertEquals(t, o.target + o.extra)
            }
        }
    }

    @Test
    fun testOffersNothingForANegativeEmptyOrUnreadableTotal() {
        assertEquals(emptyList(), roundOffOffers(-5_250.0))
        assertEquals(emptyList(), roundOffOffers(Double.NaN))
        assertEquals(emptyList(), roundOffOffers(null))
    }

    @Test
    fun testReadsAnOldFractionalTotalAsWholeRupees() {
        assertEquals(roundOffOffers(272_340.0), roundOffOffers(272_340.4))
    }

    // discountWithOffer

    @Test
    fun testAddsTheExtraToADiscountAlreadyTyped() {
        // 300,000 bill, 27,660 typed -> total 272,340; the 270,000 offer adds 2,340.
        val offer = roundOffOffers(300_000.0 - 27_660.0).first { it.target == 270_000.0 }
        assertEquals(30_000.0, discountWithOffer(27_660.0, offer))
        assertEquals(270_000.0, 300_000.0 - discountWithOffer(27_660.0, offer))
    }

    // settleRemainderOffer

    @Test
    fun testGivesAwayASmallRemainder() {
        assertEquals(1.0, settleRemainderOffer(1.0))
        assertEquals(4_999.0, settleRemainderOffer(4_999.0))
        assertEquals(2_340.0, settleRemainderOffer(2_340.0))
    }

    @Test
    fun testDoesNotAt5000OrMore() {
        assertNull(settleRemainderOffer(5_000.0))
        assertNull(settleRemainderOffer(120_000.0))
    }

    @Test
    fun testDoesNotWhenNothingIsLeftOrTheCustomerOverpaid() {
        assertNull(settleRemainderOffer(0.0))
        assertNull(settleRemainderOffer(-300.0))
        assertNull(settleRemainderOffer(0.4))
        assertNull(settleRemainderOffer(Double.NaN))
    }

    // roundOffLabel

    @Test
    fun testReadsLikeTheChip() {
        assertEquals("Round to 270,000 · −2,340", roundOffLabel(RoundOffOffer(target = 270_000.0, extra = 2_340.0)))
    }

    // The tables, for the apps to port

    @Test
    fun testTables() {
        // name, total, existing discount, [target, extra]...
        class Row(val name: String, val total: Double, val disc: Double, val want: List<List<Double>>)
        val rows = listOf(
            Row("round already", 270_000.0, 0.0, emptyList()),
            Row("under 100", 99.0, 0.0, emptyList()),
            Row("typed discount counts", 300_000.0, 27_660.0, listOf(p(270_000.0, 2_340.0), p(272_000.0, 340.0), p(272_300.0, 40.0))),
            Row("discount makes it round", 300_000.0, 30_000.0, emptyList()),
            Row("small", 1_234.0, 0.0, listOf(p(1_000.0, 234.0), p(1_200.0, 34.0))),
        )
        for (r in rows) {
            val got = roundOffOffers(r.total, r.disc)
            assertEquals(r.want, pairs(got), r.name)
            for (o in got) assertEquals(r.disc + o.extra, o.discount, r.name)
        }
    }

    @Test
    fun testTablesIsSettledAndRupees() {
        assertEquals(listOf(true, true, false, false, true), listOf(0.99, -0.99, 1.0, -1.0, 0.0).map { isSettled(it) })
        assertEquals(listOf(3.0, 2.0, 0.0, 297_001.0), listOf(2.5, 2.49, -0.4, 297_000.5).map { rupees(it) })
        assertEquals(30.0, lineTotal(listOf(10.4, 10.4, 10.4)))
    }

    // JavaScript's Math.round, exactly (half up toward +infinity)

    @Test
    fun testHalvesGoUpEvenWhenNegative() {
        assertEquals(-2.0, rupees(-2.5))
        assertEquals(0.0, rupees(-0.5))
        assertEquals(-1.0, rupees(-1.5))
        assertEquals(-3.0, rupees(-2.51))
        assertEquals(1.0, rupees(0.5))
        assertEquals(2.0, rupees(1.5))
        // Just under a half is not a half (a naive floor(x + 0.5) says 1).
        assertEquals(0.0, rupees(0.49999999999999994))
        assertEquals(0.0, rupees(Double.POSITIVE_INFINITY))
        assertEquals(0.0, rupees(Double.NEGATIVE_INFINITY))
    }

    // money.test.ts — whole rupees

    private fun isPlusZero(x: Double) = x == 0.0 && 1.0 / x > 0

    @Test
    fun testRoundsHalvesUpNeverLeavesMinusZeroOrNaN() {
        assertEquals(297_001.0, rupees(297_000.5))
        assertEquals(297_000.0, rupees(297_000.49))
        assertEquals(0.0, rupees(-0.2))
        assertTrue(isPlusZero(rupees(-0.2)))
        assertTrue(isPlusZero(rupees(-0.0)))
        assertEquals(0.0, rupeesAny("12,500")) // text is read by wholeRupeesFromText
        assertEquals(0.0, rupees(null))
        assertEquals(0.0, rupees(Double.NaN))
    }

    @Test
    fun testReadsTypedText() {
        assertEquals(12_501.0, wholeRupeesFromText("12,500.75"))
    }

    @Test
    fun testShowsNoDecimals() {
        assertEquals("PKR 297,000", pkr(297_000.0))
        assertEquals("PKR 297,000", pkr(297_000.4))
        assertEquals("1,234,568", rupeeText(1_234_567.8))
    }

    @Test
    fun testRoundsOnlyTheMoneyFieldsThatAreThere() {
        assertEquals(mapOf("a" to 2.0), rupeesIn(mapOf("a" to 1.6, "c" to ""), listOf("a", "b", "c")))
    }

    @Test
    fun testAFractionLeftFromBeforeIsNotADebtOrACredit() {
        assertFalse(owesMoney(0.7))
        assertTrue(owesMoney(1.0))
        assertFalse(owesMoney(-0.7))
        assertFalse(isCredit(-0.7))
        assertTrue(isCredit(-1.0))
        assertEquals(BalanceState.paid, balanceLine(0.99).state)
        assertEquals(BalanceState.due, balanceLine(1.0).state)
        assertEquals(BalanceState.paid, balanceLine(-0.99).state)
        assertEquals(BalanceState.credit, balanceLine(-1.0).state)
    }

    @Test
    fun testDueToCustomersLeavesOutASubRupeeRemainder() {
        val a = ERPDecode.model<Invoice>(mapOf("id" to "A", "balanceDue" to 0.7))!!
        val b = ERPDecode.model<Invoice>(mapOf("id" to "B", "balanceDue" to 1.2))!!
        assertFalse(isOwing(a))
        assertTrue(isOwing(b))
        val c = ERPDecode.model<Invoice>(mapOf("id" to "B", "balanceDue" to 1500, "customerId" to "c1"))!!
        val o = owedToYou(listOf(a, c))
        assertEquals(1500.0, o.total)
        assertEquals(listOf("B"), o.invoices.map { it.id })
    }

    // money.test.ts — a piece prices in whole rupees that add up

    private val rates = PricingRates(goldRatePerGram21k = 28_333.33)
    private val piece = PricedPiece(
        metalType = MetalType.gold, karat = KaratValue.k21, metalWeightG = 7.337, stoneWeightG = 0.211, wastagePercentage = 9.5,
        makingCharges = 12_345.67, hasDiamonds = true, diamondCharges = 5_000.5, stoneCharges = 1_999.49, miscCharges = 0.0,
    )

    private fun allWhole(c: ProductCosts): Boolean =
        listOf(c.metalCost, c.wastageCost, c.makingCharges, c.diamondCharges, c.stoneCharges, c.miscCharges, c.totalPrice)
            .all { it == Math.rint(it) }

    @Test
    fun testEveryLineAndTheTotalAreIntegersAndTheLinesSumToTheTotal() {
        val c = calculateProductCosts(piece, rates)
        assertTrue(allWhole(c))
        assertEquals(c.totalPrice, c.metalCost + c.wastageCost + c.makingCharges + c.diamondCharges + c.stoneCharges + c.miscCharges)
    }

    @Test
    fun testSilverAndAFixedPriceToo() {
        val silver = piece.copy(metalType = MetalType.silver, karat = null)
        val silverRates = rates.copy(silverRatePerGram = 187.55)
        assertTrue(allWhole(calculateProductCosts(silver, silverRates)))
        val fixed = piece.copy(isCustomPrice = true, customPrice = 99_999.6)
        assertEquals(100_000.0, calculateProductCosts(fixed, rates).totalPrice)
    }
}
