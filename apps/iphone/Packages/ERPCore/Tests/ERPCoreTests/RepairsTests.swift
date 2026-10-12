import XCTest
@testable import ERPCore

/// src/lib/repairs.ts (no TS test file: the cases are read off the functions). All names and amounts made up.
final class RepairsTests: XCTestCase {
    private func repair(_ json: String) -> Repair {
        try! JSONDecoder().decode(Repair.self, from: Data(json.utf8))
    }

    func testTotalPaidAndBalance() {
        let r = repair("""
        {"id":"REP-000001","customerName":"Sana Example","status":"received",
         "pieces":[{"item":"Gold ring","work":"resize","price":2500},{"item":"Chain","work":"re-solder","price":1000.5}],
         "payments":[{"amount":1000,"date":"2026-10-03T09:00:00Z"},{"amount":500.25,"date":"2026-10-04T09:00:00Z"}]}
        """)
        XCTAssertEqual(repairTotal(r), 3_500.5)
        XCTAssertEqual(repairPaid(r), 1_500.25)
        XCTAssertEqual(repairBalance(r), 2_000.25)
    }

    func testAPieceWithNoPriceCountsAsNothingAndOverpaidOwesNothing() {
        let r = repair("""
        {"id":"REP-000002","customerName":"Bilal Sample","status":"ready",
         "pieces":[{"item":"Bangle","work":"polish"}],"payments":[{"amount":300,"date":"2026-10-04T00:00:00Z"}]}
        """)
        XCTAssertEqual(repairTotal(r), 0)
        XCTAssertEqual(repairBalance(r), 0)
        XCTAssertEqual(repairBalance(repair(#"{"id":"x","customerName":"n","status":"received"}"#)), 0)
    }

    func testBalanceIsRoundedToTheCent() {
        let r = repair("""
        {"id":"REP-000003","customerName":"Test","status":"received",
         "pieces":[{"item":"Ring","work":"a","price":0.3}],"payments":[{"amount":0.1,"date":"2026-10-04T00:00:00Z"}]}
        """)
        XCTAssertEqual(repairBalance(r), 0.2)
    }

    func testSummary() {
        let none = repair(#"{"id":"a","customerName":"n","status":"received","pieces":[{"item":"","work":"x"}]}"#)
        XCTAssertEqual(repairSummary(none), "Repair")
        let one = repair(#"{"id":"a","customerName":"n","status":"received","pieces":[{"item":"Gold ring","work":"x"}]}"#)
        XCTAssertEqual(repairSummary(one), "Gold ring")
        let three = repair(#"{"id":"a","customerName":"n","status":"received","pieces":[{"item":"Gold ring","work":"x"},{"item":""},{"item":"Chain"},{"item":"Bangle"}]}"#)
        XCTAssertEqual(repairSummary(three), "Gold ring + 2 more")
    }
}
