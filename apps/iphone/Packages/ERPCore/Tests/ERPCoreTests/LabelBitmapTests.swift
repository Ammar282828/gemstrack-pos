import XCTest
@testable import ERPCore

/// src/lib/label-bitmap.test.ts (base64, bitmaps, PNG), with the same pictures and the same bits.
final class LabelBitmapTests: XCTestCase {
    func testBase64EncodesAndDecodesWithOrWithoutPadding() {
        XCTAssertEqual(LabelBitmap.base64Encode([]), "")
        XCTAssertEqual(LabelBitmap.base64Encode([0x61]), "YQ==")
        XCTAssertEqual(LabelBitmap.base64Encode([0x61, 0x62]), "YWI=")
        XCTAssertEqual(LabelBitmap.base64Encode([0x61, 0x62, 0x63]), "YWJj")
        XCTAssertEqual(LabelBitmap.base64Decode("YWJj"), [0x61, 0x62, 0x63])
        XCTAssertEqual(LabelBitmap.base64Decode("YW I=\n"), [0x61, 0x62])
        XCTAssertEqual(LabelBitmap.base64Decode("YQ"), [0x61])
        XCTAssertNil(LabelBitmap.base64Decode("YQ=x"))
        XCTAssertNil(LabelBitmap.base64Decode("a$b"))
        XCTAssertEqual(LabelBitmap.hex([0, 15, 16, 255]), "000F10FF")
    }

    func testTurnsAPictureByQuarterTurns() {
        // 3 × 2:  1 0 0 / 0 1 1
        let bytes: [UInt8] = [0b10000000, 0b01100000]
        let half = LabelBitmap.rotate(bytes, width: 3, height: 2, turns: 2)
        XCTAssertEqual([half.width, half.height], [3, 2])
        XCTAssertEqual(half.bytes, [0b11000000, 0b00100000])
        let quarter = LabelBitmap.rotate(bytes, width: 3, height: 2, turns: 1)
        XCTAssertEqual([quarter.width, quarter.height], [2, 3])
        XCTAssertEqual(quarter.bytes, [0b01000000, 0b10000000, 0b10000000])
        let three = LabelBitmap.rotate(bytes, width: 3, height: 2, turns: 3)
        XCTAssertEqual([three.width, three.height], [2, 3])
        XCTAssertEqual(three.bytes, [0b01000000, 0b01000000, 0b10000000])
        XCTAssertEqual(LabelBitmap.rotate(bytes, width: 3, height: 2, turns: 4).bytes, bytes)
    }

    func testGivesTheGFAHexPaddedOrCutToTheSize() {
        let a = LabelBitmap.hex(bitmap: "qoDAwA==", width: 10, height: 2, rotate180: false)
        XCTAssertEqual([a?.hex, "\(a?.total ?? 0)", "\(a?.bytesPerRow ?? 0)"], ["AA80C0C0", "4", "2"])
        let b = LabelBitmap.hex(bitmap: "qoDAwA==", width: 10, height: 1, rotate180: false)
        XCTAssertEqual([b?.hex, "\(b?.total ?? 0)", "\(b?.bytesPerRow ?? 0)"], ["AA80", "2", "2"])
        let c = LabelBitmap.hex(bitmap: "qg==", width: 10, height: 2, rotate180: true)
        XCTAssertEqual([c?.hex, "\(c?.total ?? 0)", "\(c?.bytesPerRow ?? 0)"], ["00001540", "4", "2"])
        XCTAssertNil(LabelBitmap.hex(bitmap: "***", width: 8, height: 1, rotate180: false))
    }

    private func hex(_ bitmap: String, _ w: Int, _ h: Int) -> String? { LabelBitmap.hex(bitmap: bitmap, width: w, height: h, rotate180: false)?.hex }

    func testMakesABitmapFromPixelsGreyOnWhiteClearCountsAsWhite() throws {
        let png = try XCTUnwrap(PNG.decodeDataURL("data:image/png;base64,\(LabelFixtures.png8x2)"))
        XCTAssertEqual([png.width, png.height], [8, 2])
        let b = LabelBitmap.fromRaster(png.rgba, sourceWidth: 8, sourceHeight: 2, width: 8, height: 2)
        XCTAssertEqual(b, "lmU=")
        XCTAssertEqual(hex(b, 8, 2), "9665")
        // Squeezed to 4 × 1, a dot averages a 2 × 2 block: only the last, at 45% grey, is darker than half.
        XCTAssertEqual(hex(LabelBitmap.fromRaster(png.rgba, sourceWidth: 8, sourceHeight: 2, width: 4, height: 1), 4, 1), "10")
        // A lower threshold prints less; brightness lifts the greys.
        XCTAssertEqual(hex(LabelBitmap.fromRaster(png.rgba, sourceWidth: 8, sourceHeight: 2, width: 8, height: 2, threshold: 0.3), 8, 2), "8661")
        XCTAssertEqual(hex(LabelBitmap.fromRaster(png.rgba, sourceWidth: 8, sourceHeight: 2, width: 8, height: 2, brightness: 0.2), 8, 2), "8661")
        // Blown up, each pixel is several dots.
        XCTAssertEqual(hex(LabelBitmap.fromRaster(png.rgba, sourceWidth: 8, sourceHeight: 2, width: 16, height: 2), 16, 2), "C33C3C33")
    }

    func testDithersAGreyRampTheWayAtkinsonAndFloydSteinbergDo() {
        let grey: [UInt8] = [0, 36, 72, 108, 144, 180, 216, 252]
        let rgba: [UInt8] = (grey + grey).flatMap { [$0, $0, $0, UInt8(255)] }
        func bits(_ d: LabelBitmap.Dither) -> String? { hex(LabelBitmap.fromRaster(rgba, sourceWidth: 8, sourceHeight: 2, width: 8, height: 2, dither: d), 8, 2) }
        XCTAssertEqual(bits(.threshold), "F0F0")
        XCTAssertEqual(bits(.atkinson), "F0E4")
        XCTAssertEqual(bits(.floyd), "E8E8")
    }

    // MARK: PNG

    func testInflatesAStoredBlock() {
        let z: [UInt8] = [0x78, 0x01, 0x01, 0x03, 0x00, 0xfc, 0xff, 0x61, 0x62, 0x63, 0x02, 0x4d, 0x01, 0x27]
        XCTAssertEqual(PNG.inflate(z), [0x61, 0x62, 0x63])
        XCTAssertNil(PNG.inflate([0x78, 0x01, 0x01, 0x03, 0x00, 0xfc, 0x00, 0x61]))
        XCTAssertNil(PNG.inflate([1, 2, 3]))
    }

    func testReadsEveryPixelThroughDynamicHuffmanCodesAndAllFiveFilters() throws {
        let img = try XCTUnwrap(PNG.decode(try XCTUnwrap(LabelBitmap.base64Decode(LabelFixtures.png24x20))))
        XCTAssertEqual([img.width, img.height], [24, 20])
        for y in 0..<20 {
            for x in 0..<24 {
                let i = (y * 24 + x) * 4
                XCTAssertEqual([img.rgba[i], img.rgba[i + 1], img.rgba[i + 2], img.rgba[i + 3]], [UInt8((x * 10) & 255), UInt8((y * 12) & 255), UInt8((x * y) & 255), 255], "pixel \(x),\(y)")
            }
        }
    }

    func testGivesNilForWhatItCannotRead() throws {
        XCTAssertNil(PNG.decode([1, 2, 3]))
        XCTAssertNil(PNG.decodeDataURL("data:text/plain;base64,AAAA"))
        XCTAssertNil(PNG.decodeDataURL("https://example.test/a.png"))
        let cut = Array(try XCTUnwrap(LabelBitmap.base64Decode(LabelFixtures.png24x20)).prefix(120))
        XCTAssertNil(PNG.decode(cut))
        XCTAssertNil(PNG.decodeDataURL("data:image/*;base64,!!!"))
    }
}
