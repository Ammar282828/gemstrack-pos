import XCTest
@testable import ERPCore

/// src/lib/label-live.test.ts, case for case (same inputs, same expected outputs), then the cases the TypeScript
/// does not test but the link depends on: the exact link strings below were printed by the TypeScript
/// (`printUrl`, `batchUrl`, `parseIntegrateUrl`) for the same made-up config and pieces, so the percent-encoding
/// and the JSON escaping are held to what `encodeURIComponent` and `JSON.stringify` give.
/// All names, SKUs and prices are invented.
final class LabelLiveTests: XCTestCase {
    // The shape Label LIVE's guide shows for its Integrate link.
    private let sample = "labellive://print?design=sample-address-label&variables=NAME:'Jane Doe',ADDRESS:'1 Main St',CITY:Springfield&printer=Preview&window=show&copies=2"

    private func json(_ s: String) -> Any { try! JSONSerialization.jsonObject(with: Data(s.utf8), options: [.fragmentsAllowed]) }
    private func object(_ s: String) -> [String: String] { json(s) as! [String: String] }
    private func objects(_ s: String) -> [[String: String]] { json(s) as! [[String: String]] }
    private func payloadJobs(_ url: String) -> [[String: String]] {
        let payload = LabelLive.decodeURIComponent(String(url.components(separatedBy: "payload=")[1]))!
        return objects(String(decoding: Data(base64Encoded: payload)!, as: UTF8.self))
    }
    private func variablesParam(_ url: String) -> String {
        let after = url.components(separatedBy: "variables=")[1]
        return LabelLive.decodeURIComponent(String(after.prefix { $0 != "&" }))!
    }

    // MARK: Reading the Integrate link

    func testTakesTheDesignPrinterCopiesAndEveryVariableName() {
        XCTAssertEqual(LabelLive.parseIntegrateURL(sample), LabelLiveIntegrate(design: "sample-address-label", printer: "Preview", copies: 2, variables: ["NAME", "ADDRESS", "CITY"]))
    }

    func testReadsAPercentEncodedBrowserLinkAndQuotesWithCommasInThem() {
        let url = "labellive://print?design=minalabel&variables=" + LabelLive.encodeURIComponent("SKU:'A,1',Price:'Rs 1',{W}:x")
        XCTAssertEqual(LabelLive.parseIntegrateURL(url)?.variables, ["SKU", "Price", "W"])
        let pairs = LabelLive.rjsonPairs(#"A:'it\'s',B:'x\&y'"#)
        XCTAssertEqual(pairs.map(\.key), ["A", "B"])
        XCTAssertEqual(pairs.map(\.value), ["it's", "x&y"])
    }

    func testRefusesAnythingThatIsNotAPrintLink() {
        XCTAssertNil(LabelLive.parseIntegrateURL("https://label.live"))
        XCTAssertNil(LabelLive.parseIntegrateURL("labellive://print?copies=1"))
    }

    // Not in the TypeScript test; the TypeScript's answers for these links.
    func testReadsTheLinkAsTheTypeScriptDoes() {
        // Upper-case scheme, "+" as a space, an escaped "&", a {…} wrapper, copies 2.5 rounds up, "%2B" is a plus.
        XCTAssertEqual(
            LabelLive.parseIntegrateURL(#"labellive://PRINT?design=my+label%20x&variables={A_1:'q\&r',B:"x,y"}&copies=2.5&printer=P%2B1"#),
            LabelLiveIntegrate(design: "my label x", printer: "P+1", copies: 3, variables: ["A_1", "B"])
        )
        // A broken escape leaves the value as written; copies that are not a number are 1.
        XCTAssertEqual(
            LabelLive.parseIntegrateURL("labellive://print?design=%E0%A4%A&copies=abc&variables=A:1"),
            LabelLiveIntegrate(design: "%E0%A4%A", printer: "", copies: 1, variables: ["A"])
        )
        XCTAssertEqual(
            LabelLive.parseIntegrateURL(#"labellive://print?design=d&variables=A:'x\&y=1',B:2&copies=0"#),
            LabelLiveIntegrate(design: "d", printer: "", copies: 1, variables: ["A", "B"])
        )
        XCTAssertEqual(LabelLive.parseIntegrateURL("labellive://print?design=d&copies=500")?.copies, 99)
        XCTAssertNil(LabelLive.parseIntegrateURL("labellive://print?design=a\nb"))
        XCTAssertNil(LabelLive.parseIntegrateURL(""))
    }

    // MARK: Pairing variables with fields

    func testGuessesByName() {
        let names = ["SKU", "Item Code", "QR", "Price", "PRICE_NUM", "Weight", "WT", "Karat", "Metal", "Name", "Shop", "StoneWt", "Diamonds", "Date", "xyz"]
        XCTAssertEqual(
            names.map(LabelLive.guessField),
            ["sku", "sku", "qr", "price", "priceNumber", "weight", "weight", "karat", "metal", "name", "shop", "stoneWeight", "diamonds", "date", ""]
        )
    }

    func testKeepsTheOwnersEarlierChoicesWhenTheLinkIsPastedAgain() {
        let prev = LabelLiveConfig(design: "old", printer: "", copies: 1, map: ["NAME": "sku"], hideWindow: false)
        let c = LabelLive.configFromIntegrate(LabelLive.parseIntegrateURL(sample)!, previous: prev)
        XCTAssertEqual(c.map, ["NAME": "sku", "ADDRESS": "", "CITY": ""])
        XCTAssertFalse(c.hideWindow)
    }

    // MARK: The print link

    private let config = LabelLiveConfig(design: "minalabel", printer: "zebra_1", copies: 1, map: ["SKU": "sku", "NAME": "name", "PRICE": "price", "NOTE": ""], hideWindow: true)
    private let piece: LabelValues = ["sku": "HM-102", "name": "Ayla's Ring & Band", "price": "Rs 12,500"]

    func testFillsEachPairedVariableAsTheJSONLabelLIVECarriesWithNoAmpersandToBreakTheLink() {
        XCTAssertEqual(LabelLive.variablesFor(config, piece), #"{"SKU":"HM-102","NAME":"Ayla's Ring and Band","PRICE":"Rs 12,500"}"#)
        var multiline = piece
        multiline["name"] = "a\nb"
        XCTAssertTrue(LabelLive.variablesFor(config, multiline).contains(#""NAME":"a b""#))
        let url = LabelLive.printURL(config, piece)
        XCTAssertTrue(url.hasPrefix("labellive://print?design=minalabel&variables="))
        XCTAssertTrue(url.contains("&printer=zebra_1&copies=1&window=hide&ignoreWarnings=true"))
        // Read back the way Label LIVE does: the variables survive the round trip.
        XCTAssertEqual(LabelLive.parseIntegrateURL(url)?.variables, ["SKU", "NAME", "PRICE"])
    }

    func testPutsSeveralPiecesInOneBatch() {
        let url = LabelLive.batchURL(config, [piece, ["sku": "HM-103", "name": "Bangle", "price": "Rs 9,000"]], copies: 2)
        let jobs = payloadJobs(url)
        XCTAssertEqual(jobs.count, 2)
        XCTAssertEqual(jobs[1]["design"], "minalabel")
        XCTAssertEqual(jobs[1]["printer"], "zebra_1")
        XCTAssertEqual(jobs[1]["copies"], "2")
        XCTAssertEqual(object(jobs[1]["variables"]!), ["SKU": "HM-103", "NAME": "Bangle", "PRICE": "Rs 9,000"])
    }

    func testChecksASavedConfig() {
        XCTAssertEqual(
            LabelLive.clean(["design": " minalabel ", "copies": 500, "map": ["SKU": "sku", "X": "nonsense"]] as [String: Any]),
            LabelLiveConfig(design: "minalabel", printer: "", copies: 99, map: ["SKU": "sku", "X": ""], hideWindow: true)
        )
        XCTAssertNil(LabelLive.clean(["design": ""] as [String: Any]))
        XCTAssertNil(LabelLive.clean(nil))
        XCTAssertNil(LabelLive.clean("minalabel"))
    }

    func testCheckingKeepsWhatIsRightAndDropsWhatIsOdd() {
        let long = String(repeating: "n", count: 61)
        let c = LabelLive.clean([
            "design": "d", "printer": " P ", "copies": "3", "hideWindow": false,
            "vars": [["name": "A", "field": "csv:sku"], ["name": "", "field": "sku"], ["name": long, "field": "sku"], ["name": "B", "field": 7], "junk"],
        ] as [String: Any])
        XCTAssertEqual(c, LabelLiveConfig(design: "d", printer: "P", copies: 3, map: ["A": "csv:sku", "B": ""], hideWindow: false))
        // Only a real false shows the window.
        XCTAssertEqual(LabelLive.clean(["design": "d", "hideWindow": "false"] as [String: Any])?.hideWindow, true)
    }

    // MARK: As the settings keep it

    func testStoresThePairingsAsAListAndReadsThemBack() {
        let c = LabelLiveConfig(design: "minalabel", printer: "", copies: 1, map: ["SKU": "sku", "NOTE": ""], hideWindow: true)
        let stored = LabelLive.toStored(c)
        XCTAssertEqual(stored.vars, [LabelLiveVar(name: "SKU", field: "sku"), LabelLiveVar(name: "NOTE", field: "")])
        XCTAssertEqual(LabelLive.clean(stored), c)
    }

    func testSettingsDecodeLabelLiveLeniently() throws {
        let doc: [String: Any] = ["shopName": "Demo", "labelLive": ["design": " minalabel ", "printer": "zebra_1", "copies": "2", "vars": ["0": ["name": "SKU_1", "field": "sku"], "1": ["name": "SKU_2", "field": "sku"]]]]
        let settings = try XCTUnwrap(ERPDecode.model(Settings.self, from: doc))
        XCTAssertEqual(settings.labelLiveConfig, LabelLiveConfig(design: "minalabel", printer: "zebra_1", copies: 2, map: ["SKU_1": "sku", "SKU_2": "sku"], hideWindow: true))
        // None saved, or an odd value: no config, never an error.
        XCTAssertNil(ERPDecode.model(Settings.self, from: ["shopName": "Demo"])?.labelLiveConfig)
        XCTAssertNil(ERPDecode.model(Settings.self, from: ["labelLive": "oops"])?.labelLiveConfig)
        XCTAssertEqual(ERPDecode.model(Settings.self, from: ["labelLive": ["design": "d", "hideWindow": false]])?.labelLiveConfig?.hideWindow, false)
    }

    // MARK: A design with two tags to a label (minalabel)

    // The shape of the owner's Integrate link, 2026-10-23: the double-tag CSV's columns, each _1 and _2, as JSON.
    private let twoTagLink = "labellive://print?design=minalabel&variables=" + LabelLive.encodeURIComponent(LabelLive.jsonObject([
        ("SKU_1", "TOP-000001"), ("SKU_2", "TOP-000002"), ("TOTAL_PRICE_PKR_1", "20650.00"), ("TOTAL_PRICE_PKR_2", "32900.00"),
        ("METAL_WEIGHT_G_1", "5.900"), ("METAL_WEIGHT_G_2", "9.400"), ("QR_CONTENT_1", "TOP-000001"), ("QR_CONTENT_2", "TOP-000002"),
    ])) + "&printer=System-Zebra_Technologies_ZTC_ZD220-203dpi_ZPL&window=show&copies=1"
    private var twoTag: LabelLiveConfig { LabelLive.configFromIntegrate(LabelLive.parseIntegrateURL(twoTagLink)!) }
    private let a: LabelValues = ["csv:sku": "RIN-000069", "csv:total_price_pkr": "4628", "csv:metal_weight_g": "1.780", "csv:qr_content": "RIN-000069"]
    private let b: LabelValues = ["csv:sku": "RIN-000070", "csv:total_price_pkr": "8398", "csv:metal_weight_g": "3.230", "csv:qr_content": "RIN-000070"]

    func testReadsTheJSONLinkAndPairsEachVariableWithItsCSVColumn() {
        let c = twoTag
        XCTAssertEqual(c.printer, "System-Zebra_Technologies_ZTC_ZD220-203dpi_ZPL")
        XCTAssertEqual(c.map["SKU_1"], "csv:sku")
        XCTAssertEqual(c.map["SKU_2"], "csv:sku")
        XCTAssertEqual(c.map["TOTAL_PRICE_PKR_2"], "csv:total_price_pkr")
        XCTAssertEqual(c.map["QR_CONTENT_1"], "csv:qr_content")
        XCTAssertEqual(LabelLive.tagsOf(c).count, 2)
    }

    func testFillsTheLeftTagFromOnePieceAndTheRightFromTheNext() {
        let v = object(LabelLive.variablesFor(twoTag, [a, b]))
        XCTAssertEqual(v["SKU_1"], "RIN-000069")
        XCTAssertEqual(v["SKU_2"], "RIN-000070")
        XCTAssertEqual(v["TOTAL_PRICE_PKR_2"], "8398")
        XCTAssertEqual(v["METAL_WEIGHT_G_1"], "1.780")
    }

    func testPrintsALonePieceWithTheRightTagBlankNeverTheSample() {
        let v = object(LabelLive.variablesFor(twoTag, [a]))
        XCTAssertEqual(v["SKU_1"], "RIN-000069")
        XCTAssertEqual([v["SKU_2"], v["TOTAL_PRICE_PKR_2"], v["QR_CONTENT_2"]], ["", "", ""])
    }

    func testMakesOneLabelOfTwoPiecesAndABatchOfTwoLabelsOfThree() {
        XCTAssertEqual(LabelLive.labelsOf(twoTag, [a, b, a]).map(\.count), [2, 1])
        let jobs = payloadJobs(LabelLive.batchURL(twoTag, [a, b, a]))
        XCTAssertEqual(jobs.count, 2)
        XCTAssertEqual(object(jobs[1]["variables"]!)["SKU_2"], "")
    }

    func testKeepsOneTagDesignsAsTheyWere() {
        XCTAssertEqual(LabelLive.tagsOf(LabelLiveConfig(design: "x", printer: "", copies: 1, map: ["SKU": "sku", "SIZE_2": "size"], hideWindow: true)).count, 1)
        // Three tags, and no more than twelve.
        XCTAssertEqual(LabelLive.tagsOf(LabelLiveConfig(design: "x", map: ["A_1": "", "A_3": ""])).count, 3)
        XCTAssertEqual(LabelLive.tagsOf(LabelLiveConfig(design: "x", map: ["A_1": "", "A_5": ""])).count, 5)
        XCTAssertEqual(LabelLive.tagsOf(LabelLiveConfig(design: "x", map: ["A_1": "", "A_99": ""])).count, 12)
        XCTAssertEqual(LabelLive.tagsOf(LabelLiveConfig(design: "x", map: ["A_1": "", "A_2": ""])).tagOf("PLAIN"), 0)
    }

    // MARK: Many labels in one print link

    private let manyConfig = LabelLiveConfig(design: "minalabel", printer: "", copies: 1, map: ["SKU_1": "sku", "SKU_2": "sku"], hideWindow: true)

    func testSendsAListOfLabelsAsTheVariablesNeverTheBatchLinkLabelLIVEMisreads() {
        let url = LabelLive.labelLiveURL(manyConfig, [["sku": "A"], ["sku": "B"], ["sku": "C"]])
        XCTAssertTrue(url.hasPrefix("labellive://print?design=minalabel&variables="))
        XCTAssertEqual(objects(variablesParam(url)), [["SKU_1": "A", "SKU_2": "B"], ["SKU_1": "C", "SKU_2": ""]])
    }

    func testKeepsOneLabelAsASingleObject() {
        XCTAssertEqual(object(variablesParam(LabelLive.labelLiveURL(manyConfig, [["sku": "A"]]))), ["SKU_1": "A", "SKU_2": ""])
    }

    // MARK: The links, character for character (printed by the TypeScript)

    private let exactConfig = LabelLiveConfig(
        design: "mina label é", printer: "Zebra ZD220 (USB)", copies: 3,
        map: ["SKU_1": "sku", "NAME_1": "name", "SKU_2": "sku", "NAME_2": "name", "NOTE": ""], hideWindow: false
    )
    private let exactA: LabelValues = ["sku": "A-1", "name": "Rose \"Ring\" & Co\\x\u{01} é ₨ 💎\u{2028}/\r\nz"]
    private let exactB: LabelValues = ["sku": "B/2", "name": "It's ~ fine! *(ok)*"]

    func testOnePieceIsTheTypeScriptsLink() {
        XCTAssertEqual(LabelLive.printURL(exactConfig, [exactA]), #"labellive://print?design=mina%20label%20%C3%A9&variables=%7B%22SKU_1%22%3A%22A-1%22%2C%22NAME_1%22%3A%22Rose%20%5C%22Ring%5C%22%20and%20Co%5C%5Cx%5Cu0001%20%C3%A9%20%E2%82%A8%20%F0%9F%92%8E%E2%80%A8%2F%20z%22%2C%22SKU_2%22%3A%22%22%2C%22NAME_2%22%3A%22%22%7D&printer=Zebra%20ZD220%20(USB)&copies=3&window=show&ignoreWarnings=true"#)
    }

    func testTwoPiecesFillBothTags() {
        XCTAssertEqual(LabelLive.printURL(exactConfig, [exactA, exactB]), #"labellive://print?design=mina%20label%20%C3%A9&variables=%7B%22SKU_1%22%3A%22A-1%22%2C%22NAME_1%22%3A%22Rose%20%5C%22Ring%5C%22%20and%20Co%5C%5Cx%5Cu0001%20%C3%A9%20%E2%82%A8%20%F0%9F%92%8E%E2%80%A8%2F%20z%22%2C%22SKU_2%22%3A%22B%2F2%22%2C%22NAME_2%22%3A%22It's%20~%20fine!%20*(ok)*%22%7D&printer=Zebra%20ZD220%20(USB)&copies=3&window=show&ignoreWarnings=true"#)
    }

    func testThreePiecesAreAListAndCopiesAreCappedAt99() {
        XCTAssertEqual(LabelLive.printURL(exactConfig, [exactA, exactB, exactA], copies: 120), #"labellive://print?design=mina%20label%20%C3%A9&variables=%5B%7B%22SKU_1%22%3A%22A-1%22%2C%22NAME_1%22%3A%22Rose%20%5C%22Ring%5C%22%20and%20Co%5C%5Cx%5Cu0001%20%C3%A9%20%E2%82%A8%20%F0%9F%92%8E%E2%80%A8%2F%20z%22%2C%22SKU_2%22%3A%22B%2F2%22%2C%22NAME_2%22%3A%22It's%20~%20fine!%20*(ok)*%22%7D%2C%7B%22SKU_1%22%3A%22A-1%22%2C%22NAME_1%22%3A%22Rose%20%5C%22Ring%5C%22%20and%20Co%5C%5Cx%5Cu0001%20%C3%A9%20%E2%82%A8%20%F0%9F%92%8E%E2%80%A8%2F%20z%22%2C%22SKU_2%22%3A%22%22%2C%22NAME_2%22%3A%22%22%7D%5D&printer=Zebra%20ZD220%20(USB)&copies=99&window=show&ignoreWarnings=true"#)
    }

    func testNoPiecesSendsEveryTagBlank() {
        XCTAssertEqual(LabelLive.printURL(exactConfig, []), #"labellive://print?design=mina%20label%20%C3%A9&variables=%7B%22SKU_1%22%3A%22%22%2C%22NAME_1%22%3A%22%22%2C%22SKU_2%22%3A%22%22%2C%22NAME_2%22%3A%22%22%2C%22NOTE%22%3A%22%22%7D&printer=Zebra%20ZD220%20(USB)&copies=3&window=show&ignoreWarnings=true"#)
    }

    func testTheBatchLinkIsTheTypeScriptsToTheLastCharacter() {
        // copies 0 is 1.
        XCTAssertEqual(LabelLive.batchURL(exactConfig, [exactA, exactB, exactA], copies: 0), #"labellive://batch?payload=W3siZGVzaWduIjoibWluYSBsYWJlbCDDqSIsInZhcmlhYmxlcyI6IntcIlNLVV8xXCI6XCJBLTFcIixcIk5BTUVfMVwiOlwiUm9zZSBcXFwiUmluZ1xcXCIgYW5kIENvXFxcXHhcXHUwMDAxIMOpIOKCqCDwn5KO4oCoLyB6XCIsXCJTS1VfMlwiOlwiQi8yXCIsXCJOQU1FXzJcIjpcIkl0J3MgfiBmaW5lISAqKG9rKSpcIn0iLCJwcmludGVyIjoiWmVicmEgWkQyMjAgKFVTQikiLCJjb3BpZXMiOiIxIiwid2luZG93Ijoic2hvdyIsImlnbm9yZVdhcm5pbmdzIjoidHJ1ZSJ9LHsiZGVzaWduIjoibWluYSBsYWJlbCDDqSIsInZhcmlhYmxlcyI6IntcIlNLVV8xXCI6XCJBLTFcIixcIk5BTUVfMVwiOlwiUm9zZSBcXFwiUmluZ1xcXCIgYW5kIENvXFxcXHhcXHUwMDAxIMOpIOKCqCDwn5KO4oCoLyB6XCIsXCJTS1VfMlwiOlwiXCIsXCJOQU1FXzJcIjpcIlwifSIsInByaW50ZXIiOiJaZWJyYSBaRDIyMCAoVVNCKSIsImNvcGllcyI6IjEiLCJ3aW5kb3ciOiJzaG93IiwiaWdub3JlV2FybmluZ3MiOiJ0cnVlIn1d"#)
    }

    func testEncodeAndDecodeURIComponentAsJavaScriptDoes() {
        XCTAssertEqual(LabelLive.encodeURIComponent("a b&c=d/e?f#g+h é💎'()*!~-_."), "a%20b%26c%3Dd%2Fe%3Ff%23g%2Bh%20%C3%A9%F0%9F%92%8E'()*!~-_.")
        XCTAssertEqual(LabelLive.decodeURIComponent("a%20b%26c%2Bd%C3%A9+"), "a b&c+dé+")
        XCTAssertNil(LabelLive.decodeURIComponent("%E0%A4%A"))
        XCTAssertNil(LabelLive.decodeURIComponent("100%"))
        XCTAssertNil(LabelLive.decodeURIComponent("%FF"))
    }

    func testTheJSONEscapesAreJSONStringifys() {
        XCTAssertEqual(LabelLive.jsonString("a\"b\\c\n\r\t\u{08}\u{0C}\u{01}\u{1F}/é\u{2028}"), "\"a\\\"b\\\\c\\n\\r\\t\\b\\f\\u0001\\u001f/é\u{2028}\"")
    }

    func testTheFieldListHasTheLabelsAndEveryCSVColumn() {
        XCTAssertEqual(LabelLive.labelFields.count, 17)
        XCTAssertEqual(LabelLive.labelFields[2], LabelField(key: "price", label: "Price (Rs 12,500)"))
        XCTAssertEqual(LabelLive.csvFields.count, 25)
        XCTAssertEqual(LabelLive.csvFields[5], LabelField(key: "csv:total_price_pkr", label: "Tag CSV: total_price_pkr"))
        XCTAssertEqual(LabelLive.fieldKeys.count, 42)
        XCTAssertEqual(LabelLive.guessField("TOTAL_PRICE_PKR_1"), "csv:total_price_pkr")
        XCTAssertEqual(LabelLive.guessField("STONE_WEIGHT_G_2"), "csv:stone_weight_g")
        XCTAssertEqual(LabelLive.guessField("Price_1"), "price")
    }

    // MARK: A piece's values (label-live-values.ts)

    private let settings: Settings = ERPDecode.model(Settings.self, from: [
        "shopName": "Demo, Jewellers", "goldRatePerGram24k": 30000, "goldRatePerGram22k": 27500, "goldRatePerGram21k": 26250,
        "goldRatePerGram18k": 22500, "palladiumRatePerGram": 12000, "platinumRatePerGram": 15000, "silverRatePerGram": 300,
    ] as [String: Any])!

    func testAPiecesValuesAreWhatTheTypeScriptWorksOut() throws {
        // 2026-09-09 20:30 UTC is the 10th in Karachi, and en-GB writes September as "Sept".
        let day = try XCTUnwrap(ERPDate.parse("2026-09-09T20:30:00Z"))
        let ring = try XCTUnwrap(ERPDecode.model(Product.self, from: [
            "sku": "RIN-000101", "name": "Demo \"Rose\" ring", "categoryId": "cat001", "imageUrl": "https://example.com/r.jpg", "metalType": "gold", "karat": "21k",
            "metalWeightG": 4.25, "hasStones": true, "stoneWeightG": 0.4, "stoneDetails": "Two small, pink", "hasDiamonds": false, "diamondCharges": 0,
            "makingCharges": 6000, "stoneCharges": 1500, "miscCharges": 0, "wastagePercentage": 10, "isCustomPrice": false,
        ] as [String: Any]))
        let v = LabelLive.valuesFor(ring, settings, today: day)
        XCTAssertEqual(v["price"], "Rs 118,669")
        XCTAssertEqual(v["priceNumber"], "118669")
        XCTAssertEqual(v["weight"], "4.250 g")
        XCTAssertEqual(v["weightNumber"], "4.250")
        XCTAssertEqual(v["metal"], "Gold 21k")
        XCTAssertEqual(v["karat"], "21k")
        XCTAssertEqual(v["category"], "Rings")
        XCTAssertEqual(v["stones"], "Two small, pink")
        XCTAssertEqual(v["stoneWeight"], "0.400")
        XCTAssertEqual(v["diamonds"], "")
        XCTAssertEqual(v["shop"], "Demo, Jewellers")
        XCTAssertEqual(v["qr"], "RIN-000101")
        XCTAssertEqual(v["date"], "10 Sept 2026")
        XCTAssertEqual(v["csv:total_price_pkr"], "118669")
        XCTAssertEqual(v["csv:wastage_percentage"], "10.00")
        XCTAssertEqual(v.count, 17 + 25)

        let silver = try XCTUnwrap(ERPDecode.model(Product.self, from: [
            "sku": "SLV-000003", "name": "Silver band", "categoryId": "cat009", "metalType": "silver", "metalWeightG": 6.125, "hasStones": false, "stoneWeightG": 0,
            "isCustomPrice": false, "platingType": "Rhodium", "size": "7",
        ] as [String: Any]))
        let s = LabelLive.valuesFor(silver, settings, today: day)
        XCTAssertEqual(s["price"], "Rs 1,838")
        XCTAssertEqual(s["metal"], "Silver")
        XCTAssertEqual(s["karat"], "")
        XCTAssertEqual(s["category"], "Bands")
        XCTAssertEqual(s["stoneWeight"], "")
        XCTAssertEqual(s["plating"], "Rhodium")
        XCTAssertEqual(s["size"], "7")

        let pendant = try XCTUnwrap(ERPDecode.model(Product.self, from: [
            "sku": "LCK-000007", "name": "Demo pendant", "categoryId": "cat004", "metalType": "gold", "karat": "22k", "metalWeightG": 2, "hasDiamonds": true,
            "diamondDetails": "VS", "diamondCharges": 20000, "makingCharges": 3000, "isCustomPrice": true, "customPrice": 99000,
        ] as [String: Any]))
        let p = LabelLive.valuesFor(pendant, settings, today: day)
        XCTAssertEqual(p["price"], "Rs 99,000")
        XCTAssertEqual(p["category"], "Lockets")
        XCTAssertEqual(p["diamonds"], "VS")
    }
}
