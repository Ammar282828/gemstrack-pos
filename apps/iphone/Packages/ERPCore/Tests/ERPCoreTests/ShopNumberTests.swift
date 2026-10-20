import XCTest
@testable import ERPCore

final class ShopNumberTests: XCTestCase {
    func testGolden() {
        let cases: [(String, Double?)] = [
            ("1500", 1500), ("1,500", 1500), ("1,50,000", 150000), ("1,25,000", 125000), ("26,250", 26250),
            ("1,250.50", 1250.5), ("12,5", 12.5), ("22,50", 22.5), ("1500,5", 1500.5), ("12.5", 12.5), (".5", 0.5), ("5.", 5),
            ("١٢٣", 123), ("۱۲۳", 123), ("١٬٥٠٠", 1500), ("١٢٫٥", 12.5), ("1٫5", 1.5),
            ("PKR 1,500", 1500), ("Rs. 2 500", 2500), ("rs1,000", 1000),
            ("", nil), ("   ", nil), ("abc", nil), ("1.2.3", nil), ("1,5000", nil), ("12,5.5", nil), ("-5", nil), (",", nil), (".", nil), ("1e5", nil),
        ]
        for (text, want) in cases {
            XCTAssertEqual(ShopNumber.parse(text), want, "\(text)")
        }
    }

    func testUnreadable() {
        XCTAssertFalse(ShopNumber.isUnreadable(""))
        XCTAssertFalse(ShopNumber.isUnreadable("12,5"))
        XCTAssertTrue(ShopNumber.isUnreadable("12abc"))
    }
}
