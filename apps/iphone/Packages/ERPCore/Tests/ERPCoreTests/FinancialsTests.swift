import XCTest
@testable import ERPCore

/// src/lib/financials.ts. It has no test of its own, so the figures below were printed by the
/// TypeScript for the made-up invoices and notes beside them, and are compared exactly.
final class FinancialsTests: XCTestCase {
    private func invoice(_ fields: [String: Any]) -> Invoice { ERPDecode.model(Invoice.self, from: fields)! }
    private func order(_ fields: [String: Any]) -> Order { ERPDecode.model(Order.self, from: fields)! }

    // MARK: What an invoice should total

    func testTheLinesLessDiscountAndExchangePlusAdjustments() {
        let like = InvoiceLike(subtotal: 100000, discountAmount: 5000, exchangeAmount1: 20000, exchangeAmount2: 3000.5, adjustmentsAmount: 1500)
        XCTAssertEqual(getInvoiceExpectedGrandTotal(like), 73499.5)
        XCTAssertEqual(getInvoiceExchangeTotal(like), 23000.5)
        XCTAssertEqual(getInvoiceAdjustmentsAmount(like), 1500)
    }

    func testAFigureThatIsAbsentIsNothing() {
        XCTAssertEqual(getInvoiceExpectedGrandTotal(InvoiceLike(subtotal: 50000)), 50000)
        XCTAssertEqual(getInvoiceExchangeTotal(InvoiceLike(subtotal: 50000)), 0)
        XCTAssertEqual(getInvoiceAdjustmentsAmount(InvoiceLike(subtotal: 50000)), 0)
        XCTAssertEqual(getInvoiceExpectedGrandTotal(InvoiceLike()), 0)
    }

    func testNoInvoiceIsNothing() {
        XCTAssertEqual(getInvoiceExpectedGrandTotal(nil), 0)
        XCTAssertEqual(getInvoiceExchangeTotal(nil), 0)
        XCTAssertEqual(getInvoiceAdjustmentsAmount(nil), 0)
    }

    func testAFigureThatIsNotANumberIsNothing() {
        // Number(NaN) || 0: only the 7 of exchange is left, and it comes off.
        let like = InvoiceLike(subtotal: .nan, discountAmount: .nan, exchangeAmount1: .nan, exchangeAmount2: 7, adjustmentsAmount: .nan)
        XCTAssertEqual(getInvoiceExpectedGrandTotal(like), -7)
        XCTAssertEqual(getInvoiceExchangeTotal(like), 7)
    }

    func testTheSumIsTakenInTheOrderTheTypeScriptTakesIt() {
        // 0.1 - 0.2 - (0.3 + 0.05) + 0.4 in doubles.
        let like = InvoiceLike(subtotal: 0.1, discountAmount: 0.2, exchangeAmount1: 0.3, exchangeAmount2: 0.05, adjustmentsAmount: 0.4)
        XCTAssertEqual(getInvoiceExpectedGrandTotal(like), -0.04999999999999993)
        XCTAssertEqual(getInvoiceExchangeTotal(like), 0.35)
    }

    func testADiscountBiggerThanTheLinesGoesBelowZero() {
        XCTAssertEqual(getInvoiceExpectedGrandTotal(InvoiceLike(subtotal: 10000, discountAmount: 12000)), -2000)
        XCTAssertEqual(
            getInvoiceExpectedGrandTotal(InvoiceLike(subtotal: 120000.55, discountAmount: 2500.25, exchangeAmount1: 41234.5, adjustmentsAmount: -300)),
            75965.8
        )
    }

    func testReadsTheInvoiceModelToo() {
        let inv = invoice(["subtotal": 100000, "discountAmount": 5000, "exchangeAmount1": 20000, "exchangeAmount2": 3000.5, "adjustmentsAmount": 1500])
        XCTAssertEqual(getInvoiceExpectedGrandTotal(inv), 73499.5)
        XCTAssertEqual(getInvoiceExchangeTotal(inv), 23000.5)
        XCTAssertEqual(getInvoiceAdjustmentsAmount(inv), 1500)
        // An older invoice with no exchange or adjustments at all.
        XCTAssertEqual(getInvoiceExpectedGrandTotal(invoice(["subtotal": 50000])), 50000)
    }

    // MARK: Placeholder orders

    func testAnOrderRestoredFromTheActivityLogSaysSoInItsNotes() {
        let note = "[RESTORED FROM ACTIVITY LOG — original order was overwritten. Items unknown. Please fill in manually.]"
        XCTAssertTrue(isRestoredPlaceholderOrder(OrderLike(notes: note)))
        XCTAssertTrue(isRestoredPlaceholderOrder(order(["notes": note])))
        XCTAssertTrue(isRestoredPlaceholderOrder(OrderLike(notes: "Call first. [RESTORED FROM ACTIVITY LOG")))
    }

    func testAnyOtherOrderIsNotAPlaceholder() {
        XCTAssertFalse(isRestoredPlaceholderOrder(OrderLike(notes: "restored from activity log")))
        XCTAssertFalse(isRestoredPlaceholderOrder(OrderLike(notes: "[RESTORED FROM")))
        XCTAssertFalse(isRestoredPlaceholderOrder(OrderLike(notes: "Ring for Eid")))
        XCTAssertFalse(isRestoredPlaceholderOrder(OrderLike(notes: "")))
        XCTAssertFalse(isRestoredPlaceholderOrder(OrderLike()))
        XCTAssertFalse(isRestoredPlaceholderOrder(nil))
        XCTAssertFalse(isRestoredPlaceholderOrder(order([:])))
    }

    // MARK: Delivery (#1460: two pieces of 4,000, delivery 350, paid 8,350)

    func testDeliveryIsPartOfTheTotalAndNeverAPiece() {
        let o = order(["deliveryCharge": 350, "subtotal": 8350])
        XCTAssertEqual(orderDeliveryCharge(o), 350)
        XCTAssertEqual(orderGrandTotal(pieces: 8000, delivery: orderDeliveryCharge(o)), 8350)
        XCTAssertEqual(orderGrandTotal(pieces: 8000, discount: 1000, exchange: 500, delivery: 350), 6850)
        XCTAssertEqual(orderDeliveryCharge(order([:])), 0)
        XCTAssertEqual(orderDeliveryCharge(order(["deliveryCharge": -5])), 0)
    }

    func testTheAdjustmentsRowReadsDeliveryForAShopifySaleOrOneWithADeliveryCharge() {
        XCTAssertEqual(adjustmentsLabel(invoice(["deliveryCharge": 350])), "Delivery")
        XCTAssertEqual(adjustmentsLabel(invoice(["source": "shopify"])), "Delivery")
        XCTAssertEqual(adjustmentsLabel(invoice(["source": "shopify_import"])), "Delivery")
        XCTAssertEqual(adjustmentsLabel(invoice(["adjustmentsAmount": 100])), "Adjustments")
        XCTAssertEqual(adjustmentsLabel(invoice(["deliveryCharge": 0])), "Adjustments")
        XCTAssertEqual(invoice(["deliveryCharge": "350"]).deliveryCharge, 350)
    }
}
