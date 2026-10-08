import XCTest
@testable import ERPCore

/// src/lib/order-timing.ts has no TS test. These cases were run through the TS under
/// TZ=Asia/Karachi (the shop's devices) and the answers pinned here: `now` is 20:00 UTC on
/// 8 Oct, which is already 1 am on the 9th in Karachi.
final class OrderTimingTests: XCTestCase {
    private let now = ERPDate.parse("2026-10-08T20:00:00Z")!

    private func order(_ promisedDate: String?, _ createdAt: String, _ status: String = "Pending", id: String = "") -> Order {
        var fields: [String: Any] = ["id": id, "createdAt": createdAt, "status": status]
        if let promisedDate { fields["promisedDate"] = promisedDate }
        return ERPDecode.model(Order.self, from: fields)!
    }

    private func timing(_ promisedDate: String?, _ createdAt: String = "2026-10-01T00:00:00Z") -> OrderTiming {
        orderTiming(order(promisedDate, createdAt), now: now)
    }

    private func check(_ t: OrderTiming, daysLate: Int, _ state: PromiseState, estimated: Bool = false, urgent: Bool,
                       label: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(t.daysLate, daysLate, file: file, line: line)
        XCTAssertEqual(t.state, state, file: file, line: line)
        XCTAssertEqual(t.estimated, estimated, file: file, line: line)
        XCTAssertEqual(isUrgent(t), urgent, file: file, line: line)
        XCTAssertEqual(timingLabel(t), label, file: file, line: line)
    }

    func testAPromisedDayIsKarachisNotUTCs() {
        // 9 Oct is today in Karachi; due is that day's midnight there, 19:00 UTC the evening before.
        let today = timing("2026-10-09")
        check(today, daysLate: 0, .today, urgent: true, label: "due today")
        XCTAssertEqual(today.due, ERPDate.parse("2026-10-08T19:00:00Z"))
        // 8 Oct would still be "today" read in UTC; in Karachi it is a day late.
        check(timing("2026-10-08"), daysLate: 1, .late, urgent: true, label: "1 day late")
        check(timing("2026-10-06"), daysLate: 3, .late, urgent: true, label: "3 days late")
    }

    func testUpcomingIsUrgentWithinTheBenchWeek() {
        check(timing("2026-10-10"), daysLate: -1, .upcoming, urgent: true, label: "in 1 day")
        check(timing("2026-10-14"), daysLate: -5, .upcoming, urgent: true, label: "in 5 days")
        check(timing("2026-10-16"), daysLate: -7, .upcoming, urgent: true, label: "in 7 days")
        check(timing("2026-10-17"), daysLate: -8, .upcoming, urgent: false, label: "in 8 days")
        check(timing("2026-10-20"), daysLate: -11, .upcoming, urgent: false, label: "in 11 days")
    }

    func testAPromiseWrittenAsAnInstantCountsOnItsKarachiDay() {
        check(timing("2026-10-09T10:00:00.000Z"), daysLate: 0, .today, urgent: true, label: "due today")
        // 19:30 UTC on the 8th is 00:30 on the 9th in Karachi.
        check(timing("2026-10-08T19:30:00.000Z"), daysLate: 0, .today, urgent: true, label: "due today")
        // No zone on it: read in Karachi, as date-fns reads it on the shop's devices.
        check(timing("2026-10-09T01:00:00"), daysLate: 0, .today, urgent: true, label: "due today")
    }

    func testNoPromiseFallsBackToAgeSoOldOrdersAreStillReported() {
        let legacy = { (created: String) in self.timing(nil, created) }
        // Taken 1 Oct (Karachi): 8 days old, a day past the week.
        check(legacy("2026-10-01T10:00:00.000Z"), daysLate: 1, .late, estimated: true, urgent: false, label: "8 days old")
        check(legacy("2026-10-02T10:00:00.000Z"), daysLate: 0, .late, estimated: true, urgent: false, label: "7 days old")
        check(legacy("2026-10-03T10:00:00.000Z"), daysLate: -1, .noPromise, estimated: true, urgent: false, label: "")
        // The age counts Karachi's days: 19:30 UTC on 1 Oct is already 2 Oct there, 18:30 UTC on the 2nd still is.
        check(legacy("2026-10-01T19:30:00.000Z"), daysLate: 0, .late, estimated: true, urgent: false, label: "7 days old")
        check(legacy("2026-10-02T18:30:00.000Z"), daysLate: 0, .late, estimated: true, urgent: false, label: "7 days old")
        check(legacy("2026-10-08T21:00:00.000Z"), daysLate: -7, .noPromise, estimated: true, urgent: false, label: "")
        check(legacy("2026-10-01T10:00:00"), daysLate: 1, .late, estimated: true, urgent: false, label: "8 days old")
    }

    func testABlankOrUnreadablePromiseIsNoPromise() {
        check(timing("", "2026-10-01T10:00:00.000Z"), daysLate: 1, .late, estimated: true, urgent: false, label: "8 days old")
        check(timing("soon", "2026-10-01T10:00:00.000Z"), daysLate: 1, .late, estimated: true, urgent: false, label: "8 days old")
        XCTAssertNil(timing("soon", "2026-10-01T10:00:00.000Z").due)
        // Nothing at all: no age to go on, so nothing to report.
        check(timing(nil, ""), daysLate: -7, .noPromise, estimated: true, urgent: false, label: "")
    }

    func testOnlyActiveOrdersAreLateWorstFirstTiesInTheirOrder() {
        let list = [
            order("2026-10-06", "2026-10-01T00:00:00Z", id: "A"),
            order("2026-10-01", "2026-09-20T00:00:00Z", id: "B"),
            order("2026-10-06", "2026-09-30T00:00:00Z", "In Progress", id: "C"),
            order("2026-10-01", "2026-09-20T00:00:00Z", "Completed", id: "D"),
            order("2026-10-12", "2026-09-20T00:00:00Z", id: "E"),
            order(nil, "2026-09-20T00:00:00Z", "Cancelled", id: "F"),
            order(nil, "2026-09-25T00:00:00Z", id: "G"),
            order("2026-10-09", "2026-09-20T00:00:00Z", id: "H"),
            order(nil, "2026-10-06T00:00:00Z", id: "L"),
        ]
        let late = lateOrders(list, now: now)
        XCTAssertEqual(late.map { "\($0.order.id):\($0.timing.daysLate)" }, ["B:8", "G:7", "A:3", "C:3"])
    }

    func testDueSoonIsActiveOrdersPromisedWithinTheDaysSoonestFirst() {
        let list = [
            order("2026-10-06", "2026-10-01T00:00:00Z", id: "A"),
            order("2026-10-12", "2026-09-20T00:00:00Z", id: "E"),
            order(nil, "2026-09-25T00:00:00Z", id: "G"),
            order("2026-10-09", "2026-09-20T00:00:00Z", id: "H"),
            order("2026-10-11", "2026-09-20T00:00:00Z", "In Progress", id: "I"),
            order("2026-10-17", "2026-09-20T00:00:00Z", id: "J"),
            order("2026-10-12", "2026-09-20T00:00:00Z", id: "K"),
            order("2026-10-10", "2026-09-20T00:00:00Z", "Refunded", id: "M"),
        ]
        XCTAssertEqual(dueSoon(list, now: now).map { "\($0.order.id):\($0.timing.daysLate)" }, ["H:0", "I:-2", "E:-3", "K:-3"])
        XCTAssertEqual(dueSoon(list, now: now, days: 2).map(\.order.id), ["H", "I"])
    }

    func testOnlyPendingAndInProgressAreActive() {
        XCTAssertTrue(isActiveOrder(order(nil, "", "Pending")))
        XCTAssertTrue(isActiveOrder(order(nil, "", "In Progress")))
        for s in ["Completed", "Cancelled", "Refunded", "Draft", ""] { XCTAssertFalse(isActiveOrder(order(nil, "", s)), s) }
    }

    func testAnUndatedOrderIsNeverUrgent() {
        XCTAssertFalse(isUrgent(OrderTiming(due: nil, daysLate: 30, state: .late, estimated: true)))
        XCTAssertEqual(DEFAULT_PROMISE_DAYS, 14)
    }
}
