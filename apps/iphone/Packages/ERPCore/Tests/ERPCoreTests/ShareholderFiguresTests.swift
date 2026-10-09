import XCTest
@testable import ERPCore

/// src/lib/shareholder-figures.test.ts, case for case. All names and amounts made up.
final class ShareholderFiguresTests: XCTestCase {
    private let partners: [(id: String, name: String)] = [(id: "mina", name: "Mina"), (id: "ammar", name: "Ammar")]

    private func expense(_ f: [String: Any]) -> Expense { ERPDecode.model(Expense.self, from: f)! }
    private func invoice(_ f: [String: Any]) -> Invoice { ERPDecode.model(Invoice.self, from: f)! }
    private func order(_ f: [String: Any]) -> Order { ERPDecode.model(Order.self, from: f)! }
    private func revenue(_ f: [String: Any]) -> AdditionalRevenue { ERPDecode.model(AdditionalRevenue.self, from: f)! }

    private func row(_ id: String, _ type: PartnerLedgerType, _ category: PartnerLedgerCategory, _ amount: Double) -> ShareholderLedgerRow {
        ShareholderLedgerRow(id: id, description: "Entry \(id)", amount: amount, date: "2026-09-15T12:00:00.000Z", category: category, type: type)
    }

    private func totals(expShare: Double, revShare: Double) -> ShareholderFigures.Totals {
        ShareholderFigures.Totals(totalExpenses: expShare * 2, totalRevenue: revShare * 2, drawings: 0, expShare: expShare, revShare: revShare)
    }

    // MARK: The partnership's profit and loss

    func testCountsFromTheCutoffsLeavesDrawingsOutOfTheCostsAndCountsThemApart() {
        let expenses = [
            expense(["id": "e1", "date": "2025-07-01T10:00:00.000Z", "amount": 9_999, "category": "Rent", "description": "Before the partnership"]),
            expense(["id": "e2", "date": "2025-07-02T10:00:00.000Z", "amount": 20_000, "category": "Rent", "description": "Rent"]),
            expense(["id": "e3", "date": "2026-01-10T10:00:00.000Z", "amount": 6_000, "category": "Partner Salary", "shareholderId": "mina", "description": "Mina salary — January"]),
            expense(["id": "e4", "date": "2026-02-10T10:00:00.000Z", "amount": 15_000, "category": "Partner Drawings", "description": "Ammar — capital returned"]),
            expense(["id": "e5", "date": "", "amount": 1_000, "category": "Rent", "description": "No date"]),
        ]
        let orders = [
            order(["id": "ORD-1", "createdAt": "2025-07-10T10:00:00.000Z", "subtotal": 50_000, "invoiceId": "INV-1"]),
            order(["id": "ORD-2", "createdAt": "2025-08-01T10:00:00.000Z", "subtotal": 30_000, "status": "Pending"]),
            order(["id": "ORD-3", "createdAt": "2025-08-02T10:00:00.000Z", "subtotal": 8_000, "status": "Cancelled"]),
            order(["id": "ORD-4", "createdAt": "2025-08-03T10:00:00.000Z", "subtotal": 9_000, "status": "Refunded"]),
            order(["id": "ORD-5", "createdAt": "2025-08-04T10:00:00.000Z", "subtotal": 7_000]),
            order(["id": "ORD-6", "createdAt": "2025-07-15T10:00:00.000Z", "subtotal": 4_000]),
        ]
        let invoices = [
            // Billed after the cutoff for an order taken before it: left out, as the page leaves it.
            invoice(["id": "INV-1", "createdAt": "2025-08-01T10:00:00.000Z", "sourceOrderId": "ORD-1", "grandTotal": 50_000]),
            invoice(["id": "INV-2", "createdAt": "2025-09-01T10:00:00.000Z", "grandTotal": 40_000, "exchanges": [["description": "Old chain", "value": 10_000]]]),
            invoice(["id": "INV-3", "createdAt": "2025-09-02T10:00:00.000Z", "grandTotal": 70_000, "status": "Refunded"]),
            // ORD-5's invoice: the order is billed, so only the invoice counts.
            invoice(["id": "INV-4", "createdAt": "2025-09-03T10:00:00.000Z", "sourceOrderId": "ORD-5", "grandTotal": 7_000]),
        ]
        let extra = [
            revenue(["id": "r1", "date": "2025-07-15T10:00:00.000Z", "amount": 500]),
            revenue(["id": "r2", "date": "2025-07-16T00:00:00.000Z", "amount": 2_500]),
        ]
        let t = ShareholderFigures.partnershipTotals(expenses: expenses, invoices: invoices, orders: orders, additionalRevenues: extra)
        XCTAssertEqual(t.totalExpenses, 26_000)
        XCTAssertEqual(t.drawings, 15_000)
        // INV-2 with its exchange, INV-4, ORD-2 unbilled, the extra revenue from the 16th.
        XCTAssertEqual(t.totalRevenue, 50_000 + 7_000 + 30_000 + 2_500)
        XCTAssertEqual(t.expShare, 13_000)
        XCTAssertEqual(t.revShare, 44_750)
    }

    func testStartsOnTheCutoffDaysThemselves() {
        XCTAssertEqual(ShareholderFigures.expenseCutoff, "2025-07-02")
        XCTAssertEqual(ShareholderFigures.revenueCutoff, "2025-07-16")
    }

    // MARK: Salaries

    func testAreThePartnerSalaryExpensesThatNameAPartnerNewestFirst() {
        let s = ShareholderFigures.salariesByPartner([
            expense(["id": "s1", "date": "2026-01-10T10:00:00.000Z", "amount": 6_000, "category": "Partner Salary", "shareholderId": "mina", "description": "a"]),
            expense(["id": "s2", "date": "2026-03-10T10:00:00.000Z", "amount": 6_000, "category": "Partner Salary", "shareholderId": "mina", "description": "b"]),
            expense(["id": "s3", "date": "2026-02-10T10:00:00.000Z", "amount": 4_000, "category": "Partner Salary", "shareholderId": "ammar", "description": "c"]),
            expense(["id": "s4", "date": "2026-02-11T10:00:00.000Z", "amount": 4_000, "category": "Partner Salary", "description": "nobody named"]),
            expense(["id": "s5", "date": "2026-02-12T10:00:00.000Z", "amount": 4_000, "category": "Rent", "shareholderId": "mina", "description": "not a salary"]),
        ])
        XCTAssertEqual(s["mina"]?.map(\.id), ["s2", "s1"])
        XCTAssertEqual(s["ammar"]?.map(\.id), ["s3"])
    }

    func testAGapMovesHalfOfItFromOnePartnerToTheOtherUnderARupeeIsNone() {
        func positions(_ a: Double, _ b: Double) -> [ShareholderFigures.Position] {
            let salaries = [
                "mina": a > 0 ? [expense(["id": "m", "date": "2026-01-01", "amount": a, "category": "Partner Salary", "shareholderId": "mina"])] : [],
                "ammar": b > 0 ? [expense(["id": "a", "date": "2026-01-01", "amount": b, "category": "Partner Salary", "shareholderId": "ammar"])] : [],
            ]
            return ShareholderFigures.partnerPositions(partners: partners, ledgers: [:], salariesBy: salaries, totals: totals(expShare: 0, revShare: 0))
        }
        let g = ShareholderFigures.salaryGap(positions(30_000, 10_000))
        XCTAssertEqual(g?.ahead.name, "Mina")
        XCTAssertEqual(g?.behind.name, "Ammar")
        XCTAssertEqual(g?.transferred, 10_000)
        XCTAssertEqual(ShareholderFigures.salaryGap(positions(0, 8_000))?.ahead.name, "Ammar")
        XCTAssertNil(ShareholderFigures.salaryGap(positions(5_000.4, 5_000)))
        XCTAssertNil(ShareholderFigures.salaryGap(Array(positions(5_000, 0).prefix(1))))
    }

    // MARK: Each partner's position

    func testIsTheirLedgerPlusTheirHalfOfThePAndL() {
        let ledgers = [
            "mina": [row("m1", .payment, .equity, 100_000), row("m2", .payment, .loan, 40_000), row("m3", .withdrawal, .equity, 10_000)],
            "ammar": [row("a1", .payment, .equity, 60_000), row("a2", .withdrawal, .loan, 5_000)],
        ]
        let salaries = ["mina": [expense(["id": "s1", "date": "2026-01-10", "amount": 6_000, "description": "x"])], "ammar": []]
        let p = ShareholderFigures.partnerPositions(partners: partners, ledgers: ledgers, salariesBy: salaries, totals: totals(expShare: 13_000, revShare: 44_750))
        let mina = p[0], ammar = p[1]
        XCTAssertEqual(mina.id, "mina")
        XCTAssertEqual(mina.name, "Mina")
        XCTAssertEqual(mina.contributed, 140_000)
        XCTAssertEqual(mina.withdrawn, 10_000)
        XCTAssertEqual(mina.salaryPaid, 6_000)
        XCTAssertEqual(mina.balance, PartnerBalance(equityBalance: 90_000, loanBalance: 40_000, netPnL: 31_750, totalClaim: 161_750))
        XCTAssertEqual(mina.payments.map(\.id), ["m1", "m2"])
        XCTAssertEqual(mina.withdrawals.map(\.id), ["m3"])
        XCTAssertEqual(ammar.contributed, 60_000)
        XCTAssertEqual(ammar.withdrawn, 5_000)
        XCTAssertEqual(ammar.salaryPaid, 0)
        XCTAssertEqual(ammar.balance, PartnerBalance(equityBalance: 60_000, loanBalance: -5_000, netPnL: 31_750, totalClaim: 86_750))
    }

    func testAPartnerWithNoLedgerYetStandsAtTheirHalfOfThePAndL() {
        let p = ShareholderFigures.partnerPositions(partners: partners, ledgers: [:], salariesBy: [:], totals: totals(expShare: 10_000, revShare: 4_000))
        XCTAssertEqual(p[0].balance.totalClaim, -6_000)
        XCTAssertEqual(p[0].rows, [])
    }

    // MARK: A ledger document (ledgerRowFrom; the read: loadLedger)

    func testReadsAsThePageReadsIt() {
        let r = ERPDecode.model(ShareholderLedgerRow.self, from: [
            "id": "x1", "description": "Bank transfer", "amount": "25000", "category": "loan", "type": "withdrawal", "linkedExpenseId": "exp-1",
            "date": "2026-09-01T00:00:00.000Z",
        ])!
        XCTAssertEqual(r, ShareholderLedgerRow(id: "x1", description: "Bank transfer", amount: 25_000, date: "2026-09-01T00:00:00.000Z", category: .loan, type: .withdrawal, linkedExpenseId: "exp-1"))
    }

    func testAnEntryFromBeforeTheSplitIsEquityAnythingElseIsAPaymentAndPendingIsNoLink() {
        let r = ERPDecode.model(ShareholderLedgerRow.self, from: ["id": "x2", "amount": "lots", "linkedExpenseId": "pending"])!
        XCTAssertEqual(r, ShareholderLedgerRow(id: "x2", description: "", amount: 0, date: "", category: .equity, type: .payment, linkedExpenseId: nil))
    }

    func testTheLedgerReadIsNewestFirstAndLeavesOutARowWithNoDate() {
        let rows = [
            ShareholderLedgerRow(id: "old", description: "", amount: 1, date: "2026-01-01T00:00:00.000Z", category: .equity, type: .payment),
            ShareholderLedgerRow(id: "none", description: "", amount: 1, date: "", category: .equity, type: .payment),
            ShareholderLedgerRow(id: "new", description: "", amount: 1, date: "2026-03-01T00:00:00.000Z", category: .equity, type: .payment),
        ]
        XCTAssertEqual(ShareholderFigures.shown(rows).map(\.id), ["new", "old"])
    }
}
