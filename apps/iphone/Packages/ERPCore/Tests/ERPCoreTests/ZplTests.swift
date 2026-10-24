import XCTest
@testable import ERPCore

/// src/lib/zebra-zpl.test.ts, case for case: the expected strings are the same ones. All values are made up.
final class ZplTests: XCTestCase {
    private let p1: LabelValues = [
        "sku": "TST-000001", "name": "Test Ring", "price": "Rs 12500", "priceNumber": "12500", "weight": "4.250 g", "weightNumber": "4.250",
        "csv:sku": "TST-000001", "csv:product_name": "Test Ring", "csv:metal_weight_g": "4.250", "csv:total_price_pkr": "12500",
    ]
    private let p2: LabelValues = [
        "sku": "TST-000002", "name": "Test Band", "price": "Rs 800", "priceNumber": "800", "weight": "1.5 g", "weightNumber": "1.500",
        "csv:sku": "TST-000002", "csv:product_name": "Test Band", "csv:metal_weight_g": "1.500", "csv:total_price_pkr": "800",
    ]
    /// 25 Oct 2026, 00:05:09 in Karachi (UTC+5), a Sunday.
    private let now = Date(timeIntervalSince1970: 1_792_868_709)
    private let head = "^XA^CI28^PW400^LL200^LS0\n"
    private let foot = "^PQ1,0,1,Y^XZ\n"

    private func layout(_ fields: [LabelLayoutField], tags: Int? = nil, printer: LabelPrinterSettings? = nil) -> LabelLayout {
        LabelLayout(id: "t", name: "T", widthDots: 400, heightDots: 200, tags: tags, printer: printer, fields: fields)
    }
    private func text(_ data: String, x: Int = 10, y: Int = 20, rotation: Int = 0, fontFamily: String? = nil, fontSize: Int? = nil, width: Int? = nil,
                      lines: Int? = nil, lineSpacing: Int? = nil, align: String? = nil, bold: Bool? = nil) -> LabelLayoutField {
        LabelLayoutField(id: "a", type: .text, x: x, y: y, rotation: rotation, data: data, fontFamily: fontFamily, fontSize: fontSize, width: width,
                         lines: lines, lineSpacing: lineSpacing, align: align, bold: bold)
    }
    private func one(_ f: LabelLayoutField, _ l: LabelLayout? = nil, pieces: [LabelValues]? = nil) -> String {
        var lay = l ?? layout([])
        lay.fields = [f]
        return Zpl.render(lay, pieces: pieces ?? [p1], now: now)
    }
    /// The whole label: the head, these lines, the foot.
    private func label(_ lines: String...) -> String { head + lines.map { $0 + "\n" }.joined() + foot }
    private func decoded<T: Decodable>(_ type: T.Type, _ json: String) -> T { try! JSONDecoder().decode(T.self, from: Data(json.utf8)) }

    // MARK: Placeholders

    func testFillsPieceFieldsAndCsvColumnsWithNForTheNthPieceOfTheLabel() {
        XCTAssertEqual(Zpl.resolveText("{sku} {name}", pieces: [p1]), "TST-000001 Test Ring")
        XCTAssertEqual(Zpl.resolveText("{SKU_1}|{SKU_2}|{PRODUCT_NAME_2}|{METAL_WEIGHT_G_1}|{TOTAL_PRICE_PKR}", pieces: [p1, p2]), "TST-000001|TST-000002|Test Band|4.250|12500")
        XCTAssertEqual(Zpl.resolveText("{sku_2} {csv_sku}", pieces: [p1, p2]), "TST-000002 {csv_sku}")
    }

    func testPrintsATagWithNoPieceBlankAndLeavesAKeyThatMeansNothingAsTyped() {
        XCTAssertEqual(Zpl.resolveText("[{SKU_2}][{name_2}][{TOTAL_PRICE_PKR_2}]", pieces: [p1]), "[][][]")
        XCTAssertEqual(Zpl.resolveText("[{sku}]", pieces: []), "[]")
        XCTAssertEqual(Zpl.resolveText("{skux} {SKU_0} {} {a b} {sku", pieces: [p1]), "{skux} {SKU_0} {} {a b} {sku")
        XCTAssertEqual(Zpl.resolveText("{{sku}} }{name}", pieces: [p1]), "{TST-000001} }Test Ring")
    }

    func testFormatsDateAndTimeInKarachiTime() {
        XCTAssertEqual(Zpl.resolveText("{date}", pieces: [], now: now), "25 Oct 2026")
        XCTAssertEqual(Zpl.resolveText("{date:dd/MM/yy} {date:EEEE d MMMM yyyy}", pieces: [], now: now), "25/10/26 Sunday 25 October 2026")
        XCTAssertEqual(Zpl.resolveText("{time} {time:h:mm a} {time:HH:mm:ss}", pieces: [], now: now), "00:05 12:05 AM 00:05:09")
        XCTAssertEqual(Zpl.formatDate("yyyy-MM-dd 'at' H 'o''clock' EEE", now), "2026-10-25 at 0 o'clock Sun")
        XCTAssertEqual(Zpl.formatDate("hh h m s a", Date(timeIntervalSince1970: 1_767_603_843)), "02 2 4 3 PM")
    }

    func testNumbersLabelsWithCounter() {
        XCTAssertEqual(Zpl.resolveText("{counter}", pieces: [], labelIndex: 0), "1")
        XCTAssertEqual(Zpl.resolveText("{counter}", pieces: [], labelIndex: 4), "5")
        XCTAssertEqual(Zpl.resolveText("{counter:100:5:6}", pieces: [], labelIndex: 3), "000115")
        XCTAssertEqual(Zpl.resolveText("{counter::2:3}", pieces: [], labelIndex: 2), "005")
        XCTAssertEqual(Zpl.resolveText("{counter:10:-3}", pieces: [], labelIndex: 5), "-5")
        XCTAssertEqual(Zpl.resolveText("{counter:1:1:4}", pieces: [], labelIndex: 2, now: now, counterStart: 50), "0052")
    }

    func testTransformsWithAPipe() {
        XCTAssertEqual(Zpl.resolveText("{price|prefix:Rs |suffix:/-}", pieces: [p1]), "Rs Rs 12500/-")
        XCTAssertEqual(Zpl.resolveText("{priceNumber|prefix:Rs |suffix:/-}", pieces: [p1]), "Rs 12500/-")
        XCTAssertEqual(Zpl.resolveText("{name|upper} {name|lower}", pieces: [p1]), "TEST RING test ring")
        XCTAssertEqual(Zpl.resolveText("{weight|fixed:2} {weightNumber|fixed:1} {weightNumber|fixed:0}", pieces: [p1]), "4.25 4.3 4")
        XCTAssertEqual(Zpl.resolveText("{priceNumber|group} {price|group} {csv_x|group}", pieces: [p1]), "12,500 Rs 12,500 {csv_x|group}")
        XCTAssertEqual(Zpl.resolveText("{name|max:4}|{name|max:0}|{name|max:99}", pieces: [p1]), "Test||Test Ring")
        XCTAssertEqual(Zpl.resolveText("{name|upper|max:3|suffix:.}", pieces: [p1]), "TES.")
        XCTAssertEqual(Zpl.resolveText("[{SKU_2|prefix:#}]", pieces: [p1]), "[]")
        XCTAssertEqual(Zpl.resolveText("{name|nothing}", pieces: [p1]), "Test Ring")
    }

    func testLeavesOtherTextAccentsAndBracesAlone() {
        XCTAssertEqual(Zpl.resolveText("Ring — 22k {sku}", pieces: [p1]), "Ring — 22k TST-000001")
        XCTAssertEqual(Zpl.resolveText("{price|group}", pieces: [["price": "1234567.50"]]), "1,234,567.50")
    }

    // MARK: Escaping

    func testSendsCaretTildeAndBackslashAsHexUnderFH() {
        XCTAssertEqual(Zpl.escape("a^b~c\\d", newline: "\\&"), "a\\5Eb\\7Ec\\5Cd")
        XCTAssertEqual(Zpl.escape("a\nb", newline: "\\&"), "a\\&b")
        XCTAssertEqual(Zpl.escape("a\nb", newline: "\\0A"), "a\\0Ab")
        XCTAssertEqual(one(text("50% ^off~ \\")), label(#"^FO10,20^A0N,20,20^FH\^FD50% \5Eoff\7E \5C^FS"#))
    }

    // MARK: Text

    func testDrawsTheStandardTag() {
        XCTAssertEqual(Zpl.render(LabelLayout.standard, pieces: [p1], now: now),
                       "^XA^CI28^PW664^LL296^LS0\n" + #"^FO100,150^A0R,20,20^FH\^FDSKU: TST-000001^FS"# + "\n" + #"^FO450,80^BQN,2,4,M^FH\^FDMA,TST-000001^FS"# + "\n^PQ1,0,1,Y^XZ\n")
    }

    func testPicksTheFontSizeOrientation() {
        XCTAssertEqual(one(text("Hi", rotation: 180, fontFamily: "D", fontSize: 30)), label(#"^FO10,20^ADI,30,30^FH\^FDHi^FS"#))
        XCTAssertEqual(one(text("Hi", rotation: 270)), label(#"^FO10,20^A0B,20,20^FH\^FDHi^FS"#))
    }

    func testWrapsInABlockWithAWidth() {
        XCTAssertEqual(one(text("a\nb", width: 120, align: "C")), label(#"^FO10,20^A0N,20,20^FB120,2,0,C^FH\^FDa\&b^FS"#))
        XCTAssertEqual(one(text("a", width: 120, lines: 3, lineSpacing: -4, align: "R")), label(#"^FO10,20^A0N,20,20^FB120,3,-4,R^FH\^FDa^FS"#))
    }

    func testGivesEachLineItsOwnFieldWithoutAWidthAndTurnsTheStackWithTheText() {
        func f(_ rotation: Int) -> String { one(text("a\nb\nc", x: 100, y: 100, rotation: rotation, fontSize: 20, lineSpacing: 2)) }
        XCTAssertEqual(f(0), label(#"^FO100,100^A0N,20,20^FH\^FDa^FS"#, #"^FO100,122^A0N,20,20^FH\^FDb^FS"#, #"^FO100,144^A0N,20,20^FH\^FDc^FS"#))
        XCTAssertEqual(f(90), label(#"^FO144,100^A0R,20,20^FH\^FDa^FS"#, #"^FO122,100^A0R,20,20^FH\^FDb^FS"#, #"^FO100,100^A0R,20,20^FH\^FDc^FS"#))
        XCTAssertEqual(f(180), label(#"^FO100,144^A0I,20,20^FH\^FDa^FS"#, #"^FO100,122^A0I,20,20^FH\^FDb^FS"#, #"^FO100,100^A0I,20,20^FH\^FDc^FS"#))
        XCTAssertEqual(f(270), label(#"^FO100,100^A0B,20,20^FH\^FDa^FS"#, #"^FO122,100^A0B,20,20^FH\^FDb^FS"#, #"^FO144,100^A0B,20,20^FH\^FDc^FS"#))
    }

    func testDrawsBoldTextTwiceADotApart() {
        XCTAssertEqual(one(text("B", bold: true)), label(#"^FO10,20^A0N,20,20^FH\^FDB^FS"#, #"^FO11,20^A0N,20,20^FH\^FDB^FS"#))
    }

    func testRoundsAndBoundsPositionsAndDefaultsTheSize() {
        // 10.5 reads as 11 (a half goes up), -3 as 0.
        let a = decoded(LabelLayoutField.self, #"{"id":"a","type":"text","x":10.5,"y":-3,"fontSize":0,"data":"x"}"#)
        XCTAssertEqual(one(a), label(#"^FO11,0^A0N,20,20^FH\^FDx^FS"#))
        let b = decoded(LabelLayoutField.self, #"{"id":"a","type":"text","x":99999,"y":0.4,"fontSize":12.6,"data":"x"}"#)
        XCTAssertEqual(one(b), label(#"^FO32000,0^A0N,13,13^FH\^FDx^FS"#))
    }

    func testFillsThePlaceholdersOfEachPieceIntoOneLabel() {
        XCTAssertEqual(Zpl.render(layout([text("{SKU_1}/{SKU_2}", width: 50)], tags: 2), pieces: [p1, p2], now: now),
                       label(#"^FO10,20^A0N,20,20^FB50,1,0,L^FH\^FDTST-000001/TST-000002^FS"#))
    }

    // MARK: Codes

    private func qr(data: String = "{sku}", rotation: Int = 0, mag: Int? = nil, ec: String? = nil) -> LabelLayoutField {
        LabelLayoutField(id: "q", type: .qr, x: 5, y: 6, rotation: rotation, data: data, qrMagnification: mag, errorCorrection: ec)
    }

    func testDrawsAQRCode() {
        XCTAssertEqual(one(qr()), label(#"^FO5,6^BQN,2,2,M^FH\^FDMA,TST-000001^FS"#))
        XCTAssertEqual(one(qr(rotation: 90, mag: 7, ec: "H")), label(#"^FO5,6^BQR,2,7,H^FH\^FDHA,TST-000001^FS"#))
        XCTAssertEqual(one(qr(mag: 40)), label(#"^FO5,6^BQN,2,10,M^FH\^FDMA,TST-000001^FS"#))
        XCTAssertEqual(one(qr(data: "a^b")), label(#"^FO5,6^BQN,2,2,M^FH\^FDMA,a\5Eb^FS"#))
    }

    func testDrawsNothingForACodeWithNoData() {
        XCTAssertEqual(one(qr(data: "{SKU_2}")), head + foot)
        XCTAssertEqual(one(LabelLayoutField(id: "b", type: .barcode, x: 1, y: 1, data: "")), head + foot)
    }

    func testDrawsEachBarcodeKind() {
        func bc(data: String = "{sku}", rotation: Int = 0, symbology: String? = nil, height: Int? = nil, moduleWidth: Int? = nil, showText: Bool? = nil) -> String {
            one(LabelLayoutField(id: "b", type: .barcode, x: 8, y: 9, rotation: rotation, data: data, symbology: symbology, height: height, moduleWidth: moduleWidth, showText: showText))
        }
        XCTAssertEqual(bc(), label(#"^FO8,9^BY2^BCN,40,N,N,N^FH\^FDTST-000001^FS"#))
        XCTAssertEqual(bc(rotation: 90, height: 60, moduleWidth: 3, showText: true), label(#"^FO8,9^BY3^BCR,60,Y,N,N^FH\^FDTST-000001^FS"#))
        XCTAssertEqual(bc(symbology: "code39"), label(#"^FO8,9^BY2^B3N,N,40,N,N^FH\^FDTST-000001^FS"#))
        XCTAssertEqual(bc(data: "5901234123457", symbology: "ean13", showText: true), label(#"^FO8,9^BY2^BEN,40,Y,N^FH\^FD5901234123457^FS"#))
        XCTAssertEqual(bc(data: "036000291452", symbology: "upca"), label(#"^FO8,9^BY2^BUN,40,N,N,Y^FH\^FD036000291452^FS"#))
        XCTAssertEqual(bc(symbology: "datamatrix", moduleWidth: 4), label(#"^FO8,9^BXN,4,200^FH\^FDTST-000001^FS"#))
        XCTAssertEqual(bc(symbology: "pdf417", height: 80, moduleWidth: 12), label(#"^FO8,9^BY10^B7N,80^FH\^FDTST-000001^FS"#))
    }

    // MARK: Shapes and pictures

    func testDrawsLinesBoxesAndEllipses() {
        func s(_ type: LabelFieldType = .box, width: Int = 100, height: Int = 30, thickness: Int? = nil, rounding: Int? = nil, fill: Bool? = nil) -> String {
            one(LabelLayoutField(id: "s", type: type, x: 4, y: 5, width: width, height: height, thickness: thickness, rounding: rounding, fill: fill))
        }
        XCTAssertEqual(s(.line, height: 3), label("^FO4,5^GB100,3,3,B,0^FS"))
        XCTAssertEqual(s(.line, width: 2, height: 80, rounding: 5), label("^FO4,5^GB2,80,2,B,0^FS"))
        XCTAssertEqual(s(), label("^FO4,5^GB100,30,2,B,0^FS"))
        XCTAssertEqual(s(thickness: 6, rounding: 4), label("^FO4,5^GB100,30,6,B,4^FS"))
        XCTAssertEqual(s(rounding: 99, fill: true), label("^FO4,5^GB100,30,30,B,8^FS"))
        XCTAssertEqual(s(.ellipse), label("^FO4,5^GE100,30,2,B^FS"))
        XCTAssertEqual(s(.ellipse, fill: true), label("^FO4,5^GE100,30,30,B^FS"))
    }

    func testPrintsAPictureAsGFAHexTurnedFor180AndStillFor90() {
        // 10 × 2 dots: 2 bytes a row. Row 1: 1010101010, row 2: 1100000011.
        func img(rotation: Int = 0, bitmap: String? = "qoDAwA==") -> String {
            one(LabelLayoutField(id: "i", type: .image, x: 3, y: 4, rotation: rotation, width: 10, height: 2, bitmap: bitmap))
        }
        XCTAssertEqual(img(), label("^FO3,4^GFA,4,4,2,AA80C0C0^FS"))
        // Half a turn: row 2 first, each row reversed over its 10 dots.
        XCTAssertEqual(img(rotation: 180), label("^FO3,4^GFA,4,4,2,C0C05540^FS"))
        XCTAssertEqual(img(rotation: 90), label("^FO3,4^GFA,4,4,2,AA80C0C0^FS"))
        XCTAssertEqual(img(bitmap: "!!"), head + foot)
        XCTAssertEqual(img(bitmap: nil), head + foot)
        // Too short a bitmap is padded with white.
        XCTAssertEqual(img(bitmap: "qg=="), label("^FO3,4^GFA,4,4,2,AA000000^FS"))
    }

    // MARK: The printer and the job

    func testSendsThePrinterOptionsOnceALabelInAFixedOrder() {
        let all = LabelPrinterSettings(thermal: "direct", mode: "peel", media: "mark", darkness: 7, speed: 4, labelTop: 30, labelShift: -12, tearOff: -5,
                                       orientation: "inverted", mirror: true, homeX: 8, homeY: 16)
        XCTAssertEqual(Zpl.render(layout([], printer: all), pieces: [p1], now: now),
                       "^XA^CI28^PW400^LL200^LH8,16^LT30^LS-12^MTD^MMP^MNM^PR4~SD07~TA-005^POI^PMY\n^PQ1,0,1,Y^XZ\n")
        let second = LabelPrinterSettings(thermal: "transfer", mode: "delayed-cut", media: "gap", tearOff: 12, orientation: "normal", mirror: false)
        XCTAssertEqual(Zpl.render(layout([], printer: second), pieces: [p1]), "^XA^CI28^PW400^LL200^LS0^MTT^MMD^MNY~TA+012^PON^PMN\n^PQ1,0,1,Y^XZ\n")
        let third = LabelPrinterSettings(mode: "cutter", media: "continuous", darkness: 99, speed: 99, labelTop: -500, tearOff: 0)
        XCTAssertEqual(Zpl.render(layout([], printer: third), pieces: [p1]), "^XA^CI28^PW400^LL200^LT-120^LS0^MMC^MNN^PR14~SD30~TA+000\n^PQ1,0,1,Y^XZ\n")
    }

    func testStillReadsTheDarknessAndSpeedOlderLayoutsKeptAtTheTop() {
        let a = decoded(LabelLayout.self, #"{"id":"t","name":"T","widthDots":400,"heightDots":200,"fields":[],"darkness":12,"speed":3}"#)
        XCTAssertEqual(Zpl.render(a, pieces: [p1]), "^XA^CI28^PW400^LL200^LS0^PR3~SD12\n^PQ1,0,1,Y^XZ\n")
        let b = decoded(LabelLayout.self, #"{"id":"t","name":"T","widthDots":400,"heightDots":200,"fields":[],"darkness":12,"speed":3,"printer":{"darkness":20}}"#)
        XCTAssertEqual(Zpl.render(b, pieces: [p1]), "^XA^CI28^PW400^LL200^LS0^PR3~SD20\n^PQ1,0,1,Y^XZ\n")
    }

    func testMakesOneLabelToTheTagsALayoutHoldsWithCopiesSkipAndACounter() {
        let l = layout([text("{SKU_1} {SKU_2} #{counter:7:1:3}", x: 1, y: 2)], tags: 2)
        let z = Zpl.render(l, pieces: [p1, p2, p1], copies: 3, skip: 1, now: now)
        XCTAssertEqual(z,
            "\(head)^PQ1,0,1,Y^XZ\n" +
            "\(head)" + #"^FO1,2^A0N,20,20^FH\^FDTST-000001 TST-000002 #007^FS"# + "\n^PQ3,0,1,Y^XZ\n" +
            "\(head)" + #"^FO1,2^A0N,20,20^FH\^FDTST-000001  #008^FS"# + "\n^PQ3,0,1,Y^XZ\n")
        XCTAssertTrue(Zpl.render(l, pieces: [p1, p2, p1], counterStart: 90, now: now).contains("#090^FS"))
        XCTAssertEqual(Zpl.render(l, pieces: [], skip: 0), "")
        XCTAssertTrue(Zpl.render(l, pieces: [p1], copies: 0).contains("^PQ1,0,1,Y"))
    }

    func testCountsLabels() {
        XCTAssertEqual(Zpl.labelCount([p1, p2, p1], layout([])), 3)
        XCTAssertEqual(Zpl.labelCount([p1, p2, p1], layout([], tags: 2)), 2)
        XCTAssertEqual(Zpl.labelCount(pieceCount: 4, layout([], tags: 2)), 2)
        XCTAssertEqual(Zpl.labelCount([], layout([], tags: 2)), 0)
    }

    func testSkipsHiddenFieldsOnPrintButKeepsThemForTheDesigner() {
        var hidden = text("B")
        hidden.id = "b"; hidden.hidden = true; hidden.locked = true; hidden.name = "Hidden"
        let l = layout([text("A"), hidden])
        XCTAssertEqual(Zpl.render(l, pieces: [p1]), label(#"^FO10,20^A0N,20,20^FH\^FDA^FS"#))
        XCTAssertEqual(Zpl.resolveFields(l, pieces: [p1]).map { "\($0.id) \($0.hidden)" }, ["a false", "b true"])
    }

    // MARK: resolveFields

    func testResolveFieldsWorksTheDataOutForOneLabelOfAJob() {
        let l = layout([
            text("{SKU_2} {counter::10:2}"), LabelLayoutField(id: "q", type: .qr, x: 0, y: 0, data: "{SKU_1}"),
            LabelLayoutField(id: "b", type: .barcode, x: 0, y: 0, data: "{date}"), LabelLayoutField(id: "x", type: .box, x: 0, y: 0, width: 5, height: 5),
        ], tags: 2)
        let r = Zpl.resolveFields(l, pieces: [p1, p2], labelIndex: 3, now: now)
        XCTAssertEqual(r.map(\.data), ["TST-000002 31", "TST-000001", "25 Oct 2026", nil])
        XCTAssertEqual(l.fields[0].data, "{SKU_2} {counter::10:2}")
    }
}
