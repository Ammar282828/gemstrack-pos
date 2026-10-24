import XCTest
@testable import ERPCore

/// The tag designer's arithmetic (LabelGeometry, LabelEditing, LabelPlaceholders). All values are made up.
final class LabelDesignerTests: XCTestCase {
    private let m = LabelMeasure.estimate

    private func text(_ id: String = "a", x: Int = 10, y: Int = 20, rotation: Int = 0, data: String = "ABCD", fs: Int = 20,
                      width: Int? = nil, lines: Int? = nil, align: String? = nil) -> LabelLayoutField {
        LabelLayoutField(id: id, type: .text, x: x, y: y, rotation: rotation, data: data, fontSize: fs, width: width, lines: lines, align: align)
    }
    private func box(_ id: String, x: Int, y: Int, w: Int, h: Int) -> LabelLayoutField {
        LabelLayoutField(id: id, type: .box, x: x, y: y, width: w, height: h)
    }
    private var layout: LabelLayout { LabelLayout(id: "t", name: "T", widthDots: 400, heightDots: 200) }

    func testTextBoundsSwapAtQuarterTurns() {
        // estimate: 4 letters x 20 x 0.5 = 40 wide, 20 tall
        XCTAssertEqual(LabelGeometry.bounds(text(), measure: m), LabelBox(x: 10, y: 20, w: 40, h: 20))
        XCTAssertEqual(LabelGeometry.bounds(text(rotation: 90), measure: m), LabelBox(x: 10, y: 20, w: 20, h: 40))
        XCTAssertEqual(LabelGeometry.bounds(text(rotation: 180), measure: m), LabelBox(x: 10, y: 20, w: 40, h: 20))
        XCTAssertEqual(LabelGeometry.placement(text(rotation: 270), measure: m).turn, 270)
    }

    func testStackedLinesRunDownAndBlockHeightFollowsLines() {
        let t = text(data: "AB\nCD\nEF")
        let l = LabelGeometry.textLines(t, measure: m)
        XCTAssertEqual(l.lines.map(\.y), [0, 20, 40])
        XCTAssertEqual(l.height, 60)
        let block = text(data: "AB", width: 100, lines: 5)
        XCTAssertEqual(LabelGeometry.bounds(block, measure: m).h, 100)
        XCTAssertEqual(LabelGeometry.bounds(block, measure: m).w, 100)
    }

    func testBlockWrapsAndAligns() {
        let t = text(data: "AAAA BBBB CCCC", width: 90, lines: 3, align: "R")
        let l = LabelGeometry.textLines(t, measure: m).lines
        XCTAssertEqual(l.map(\.text), ["AAAA BBBB", "CCCC"])
        XCTAssertEqual(l[1].x, 50)
        // lines held to the field's count
        let held = LabelGeometry.textLines(text(data: "AAAA BBBB CCCC", width: 45, lines: 2), measure: m).lines
        XCTAssertEqual(held.count, 2)
    }

    func testShapesNeverTurnAndPicturesTurnHalf() {
        var b = box("b", x: 5, y: 6, w: 30, h: 10)
        b.rotation = 90
        XCTAssertEqual(LabelGeometry.placement(b, measure: m).bounds, LabelBox(x: 5, y: 6, w: 30, h: 10))
        XCTAssertEqual(LabelGeometry.placement(b, measure: m).turn, 0)
        var i = LabelLayoutField(id: "i", type: .image, rotation: 180, width: 8, height: 8, bitmap: "AA==")
        XCTAssertEqual(LabelGeometry.placement(i, measure: m).turn, 180)
        i.rotation = 90
        XCTAssertEqual(LabelGeometry.placement(i, measure: m).turn, 0)
    }

    func testQRSizeIsModulesTimesMagnification() {
        let q = LabelLayoutField(id: "q", type: .qr, data: "ABC", qrMagnification: 3)
        XCTAssertEqual(LabelGeometry.bounds(q, measure: m).w, Double(21 * 3))
    }

    func testRotateKeepsTheCentre() {
        let r = LabelEditing.rotated(text(), by: 90, measure: m)
        XCTAssertEqual(r.rotation, 90)
        let a = LabelGeometry.bounds(text(), measure: m), b = LabelGeometry.bounds(r, measure: m)
        XCTAssertEqual(a.midX, b.midX); XCTAssertEqual(a.midY, b.midY)
        XCTAssertEqual(LabelEditing.rotated(text(rotation: 0), by: -90, measure: m).rotation, 270)
        let s = LabelEditing.rotated(box("b", x: 0, y: 0, w: 40, h: 10), measure: m)
        XCTAssertEqual(s.width, 10); XCTAssertEqual(s.height, 40); XCTAssertEqual(s.x, 15); XCTAssertEqual(s.y, -15)
        XCTAssertEqual(LabelEditing.rotated(LabelLayoutField(id: "i", type: .image, width: 4, height: 4), measure: m).rotation, 180)
    }

    func testResizeBoxFromTopLeftKeepsFarCorner() {
        let b = box("b", x: 10, y: 10, w: 50, h: 20)
        let r = LabelEditing.resized(b, handle: .topLeft, to: LabelBox(x: 0, y: 5, w: 60, h: 25), measure: m)
        XCTAssertEqual([r.x, r.y, r.width!, r.height!], [0, 5, 60, 25])
    }

    func testResizeTextSetsWidthAndFontSize() {
        let t = text(data: "ABCDEFGH")
        let wide = LabelEditing.resized(t, handle: .right, to: LabelBox(x: 10, y: 20, w: 120, h: 20), measure: m)
        XCTAssertEqual(wide.width, 120); XCTAssertEqual(wide.fontSize, 20)
        let tall = LabelEditing.resized(t, handle: .bottom, to: LabelBox(x: 10, y: 20, w: 80, h: 40), measure: m)
        XCTAssertEqual(tall.fontSize, 40); XCTAssertNil(tall.width)
    }

    func testResizeQRStepsMagnification() {
        let q = LabelLayoutField(id: "q", type: .qr, x: 0, y: 0, data: "ABC", qrMagnification: 2)
        let r = LabelEditing.resized(q, handle: .bottomRight, to: LabelBox(x: 0, y: 0, w: 130, h: 130), measure: m)
        XCTAssertEqual(r.qrMagnification, 6)
        let top = LabelEditing.resized(q, handle: .topLeft, to: LabelBox(x: -84, y: -84, w: 126, h: 126), measure: m)
        XCTAssertEqual(top.qrMagnification, 6); XCTAssertEqual(top.x, 42 - 126); XCTAssertEqual(top.y, 42 - 126)
    }

    func testResizeBarcodeHeight() {
        let b = LabelLayoutField(id: "b", type: .barcode, data: "AB", height: 40, moduleWidth: 2, showText: true)
        let r = LabelEditing.resized(b, handle: .bottom, to: LabelBox(x: 0, y: 0, w: 114, h: 100), measure: m)
        XCTAssertEqual(r.height, 80)
    }

    func testLockedFieldsDoNotMove() {
        var a = text("a"); a.locked = true
        let out = LabelEditing.moved([a, text("b")], ids: ["a", "b"], dx: 5, dy: 5)
        XCTAssertEqual(out[0].x, 10); XCTAssertEqual(out[1].x, 15)
        XCTAssertEqual(LabelEditing.resized(a, handle: .right, to: LabelBox(x: 0, y: 0, w: 99, h: 99), measure: m), a)
    }

    func testAlignAndDistribute() {
        let f = [box("a", x: 0, y: 0, w: 10, h: 10), box("b", x: 30, y: 5, w: 20, h: 10), box("c", x: 100, y: 9, w: 10, h: 10)]
        let left = LabelEditing.aligned(f, ids: ["a", "b", "c"], edge: .right, measure: m)
        XCTAssertEqual(left.map { $0.x + $0.width! }, [110, 110, 110])
        let mid = LabelEditing.aligned(f, ids: ["b"], edge: .centre, within: LabelBox(x: 0, y: 0, w: 400, h: 200), measure: m)
        XCTAssertEqual(mid[1].x, 190)
        let d = LabelEditing.distributed(f, ids: ["a", "b", "c"], axis: .horizontal, measure: m)
        // span 110, widths 40, gap 35
        XCTAssertEqual(d.map(\.x), [0, 45, 100])
    }

    func testStackOrder() {
        let f = ["a", "b", "c", "d"].map { text($0) }
        XCTAssertEqual(LabelEditing.reordered(f, ids: ["b"], .forward).map(\.id), ["a", "c", "b", "d"])
        XCTAssertEqual(LabelEditing.reordered(f, ids: ["b"], .backward).map(\.id), ["b", "a", "c", "d"])
        XCTAssertEqual(LabelEditing.reordered(f, ids: ["a", "b"], .front).map(\.id), ["c", "d", "a", "b"])
        XCTAssertEqual(LabelEditing.reordered(f, ids: ["c", "d"], .back).map(\.id), ["c", "d", "a", "b"])
        XCTAssertEqual(LabelEditing.reordered(f, ids: ["d"], .forward).map(\.id), ["a", "b", "c", "d"])
        // layers list shows d c b a; dragging "d" (row 0) below "c" (destination 2)
        XCTAssertEqual(LabelEditing.reorderedByLayerList(f, from: IndexSet(integer: 0), to: 2).map(\.id), ["a", "b", "d", "c"])
    }

    func testDuplicateGivesFreshIds() {
        let now = Date(timeIntervalSince1970: 1000)
        let r = LabelEditing.duplicated([text("field-1000000")], ids: ["field-1000000"], now: now)
        XCTAssertEqual(r.fields.count, 2)
        XCTAssertEqual(r.fields[1].x, 20)
        XCTAssertEqual(r.ids, ["field-1000000-2"])
    }

    func testClipboardRoundTrips() {
        let s = LabelEditing.clipboardText([text("a", data: "{sku}")])
        XCTAssertEqual(LabelEditing.fields(fromClipboard: s).first?.data, "{sku}")
        XCTAssertTrue(LabelEditing.fields(fromClipboard: "hello").isEmpty)
    }

    func testSnap() {
        let label = LabelBox(x: 0, y: 0, w: 400, h: 200)
        let g = LabelEditing.snap(LabelBox(x: 13, y: 27, w: 10, h: 10), others: [], label: label, grid: 8, threshold: 4)
        XCTAssertEqual(g.dx, 3); XCTAssertEqual(g.dy, -3)
        let o = LabelEditing.snap(LabelBox(x: 198, y: 50, w: 10, h: 10), others: [], label: label, grid: nil, threshold: 4)
        XCTAssertEqual(o.guideX, 200)
        XCTAssertEqual(o.dx, 2) // its left edge (198) to the label centre (200)
        XCTAssertNil(o.guideY)
    }

    func testResampleBitmap() {
        // 2x2: black top-left and bottom-right → 4x4 doubles each dot
        let src = LabelBitmap.base64Encode([0x80, 0x40])
        let out = LabelEditing.resampledBitmap(src, fromWidth: 2, fromHeight: 2, toWidth: 4, toHeight: 4)!
        XCTAssertEqual(LabelBitmap.base64Decode(out)!, [0xC0, 0xC0, 0x30, 0x30])
    }

    func testHistoryCoalescesAndUndoes() {
        var h = LabelHistory()
        var l = layout
        let t0 = Date(timeIntervalSince1970: 0)
        h.record(before: l, key: "drag", now: t0)
        l.name = "1"
        h.record(before: l, key: "drag", now: t0.addingTimeInterval(0.3))
        l.name = "2"
        XCTAssertEqual(h.past.count, 1)
        let back = h.undo(current: l)!
        XCTAssertEqual(back.name, "T")
        XCTAssertTrue(h.canRedo)
        XCTAssertEqual(h.redo(current: back)?.name, "2")
        h.record(before: l, key: nil, now: t0.addingTimeInterval(5))
        XCTAssertFalse(h.canRedo)
    }

    func testUnitsAndChips() {
        XCTAssertEqual(LabelUnits.dots(mm: 84, dpi: 203), 671)
        XCTAssertEqual(LabelUnits.dots(mm: 39, dpi: 203), 312)
        XCTAssertEqual(LabelUnits.mmText(dots: 671, dpi: 203), "84")
        XCTAssertEqual(LabelPlaceholders.tokens(key: "csv:metal_type", tags: 2), ["{metal_type_1}", "{metal_type_2}"])
        XCTAssertEqual(LabelPlaceholders.tokens(key: "sku", tags: 1), ["{sku}"])
        XCTAssertEqual(LabelPlaceholders.tokens(in: "a {sku|upper} b {date} {x"), ["{sku|upper}", "{date}"])
        // Every chip means something to Zpl with the sample values.
        let l = LabelLayout(id: "x", name: "x", widthDots: 10, heightDots: 10, tags: 2)
        let pieces = [LabelPlaceholders.sampleValues(piece: 1), LabelPlaceholders.sampleValues(piece: 2)]
        for c in LabelPlaceholders.pieceChips(tags: 2) + LabelPlaceholders.csvChips(tags: 2) {
            XCTAssertNotEqual(Zpl.resolveText(c.token, pieces: pieces), c.token, c.token)
        }
        _ = l
    }
}
