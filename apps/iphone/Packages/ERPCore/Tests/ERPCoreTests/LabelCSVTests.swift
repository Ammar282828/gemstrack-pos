import XCTest
@testable import ERPCore

/// src/lib/label-csv.test.ts. The TypeScript test holds `productCsv` to the browser's download (csv.ts) byte
/// for byte; csv.ts is a browser download with no Swift twin, so the files below were printed by the
/// TypeScript `productCsv` (vitest) for the same made-up pieces and rates, and are compared exactly.
/// All names, rates and amounts are invented.
final class LabelCSVTests: XCTestCase {
    private let settings: Settings = ERPDecode.model(Settings.self, from: [
        "shopName": "Demo, Jewellers", "goldRatePerGram24k": 30000, "goldRatePerGram22k": 27500, "goldRatePerGram21k": 26250,
        "goldRatePerGram18k": 22500, "palladiumRatePerGram": 12000, "platinumRatePerGram": 15000, "silverRatePerGram": 300,
    ] as [String: Any])!

    private func piece(_ fields: [String: Any]) -> Product { ERPDecode.model(Product.self, from: fields)! }

    private lazy var ring = piece([
        "sku": "RIN-000101", "name": "Demo \"Rose\" ring", "categoryId": "cat001", "imageUrl": "https://example.com/r.jpg", "metalType": "gold", "karat": "21k",
        "metalWeightG": 4.25, "hasStones": true, "stoneWeightG": 0.4, "stoneDetails": "Two small, pink", "hasDiamonds": false, "diamondCharges": 0,
        "makingCharges": 6000, "stoneCharges": 1500, "miscCharges": 0, "wastagePercentage": 10, "isCustomPrice": false,
    ])
    private lazy var pendant = piece([
        "sku": "LCK-000007", "name": "Demo pendant", "categoryId": "cat004", "metalType": "gold", "karat": "22k", "metalWeightG": 2,
        "secondaryMetalType": "platinum", "secondaryMetalWeightG": 0.5, "hasStones": false, "stoneWeightG": 0, "hasDiamonds": true, "diamondDetails": "VS",
        "diamondCharges": 20000, "makingCharges": 3000, "stoneCharges": 0, "miscCharges": 250, "wastagePercentage": 8, "isCustomPrice": true, "customPrice": 99000,
    ])
    private lazy var silver = piece([
        "sku": "SLV-000003", "name": "Silver band", "categoryId": "cat009", "metalType": "silver", "metalWeightG": 6.125, "hasStones": false, "stoneWeightG": 0,
        "makingCharges": 0, "diamondCharges": 0, "stoneCharges": 0, "miscCharges": 0, "wastagePercentage": 0, "isCustomPrice": false, "platingType": "Rhodium", "size": "7",
    ])

    // One tag's cells as the TypeScript wrote them (the 25 columns), and a right tag with no piece.
    private let header = #"sku_1,product_name_1,category_id_1,shop_name_1,image_url_1,total_price_pkr_1,is_custom_price_1,custom_price_1,metal_type_1,metal_weight_g_1,karat_1,secondary_metal_type_1,secondary_metal_weight_g_1,secondary_karat_1,has_stones_1,stone_weight_g_1,has_diamonds_1,stone_details_1,diamond_details_1,making_charges_1,diamond_charges_1,stone_charges_1,misc_charges_1,wastage_percentage_1,qr_content_1,sku_2,product_name_2,category_id_2,shop_name_2,image_url_2,total_price_pkr_2,is_custom_price_2,custom_price_2,metal_type_2,metal_weight_g_2,karat_2,secondary_metal_type_2,secondary_metal_weight_g_2,secondary_karat_2,has_stones_2,stone_weight_g_2,has_diamonds_2,stone_details_2,diamond_details_2,making_charges_2,diamond_charges_2,stone_charges_2,misc_charges_2,wastage_percentage_2,qr_content_2"#
    private let ringTag = #"RIN-000101,"Demo ""Rose"" ring",cat001,"Demo, Jewellers",https://example.com/r.jpg,118669,FALSE,0,gold,4.250,21k,,0,,TRUE,0.400,FALSE,"Two small, pink",,6000,0,1500,0,10.00,RIN-000101"#
    private let pendantTag = #"LCK-000007,Demo pendant,cat004,"Demo, Jewellers",,99000,TRUE,99000,gold,2.000,22k,platinum,0.500,,FALSE,0.000,TRUE,,VS,3000,20000,0,250,8.00,LCK-000007"#
    private let silverTag = #"SLV-000003,Silver band,cat009,"Demo, Jewellers",,1838,FALSE,0,silver,6.125,,,0,,FALSE,0.000,FALSE,,,0,0,0,0,0.00,SLV-000003"#
    private let emptyTag = String(repeating: ",", count: 24)

    // MARK: productCsv

    func testProductCsvIsTheTypeScriptFileForThesePieces() {
        XCTAssertEqual(LabelCSV.productCsv([ring], settings), [header, ringTag + "," + emptyTag].joined(separator: "\n"))
        XCTAssertEqual(LabelCSV.productCsv([ring, pendant], settings), [header, ringTag + "," + pendantTag].joined(separator: "\n"))
        XCTAssertEqual(
            LabelCSV.productCsv([pendant, ring, silver], settings),
            [header, pendantTag + "," + ringTag, silverTag + "," + emptyTag].joined(separator: "\n")
        )
    }

    func testPutsTwoTagsToARowTheRightOneEmptyForAnOddLastPiece() {
        let lines = LabelCSV.productCsv([ring], settings).split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        XCTAssertEqual(lines.count, 2)
        XCTAssertEqual(lines[0].split(separator: ",").count, 50)
        XCTAssertTrue(lines[0].hasPrefix("sku_1,product_name_1,"))
        XCTAssertTrue(lines[1].contains("\"Demo \"\"Rose\"\" ring\""))
        XCTAssertTrue(lines[1].contains("\"Demo, Jewellers\""))
        XCTAssertTrue(lines[1].hasSuffix(",RIN-000101" + String(repeating: ",", count: 25)))
    }

    func testNoPiecesIsTheHeaderAlone() {
        XCTAssertEqual(LabelCSV.productCsv([], settings), header)
    }

    func testNamesTheFileAsTheBrowserDoes() {
        XCTAssertEqual(LabelCSV.fileName(ERPDate.parse("2026-10-09T08:30:05.000Z")!), "gemstrack_double_tag_export_2026-10-09-08-30-05.csv")
        let now = LabelCSV.fileName()
        XCTAssertNotNil(now.range(of: #"^gemstrack_double_tag_export_\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.csv$"#, options: .regularExpression))
    }

    // MARK: labelCsvValues

    func testOneTagsValuesAreWhatTheCsvWrites() {
        let v = LabelCSV.values(ring, settings)
        XCTAssertEqual(v.count, LabelCSV.baseHeaders.count)
        XCTAssertEqual(v["total_price_pkr"], "118669")
        XCTAssertEqual(v["is_custom_price"], "FALSE")
        XCTAssertEqual(v["custom_price"], "0")
        XCTAssertEqual(v["has_stones"], "TRUE")
        XCTAssertEqual(v["metal_weight_g"], "4.250")
        XCTAssertEqual(v["stone_weight_g"], "0.400")
        XCTAssertEqual(v["secondary_metal_weight_g"], "0")
        XCTAssertEqual(v["wastage_percentage"], "10.00")
        XCTAssertEqual(v["product_name"], "Demo \"Rose\" ring")
        let p = LabelCSV.values(pendant, settings)
        XCTAssertEqual(p["total_price_pkr"], "99000")
        XCTAssertEqual(p["is_custom_price"], "TRUE")
        XCTAssertEqual(p["custom_price"], "99000")
        XCTAssertEqual(p["secondary_metal_type"], "platinum")
        XCTAssertEqual(p["secondary_metal_weight_g"], "0.500")
        XCTAssertEqual(p["has_diamonds"], "TRUE")
        XCTAssertEqual(p["misc_charges"], "250")
        let s = LabelCSV.values(silver, settings)
        XCTAssertEqual(s["total_price_pkr"], "1838")
        XCTAssertEqual(s["karat"], "")
        XCTAssertEqual(s["stone_weight_g"], "0.000")
    }

    func testNoPieceIsEveryColumnEmpty() {
        let v = LabelCSV.values(nil, settings)
        XCTAssertEqual(Set(v.keys), Set(LabelCSV.baseHeaders))
        XCTAssertTrue(v.values.allSatisfy(\.isEmpty))
    }

    // MARK: pieceForCsv

    func testTakesTheSKUFromTheDocumentIdAndReadsFiguresKeptAsText() {
        let p = LabelCSV.pieceForCsv("RIN-000102", ["name": "Old import", "categoryId": "cat001", "metalType": "gold", "metalWeightG": "3.5", "makingCharges": "1,000"])
        XCTAssertEqual(p.sku, "RIN-000102")
        XCTAssertEqual(p.metalWeightG, 3.5)
        // Not a number at all: 0, so the file is still made.
        XCTAssertEqual(p.makingCharges, 0)
        XCTAssertNil(p.customPrice)
        XCTAssertEqual(LabelCSV.productCsv([p], settings).split(separator: "\n").count, 2)
    }

    func testKeepsTheDocumentsOwnSKUAndOptionalFigures() {
        let p = LabelCSV.pieceForCsv("ID-1", ["sku": "RIN-7", "metalWeightG": 2, "customPrice": "", "secondaryMetalWeightG": "0.5"])
        XCTAssertEqual(p.sku, "RIN-7")
        XCTAssertNil(p.customPrice)
        XCTAssertEqual(p.secondaryMetalWeightG, 0.5)
        XCTAssertEqual(LabelCSV.pieceForCsv("ID-2", ["customPrice": 5000.4]).customPrice, 5000.4)
    }
}
