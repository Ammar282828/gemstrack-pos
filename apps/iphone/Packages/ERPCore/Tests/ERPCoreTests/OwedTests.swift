import XCTest
@testable import ERPCore

/// src/lib/owed.test.ts, case for case (names made up).
final class OwedTests: XCTestCase {
    /// `inv(id, balanceDue, extra)` of the TS: the date is the id's last two digits.
    private func inv(_ id: String, _ balanceDue: Double, _ extra: [String: Any] = [:]) -> Invoice {
        var fields: [String: Any] = ["id": id, "balanceDue": balanceDue, "createdAt": "2026-09-\(id.suffix(2))"]
        fields.merge(extra) { _, new in new }
        return ERPDecode.model(Invoice.self, from: fields)!
    }

    private func entry(_ fields: [String: Any]) -> HisaabEntry { ERPDecode.model(HisaabEntry.self, from: fields)! }

    func testCountsEveryInvoiceStillOwedOnWalkInsAndTypedNamesIncludedNeverARefundOrACrumb() {
        let book = [
            inv("INV-10", 50_000, ["customerId": "c1", "customerName": "Sana Example"]),
            inv("INV-11", 20_000, ["customerId": "c1", "customerName": "Sana Example"]),
            inv("INV-12", 9_000, ["customerName": "Walk-in Customer"]),
            inv("INV-13", 4_000, ["customerName": "Fatima Sample (typed)"]),
            inv("INV-14", 0, ["customerId": "c2"]),
            inv("INV-15", 80_000, ["customerId": "c3", "status": "Refunded"]),
            inv("INV-16", 0.2, ["customerId": "c4"]),
        ]
        let o = owedToYou(book)
        XCTAssertEqual(o.total, 83_000)
        XCTAssertEqual(o.invoices.map(\.id), ["INV-10", "INV-11", "INV-12", "INV-13"])
        XCTAssertFalse(isOwing(book[6]))
    }

    func testByCustomerWithWalkInsAsOneLineAndTypedNamesAsTheirOwn() {
        let book = [
            inv("INV-10", 50_000, ["customerId": "c1", "customerName": "Sana Example"]),
            inv("INV-11", 20_000, ["customerId": "c1", "customerName": "Sana Example"]),
            inv("INV-12", 9_000, ["customerName": "Walk-in Customer"]),
            inv("INV-13", 4_000, ["customerName": "Fatima Sample (typed)"]),
        ]
        let o = owedToYou(book)
        XCTAssertEqual(o.byKey["c1"], OwedAmount(amount: 70_000, count: 2))
        XCTAssertEqual(o.byKey["walk-in"], OwedAmount(amount: 9_000, count: 1))
        XCTAssertEqual(o.byKey["name:Fatima Sample (typed)"], OwedAmount(amount: 4_000, count: 1))
        XCTAssertEqual(o.walkIn, 9_000)
        XCTAssertEqual(o.nameOnly, 4_000)
    }

    // With the hisaab's hand-written balances.
    private let ledgerBook = [("INV-20", 30_000.0, ["customerId": "c1", "customerName": "Sana Example"])]
    private var ledger: [HisaabEntry] {
        [
            // The old khata for Sana: 1,00,000 given, 40,000 paid.
            entry(["entityId": "c1", "entityType": "customer", "cashDebit": 100_000, "cashCredit": 0]),
            entry(["entityId": "c1", "entityType": "customer", "cashDebit": 0, "cashCredit": 40_000]),
            // INV-20's own row: the invoice already counts it.
            entry(["entityId": "c1", "entityType": "customer", "cashDebit": 30_000, "cashCredit": 0, "linkedInvoiceId": "INV-20"]),
            // A khata-only customer, and one the shop owes (an advance): that one lowers nobody's debt.
            entry(["entityId": "c9", "entityType": "customer", "cashDebit": 5_000, "cashCredit": 0]),
            entry(["entityId": "c8", "entityType": "customer", "cashDebit": 0, "cashCredit": 12_000]),
            // A settled account, and a karigar's gold: neither is owed.
            entry(["entityId": "c7", "entityType": "customer", "cashDebit": 8_000, "cashCredit": 8_000]),
            entry(["entityId": "k1", "entityType": "karigar", "cashDebit": 50_000, "cashCredit": 0]),
        ]
    }
    private var ledgerInvoices: [Invoice] {
        ledgerBook.map { inv($0.0, $0.1, $0.2) }
    }

    func testAddsEachCustomerTheLedgerSaysOwesOnceBesideTheInvoices() {
        let o = owedToYou(ledgerInvoices, currentName: nil, ledgerRows: ledger)
        XCTAssertEqual(o.ledger, 65_000)
        XCTAssertEqual(o.total, 95_000)
        XCTAssertEqual(o.byKey["c1"], OwedAmount(amount: 90_000, count: 1))
        XCTAssertEqual(o.byKey["c9"], OwedAmount(amount: 5_000, count: 0))
        XCTAssertNil(o.byKey["c8"])
        XCTAssertNil(o.byKey["c7"])
        XCTAssertNil(o.byKey["k1"])
    }

    func testIsTheInvoicesAloneWhenNoLedgerIsGiven() {
        XCTAssertEqual(owedToYou(ledgerInvoices).total, 30_000)
        XCTAssertEqual(owedToYou(ledgerInvoices).ledger, 0)
    }

    // Not in the TS tests: the walk-in's hand-written balance joins the walk-in line, and the
    // sums are the same whatever order the ledger lists its people in.
    func testLedgerBalancesForTheWalkInEntityJoinTheWalkInLine() {
        let rows = [entry(["entityId": "walk-in", "entityType": "customer", "cashDebit": 7_000, "cashCredit": 0])]
        let o = owedToYou([], currentName: nil, ledgerRows: rows)
        XCTAssertEqual(o.walkIn, 7_000)
        XCTAssertEqual(o.total, 7_000)
        XCTAssertEqual(ledgerBalances(rows), ["walk-in": 7_000])
    }
}
