import XCTest
@testable import ERPCore

/// src/lib/pricing.ts. It has no test of its own, so every figure below was printed by the
/// TypeScript (`_calculateProductCostsInternal`, run with tsx) for the made-up piece beside it,
/// and is compared exactly, to the last bit: the Swift must add the same doubles in the same order.
/// All names, weights, rates and amounts are invented.
final class PricingTests: XCTestCase {
    // Rate cards (PKR a gram). `flatPalladium` is what `orderInvoiceRates` builds from the settings:
    // no per-karat palladium.
    private let shop = PricingRates(goldRatePerGram24k: 41520, goldRatePerGram22k: 38060, goldRatePerGram21k: 36330, goldRatePerGram18k: 31140, palladiumRatePerGram: 14500, palladiumRatePerGram18k: 15200, palladiumRatePerGram12k: 10100, platinumRatePerGram: 21000, silverRatePerGram: 330.5)
    private let zero = PricingRates(goldRatePerGram24k: 0, goldRatePerGram22k: 0, goldRatePerGram21k: 0, goldRatePerGram18k: 0, palladiumRatePerGram: 0, palladiumRatePerGram18k: 0, palladiumRatePerGram12k: 0, platinumRatePerGram: 0, silverRatePerGram: 0)
    private let flatPalladium = PricingRates(goldRatePerGram24k: 41520, goldRatePerGram22k: 38060, goldRatePerGram21k: 36330, goldRatePerGram18k: 31140, palladiumRatePerGram: 14500, palladiumRatePerGram18k: 0, palladiumRatePerGram12k: 0, platinumRatePerGram: 21000, silverRatePerGram: 330.5)
    private let perKaratOnly = PricingRates(goldRatePerGram24k: 41520, goldRatePerGram22k: 38060, goldRatePerGram21k: 36330, goldRatePerGram18k: 31140, palladiumRatePerGram: 0, palladiumRatePerGram18k: 15200, palladiumRatePerGram12k: 10100, platinumRatePerGram: 21000, silverRatePerGram: 330.5)
    private let silverHouse = PricingRates(goldRatePerGram24k: 0, goldRatePerGram22k: 0, goldRatePerGram21k: 0, goldRatePerGram18k: 0, palladiumRatePerGram: 0, palladiumRatePerGram18k: 0, palladiumRatePerGram12k: 0, platinumRatePerGram: 0, silverRatePerGram: 412.75)
    private let noPlatinum = PricingRates(goldRatePerGram24k: 41520, goldRatePerGram22k: 38060, goldRatePerGram21k: 36330, goldRatePerGram18k: 31140, palladiumRatePerGram: 14500, palladiumRatePerGram18k: 15200, palladiumRatePerGram12k: 10100, platinumRatePerGram: 0, silverRatePerGram: 330.5)

    private func expect(
        _ piece: PricedPiece, _ rates: PricingRates,
        metal: Double, wastage: Double, making: Double, diamonds: Double, stones: Double, misc: Double, total: Double,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        let c = calculateProductCosts(piece, rates)
        XCTAssertEqual(c.metalCost, metal, "metalCost", file: file, line: line)
        XCTAssertEqual(c.wastageCost, wastage, "wastageCost", file: file, line: line)
        XCTAssertEqual(c.makingCharges, making, "makingCharges", file: file, line: line)
        XCTAssertEqual(c.diamondCharges, diamonds, "diamondCharges", file: file, line: line)
        XCTAssertEqual(c.stoneCharges, stones, "stoneCharges", file: file, line: line)
        XCTAssertEqual(c.miscCharges, misc, "miscCharges", file: file, line: line)
        XCTAssertEqual(c.totalPrice, total, "totalPrice", file: file, line: line)
        XCTAssertEqual(calculateProductPrice(piece, rates), total, "calculateProductPrice", file: file, line: line)
    }

    private func price(_ piece: PricedPiece, _ rates: PricingRates) -> Double { calculateProductCosts(piece, rates).totalPrice }

    private func invoiceItem(_ fields: [String: Any]) -> InvoiceItem {
        var line: [String: Any] = ["sku": "X", "name": "X", "categoryId": "cat001", "quantity": 1]
        line.merge(fields) { _, new in new }
        return ERPDecode.model(InvoiceItem.self, from: line)!
    }

    private func orderItem(_ fields: [String: Any]) -> OrderItem {
        var item: [String: Any] = ["description": "Test piece"]
        item.merge(fields) { _, new in new }
        return ERPDecode.model(OrderItem.self, from: item)!
    }

    private func product(_ fields: [String: Any]) -> Product {
        var p: [String: Any] = ["sku": "P-0001", "name": "Test piece"]
        p.merge(fields) { _, new in new }
        return ERPDecode.model(Product.self, from: p)!
    }

    // MARK: Constants

    func testTheDefaultKaratAndTheCoinCategory() {
        XCTAssertEqual(DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL, .k21)
        XCTAssertEqual(GOLD_COIN_CATEGORY_ID_INTERNAL, "cat017")
    }

    // MARK: calculateProductCosts, against the TypeScript

    func testGold18kRingLessItsStone() {
        // Gold 18k: the metal is the weight less the stone (5.2 g - 0.3 g), wastage on that, then making and stone charge.
        expect(
            PricedPiece(metalType: .gold, karat: .k18, metalWeightG: 5.2, stoneWeightG: 0.3, wastagePercentage: 12, makingCharges: 8500, stoneCharges: 2500),
            shop,
            metal: 152586, wastage: 18310.32, making: 8500, diamonds: 0, stones: 2500, misc: 0, total: 181896.32
        )
    }

    func testGold21kBangle() {
        // Gold 21k, plain: weight x rate, 8% wastage, making.
        expect(
            PricedPiece(metalType: .gold, karat: .k21, metalWeightG: 24.75, wastagePercentage: 8, makingCharges: 12000),
            shop,
            metal: 899167.5, wastage: 71933.40000000001, making: 12000, diamonds: 0, stones: 0, misc: 0, total: 983100.9
        )
    }

    func testGold22kChainWithSundries() {
        // Gold 22k with a miscellaneous charge.
        expect(
            PricedPiece(metalType: .gold, karat: .k22, metalWeightG: 18.4, wastagePercentage: 6.5, makingCharges: 9000, miscCharges: 500),
            shop,
            metal: 700304, wastage: 45519.76, making: 9000, diamonds: 0, stones: 0, misc: 500, total: 755323.76
        )
    }

    func testGold24kNoWastageNoMaking() {
        // Gold 24k at its own rate, no wastage and no making.
        expect(
            PricedPiece(metalType: .gold, karat: .k24, metalWeightG: 11.664),
            shop,
            metal: 484289.27999999997, wastage: 0, making: 0, diamonds: 0, stones: 0, misc: 0, total: 484289.27999999997
        )
    }

    func testGoldWithNoKaratIsPricedAs21k() {
        // No karat recorded: 21k.
        expect(
            PricedPiece(metalType: .gold, metalWeightG: 9.9, wastagePercentage: 10, makingCharges: 4000),
            shop,
            metal: 359667, wastage: 35966.700000000004, making: 4000, diamonds: 0, stones: 0, misc: 0, total: 399633.7
        )
    }

    func testGoldWithAnEmptyKaratIsPricedAs21k() {
        // An empty karat is no karat (JavaScript: "" is falsy).
        expect(
            PricedPiece(metalType: .gold, karat: .unknown(""), metalWeightG: 9.9, wastagePercentage: 10, makingCharges: 4000),
            shop,
            metal: 359667, wastage: 35966.700000000004, making: 4000, diamonds: 0, stones: 0, misc: 0, total: 399633.7
        )
    }

    func testGoldInAKaratNobodySellsIsWorthNoMetal() {
        // A karat gold is not sold in has no rate: the metal is 0, the charges stand.
        expect(
            PricedPiece(metalType: .gold, karat: .unknown("20k"), metalWeightG: 8, wastagePercentage: 10, makingCharges: 3000),
            shop,
            metal: 0, wastage: 0, making: 3000, diamonds: 0, stones: 0, misc: 0, total: 3000
        )
    }

    func testGoldKaratIsCaseSensitive() {
        // "24K" is not "24k": no rate.
        expect(
            PricedPiece(metalType: .gold, karat: .unknown("24K"), metalWeightG: 8, makingCharges: 3000),
            shop,
            metal: 0, wastage: 0, making: 3000, diamonds: 0, stones: 0, misc: 0, total: 3000
        )
    }

    func testGoldCoinTakesTheMetalAlone() {
        // Category cat017 with gold: wastage, making, diamonds, stones and sundries are all dropped.
        expect(
            PricedPiece(categoryId: "cat017", metalType: .gold, karat: .k24, metalWeightG: 11.664, wastagePercentage: 5, makingCharges: 2000, hasDiamonds: true, diamondCharges: 9000, stoneCharges: 700, miscCharges: 300),
            shop,
            metal: 484289.27999999997, wastage: 0, making: 0, diamonds: 0, stones: 0, misc: 0, total: 484289.27999999997
        )
    }

    func testCoinCategoryInPalladiumIsNotACoin() {
        // The coin rule needs gold as well as the category.
        expect(
            PricedPiece(categoryId: "cat017", metalType: .palladium, karat: .k18, metalWeightG: 6, wastagePercentage: 5, makingCharges: 2000),
            shop,
            metal: 91200, wastage: 4560, making: 2000, diamonds: 0, stones: 0, misc: 0, total: 97760
        )
    }

    func testGoldWithDiamonds() {
        // Diamonds ticked: the diamond charge counts. A stone weight comes off the metal.
        expect(
            PricedPiece(metalType: .gold, karat: .k22, metalWeightG: 7.35, stoneWeightG: 0.42, wastagePercentage: 9, makingCharges: 15000, hasDiamonds: true, diamondCharges: 85000, stoneCharges: 4200),
            shop,
            metal: 263755.8, wastage: 23738.021999999997, making: 15000, diamonds: 85000, stones: 4200, misc: 0, total: 391693.822
        )
    }

    func testDiamondChargeIgnoredWhenNotTicked() {
        // A diamond charge without "has diamonds" is not counted (silver counts it regardless).
        expect(
            PricedPiece(metalType: .gold, karat: .k21, metalWeightG: 5, wastagePercentage: 10, makingCharges: 1000, hasDiamonds: false, diamondCharges: 4000),
            shop,
            metal: 181650, wastage: 18165, making: 1000, diamonds: 0, stones: 0, misc: 0, total: 200815
        )
    }

    func testGoldWithASecondMetalOfPlatinum() {
        // A platinum accent on a gold piece: its weight at the platinum rate joins the metal before wastage.
        expect(
            PricedPiece(metalType: .gold, karat: .k18, metalWeightG: 6.1, secondaryMetalType: .platinum, secondaryMetalWeightG: 1.8, wastagePercentage: 10, makingCharges: 7000),
            shop,
            metal: 227754, wastage: 22775.4, making: 7000, diamonds: 0, stones: 0, misc: 0, total: 257529.4
        )
    }

    func testGoldWithASecondMetalOfGold() {
        // A second gold at its own karat.
        expect(
            PricedPiece(metalType: .gold, karat: .k21, metalWeightG: 10, secondaryMetalType: .gold, secondaryMetalKarat: .k18, secondaryMetalWeightG: 2.2, wastagePercentage: 5),
            shop,
            metal: 431808, wastage: 21590.4, making: 0, diamonds: 0, stones: 0, misc: 0, total: 453398.4
        )
    }

    func testGoldWithASecondMetalOfSilverUsesTheShopsRate() {
        // A silver second metal takes the shop rate, never a product rate.
        expect(
            PricedPiece(metalType: .gold, karat: .k21, metalWeightG: 10, secondaryMetalType: .silver, secondaryMetalWeightG: 3, wastagePercentage: 5, silverRatePerGram: 999),
            shop,
            metal: 364291.5, wastage: 18214.575, making: 0, diamonds: 0, stones: 0, misc: 0, total: 382506.075
        )
    }

    func testSecondMetalWithNoWeightIsLeftOut() {
        // A second metal with 0 g adds nothing.
        expect(
            PricedPiece(metalType: .gold, karat: .k21, metalWeightG: 10, secondaryMetalType: .platinum, secondaryMetalWeightG: 0),
            shop,
            metal: 363300, wastage: 0, making: 0, diamonds: 0, stones: 0, misc: 0, total: 363300
        )
    }

    func testSecondMetalWeightLessThanZeroIsLeftOut() {
        // A negative second weight is clamped to 0.
        expect(
            PricedPiece(metalType: .gold, karat: .k21, metalWeightG: 10, secondaryMetalType: .platinum, secondaryMetalWeightG: -2),
            shop,
            metal: 363300, wastage: 0, making: 0, diamonds: 0, stones: 0, misc: 0, total: 363300
        )
    }

    func testSecondMetalOfAnUnknownKindIsWorthNothing() {
        // A metal the rate card does not know prices at 0.
        expect(
            PricedPiece(metalType: .gold, karat: .k21, metalWeightG: 10, secondaryMetalType: .unknown("copper"), secondaryMetalWeightG: 4),
            shop,
            metal: 363300, wastage: 0, making: 0, diamonds: 0, stones: 0, misc: 0, total: 363300
        )
    }

    func testSilverIsWeightTimesTheOneRate() {
        // Silver: weight x rate; wastage and making are bundled into the rate and ignored; stones, diamonds (ticked or not) and sundries added.
        expect(
            PricedPiece(metalType: .silver, metalWeightG: 12.5, stoneWeightG: 1.5, wastagePercentage: 15, makingCharges: 5000, diamondCharges: 2000, stoneCharges: 1200, miscCharges: 300),
            shop,
            metal: 4131.25, wastage: 0, making: 0, diamonds: 2000, stones: 1200, misc: 300, total: 7631.25
        )
    }

    func testSilverWithItsOwnRate() {
        // A silver piece with its own all-in rate beats the shop rate.
        expect(
            PricedPiece(metalType: .silver, metalWeightG: 12.5, stoneCharges: 1200, silverRatePerGram: 410),
            shop,
            metal: 5125, wastage: 0, making: 0, diamonds: 0, stones: 1200, misc: 0, total: 6325
        )
    }

    func testSilverWithItsOwnRateOfZeroTakesTheShops() {
        // A product rate of 0 falls back to the shop rate.
        expect(
            PricedPiece(metalType: .silver, metalWeightG: 12.5, silverRatePerGram: 0),
            shop,
            metal: 4131.25, wastage: 0, making: 0, diamonds: 0, stones: 0, misc: 0, total: 4131.25
        )
    }

    func testSilverWithNoRateAtAllIsOnlyItsCharges() {
        // No rate anywhere: the charges alone.
        expect(
            PricedPiece(metalType: .silver, metalWeightG: 12.5, stoneCharges: 1200, miscCharges: 300),
            zero,
            metal: 0, wastage: 0, making: 0, diamonds: 0, stones: 1200, misc: 300, total: 1500
        )
    }

    func testSilverOnASilverHouseRateCard() {
        // A silver house prices silver at its own rate, 412.75 a gram.
        expect(
            PricedPiece(metalType: .silver, metalWeightG: 7.3, miscCharges: 150),
            silverHouse,
            metal: 3013.075, wastage: 0, making: 0, diamonds: 0, stones: 0, misc: 150, total: 3163.075
        )
    }

    func testSilverWeightBelowZeroIsNotClamped() {
        // Silver does not clamp: a negative weight is a negative metal cost (the TS only clamps gold, platinum and palladium).
        expect(
            PricedPiece(metalType: .silver, metalWeightG: -2, stoneCharges: 100),
            shop,
            metal: -661, wastage: 0, making: 0, diamonds: 0, stones: 100, misc: 0, total: -561
        )
    }

    func testPalladium18kUsesItsOwnRate() {
        // Palladium 18k: the per-karat rate (15,200), not the flat one.
        expect(
            PricedPiece(metalType: .palladium, karat: .k18, metalWeightG: 8.8, wastagePercentage: 10, makingCharges: 6000),
            shop,
            metal: 133760, wastage: 13376, making: 6000, diamonds: 0, stones: 0, misc: 0, total: 153136
        )
    }

    func testPalladium12kUsesItsOwnRate() {
        // Palladium 12k: 10,100 a gram.
        expect(
            PricedPiece(metalType: .palladium, karat: .k12, metalWeightG: 8.8, wastagePercentage: 10, makingCharges: 6000),
            shop,
            metal: 88880, wastage: 8888, making: 6000, diamonds: 0, stones: 0, misc: 0, total: 103768
        )
    }

    func testPalladiumWithNoKaratTakesTheFlatRate() {
        // Palladium with no karat: the flat rate.
        expect(
            PricedPiece(metalType: .palladium, metalWeightG: 8.8, wastagePercentage: 10),
            shop,
            metal: 127600.00000000001, wastage: 12760.000000000002, making: 0, diamonds: 0, stones: 0, misc: 0, total: 140360.00000000003
        )
    }

    func testPalladium18kWithNoPerKaratRateFallsBackToFlat() {
        // A shop that has not filled the per-karat figures in must not price palladium at zero.
        expect(
            PricedPiece(metalType: .palladium, karat: .k18, metalWeightG: 8.8, wastagePercentage: 10),
            flatPalladium,
            metal: 127600.00000000001, wastage: 12760.000000000002, making: 0, diamonds: 0, stones: 0, misc: 0, total: 140360.00000000003
        )
    }

    func testPalladiumInAKaratWithNoRateOfItsOwnTakesFlat() {
        // Palladium at 21k: neither per-karat rate applies, so the flat one.
        expect(
            PricedPiece(metalType: .palladium, karat: .k21, metalWeightG: 8.8),
            shop,
            metal: 127600.00000000001, wastage: 0, making: 0, diamonds: 0, stones: 0, misc: 0, total: 127600.00000000001
        )
    }

    func testPalladiumWithOnlyPerKaratRatesAndNoKaratIsWorthNothing() {
        // No flat rate and no karat to pick a per-karat one: 0 metal.
        expect(
            PricedPiece(metalType: .palladium, metalWeightG: 8.8, makingCharges: 2000),
            perKaratOnly,
            metal: 0, wastage: 0, making: 2000, diamonds: 0, stones: 0, misc: 0, total: 2000
        )
    }

    func testPlatinumWithWastage() {
        // Platinum is metal x rate with wastage.
        expect(
            PricedPiece(metalType: .platinum, metalWeightG: 4.25, stoneWeightG: 0.25, wastagePercentage: 8, makingCharges: 10000, hasDiamonds: true, diamondCharges: 30000),
            shop,
            metal: 84000, wastage: 6720, making: 10000, diamonds: 30000, stones: 0, misc: 0, total: 130720
        )
    }

    func testPlatinumWithNoRateIsWorthNoMetal() {
        // No platinum rate: the metal is 0.
        expect(
            PricedPiece(metalType: .platinum, metalWeightG: 4.25, wastagePercentage: 8, makingCharges: 10000),
            noPlatinum,
            metal: 0, wastage: 0, making: 10000, diamonds: 0, stones: 0, misc: 0, total: 10000
        )
    }

    func testCustomPriceIsTheWholePrice() {
        // A custom price ignores weights and charges and prices no part.
        expect(
            PricedPiece(metalType: .gold, karat: .k22, metalWeightG: 20, wastagePercentage: 10, makingCharges: 5000, isCustomPrice: true, customPrice: 125000),
            shop,
            metal: 0, wastage: 0, making: 0, diamonds: 0, stones: 0, misc: 0, total: 125000
        )
    }

    func testCustomPriceNotGivenIsZero() {
        // Custom price on and no figure: 0.
        expect(
            PricedPiece(metalType: .gold, karat: .k22, metalWeightG: 20, isCustomPrice: true),
            shop,
            metal: 0, wastage: 0, making: 0, diamonds: 0, stones: 0, misc: 0, total: 0
        )
    }

    func testZeroRatesLeaveOnlyTheCharges() {
        // Gold at zero rates: no metal, no wastage; making, stones and sundries remain.
        expect(
            PricedPiece(metalType: .gold, karat: .k21, metalWeightG: 10, wastagePercentage: 10, makingCharges: 4000, stoneCharges: 900, miscCharges: 100),
            zero,
            metal: 0, wastage: 0, making: 4000, diamonds: 0, stones: 900, misc: 100, total: 5000
        )
    }

    func testStonesHeavierThanTheMetalClampToZero() {
        // Net weight is never negative: 2 g less 3 g of stones is no metal, and making still counts.
        expect(
            PricedPiece(metalType: .gold, karat: .k21, metalWeightG: 2, stoneWeightG: 3, wastagePercentage: 10, makingCharges: 3500),
            shop,
            metal: 0, wastage: 0, making: 3500, diamonds: 0, stones: 0, misc: 0, total: 3500
        )
    }

    func testNegativeWeightClampsToZeroForGold() {
        // A negative gold weight is no metal.
        expect(
            PricedPiece(metalType: .gold, karat: .k21, metalWeightG: -4, makingCharges: 1000),
            shop,
            metal: 0, wastage: 0, making: 1000, diamonds: 0, stones: 0, misc: 0, total: 1000
        )
    }

    func testAwkwardDecimalsPriceToTheLastBit() {
        // Weights and percentages that are not exact in binary: the sums must still agree with JavaScript to the last bit.
        expect(
            PricedPiece(metalType: .gold, karat: .k21, metalWeightG: 7.777, stoneWeightG: 0.333, wastagePercentage: 9.35, makingCharges: 1234.56, hasDiamonds: true, diamondCharges: 0.1, stoneCharges: 0.2, miscCharges: 0.3),
            shop,
            metal: 270440.52, wastage: 25286.18862, making: 1234.56, diamonds: 0.1, stones: 0.2, misc: 0.3, total: 296961.86862
        )
    }

    func testUnreadableNumbersCountAsZero() {
        // NaN in a weight and a charge reads as 0 (Number(x) || 0).
        expect(
            PricedPiece(metalType: .gold, karat: .k21, metalWeightG: .nan, wastagePercentage: .nan, makingCharges: .nan, stoneCharges: 500),
            shop,
            metal: 0, wastage: 0, making: 0, diamonds: 0, stones: 500, misc: 0, total: 500
        )
    }

    func testSilverTimesInfinityOverNoRateIsNaNSoNothing() {
        // The NaN guard (silver): an infinite weight at a rate of 0 is NaN, and a NaN price comes back as all zeros.
        expect(
            PricedPiece(metalType: .silver, metalWeightG: .infinity, stoneCharges: 100),
            zero,
            metal: 0, wastage: 0, making: 0, diamonds: 0, stones: 0, misc: 0, total: 0
        )
    }

    func testInfiniteChargesThatCancelAreNaNSoNothing() {
        // The NaN guard (gold): +Infinity making and -Infinity diamonds sum to NaN; the answer is all zeros.
        expect(
            PricedPiece(metalType: .gold, karat: .k21, metalWeightG: 5, makingCharges: .infinity, hasDiamonds: true, diamondCharges: -.infinity),
            shop,
            metal: 0, wastage: 0, making: 0, diamonds: 0, stones: 0, misc: 0, total: 0
        )
    }

    // MARK: A piece in each of the app's three models, priced as the web prices it

    func testAnInvoiceLineIsPricedAgainFromItsWeightsAndCharges() {
        // store.ts loadCartFromInvoice: the line's charges are the cart's.
        let item = invoiceItem(["metalType": "gold", "karat": "22k", "metalWeightG": 9.6, "stoneWeightG": 0.4, "wastagePercentage": 9,
                                "makingCharges": 7000, "stoneChargesIfAny": 1800, "miscChargesIfAny": 200, "unitPrice": 1])
        expect(PricedPiece(item), shop,
               metal: 350152, wastage: 31513.68, making: 7000, diamonds: 0, stones: 1800, misc: 200, total: 390665.68)
    }

    func testAFixedPriceInvoiceLineKeepsItsPrice() {
        let item = invoiceItem(["metalType": "gold", "karat": "22k", "metalWeightG": 9.6, "wastagePercentage": 9,
                                "makingCharges": 7000, "isCustomPrice": true, "unitPrice": 91000])
        expect(PricedPiece(item), shop, metal: 0, wastage: 0, making: 0, diamonds: 0, stones: 0, misc: 0, total: 91000)
    }

    func testALineFromAnOrdersManualPriceKeepsItToo() {
        let item = invoiceItem(["metalType": "gold", "karat": "21k", "metalWeightG": 5, "isManualPrice": true, "unitPrice": 56000])
        XCTAssertEqual(price(PricedPiece(item), shop), 56000)
    }

    func testADiamondChargeOnALineMeansTheLineHasDiamondsEvenIfNeverTicked() {
        let item = invoiceItem(["metalType": "gold", "karat": "21k", "metalWeightG": 6.2, "wastagePercentage": 10,
                                "makingCharges": 5000, "diamondChargesIfAny": 40000])
        XCTAssertTrue(PricedPiece(item).hasDiamonds)
        expect(PricedPiece(item), shop,
               metal: 225246, wastage: 22524.600000000002, making: 5000, diamonds: 40000, stones: 0, misc: 0, total: 292770.6)
    }

    func testDiamondDetailsAloneFlagTheLineButChargeNothing() {
        let item = invoiceItem(["metalType": "gold", "karat": "21k", "metalWeightG": 6.2, "wastagePercentage": 10, "diamondDetails": "  0.3 ct VS  "])
        XCTAssertTrue(PricedPiece(item).hasDiamonds)
        expect(PricedPiece(item), shop,
               metal: 225246, wastage: 22524.600000000002, making: 0, diamonds: 0, stones: 0, misc: 0, total: 247770.6)
        // Blank details flag nothing.
        let blank = invoiceItem(["metalType": "gold", "karat": "21k", "metalWeightG": 6.2, "wastagePercentage": 10, "diamondDetails": "   "])
        XCTAssertFalse(PricedPiece(blank).hasDiamonds)
        XCTAssertEqual(price(PricedPiece(blank), shop), 247770.6)
    }

    func testASilverLineKeepsItsOwnRate() {
        let item = invoiceItem(["metalType": "silver", "metalWeightG": 14.2, "silverRatePerGram": 410, "stoneChargesIfAny": 900])
        XCTAssertEqual(PricedPiece(item).silverRatePerGram, 410)
        expect(PricedPiece(item), shop, metal: 5822, wastage: 0, making: 0, diamonds: 0, stones: 900, misc: 0, total: 6722)
        // A line with no rate of its own takes the shop's: 14.2 x 330.5 + 900.
        let plain = invoiceItem(["metalType": "silver", "metalWeightG": 14.2, "stoneChargesIfAny": 900])
        XCTAssertNil(PricedPiece(plain).silverRatePerGram)
        XCTAssertEqual(price(PricedPiece(plain), shop), 14.2 * 330.5 + 900)
    }

    func testAnOrderPieceIsPricedAsTheOrderFormPricesIt() {
        // order-form.tsx priceOfItem: the estimated weight, no category, no sundries.
        let item = orderItem(["metalType": "gold", "karat": "18k", "estimatedWeightG": 4.8, "stoneWeightG": 0.2, "wastagePercentage": 10,
                              "makingCharges": 6000, "hasDiamonds": true, "diamondCharges": 20000, "stoneCharges": 1500])
        expect(PricedPiece(item), shop,
               metal: 143244, wastage: 14324.400000000001, making: 6000, diamonds: 20000, stones: 1500, misc: 0, total: 185068.4)
    }

    func testAnOrderPiecesManualPriceIsItsPrice() {
        let item = orderItem(["metalType": "gold", "karat": "18k", "estimatedWeightG": 4.8, "isManualPrice": true, "manualPrice": 77000])
        XCTAssertEqual(price(PricedPiece(item), shop), 77000)
    }

    func testAnOrderSilverPieceIgnoresItsWastageAndMaking() {
        let item = orderItem(["metalType": "silver", "estimatedWeightG": 20, "wastagePercentage": 12, "makingCharges": 500, "stoneCharges": 250])
        expect(PricedPiece(item), shop, metal: 6610, wastage: 0, making: 0, diamonds: 0, stones: 250, misc: 0, total: 6860)
    }

    func testAnOrderPieceIsNeverACoin() {
        // The order form passes no category, so a gold coin ordered there still carries its wastage.
        XCTAssertNil(PricedPiece(orderItem(["metalType": "gold", "karat": "22k", "estimatedWeightG": 8, "itemCategory": "cat017"])).categoryId)
    }

    func testAStockedPieceWithASecondMetal() {
        let p = product(["categoryId": "cat004", "metalType": "gold", "karat": "21k", "metalWeightG": 12,
                         "secondaryMetalType": "palladium", "secondaryMetalKarat": "18k", "secondaryMetalWeightG": 2.5,
                         "wastagePercentage": 7, "makingCharges": 3000])
        expect(PricedPiece(p), shop,
               metal: 473960, wastage: 33177.200000000004, making: 3000, diamonds: 0, stones: 0, misc: 0, total: 510137.2)
    }

    func testAStockedGoldCoinIsMetalAlone() {
        let p = product(["categoryId": "cat017", "metalType": "gold", "karat": "22k", "metalWeightG": 8, "wastagePercentage": 5,
                         "makingCharges": 900, "hasDiamonds": true, "diamondCharges": 100, "stoneCharges": 5, "miscCharges": 1])
        expect(PricedPiece(p), shop, metal: 304480, wastage: 0, making: 0, diamonds: 0, stones: 0, misc: 0, total: 304480)
    }

    func testAStockedPieceAtACustomPrice() {
        let p = product(["categoryId": "cat004", "metalType": "gold", "karat": "22k", "metalWeightG": 8, "wastagePercentage": 5,
                         "makingCharges": 900, "isCustomPrice": true, "customPrice": 64500])
        XCTAssertEqual(price(PricedPiece(p), shop), 64500)
    }

    // MARK: The rate card

    func testARateCardFromARatesDocumentReadsWhatIsMissingAsNothing() {
        let rates = ERPDecode.model(Rates.self, from: ["goldRatePerGram21k": 36330, "silverRatePerGram": 330.5, "palladiumRatePerGram18k": 15200])!
        let card = PricingRates(rates)
        XCTAssertEqual(card.goldRatePerGram21k, 36330)
        XCTAssertEqual(card.silverRatePerGram, 330.5)
        XCTAssertEqual(card.palladiumRatePerGram18k, 15200)
        XCTAssertEqual(card.goldRatePerGram24k, 0)
        XCTAssertEqual(card.platinumRatePerGram, 0)
        XCTAssertEqual(PricingRates(Rates()), zero)
    }

    func testARateCardFromTheSettingsHoldsAllNineRates() {
        let settings = ERPDecode.model(Settings.self, from: [
            "goldRatePerGram24k": 41520, "goldRatePerGram22k": 38060, "goldRatePerGram21k": 36330, "goldRatePerGram18k": 31140,
            "palladiumRatePerGram": 14500, "palladiumRatePerGram18k": 15200, "palladiumRatePerGram12k": 10100,
            "platinumRatePerGram": 21000, "silverRatePerGram": 330.5,
        ])!
        XCTAssertEqual(PricingRates(settings), shop)
        // N_pd18_perKarat, from the TypeScript: 10 g of 18k palladium is 152,000 at the per-karat rate, 145,000 at the flat one.
        let palladium = PricedPiece(metalType: .palladium, karat: .k18, metalWeightG: 10)
        XCTAssertEqual(price(palladium, PricingRates(settings)), 152000)
        XCTAssertEqual(price(palladium, PricingRates(settings).flatPalladiumOnly), 145000)
        XCTAssertEqual(PricingRates(settings).flatPalladiumOnly, flatPalladium)
    }

    func testAnEmptyRateCardPricesNothing() {
        XCTAssertEqual(price(PricedPiece(metalType: .gold, karat: .k21, metalWeightG: 10), PricingRates()), 0)
        XCTAssertEqual(price(PricedPiece(metalType: .silver, metalWeightG: 10), PricingRates()), 0)
        XCTAssertEqual(price(PricedPiece(metalType: .gold, karat: .k21, metalWeightG: 10, makingCharges: 700), PricingRates()), 700)
    }
}
