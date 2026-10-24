import XCTest
@testable import ERPCore

/// The tag model (src/lib/label-layout.ts): lenient to read, the web's JSON to write, and the fields `saveLabelLayout`
/// (src/lib/writes/label-layout.ts) takes. All values are made up.
final class LabelLayoutTests: XCTestCase {
    private func decode(_ json: String) -> LabelLayout { try! JSONDecoder().decode(LabelLayout.self, from: Data(json.utf8)) }
    private func object(_ l: LabelLayout) -> NSDictionary { l.json as NSDictionary }
    private func parse(_ json: String) -> NSDictionary { try! JSONSerialization.jsonObject(with: Data(json.utf8)) as! NSDictionary }

    func testAnOlderLayoutLoadsAndSavesAsTheWebStoredIt() {
        let json = #"{"id":"o","name":"Old","widthDots":300,"heightDots":200,"fields":[{"id":"a","type":"text","x":1,"y":2,"data":"Hi {sku}","fontSize":20,"fontFamily":"0","rotation":90},{"id":"b","type":"qr","x":3,"y":4,"data":"{sku}","qrMagnification":3}]}"#
        let l = decode(json)
        XCTAssertEqual(l.fields.count, 2)
        XCTAssertEqual(l.fields[0], LabelLayoutField(id: "a", type: .text, x: 1, y: 2, rotation: 90, data: "Hi {sku}", fontFamily: "0", fontSize: 20))
        XCTAssertEqual(object(l), parse(json))
    }

    func testTheStandardTagIsTheWebsStandardTag() {
        XCTAssertEqual(object(.standard), parse(#"{"id":"zebra-2000t-jewellery","name":"Zebra 2000T Jewellery Tag (83x37mm)","widthDots":664,"heightDots":296,"fields":[{"id":"sku-left","type":"text","x":100,"y":150,"data":"SKU: {sku}","fontSize":20,"rotation":90},{"id":"qr-right","type":"qr","x":450,"y":80,"data":"{sku}","qrMagnification":4}]}"#))
    }

    func testReadsLeniently() {
        let l = decode(#"""
        {"id":7,"name":"Odd","widthDots":"400","heightDots":200.4,"dpi":"300","tags":"2","fields":{"1":{"id":"b","type":"qr","x":"5","y":6.5,"data":"{sku}","rotation":45},
         "0":{"id":"a","type":"text","x":-2.5,"y":"x","data":12,"hidden":"true","bold":1}},"printer":{"darkness":"12","mirror":"yes","thermal":5}}
        """#)
        XCTAssertEqual([l.id, l.name], ["7", "Odd"])
        XCTAssertEqual([l.widthDots, l.heightDots, l.dpi ?? 0, l.tags ?? 0], [400, 200, 300, 2])
        // A list keyed by index reads in index order; a rotation that is not a quarter turn is 0; a half goes up.
        XCTAssertEqual(l.fields.map(\.id), ["a", "b"])
        XCTAssertEqual([l.fields[0].x, l.fields[0].y, l.fields[1].x, l.fields[1].y, l.fields[1].rotation], [-2, 0, 5, 7, 0])
        XCTAssertEqual(l.fields[0].data, "12")
        XCTAssertTrue(l.fields[0].hidden)
        XCTAssertEqual(l.fields[0].bold, true)
        XCTAssertEqual(l.printer, LabelPrinterSettings(thermal: "5", darkness: 12, mirror: true))
    }

    func testDropsAFieldWithoutAnIdOrOfATypeItDoesNotKnow() {
        let l = decode(#"{"id":"t","name":"T","widthDots":10,"heightDots":10,"fields":[{"id":"","type":"text"},{"id":"a","type":"hologram"},{"id":"b","type":"box","width":4,"height":5},{"type":"qr"},5,null]}"#)
        XCTAssertEqual(l.fields.map(\.id), ["b"])
    }

    func testAMissingOrOddLayoutReadsAsEmptyNotAnError() {
        let l = decode("{}")
        XCTAssertEqual([l.id, l.name, "\(l.widthDots)", "\(l.heightDots)"], ["", "", "0", "0"])
        XCTAssertFalse(l.hasSize)
        XCTAssertTrue(l.fields.isEmpty)
        XCTAssertEqual(l.tagsPerLabel, 1)
        XCTAssertTrue(LabelLayout.standard.hasSize)
    }

    func testFoldsTheOlderTopLevelDarknessAndSpeedIntoPrinterAndWritesThemThere() {
        let l = decode(#"{"id":"t","name":"T","widthDots":10,"heightDots":10,"fields":[],"darkness":10,"speed":5,"printer":{"darkness":20}}"#)
        XCTAssertEqual(l.printer, LabelPrinterSettings(darkness: 20, speed: 5))
        XCTAssertEqual(object(l), parse(#"{"id":"t","name":"T","widthDots":10,"heightDots":10,"fields":[],"printer":{"darkness":20,"speed":5}}"#))
        XCTAssertNil(object(decode(#"{"id":"t","name":"T","widthDots":10,"heightDots":10,"fields":[],"printer":{}}"#))["printer"])
    }

    func testWritesEveryFieldTheDesignerAddsAndOnlyThose() {
        let l = LabelLayout(id: "n", name: "New", widthDots: 664, heightDots: 296, dpi: 300, tags: 2,
                            printer: LabelPrinterSettings(thermal: "transfer", mode: "tear", media: "gap", darkness: 15, speed: 6, labelTop: -3, labelShift: 4, tearOff: 7, orientation: "normal", mirror: false, homeX: 1, homeY: 2),
                            fields: [
                                LabelLayoutField(id: "t", type: .text, x: 1, y: 2, rotation: 270, data: "A\nB", hidden: true, locked: true, name: "Title", fontFamily: "D", fontSize: 30, width: 200, lines: 2, lineSpacing: -2, align: "C", bold: true),
                                LabelLayoutField(id: "q", type: .qr, x: 3, y: 4, data: "{sku}", qrMagnification: 5, errorCorrection: "H"),
                                LabelLayoutField(id: "b", type: .barcode, x: 5, y: 6, data: "{sku}", symbology: "ean13", height: 50, moduleWidth: 3, showText: true),
                                LabelLayoutField(id: "x", type: .box, x: 7, y: 8, width: 20, height: 10, thickness: 3, rounding: 4, fill: false),
                                LabelLayoutField(id: "i", type: .image, x: 9, y: 9, rotation: 180, width: 10, height: 2, bitmap: "qoDAwA==", dither: "atkinson", threshold: 0.4, source: "data:image/png;base64,AAAA"),
                            ])
        let expected = parse(#"""
        {"id":"n","name":"New","widthDots":664,"heightDots":296,"dpi":300,"tags":2,
         "printer":{"thermal":"transfer","mode":"tear","media":"gap","darkness":15,"speed":6,"labelTop":-3,"labelShift":4,"tearOff":7,"orientation":"normal","mirror":false,"homeX":1,"homeY":2},
         "fields":[
          {"id":"t","type":"text","x":1,"y":2,"rotation":270,"data":"A\nB","hidden":true,"locked":true,"name":"Title","fontFamily":"D","fontSize":30,"width":200,"lines":2,"lineSpacing":-2,"align":"C","bold":true},
          {"id":"q","type":"qr","x":3,"y":4,"data":"{sku}","qrMagnification":5,"errorCorrection":"H"},
          {"id":"b","type":"barcode","x":5,"y":6,"data":"{sku}","symbology":"ean13","height":50,"moduleWidth":3,"showText":true},
          {"id":"x","type":"box","x":7,"y":8,"width":20,"height":10,"thickness":3,"rounding":4,"fill":false},
          {"id":"i","type":"image","x":9,"y":9,"rotation":180,"width":10,"height":2,"bitmap":"qoDAwA==","dither":"atkinson","threshold":0.4,"source":"data:image/png;base64,AAAA"}]}
        """#)
        XCTAssertEqual(object(l), expected)
        // …and reads back as the same layout.
        let back = try! JSONDecoder().decode(LabelLayout.self, from: JSONEncoder().encode(l))
        XCTAssertEqual(back, l)
    }

    func testTheSaveTakesTheLayoutAndASequenceNumber() {
        let fields = LabelLayout.standard.saveFields(seq: "abc")
        XCTAssertEqual(LabelLayout.saveOp, "saveLabelLayout")
        XCTAssertEqual(Set(fields.keys), ["layout", "seq"])
        XCTAssertEqual(fields["seq"] as? String, "abc")
        XCTAssertEqual(fields["layout"] as? NSDictionary, object(.standard))
        XCTAssertNotEqual(LabelLayout.standard.saveFields()["seq"] as? String, LabelLayout.standard.saveFields()["seq"] as? String)
        XCTAssertTrue(JSONSerialization.isValidJSONObject(fields))
    }

    func testTheSettingsDocumentCarriesTheLayout() {
        let withLayout = ERPDecode.model(Settings.self, from: ["shopName": "Demo", "labelLayout": LabelLayout.standard.json] as [String: Any])!
        XCTAssertEqual(withLayout.labelLayout, .standard)
        XCTAssertNil(ERPDecode.model(Settings.self, from: ["shopName": "Demo"] as [String: Any])!.labelLayout)
        XCTAssertNil(ERPDecode.model(Settings.self, from: ["labelLayout": "junk"] as [String: Any])!.labelLayout)
    }

    func testTagsPerLabelIsHeldBetweenOneAndTwelve() {
        func n(_ tags: Int?) -> Int { LabelLayout(id: "t", name: "T", widthDots: 1, heightDots: 1, tags: tags).tagsPerLabel }
        XCTAssertEqual([n(nil), n(0), n(-3), n(1), n(2), n(12), n(40)], [1, 1, 1, 1, 2, 12, 12])
    }
}
