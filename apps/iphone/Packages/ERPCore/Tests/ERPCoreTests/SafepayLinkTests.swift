import XCTest
@testable import ERPCore

/// src/lib/safepay.ts `isSafepayPublicKey`, and the message the apps send with a link. Names and keys are made up.
final class SafepayLinkTests: XCTestCase {
    func testAPublicKeyStartsWithSecAndIsHexAndDashes() {
        XCTAssertTrue(SafepayLink.isPublicKey("sec_0123456789abcdef0123"))
        XCTAssertTrue(SafepayLink.isPublicKey("  sec_01234567-89ab-cdef-0123-456789abcdef \n"))
    }

    func testAnythingElseIsNotAPublicKey() {
        XCTAssertFalse(SafepayLink.isPublicKey(""))
        XCTAssertFalse(SafepayLink.isPublicKey("sec_short"))
        XCTAssertFalse(SafepayLink.isPublicKey("SEC_0123456789abcdef0123"))
        XCTAssertFalse(SafepayLink.isPublicKey("pub_0123456789abcdef0123"))
        XCTAssertFalse(SafepayLink.isPublicKey("sec_0123456789abcdef0123zz"))
        XCTAssertFalse(SafepayLink.isPublicKey("sec_" + String(repeating: "a", count: 65)))
    }

    func testTheAmountStartsAtWhatIsOwedInWholeRupees() {
        XCTAssertEqual(SafepayLink.defaultAmount(owed: 12_500.4), 12_500)
        XCTAssertEqual(SafepayLink.defaultAmount(owed: 0.4), 0)
        XCTAssertEqual(SafepayLink.defaultAmount(owed: -300), 0)
    }

    func testALinkIsOfferedOnlyForAnOpenRecordWithSomethingOwed() {
        XCTAssertTrue(SafepayLink.offered(status: "Pending", owed: 100))
        XCTAssertFalse(SafepayLink.offered(status: "Cancelled", owed: 100))
        XCTAssertFalse(SafepayLink.offered(status: "Refunded", owed: 100))
        XCTAssertFalse(SafepayLink.offered(status: "Pending", owed: 0.5))
    }

    func testTheAmountIsBetweenOneRupeeAndFiftyMillion() {
        XCTAssertTrue(SafepayLink.isValidAmount(1))
        XCTAssertTrue(SafepayLink.isValidAmount(50_000_000))
        XCTAssertFalse(SafepayLink.isValidAmount(0))
        XCTAssertFalse(SafepayLink.isValidAmount(50_000_001))
        XCTAssertFalse(SafepayLink.isValidAmount(.nan))
    }

    func testTheMessageNamesTheCustomerTheAmountTheRecordAndTheShop() {
        XCTAssertEqual(SafepayLink.message(customerName: "Sara", amount: 12_500, id: "INV-000123", url: "https://pay.example/x", shopName: "TAHERI"),
                       "Assalam o Alaikum Sara, please pay PKR 12,500 for INV-000123 here: https://pay.example/x \u{2014} TAHERI")
        XCTAssertEqual(SafepayLink.message(customerName: nil, amount: 900, id: "ORD-000001", url: "https://pay.example/y", shopName: "MINA"),
                       "Assalam o Alaikum, please pay PKR 900 for ORD-000001 here: https://pay.example/y \u{2014} MINA")
    }
}
