import XCTest
@testable import ERPCore

/// src/lib/whatsapp-number.test.ts, case for case; normalizePhoneNumber (utils.ts) has no TS test, so its cases
/// are read off the function. Numbers are made up.
final class PhonesTests: XCTestCase {
    func testAPakistaniNumberWrittenAnyLocalWayIs92() {
        XCTAssertEqual(toWhatsAppNumber("0300 1234567"), "923001234567")
        XCTAssertEqual(toWhatsAppNumber("+92 300 1234567"), "923001234567")
        XCTAssertEqual(toWhatsAppNumber("923001234567"), "923001234567")
        XCTAssertEqual(toWhatsAppNumber("300 1234567"), "923001234567")
    }

    func testANumberFromAbroadKeepsItsOwnCode() {
        XCTAssertEqual(toWhatsAppNumber("+1 (415) 555-1234"), "14155551234")
        XCTAssertEqual(toWhatsAppNumber("+14155551234"), "14155551234")
        XCTAssertEqual(toWhatsAppNumber("+44 20 7946 0958"), "442079460958")
        XCTAssertEqual(toWhatsAppNumber("+971 50 123 4567"), "971501234567")
        XCTAssertEqual(toWhatsAppNumber("001 415 555 1234"), "14155551234")
        XCTAssertEqual(toWhatsAppNumber("14155551234"), "14155551234")
        XCTAssertEqual(whatsAppLink("+1 415 555 1234", message: "hi"), "https://wa.me/14155551234?text=hi")
    }

    func testNothingToDialForNothing() {
        XCTAssertEqual(toWhatsAppNumber(""), "")
        XCTAssertEqual(toWhatsAppNumber(nil), "")
        XCTAssertEqual(whatsAppLink(nil, message: "hi"), "")
        XCTAssertEqual(whatsAppLink("0300 1234567"), "https://wa.me/923001234567")
        XCTAssertEqual(whatsAppLink("0300 1234567", message: "a b&c"), "https://wa.me/923001234567?text=a%20b%26c")
    }

    func testNormalizePhoneNumber() {
        XCTAssertEqual(normalizePhoneNumber(nil), "")
        XCTAssertEqual(normalizePhoneNumber(""), "")
        XCTAssertEqual(normalizePhoneNumber("0300-1234567"), "+923001234567")
        XCTAssertEqual(normalizePhoneNumber("0300 123 4567"), "+923001234567")
        XCTAssertEqual(normalizePhoneNumber("+92 (300) 1234567"), "+923001234567")
        XCTAssertEqual(normalizePhoneNumber("923001234567"), "+923001234567")
        // Too short to be a number it knows: handed back as typed, spaces and all.
        XCTAssertEqual(normalizePhoneNumber("12 345"), "12 345")
        XCTAssertEqual(normalizePhoneNumber("0123 456"), "0123 456")
    }
}
