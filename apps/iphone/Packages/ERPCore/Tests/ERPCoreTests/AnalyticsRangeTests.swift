import XCTest
@testable import ERPCore

/// Mirrors src/lib/analytics/range-param.test.ts. `now` is 1 Oct 2026, 15:00 in Karachi.
final class AnalyticsRangeTests: XCTestCase {
    private func at(_ iso: String) -> Date { ERPDate.parse(iso)! }
    private let now = ERPDate.parse("2026-10-01T10:00:00Z")!

    /// Karachi's day of an instant, "2026-10-1" style as the TS test writes it (no zero padding).
    private func day(_ d: Date?) -> String? {
        guard let d else { return nil }
        let parts = ERPDate.karachiDay(d).split(separator: "-").map { Int($0)! }
        return "\(parts[0])-\(parts[1])-\(parts[2])"
    }
    private func read(_ key: String, from: String? = nil, to: String? = nil) -> (key: String, range: AnalyticsRange?) {
        let k = AnalyticsPeriod.knownKey(key, from: from)
        return (k, AnalyticsPeriod.rangeFor(k, now: now, from: from, to: to))
    }

    func testNoQueryIsThisMonth() {
        XCTAssertEqual(AnalyticsPeriod.defaultKey, "this-month")
        XCTAssertEqual(AnalyticsPeriod.quick.first?.key, "this-month")
        XCTAssertEqual(read("").key, "this-month")
        XCTAssertEqual(day(read("").range?.from), "2026-10-1")
    }

    func testThisMonthRunsFromTheFirstToToday() {
        let r = AnalyticsPeriod.rangeFor("this-month", now: at("2026-10-12T04:30:00Z"), from: nil, to: nil)!
        XCTAssertEqual(day(r.from), "2026-10-1")
        XCTAssertEqual(day(r.to), "2026-10-12")
    }

    func testOnTheFirstDayOfAMonthFromAndToAreThatDay() {
        let r = AnalyticsPeriod.rangeFor("this-month", now: at("2026-11-01T03:00:00Z"), from: nil, to: nil)!
        XCTAssertEqual(day(r.from), "2026-11-1")
        XCTAssertEqual(day(r.to), "2026-11-1")
    }

    func testLastThirtyDaysIsStillAnOption() {
        XCTAssertEqual(read("last-30").key, "last-30")
        XCTAssertEqual(day(read("last-30").range?.from), "2026-9-2")
    }

    func testCarriesAQuickRangeAYearAndAllTime() {
        XCTAssertEqual(read("last-90").key, "last-90")
        XCTAssertEqual(day(read("last-year").range?.from), "2025-1-1")
        XCTAssertEqual(day(read("year-2024").range?.to), "2024-12-31")
        XCTAssertNil(read("all-time").range)
    }

    func testACustomRange() {
        let r = read("custom", from: "2026-09-05", to: "2026-09-20")
        XCTAssertEqual(r.key, "custom")
        XCTAssertEqual(day(r.range?.from), "2026-9-5")
        XCTAssertEqual(day(r.range?.to), "2026-9-20")
    }

    func testFallsBackToThisMonthOnAnythingItCannotRead() {
        XCTAssertEqual(read("forever").key, "this-month")
        XCTAssertEqual(read("custom", from: "nonsense").key, "this-month")
        XCTAssertEqual(read("custom").key, "this-month")
    }
}
