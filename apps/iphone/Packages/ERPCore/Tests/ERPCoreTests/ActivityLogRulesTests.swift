import XCTest
@testable import ERPCore

/// src/app/activity-log/page.tsx has no test of its own. These pin its filters (Karachi's days) and its words.
final class ActivityLogRulesTests: XCTestCase {
    private func log(_ id: String, _ type: String, _ at: String) -> ActivityLogEntry {
        ActivityLogEntry(id: id, timestamp: at, eventType: type, description: "d \(id)", details: "", entityId: id)
    }

    // 6 Oct 10:00, 8 Oct 20:00 UTC (= 9 Oct 01:00 in Karachi), 9 Oct 10:00, 9 Oct 20:00 UTC (= 10 Oct 01:00).
    private var logs: [ActivityLogEntry] {
        [
            log("a", "order.create", "2026-10-06T10:00:00Z"),
            log("b", "invoice.payment", "2026-10-08T20:00:00Z"),
            log("c", "product.update", "2026-10-09T10:00:00Z"),
            log("d", "order.update", "2026-10-09T20:00:00Z"),
        ]
    }

    func testNoFilterIsEverythingNewestFirst() {
        let out = ActivityLogRules.filter(logs, type: "All", fromDay: nil, toDay: nil, today: "2026-10-10")
        XCTAssertEqual(out.map(\.id), ["d", "c", "b", "a"])
    }

    func testAKindMatchesTheStartOfTheEventType() {
        XCTAssertEqual(ActivityLogRules.filter(logs, type: "order", fromDay: nil, toDay: nil, today: "2026-10-10").map(\.id), ["d", "a"])
        XCTAssertEqual(ActivityLogRules.filter(logs, type: "invoice", fromDay: nil, toDay: nil, today: "2026-10-10").map(\.id), ["b"])
        XCTAssertEqual(ActivityLogRules.filter(logs, type: "rates", fromDay: nil, toDay: nil, today: "2026-10-10").map(\.id), [])
    }

    func testARangeIsWholeDaysInKarachiBothEndsIncluded() {
        // 9 Oct in Karachi holds b (01:00) and c (15:00) but not d (10 Oct 01:00).
        let out = ActivityLogRules.filter(logs, type: "All", fromDay: "2026-10-09", toDay: "2026-10-09", today: "2026-10-10")
        XCTAssertEqual(out.map(\.id), ["c", "b"])
        XCTAssertEqual(ActivityLogRules.filter(logs, type: "All", fromDay: "2026-10-06", toDay: "2026-10-08", today: "2026-10-10").map(\.id), ["a"])
    }

    func testNoEndDayRunsToToday() {
        let out = ActivityLogRules.filter(logs, type: "All", fromDay: "2026-10-09", toDay: nil, today: "2026-10-10")
        XCTAssertEqual(out.map(\.id), ["d", "c", "b"])
        // Today is not past the end of the range: it counts.
        XCTAssertEqual(ActivityLogRules.filter(logs, type: "All", fromDay: "2026-10-09", toDay: nil, today: "2026-10-09").map(\.id), ["c", "b"])
    }

    func testAKindAndARangeTogetherAndALogWithNoDateIsOutOfAnyRange() {
        XCTAssertEqual(ActivityLogRules.filter(logs, type: "order", fromDay: "2026-10-06", toDay: "2026-10-06", today: "2026-10-10").map(\.id), ["a"])
        let undated = log("u", "order.create", "")
        XCTAssertEqual(ActivityLogRules.filter([undated], type: "All", fromDay: nil, toDay: nil, today: "2026-10-10").map(\.id), ["u"])
        XCTAssertEqual(ActivityLogRules.filter([undated], type: "All", fromDay: "2026-10-01", toDay: nil, today: "2026-10-10").map(\.id), [])
    }

    func testTheWordsAndTones() {
        XCTAssertEqual(ActivityLogRules.title("invoice"), "Invoice")
        XCTAssertEqual(ActivityLogRules.title(""), "")
        XCTAssertEqual(ActivityLogRules.tone("invoice.create"), .created)
        XCTAssertEqual(ActivityLogRules.tone("repair.payment"), .created)
        XCTAssertEqual(ActivityLogRules.tone("order.update"), .updated)
        XCTAssertEqual(ActivityLogRules.tone("expense.delete"), .deleted)
        XCTAssertEqual(ActivityLogRules.tone("order.revert"), .other)
        XCTAssertEqual(ActivityLogRules.tone(""), .other)
        XCTAssertTrue(ActivityLogRules.isRevertable("expense.create"))
        XCTAssertFalse(ActivityLogRules.isRevertable("expense.update"))
        XCTAssertEqual(ActivityLogRules.consequence("order.create"), "The order will be permanently deleted.")
        XCTAssertNil(ActivityLogRules.consequence("order.update"))
        XCTAssertEqual(ActivityLogRules.eventTypes.count, 8)
    }

    func testALineReadsFromAnOddDocument() {
        let e = DocJSON.decode(ActivityLogEntry.self, id: "x1", data: ["eventType": "order.update", "timestamp": "2026-10-09T10:00:00Z", "description": 5])!
        XCTAssertEqual(e.id, "x1")
        XCTAssertEqual(e.description, "5")
        XCTAssertEqual(e.details, "")
        XCTAssertEqual(e.entityId, "")
    }
}
