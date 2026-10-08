import XCTest
@testable import ERPCore

/// src/lib/order-payment.test.ts, case for case, and the payment status its comment explains.
final class OrderPaymentTests: XCTestCase {
    private func order(_ fields: [String: Any]) -> Order { ERPDecode.model(Order.self, from: fields)! }

    private let base: [String: Any] = ["id": "ORD-000123", "createdAt": "2026-09-01T10:00:00.000Z"]
    private func withBase(_ fields: [String: Any]) -> Order {
        order(base.merging(fields) { _, new in new })
    }

    // MARK: orderAdvancePayments

    func testAnAdvanceTakenWithTheOrderIsOnePaymentOnTheOrderDateAsItWasPaid() {
        XCTAssertEqual(
            orderAdvancePayments(withBase(["advancePayment": 50000, "advanceMethod": "Bank Transfer"])),
            [Payment(amount: 50000, date: "2026-09-01T10:00:00.000Z", notes: "Advance on order ORD-000123", method: .bankTransfer)]
        )
    }

    func testAdvancesRecordedLaterKeepTheirOwnDayMethodAndNote() {
        let later: [String: Any] = ["amount": 20000, "date": "2026-09-10T12:00:00.000Z", "method": "Cash", "notes": "Second advance"]
        XCTAssertEqual(
            orderAdvancePayments(withBase(["advancePayment": 70000, "advances": [later]])),
            [
                Payment(amount: 50000, date: "2026-09-01T10:00:00.000Z", notes: "Advance on order ORD-000123"),
                Payment(amount: 20000, date: "2026-09-10T12:00:00.000Z", notes: "Advance on order ORD-000123: Second advance", method: .cash),
            ]
        )
    }

    func testAllOfItRecordedLaterNoPaymentOnTheOrderDate() {
        let later: [String: Any] = ["amount": 30000, "date": "2026-09-10T12:00:00.000Z"]
        XCTAssertEqual(orderAdvancePayments(withBase(["advancePayment": 30000, "advances": [later]])).count, 1)
    }

    func testATotalEditedBelowItsListIsTrustedAsOneAdvance() {
        let later: [String: Any] = ["amount": 30000, "date": "2026-09-10T12:00:00.000Z"]
        XCTAssertEqual(
            orderAdvancePayments(withBase(["advancePayment": 10000, "advances": [later]])),
            [Payment(amount: 10000, date: "2026-09-01T10:00:00.000Z", notes: "Advance on order ORD-000123")]
        )
    }

    func testNoAdvanceNoPayments() {
        XCTAssertEqual(orderAdvancePayments(withBase(["advancePayment": 0])), [])
    }

    // MARK: withoutOrderAdvance

    private var advancedOrder: Order {
        order([
            "id": "ORD-1", "createdAt": "2026-09-01", "advancePayment": 100_000, "advanceMethod": "Cash",
            "advances": [
                ["amount": 30_000, "date": "2026-09-10", "method": "Bank Transfer"],
                ["amount": 0, "date": "x"],
                ["amount": 20_000, "date": "2026-09-20"],
            ],
        ])
    }

    func testTheAdvanceTakenWithTheOrderGoesWithItsMethod() {
        let r = withoutOrderAdvance(advancedOrder, lineIndex: 0)
        XCTAssertEqual(r?.advancePayment, 50_000)
        XCTAssertEqual(r?.dropMethod, true)
        XCTAssertEqual(r?.removed.amount, 50_000)
        XCTAssertEqual(r?.advances.count, 3)
    }

    func testALaterAdvanceComesOffTheListAndTheTotal() {
        let r = withoutOrderAdvance(advancedOrder, lineIndex: 2)
        XCTAssertEqual(r?.advancePayment, 80_000)
        XCTAssertEqual(r?.dropMethod, false)
        XCTAssertEqual(r?.removed.amount, 20_000)
        XCTAssertEqual(r?.advances.map(\.amount), [30_000, 0])
    }

    func testATotalEditedBelowItsListGoesAsTheOneAdvanceItIsShownAs() {
        let edited = order([
            "id": "ORD-1", "createdAt": "2026-09-01", "advancePayment": 10_000, "advanceMethod": "Cash",
            "advances": [["amount": 30_000, "date": "2026-09-10"], ["amount": 0, "date": "x"], ["amount": 20_000, "date": "2026-09-20"]],
        ])
        let r = withoutOrderAdvance(edited, lineIndex: 0)
        XCTAssertEqual(r?.advancePayment, 0)
        XCTAssertEqual(r?.advances, [])
        XCTAssertEqual(r?.dropMethod, true)
    }

    func testNothingForALineThatIsNotThere() {
        XCTAssertNil(withoutOrderAdvance(advancedOrder, lineIndex: 9))
        XCTAssertNil(withoutOrderAdvance(advancedOrder, lineIndex: -1))
    }

    // MARK: getOrderPaymentStatus (no TS test; the cases are the ones its comment names)

    func testPaymentStatusIsDecidedByTheBalanceAlone() {
        // 100,000 with 60,000 down is stored as a grandTotal of 40,000: Partial, never Paid.
        XCTAssertEqual(getOrderPaymentStatus(order(["grandTotal": 40_000, "advancePayment": 60_000])), .partial)
        XCTAssertEqual(getOrderPaymentStatus(order(["grandTotal": 100_000, "advancePayment": 0])), .unpaid)
        XCTAssertEqual(getOrderPaymentStatus(order(["grandTotal": 0, "advancePayment": 100_000])), .paid)
        XCTAssertEqual(getOrderPaymentStatus(order(["grandTotal": 70_000, "advancePayment": 0, "advanceInExchangeValue": 30_000])), .partial)
        XCTAssertEqual(getOrderPaymentStatus(order([:])), .paid)
    }
}
