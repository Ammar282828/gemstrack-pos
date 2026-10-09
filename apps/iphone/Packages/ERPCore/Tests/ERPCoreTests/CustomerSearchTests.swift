import XCTest
@testable import ERPCore

/// The names and numbers are made up.
final class CustomerSearchTests: XCTestCase {
    private func customer(_ id: String, _ name: String, _ phone: String? = nil, alt: String? = nil, removed: Bool = false) -> Customer {
        var fields: [String: Any] = ["id": id, "name": name]
        if let phone { fields["phone"] = phone }
        if let alt { fields["altPhone"] = alt }
        if removed { fields["deletedAt"] = "2026-10-01T00:00:00.000Z" }
        return ERPDecode.model(Customer.self, from: fields)!
    }

    private lazy var book: [Customer] = [
        customer("a", "Sana Demo", "+923000000101"),
        customer("b", "Sanaullah Example", "03001112222"),
        customer("c", "Hasan Sample", "923211234567"),
        customer("d", "Ayesha Sana Test", nil, alt: "0333 4445556"),
        customer("e", "Sana", "03009998887"),
        customer("f", "Sana Removed", "03000000999", removed: true),
        customer("g", "Walk-in Customer", "03000000111"),
        customer("h", "Zoë Placeholder"),
    ]

    private func ids(_ q: String, limit: Int = 6) -> [String] { CustomerSearch.rank(q, in: book, limit: limit).map(\.customer.id) }

    func testTheWholeNameFirstThenNamesThatBeginWithItThenWordsThatDo() {
        XCTAssertEqual(ids("sana"), ["e", "a", "b", "d"])
        XCTAssertEqual(ids("  SANA  "), ["e", "a", "b", "d"])
    }

    func testAWordAnywhereInTheName() {
        XCTAssertEqual(ids("dem"), ["a"])
        XCTAssertEqual(ids("test"), ["d"])
    }

    func testEveryTypedWordStartingAWord() {
        XCTAssertEqual(ids("sa de"), ["a"])
        XCTAssertEqual(ids("ay te"), ["d"])
    }

    func testLettersInsideAWordComeLast() {
        // "asan" is inside Hasan only.
        XCTAssertEqual(ids("asan"), ["c"])
    }

    func testANumberHoweverItIsWritten() {
        XCTAssertEqual(ids("0300 111"), ["b"])
        XCTAssertEqual(ids("+92 321 123"), ["c"])
        XCTAssertEqual(ids("1234567"), ["c"])
        // The spare number counts.
        XCTAssertEqual(ids("0333444"), ["d"])
        XCTAssertTrue(CustomerSearch.rank("0333444", in: book).first!.byPhone)
        // Too few digits to mean anything.
        XCTAssertEqual(ids("03"), [])
    }

    func testRemovedAndWalkInRecordsAreNeverOffered() {
        XCTAssertFalse(ids("sana").contains("f"))
        XCTAssertEqual(ids("walk"), [])
        XCTAssertEqual(ids("03000000111"), [])
    }

    func testAccentsAndTheLimit() {
        XCTAssertEqual(ids("zoe"), ["h"])
        XCTAssertEqual(ids("sana", limit: 2), ["e", "a"])
        XCTAssertEqual(ids(""), [])
    }

    func testTheMatchIsMarkedInTheName() {
        let hit = CustomerSearch.rank("demo", in: book).first!
        XCTAssertEqual(String(hit.customer.name[hit.match!]), "Demo")
    }

    func testAnExactNameIsFoundWhateverTheSpacing() {
        XCTAssertEqual(CustomerSearch.exact("sana   demo", in: book).map(\.id), ["a"])
        XCTAssertEqual(CustomerSearch.exact("sana d", in: book), [])
    }
}
