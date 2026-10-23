import XCTest
@testable import ERPCore

/// src/lib/categories.test.ts, case for case.
final class CategoriesTests: XCTestCase {
    func testLineCategoryOwnThenOrdersThenName() {
        XCTAssertEqual(lineCategory(categoryId: "cat001", itemCategory: "cat007", name: "Bangle"), "cat001")
        XCTAssertEqual(lineCategory(categoryId: "", itemCategory: "cat007", name: "Ring"), "cat007")
        XCTAssertEqual(lineCategory(categoryId: "", itemCategory: nil, name: "Cat’s eye ring"), "cat001")
        XCTAssertNil(lineCategory(categoryId: nil, itemCategory: nil, name: "Custom from sample"))
    }

    func testGuessCategory() {
        let cases: [(String, String?)] = [
            ("Necklace", "cat013"), ("Jhumki", "cat002"), ("2 Pairs Custom Earrings", "cat002"), ("String Set", "cat012"),
            ("Multi Colour Bangle & Ring", "cat006"), ("CNC bangles", "cat007"), ("6 bangle stack", "cat007"), ("CNC band", "cat009"),
            ("ruby lari bracelet", "cat005"), ("Plain Gold Loose Bracelet", "cat019"), ("Plain Gold ‘H’ Locket", "cat004"),
            ("Pink Ruby Ring", "cat001"), ("Men's Ring", "cat018"), ("ARY 1g", "cat017"), ("Multi Stone Thakti", "cat004"),
            ("Earrings and Necklace NN", "cat013"), ("Plain Gold", nil), ("Use onyx", nil),
        ]
        for (name, want) in cases { XCTAssertEqual(guessCategory(name), want, name) }
        XCTAssertNil(guessCategory(nil))
        XCTAssertNil(guessCategory("  "))
    }

    func testShareText() {
        XCTAssertEqual(categoryShareText(0.32), "32%")
        XCTAssertEqual(categoryShareText(0.1), "10%")
        XCTAssertEqual(categoryShareText(0.007), "0.7%")
        XCTAssertEqual(categoryShareText(0), "0.0%")
    }
}
