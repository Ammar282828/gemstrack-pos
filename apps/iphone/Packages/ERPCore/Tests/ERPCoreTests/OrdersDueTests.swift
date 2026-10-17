import XCTest
@testable import ERPCore

/// Mirrors src/lib/orders-due.test.ts. `now` is 12 Oct 2026, 15:00 in Karachi (10:00 UTC); a day offset
/// is a promised day "2026-10-12" shifted, and createdAt is that day at 10:00 Karachi.
final class OrdersDueTests: XCTestCase {
    private let now = ERPDate.parse("2026-10-12T10:00:00Z")!

    private func dayString(_ offset: Int) -> String {
        String(format: "2026-10-%02d", 12 + offset)
    }
    private func iso(_ offset: Int) -> String {
        // 10:00 Karachi on that day is 05:00 UTC; offsets stay inside October, so the string is exact.
        dayString(offset) + "T05:00:00.000Z"
    }
    private func order(_ id: String, promised: Int? = nil, created: Int = -1, status: String = "Pending", invoice: String? = nil) -> Order {
        var f: [String: Any] = ["id": id, "status": status, "createdAt": iso(created)]
        if let promised { f["promisedDate"] = iso(promised) }
        if let invoice { f["invoiceId"] = invoice }
        return ERPDecode.model(Order.self, from: f)!
    }
    private func bucket(_ o: Order) -> OrdersDueBucket { OrdersDue.bucket(orderTiming(o, now: now)) }

    func testBucketThresholds() {
        XCTAssertEqual(bucket(order("a", promised: -1)), .late)
        XCTAssertEqual(bucket(order("a", promised: 0)), .today)
        XCTAssertEqual(bucket(order("a", promised: 1)), .week)
        XCTAssertEqual(bucket(order("a", promised: 7)), .week)
        XCTAssertEqual(bucket(order("a", promised: 8)), .later)
        XCTAssertEqual(bucket(order("a", promised: 18)), .later)
    }

    func testNoPromiseIsNoDateEvenWhenOldEnoughForTheAgeRule() {
        XCTAssertEqual(bucket(order("a", created: -11)), .undated)
        XCTAssertEqual(bucket(order("a", created: -1)), .undated)
    }

    func testOpenOrders() {
        XCTAssertTrue(OrdersDue.isOpen(order("a")))
        XCTAssertTrue(OrdersDue.isOpen(order("a", status: "Completed")))
        XCTAssertFalse(OrdersDue.isOpen(order("a", invoice: "INV-1")))
        XCTAssertFalse(OrdersDue.isOpen(order("a", status: "Cancelled")))
        XCTAssertFalse(OrdersDue.isOpen(order("a", status: "Refunded")))
    }

    func testBucketsInTheChaseOrderEmptyOnesLeftOut() {
        let g = OrdersDue.groups([order("later", promised: 19), order("late", promised: -3), order("none")], now: now)
        XCTAssertEqual(g.map(\.bucket), [.late, .later, .undated])
        XCTAssertEqual(OrdersDueBucket.allCases, [.late, .today, .week, .later, .undated])
    }

    func testInvoicedCancelledAndRefundedAreLeftOut() {
        let g = OrdersDue.groups([
            order("x1", promised: 0, invoice: "INV-1"),
            order("x2", promised: 0, status: "Cancelled"),
            order("x3", promised: 0, status: "Refunded"),
            order("ok", promised: 0),
        ], now: now)
        XCTAssertEqual(g.count, 1)
        XCTAssertEqual(g[0].bucket, .today)
        XCTAssertEqual(g[0].orders.map(\.id), ["ok"])
    }

    func testSoonestPromiseFirstSoTheLatestOfTheLateComesLast() {
        let g = OrdersDue.groups([order("b", promised: -1), order("a", promised: -5), order("c", promised: -3)], now: now)
        XCTAssertEqual(g[0].orders.map(\.id), ["a", "c", "b"])
    }

    func testTiesByDayTakenThenIdAndUndatedOldestFirst() {
        let g = OrdersDue.groups([
            order("z", promised: 2, created: -2),
            order("y", promised: 2, created: -9),
            order("x", promised: 2, created: -2),
            order("n2", created: -1),
            order("n1", created: -11),
        ], now: now)
        XCTAssertEqual(g.first { $0.bucket == .week }?.orders.map(\.id), ["y", "x", "z"])
        XCTAssertEqual(g.first { $0.bucket == .undated }?.orders.map(\.id), ["n1", "n2"])
    }
}
