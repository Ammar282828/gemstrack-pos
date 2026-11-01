import XCTest
@testable import ERPCore

/// src/lib/analytics/net-profit-running.test.ts, case for case. House of Mina's goods list, set as its descriptor sends it.
final class NetProfitTests: XCTestCase {
    private let mina = ["Stock & Karigars", "Custom Orders", "Stones & Pearls", "Plating & Finishing"]

    func testLeavesOutTheGoodsTheMarginAllowsForAndThePartnersDrawings() {
        XCTAssertTrue(NetProfit.isRunningCost(category: "Rent", goods: mina))
        XCTAssertTrue(NetProfit.isRunningCost(category: "Ad Spend", goods: mina))
        XCTAssertFalse(NetProfit.isRunningCost(category: "Stock & Karigars", goods: mina))
        XCTAssertFalse(NetProfit.isRunningCost(category: " plating & finishing ", goods: mina))
        XCTAssertFalse(NetProfit.isRunningCost(category: "Partner Drawings", goods: mina))
        XCTAssertTrue(NetProfit.isRunningCost(category: nil, goods: mina))
        XCTAssertTrue(NetProfit.isRunningCost(category: "Partner Salary", goods: mina))
    }

    func testTaheriHasNoGoodsCategoriesSoOnlyDrawingsAreLeftOut() {
        XCTAssertTrue(NetProfit.isRunningCost(category: "Stock & Karigars", goods: []))
        XCTAssertTrue(NetProfit.isRunningCost(category: "", goods: []))
        XCTAssertFalse(NetProfit.isRunningCost(category: "Partner Drawings", goods: []))
        XCTAssertFalse(NetProfit.isGoodsExpense(category: "", goods: [""]))
    }

    func testMinasMonthTheGoodsAreNotCountedTwice() {
        // Revenue 1.84 crore at 40% -> 73.6 lac estimated; most of what was paid out was stock and karigars.
        let expenses: [(String, Double)] = [
            ("Stock & Karigars", 14_000_000), ("Rent", 600_000), ("Salaries", 1_200_000), ("Partner Drawings", 3_100_000),
        ]
        let running = expenses.filter { NetProfit.isRunningCost(category: $0.0, goods: mina) }.reduce(0) { $0 + $1.1 }
        XCTAssertEqual(running, 1_800_000)
        XCTAssertEqual(7_360_000 - running, 5_560_000)
    }

    func testBeforeRunningUsesRecordedGoods() {
        // Mina all time, 2026-11-01: 1.84 crore revenue, 1.55 crore goods, 33.56 lac running, 73.52 lac at 40%.
        let gross = NetProfit.beforeRunning(estimated: 7_352_000, revenue: 18_400_000, goods: 15_500_000, recordsGoods: true)
        XCTAssertEqual(gross, 2_900_000)
        XCTAssertEqual(gross - 3_356_000, -456_000)
        XCTAssertEqual(NetProfit.beforeRunning(estimated: 7_352_000, revenue: 18_400_000, goods: 0, recordsGoods: false), 7_352_000)
    }
}
