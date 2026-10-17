import XCTest
@testable import ERPCore

/// src/lib/invoice-actions.test.ts, case for case. All figures made up.
final class InvoiceActionsTests: XCTestCase {
    private typealias F = InvoiceActions.Figures
    private func invoice(_ fields: [String: Any]) -> Invoice { ERPDecode.model(Invoice.self, from: fields)! }

    // MARK: Changing the discount

    func testRefusesWhatTheInvoicePageRefusesInItsWords() {
        XCTAssertNil(InvoiceActions.discountProblem(subtotal: 100_000, discount: 5_000))
        XCTAssertNil(InvoiceActions.discountProblem(subtotal: 100_000, discount: 100_000))
        XCTAssertNil(InvoiceActions.discountProblem(subtotal: 100_000, discount: 0))
        XCTAssertEqual(InvoiceActions.discountProblem(subtotal: 100_000, discount: -1), "Discount cannot be negative.")
        XCTAssertEqual(InvoiceActions.discountProblem(subtotal: 100_000, discount: 100_001), "Discount cannot exceed subtotal.")
        XCTAssertEqual(InvoiceActions.discountProblem(subtotal: 100_000, discount: .nan), "Enter the discount.")
        XCTAssertEqual(InvoiceActions.discountProblem(subtotal: nil, discount: 1), "Discount cannot exceed subtotal.")
        XCTAssertNil(InvoiceActions.discountProblem(subtotal: nil, discount: 0))
    }

    func testTakesTheDiscountAndTheExchangeOffTheLinesAndOwesOnWhatWasPaid() {
        XCTAssertEqual(InvoiceActions.withDiscount(F(subtotal: 250_000, exchangeAmount1: 40_000, exchangeAmount2: 5_000, amountPaid: 100_000), discount: 15_000),
                       InvoiceActions.Discounted(discountAmount: 15_000, grandTotal: 190_000, balanceDue: 90_000))
    }

    func testABiggerDiscountThanWhatIsLeftOwingPutsTheInvoiceInCredit() {
        XCTAssertEqual(InvoiceActions.withDiscount(F(subtotal: 50_000, amountPaid: 48_000), discount: 5_000),
                       InvoiceActions.Discounted(discountAmount: 5_000, grandTotal: 45_000, balanceDue: -3_000))
    }

    func testAFigureMissingFromAnOldInvoiceIsNothing() {
        XCTAssertEqual(InvoiceActions.withDiscount(F(), discount: 0), InvoiceActions.Discounted(discountAmount: 0, grandTotal: 0, balanceDue: 0))
        XCTAssertEqual(InvoiceActions.withDiscount(F(subtotal: 10_000, exchangeAmount1: nil, amountPaid: .nan), discount: 1_000),
                       InvoiceActions.Discounted(discountAmount: 1_000, grandTotal: 9_000, balanceDue: 9_000))
    }

    func testTheDiscountWorksInWholeRupeesTheDiscountTheTotalAndTheBalanceAreEachRounded() {
        XCTAssertEqual(InvoiceActions.withDiscount(F(subtotal: 1000.1, exchangeAmount1: 0.2, exchangeAmount2: 0.3, amountPaid: 0.7), discount: 0.05),
                       InvoiceActions.Discounted(discountAmount: 0, grandTotal: 1000, balanceDue: 999))
        // An older bill with paise: what it comes to and what is left read as whole rupees.
        XCTAssertEqual(InvoiceActions.withDiscount(F(subtotal: 297_000.4, amountPaid: 100_000.3), discount: 2_340.6),
                       InvoiceActions.Discounted(discountAmount: 2_341, grandTotal: 294_659, balanceDue: 194_659))
    }

    func testReadsTheFiguresOffTheInvoice() {
        let inv = invoice(["id": "INV-1", "subtotal": 250_000, "exchangeAmount1": 40_000, "exchangeAmount2": 5_000, "amountPaid": 100_000, "grandTotal": 205_000,
                           "paymentHistory": [["amount": 100_000, "date": "d"]]])
        XCTAssertEqual(InvoiceActions.withDiscount(F(inv), discount: 15_000).balanceDue, 90_000)
        XCTAssertEqual(F(inv).payments, [100_000])
    }

    // MARK: A partial refund

    func testIsMoneyOutOnTheHistoryWithTheReasonInItsNote() {
        XCTAssertEqual(InvoiceActions.refundEntry(amount: 1_500, date: "2026-10-09T10:00:00.000Z", reason: "damaged item"),
                       Payment(amount: -1_500, date: "2026-10-09T10:00:00.000Z", notes: "Refund: damaged item"))
        XCTAssertEqual(InvoiceActions.refundEntry(amount: -1_500, date: "d"), Payment(amount: -1_500, date: "d", notes: "Refund"))
        XCTAssertEqual(InvoiceActions.refundEntry(amount: 1_500, date: "d", reason: ""), Payment(amount: -1_500, date: "d", notes: "Refund"))
    }

    func testRecomputesWhatIsPaidFromTheWholeHistoryAndOwesTheRest() {
        let out = InvoiceActions.withRefund(F(grandTotal: 120_000, payments: [50_000, 70_000]), amount: 20_000)
        XCTAssertEqual(out.amountPaid, 100_000)
        XCTAssertEqual(out.balanceDue, 20_000)
        XCTAssertEqual(out.payments, [50_000, 70_000, -20_000])
    }

    func testReadsTheHistoryNotTheStoredTotal() {
        let out = InvoiceActions.withRefund(F(grandTotal: 1_000, amountPaid: 999, payments: [1_000]), amount: 100)
        XCTAssertEqual(out.amountPaid, 900)
        XCTAssertEqual(out.balanceDue, 100)
    }

    func testWithNothingPaidItGoesBelowNothingAsTheStoreRecordsIt() {
        let out = InvoiceActions.withRefund(F(grandTotal: 5_000), amount: 500)
        XCTAssertEqual(out.amountPaid, -500)
        XCTAssertEqual(out.balanceDue, 5_500)
    }

    func testAPaymentWithNoAmountCountsAsNothing() {
        let out = InvoiceActions.withRefund(F(grandTotal: 1_000, payments: [nil, 300]), amount: 100)
        XCTAssertEqual(out.amountPaid, 200)
        XCTAssertEqual(out.balanceDue, 800)
    }

    func testTheRefundWorksInWholeRupees() {
        let out = InvoiceActions.withRefund(F(grandTotal: 1_000, payments: [600.4, 200.2]), amount: 50.4)
        XCTAssertEqual(out.amountPaid, 751)
        XCTAssertEqual(out.balanceDue, 249)
    }

    // MARK: Deleting one payment

    func testTakesItOffAndOwesItAgain() {
        XCTAssertEqual(InvoiceActions.withoutPayment(F(grandTotal: 288_250, payments: [30_000, 258_250]), index: 0),
                       InvoiceActions.Paid(payments: [258_250], amountPaid: 258_250, balanceDue: 30_000))
    }

    func testDeletingARefundPutsTheMoneyBackAsPaid() {
        let out = InvoiceActions.withoutPayment(F(grandTotal: 10_000, payments: [10_000, -2_000]), index: 1)
        XCTAssertEqual(out?.amountPaid, 10_000)
        XCTAssertEqual(out?.balanceDue, 0)
    }

    func testThereIsNothingToDeleteOutsideTheHistory() {
        let inv = F(grandTotal: 1_000, payments: [500, 500])
        XCTAssertNil(InvoiceActions.withoutPayment(inv, index: 2))
        XCTAssertNil(InvoiceActions.withoutPayment(inv, index: -1))
        // The TypeScript also refuses a place that is not a whole number (0.5); an Int always is one.
        XCTAssertNil(InvoiceActions.withoutPayment(F(grandTotal: 1_000), index: 0))
    }

    func testDeletingWorksInWholeRupees() {
        let out = InvoiceActions.withoutPayment(F(grandTotal: 1_000, payments: [100.1, 200.2, 400.4]), index: 0)
        XCTAssertEqual(out?.amountPaid, 601)
        XCTAssertEqual(out?.balanceDue, 399)
    }

    // MARK: The pieces a deleted invoice puts back in stock

    func testEachOnceNeverAnOrdersPieceNeverOneAnotherInvoiceAlsoSold() {
        let inv = invoice(["id": "INV-2", "items": [["sku": "RNG-001"], ["sku": "ORD-000003-1"], ["sku": "NEW-ABC"], ["sku": "BNG-002"], ["sku": ""], ["sku": "RNG-001"]]])
        let others = [
            invoice(["id": "INV-2", "items": [["sku": "RNG-001"]]]),        // itself: no reason to keep a piece sold
            invoice(["id": "INV-1", "items": ["0": ["sku": "BNG-002"]]]),   // an old invoice keeping its lines as a map
            invoice(["id": "INV-3", "items": NSNull()]),
        ]
        XCTAssertEqual(InvoiceActions.piecesBackInStock(inv, others: others).map(\.sku), ["RNG-001", "NEW-ABC"])
    }

    func testReadsAnInvoiceKeptAsAMapAndOneWithNoLines() {
        XCTAssertEqual(InvoiceActions.piecesBackInStock(invoice(["id": "INV-4", "items": ["0": ["sku": "A-1"], "1": ["sku": "B-2"]]]), others: []).map(\.sku), ["A-1", "B-2"])
        XCTAssertEqual(InvoiceActions.piecesBackInStock(invoice(["id": "INV-5"]), others: []), [])
    }
}
