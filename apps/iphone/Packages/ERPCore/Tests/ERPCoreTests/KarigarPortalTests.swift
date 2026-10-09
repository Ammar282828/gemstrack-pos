import XCTest
@testable import ERPCore

/// The karigar portal (src/app/my-work/page.tsx, /api/karigar/me, groupJobsByOrder in workshop.ts). The JSON is the
/// route's own shape, made-up names.
final class KarigarPortalTests: XCTestCase {
    private func job(_ id: String, source: String = "order", orderId: String? = nil, status: String = "pending",
                     age: Int = 1, urgency: String = "ok", _ more: [String: Any] = [:]) -> KarigarPortalJob {
        var f: [String: Any] = ["id": id, "source": source, "description": "Piece \(id)", "status": status,
                                "assignedDate": "2026-10-01T08:00:00Z", "ageDays": age, "urgency": urgency]
        if let orderId { f["orderId"] = orderId }
        for (k, v) in more { f[k] = v }
        return ERPDecode.model(KarigarPortalJob.self, from: f)!
    }

    func testTheRoutesAnswerReads() throws {
        let json = """
        {"role":"karigar","preview":false,"karigar":{"id":"KAR-1","name":"Ustad Demo"},
         "summary":{"active":3,"inProgress":1,"late":1,"critical":1,"oldestDays":15},
         "jobs":[{"id":"order:ORD-7:0","source":"order","description":"Plain band","weightG":4.2,"quantity":1,"size":"12",
                  "status":"in-progress","assignedDate":"2026-09-24T08:00:00.000Z","ageDays":15,"urgency":"critical","orderId":"ORD-7",
                  "sampleGiven":true,"notes":"Matte finish"}],
         "account":{"goldGiven":10.5,"goldReceived":4,"goldNet":6.5,"totalPaid":120000,
                    "ledger":[{"date":"2026-10-02T00:00:00.000Z","description":"Gold given","goldOut":10.5,"goldIn":0}],
                    "payments":[{"date":"2026-10-03T00:00:00.000Z","amount":120000,"description":"Part payment"}]}}
        """
        let p = try JSONDecoder().decode(KarigarPortal.self, from: Data(json.utf8))
        XCTAssertEqual(p.role, "karigar")
        XCTAssertFalse(p.preview)
        XCTAssertEqual(p.karigar, KarigarPortalPerson.named("KAR-1", "Ustad Demo"))
        XCTAssertEqual(p.summary.active, 3)
        XCTAssertEqual(p.summary.critical, 1)
        XCTAssertEqual(p.jobs.count, 1)
        XCTAssertEqual(p.jobs[0].weightG, 4.2)
        XCTAssertTrue(p.jobs[0].sampleGiven)
        XCTAssertEqual(p.jobs[0].notes, "Matte finish")
        XCTAssertEqual(p.account.goldNet, 6.5)
        XCTAssertEqual(p.account.ledger.count, 1)
        XCTAssertEqual(p.account.payments[0].amount, 120000)
    }

    func testNoWorkAccountReadsAsNoKarigar() throws {
        // What the route says to an owner who named nobody, or to an address with no karigar on file.
        let p = try JSONDecoder().decode(KarigarPortal.self, from: Data(#"{"role":"owner","karigar":null}"#.utf8))
        XCTAssertNil(p.karigar)
        XCTAssertEqual(p.jobs.count, 0)
        XCTAssertEqual(p.summary.active, 0)
        XCTAssertEqual(p.account.totalPaid, 0)
        let none = try JSONDecoder().decode(KarigarPortal.self, from: Data("{}".utf8))
        XCTAssertNil(none.karigar)
    }

    func testTheSectionsSplitByUrgencyOldestFirstWithinAnOrderAndTheFinishedApart() {
        let jobs = [
            job("a", orderId: "ORD-2", age: 3, urgency: "ok"),
            job("b", orderId: "ORD-1", age: 16, urgency: "critical"),
            job("c", orderId: "ORD-1", age: 9, urgency: "warning"),
            job("d", orderId: "ORD-3", status: "completed", age: 20),
            job("e", source: "manual", age: 15, urgency: "critical"),
            job("f", orderId: "ORD-1", age: 1, urgency: "ok"),
        ]
        let s = KarigarPortalRules.sections(jobs)
        XCTAssertEqual(s.active.count, 5)
        // By order number (a stock piece last), then the oldest first.
        XCTAssertEqual(s.critical.map(\.id), ["b", "e"])
        XCTAssertEqual(s.late.map(\.id), ["c"])
        XCTAssertEqual(s.onTrack.map(\.id), ["f", "a"])
        XCTAssertEqual(s.done.map(\.id), ["d"])
    }

    func testPiecesGroupUnderTheirOrderTheOldestGroupFirst() {
        let jobs = [
            job("a", orderId: "ORD-2", age: 3),
            job("b", orderId: "ORD-1", age: 5),
            job("c", orderId: "ORD-2", age: 9),
            job("d", source: "manual", age: 7),
            job("e", source: "manual", age: 7),
        ]
        let g = KarigarPortalRules.groups(jobs)
        // ORD-2 is 9 days old (its oldest piece), then the two stock pieces (7, each alone), then ORD-1 (5).
        XCTAssertEqual(g.map(\.key), ["order:ORD-2", "job:d", "job:e", "order:ORD-1"])
        XCTAssertEqual(g[0].jobs.map(\.id), ["a", "c"])
        XCTAssertEqual(g[0].ageDays, 9)
        XCTAssertEqual(g[0].orderId, "ORD-2")
        XCTAssertFalse(g[0].isStock)
        XCTAssertTrue(g[1].isStock)
        XCTAssertNil(g[1].orderId)
    }

    func testACardIsUrgentByItsOldestPieceUnlessAllAreDone() {
        func group(_ jobs: [KarigarPortalJob]) -> KarigarPortalGroup { KarigarPortalRules.groups(jobs)[0] }
        XCTAssertEqual(group([job("a", orderId: "O", age: 14)]).urgency, "critical")
        XCTAssertEqual(group([job("a", orderId: "O", age: 7)]).urgency, "warning")
        XCTAssertEqual(group([job("a", orderId: "O", age: 6)]).urgency, "ok")
        XCTAssertEqual(group([job("a", orderId: "O", status: "completed", age: 30)]).urgency, "ok")
        // The card's age is its oldest piece's, finished or not (groupJobsByOrder takes the max of all).
        XCTAssertEqual(group([job("a", orderId: "O", status: "completed", age: 2), job("b", orderId: "O", age: 8)]).urgency, "warning")
    }

    func testTheSpecBoxesInThePagesOrder() {
        let j = job("a", orderId: "O", ["size": "12", "weightG": 4.5, "plating": "White Rhodium", "category": "Rings",
                                         "karat": "21k", "referenceSku": "R-12", "quantity": 2])
        let specs = KarigarPortalRules.specs(j)
        XCTAssertEqual(specs.map(\.label), ["Size", "Weight", "Finish", "Type", "Karat", "Ref", "Qty"])
        XCTAssertEqual(specs.map(\.value), ["12", "4.5g", "White Rhodium", "Rings", "21K", "R-12", "2"])
        XCTAssertEqual(specs.map(\.accent), [true, false, true, false, false, false, false])
        // Nothing to say, no boxes; one of a thing is not a quantity; a zero weight is no weight.
        XCTAssertEqual(KarigarPortalRules.specs(job("b", orderId: "O", ["weightG": 0, "quantity": 1])).count, 0)
    }

    func testDatesAreKarachisAndGramsHaveThreePlaces() {
        XCTAssertEqual(KarigarPortalRules.date("2026-10-05T08:00:00.000Z"), "05 Oct 2026")
        XCTAssertEqual(KarigarPortalRules.date("2026-10-05T08:00:00.000Z", shortYear: true), "05 Oct 26")
        // 4 Oct 20:00 UTC is already the 5th in Karachi.
        XCTAssertEqual(KarigarPortalRules.date("2026-10-04T20:00:00Z"), "05 Oct 2026")
        XCTAssertEqual(KarigarPortalRules.date("2026-09-30T08:00:00Z"), "30 Sep 2026")
        XCTAssertEqual(KarigarPortalRules.date(""), "")
        XCTAssertEqual(KarigarPortalRules.grams(6.5), "6.500g")
        XCTAssertEqual(KarigarPortalRules.grams(0), "0.000g")
    }
}

private extension KarigarPortalPerson {
    /// A person as the route would send them, for the test to compare with.
    static func named(_ id: String, _ name: String) -> KarigarPortalPerson {
        try! JSONDecoder().decode(KarigarPortalPerson.self, from: Data(#"{"id":"\#(id)","name":"\#(name)"}"#.utf8))
    }
}
