import XCTest
@testable import ERPCore

/// units.ts, categories.ts and the lists in store.ts (no TS tests: read off the sources), and getInvoiceRevenueDate.
final class UnitsAndListsTests: XCTestCase {
    func testTola() {
        XCTAssertEqual(gramsPerTola, 11.664)
        XCTAssertEqual(toTola(11.664), 1, accuracy: 1e-12)
        XCTAssertEqual(toTola(0), 0)
        XCTAssertEqual(toTola(.nan), 0)
    }

    func testFormatWeight() {
        XCTAssertEqual(formatWeight(12.5), "12.5 g · 1.072 tola")
        XCTAssertEqual(formatWeight(0), "0 g · 0 tola")
        XCTAssertEqual(formatWeight(.nan), "0 g · 0 tola")
        XCTAssertEqual(formatWeight(1234.5), "1,234.5 g · 105.838 tola")
        // toLocaleString sends a half up; NumberFormatter's default would say 0.12.
        XCTAssertEqual(formatWeight(0.125), "0.13 g · 0.011 tola")
        XCTAssertEqual(formatWeight(12.5, tolaDigits: 1, gramDigits: 0), "13 g · 1.1 tola")
    }

    func testCategories() {
        XCTAssertEqual(staticCategories.count, 20)
        XCTAssertEqual(staticCategories.map(\.id), (1...20).map { String(format: "cat%03d", $0) })
        XCTAssertEqual(categoryTitle("cat001"), "Rings")
        XCTAssertEqual(categorySingular("cat001"), "Ring")
        XCTAssertEqual(categoryTitle("cat010"), "Locket Sets without Bangle")
        XCTAssertEqual(categorySingular("cat010"), "Locket Set without Bangle")
        XCTAssertEqual(categorySingular("cat020"), "Men's Button")
        XCTAssertNil(categoryTitle("nope"))
        XCTAssertNil(categoryTitle(""))
        XCTAssertNil(categorySingular(nil))
    }

    func testSourcesAndPlating() {
        XCTAssertEqual(customerSources, ["taheri_spillover", "referral", "walkin", "social_media", "website", "other"])
        XCTAssertEqual(customerSources.compactMap(customerSourceLabel),
                       ["Taheri Spillover", "Referral", "Walk-in", "Social media", "Website", "Other"])
        XCTAssertNil(customerSourceLabel("whatsapp"))
        XCTAssertEqual(platingTypes, ["White Rhodium", "21K Gold Plating", "18K Gold Plating", "Chandi White Plating", "Other"])
    }

    func testInvoiceRevenueDate() throws {
        func invoice(_ json: String) throws -> Invoice { try JSONDecoder().decode(Invoice.self, from: Data(json.utf8)) }
        func order(_ json: String) throws -> Order { try JSONDecoder().decode(Order.self, from: Data(json.utf8)) }
        let o = try order(#"{"id":"ORD-1","createdAt":"2026-08-01T05:00:00.000Z"}"#)
        let blank = try order(#"{"id":"ORD-2","createdAt":""}"#)
        let byId = ["ORD-1": o, "ORD-2": blank]
        // From an order: that order's day, not the invoice's.
        XCTAssertEqual(getInvoiceRevenueDate(try invoice(#"{"id":"INV-1","createdAt":"2026-09-10T05:00:00.000Z","sourceOrderId":"ORD-1"}"#), ordersById: byId), "2026-08-01T05:00:00.000Z")
        // Direct sale, an order we do not hold, or one with no date: the invoice's own.
        XCTAssertEqual(getInvoiceRevenueDate(try invoice(#"{"id":"INV-2","createdAt":"2026-09-10T05:00:00.000Z"}"#), ordersById: byId), "2026-09-10T05:00:00.000Z")
        XCTAssertEqual(getInvoiceRevenueDate(try invoice(#"{"id":"INV-3","createdAt":"2026-09-10T05:00:00.000Z","sourceOrderId":"ORD-9"}"#), ordersById: byId), "2026-09-10T05:00:00.000Z")
        XCTAssertEqual(getInvoiceRevenueDate(try invoice(#"{"id":"INV-4","createdAt":"2026-09-10T05:00:00.000Z","sourceOrderId":"ORD-2"}"#), ordersById: byId), "2026-09-10T05:00:00.000Z")
    }
}
