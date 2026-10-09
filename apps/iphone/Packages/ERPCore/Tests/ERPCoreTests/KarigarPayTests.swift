import XCTest
@testable import ERPCore

/// src/lib/karigar-pay.test.ts, case for case. Karigars, batches and amounts made up.
final class KarigarPayTests: XCTestCase {
    private func pay(_ id: String, _ date: String, _ amount: Any, _ more: [String: Any] = [:]) -> Expense {
        var f: [String: Any] = ["id": id, "date": date, "amount": amount, "karigarId": "k1"]
        for (k, v) in more { f[k] = v }
        return ERPDecode.model(Expense.self, from: f)!
    }

    private func batch(_ id: String, _ startDate: String, _ more: [String: Any] = [:]) -> KarigarBatch {
        var f: [String: Any] = ["id": id, "karigarId": "k1", "label": id.uppercased(), "startDate": startDate]
        for (k, v) in more { f[k] = v }
        return ERPDecode.model(KarigarBatch.self, from: f)!
    }

    private func silverRow(_ f: [String: Any]) -> KarigarSilverTransaction { ERPDecode.model(KarigarSilverTransaction.self, from: f)! }

    private var batches: [KarigarBatch] {
        [
            batch("b-aug", "2026-08-01T09:00:00.000Z", ["closedDate": "2026-08-31T18:00:00.000Z"]),
            batch("b-sep", "2026-09-01T09:00:00.000Z", ["closedDate": "2026-09-30T18:00:00.000Z"]),
            batch("b-oct", "2026-10-01T09:00:00.000Z"),
            batch("b-other", "2026-10-02T09:00:00.000Z", ["karigarId": "k2"]),
        ]
    }

    private var expenses: [Expense] {
        [
            pay("e1", "2026-08-10T10:00:00.000Z", 5_000, ["batchId": "b-aug"]),
            pay("e2", "2026-09-12T10:00:00.000Z", 7_000, ["batchId": "b-sep"]),
            pay("e3", "2026-09-20T10:00:00.000Z", 3_000, ["batchId": "b-sep"]),
            pay("e4", "2026-10-03T10:00:00.000Z", 4_000, ["batchId": "b-oct"]),
            pay("e5", "2026-10-05T10:00:00.000Z", 6_000, ["batchId": "b-oct"]),
            pay("e6", "2026-07-01T10:00:00.000Z", 1_500),
            pay("e7", "2026-10-04T10:00:00.000Z", 900, ["karigarId": "k2", "batchId": "b-other"]),
            pay("e8", "2026-10-06T10:00:00.000Z", 250, ["karigarId": NSNull()]),
        ]
    }

    // MARK: karigarPay

    func testAddsEveryPaymentToHimInTheBatchesAndOutsideThemAndNobodyElses() {
        XCTAssertEqual(KarigarPay.figures(karigarId: "k1", expenses: expenses, batches: batches).totalPaid, 26_500)
    }

    func testFilesHisPaymentsUnderTheOpenBatchNewestFirst() {
        let p = KarigarPay.figures(karigarId: "k1", expenses: expenses, batches: batches)
        XCTAssertEqual(p.open?.batch.id, "b-oct")
        XCTAssertEqual(p.open?.payments.map(\.id), ["e5", "e4"])
        XCTAssertEqual(p.open?.total, 10_000)
    }

    func testListsTheSettledBatchesNewestFirstEachTotalledFromItsPaymentsAsTheyAreNow() {
        let p = KarigarPay.figures(karigarId: "k1", expenses: expenses,
                                   batches: batches + [batch("b-jul", "2026-07-01T09:00:00.000Z", ["closedDate": "2026-07-31T18:00:00.000Z"])])
        XCTAssertEqual(p.settled.map(\.batch.id), ["b-sep", "b-aug", "b-jul"])
        XCTAssertEqual(p.settled.map(\.total), [10_000, 5_000, 0])
        XCTAssertEqual(p.settled.map { $0.payments.map(\.id) }, [["e3", "e2"], ["e1"], []])
    }

    func testKeepsPaymentsOutsideAnyBatchApartABlankBatchIdCountingAsNone() {
        let p = KarigarPay.figures(karigarId: "k1",
                                   expenses: expenses + [pay("e9", "2026-10-07T10:00:00.000Z", 100, ["batchId": ""]), pay("e10", "2026-06-01T10:00:00.000Z", 50, ["batchId": NSNull()])],
                                   batches: batches)
        XCTAssertEqual(p.direct.map(\.id), ["e9", "e6", "e10"])
        XCTAssertEqual(p.directTotal, 1_650)
    }

    func testListsAPaymentWhoseBatchWasDeletedWithTheDirectOnesAndCountsItInWhatHeHasBeenPaid() {
        let p = KarigarPay.figures(karigarId: "k1",
                                   expenses: [pay("e1", "2026-10-01T10:00:00.000Z", 2_000, ["batchId": "gone"]), pay("e2", "2026-10-02T10:00:00.000Z", 500)],
                                   batches: [])
        XCTAssertEqual(p.totalPaid, 2_500)
        XCTAssertNil(p.open)
        XCTAssertTrue(p.settled.isEmpty)
        XCTAssertEqual(p.direct.map(\.id), ["e2", "e1"])
        XCTAssertEqual(p.directTotal, 2_500)
    }

    func testTakesTheNewestOpenBatchWhenTwoAreOpenAndABlankClosingDateAsOpen() {
        let two = [batch("old", "2026-09-01T09:00:00.000Z"), batch("new", "2026-10-01T09:00:00.000Z", ["closedDate": ""])]
        XCTAssertEqual(KarigarPay.figures(karigarId: "k1", expenses: [], batches: two).open?.batch.id, "new")
        XCTAssertTrue(KarigarPay.isOpen(batch("a", "2026-10-01T00:00:00.000Z", ["closedDate": ""])))
        XCTAssertTrue(KarigarPay.isOpen(batch("b", "2026-10-01T00:00:00.000Z", ["closedDate": NSNull()])))
        XCTAssertTrue(KarigarPay.isOpen(batch("c", "2026-10-01T00:00:00.000Z")))
        XCTAssertFalse(KarigarPay.isOpen(batch("d", "2026-10-01T00:00:00.000Z", ["closedDate": "2026-10-01T00:00:00.000Z"])))
    }

    func testSortsADateItCannotReadAsTheOldestAndKeepsEqualDatesInTheOrderTheyCame() {
        let p = KarigarPay.figures(
            karigarId: "k1",
            expenses: [pay("odd", "someday", 10), pay("a", "2026-10-01T10:00:00.000Z", 20), pay("b", "2026-10-01T10:00:00.000Z", 30)],
            batches: [batch("x", "soon", ["closedDate": "2026-10-01T00:00:00.000Z"]), batch("y", "2026-09-01T09:00:00.000Z", ["closedDate": "2026-09-30T00:00:00.000Z"])]
        )
        XCTAssertEqual(p.direct.map(\.id), ["a", "b", "odd"])
        XCTAssertEqual(p.settled.map(\.batch.id), ["y", "x"])
    }

    func testReadsAnAmountKeptAsTextAndOneThatIsNotANumberAsNothing() {
        let odd = [pay("t", "2026-10-01T10:00:00.000Z", "1500"), pay("n", "2026-10-02T10:00:00.000Z", "lots")]
        XCTAssertEqual(KarigarPay.figures(karigarId: "k1", expenses: odd, batches: []).totalPaid, 1_500)
    }

    // MARK: batchTotal

    func testBatchTotalIsWhatSettlingWritesHisPaymentsFiledUnderTheBatch() {
        let b = batch("b-oct", "2026-10-01T09:00:00.000Z")
        let filed = [
            pay("e1", "2026-10-02T10:00:00.000Z", 4_000, ["batchId": "b-oct"]),
            pay("e2", "2026-10-03T10:00:00.000Z", 2_500, ["batchId": "b-oct"]),
            // Someone else's expense with the same batch id is not his.
            pay("e3", "2026-10-03T10:00:00.000Z", 9_999, ["batchId": "b-oct", "karigarId": "k2"]),
            pay("e4", "2026-10-04T10:00:00.000Z", 1_000),
        ]
        XCTAssertEqual(KarigarPay.batchTotal(b, expenses: filed), 6_500)
        XCTAssertEqual(KarigarPay.batchPayments(b, expenses: filed).map(\.id), ["e2", "e1"])
        XCTAssertEqual(KarigarPay.batchTotal(b, expenses: []), 0)
    }

    // MARK: Silver

    func testChargesTheGramsAtTheRatePerGram() {
        XCTAssertEqual(KarigarPay.silverSurcharge(grams: 12.5, perGram: 35), 437.5)
        XCTAssertEqual(KarigarPay.silverSurcharge(grams: 50, perGram: 0), 0)
    }

    func testSaysWhatTheFormSaysWhenTheFiguresCannotBeSaved() {
        XCTAssertEqual(KarigarPay.silverProblem(grams: 0, perGram: 10), "Silver grams must be greater than 0")
        XCTAssertEqual(KarigarPay.silverProblem(grams: -1, perGram: 10), "Silver grams must be greater than 0")
        XCTAssertEqual(KarigarPay.silverProblem(grams: .nan, perGram: 10), "Silver grams must be greater than 0")
        XCTAssertEqual(KarigarPay.silverProblem(grams: 5, perGram: -1), "Surcharge must be non-negative")
        XCTAssertEqual(KarigarPay.silverProblem(grams: 5, perGram: .infinity), "Surcharge must be non-negative")
        XCTAssertNil(KarigarPay.silverProblem(grams: 5, perGram: 0))
        XCTAssertNil(KarigarPay.silverProblem(grams: 0.001, perGram: 35))
    }

    func testAddsHisSilverEntriesNewestFirstAndNobodyElses() {
        let rows = [
            silverRow(["id": "s1", "karigarId": "k1", "date": "2026-09-01T10:00:00.000Z", "silverGrams": 50.5, "surchargePerGram": 30, "totalSurcharge": 1_515]),
            silverRow(["id": "s2", "karigarId": "k1", "date": "2026-10-01T10:00:00.000Z", "silverGrams": 20, "surchargePerGram": 35, "totalSurcharge": 700]),
            silverRow(["id": "s3", "karigarId": "k2", "date": "2026-10-02T10:00:00.000Z", "silverGrams": 99, "surchargePerGram": 1, "totalSurcharge": 99]),
        ]
        let s = KarigarPay.silver(karigarId: "k1", rows: rows)
        XCTAssertEqual(s.rows.map(\.id), ["s2", "s1"])
        XCTAssertEqual(s.grams, 70.5, accuracy: 1e-9)
        XCTAssertEqual(s.surcharge, 2_215)
        let none = KarigarPay.silver(karigarId: "nobody", rows: rows)
        XCTAssertTrue(none.rows.isEmpty)
        XCTAssertEqual(none.grams, 0)
        XCTAssertEqual(none.surcharge, 0)
    }

    func testDecodesASilverEntryLeniently() {
        let s = silverRow(["id": "s1", "karigarId": "k1", "silverGrams": "12.5", "totalSurcharge": "437.5"])
        XCTAssertEqual(s.silverGrams, 12.5)
        XCTAssertEqual(s.surchargePerGram, 0)
        XCTAssertEqual(s.totalSurcharge, 437.5)
        XCTAssertEqual(s.date, "")
        XCTAssertNil(s.description)
    }
}
