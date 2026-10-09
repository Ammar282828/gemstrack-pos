import XCTest
@testable import ERPCore

/// src/lib/partnership.test.ts, case for case. All names and amounts made up.
final class PartnershipTests: XCTestCase {
    private func karachi(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 12) -> Date {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = ERPDate.karachi
        return c.date(from: DateComponents(year: y, month: m, day: d, hour: h))!
    }

    private func entry(_ amount: Double, _ category: PartnerLedgerCategory, _ type: PartnerLedgerType = .payment) -> ShareholderLedgerRow {
        ShareholderLedgerRow(id: String(amount), description: "Test entry", amount: amount, date: "2026-09-15T07:00:00.000Z", category: category, type: type)
    }

    private func floor(lastSet: String?) -> PartnershipSettings {
        PartnershipSettings(workingCapitalFloor: 1, floorLastSetAt: lastSet, floorHistory: [])
    }

    // MARK: What counts as a cost

    func testADrawingIsNotACostOfTheBusinessASalaryIs() {
        XCTAssertFalse(Partnership.isBusinessCost(category: Partnership.partnerDrawings))
        XCTAssertTrue(Partnership.isBusinessCost(category: Partnership.partnerSalary))
        XCTAssertTrue(Partnership.isBusinessCost(category: "Rent"))
        XCTAssertTrue(Partnership.isBusinessCost(category: nil))
        XCTAssertEqual(Partnership.partnerDrawings, "Partner Drawings")
        XCTAssertEqual(Partnership.partnerSalary, "Partner Salary")
    }

    // MARK: A partner's ledger

    func testSortsPaymentsAndWithdrawalsIntoEquityAndLoan() {
        let l = Partnership.categorise(
            payments: [entry(100_000, .equity), entry(40_000, .loan), entry(25_000, .equity)],
            withdrawals: [entry(10_000, .equity, .withdrawal), entry(15_000, .loan, .withdrawal)]
        )
        XCTAssertEqual(l, CategorisedLedger(equityIn: 125_000, loanIn: 40_000, equityOut: 10_000, loanOut: 15_000))
        XCTAssertEqual(Partnership.categorise(payments: [], withdrawals: []), CategorisedLedger())
    }

    func testAClaimIsTheLoanTheEquityAndTheHalfOfProfitAndLossTogether() {
        let b = Partnership.partnerBalance(CategorisedLedger(equityIn: 125_000, loanIn: 40_000, equityOut: 10_000, loanOut: 15_000), expShare: 60_000, revShare: 90_000)
        XCTAssertEqual(b, PartnerBalance(equityBalance: 115_000, loanBalance: 25_000, netPnL: 30_000, totalClaim: 170_000))
    }

    func testALossIsAbsorbedAgainstTheClaim() {
        let b = Partnership.partnerBalance(CategorisedLedger(equityIn: 50_000), expShare: 80_000, revShare: 20_000)
        XCTAssertEqual(b, PartnerBalance(equityBalance: 50_000, loanBalance: 0, netPnL: -60_000, totalClaim: -10_000))
    }

    // MARK: The distribution waterfall

    private let partners = [
        PartnerDistributionInput(name: "Partner A", loanBalance: 30_000, equityBalance: 100_000, netPnL: 5000),
        PartnerDistributionInput(name: "Partner B", loanBalance: 10_000, equityBalance: 80_000, netPnL: 5000),
    ]

    func testHoldsBackTheFloorRepaysTheLoansThenSplitsTheRestEqually() {
        let d = Partnership.calculateDistribution(cashOnHand: 600_000, workingCapitalFloor: 500_000, partners: partners)
        XCTAssertEqual(d.distributableCash, 100_000)
        XCTAssertEqual(d.totalLoanOutstanding, 40_000)
        XCTAssertEqual(d.loanRepaymentsTotal, 40_000)
        XCTAssertEqual(d.profitPoolTotal, 60_000)
        XCTAssertEqual(d.perPartner, [
            PartnerDistributionResult(name: "Partner A", loanRepayment: 30_000, profitShare: 30_000, equityDraw: 30_000, total: 60_000),
            PartnerDistributionResult(name: "Partner B", loanRepayment: 10_000, profitShare: 30_000, equityDraw: 30_000, total: 40_000),
        ])
        XCTAssertEqual(d.remainingAfter, 0)
        XCTAssertTrue(d.feasible)
        XCTAssertEqual(d.shortfallToFirstDistribution, 0)
    }

    func testNotEnoughForTheLoansEachIsRepaidInProportionAndNothingIsSplit() {
        let d = Partnership.calculateDistribution(cashOnHand: 520_000, workingCapitalFloor: 500_000, partners: partners)
        XCTAssertEqual(d.loanRepaymentsTotal, 20_000)
        XCTAssertEqual(d.perPartner.map(\.loanRepayment), [15_000, 5000])
        XCTAssertEqual(d.profitPoolTotal, 0)
        XCTAssertEqual(d.perPartner.map(\.total), [15_000, 5000])
    }

    func testBelowTheFloorNothingToGiveAndHowFarShortItIs() {
        let d = Partnership.calculateDistribution(cashOnHand: 350_000, workingCapitalFloor: 500_000, partners: partners)
        XCTAssertEqual(d.distributableCash, 0)
        XCTAssertFalse(d.feasible)
        XCTAssertEqual(d.shortfallToFirstDistribution, 150_000)
        XCTAssertEqual(d.perPartner.map(\.total), [0, 0])
    }

    func testALoanTheBusinessIsOwedBackCountsForNothingOutstanding() {
        let d = Partnership.calculateDistribution(cashOnHand: 100_000, workingCapitalFloor: 0, partners: [
            PartnerDistributionInput(name: "Partner A", loanBalance: -20_000, equityBalance: 0, netPnL: 0),
            PartnerDistributionInput(name: "Partner B", loanBalance: 0, equityBalance: 0, netPnL: 0),
        ])
        XCTAssertEqual(d.totalLoanOutstanding, 0)
        XCTAssertEqual(d.loanRepaymentsTotal, 0)
        XCTAssertEqual(d.perPartner.map(\.profitShare), [50_000, 50_000])
    }

    func testRatiosGivenForEveryPartnerSplitThePoolByThem() {
        let none = [
            PartnerDistributionInput(name: "Partner A", loanBalance: 0, equityBalance: 0, netPnL: 0),
            PartnerDistributionInput(name: "Partner B", loanBalance: 0, equityBalance: 0, netPnL: 0),
        ]
        let d = Partnership.calculateDistribution(cashOnHand: 100_000, workingCapitalFloor: 0, partners: none, distributionRatios: [3, 1])
        XCTAssertEqual(d.perPartner.map(\.profitShare), [75_000, 25_000])
        // A ratio list of the wrong length is ignored: equal shares.
        XCTAssertEqual(Partnership.calculateDistribution(cashOnHand: 100_000, workingCapitalFloor: 0, partners: none, distributionRatios: [1]).perPartner.map(\.profitShare), [50_000, 50_000])
    }

    // MARK: The working-capital floor

    func testStartsAtFiveLac() {
        XCTAssertEqual(Partnership.defaultWorkingCapitalFloor, 500_000)
        XCTAssertEqual(ERPDecode.model(PartnershipSettings.self, from: ["workingCapitalFloor": 0])?.workingCapitalFloor, 500_000)
        XCTAssertEqual(ERPDecode.model(PartnershipSettings.self, from: [String: Any]())?.workingCapitalFloor, 500_000)
        let s = ERPDecode.model(PartnershipSettings.self, from: [
            "workingCapitalFloor": 300_000, "floorLastSetAt": "2026-10-01T05:00:00.000Z",
            "floorHistory": [["value": 300_000, "date": "2026-10-01T05:00:00.000Z", "by": "Shareholders"]],
        ])!
        XCTAssertEqual(s.workingCapitalFloor, 300_000)
        XCTAssertEqual(s.floorLastSetAt, "2026-10-01T05:00:00.000Z")
        XCTAssertEqual(s.floorHistory.first?.by, "Shareholders")
    }

    func testIsStaleUntilItHasBeenSetThisCalendarMonth() {
        let now = karachi(2026, 10, 3)
        XCTAssertTrue(Partnership.isFloorStale(floor(lastSet: nil), now: now))
        XCTAssertTrue(Partnership.isFloorStale(floor(lastSet: "never"), now: now))
        XCTAssertTrue(Partnership.isFloorStale(floor(lastSet: ERPDate.iso(karachi(2026, 9, 28))), now: now))
        XCTAssertTrue(Partnership.isFloorStale(floor(lastSet: ERPDate.iso(karachi(2025, 10, 2))), now: now))
        XCTAssertFalse(Partnership.isFloorStale(floor(lastSet: ERPDate.iso(karachi(2026, 10, 1))), now: now))
    }

    func testAsksToBeReviewedInTheFirstFiveDaysOfAMonth() {
        XCTAssertTrue(Partnership.isMonthStart(now: karachi(2026, 10, 1)))
        XCTAssertTrue(Partnership.isMonthStart(now: karachi(2026, 10, 5)))
        XCTAssertFalse(Partnership.isMonthStart(now: karachi(2026, 10, 6)))
    }
}
