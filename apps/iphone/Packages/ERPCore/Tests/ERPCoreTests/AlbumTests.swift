import XCTest
@testable import ERPCore

/// src/lib/social/album.ts, case for case.
final class AlbumTests: XCTestCase {
    func testTheCaptionIsUnderTheFirstPhotoOnly() {
        XCTAssertEqual(Album.captions("Ruby ring", count: 3), ["Ruby ring", "", ""])
        XCTAssertEqual(Album.captions("Ruby ring", count: 1), ["Ruby ring"])
        XCTAssertEqual(Album.captions("x", count: 0), [])
    }

    func testFileNamesFollowTheQueue() {
        XCTAssertEqual(Album.fileName("ruby-ring", 0), "ruby-ring.jpg")
        XCTAssertEqual(Album.fileName("ruby-ring", 2), "ruby-ring-3.jpg")
        XCTAssertEqual(Album.fileName("", 0), "piece.jpg")
    }

    func testACarouselTakesTheFirstTen() {
        XCTAssertEqual(Album.carouselPlan(1).carousel, false)
        XCTAssertEqual(Album.carouselPlan(10).dropped, 0)
        let many = Album.carouselPlan(13)
        XCTAssertEqual(many.take, 10)
        XCTAssertEqual(many.dropped, 3)
        XCTAssertTrue(many.carousel)
    }

    func testInstagramTakesWhatsAppsMarkersOff() {
        XCTAssertEqual(Album.instagramText("*Ruby ring* in _18k_ gold ~was 9~ now"), "Ruby ring in 18k gold was 9 now")
        XCTAssertEqual(Album.instagramText("  a*b*c snake_case_name \n*Bold* line\n"), "a*b*c snake_case_name \nBold line")
        XCTAssertEqual(Album.instagramText("https://taheri.shop/a_b_c (*new*)!"), "https://taheri.shop/a_b_c (new)!")
    }

    func testAPlaceThatFailedAPhotoGetsNoMore() {
        XCTAssertEqual(Album.placesFor(["a", "b", "channel"], failed: ["b"]), ["a", "channel"])
        XCTAssertEqual(Album.placesFor(["a"], failed: ["a"]), [])
        XCTAssertEqual(Album.photosLabel(1), "1 photo")
        XCTAssertEqual(Album.photosLabel(3), "3 photos")
    }
}
