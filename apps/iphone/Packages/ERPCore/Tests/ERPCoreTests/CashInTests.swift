import XCTest
@testable import ERPCore

/// src/lib/analytics/cash-in.test.ts, case for case.
final class CashInTests: XCTestCase {
    private func at(_ iso: String) -> Date { ERPDate.parse(iso)! }
    private func invoice(_ fields: [String: Any]) -> Invoice { ERPDecode.model(Invoice.self, from: fields)! }
    private func order(_ fields: [String: Any]) -> Order { ERPDecode.model(Order.self, from: fields)! }

    private lazy var september = Period(from: at("2026-09-01T00:00:00Z"), to: at("2026-09-30T23:59:59Z"))
    private lazy var august = Period(from: at("2026-08-01T00:00:00Z"), to: at("2026-08-31T23:59:59Z"))

    // An order placed in August with 50,000 cash and 30,000 of gold, and a second advance of
    // 20,000 in September.
    private let openOrder: [String: Any] = [
        "id": "ORD-000123",
        "status": "In Progress",
        "createdAt": "2026-08-20T10:00:00.000Z",
        "advancePayment": 70000,
        "advances": [["amount": 20000, "date": "2026-09-10T12:00:00.000Z"]],
        "exchanges": [["description": "Old 22k ring", "value": 30000]],
        "advanceInExchangeValue": 30000,
    ]

    private func orderWith(_ changes: [String: Any]) -> [String: Any] { openOrder.merging(changes) { _, new in new } }

    private func run(_ period: Period, _ invoices: [[String: Any]], _ orders: [[String: Any]], _ extraRevenues: [[String: Any]] = []) -> CashIn {
        let invs = invoices.map(invoice)
        let ords = orders.map(order)
        return cashInForPeriod(
            invoices: invs, orders: ords, invoiced: invoicedOrderIds(ords, invs),
            extraRevenues: extraRevenues.map { ERPDecode.model(AdditionalRevenue.self, from: $0)! }, period: period
        )
    }

    private func paymentFields(_ p: Payment) -> [String: Any] {
        var fields: [String: Any] = ["amount": p.amount, "date": p.date]
        if let notes = p.notes { fields["notes"] = notes }
        if let method = p.method { fields["method"] = method.rawValue }
        return fields
    }

    func testAnOpenOrderItsCashAdvancesOnTheirOwnDaysItsGoldAsCashOnTheOrderDay() {
        let a = run(august, [], [openOrder])
        XCTAssertEqual(a.orderAdvances, 50000)
        XCTAssertEqual(a.exchange, 30000)
        XCTAssertEqual(a.total, 80000)
        XCTAssertEqual(a.exchangeOffInvoices, 0)
        let s = run(september, [], [openOrder])
        XCTAssertEqual(s.orderAdvances, 20000)
        XCTAssertEqual(s.exchange, 0)
        XCTAssertEqual(s.total, 20000)
    }

    func testFinalisingTheOrderMovesNothingItsAdvancesAreCountedOnceOnTheInvoice() {
        // As generateInvoiceFromOrder writes it since 2026-09-25.
        let invoiceFields: [String: Any] = [
            "createdAt": "2026-09-15T09:00:00.000Z", "sourceOrderId": "ORD-000123",
            "paymentHistory": orderAdvancePayments(order(openOrder)).map(paymentFields) + [["amount": 25000, "date": "2026-09-15T09:00:00.000Z"]],
            "exchanges": openOrder["exchanges"]!, "exchangeAmount1": 30000,
        ]
        let inv = invoice(invoiceFields)
        let finalised = order(orderWith(["status": "Completed", "invoiceId": "INV-000900"]))
        func cashIn(_ period: Period) -> CashIn {
            cashInForPeriod(
                invoices: [inv], orders: [finalised], invoiced: invoicedOrderIds([finalised], [inv]), extraRevenues: [], period: period,
                invoiceDate: { _ in "2026-08-20T10:00:00.000Z" } // its revenue date, the order's
            )
        }
        let a = cashIn(august)
        XCTAssertEqual(a.invoicePayments, 50000)
        XCTAssertEqual(a.orderAdvances, 0)
        XCTAssertEqual(a.exchange, 30000)
        XCTAssertEqual(a.total, 80000)
        XCTAssertEqual(a.exchangeOffInvoices, 30000)
        let s = cashIn(september)
        XCTAssertEqual(s.invoicePayments, 45000)
        XCTAssertEqual(s.orderAdvances, 0)
        XCTAssertEqual(s.exchange, 0)
        XCTAssertEqual(s.total, 45000)
    }

    func testAnOrderOnlyItsInvoicePointsToOlderDataIsNotCountedAgain() {
        let inv: [String: Any] = ["createdAt": "2026-08-25T09:00:00.000Z", "sourceOrderId": "ORD-000123",
                                  "paymentHistory": [["amount": 50000, "date": "2026-08-20T10:00:00.000Z"]]]
        let unlinked = orderWith(["advances": [], "advancePayment": 50000, "status": "Completed"])
        let r = run(august, [inv], [unlinked])
        XCTAssertEqual(r.invoicePayments, 50000)
        XCTAssertEqual(r.orderAdvances, 0)
        XCTAssertEqual(r.total, 50000)
    }

    func testAnOlderInvoicesLumpedOrderAdvanceCountsWholeItsGoldUnderExchange() {
        let inv: [String: Any] = [
            "createdAt": "2026-08-25T09:00:00.000Z", "sourceOrderId": "ORD-000050",
            "paymentHistory": [
                ["amount": 80000, "date": "2026-08-02T10:00:00.000Z", "notes": "Advance from Order. Cash: 50000. Exchange: 30000 (Old 22k ring)"],
                ["amount": 10000, "date": "2026-08-25T09:00:00.000Z"],
            ],
        ]
        let r = run(august, [inv], [])
        XCTAssertEqual(r.invoicePayments, 60000)
        XCTAssertEqual(r.exchange, 30000)
        XCTAssertEqual(r.total, 90000)
        XCTAssertEqual(r.exchangeOffInvoices, 0)
    }

    func testGoldTakenAtTheCounterIsCashOnTheDayOfTheSale() {
        let inv: [String: Any] = ["createdAt": "2026-09-12T09:00:00.000Z", "exchangeDescription": "Old bangle", "exchangeAmount1": 40000,
                                  "paymentHistory": [["amount": 60000, "date": "2026-09-12T09:00:00.000Z"]]]
        let s = run(september, [inv], [])
        XCTAssertEqual(s.invoicePayments, 60000)
        XCTAssertEqual(s.exchange, 40000)
        XCTAssertEqual(s.total, 100000)
        XCTAssertEqual(s.exchangeOffInvoices, 40000)
        XCTAssertEqual(run(august, [inv], []).total, 0)
    }

    func testCancelledAndRefundedOrdersAndRefundedInvoicesBringNoCash() {
        let inv: [String: Any] = ["status": "Refunded", "createdAt": "2026-09-01T00:00:00.000Z",
                                  "paymentHistory": [["amount": 9000, "date": "2026-09-02T00:00:00.000Z"]]]
        let cancelled = orderWith(["id": "ORD-1", "status": "Cancelled"])
        let refunded = orderWith(["id": "ORD-2", "status": "Refunded"])
        XCTAssertEqual(run(september, [inv], [cancelled, refunded]).total, 0)
    }

    func testExtraRevenueInThePeriodIsCashNoPeriodCountsEverything() {
        let extras: [[String: Any]] = [["date": "2026-09-05T00:00:00.000Z", "amount": 4000], ["date": "2026-08-05T00:00:00.000Z", "amount": 1000]]
        let s = run(september, [], [], extras)
        XCTAssertEqual(s.extraRevenue, 4000)
        XCTAssertEqual(s.total, 4000)
        let all = run(Period(from: nil, to: nil), [], [openOrder], extras)
        XCTAssertEqual(all.orderAdvances, 70000)
        XCTAssertEqual(all.exchange, 30000)
        XCTAssertEqual(all.extraRevenue, 5000)
        XCTAssertEqual(all.total, 105000)
    }

    // MARK: paymentExchangePart

    func testReadsTheExchangeOutOfAnOlderOrderAdvance() {
        XCTAssertEqual(paymentExchangePart(Payment(amount: 80000, date: "", notes: "Advance from Order. Cash: 50000. Exchange: 30000 (Old ring)")), 30000)
    }

    func testKeepsItsShareWhenTheAmountWasScaledForACoinOnTheBill() {
        XCTAssertEqual(paymentExchangePart(Payment(amount: 40000, date: "", notes: "Advance from Order. Cash: 50000. Exchange: 30000 ()")), 15000)
    }

    func testAMissingCashFigureMeansItWasAllExchange() {
        XCTAssertEqual(paymentExchangePart(Payment(amount: 30000, date: "", notes: "Advance from Order. Cash: undefined. Exchange: 30000 ()")), 30000)
    }

    func testAnythingElseIsAllCash() {
        XCTAssertEqual(paymentExchangePart(Payment(amount: 50000, date: "", notes: "Advance from Order. Cash: 50000. Exchange: 0 ()")), 0)
        XCTAssertEqual(paymentExchangePart(Payment(amount: 50000, date: "", notes: "Advance payment from custom order.")), 0)
        XCTAssertEqual(paymentExchangePart(Payment(amount: 50000, date: "", notes: "Advance on order ORD-000123")), 0)
        XCTAssertEqual(paymentExchangePart(Payment(amount: 50000, date: "")), 0)
    }

    // Not in the TS tests: the note is read whatever its case, the share rounds to paise, and a
    // payment of nothing has no share.
    func testTheNoteIsReadInAnyCaseAndTheShareRoundsToPaise() {
        XCTAssertEqual(paymentExchangePart(Payment(amount: 100, date: "", notes: "advance from order. cash: 1. exchange: 2 (x)")), 66.67)
        XCTAssertEqual(paymentExchangePart(Payment(amount: 0, date: "", notes: "Advance from Order. Cash: 50000. Exchange: 30000 ()")), 0)
        XCTAssertEqual(paymentExchangePart(Payment(amount: 1000, date: "", notes: "Advance from Order. Cash: 0. Exchange: 1e3 ()")), 1000)
    }

    // A bare day is Karachi's midnight in a period test, as date-fns' parseISO reads it.
    func testABareDayIsKarachisMidnight() {
        let inv: [String: Any] = ["createdAt": "2026-09-01", "paymentHistory": [["amount": 100, "date": "2026-09-01"]]]
        // 2026-08-31T19:00:00Z is Karachi's midnight; a period starting a minute later misses it, one ending a minute earlier too.
        XCTAssertEqual(run(Period(from: at("2026-08-31T19:00:00Z"), to: at("2026-09-01T18:59:59Z")), [inv], []).invoicePayments, 100)
        XCTAssertEqual(run(Period(from: at("2026-08-31T19:01:00Z"), to: nil), [inv], []).invoicePayments, 0)
    }
}
