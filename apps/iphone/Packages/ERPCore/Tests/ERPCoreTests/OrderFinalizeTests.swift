import XCTest
@testable import ERPCore

/// src/lib/order-finalize.test.ts, case for case.
final class OrderFinalizeTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ fields: [String: Any]) -> T { ERPDecode.model(type, from: fields)! }

    /// Jest's `toBeCloseTo(expected, digits)`: within 10^-digits / 2.
    private func assertClose(_ a: Double, _ b: Double, _ digits: Int, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(a, b, accuracy: 0.5 * pow(10, -Double(digits)), file: file, line: line)
    }

    // `orderInvoiceRates({} as Pick<Order, 'ratesApplied'>, settings)`: an order with no rates kept takes today's.
    private lazy var rates: InvoiceRates = orderInvoiceRates(
        decode(Order.self, [:]),
        decode(Settings.self, [
            "goldRatePerGram24k": 0, "goldRatePerGram22k": 0, "goldRatePerGram21k": 34000, "goldRatePerGram18k": 0,
            "palladiumRatePerGram": 0, "platinumRatePerGram": 0, "silverRatePerGram": 300,
        ])
    )

    private lazy var ring: OrderItem = decode(OrderItem.self, [
        "description": "Ruby ring", "metalType": "gold", "karat": "21k", "estimatedWeightG": 6, "stoneWeightG": 0, "hasStones": false,
        "wastagePercentage": 12, "makingCharges": 10000, "diamondCharges": 0, "stoneCharges": 0, "hasDiamonds": false,
        "sampleGiven": false, "isCompleted": true,
    ])

    private func typed(
        wastage: Double? = 10, diamonds: Double = 0, manual: Bool = false, manualPrice: Double? = nil
    ) -> FinalizedItem {
        FinalizedItem(
            description: "Ruby ring", metalType: .gold, karat: .k21, finalWeightG: 6.5, finalWastagePercentage: wastage,
            finalMakingCharges: 15000, finalDiamondCharges: diamonds, finalStoneCharges: 0,
            isManualPrice: manual, finalManualPrice: manualPrice
        )
    }

    func testPricesThePieceAtTheWastageAndMakingTypedNotTheOrders() {
        // 6.5 g × 34,000 = 221,000; 10% wastage 22,100; making 15,000.
        let c = finalizedItemCosts(ring, typed(), rates)
        XCTAssertEqual(c.price, 258100)
        XCTAssertEqual(c.wastagePercentage, 10)
        XCTAssertEqual(c.makingCharges, 15000)
    }

    func testKeepsTheOrdersWastageWhenNoneIsSent() {
        XCTAssertEqual(finalizedItemCosts(ring, typed(wastage: nil), rates).wastagePercentage, 12)
    }

    func testCountsADiamondChargeTypedHereEvenIfTheOrderNeverTickedDiamonds() {
        XCTAssertEqual(finalizedItemCosts(ring, typed(diamonds: 50000), rates).price, 308100)
    }

    func testTakesAFixedPriceAsItIs() {
        XCTAssertEqual(finalizedItemCosts(ring, typed(manual: true, manualPrice: 99000), rates).price, 99000)
    }

    func testTurnsTheKarigarsGramsIntoThePercentageAndBackOnTheMetalLessItsStones() {
        XCTAssertEqual(wastagePercentFor(0.65, 6.5), 10)
        assertClose(wastageGramsFor(10, 6.5), 0.65, 6)
        XCTAssertEqual(wastagePercentFor(0.62, 6.5, 0.3), 10)
        XCTAssertEqual(wastagePercentFor(0.5, 0), 0)
        assertClose(wastageGramsFor(wastagePercentFor(0.65, 6.37), 6.37), 0.65, 6)
        // 2 g typed on 20.3 g at 35,000/g is 70,000 of wastage, to the rupee.
        XCTAssertEqual(JS.round(20.3 * 35000 * wastagePercentFor(2, 20.3) / 100), 70000)
    }

    // MARK: Beyond the TypeScript's own cases (figures printed by the TypeScript)

    func testAFixedPriceKeepsTheOrdersWastagePercentageAndPricesNoPart() {
        let c = finalizedItemCosts(ring, typed(manual: true, manualPrice: 99000), rates)
        XCTAssertEqual(c.wastagePercentage, 12)
        XCTAssertEqual(c.metalCost, 0)
        XCTAssertEqual(c.wastageCost, 0)
        XCTAssertEqual(c.makingCharges, 0)
    }

    func testSilverIsItsWeightAtTheOneRateWhateverWastageAndMakingAreTyped() {
        let silver = decode(OrderItem.self, ["description": "Silver bangle", "metalType": "silver", "estimatedWeightG": 10, "wastagePercentage": 15])
        let f = FinalizedItem(description: "Silver bangle", metalType: .silver, finalWeightG: 10.5, finalWastagePercentage: 20,
                              finalMakingCharges: 4000, finalDiamondCharges: 0, finalStoneCharges: 600)
        let c = finalizedItemCosts(silver, f, rates)
        // 10.5 g × 300 + 600 of stones; wastage and making are not part of silver's price.
        XCTAssertEqual(c.price, 3750)
        XCTAssertEqual(c.metalCost, 3150)
        XCTAssertEqual(c.wastageCost, 0)
        XCTAssertEqual(c.makingCharges, 0)
        XCTAssertEqual(c.stoneCharges, 600)
        XCTAssertEqual(c.wastagePercentage, 20)
        XCTAssertFalse(takesWastageAndMaking(.silver))
        XCTAssertTrue(takesWastageAndMaking(.gold))
        XCTAssertTrue(takesWastageAndMaking(.palladium))
    }

    func testAnOrderKeepsTheRatesItWasBookedAtNotTodays() {
        let order = decode(Order.self, ["ratesApplied": ["goldRatePerGram21k": 30000, "silverRatePerGram": 250]])
        let settings = decode(Settings.self, ["goldRatePerGram21k": 34000, "silverRatePerGram": 300, "palladiumRatePerGram": 14500, "palladiumRatePerGram18k": 15200])
        let booked = orderInvoiceRates(order, settings)
        XCTAssertEqual(booked.goldRatePerGram21k, 30000)
        XCTAssertEqual(booked.silverRatePerGram, 250)
        // 6.5 g × 30,000 = 195,000; 10% wastage 19,500; making 15,000.
        XCTAssertEqual(finalizedItemCosts(ring, typed(), booked).price, 229500)
    }

    func testAnOrderWithNoRatesKeptTakesTodaysSevenWithPalladiumFlat() {
        let settings = decode(Settings.self, [
            "goldRatePerGram24k": 41520, "goldRatePerGram21k": 34000, "palladiumRatePerGram": 14500,
            "palladiumRatePerGram18k": 15200, "palladiumRatePerGram12k": 10100, "platinumRatePerGram": 21000, "silverRatePerGram": 300,
        ])
        let today = orderInvoiceRates(decode(Order.self, [:]), settings)
        XCTAssertEqual(today.goldRatePerGram24k, 41520)
        XCTAssertEqual(today.platinumRatePerGram, 21000)
        // The TS copies seven rates; the two per-karat palladium ones are not among them.
        XCTAssertEqual(today.palladiumRatePerGram, 14500)
        XCTAssertEqual(today.palladiumRatePerGram18k, 0)
        XCTAssertEqual(today.palladiumRatePerGram12k, 0)
        XCTAssertEqual(orderInvoiceRates(ratesApplied: nil, settings), today)
    }

    func testTheNetMetalIsNeverBelowZero() {
        XCTAssertEqual(netMetalG(6.5), 6.5)
        XCTAssertEqual(netMetalG(6.5, 0.3), 6.2)
        XCTAssertEqual(netMetalG(2, 3), 0)
        XCTAssertEqual(netMetalG(.nan, 1), 0)
        XCTAssertEqual(wastageGramsFor(10, 6.5, 0.3), 0.62, accuracy: 1e-12)
    }
}
