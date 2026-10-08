import XCTest
@testable import ERPCore

/// src/lib/analytics/sale-value.test.ts, case for case.
final class SaleValueTests: XCTestCase {
    private func invoice(_ fields: [String: Any]) -> Invoice { ERPDecode.model(Invoice.self, from: fields)! }

    func testASalePaidWhollyInOldGoldIsWorthWhatWasSoldNotNothing() {
        // INV-000007 as stored: 700,090 sold, 12,090 off, 688,000 in exchange → grandTotal 0.
        XCTAssertEqual(invoiceSaleValue(invoice(["grandTotal": 0, "exchangeAmount1": 688000])), 688000)
    }

    func testPartExchangeTheCashPartPlusTheExchange() {
        XCTAssertEqual(
            invoiceSaleValue(invoice(["grandTotal": 25000, "exchanges": [["description": "Old ring", "value": 60000], ["description": "", "value": 15000]]])),
            100000
        )
    }

    func testTheExchangeListWinsOverTheOldTotalsItAlsoWrites() {
        XCTAssertEqual(
            invoiceSaleValue(invoice(["grandTotal": 10, "exchanges": [["description": "", "value": 5]], "exchangeAmount1": 5])),
            15
        )
    }

    func testNoExchangeFieldOlderInvoicesKeptItInAPaymentTheTotalAsItIs() {
        XCTAssertEqual(invoiceSaleValue(invoice(["grandTotal": 991324.95])), 991324.95)
        XCTAssertEqual(invoiceSaleValue(invoice(["grandTotal": 5000, "exchangeDescription": "old chain"])), 5000)
        XCTAssertEqual(invoiceSaleValue(nil), 0)
    }
}
