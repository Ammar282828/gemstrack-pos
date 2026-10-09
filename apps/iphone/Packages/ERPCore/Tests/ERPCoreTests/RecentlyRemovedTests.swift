import XCTest
@testable import ERPCore

/// src/lib/recently-removed.test.ts, case for case. Ids made up.
final class RecentlyRemovedTests: XCTestCase {
    private func entry(_ f: [String: Any]) -> HisaabEntry { ERPDecode.model(HisaabEntry.self, from: f)! }
    private func order(_ f: [String: Any]) -> Order { ERPDecode.model(Order.self, from: f)! }

    private var history: [String: RecentlyRemoved.History] {
        RecentlyRemoved.removedHistory(
            hisaab: [entry(["entityId": "cust-1"]), entry(["entityId": "cust-1"]), entry(["entityId": "kar-1"]), entry(["entityId": ""]), entry([:])],
            orders: [order(["customerId": "cust-1"]), order(["customerId": "cust-2"]), order(["customerId": "kar-1"]), order([:])]
        )
    }

    func testCountsLedgerEntriesByPersonAndOrdersByCustomer() {
        let h = history
        XCTAssertEqual(h["cust-1"], RecentlyRemoved.History(entries: 2, orders: 1))
        XCTAssertEqual(h["cust-2"], RecentlyRemoved.History(entries: 0, orders: 1))
        XCTAssertEqual(h["kar-1"], RecentlyRemoved.History(entries: 1, orders: 1))
        XCTAssertNil(h[""])
        XCTAssertEqual(h.count, 3)
    }

    func testSaysItAsTheRowDoes() {
        XCTAssertEqual(RecentlyRemoved.carriesText(RecentlyRemoved.History(entries: 2, orders: 1)), "2 ledger entries · 1 order")
        XCTAssertEqual(RecentlyRemoved.carriesText(RecentlyRemoved.History(entries: 1, orders: 0)), "1 ledger entry")
        XCTAssertEqual(RecentlyRemoved.carriesText(RecentlyRemoved.History(entries: 0, orders: 3)), "3 orders")
        XCTAssertEqual(RecentlyRemoved.carriesText(RecentlyRemoved.History(entries: 0, orders: 0)), "")
        XCTAssertEqual(RecentlyRemoved.carriesText(nil), "")
    }

    func testAddsUpWhatEmptyingTheListWouldOrphanAKarigarsEntriesNeverOrders() {
        XCTAssertEqual(RecentlyRemoved.removedTotals(customerIds: ["cust-1", "cust-2"], karigarIds: ["kar-1"], history: history), RecentlyRemoved.History(entries: 3, orders: 2))
        XCTAssertEqual(RecentlyRemoved.removedTotals(customerIds: [], karigarIds: [], history: history), RecentlyRemoved.History())
    }

    func testRemovedMeansDeletedAtIsSet() {
        XCTAssertTrue(RecentlyRemoved.isRemoved("2026-10-01T05:00:00.000Z"))
        XCTAssertFalse(RecentlyRemoved.isRemoved(""))
        XCTAssertFalse(RecentlyRemoved.isRemoved(nil))
    }
}
