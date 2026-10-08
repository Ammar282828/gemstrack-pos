import XCTest
@testable import ERPCore

/// src/lib/invoice-credit.test.ts, case for case.
final class InvoiceCreditTests: XCTestCase {
    private func row(_ fields: [String: Any]) -> HisaabEntry { ERPDecode.model(HisaabEntry.self, from: fields)! }

    func testReadsAsDuePaidOrCreditWithPaiseEitherWaySettled() {
        XCTAssertEqual(balanceLine(5_000), BalanceLine(label: "Balance due", amount: 5_000, state: .due))
        XCTAssertEqual(balanceLine(-5_000), BalanceLine(label: "Credit to customer", amount: 5_000, state: .credit))
        XCTAssertEqual(balanceLine(0.3).state, .paid)
        XCTAssertEqual(balanceLine(-0.3).state, .paid)
        XCTAssertEqual(balanceLine(nil).state, .paid)
        XCTAssertTrue(inCredit(-1))
        XCTAssertFalse(inCredit(-0.4))
    }

    func testHeldOnlyForSomeoneNamed() {
        XCTAssertTrue(canHoldCredit("c1"))
        XCTAssertFalse(canHoldCredit("walk-in"))
        XCTAssertFalse(canHoldCredit(""))
        XCTAssertFalse(canHoldCredit(nil))
    }

    func testKnowsItsLedgerRowAndTheOneTheSyncUsedToWrite() {
        XCTAssertTrue(isCreditRow(row(["description": creditDescription("INV-1"), "cashCredit": 5]), "INV-1"))
        XCTAssertTrue(isCreditRow(row(["description": "Excess advance returned for Invoice INV-1", "cashCredit": 5]), "INV-1"))
        XCTAssertFalse(isCreditRow(row(["description": creditDescription("INV-2"), "cashCredit": 5]), "INV-1"))
        XCTAssertFalse(isCreditRow(row(["description": "Outstanding balance for Invoice INV-1", "cashDebit": 5]), "INV-1"))
    }
}
