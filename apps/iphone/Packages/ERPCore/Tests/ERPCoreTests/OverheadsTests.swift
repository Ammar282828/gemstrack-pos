import XCTest
@testable import ERPCore

/// src/lib/overheads.test.ts, case for case. "Now" is Karachi's wall clock, as the TypeScript builds it in
/// local time on the shop's devices. All names and amounts made up.
final class OverheadsTests: XCTestCase {
    private func karachi(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 12) -> Date {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = ERPDate.karachi
        return c.date(from: DateComponents(year: y, month: m, day: d, hour: h))!
    }

    private func plan(_ from: String, _ amounts: Double...) -> OverheadPlan {
        OverheadPlan(from: from, items: amounts.enumerated().map { i, a in OverheadItem(id: "item-\(i + 1)", label: "Line \(i + 1)", amount: a) })
    }

    private func invoice(_ f: [String: Any]) -> Invoice { ERPDecode.model(Invoice.self, from: f)! }
    private func order(_ f: [String: Any]) -> Order { ERPDecode.model(Order.self, from: f)! }
    private func item(_ f: [String: Any]) -> OverheadItem { ERPDecode.model(OverheadItem.self, from: f)! }

    // MARK: The sheet

    func testAddsTheLinesAMissingOrOddAmountCountingAsNothing() {
        XCTAssertEqual(Overheads.overheadTotal([OverheadItem(id: "a", label: "Rent", amount: 20_000), OverheadItem(id: "b", label: "Help", amount: 35_500)]), 55_500)
        XCTAssertEqual(Overheads.overheadTotal([item(["id": "a", "label": "Odd", "amount": "lots"]), item(["id": "b", "label": "Text", "amount": "7000"])]), 7000)
        XCTAssertEqual(Overheads.overheadTotal([]), 0)
    }

    func testGivesANewLineAnIdNoSiblingHas() {
        XCTAssertEqual(Overheads.newOverheadId([]), "item-1")
        XCTAssertEqual(Overheads.newOverheadId([OverheadItem(id: "rent", label: "Rent", amount: 1)]), "item-2")
        XCTAssertEqual(Overheads.newOverheadId([OverheadItem(id: "item-2", label: "A", amount: 1), OverheadItem(id: "item-3", label: "B", amount: 1)]), "item-4")
    }

    func testNamesMonthsAsThePageDoesAndLeavesAKeyItCannotReadAsItIs() {
        XCTAssertEqual(Overheads.monthLabel("2026-09"), "September 2026")
        XCTAssertEqual(Overheads.monthLabel("2027-01"), "January 2027")
        XCTAssertEqual(Overheads.monthLabel("not-a-month"), "not-a-month")
        XCTAssertEqual(Overheads.monthKey(karachi(2026, 10, 10)), "2026-10")
        // Karachi's month, not UTC's: 1 am on the 1st there is still the 30th in London.
        XCTAssertEqual(Overheads.monthKey(karachi(2026, 10, 1, 1)), "2026-10")
    }

    func testCountsTheMonthsFromTheStartToNowAndNoneBeforeIt() {
        XCTAssertEqual(Overheads.monthsSinceStart(karachi(2026, 11, 3)), ["2026-09", "2026-10", "2026-11"])
        XCTAssertEqual(Overheads.monthsSinceStart(karachi(2027, 2, 1), start: "2026-11"), ["2026-11", "2026-12", "2027-01", "2027-02"])
        XCTAssertEqual(Overheads.monthsSinceStart(karachi(2026, 8, 20)), [])
        XCTAssertEqual(Overheads.monthsSinceStart(karachi(2026, 10, 1), start: "soon"), [])
    }

    func testUsesTheLatestPlanThatHasStartedAndNoneBeforeTheFirst() {
        let plans = [plan("2026-11", 300), plan("2026-09", 100), plan("2026-10", 200)]
        XCTAssertEqual(Overheads.planForMonth(plans, "2026-09")?.first?.amount, 100)
        XCTAssertEqual(Overheads.planForMonth(plans, "2026-10")?.first?.amount, 200)
        XCTAssertEqual(Overheads.planForMonth(plans, "2027-03")?.first?.amount, 300)
        XCTAssertNil(Overheads.planForMonth(plans, "2026-08"))
        XCTAssertNil(Overheads.planForMonth([], "2026-10"))
    }

    // MARK: This month

    func testSaysWhatIsStillToEarnAndWhatEachDayLeftHasToBring() {
        let p = Overheads.overheadProgress(target: 310_000, earned: 124_000, now: karachi(2026, 10, 10))
        XCTAssertEqual(p.shortfall, 186_000)
        XCTAssertEqual(p.percent, 40)
        // 31 days in October, the 10th itself included.
        XCTAssertEqual(p.daysLeft, 22)
        XCTAssertEqual(p.perDayNeeded, 186_000 / 22, accuracy: 1e-9)
    }

    func testOnceCoveredNothingShortNothingADayTheBarFull() {
        let p = Overheads.overheadProgress(target: 100_000, earned: 150_000, now: karachi(2026, 2, 28))
        XCTAssertEqual(p, OverheadProgress(target: 100_000, earned: 150_000, shortfall: 0, percent: 100, daysLeft: 1, perDayNeeded: 0))
    }

    func testASheetOfNothingHasAnEmptyBar() {
        XCTAssertEqual(Overheads.overheadProgress(target: 0, earned: 5000, now: karachi(2026, 9, 1)).percent, 0)
        XCTAssertEqual(Overheads.overheadProgress(target: 0, earned: 5000, now: karachi(2026, 9, 1)).daysLeft, 30)
    }

    // MARK: Revenue by month

    func testDatesAnInvoiceByItsOrderCountsTheExchangeAndDropsARefund() {
        let orders = [order(["id": "ORD-1", "createdAt": "2026-09-14T10:00:00.000Z", "subtotal": 90_000, "invoiceId": "INV-1", "status": "Completed"])]
        let invoices = [
            // Billed in October for an order taken in September: September's.
            invoice(["id": "INV-1", "createdAt": "2026-10-15T10:00:00.000Z", "sourceOrderId": "ORD-1", "grandTotal": 60_000, "exchanges": [["description": "Old ring", "value": 30_000]]]),
            invoice(["id": "INV-2", "createdAt": "2026-10-16T10:00:00.000Z", "grandTotal": 25_000]),
            invoice(["id": "INV-3", "createdAt": "2026-10-17T10:00:00.000Z", "grandTotal": 40_000, "status": "Refunded"]),
            invoice(["id": "INV-4", "createdAt": "", "grandTotal": 99_000]),
            invoice(["id": "INV-5", "createdAt": "whenever", "grandTotal": 99_000]),
        ]
        let r = Overheads.revenueByMonth(invoices: invoices, orders: orders)
        XCTAssertEqual(r["2026-09"], OverheadRevenue(invoiced: 90_000, uninvoiced: 0, total: 90_000))
        XCTAssertEqual(r["2026-10"], OverheadRevenue(invoiced: 25_000, uninvoiced: 0, total: 25_000))
        XCTAssertEqual(r.keys.sorted(), ["2026-09", "2026-10"])
    }

    func testAnInvoiceWhoseOrderIsNotOnFileKeepsItsOwnDate() {
        let r = Overheads.revenueByMonth(invoices: [invoice(["createdAt": "2026-10-05T10:00:00.000Z", "sourceOrderId": "ORD-GONE", "grandTotal": 12_000])], orders: [])
        XCTAssertEqual(r["2026-10"]?.total, 12_000)
    }

    func testAnOrderNotYetBilledCountsAtItsSubtotalCancelledRefundedAndBilledOnesDoNot() {
        let orders = [
            order(["id": "ORD-2", "createdAt": "2026-10-02T10:00:00.000Z", "subtotal": 70_000, "status": "Pending"]),
            order(["id": "ORD-3", "createdAt": "2026-10-03T10:00:00.000Z", "subtotal": 11_000, "status": "Cancelled"]),
            order(["id": "ORD-4", "createdAt": "2026-10-04T10:00:00.000Z", "subtotal": 12_000, "status": "Refunded"]),
            order(["id": "ORD-5", "createdAt": "2026-10-05T10:00:00.000Z", "subtotal": 13_000, "invoiceId": "INV-9"]),
            order(["id": "ORD-6", "createdAt": "2026-10-06T10:00:00.000Z", "status": "In Progress"]),
            order(["id": "ORD-7", "subtotal": 14_000]),
        ]
        XCTAssertEqual(Overheads.revenueByMonth(invoices: [], orders: orders)["2026-10"], OverheadRevenue(invoiced: 0, uninvoiced: 70_000, total: 70_000))
    }

    // MARK: Month by month

    private var plans: [OverheadPlan] { [plan("2026-09", 100_000, 50_000), plan("2026-11", 200_000)] }
    private let revenue: [String: OverheadRevenue] = [
        "2026-09": OverheadRevenue(invoiced: 0, uninvoiced: 0, total: 180_000),
        "2026-10": OverheadRevenue(invoiced: 0, uninvoiced: 0, total: 120_000),
        "2026-11": OverheadRevenue(invoiced: 0, uninvoiced: 0, total: 30_000),
    ]

    func testOneRowAMonthFromTheStartNewestFirstEachAgainstThePlanInForceThen() {
        let rows = Overheads.monthlyRows(plans, revenue: revenue, now: karachi(2026, 11, 12))
        XCTAssertEqual(rows.map(\.month), ["2026-11", "2026-10", "2026-09"])
        XCTAssertEqual(rows[0], OverheadMonthRow(month: "2026-11", label: "November 2026", target: 200_000, earned: 30_000, surplus: -170_000, met: false, percent: 15, inProgress: true))
        XCTAssertEqual(rows[1], OverheadMonthRow(month: "2026-10", label: "October 2026", target: 150_000, earned: 120_000, surplus: -30_000, met: false, percent: 80, inProgress: false))
        XCTAssertEqual(rows[2], OverheadMonthRow(month: "2026-09", label: "September 2026", target: 150_000, earned: 180_000, surplus: 30_000, met: true, percent: 100, inProgress: false))
    }

    func testAMonthBeforeAnyPlanHasNoTargetAndIsNeverMet() {
        let rows = Overheads.monthlyRows([plan("2026-10", 1000)], revenue: ["2026-09": OverheadRevenue(invoiced: 0, uninvoiced: 0, total: 5000)], now: karachi(2026, 10, 2))
        XCTAssertEqual(rows[1].month, "2026-09")
        XCTAssertEqual(rows[1].target, 0)
        XCTAssertEqual(rows[1].earned, 5000)
        XCTAssertFalse(rows[1].met)
        XCTAssertEqual(rows[1].percent, 0)
    }

    func testScoresOnlyTheFinishedMonths() {
        let s = Overheads.benchmarkSummary(Overheads.monthlyRows(plans, revenue: revenue, now: karachi(2026, 11, 12)))
        XCTAssertEqual(s.monthsScored, 2)
        XCTAssertEqual(s.monthsMet, 1)
        XCTAssertEqual(s.averageRevenue, 150_000)
        XCTAssertEqual(s.cumulativeSurplus, 0)
        XCTAssertEqual(s.best?.month, "2026-09")
        XCTAssertEqual(s.worst?.month, "2026-10")
    }

    func testWithNothingFinishedYetNothingIsScored() {
        let s = Overheads.benchmarkSummary(Overheads.monthlyRows(plans, revenue: revenue, now: karachi(2026, 9, 20)))
        XCTAssertEqual(s, OverheadSummary(monthsScored: 0, monthsMet: 0, averageRevenue: 0, cumulativeSurplus: 0, best: nil, worst: nil))
    }

    func testStartsInSeptember2026() {
        XCTAssertEqual(Overheads.benchmarkStart, "2026-09")
    }

    // MARK: The ERP's answer

    func testReadsThePlansTheERPSends() {
        let a = ERPDecode.model(OverheadPlansAnswer.self, from: [
            "start": "2026-09", "saved": true,
            "plans": [["from": "2026-09", "items": [["id": "rent", "label": "Rent", "amount": 20_000], ["id": "help", "label": "Help", "amount": "35000"]]]],
        ])!
        XCTAssertEqual(a.start, "2026-09")
        XCTAssertTrue(a.saved)
        XCTAssertEqual(a.plans, [OverheadPlan(from: "2026-09", items: [OverheadItem(id: "rent", label: "Rent", amount: 20_000), OverheadItem(id: "help", label: "Help", amount: 35_000)])])
        XCTAssertEqual(ERPDecode.model(OverheadPlansAnswer.self, from: [String: Any]())?.plans, [])
    }
}
