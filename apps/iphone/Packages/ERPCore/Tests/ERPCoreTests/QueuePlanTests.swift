import XCTest
@testable import ERPCore

/// src/lib/social/queue-plan.test.ts's spreadTimes and defaultSpreadEnd cases, on Karachi's clock.
final class QueuePlanTests: XCTestCase {
    private func at(_ iso: String) -> Date { JS.parseISO(iso)! }
    private func clock(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = ERPDate.karachi
        f.dateFormat = "HH:mm"
        return f.string(from: d)
    }

    private var from: Date { at("2026-09-25T11:00:00+05:00") }
    private var to: Date { at("2026-09-25T20:00:00+05:00") }

    func testSpreadsEvenlyFirstAndLastAtTheEnds() {
        XCTAssertEqual(spreadTimes(4, from: from, to: to).map(clock), ["11:00", "14:00", "17:00", "20:00"])
    }

    func testRoundsToTheMinute() {
        let times = spreadTimes(3, from: from, to: at("2026-09-25T11:01:01+05:00"))
        XCTAssertTrue(times.allSatisfy { Int($0.timeIntervalSince1970) % 60 == 0 })
    }

    func testPutsEverythingAtTheStartWhenTheWindowIsOver() {
        XCTAssertEqual(spreadTimes(2, from: to, to: from), [to, to])
    }

    func testOnePieceGoesAtTheStart() {
        XCTAssertEqual(spreadTimes(1, from: from, to: to), [from])
        XCTAssertEqual(spreadTimes(0, from: from, to: to), [])
    }

    func testTheWindowEndsHalfAnHourBeforeClosing() {
        XCTAssertEqual(clock(defaultSpreadEnd(at("2026-09-24T12:00:00+05:00"))), "20:30") // Thursday
        XCTAssertEqual(clock(defaultSpreadEnd(at("2026-09-25T16:00:00+05:00"))), "19:30") // Friday
    }
}
