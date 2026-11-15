import XCTest
@testable import ERPCore

/// src/lib/collect.test.ts, case for case (names made up).
final class CollectTests: XCTestCase {
    private func inv(_ o: [String: Any]) -> Invoice {
        var f: [String: Any] = ["id": "I", "customerName": "A", "createdAt": "2026-11-01", "balanceDue": 0, "grandTotal": 100,
                                "subtotal": 100, "items": [Any](), "paymentHistory": [Any]()]
        f.merge(o) { _, new in new }
        return ERPDecode.model(Invoice.self, from: f)!
    }

    private func ord(_ o: [String: Any]) -> Order {
        var f: [String: Any] = ["id": "O", "customerName": "B", "createdAt": "2026-10-01", "status": "Completed", "grandTotal": 0,
                                "subtotal": 500, "advancePayment": 0, "items": [Any]()]
        f.merge(o) { _, new in new }
        return ERPDecode.model(Order.self, from: f)!
    }

    // MARK: who still owes

    private var rows: [CollectRow] {
        collectRows(
            [inv(["id": "I1", "balanceDue": 3000, "takenBy": "Mansoor"]), inv(["id": "I2", "balanceDue": 0]),
             inv(["id": "I3", "balanceDue": 900, "status": "Refunded"]),
             inv(["id": "I4", "balanceDue": 7000, "takenBy": "Murtaza", "createdAt": "2026-09-01"])],
            [ord(["id": "O1", "grandTotal": 2000, "takenBy": "Mansoor"]), ord(["id": "O2", "grandTotal": 2000, "invoiceId": "I1"]),
             ord(["id": "O3", "grandTotal": 2000, "status": "In Progress"])]
        )
    }

    func testTakesOwingInvoicesAndCompletedUninvoicedOrdersWithABalanceNothingPaidRefundedInvoicedOrUnfinished() {
        XCTAssertEqual(rows.map(\.id).sorted(), ["I1", "I4", "O1"])
    }

    func testSortsByWhoTookThemOldestFirstWithinEach() {
        XCTAssertEqual(sortRows(rows, by: .takenBy).map(\.id), ["O1", "I1", "I4"])
        XCTAssertEqual(sortRows(rows, by: .amount)[0].id, "I4")
    }

    func testTotalsEachPerson() {
        XCTAssertEqual(byTakenBy(rows), [CollectPerson(takenBy: "Murtaza", count: 1, due: 7000), CollectPerson(takenBy: "Mansoor", count: 2, due: 5000)])
    }

    func testAnOrdersFullAmountIsItsSubtotalLessTheDiscountNeverTheBalance() {
        let r = collectRows([], [ord(["id": "O5", "grandTotal": 2000, "subtotal": 3000, "discountAmount": 200, "advancePayment": 1000])])
        XCTAssertEqual(r.first?.total, 2800)
        XCTAssertEqual(r.first?.due, 2000)
        // No subtotal kept: the balance with the advances put back.
        XCTAssertEqual(orderFullTotal(ord(["subtotal": 0, "grandTotal": 2000, "advancePayment": 1000, "advanceInExchangeValue": 500])), 3500)
    }

    func testNobodyRecordedSortsLast() {
        let r = collectRows([inv(["id": "I7", "balanceDue": 100]), inv(["id": "I8", "balanceDue": 50, "takenBy": "Zed"])], [])
        XCTAssertEqual(sortRows(r, by: .takenBy).map(\.id), ["I8", "I7"])
        XCTAssertEqual(byTakenBy(r).map(\.takenBy), ["Zed", ""])
    }

    // MARK: several filters at once

    private let now = ERPDate.parse("2026-11-14")!

    private var manyRows: [CollectRow] {
        collectRows(
            [inv(["id": "I1", "balanceDue": 3000, "grandTotal": 5000, "subtotal": 5000, "takenBy": "Mansoor", "createdAt": "2026-11-10", "customerContact": "0300 1234567"]),
             inv(["id": "I4", "balanceDue": 100, "grandTotal": 100, "subtotal": 100, "takenBy": "Murtaza", "createdAt": "2026-07-01"])],
            [ord(["id": "O1", "grandTotal": 2000, "subtotal": 3000, "advancePayment": 1000, "takenBy": "Mansoor", "createdAt": "2026-09-01", "customerName": "Sana"]),
             ord(["id": "O9", "grandTotal": 400, "takenBy": "Fatema", "createdAt": "2026-11-01"])]
        )
    }

    func testOrsWithinAGroupAndAndsAcrossThem() {
        let r = manyRows
        XCTAssertEqual(filterRows(r, CollectFilters(people: ["Mansoor", "Murtaza"]), now: now).map(\.id).sorted(), ["I1", "I4", "O1"])
        XCTAssertEqual(filterRows(r, CollectFilters(people: ["Mansoor", "Murtaza"], kinds: [.invoice]), now: now).map(\.id).sorted(), ["I1", "I4"])
        XCTAssertEqual(filterRows(r, CollectFilters(people: ["Mansoor"], ages: [.thirtyTo90, .over90]), now: now).map(\.id), ["O1"])
    }

    func testKnowsAgeNothingPaidAndASearchByNameNumberOrBill() {
        let r = manyRows
        XCTAssertEqual(filterRows(r, CollectFilters(ages: [.over90]), now: now).map(\.id), ["I4"])
        XCTAssertEqual(filterRows(r, CollectFilters(paid: [.nothing]), now: now).map(\.id), ["I4"])
        XCTAssertEqual(filterRows(r, CollectFilters(query: "sana"), now: now).map(\.id), ["O1"])
        XCTAssertEqual(filterRows(r, CollectFilters(query: "1234567"), now: now).map(\.id), ["I1"])
        XCTAssertEqual(filterRows(r, CollectFilters(query: "o9"), now: now).map(\.id), ["O9"])
    }

    func testCountsEachChipWithTheOtherGroupsOn() {
        let c = countBy(manyRows, CollectFilters(people: ["Fatema"], kinds: [.invoice]), group: .people, valueOf: { $0.takenBy }, now: now)
        XCTAssertEqual(c["Mansoor"]?.count, 1)
        XCTAssertNil(c["Fatema"])
    }
}
