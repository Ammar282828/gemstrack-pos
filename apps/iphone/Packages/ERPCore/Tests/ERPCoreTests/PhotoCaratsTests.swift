import XCTest
@testable import ERPCore

/// The carats line the weights page draws under the weight (src/app/website/weights/page.tsx), and the field's rules.
final class PhotoCaratsTests: XCTestCase {
    func testTheLineIsTheSolitaireThenTheSmallOnesAfterAPlus() {
        XCTAssertEqual(PhotoCarats.line(main: 0.5, side: 0.24), "0.50ct + 0.24ct")
        XCTAssertEqual(PhotoCarats.line(main: 0.5, side: 0), "0.50ct")
        XCTAssertEqual(PhotoCarats.line(main: 0, side: 0.24), "0.24ct")
        XCTAssertEqual(PhotoCarats.line(main: 0, side: 0), "")
        XCTAssertEqual(PhotoCarats.line(main: 1, side: 0.125), "1.00ct + 0.13ct")
    }

    func testTextIsTwoPlaces() {
        XCTAssertEqual(PhotoCarats.text(2), "2.00ct")
        XCTAssertEqual(PhotoCarats.text(0.3), "0.30ct")
    }

    func testTypedCaratsAcceptACommaAndEmptyClears() {
        XCTAssertNil(PhotoCarats.parse("  "))
        XCTAssertEqual(PhotoCarats.parse("0,5"), 0.5)
        XCTAssertEqual(PhotoCarats.parse(" 1.25 "), 1.25)
        XCTAssertTrue(PhotoCarats.parse("abc")!.isNaN)
    }

    func testValidIsEmptyOrAboveZeroAndUnder500() {
        XCTAssertTrue(PhotoCarats.valid(nil))
        XCTAssertTrue(PhotoCarats.valid(0.01))
        XCTAssertTrue(PhotoCarats.valid(499.99))
        XCTAssertFalse(PhotoCarats.valid(0))
        XCTAssertFalse(PhotoCarats.valid(500))
        XCTAssertFalse(PhotoCarats.valid(-1))
        XCTAssertFalse(PhotoCarats.valid(PhotoCarats.parse("x")))
    }

    func testRecordedKeepsOnlyAPositiveNumber() {
        XCTAssertEqual(PhotoCarats.recorded(0.5), 0.5)
        XCTAssertNil(PhotoCarats.recorded(0))
        XCTAssertNil(PhotoCarats.recorded(nil))
    }

    func testGeometryMatchesThePage() {
        XCTAssertEqual(PhotoCarats.weightBaseline, 257.3, accuracy: 1e-9)
        XCTAssertEqual(PhotoCarats.caratsBaseline, 374.3, accuracy: 1e-9)
    }
}
