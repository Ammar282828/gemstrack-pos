import XCTest
@testable import ERPCore

/// src/lib/exchange.test.ts, case for case.
final class ExchangeTests: XCTestCase {
    private func order(_ fields: [String: Any]) -> Order { ERPDecode.model(Order.self, from: fields)! }
    private func invoice(_ fields: [String: Any]) -> Invoice { ERPDecode.model(Invoice.self, from: fields)! }

    // MARK: reading older documents

    func testAnOrdersOneExchangeBecomesOneRow() {
        XCTAssertEqual(
            orderExchanges(order(["advanceInExchangeDescription": "Old ring 21k 5.2g", "advanceInExchangeValue": 95000])),
            [ExchangeEntry(description: "Old ring 21k 5.2g", value: 95000)]
        )
    }

    func testAnOrderWithNoExchangeHasNoRows() {
        XCTAssertEqual(orderExchanges(order(["advanceInExchangeValue": 0])), [])
        XCTAssertEqual(orderExchanges(nil), [])
    }

    func testAnInvoicesDescriptionAndTwoAmountsBecomeTwoRowsDescribedOnce() {
        XCTAssertEqual(
            invoiceExchanges(invoice(["exchangeDescription": "Old bangles", "exchangeAmount1": 50000, "exchangeAmount2": 20000])),
            [ExchangeEntry(description: "Old bangles", value: 50000), ExchangeEntry(description: "", value: 20000)]
        )
    }

    func testTheRowsWinOverTheOldFieldsWhenBothAreThere() {
        let rows = [ExchangeEntry(description: "Chain", karat: "22k", weightG: 10, ratePerGram: 20000, value: 200000)]
        let inv = invoice([
            "exchanges": [["description": "Chain", "karat": "22k", "weightG": 10, "ratePerGram": 20000, "value": 200000]],
            "exchangeDescription": "x", "exchangeAmount1": 1,
        ])
        XCTAssertEqual(invoiceExchanges(inv), rows)
    }

    // Not in the TS tests: the other shapes of an old document.
    func testAnOldInvoiceKeepsASecondAmountAloneAndANamedExchangeWithNoValue() {
        XCTAssertEqual(
            invoiceExchanges(invoice(["exchangeDescription": "Old chain", "exchangeAmount2": 7000])),
            [ExchangeEntry(description: "Old chain", value: 7000)]
        )
        XCTAssertEqual(
            invoiceExchanges(invoice(["exchangeDescription": " Old chain "])),
            [ExchangeEntry(description: "Old chain", value: 0)]
        )
        XCTAssertEqual(invoiceExchanges(invoice([:])), [])
        XCTAssertEqual(invoiceExchanges(nil), [])
    }

    // MARK: writing

    private let rows = [
        ExchangeEntry(description: "Old ring", karat: "22k", weightG: 5.2, ratePerGram: 21000, value: 109200),
        ExchangeEntry(description: "Broken chain", value: 40000),
        ExchangeEntry(description: "", value: 0),
    ]

    func testAnOrderKeepsTheRowsAndTheirTotalsInTheOldFields() {
        let f = orderExchangeFields(rows)
        XCTAssertEqual(f.exchanges.count, 2)
        XCTAssertEqual(f.advanceInExchangeValue, 149200)
        XCTAssertEqual(f.advanceInExchangeDescription, "Old ring · 22k · 5.2 g at 21,000/g; Broken chain")
    }

    func testAnInvoiceKeepsTheRowsAndOneTotalSoEveryOldReaderSumsRight() {
        let f = invoiceExchangeFields(rows)
        XCTAssertEqual(f?.exchangeAmount1, 149200)
        XCTAssertEqual(f?.exchanges.count, 2)
    }

    func testNothingExchangedWritesNothing() {
        XCTAssertNil(invoiceExchangeFields([]))
        // A named row with no value is kept, but there is no total to write.
        XCTAssertNil(invoiceExchangeFields([ExchangeEntry(description: "Old watch", value: 0)])?.exchangeAmount1)
    }

    func testTotalsAndDescriptions() {
        XCTAssertEqual(exchangeTotal(rows), 149200)
        XCTAssertEqual(describeExchangeEntry(ExchangeEntry(description: "", weightG: 3, value: 1)), "Gold · 3 g")
        // Just an amount, the simple exchange: no metal is named for it.
        XCTAssertEqual(describeExchangeEntry(ExchangeEntry(description: "", value: 5000)), "Exchange")
        XCTAssertEqual(describeExchangeEntry(ExchangeEntry(description: "Old watch", value: 5000)), "Old watch")
        XCTAssertEqual(describeExchangeEntry(ExchangeEntry(description: "", karat: "21k", value: 1)), "Gold · 21k")
        XCTAssertEqual(describeExchangeEntry(ExchangeEntry(description: "Ring", weightG: 2.5, value: 1)), "Ring · 2.5 g")
        XCTAssertEqual(describeExchangeEntry(ExchangeEntry(description: "Ring", weightG: 2, ratePerGram: 1234567.4, value: 1)), "Ring · 2 g at 1,234,567/g")
        XCTAssertEqual(exchangeTotal(nil), 0)
    }

    // MARK: rows as typed

    func testGramsTimesRateFillsTheValueUntilAValueIsTyped() {
        var r = blankExchangeRow()
        r = applyExchangeRowChange(r, ExchangeRowPatch(weightG: "5"))
        XCTAssertEqual(r.value, "")
        r = applyExchangeRowChange(r, ExchangeRowPatch(ratePerGram: "20000"))
        XCTAssertEqual(r.value, "100000")
        r = applyExchangeRowChange(r, ExchangeRowPatch(value: "95000"))
        r = applyExchangeRowChange(r, ExchangeRowPatch(weightG: "6"))
        XCTAssertEqual(r.value, "95000")
    }

    func testClearingATypedValueLetsGramsTimesRateFillItAgain() {
        var r = applyExchangeRowChange(blankExchangeRow(), ExchangeRowPatch(value: "5000"))
        r = applyExchangeRowChange(r, ExchangeRowPatch(value: ""))
        r = applyExchangeRowChange(r, ExchangeRowPatch(weightG: "2", ratePerGram: "10000"))
        XCTAssertEqual(r.value, "20000")
    }

    func testRoundTripsThroughWhatIsWrittenDroppingBlankRows() {
        let typed = [
            ExchangeRow(description: "Old ring", karat: "21k", weightG: "5.2", ratePerGram: "20000", value: "104000"),
            blankExchangeRow(),
        ]
        let written = exchangesFromRows(typed)
        XCTAssertEqual(written, [ExchangeEntry(description: "Old ring", karat: "21k", weightG: 5.2, ratePerGram: 20000, value: 104000)])
        XCTAssertEqual(exchangesFromRows(rowsFromExchanges(written)), written)
        XCTAssertEqual(exchangeRowsTotal(typed), 104000)
    }

    func testAnInvoiceWithNoExchangeOpensWithOneEmptyRowToTypeIn() {
        XCTAssertEqual(rowsFromExchanges([]).count, 1)
    }

    // Not in the TS tests: a row's id, and a half rupee rounding up as Math.round does.
    func testRowsGetTheirOwnIdsAndRoundTheComputedValueLikeMathRound() {
        XCTAssertEqual(blankExchangeRow().id.count, 7)
        XCTAssertNotEqual(blankExchangeRow().id, blankExchangeRow().id)
        let r = applyExchangeRowChange(blankExchangeRow(), ExchangeRowPatch(weightG: "2.5", ratePerGram: "100.2"))
        XCTAssertEqual(r.value, "251") // 250.5
    }
}
