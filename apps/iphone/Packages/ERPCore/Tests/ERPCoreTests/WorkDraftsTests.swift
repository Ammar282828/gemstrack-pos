import XCTest
@testable import ERPCore

/// src/lib/work-drafts.test.ts, the reading side: cards, links, age and ids.
final class WorkDraftsTests: XCTestCase {
    private func draft(_ id: String, _ kind: String = "order", updatedAt: String = "2026-09-27T10:00:00Z") -> WorkDraft {
        WorkDraft(id: id, kind: kind, title: "Sana Ali", detail: "Ruby ring", items: 1, total: 380_000, device: "iPhone",
                  createdAt: "2026-09-27T09:00:00Z", updatedAt: updatedAt)
    }

    func testACardReadsFromTheDocumentWhateverTheFormHolds() {
        // `data` (the form, photos and all) is not decoded; numbers that arrived as text still read.
        let doc: [String: Any] = [
            "kind": "order", "title": "Sana Ali", "detail": "Ruby ring, Bangles +1 · advance PKR 25,000",
            "items": "3", "total": "380000", "device": "iPhone", "createdAt": "2026-09-27T09:00:00Z",
            "updatedAt": "2026-09-27T10:00:00Z", "leftOut": ["photos"],
            "data": ["items": [["sampleImageDataUri": "data:image/jpeg;base64,AAAA"]]],
        ]
        let d = DocJSON.decode(WorkDraft.self, id: "order-lq3x9k2a-ab12c", data: doc)!
        XCTAssertEqual(d.id, "order-lq3x9k2a-ab12c")
        XCTAssertTrue(d.isOrder)
        XCTAssertFalse(d.isSale)
        XCTAssertEqual(d.items, 3)
        XCTAssertEqual(d.total, 380_000)
        XCTAssertEqual(d.leftOut, ["photos"])
        XCTAssertEqual(d.device, "iPhone")
    }

    func testAnOddDocumentStillReads() {
        let d = DocJSON.decode(WorkDraft.self, id: "sale-aaaaaa-b", data: ["kind": "sale"])!
        XCTAssertTrue(d.isSale)
        XCTAssertEqual(d.title, "")
        XCTAssertEqual(d.items, 0)
        XCTAssertEqual(d.leftOut, [])
        // No `updatedAt` means it never said when it was typed: forgotten.
        XCTAssertTrue(isDraftExpired(d, now: Date()))
    }

    func testIdsLinksAndAge() {
        XCTAssertEqual(draftHref(kind: "order", id: "order-1"), "/orders/add?draft=order-1")
        XCTAssertEqual(draftHref(kind: "sale", id: "sale-1"), "/invoices/new?draft=sale-1")
        // encodeURIComponent leaves ! ~ * ' ( ) alone and escapes the rest.
        XCTAssertEqual(draftHref(kind: "order", id: "a b&c/d"), "/orders/add?draft=a%20b%26c%2Fd")
        let now = ERPDate.parse("2026-09-27T12:00:00Z")!
        XCTAssertFalse(isDraftExpired(draft("order-aaaaaa-b", updatedAt: "2026-09-20T12:00:00Z"), now: now))
        XCTAssertTrue(isDraftExpired(draft("order-aaaaaa-b", updatedAt: "2026-08-20T12:00:00Z"), now: now))
        XCTAssertTrue(isDraftExpired(draft("order-aaaaaa-b", updatedAt: ""), now: now))
        // Exactly thirty days is still in hand; a second more is not.
        XCTAssertFalse(isDraftExpired(draft("order-aaaaaa-b", updatedAt: "2026-08-28T12:00:00Z"), now: now))
        XCTAssertTrue(isDraftExpired(draft("order-aaaaaa-b", updatedAt: "2026-08-28T11:59:59Z"), now: now))
    }

    func testAValidDraftId() {
        // newDraftId: "<kind>-<ms in base 36>-<five letters>".
        XCTAssertTrue(isDraftId("order-lq3x9k2a-ab12c"))
        XCTAssertTrue(isDraftId("sale-m1abcd-z"))
        XCTAssertFalse(isDraftId("order-1"))
        XCTAssertFalse(isDraftId("invoice-abcdef-ab"))
        XCTAssertFalse(isDraftId("order-ABCDEF-ab"))
        XCTAssertFalse(isDraftId("order-abcde-ab"))
        XCTAssertFalse(isDraftId("order-abcdef-abcdefghi"))
        XCTAssertFalse(isDraftId("order-abcdef-"))
        XCTAssertFalse(isDraftId("order-abc def-ab"))
    }

    func testTheListIsNewestTypedFirstWithTheExpiredApart() {
        let now = ERPDate.parse("2026-09-27T12:00:00Z")!
        let older = draft("order-aaaaaa-a", updatedAt: "2026-09-25T10:00:00Z")
        let newer = draft("sale-bbbbbb-b", "sale", updatedAt: "2026-09-27T10:00:00Z")
        let gone = draft("order-cccccc-c", updatedAt: "2026-07-01T10:00:00Z")
        let out = draftList([older, gone, newer], now: now)
        XCTAssertEqual(out.live.map(\.id), ["sale-bbbbbb-b", "order-aaaaaa-a"])
        XCTAssertEqual(out.expired.map(\.id), ["order-cccccc-c"])
    }

    func testAnOrderCardReadsByPiecesAndAdvance() {
        XCTAssertEqual(draftOrderDetail(names: ["Ruby ring", "Bangles", "Chain"], pieces: 3, advance: 25_000),
                       "Ruby ring, Bangles +1 · advance PKR 25,000")
        XCTAssertEqual(draftOrderDetail(names: ["Ruby ring"], pieces: 1, advance: 0), "Ruby ring")
        XCTAssertEqual(draftOrderDetail(names: [], pieces: 2, advance: 0), "2 pieces")
        XCTAssertEqual(draftOrderDetail(names: [], pieces: 1, advance: 0), "1 piece")
        XCTAssertEqual(draftOrderDetail(names: [], pieces: 0, advance: 0), "No pieces yet")
    }

    func testASaleCardReadsByTheCartAndTheDiscount() {
        XCTAssertEqual(draftSaleDetail(names: ["Gents ring", "B-3"], discount: 0), "Gents ring, B-3")
        XCTAssertEqual(draftSaleDetail(names: ["A", "B", "C", "D"], discount: 5_000), "A, B +2 · discount PKR 5,000")
        XCTAssertEqual(draftSaleDetail(names: [], discount: 0), "No pieces yet")
    }

    func testTheTitleIsWhoItIsFor() {
        XCTAssertEqual(draftTitle(customer: "  Sana Ali "), "Sana Ali")
        XCTAssertEqual(draftTitle(customer: "   "), "No customer yet")
    }
}
