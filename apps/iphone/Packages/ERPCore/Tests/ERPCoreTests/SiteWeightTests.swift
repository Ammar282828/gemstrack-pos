import XCTest
@testable import ERPCore

/// src/lib/website/site-weight.test.ts's cases (a new upload, `drop`, reads as taheri.shop's own: it is the source that counts).
final class SiteWeightTests: XCTestCase {
    func testKeepsATypedWeightForTaheriShopsOwnPhotographThatHasNoneToTwoPlaces() {
        XCTAssertEqual(weightForSite(source: "attributes", siteGrams: nil, typed: "3.84"), 3.84)
        XCTAssertEqual(weightForSite(source: "attributes", siteGrams: nil, typed: " 12 "), 12)
        XCTAssertEqual(weightForSite(source: "attributes", siteGrams: nil, typed: "5.4567"), 5.46)
    }

    func testNeverChangesAWeightTheSiteAlreadyHas() {
        XCTAssertNil(weightForSite(source: "attributes", siteGrams: 4.1, typed: "4.2"))
    }

    func testLeavesTheCataloguesPiecesAloneAndAnythingNotAWeight() {
        XCTAssertNil(weightForSite(source: "pieces", siteGrams: nil, typed: "3.84"))
        XCTAssertNil(weightForSite(source: nil, siteGrams: nil, typed: "3.84"))
        for w in ["", "0", "0.0", "abc", "3.", "-2"] { XCTAssertNil(weightForSite(source: "attributes", siteGrams: nil, typed: w), w) }
    }

    func testIsThePostsOwnOnlyWhenTheSiteHasAWeightAndADifferentOneIsTyped() {
        XCTAssertFalse(postOnlyWeight(siteGrams: 4.2, typed: "4.2"))
        XCTAssertFalse(postOnlyWeight(siteGrams: 4.2, typed: "4.20"))
        XCTAssertTrue(postOnlyWeight(siteGrams: 4.2, typed: "4.35"))
        XCTAssertFalse(postOnlyWeight(siteGrams: nil, typed: "4.35"))
        XCTAssertFalse(postOnlyWeight(siteGrams: 4.2, typed: ""))
    }

    func testTakesAPositiveNumberAsTyped() {
        XCTAssertTrue(validWeight("3.84"))
        XCTAssertFalse(validWeight("0"))
        XCTAssertFalse(validWeight("3."))
    }
}
