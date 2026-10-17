package erp.core

import erp.core.logic.DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL
import erp.core.logic.GOLD_COIN_CATEGORY_ID_INTERNAL
import erp.core.logic.PricedPiece
import erp.core.logic.PricingRates
import erp.core.logic.calculateProductCosts
import erp.core.logic.calculateProductPrice
import erp.core.models.InvoiceItem
import erp.core.models.KaratValue
import erp.core.models.MetalType
import erp.core.models.OrderItem
import erp.core.models.Product
import erp.core.models.Rates
import erp.core.models.Settings
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * src/lib/pricing.ts. It has no test of its own, so every figure below was printed by the
 * TypeScript (`_calculateProductCostsInternal`, run with tsx) for the made-up piece beside it,
 * and is compared exactly, to the last bit: the Kotlin must add the same doubles in the same order.
 * Since 2026-10-17 every line is whole rupees (MoneyRound.kt): the figures were printed again by the
 * TypeScript after that change, for the same pieces.
 * All names, weights, rates and amounts are invented.
 */
class PricingTests {
    // Rate cards (PKR a gram). `flatPalladium` is what `orderInvoiceRates` builds from the settings:
    // no per-karat palladium.
    private val shop = PricingRates(goldRatePerGram24k = 41520.0, goldRatePerGram22k = 38060.0, goldRatePerGram21k = 36330.0, goldRatePerGram18k = 31140.0, palladiumRatePerGram = 14500.0, palladiumRatePerGram18k = 15200.0, palladiumRatePerGram12k = 10100.0, platinumRatePerGram = 21000.0, silverRatePerGram = 330.5)
    private val zero = PricingRates(goldRatePerGram24k = 0.0, goldRatePerGram22k = 0.0, goldRatePerGram21k = 0.0, goldRatePerGram18k = 0.0, palladiumRatePerGram = 0.0, palladiumRatePerGram18k = 0.0, palladiumRatePerGram12k = 0.0, platinumRatePerGram = 0.0, silverRatePerGram = 0.0)
    private val flatPalladium = PricingRates(goldRatePerGram24k = 41520.0, goldRatePerGram22k = 38060.0, goldRatePerGram21k = 36330.0, goldRatePerGram18k = 31140.0, palladiumRatePerGram = 14500.0, palladiumRatePerGram18k = 0.0, palladiumRatePerGram12k = 0.0, platinumRatePerGram = 21000.0, silverRatePerGram = 330.5)
    private val perKaratOnly = PricingRates(goldRatePerGram24k = 41520.0, goldRatePerGram22k = 38060.0, goldRatePerGram21k = 36330.0, goldRatePerGram18k = 31140.0, palladiumRatePerGram = 0.0, palladiumRatePerGram18k = 15200.0, palladiumRatePerGram12k = 10100.0, platinumRatePerGram = 21000.0, silverRatePerGram = 330.5)
    private val silverHouse = PricingRates(goldRatePerGram24k = 0.0, goldRatePerGram22k = 0.0, goldRatePerGram21k = 0.0, goldRatePerGram18k = 0.0, palladiumRatePerGram = 0.0, palladiumRatePerGram18k = 0.0, palladiumRatePerGram12k = 0.0, platinumRatePerGram = 0.0, silverRatePerGram = 412.75)
    private val noPlatinum = PricingRates(goldRatePerGram24k = 41520.0, goldRatePerGram22k = 38060.0, goldRatePerGram21k = 36330.0, goldRatePerGram18k = 31140.0, palladiumRatePerGram = 14500.0, palladiumRatePerGram18k = 15200.0, palladiumRatePerGram12k = 10100.0, platinumRatePerGram = 0.0, silverRatePerGram = 330.5)

    private fun expect(
        piece: PricedPiece, rates: PricingRates,
        metal: Double, wastage: Double, making: Double, diamonds: Double, stones: Double, misc: Double, total: Double,
    ) {
        val c = calculateProductCosts(piece, rates)
        assertEquals(metal, c.metalCost, "metalCost")
        assertEquals(wastage, c.wastageCost, "wastageCost")
        assertEquals(making, c.makingCharges, "makingCharges")
        assertEquals(diamonds, c.diamondCharges, "diamondCharges")
        assertEquals(stones, c.stoneCharges, "stoneCharges")
        assertEquals(misc, c.miscCharges, "miscCharges")
        assertEquals(total, c.totalPrice, "totalPrice")
        assertEquals(total, calculateProductPrice(piece, rates), "calculateProductPrice")
    }

    private fun price(piece: PricedPiece, rates: PricingRates): Double = calculateProductCosts(piece, rates).totalPrice

    private fun invoiceItem(fields: Map<String, Any?>): InvoiceItem {
        val line = mutableMapOf<String, Any?>("sku" to "X", "name" to "X", "categoryId" to "cat001", "quantity" to 1)
        line.putAll(fields)
        return ERPDecode.model<InvoiceItem>(line)!!
    }

    private fun orderItem(fields: Map<String, Any?>): OrderItem {
        val item = mutableMapOf<String, Any?>("description" to "Test piece")
        item.putAll(fields)
        return ERPDecode.model<OrderItem>(item)!!
    }

    private fun product(fields: Map<String, Any?>): Product {
        val p = mutableMapOf<String, Any?>("sku" to "P-0001", "name" to "Test piece")
        p.putAll(fields)
        return ERPDecode.model<Product>(p)!!
    }

    // MARK: Constants

    @Test
    fun testTheDefaultKaratAndTheCoinCategory() {
        assertEquals(KaratValue.k21, DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL)
        assertEquals("cat017", GOLD_COIN_CATEGORY_ID_INTERNAL)
    }

    // MARK: calculateProductCosts, against the TypeScript

    @Test
    fun testGold18kRingLessItsStone() {
        // Gold 18k: the metal is the weight less the stone (5.2 g - 0.3 g), wastage on that, then making and stone charge.
        expect(
            PricedPiece(metalType = MetalType.gold, karat = KaratValue.k18, metalWeightG = 5.2, stoneWeightG = 0.3, wastagePercentage = 12.0, makingCharges = 8500.0, stoneCharges = 2500.0),
            shop,
            metal = 152586.0, wastage = 18310.0, making = 8500.0, diamonds = 0.0, stones = 2500.0, misc = 0.0, total = 181896.0,
        )
    }

    @Test
    fun testGold21kBangle() {
        // Gold 21k, plain: weight x rate, 8% wastage, making.
        expect(
            PricedPiece(metalType = MetalType.gold, karat = KaratValue.k21, metalWeightG = 24.75, wastagePercentage = 8.0, makingCharges = 12000.0),
            shop,
            metal = 899168.0, wastage = 71933.0, making = 12000.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 983101.0,
        )
    }

    @Test
    fun testGold22kChainWithSundries() {
        // Gold 22k with a miscellaneous charge.
        expect(
            PricedPiece(metalType = MetalType.gold, karat = KaratValue.k22, metalWeightG = 18.4, wastagePercentage = 6.5, makingCharges = 9000.0, miscCharges = 500.0),
            shop,
            metal = 700304.0, wastage = 45520.0, making = 9000.0, diamonds = 0.0, stones = 0.0, misc = 500.0, total = 755324.0,
        )
    }

    @Test
    fun testGold24kNoWastageNoMaking() {
        // Gold 24k at its own rate, no wastage and no making.
        expect(
            PricedPiece(metalType = MetalType.gold, karat = KaratValue.k24, metalWeightG = 11.664),
            shop,
            metal = 484289.0, wastage = 0.0, making = 0.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 484289.0,
        )
    }

    @Test
    fun testGoldWithNoKaratIsPricedAs21k() {
        // No karat recorded: 21k.
        expect(
            PricedPiece(metalType = MetalType.gold, metalWeightG = 9.9, wastagePercentage = 10.0, makingCharges = 4000.0),
            shop,
            metal = 359667.0, wastage = 35967.0, making = 4000.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 399634.0,
        )
    }

    @Test
    fun testGoldWithAnEmptyKaratIsPricedAs21k() {
        // An empty karat is no karat (JavaScript: "" is falsy).
        expect(
            PricedPiece(metalType = MetalType.gold, karat = KaratValue.unknown(""), metalWeightG = 9.9, wastagePercentage = 10.0, makingCharges = 4000.0),
            shop,
            metal = 359667.0, wastage = 35967.0, making = 4000.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 399634.0,
        )
    }

    @Test
    fun testGoldInAKaratNobodySellsIsWorthNoMetal() {
        // A karat gold is not sold in has no rate: the metal is 0, the charges stand.
        expect(
            PricedPiece(metalType = MetalType.gold, karat = KaratValue.unknown("20k"), metalWeightG = 8.0, wastagePercentage = 10.0, makingCharges = 3000.0),
            shop,
            metal = 0.0, wastage = 0.0, making = 3000.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 3000.0,
        )
    }

    @Test
    fun testGoldKaratIsCaseSensitive() {
        // "24K" is not "24k": no rate.
        expect(
            PricedPiece(metalType = MetalType.gold, karat = KaratValue.unknown("24K"), metalWeightG = 8.0, makingCharges = 3000.0),
            shop,
            metal = 0.0, wastage = 0.0, making = 3000.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 3000.0,
        )
    }

    @Test
    fun testGoldCoinTakesTheMetalAlone() {
        // Category cat017 with gold: wastage, making, diamonds, stones and sundries are all dropped.
        expect(
            PricedPiece(categoryId = "cat017", metalType = MetalType.gold, karat = KaratValue.k24, metalWeightG = 11.664, wastagePercentage = 5.0, makingCharges = 2000.0, hasDiamonds = true, diamondCharges = 9000.0, stoneCharges = 700.0, miscCharges = 300.0),
            shop,
            metal = 484289.0, wastage = 0.0, making = 0.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 484289.0,
        )
    }

    @Test
    fun testCoinCategoryInPalladiumIsNotACoin() {
        // The coin rule needs gold as well as the category.
        expect(
            PricedPiece(categoryId = "cat017", metalType = MetalType.palladium, karat = KaratValue.k18, metalWeightG = 6.0, wastagePercentage = 5.0, makingCharges = 2000.0),
            shop,
            metal = 91200.0, wastage = 4560.0, making = 2000.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 97760.0,
        )
    }

    @Test
    fun testGoldWithDiamonds() {
        // Diamonds ticked: the diamond charge counts. A stone weight comes off the metal.
        expect(
            PricedPiece(metalType = MetalType.gold, karat = KaratValue.k22, metalWeightG = 7.35, stoneWeightG = 0.42, wastagePercentage = 9.0, makingCharges = 15000.0, hasDiamonds = true, diamondCharges = 85000.0, stoneCharges = 4200.0),
            shop,
            metal = 263756.0, wastage = 23738.0, making = 15000.0, diamonds = 85000.0, stones = 4200.0, misc = 0.0, total = 391694.0,
        )
    }

    @Test
    fun testDiamondChargeIgnoredWhenNotTicked() {
        // A diamond charge without "has diamonds" is not counted (silver counts it regardless).
        expect(
            PricedPiece(metalType = MetalType.gold, karat = KaratValue.k21, metalWeightG = 5.0, wastagePercentage = 10.0, makingCharges = 1000.0, hasDiamonds = false, diamondCharges = 4000.0),
            shop,
            metal = 181650.0, wastage = 18165.0, making = 1000.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 200815.0,
        )
    }

    @Test
    fun testGoldWithASecondMetalOfPlatinum() {
        // A platinum accent on a gold piece: its weight at the platinum rate joins the metal before wastage.
        expect(
            PricedPiece(metalType = MetalType.gold, karat = KaratValue.k18, metalWeightG = 6.1, secondaryMetalType = MetalType.platinum, secondaryMetalWeightG = 1.8, wastagePercentage = 10.0, makingCharges = 7000.0),
            shop,
            metal = 227754.0, wastage = 22775.0, making = 7000.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 257529.0,
        )
    }

    @Test
    fun testGoldWithASecondMetalOfGold() {
        // A second gold at its own karat.
        expect(
            PricedPiece(metalType = MetalType.gold, karat = KaratValue.k21, metalWeightG = 10.0, secondaryMetalType = MetalType.gold, secondaryMetalKarat = KaratValue.k18, secondaryMetalWeightG = 2.2, wastagePercentage = 5.0),
            shop,
            metal = 431808.0, wastage = 21590.0, making = 0.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 453398.0,
        )
    }

    @Test
    fun testGoldWithASecondMetalOfSilverUsesTheShopsRate() {
        // A silver second metal takes the shop rate, never a product rate.
        expect(
            PricedPiece(metalType = MetalType.gold, karat = KaratValue.k21, metalWeightG = 10.0, secondaryMetalType = MetalType.silver, secondaryMetalWeightG = 3.0, wastagePercentage = 5.0, silverRatePerGram = 999.0),
            shop,
            metal = 364292.0, wastage = 18215.0, making = 0.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 382507.0,
        )
    }

    @Test
    fun testSecondMetalWithNoWeightIsLeftOut() {
        // A second metal with 0 g adds nothing.
        expect(
            PricedPiece(metalType = MetalType.gold, karat = KaratValue.k21, metalWeightG = 10.0, secondaryMetalType = MetalType.platinum, secondaryMetalWeightG = 0.0),
            shop,
            metal = 363300.0, wastage = 0.0, making = 0.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 363300.0,
        )
    }

    @Test
    fun testSecondMetalWeightLessThanZeroIsLeftOut() {
        // A negative second weight is clamped to 0.
        expect(
            PricedPiece(metalType = MetalType.gold, karat = KaratValue.k21, metalWeightG = 10.0, secondaryMetalType = MetalType.platinum, secondaryMetalWeightG = -2.0),
            shop,
            metal = 363300.0, wastage = 0.0, making = 0.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 363300.0,
        )
    }

    @Test
    fun testSecondMetalOfAnUnknownKindIsWorthNothing() {
        // A metal the rate card does not know prices at 0.
        expect(
            PricedPiece(metalType = MetalType.gold, karat = KaratValue.k21, metalWeightG = 10.0, secondaryMetalType = MetalType.unknown("copper"), secondaryMetalWeightG = 4.0),
            shop,
            metal = 363300.0, wastage = 0.0, making = 0.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 363300.0,
        )
    }

    @Test
    fun testSilverIsWeightTimesTheOneRate() {
        // Silver: weight x rate; wastage and making are bundled into the rate and ignored; stones, diamonds (ticked or not) and sundries added.
        expect(
            PricedPiece(metalType = MetalType.silver, metalWeightG = 12.5, stoneWeightG = 1.5, wastagePercentage = 15.0, makingCharges = 5000.0, diamondCharges = 2000.0, stoneCharges = 1200.0, miscCharges = 300.0),
            shop,
            metal = 4131.0, wastage = 0.0, making = 0.0, diamonds = 2000.0, stones = 1200.0, misc = 300.0, total = 7631.0,
        )
    }

    @Test
    fun testSilverWithItsOwnRate() {
        // A silver piece with its own all-in rate beats the shop rate.
        expect(
            PricedPiece(metalType = MetalType.silver, metalWeightG = 12.5, stoneCharges = 1200.0, silverRatePerGram = 410.0),
            shop,
            metal = 5125.0, wastage = 0.0, making = 0.0, diamonds = 0.0, stones = 1200.0, misc = 0.0, total = 6325.0,
        )
    }

    @Test
    fun testSilverWithItsOwnRateOfZeroTakesTheShops() {
        // A product rate of 0 falls back to the shop rate.
        expect(
            PricedPiece(metalType = MetalType.silver, metalWeightG = 12.5, silverRatePerGram = 0.0),
            shop,
            metal = 4131.0, wastage = 0.0, making = 0.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 4131.0,
        )
    }

    @Test
    fun testSilverWithNoRateAtAllIsOnlyItsCharges() {
        // No rate anywhere: the charges alone.
        expect(
            PricedPiece(metalType = MetalType.silver, metalWeightG = 12.5, stoneCharges = 1200.0, miscCharges = 300.0),
            zero,
            metal = 0.0, wastage = 0.0, making = 0.0, diamonds = 0.0, stones = 1200.0, misc = 300.0, total = 1500.0,
        )
    }

    @Test
    fun testSilverOnASilverHouseRateCard() {
        // A silver house prices silver at its own rate, 412.75 a gram.
        expect(
            PricedPiece(metalType = MetalType.silver, metalWeightG = 7.3, miscCharges = 150.0),
            silverHouse,
            metal = 3013.0, wastage = 0.0, making = 0.0, diamonds = 0.0, stones = 0.0, misc = 150.0, total = 3163.0,
        )
    }

    @Test
    fun testSilverWeightBelowZeroIsNotClamped() {
        // Silver does not clamp: a negative weight is a negative metal cost (the TS only clamps gold, platinum and palladium).
        expect(
            PricedPiece(metalType = MetalType.silver, metalWeightG = -2.0, stoneCharges = 100.0),
            shop,
            metal = -661.0, wastage = 0.0, making = 0.0, diamonds = 0.0, stones = 100.0, misc = 0.0, total = -561.0,
        )
    }

    @Test
    fun testPalladium18kUsesItsOwnRate() {
        // Palladium 18k: the per-karat rate (15,200), not the flat one.
        expect(
            PricedPiece(metalType = MetalType.palladium, karat = KaratValue.k18, metalWeightG = 8.8, wastagePercentage = 10.0, makingCharges = 6000.0),
            shop,
            metal = 133760.0, wastage = 13376.0, making = 6000.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 153136.0,
        )
    }

    @Test
    fun testPalladium12kUsesItsOwnRate() {
        // Palladium 12k: 10,100 a gram.
        expect(
            PricedPiece(metalType = MetalType.palladium, karat = KaratValue.k12, metalWeightG = 8.8, wastagePercentage = 10.0, makingCharges = 6000.0),
            shop,
            metal = 88880.0, wastage = 8888.0, making = 6000.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 103768.0,
        )
    }

    @Test
    fun testPalladiumWithNoKaratTakesTheFlatRate() {
        // Palladium with no karat: the flat rate.
        expect(
            PricedPiece(metalType = MetalType.palladium, metalWeightG = 8.8, wastagePercentage = 10.0),
            shop,
            metal = 127600.0, wastage = 12760.0, making = 0.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 140360.0,
        )
    }

    @Test
    fun testPalladium18kWithNoPerKaratRateFallsBackToFlat() {
        // A shop that has not filled the per-karat figures in must not price palladium at zero.
        expect(
            PricedPiece(metalType = MetalType.palladium, karat = KaratValue.k18, metalWeightG = 8.8, wastagePercentage = 10.0),
            flatPalladium,
            metal = 127600.0, wastage = 12760.0, making = 0.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 140360.0,
        )
    }

    @Test
    fun testPalladiumInAKaratWithNoRateOfItsOwnTakesFlat() {
        // Palladium at 21k: neither per-karat rate applies, so the flat one.
        expect(
            PricedPiece(metalType = MetalType.palladium, karat = KaratValue.k21, metalWeightG = 8.8),
            shop,
            metal = 127600.0, wastage = 0.0, making = 0.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 127600.0,
        )
    }

    @Test
    fun testPalladiumWithOnlyPerKaratRatesAndNoKaratIsWorthNothing() {
        // No flat rate and no karat to pick a per-karat one: 0 metal.
        expect(
            PricedPiece(metalType = MetalType.palladium, metalWeightG = 8.8, makingCharges = 2000.0),
            perKaratOnly,
            metal = 0.0, wastage = 0.0, making = 2000.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 2000.0,
        )
    }

    @Test
    fun testPlatinumWithWastage() {
        // Platinum is metal x rate with wastage.
        expect(
            PricedPiece(metalType = MetalType.platinum, metalWeightG = 4.25, stoneWeightG = 0.25, wastagePercentage = 8.0, makingCharges = 10000.0, hasDiamonds = true, diamondCharges = 30000.0),
            shop,
            metal = 84000.0, wastage = 6720.0, making = 10000.0, diamonds = 30000.0, stones = 0.0, misc = 0.0, total = 130720.0,
        )
    }

    @Test
    fun testPlatinumWithNoRateIsWorthNoMetal() {
        // No platinum rate: the metal is 0.
        expect(
            PricedPiece(metalType = MetalType.platinum, metalWeightG = 4.25, wastagePercentage = 8.0, makingCharges = 10000.0),
            noPlatinum,
            metal = 0.0, wastage = 0.0, making = 10000.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 10000.0,
        )
    }

    @Test
    fun testCustomPriceIsTheWholePrice() {
        // A custom price ignores weights and charges and prices no part.
        expect(
            PricedPiece(metalType = MetalType.gold, karat = KaratValue.k22, metalWeightG = 20.0, wastagePercentage = 10.0, makingCharges = 5000.0, isCustomPrice = true, customPrice = 125000.0),
            shop,
            metal = 0.0, wastage = 0.0, making = 0.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 125000.0,
        )
    }

    @Test
    fun testCustomPriceNotGivenIsZero() {
        // Custom price on and no figure: 0.
        expect(
            PricedPiece(metalType = MetalType.gold, karat = KaratValue.k22, metalWeightG = 20.0, isCustomPrice = true),
            shop,
            metal = 0.0, wastage = 0.0, making = 0.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 0.0,
        )
    }

    @Test
    fun testZeroRatesLeaveOnlyTheCharges() {
        // Gold at zero rates: no metal, no wastage; making, stones and sundries remain.
        expect(
            PricedPiece(metalType = MetalType.gold, karat = KaratValue.k21, metalWeightG = 10.0, wastagePercentage = 10.0, makingCharges = 4000.0, stoneCharges = 900.0, miscCharges = 100.0),
            zero,
            metal = 0.0, wastage = 0.0, making = 4000.0, diamonds = 0.0, stones = 900.0, misc = 100.0, total = 5000.0,
        )
    }

    @Test
    fun testStonesHeavierThanTheMetalClampToZero() {
        // Net weight is never negative: 2 g less 3 g of stones is no metal, and making still counts.
        expect(
            PricedPiece(metalType = MetalType.gold, karat = KaratValue.k21, metalWeightG = 2.0, stoneWeightG = 3.0, wastagePercentage = 10.0, makingCharges = 3500.0),
            shop,
            metal = 0.0, wastage = 0.0, making = 3500.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 3500.0,
        )
    }

    @Test
    fun testNegativeWeightClampsToZeroForGold() {
        // A negative gold weight is no metal.
        expect(
            PricedPiece(metalType = MetalType.gold, karat = KaratValue.k21, metalWeightG = -4.0, makingCharges = 1000.0),
            shop,
            metal = 0.0, wastage = 0.0, making = 1000.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 1000.0,
        )
    }

    @Test
    fun testAwkwardDecimalsPriceToTheLastBit() {
        // Weights and percentages that are not exact in binary: the sums must still agree with JavaScript to the last bit.
        expect(
            PricedPiece(metalType = MetalType.gold, karat = KaratValue.k21, metalWeightG = 7.777, stoneWeightG = 0.333, wastagePercentage = 9.35, makingCharges = 1234.56, hasDiamonds = true, diamondCharges = 0.1, stoneCharges = 0.2, miscCharges = 0.3),
            shop,
            metal = 270441.0, wastage = 25286.0, making = 1235.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 296962.0,
        )
    }

    @Test
    fun testUnreadableNumbersCountAsZero() {
        // NaN in a weight and a charge reads as 0 (Number(x) || 0).
        expect(
            PricedPiece(metalType = MetalType.gold, karat = KaratValue.k21, metalWeightG = Double.NaN, wastagePercentage = Double.NaN, makingCharges = Double.NaN, stoneCharges = 500.0),
            shop,
            metal = 0.0, wastage = 0.0, making = 0.0, diamonds = 0.0, stones = 500.0, misc = 0.0, total = 500.0,
        )
    }

    @Test
    fun testSilverTimesInfinityOverNoRateIsAnUnreadableLineSoNothing() {
        // Silver: an infinite weight at a rate of 0 is NaN, and a line that is not a number is 0 rupees
        // (rupees(NaN) is 0), so only the stones are left.
        expect(
            PricedPiece(metalType = MetalType.silver, metalWeightG = Double.POSITIVE_INFINITY, stoneCharges = 100.0),
            zero,
            metal = 0.0, wastage = 0.0, making = 0.0, diamonds = 0.0, stones = 100.0, misc = 0.0, total = 100.0,
        )
    }

    @Test
    fun testInfiniteChargesAreNotAmountsSoNothing() {
        // Gold: +Infinity making and -Infinity diamonds are not amounts; each line is rounded first, and an
        // infinite one is 0 rupees, so only the metal is left.
        expect(
            PricedPiece(metalType = MetalType.gold, karat = KaratValue.k21, metalWeightG = 5.0, makingCharges = Double.POSITIVE_INFINITY, hasDiamonds = true, diamondCharges = Double.NEGATIVE_INFINITY),
            shop,
            metal = 181650.0, wastage = 0.0, making = 0.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 181650.0,
        )
    }

    // MARK: A piece in each of the app's three models, priced as the web prices it

    @Test
    fun testAnInvoiceLineIsPricedAgainFromItsWeightsAndCharges() {
        // store.ts loadCartFromInvoice: the line's charges are the cart's.
        val item = invoiceItem(
            mapOf(
                "metalType" to "gold", "karat" to "22k", "metalWeightG" to 9.6, "stoneWeightG" to 0.4, "wastagePercentage" to 9,
                "makingCharges" to 7000, "stoneChargesIfAny" to 1800, "miscChargesIfAny" to 200, "unitPrice" to 1,
            ),
        )
        expect(PricedPiece(item), shop, metal = 350152.0, wastage = 31514.0, making = 7000.0, diamonds = 0.0, stones = 1800.0, misc = 200.0, total = 390666.0)
    }

    @Test
    fun testAFixedPriceInvoiceLineKeepsItsPrice() {
        val item = invoiceItem(
            mapOf(
                "metalType" to "gold", "karat" to "22k", "metalWeightG" to 9.6, "wastagePercentage" to 9,
                "makingCharges" to 7000, "isCustomPrice" to true, "unitPrice" to 91000,
            ),
        )
        expect(PricedPiece(item), shop, metal = 0.0, wastage = 0.0, making = 0.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 91000.0)
    }

    @Test
    fun testALineFromAnOrdersManualPriceKeepsItToo() {
        val item = invoiceItem(mapOf("metalType" to "gold", "karat" to "21k", "metalWeightG" to 5, "isManualPrice" to true, "unitPrice" to 56000))
        assertEquals(56000.0, price(PricedPiece(item), shop))
    }

    @Test
    fun testADiamondChargeOnALineMeansTheLineHasDiamondsEvenIfNeverTicked() {
        val item = invoiceItem(
            mapOf(
                "metalType" to "gold", "karat" to "21k", "metalWeightG" to 6.2, "wastagePercentage" to 10,
                "makingCharges" to 5000, "diamondChargesIfAny" to 40000,
            ),
        )
        assertTrue(PricedPiece(item).hasDiamonds)
        expect(PricedPiece(item), shop, metal = 225246.0, wastage = 22525.0, making = 5000.0, diamonds = 40000.0, stones = 0.0, misc = 0.0, total = 292771.0)
    }

    @Test
    fun testDiamondDetailsAloneFlagTheLineButChargeNothing() {
        val item = invoiceItem(mapOf("metalType" to "gold", "karat" to "21k", "metalWeightG" to 6.2, "wastagePercentage" to 10, "diamondDetails" to "  0.3 ct VS  "))
        assertTrue(PricedPiece(item).hasDiamonds)
        expect(PricedPiece(item), shop, metal = 225246.0, wastage = 22525.0, making = 0.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 247771.0)
        // Blank details flag nothing.
        val blank = invoiceItem(mapOf("metalType" to "gold", "karat" to "21k", "metalWeightG" to 6.2, "wastagePercentage" to 10, "diamondDetails" to "   "))
        assertFalse(PricedPiece(blank).hasDiamonds)
        assertEquals(247771.0, price(PricedPiece(blank), shop))
    }

    @Test
    fun testASilverLineKeepsItsOwnRate() {
        val item = invoiceItem(mapOf("metalType" to "silver", "metalWeightG" to 14.2, "silverRatePerGram" to 410, "stoneChargesIfAny" to 900))
        assertEquals(410.0, PricedPiece(item).silverRatePerGram)
        expect(PricedPiece(item), shop, metal = 5822.0, wastage = 0.0, making = 0.0, diamonds = 0.0, stones = 900.0, misc = 0.0, total = 6722.0)
        // A line with no rate of its own takes the shop's: 14.2 x 330.5 (4,693.1, so 4,693) + 900.
        val plain = invoiceItem(mapOf("metalType" to "silver", "metalWeightG" to 14.2, "stoneChargesIfAny" to 900))
        assertNull(PricedPiece(plain).silverRatePerGram)
        assertEquals(5593.0, price(PricedPiece(plain), shop))
    }

    @Test
    fun testAnOrderPieceIsPricedAsTheOrderFormPricesIt() {
        // order-form.tsx priceOfItem: the estimated weight, no category, no sundries.
        val item = orderItem(
            mapOf(
                "metalType" to "gold", "karat" to "18k", "estimatedWeightG" to 4.8, "stoneWeightG" to 0.2, "wastagePercentage" to 10,
                "makingCharges" to 6000, "hasDiamonds" to true, "diamondCharges" to 20000, "stoneCharges" to 1500,
            ),
        )
        expect(PricedPiece(item), shop, metal = 143244.0, wastage = 14324.0, making = 6000.0, diamonds = 20000.0, stones = 1500.0, misc = 0.0, total = 185068.0)
    }

    @Test
    fun testAnOrderPiecesManualPriceIsItsPrice() {
        val item = orderItem(mapOf("metalType" to "gold", "karat" to "18k", "estimatedWeightG" to 4.8, "isManualPrice" to true, "manualPrice" to 77000))
        assertEquals(77000.0, price(PricedPiece(item), shop))
    }

    @Test
    fun testAnOrderSilverPieceIgnoresItsWastageAndMaking() {
        val item = orderItem(mapOf("metalType" to "silver", "estimatedWeightG" to 20, "wastagePercentage" to 12, "makingCharges" to 500, "stoneCharges" to 250))
        expect(PricedPiece(item), shop, metal = 6610.0, wastage = 0.0, making = 0.0, diamonds = 0.0, stones = 250.0, misc = 0.0, total = 6860.0)
    }

    @Test
    fun testAnOrderPieceIsNeverACoin() {
        // The order form passes no category, so a gold coin ordered there still carries its wastage.
        assertNull(PricedPiece(orderItem(mapOf("metalType" to "gold", "karat" to "22k", "estimatedWeightG" to 8, "itemCategory" to "cat017"))).categoryId)
    }

    @Test
    fun testAStockedPieceWithASecondMetal() {
        val p = product(
            mapOf(
                "categoryId" to "cat004", "metalType" to "gold", "karat" to "21k", "metalWeightG" to 12,
                "secondaryMetalType" to "palladium", "secondaryMetalKarat" to "18k", "secondaryMetalWeightG" to 2.5,
                "wastagePercentage" to 7, "makingCharges" to 3000,
            ),
        )
        expect(PricedPiece(p), shop, metal = 473960.0, wastage = 33177.0, making = 3000.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 510137.0)
    }

    @Test
    fun testAStockedGoldCoinIsMetalAlone() {
        val p = product(
            mapOf(
                "categoryId" to "cat017", "metalType" to "gold", "karat" to "22k", "metalWeightG" to 8, "wastagePercentage" to 5,
                "makingCharges" to 900, "hasDiamonds" to true, "diamondCharges" to 100, "stoneCharges" to 5, "miscCharges" to 1,
            ),
        )
        expect(PricedPiece(p), shop, metal = 304480.0, wastage = 0.0, making = 0.0, diamonds = 0.0, stones = 0.0, misc = 0.0, total = 304480.0)
    }

    @Test
    fun testAStockedPieceAtACustomPrice() {
        val p = product(
            mapOf(
                "categoryId" to "cat004", "metalType" to "gold", "karat" to "22k", "metalWeightG" to 8, "wastagePercentage" to 5,
                "makingCharges" to 900, "isCustomPrice" to true, "customPrice" to 64500,
            ),
        )
        assertEquals(64500.0, price(PricedPiece(p), shop))
    }

    // MARK: The rate card

    @Test
    fun testARateCardFromARatesDocumentReadsWhatIsMissingAsNothing() {
        val rates = ERPDecode.model<Rates>(mapOf("goldRatePerGram21k" to 36330, "silverRatePerGram" to 330.5, "palladiumRatePerGram18k" to 15200))!!
        val card = PricingRates(rates)
        assertEquals(36330.0, card.goldRatePerGram21k)
        assertEquals(330.5, card.silverRatePerGram)
        assertEquals(15200.0, card.palladiumRatePerGram18k)
        assertEquals(0.0, card.goldRatePerGram24k)
        assertEquals(0.0, card.platinumRatePerGram)
        assertEquals(zero, PricingRates(Rates()))
    }

    @Test
    fun testARateCardFromTheSettingsHoldsAllNineRates() {
        val settings = ERPDecode.model<Settings>(
            mapOf(
                "goldRatePerGram24k" to 41520, "goldRatePerGram22k" to 38060, "goldRatePerGram21k" to 36330, "goldRatePerGram18k" to 31140,
                "palladiumRatePerGram" to 14500, "palladiumRatePerGram18k" to 15200, "palladiumRatePerGram12k" to 10100,
                "platinumRatePerGram" to 21000, "silverRatePerGram" to 330.5,
            ),
        )!!
        assertEquals(shop, PricingRates(settings))
        // N_pd18_perKarat, from the TypeScript: 10 g of 18k palladium is 152,000 at the per-karat rate, 145,000 at the flat one.
        val palladium = PricedPiece(metalType = MetalType.palladium, karat = KaratValue.k18, metalWeightG = 10.0)
        assertEquals(152000.0, price(palladium, PricingRates(settings)))
        assertEquals(145000.0, price(palladium, PricingRates(settings).flatPalladiumOnly))
        assertEquals(flatPalladium, PricingRates(settings).flatPalladiumOnly)
    }

    @Test
    fun testAnEmptyRateCardPricesNothing() {
        assertEquals(0.0, price(PricedPiece(metalType = MetalType.gold, karat = KaratValue.k21, metalWeightG = 10.0), PricingRates()))
        assertEquals(0.0, price(PricedPiece(metalType = MetalType.silver, metalWeightG = 10.0), PricingRates()))
        assertEquals(700.0, price(PricedPiece(metalType = MetalType.gold, karat = KaratValue.k21, metalWeightG = 10.0, makingCharges = 700.0), PricingRates()))
    }
}
