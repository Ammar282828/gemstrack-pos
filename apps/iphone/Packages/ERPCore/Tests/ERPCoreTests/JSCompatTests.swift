import XCTest
@testable import ERPCore

/// The JavaScript behaviours the ported rules lean on (Logic/JSCompat.swift). Every expected
/// value here was printed by Node 20 (and tens of thousands of random cases were compared the
/// same way while writing the port).
final class JSCompatTests: XCTestCase {
    func testMathRoundSendsAHalfUp() {
        XCTAssertEqual([-2.5, -0.5, 0.5, 1.5, 2.5, 2.4999, -2.6].map(JS.round), [-2, 0, 1, 2, 3, 2, -3])
        XCTAssertEqual(JS.round(-111597897.50000001), -111597898)
    }

    func testToFixedReadsTheExactValueAndRoundsATieUp() {
        XCTAssertEqual(JS.toFixed(7.25, 1), "7.3")
        XCTAssertEqual(JS.toFixed(0.5, 0), "1")
        XCTAssertEqual(JS.toFixed(2.5, 0), "3")
        XCTAssertEqual(JS.toFixed(1.005, 2), "1.00")
        XCTAssertEqual(JS.toFixed(8.345, 2), "8.35")
        XCTAssertEqual(JS.toFixed(-0.04, 1), "-0.0")
        XCTAssertEqual(JS.toFixed(0, 2), "0.00")
        XCTAssertEqual(JS.toFixed(1234.5678, 2), "1234.57")
        XCTAssertEqual(JS.toFixed(99.995, 2), "100.00")
        XCTAssertEqual(JS.toFixed(10, 1), "10.0")
    }

    func testNumberToTextTheWayEcmaScriptPrintsIt() {
        XCTAssertEqual(
            [3, 5.2, 104000, 0.00001, 1e-7, 1e21, 1.5e21, -12.5, 0.1 + 0.2, 1.2345678901234568e20, 100, 0.000001].map(JS.number),
            ["3", "5.2", "104000", "0.00001", "1e-7", "1e+21", "1.5e+21", "-12.5", "0.30000000000000004", "123456789012345680000", "100", "0.000001"]
        )
        XCTAssertEqual(JS.number(-0.0), "0")
    }

    func testParseFloatTakesTheNumberTheTextStartsWith() {
        let text = [" 26300abc", ".5", "5.", "1e3x", "1e", "-", "Infinityx", "0x10", "  -3.5e-2z", "+7"]
        XCTAssertEqual(text.map { JS.number(JS.parseFloat($0)) }, ["26300", "0.5", "5", "1000", "1", "NaN", "Infinity", "0", "-0.035", "7"])
    }

    func testParseIntTakesTheWholeNumberTheTextStartsWith() {
        XCTAssertEqual(["21k", "k21", " 24 ", "-3x", "", "3.9"].map { JS.number(JS.parseInt($0)) }, ["21", "NaN", "24", "-3", "NaN", "3"])
    }

    func testNumberOfTextIsNaNUnlessTheWholeTextIsANumber() {
        let text = ["", " 12 ", "12abc", "1e3", "0x1f", "1,000", "Infinity", "-Infinity", ".5", "5.", "abc", "+0x1f", "inf", "nan"]
        XCTAssertEqual(text.map { JS.number(JS.toNumber($0)) }, ["0", "12", "NaN", "1000", "31", "NaN", "Infinity", "-Infinity", "0.5", "5", "NaN", "NaN", "NaN", "NaN"])
    }

    func testLocaleCompareOrdersPunctuationDigitsThenLettersWithCaseLast() {
        let pairs = [("a", "B"), ("B", "a"), ("a", "A"), ("A", "a"), ("cust-1", "cust-a"), ("cust_2", "cust-3"), ("2026-09-10", "2026-09-10T10:00:00Z"),
                     ("2026-10-01T10:00:00.000Z", "2026-10-01T10:00:00+05:00"), ("", "a"), ("a", "a"), ("10", "9"), ("Cust-3", "cust-1"), ("x y", "x-y")]
        XCTAssertEqual(pairs.map { JS.localeCompare($0.0, $0.1).signum() }, [-1, 1, -1, 1, -1, -1, -1, -1, -1, 0, -1, 1, -1])
    }

    func testTrimAndSpaceAreJavaScriptsNotSwifts() {
        XCTAssertEqual(JS.trim("\u{FEFF}a\u{A0}"), "a")
        XCTAssertEqual(JS.trim("\u{85}x"), "\u{85}x")
        XCTAssertTrue(JS.isSpace("\u{FEFF}"))
        XCTAssertFalse(JS.isSpace("\u{85}"))
    }

    func testStableSortKeepsTiesInTheirOrder() {
        let items = [("b", 1), ("a", 1), ("c", 0), ("d", 1)]
        XCTAssertEqual(items.jsSorted { Double($0.1 - $1.1) }.map(\.0), ["c", "b", "a", "d"])
    }

    func testDatesLocalMeansKarachi() {
        // A bare day: parseISO reads it as the local midnight, `new Date` as UTC's.
        XCTAssertEqual(JS.parseISO("2026-10-09"), ERPDate.parse("2026-10-08T19:00:00Z"))
        XCTAssertEqual(JS.newDate("2026-10-09"), ERPDate.parse("2026-10-09T00:00:00Z"))
        // No zone on a date-time: local again.
        XCTAssertEqual(JS.newDate("2026-10-09T01:00:00"), ERPDate.parse("2026-10-08T20:00:00Z"))
        XCTAssertEqual(JS.newDate("2026-10-09T01:00:30"), ERPDate.parse("2026-10-08T20:00:30Z"))
        XCTAssertEqual(JS.parseISO("2026-10-08T19:30:00.000Z"), ERPDate.parse("2026-10-08T19:30:00Z"))
        XCTAssertNil(JS.parseISO("soon"))
        XCTAssertNil(JS.newDate(""))
        XCTAssertNil(JS.newDate("2026-10-09T25:00:00"))
        XCTAssertEqual(JS.karachiStartOfDay(ERPDate.parse("2026-10-08T19:30:00Z")!), ERPDate.parse("2026-10-08T19:00:00Z"))
        XCTAssertEqual(JS.karachiStartOfDay(ERPDate.parse("2026-10-08T18:59:59Z")!), ERPDate.parse("2026-10-07T19:00:00Z"))
        XCTAssertEqual(JS.calendarDays(ERPDate.parse("2026-10-08T20:00:00Z")!, since: ERPDate.parse("2026-10-08T10:00:00Z")!), 1)
    }
}
