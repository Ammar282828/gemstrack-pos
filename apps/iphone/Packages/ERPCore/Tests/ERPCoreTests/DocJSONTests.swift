import XCTest
@testable import ERPCore

final class DocJSONTests: XCTestCase {
    func testServerTimestampsBecomeISO() throws {
        let doc: [String: Any] = [
            "id": "ORD-000001",
            "createdAt": ["_seconds": 1_791_446_400, "_nanoseconds": 500_000_000],
            "status": "Pending",
            "grandTotal": 12_500,
        ]
        let orders = DocJSON.decodeList(Order.self, from: [doc])
        XCTAssertEqual(orders.count, 1)
        XCTAssertEqual(orders[0].createdAt, ERPDate.iso(Date(timeIntervalSince1970: 1_791_446_400.5)))
        XCTAssertEqual(orders[0].grandTotal, 12_500)
    }

    func testDocumentIdWinsAndOddValuesDrop() throws {
        let data: [String: Any] = [
            "id": "stale",
            "name": "Demo Customer",
            "when": Date(timeIntervalSince1970: 0),
            "blob": Data([1, 2, 3]),
            "bad": Double.nan,
            "flag": true,
            "nested": [["seconds": 10, "nanoseconds": 0]],
        ]
        let plain = try XCTUnwrap(DocJSON.plain(data) as? [String: Any])
        XCTAssertEqual(plain["when"] as? String, "1970-01-01T00:00:00.000Z")
        XCTAssertEqual(plain["blob"] as? String, "AQID")
        XCTAssertNil(plain["bad"])
        XCTAssertEqual((plain["nested"] as? [Any])?.first as? String, "1970-01-01T00:00:10.000Z")
        XCTAssertTrue(JSONSerialization.isValidJSONObject(plain))

        let c = try XCTUnwrap(DocJSON.decode(Customer.self, id: "CUST-1", data: data))
        XCTAssertEqual(c.id, "CUST-1")
        XCTAssertEqual(c.name, "Demo Customer")
    }

    func testCustomHookTurnsSDKObjectsIntoText() {
        struct Ref { let path: String }
        let plain = DocJSON.plain(["ref": Ref(path: "customers/CUST-1")]) { ($0 as? Ref)?.path } as? [String: Any]
        XCTAssertEqual(plain?["ref"] as? String, "customers/CUST-1")
    }
}
