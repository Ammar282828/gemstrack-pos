import XCTest
@testable import ERPCore

/// src/lib/money-round.test.ts case for case (its input -> output tables included), and the whole-rupee
/// cases of src/lib/money.test.ts. Amounts are made up.
final class MoneyRoundTests: XCTestCase {
    private func pairs(_ offers: [RoundOffOffer]) -> [[Double]] { offers.map { [$0.target, $0.extra] } }

    // MARK: roundOffOffers

    func testOffersTheRoundDownsCoarsestFirstAtMostThree() {
        XCTAssertEqual(pairs(roundOffOffers(272_340)), [[270_000, 2_340], [272_000, 340], [272_300, 40]])
        XCTAssertEqual(pairs(roundOffOffers(99_999)), [[95_000, 4_999], [99_000, 999], [99_500, 499]])
        XCTAssertEqual(roundOffOffers(271_050).map(\.target), [270_000, 271_000])
    }

    func testTakesTheThreeRoundestWhenMoreQualify() {
        // 10000/5000 -> 270,000, 1000 -> 273,000, 500 -> 273,500, 100 -> 273,600
        let o = roundOffOffers(273_640)
        XCTAssertEqual(o.count, 3)
        XCTAssertEqual(o.map(\.target), [270_000, 273_000, 273_500])
    }

    func testDedupesStepsThatLandOnTheSameTarget() {
        let o = roundOffOffers(12_300) // 100 -> itself (round), 5000/10000 -> 10,000, 500/1000 -> 12,000
        XCTAssertEqual(o.map(\.target), [10_000, 12_000])
        XCTAssertEqual(o[1].extra, 300)
    }

    func testOffersNothingForATotalThatIsAlreadyRound() {
        XCTAssertEqual(roundOffOffers(270_000), [])
        XCTAssertEqual(roundOffOffers(100), [])
    }

    func testOffersNothingUnder100RoundingDownWouldGiveTheBillAway() {
        XCTAssertEqual(roundOffOffers(99), [])
        XCTAssertEqual(roundOffOffers(1), [])
        XCTAssertEqual(roundOffOffers(0), [])
    }

    func testHandlesASmallBillWithARealRoundTarget() {
        XCTAssertEqual(pairs(roundOffOffers(1_234)), [[1_000, 234], [1_200, 34]])
    }

    func testDrawsTheLineAt5000UnderIsACandidate5000ItselfNeverIs() {
        // 9,999 is 4,999 over 5,000: the coarsest step is offered first.
        XCTAssertEqual(pairs(roundOffOffers(9_999)), [[5_000, 4_999], [9_000, 999], [9_500, 499]])
        // 15,000 and 5,000 are round: the next step down would cost exactly 5,000 and is not offered.
        XCTAssertEqual(roundOffOffers(15_000), [])
        XCTAssertEqual(roundOffOffers(5_000), [])
        XCTAssertEqual(pairs(roundOffOffers(5_099)), [[5_000, 99]])
        XCTAssertEqual(roundOffOffers(4_999).map(\.target), [4_000, 4_500, 4_900])
    }

    func testNeverOffersMoreThan4999Off() {
        for t: Double in [10_001, 49_999, 123_456, 999_999] {
            for o in roundOffOffers(t) {
                XCTAssertGreaterThan(o.extra, 0)
                XCTAssertLessThan(o.extra, 5_000)
                XCTAssertEqual(o.target + o.extra, t)
            }
        }
    }

    func testOffersNothingForANegativeEmptyOrUnreadableTotal() {
        XCTAssertEqual(roundOffOffers(-5_250), [])
        XCTAssertEqual(roundOffOffers(.nan), [])
        XCTAssertEqual(roundOffOffers(nil), [])
    }

    func testReadsAnOldFractionalTotalAsWholeRupees() {
        XCTAssertEqual(roundOffOffers(272_340.4), roundOffOffers(272_340))
    }

    // MARK: discountWithOffer

    func testAddsTheExtraToADiscountAlreadyTyped() {
        // 300,000 bill, 27,660 typed -> total 272,340; the 270,000 offer adds 2,340.
        let offer = roundOffOffers(300_000 - 27_660).first { $0.target == 270_000 }!
        XCTAssertEqual(discountWithOffer(27_660, offer), 30_000)
        XCTAssertEqual(300_000 - discountWithOffer(27_660, offer), 270_000)
    }

    // MARK: settleRemainderOffer

    func testGivesAwayASmallRemainder() {
        XCTAssertEqual(settleRemainderOffer(1), 1)
        XCTAssertEqual(settleRemainderOffer(4_999), 4_999)
        XCTAssertEqual(settleRemainderOffer(2_340), 2_340)
    }

    func testDoesNotAt5000OrMore() {
        XCTAssertNil(settleRemainderOffer(5_000))
        XCTAssertNil(settleRemainderOffer(120_000))
    }

    func testDoesNotWhenNothingIsLeftOrTheCustomerOverpaid() {
        XCTAssertNil(settleRemainderOffer(0))
        XCTAssertNil(settleRemainderOffer(-300))
        XCTAssertNil(settleRemainderOffer(0.4))
        XCTAssertNil(settleRemainderOffer(.nan))
    }

    // MARK: roundOffLabel

    func testReadsLikeTheChip() {
        XCTAssertEqual(roundOffLabel(RoundOffOffer(target: 270_000, extra: 2_340)), "Round to 270,000 · −2,340")
    }

    // MARK: The tables, for the apps to port

    func testTables() {
        // name, total, existing discount, [target, extra]...
        let rows: [(String, Double, Double, [[Double]])] = [
            ("round already", 270_000, 0, []),
            ("under 100", 99, 0, []),
            ("typed discount counts", 300_000, 27_660, [[270_000, 2_340], [272_000, 340], [272_300, 40]]),
            ("discount makes it round", 300_000, 30_000, []),
            ("small", 1_234, 0, [[1_000, 234], [1_200, 34]]),
        ]
        for (name, total, disc, want) in rows {
            let got = roundOffOffers(total, disc)
            XCTAssertEqual(pairs(got), want, name)
            for o in got { XCTAssertEqual(o.discount, disc + o.extra, name) }
        }
    }

    func testTablesIsSettledAndRupees() {
        XCTAssertEqual([0.99, -0.99, 1, -1, 0].map(isSettled), [true, true, false, false, true])
        XCTAssertEqual([2.5, 2.49, -0.4, 297000.5].map { rupees($0) }, [3, 2, 0, 297001])
        XCTAssertEqual(lineTotal([10.4, 10.4, 10.4]), 30)
    }

    // MARK: JavaScript's Math.round, exactly (half up toward +infinity)

    func testHalvesGoUpEvenWhenNegative() {
        XCTAssertEqual(rupees(-2.5), -2)
        XCTAssertEqual(rupees(-0.5), 0)
        XCTAssertEqual(rupees(-1.5), -1)
        XCTAssertEqual(rupees(-2.51), -3)
        XCTAssertEqual(rupees(0.5), 1)
        XCTAssertEqual(rupees(1.5), 2)
        // Just under a half is not a half (a naive floor(x + 0.5) says 1).
        XCTAssertEqual(rupees(0.49999999999999994), 0)
        XCTAssertEqual(rupees(.infinity), 0)
        XCTAssertEqual(rupees(-.infinity), 0)
    }

    // MARK: money.test.ts — whole rupees

    func testRoundsHalvesUpNeverLeavesMinusZeroOrNaN() {
        XCTAssertEqual(rupees(297000.5), 297001)
        XCTAssertEqual(rupees(297000.49), 297000)
        XCTAssertEqual(rupees(-0.2), 0)
        XCTAssertEqual(rupees(-0.2).sign, .plus)
        XCTAssertEqual(rupees(-0.0).sign, .plus)
        XCTAssertEqual(rupees(any: "12,500"), 0) // text is read by wholeRupeesFromText
        XCTAssertEqual(rupees(nil), 0)
        XCTAssertEqual(rupees(.nan), 0)
    }

    func testReadsTypedText() {
        XCTAssertEqual(wholeRupeesFromText("12,500.75"), 12501)
    }

    func testShowsNoDecimals() {
        XCTAssertEqual(pkr(297000), "PKR 297,000")
        XCTAssertEqual(pkr(297000.4), "PKR 297,000")
        XCTAssertEqual(rupeeText(1234567.8), "1,234,568")
    }

    func testRoundsOnlyTheMoneyFieldsThatAreThere() {
        XCTAssertEqual(rupeesIn(["a": 1.6, "c": ""], ["a", "b", "c"]), ["a": 2])
    }

    func testAFractionLeftFromBeforeIsNotADebtOrACredit() {
        XCTAssertFalse(owesMoney(0.7))
        XCTAssertTrue(owesMoney(1))
        XCTAssertFalse(owesMoney(-0.7))
        XCTAssertFalse(isCredit(-0.7))
        XCTAssertTrue(isCredit(-1))
        XCTAssertEqual(balanceLine(0.99).state, .paid)
        XCTAssertEqual(balanceLine(1).state, .due)
        XCTAssertEqual(balanceLine(-0.99).state, .paid)
        XCTAssertEqual(balanceLine(-1).state, .credit)
    }

    func testDueToCustomersLeavesOutASubRupeeRemainder() {
        let a = ERPDecode.model(Invoice.self, from: ["id": "A", "balanceDue": 0.7])!
        let b = ERPDecode.model(Invoice.self, from: ["id": "B", "balanceDue": 1.2])!
        XCTAssertFalse(isOwing(a))
        XCTAssertTrue(isOwing(b))
        let c = ERPDecode.model(Invoice.self, from: ["id": "B", "balanceDue": 1500, "customerId": "c1"])!
        let o = owedToYou([a, c])
        XCTAssertEqual(o.total, 1500)
        XCTAssertEqual(o.invoices.map(\.id), ["B"])
    }

    // MARK: money.test.ts — a piece prices in whole rupees that add up

    private let rates = PricingRates(goldRatePerGram21k: 28_333.33)
    private let piece = PricedPiece(
        metalType: .gold, karat: .k21, metalWeightG: 7.337, stoneWeightG: 0.211, wastagePercentage: 9.5,
        makingCharges: 12_345.67, hasDiamonds: true, diamondCharges: 5_000.5, stoneCharges: 1_999.49, miscCharges: 0
    )

    private func allWhole(_ c: ProductCosts) -> Bool {
        [c.metalCost, c.wastageCost, c.makingCharges, c.diamondCharges, c.stoneCharges, c.miscCharges, c.totalPrice]
            .allSatisfy { $0 == $0.rounded() }
    }

    func testEveryLineAndTheTotalAreIntegersAndTheLinesSumToTheTotal() {
        let c = calculateProductCosts(piece, rates)
        XCTAssertTrue(allWhole(c))
        XCTAssertEqual(c.metalCost + c.wastageCost + c.makingCharges + c.diamondCharges + c.stoneCharges + c.miscCharges, c.totalPrice)
    }

    func testSilverAndAFixedPriceToo() {
        var silver = piece
        silver.metalType = .silver
        silver.karat = nil
        var silverRates = rates
        silverRates.silverRatePerGram = 187.55
        XCTAssertTrue(allWhole(calculateProductCosts(silver, silverRates)))
        var fixed = piece
        fixed.isCustomPrice = true
        fixed.customPrice = 99_999.6
        XCTAssertEqual(calculateProductCosts(fixed, rates).totalPrice, 100_000)
    }
}
