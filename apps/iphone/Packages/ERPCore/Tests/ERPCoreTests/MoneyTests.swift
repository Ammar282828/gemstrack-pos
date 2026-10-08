import XCTest
@testable import ERPCore

/// lacCrore as src/lib/money.ts documents it, and the lenient reading every model relies on.
final class MoneyTests: XCTestCase {
    func testLacCrore() {
        XCTAssertEqual(Money.lacCrore(85_000), "85,000")
        XCTAssertEqual(Money.lacCrore(450_000), "4.5 lac")
        XCTAssertEqual(Money.lacCrore(12_500_000), "1.25 crore")
        XCTAssertEqual(Money.lacCrore(99_999_99), "1 crore")
        XCTAssertEqual(Money.lacCrore(-250_000), "-2.5 lac")
        XCTAssertEqual(Money.lacCrore(.nan), "0")
    }

    func testLenientDecoding() throws {
        struct M: Decodable {
            let total: Double?; let name: String?; let items: [String]; let paid: Bool?
            enum K: String, CodingKey { case total, name, items, paid }
            init(from d: Decoder) throws {
                let c = try d.container(keyedBy: K.self)
                total = c.double(.total); name = c.string(.name); items = c.strings(.items); paid = c.bool(.paid)
            }
        }
        let json = #"{"total":"25,000","name":123,"items":{"1":"b","0":"a"},"paid":"yes"}"#.data(using: .utf8)!
        let m = try JSONDecoder().decode(M.self, from: json)
        XCTAssertEqual(m.total, 25_000)
        XCTAssertEqual(m.name, "123")
        XCTAssertEqual(m.items, ["a", "b"])
        XCTAssertEqual(m.paid, true)
    }

    func testDates() {
        XCTAssertEqual(ERPDate.karachiDay(ERPDate.parse("2026-10-08T20:00:00Z")!), "2026-10-09")
        XCTAssertEqual(ERPDate.karachiDay(ERPDate.parse("2026-10-08T18:59:59.000Z")!), "2026-10-08")
        XCTAssertNotNil(ERPDate.parse("2026-10-08"))
        XCTAssertNil(ERPDate.parse("soon"))
    }
}
