import XCTest
@testable import ERPCore

/// A piece's reference photos (lib/order-photos.ts): the first where every older order keeps it, the rest in `extraPhotos`.
final class OrderPhotosTests: XCTestCase {
    private func piece(_ extra: String) throws -> OrderItem {
        let json = #"{"description":"Ring","metalType":"gold","samplePhotoId":"p1"\#(extra)}"#
        return try JSONDecoder().decode(OrderItem.self, from: Data(json.utf8))
    }

    func testAnOlderPieceHasNoExtras() throws {
        let item = try piece("")
        XCTAssertEqual(item.samplePhotoId, "p1")
        XCTAssertTrue(item.extraPhotos.isEmpty)
    }

    func testExtrasReadInOrderAndOdditiesAreDropped() throws {
        let item = try piece(#","extraPhotos":[{"id":"p2","hash":"h"},{"dataUri":"data:image/jpeg;base64,AAA"},{},"junk"]"#)
        XCTAssertEqual(item.extraPhotos.count, 2)
        XCTAssertEqual(item.extraPhotos[0].id, "p2")
        XCTAssertEqual(item.extraPhotos[1].dataUri, "data:image/jpeg;base64,AAA")
    }

    func testKarigarJobReadsExtraPictures() throws {
        let json = #"{"id":"order:O:0","source":"order","description":"Ring","sampleImage":"data:a","extraSampleImages":["data:b","data:c"]}"#
        let job = try JSONDecoder().decode(KarigarPortalJob.self, from: Data(json.utf8))
        XCTAssertEqual(job.extraSampleImages, ["data:b", "data:c"])
    }
}
