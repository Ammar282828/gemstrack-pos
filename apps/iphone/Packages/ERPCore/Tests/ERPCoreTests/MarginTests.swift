import XCTest
@testable import ERPCore

/// src/lib/margin.test.ts, case for case (Taheri's settings, the code's default).
final class MarginTests: XCTestCase {
    private func invoice(_ fields: [String: Any]) -> Invoice { ERPDecode.model(Invoice.self, from: fields)! }
    private func order(_ fields: [String: Any]) -> Order { ERPDecode.model(Order.self, from: fields)! }

    /// Jest's `toBeCloseTo(expected, digits)`: within 10^-digits / 2.
    private func assertClose(_ a: Double, _ b: Double, _ digits: Int, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(a, b, accuracy: 0.5 * pow(10, -Double(digits)), file: file, line: line)
    }

    // MARK: what the shop earns

    func testCostsAGramOfJewelleryAtThe24kRateLess6Ratti() {
        assertClose(goldCostPerGram(38538), 36129.375, 3)
    }

    func testWorksOutASaleFromThe24kRateTypedWhenItWasMade() {
        // 10 g of 21k at 34,000 + 10% wastage + 15,500 making = 389,500; cost 10 × 36,129.375.
        let m = invoiceMargin(invoice([
            "items": [["metalType": "gold", "karat": "21k", "metalWeightG": 10, "stoneWeightG": 0, "quantity": 1, "itemTotal": 389500]],
            "subtotal": 389500, "discountAmount": 0, "costRate24k": 38538,
        ]))
        XCTAssertFalse(m.assumed)
        assertClose(m.cost, 361293.75, 2)
        assertClose(m.percent, 7.2417, 3)
        XCTAssertEqual(percentLabel(m), "7.2%")
    }

    func testAssumes10PercentWithoutA24kRateEverySaleRecordedBefore() {
        let m = invoiceMargin(invoice(["items": [["metalType": "gold", "metalWeightG": 10, "itemTotal": 389500]], "subtotal": 389500]))
        XCTAssertTrue(m.assumed)
        XCTAssertEqual(m.percent, 10)
        assertClose(m.profit, 38950, 6)
    }

    func testTakesTheDiscountOffWhatWasEarnedAndStonesAndDiamondsAtWhatTheyWereCharged() {
        let m = invoiceMargin(invoice([
            "items": [["metalType": "gold", "karat": "21k", "metalWeightG": 10.5, "stoneWeightG": 0.5, "quantity": 1, "itemTotal": 440000, "stoneChargesIfAny": 50000]],
            "subtotal": 440000, "discountAmount": 10000, "costRate24k": 38538,
        ]))
        // Cost: 10 g × 36,129.375 + 50,000 stones = 411,293.75; worth 430,000.
        assertClose(m.cost, 411293.75, 2)
        assertClose(m.profit, 18706.25, 2)
    }

    func testTakesAPieceItCannotCostNoWeightNotGoldAt10PercentAndSaysHowMuchWasCosted() {
        let m = marginOf([
            MarginLine(metalType: "gold", karat: "21k", weightG: 10, price: 389500),
            MarginLine(metalType: "gold", weightG: 0, price: 100000),
        ], revenue: 489500, rate24k: 38538)
        assertClose(m.cost, 361293.75 + 90000, 2)
        assertClose(m.costedShare, 389500 / 489500, 6)
    }

    func testPricesAnOrderFromItsAgreedOrEstimatedPiecesOrTheLiveFiguresOnTheForm() {
        let fields: [String: Any] = [
            "items": [["metalType": "gold", "karat": "21k", "estimatedWeightG": 10, "stoneWeightG": 0, "totalEstimate": 389500]],
            "subtotal": 389500, "costRate24k": 38538,
        ]
        assertClose(orderMargin(order(fields)).percent, 7.2417, 3)
        assertClose(orderMargin(order(fields), prices: [400000]).percent, (400000 - 361293.75) / 400000 * 100, 6)
        var noRate = fields
        noRate["costRate24k"] = nil
        XCTAssertEqual(orderMargin(order(noRate)).percent, 10)
    }

    // MARK: a fixed price with its weight (2026-10-07)

    private let rate = 38538.0 // 10 g costs 361,293.75

    func testPlainGoldAtAFixedPriceIsCostedFromItsGold() {
        let m = invoiceMargin(invoice([
            "items": [["metalType": "gold", "karat": "21k", "metalWeightG": 10, "itemTotal": 400000, "isCustomPrice": true]],
            "subtotal": 400000, "costRate24k": rate,
        ]))
        XCTAssertFalse(m.assumed)
        XCTAssertEqual(m.costedShare, 1)
        assertClose(m.cost, 361293.75, 2)
    }

    func testWithDiamondsOrStonesInThePriceStaysAt10PercentTheirCostIsWrittenNowhere() {
        let extras: [[String: Any]] = [["hasDiamonds": true], ["diamondDetails": "0.5ct round"], ["stoneDetails": "4 rubies"], ["stoneWeightG": 0.4], ["hasStones": true]]
        for extra in extras {
            var item: [String: Any] = ["metalType": "gold", "karat": "18k", "metalWeightG": 4, "itemTotal": 500000, "isCustomPrice": true]
            item.merge(extra) { _, new in new }
            let m = invoiceMargin(invoice(["items": [item], "subtotal": 500000, "costRate24k": rate]))
            XCTAssertEqual(m.costedShare, 0, "\(extra)")
            assertClose(m.percent, 10, 6)
        }
    }

    func testAPiecePricedByWeightWithStonesIsStillCostedItsChargesAreOnIt() {
        let m = invoiceMargin(invoice([
            "items": [["metalType": "gold", "karat": "21k", "metalWeightG": 10, "itemTotal": 440000, "stoneChargesIfAny": 50000, "stoneDetails": "4 rubies"]],
            "subtotal": 440000, "costRate24k": rate,
        ]))
        XCTAssertEqual(m.costedShare, 1)
    }

    func testAnOrderAtAFixedPriceWithDiamondsStaysAt10Percent() {
        let m = orderMargin(order([
            "items": [["metalType": "gold", "karat": "18k", "estimatedWeightG": 4, "isManualPrice": true, "manualPrice": 500000, "hasDiamonds": true]],
            "costRate24k": rate,
        ]))
        XCTAssertEqual(m.costedShare, 0)
    }

    // MARK: not in the TS tests

    func testAGoldCoinIsCostedAtItsOwnKaratNotJewelleryCost() {
        // 10 g of 22k pure metal at 38,538: 38,538 × 22 / 24 a gram.
        let coin = invoice([
            "items": [["metalType": "gold", "karat": "22k", "metalWeightG": 10, "itemTotal": 360000, "categoryId": "cat017"]],
            "subtotal": 360000, "costRate24k": 38538,
        ])
        assertClose(invoiceMargin(coin).cost, 38538 * 22 / 24 * 10, 6)
        // The line's quantity multiplies the cost of one piece; a fixed price is not multiplied.
        let two = marginOf([MarginLine(metalType: "gold", karat: "21k", weightG: 5, quantity: 2, price: 400000)], revenue: 400000, rate24k: 38538)
        assertClose(two.cost, 5 * 36129.375 * 2, 6)
        let unweighed = lineCost(MarginLine(metalType: "silver", weightG: 5, quantity: 2, price: 1000), rate24k: 38538)
        XCTAssertEqual(unweighed, LineCost(cost: 900, costed: false))
    }

    func testMinaDoesNotCostByGoldAndAssumes40Percent() {
        let sale = invoice([
            "items": [["metalType": "gold", "karat": "21k", "metalWeightG": 10, "itemTotal": 389500]],
            "subtotal": 389500, "costRate24k": 38538,
        ])
        let m = invoiceMargin(sale, settings: .mina)
        XCTAssertTrue(m.assumed)
        XCTAssertEqual(m.percent, 40)
        assertClose(m.profit, 389500 * 0.4, 6)
    }

    func testTheHousesVariablesAreReadAsTheEnvironmentReadsThem() {
        XCTAssertEqual(MarginSettings.parse(costRattiLess: nil, estMargin: nil), .taheri)
        XCTAssertEqual(MarginSettings.parse(costRattiLess: "", estMargin: ""), .taheri)
        XCTAssertEqual(MarginSettings.parse(costRattiLess: "none", estMargin: "0.40"), .mina)
        XCTAssertEqual(MarginSettings.parse(costRattiLess: " 4 ", estMargin: "0.25"), MarginSettings(rattiLess: 4, assumedMargin: 0.25))
        // Out of range falls back: ratti off, margin 10%.
        XCTAssertEqual(MarginSettings.parse(costRattiLess: "96", estMargin: "1"), MarginSettings(rattiLess: nil, assumedMargin: 0.10))
        XCTAssertEqual(MarginSettings.parse(costRattiLess: "0", estMargin: "0"), MarginSettings(rattiLess: 0, assumedMargin: 0))
    }

    func testPercentLabelIsOneDecimalUnder10AndNoneAbove() {
        func label(_ p: Double) -> String { percentLabel(Margin(percent: p, revenue: 0, cost: 0, profit: 0, assumed: false, costedShare: 0)) }
        XCTAssertEqual(label(7.2417), "7.2%")
        XCTAssertEqual(label(7.25), "7.3%") // toFixed: a tie goes up
        XCTAssertEqual(label(10), "10%")
        XCTAssertEqual(label(18.2), "18%")
        XCTAssertEqual(label(18.5), "19%")
        XCTAssertEqual(label(-12.5), "-12%") // Math.round: halves go up
        XCTAssertEqual(label(-3.04), "-3.0%")
        XCTAssertEqual(label(0), "0.0%")
    }
}
