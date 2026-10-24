import XCTest
@testable import ERPCore

/// src/lib/label-lsc.test.ts: a made-up design in Label LIVE's file shape (a 50 × 25 mm double tag at 203 dpi), the same
/// text as the TypeScript test, imported to the same fields and printed to the same ZPL.
final class LabelLSCTests: XCTestCase {
    private let png = "data:image/png;base64,\(LabelFixtures.png8x2)"

    /// The design as a JSON string. Each object is `[canvasRecord.objects[i], canvasRecord.fabricRep.objects[i]]`.
    private func design(labelConfig: String? = nil, variables: String? = nil) -> String {
        func el(_ type: String, _ config: String, hide: Bool = false) -> String { #"{"id":"x","type":"\#(type)","config":\#(config),"hideOnPrint":\#(hide)}"# }
        /// A fabric object: the defaults, then these keys (each value is JSON text), so no key is written twice.
        func fo(_ type: String, _ extra: KeyValuePairs<String, String>) -> String {
            var o: [(String, String)] = [("type", "\"\(type)\""), ("left", "0"), ("top", "0"), ("width", "10"), ("height", "10"), ("scaleX", "1"), ("scaleY", "1"),
                                         ("angle", "0"), ("originX", "\"left\""), ("originY", "\"top\"")]
            for (k, v) in extra {
                if let i = o.firstIndex(where: { $0.0 == k }) { o[i].1 = v } else { o.append((k, v)) }
            }
            return "{" + o.map { "\"\($0.0)\":\($0.1)" }.joined(separator: ",") + "}"
        }
        let objects: [(String, String)] = [
            (el("ELEMENT_TEXT", #"{"text":"{SKU_1}\n{PRODUCT_NAME_1}"}"#),
             fo("textbox", ["left": "-150", "top": "-60", "width": "100", "height": "60", "fontSize": "20", "lineHeight": "1", "textAlign": "\"center\""])),
            (el("ELEMENT_TEXT", #"{"text":"{SKU_2}"}"#),
             fo("textbox", ["left": "150", "top": "-80", "width": "60", "height": "30", "fontSize": "10", "lineHeight": "1.2", "angle": "90"])),
            (el("ELEMENT_BARCODE", #"{"bcid":"qrcode","scale":3,"opts":{"eclevel":"Q"},"rotate":"I","text":"{STALE}"}"#),
             fo("image", ["left": "-100", "top": "50", "width": "126", "height": "126", "scaleX": "0.5", "scaleY": "0.5", "originX": "\"center\"", "originY": "\"center\""])),
            (el("ELEMENT_BARCODE", #"{"bcid":"code128","scale":2,"rotate":"N","text":"{SKU_2}","opts":{"includetext":true}}"#),
             fo("image", ["left": "0", "top": "70", "width": "200", "height": "80", "originX": "\"center\"", "originY": "\"center\""])),
            (el("ELEMENT_IMAGE", #"{"kindId":"DITHER_KIND_THRESHOLD"}"#),
             fo("image", ["left": "100", "top": "60", "width": "8", "height": "2", "scaleX": "4", "scaleY": "4", "originX": "\"center\"", "originY": "\"center\"", "src": "\"\(png)\""])),
            (el("ELEMENT_IMAGE", #"{"kindId":"DITHER_KIND_ATKINSON"}"#),
             fo("image", ["left": "-120", "top": "60", "width": "8", "height": "2", "scaleX": "2", "scaleY": "2", "angle": "90", "originX": "\"center\"", "originY": "\"center\"", "src": "\"\(png)\""])),
            (el("ELEMENT_SHAPE_LINE", ##"{"stroke":"#000000","strokeWidth":3}"##),
             fo("line", ["left": "0", "top": "-90", "width": "100", "height": "0", "originX": "\"center\"", "originY": "\"center\"", "stroke": "\"#000000\""])),
            (el("ELEMENT_SHAPE_LINE", ##"{"stroke":"#FEFFFF","strokeWidth":3}"##),
             fo("line", ["left": "0", "top": "0", "width": "200", "height": "0", "originX": "\"center\"", "originY": "\"center\"", "stroke": "\"#FEFFFF\""])),
            (el("ELEMENT_SHAPE_LINE", ##"{"stroke":"#000000","strokeWidth":2}"##),
             fo("line", ["left": "180", "top": "0", "width": "0", "height": "60", "originX": "\"center\"", "originY": "\"center\"", "stroke": "\"#000000\""])),
            (el("ELEMENT_SHAPE_LINE", ##"{"stroke":"#000000","strokeWidth":2}"##),
             fo("line", ["left": "0", "top": "0", "width": "50", "height": "50", "stroke": "\"#000000\""])),
            (el("ELEMENT_SHAPE_RECT", ##"{"fill":null,"stroke":"#000000","strokeWidth":4}"##),
             fo("rect", ["left": "-190", "top": "-95", "width": "60", "height": "30", "rx": "15"])),
            (el("ELEMENT_SHAPE_RECT", ##"{"fill":"#000000","stroke":null,"strokeWidth":0}"##, hide: true),
             fo("rect", ["left": "-190", "top": "60", "width": "30", "height": "30"])),
            (el("ELEMENT_SHAPE_ELLIPSE", ##"{"fill":null,"stroke":"#000000","strokeWidth":2}"##),
             fo("ellipse", ["left": "100", "top": "70", "width": "40", "height": "20", "rx": "20", "ry": "10"])),
            (el("ELEMENT_SPARKLE", "{}"), fo("group", ["z": "0"])),
            (el("ELEMENT_IMAGE", "{}"), fo("image", ["src": "\"data:image/jpeg;base64,/9j/4AAQ\""])),
        ]
        return #"""
        {"version":"4.3.3","path":"/Users/someone/designs/private.lsc",
         "labelConfig":\#(labelConfig ?? #"{"widthMeasure":"50","heightMeasure":"25","dpi":203,"metric":true,"printerConfig":{"DARKNESS":"18","SPEED":"4","THERMAL_MODE":"THERMAL_MODE_DIRECT","MOCK_TARGET_PRINTER":"PRIVATE-PRINTER-NAME"}}"#),
         "canvasRecord":{"fill":"#FEFFFF","objects":[\#(objects.map(\.0).joined(separator: ","))],
          "fabricRep":{"version":"5.3.0","objects":[\#(objects.map(\.1).joined(separator: ","))]},
          "variables":\#(variables ?? #"[{"name":"SKU_1","value":"SECRET-SAMPLE"},{"name":"SKU_2","value":"SECRET-SAMPLE"},{"name":"PRODUCT_NAME_1","value":"SECRET-SAMPLE"}]"#)},
         "ui":{"windowName":"SECRET-WINDOW"},"dataImport":{"data":[{"SKU_1":"SECRET-SAMPLE"}]}}
        """#
    }

    private lazy var layout: LabelLayout = LabelLSC.importDesign(json: design())!
    private func field(_ n: Int) -> LabelLayoutField? { layout.fields.first { $0.id == "lsc-\(n)" } }

    func testTakesTheLabelSizeDpiTagsAndPrinterSettings() {
        XCTAssertEqual([layout.widthDots, layout.heightDots, layout.dpi ?? 0, layout.tags ?? 0], [400, 200, 203, 2])
        XCTAssertEqual(layout.printer, LabelPrinterSettings(thermal: "direct", darkness: 18, speed: 4))
        XCTAssertEqual([layout.id, layout.name], ["lsc-import", "Imported design"])
        let named = LabelLSC.importDesign(json: design(), id: "mine", name: "My tag")!
        XCTAssertEqual([named.id, named.name], ["mine", "My tag"])
    }

    func testReadsASizeInInches() {
        let inch = LabelLSC.importDesign(json: design(labelConfig: #"{"widthMeasure":"2","heightMeasure":"1","dpi":300,"metric":false}"#))!
        XCTAssertEqual([inch.widthDots, inch.heightDots, inch.dpi ?? 0], [600, 300, 300])
        XCTAssertNil(inch.printer)
    }

    func testTurnsATextBoxIntoATextFieldAtItsCornerSizeLinesAndSpacing() {
        XCTAssertEqual(field(1), LabelLayoutField(id: "lsc-1", type: .text, x: 50, y: 40, data: "{SKU_1}\n{PRODUCT_NAME_1}", name: "Text", fontSize: 20, width: 100, lines: 2, lineSpacing: 3, align: "C"))
    }

    func testPutsATurnedTextBoxAtTheCornerOfItsTurnedBox() {
        XCTAssertEqual(field(2), LabelLayoutField(id: "lsc-2", type: .text, x: 320, y: 20, rotation: 90, data: "{SKU_2}", name: "Text", fontSize: 10, width: 60, lines: 1, lineSpacing: 4))
    }

    func testTurnsAQRImageIntoAQRFieldAndGivesAStaleSampleTheNearestTagsSKU() {
        XCTAssertEqual(field(3), LabelLayoutField(id: "lsc-3", type: .qr, x: 69, y: 119, rotation: 180, data: "{SKU_1}", name: "QR code", qrMagnification: 3, errorCorrection: "Q"))
    }

    func testTurnsAnotherBarcodeIntoABarcodeFieldKeepingAVariableOfTheDesign() {
        XCTAssertEqual(field(4), LabelLayoutField(id: "lsc-4", type: .barcode, x: 100, y: 130, data: "{SKU_2}", name: "Barcode", symbology: "code128", height: 80, moduleWidth: 2, showText: true))
    }

    func testMakesAPictureABitmapAtTheSizeItIsDrawnKeepingItsSource() throws {
        let a = try XCTUnwrap(field(5))
        XCTAssertEqual(a.type, .image)
        XCTAssertEqual([a.x, a.y, a.width ?? 0, a.height ?? 0, a.rotation], [284, 156, 32, 8, 0])
        XCTAssertEqual(a.dither, "threshold")
        XCTAssertEqual(a.source, png)
        let z = Zpl.render(LabelLayout(id: "i", name: "i", widthDots: 400, heightDots: 200, fields: [a]), pieces: [[:]])
        let line = z.components(separatedBy: "\n")[1]
        XCTAssertEqual(line, "^FO284,156^GFA,32,32,4," + String(repeating: "F00F0FF0", count: 4) + String(repeating: "0FF00F0F", count: 4) + "^FS")
    }

    func testTurnsAQuarterTurnedPicturesBitsAndSetsItUpright() throws {
        let b = try XCTUnwrap(field(6))
        XCTAssertEqual([b.x, b.y, b.width ?? 0, b.height ?? 0, b.rotation], [78, 152, 4, 16, 0])
        XCTAssertEqual(b.dither, "atkinson")
        // 16 × 4 dithered (Atkinson), then a quarter turn clockwise.
        XCTAssertEqual(LabelBitmap.hex(bitmap: b.bitmap ?? "", width: 4, height: 16, rotate180: false)?.hex, "3030C0C0C0C010300000F0703030C0C0")
    }

    func testTurnsBlackLinesIntoBarsLeavesOutALineInTheLabelsOwnColourAndASlantedOne() {
        XCTAssertEqual(field(7), LabelLayoutField(id: "lsc-7", type: .line, x: 150, y: 9, name: "Line", width: 100, height: 3))
        XCTAssertNil(field(8))
        XCTAssertEqual(field(9), LabelLayoutField(id: "lsc-9", type: .line, x: 379, y: 70, name: "Line", width: 2, height: 60))
        XCTAssertNil(field(10))
    }

    func testTurnsRectanglesAndEllipsesIntoBoxesAndEllipsesAHiddenOneStaysHidden() {
        XCTAssertEqual(field(11), LabelLayoutField(id: "lsc-11", type: .box, x: 10, y: 5, name: "Box", width: 60, height: 30, thickness: 4, rounding: 8))
        XCTAssertEqual(field(12), LabelLayoutField(id: "lsc-12", type: .box, x: 10, y: 160, hidden: true, name: "Box", width: 30, height: 30, fill: true))
        XCTAssertEqual(field(13), LabelLayoutField(id: "lsc-13", type: .ellipse, x: 300, y: 170, name: "Ellipse", width: 40, height: 20, thickness: 2))
    }

    func testLeavesOutWhatItDoesNotKnowAndAPictureItCannotDecodeAndCanBeGivenADecoder() {
        XCTAssertEqual(layout.fields.map(\.id), ["lsc-1", "lsc-2", "lsc-3", "lsc-4", "lsc-5", "lsc-6", "lsc-7", "lsc-9", "lsc-11", "lsc-12", "lsc-13"])
        let withDecoder = LabelLSC.importDesign(json: design(), imageDecoder: { _ in DecodedImage(width: 1, height: 1, rgba: [0, 0, 0, 255]) })!
        let last = withDecoder.fields.last!
        XCTAssertEqual([withDecoder.fields.count, last.width ?? 0, last.height ?? 0], [12, 10, 10])
        XCTAssertEqual(last.type, .image)
    }

    func testNeverCarriesAValueAPathOrTheWindow() throws {
        let json = String(decoding: try JSONEncoder().encode(layout), as: UTF8.self)
        for secret in ["SECRET-SAMPLE", "SECRET-WINDOW", "PRIVATE-PRINTER-NAME", "/Users/someone", "private.lsc"] {
            XCTAssertFalse(json.contains(secret), secret)
        }
    }

    func testGivesALayoutThatPrints() {
        let z = Zpl.render(layout, pieces: [["csv:sku": "TST-000001", "csv:product_name": "Test Ring"], ["csv:sku": "TST-000002"]], now: Date(timeIntervalSince1970: 0))
        XCTAssertTrue(z.hasPrefix("^XA^CI28^PW400^LL200^LS0^MTD^PR4~SD18\n"))
        XCTAssertTrue(z.contains(#"^FO50,40^A0N,20,20^FB100,2,3,C^FH_^FDTST-000001\&Test Ring^FS"# + "\n"))
        XCTAssertTrue(z.contains(#"^FO320,20^A0R,10,10^FB60,1,4,L^FH_^FDTST-000002^FS"# + "\n"))
        XCTAssertFalse(z.contains("{"))
    }

    func testGivesNilForWhatIsNotADesign() {
        XCTAssertNil(LabelLSC.importDesign(json: "not json"))
        XCTAssertNil(LabelLSC.importDesign(json: "[]"))
        XCTAssertNil(LabelLSC.importDesign(json: #"{"labelConfig":{}}"#))
        XCTAssertNil(LabelLSC.importDesign(json: "null"))
    }

    func testKeepsOneTagWhenTheVariablesAreNotNumbered() {
        let plain = LabelLSC.importDesign(json: design(variables: #"[{"name":"SKU","value":""},{"name":"PRICE_2","value":""}]"#))!
        XCTAssertNil(plain.tags)
        // …and a stale QR sample then takes the plain {sku}.
        XCTAssertEqual(plain.fields.first { $0.id == "lsc-3" }?.data, "{sku}")
    }
}
