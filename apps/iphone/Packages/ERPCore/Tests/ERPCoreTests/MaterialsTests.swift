import XCTest
@testable import ERPCore

/// src/lib/materials.ts has no TS test. The answers here were taken from running the TS (and its
/// own doc comments); the one place the Swift differs is the delivery day's format.
final class MaterialsTests: XCTestCase {
    private func orderItem(_ fields: [String: Any]) -> OrderItem { ERPDecode.model(OrderItem.self, from: fields)! }
    private func invoiceItem(_ fields: [String: Any]) -> InvoiceItem { ERPDecode.model(InvoiceItem.self, from: fields)! }
    private func delivery(_ fields: [String: Any]) -> DeliveryInfo { ERPDecode.model(DeliveryInfo.self, from: fields)! }

    func testWhichKaratsEachMetalIsSoldIn() {
        XCTAssertEqual(karatsFor("gold"), [.k18, .k21, .k22, .k24])
        XCTAssertEqual(karatsFor("palladium"), [.k12, .k18])
        XCTAssertEqual(karatsFor("platinum"), [])
        XCTAssertEqual(karatsFor("silver"), [])
        XCTAssertEqual(karatsFor("titanium"), [])
        XCTAssertEqual(karatsFor(nil), [])
        XCTAssertEqual(karatsFor(MetalType.gold), [.k18, .k21, .k22, .k24])
        XCTAssertEqual(KARATS_BY_METAL.keys.count, METAL_TYPES.count)
        XCTAssertEqual(KARAT_VALUES.map(\.rawValue), ["12k", "18k", "21k", "22k", "24k"])
    }

    func testOnlyGoldAndPalladiumCarryAKarat() {
        XCTAssertTrue(metalHasKarat("gold"))
        XCTAssertTrue(metalHasKarat("palladium"))
        XCTAssertFalse(metalHasKarat("platinum"))
        XCTAssertFalse(metalHasKarat("silver"))
        XCTAssertFalse(metalHasKarat(nil as String?))
        XCTAssertTrue(metalHasKarat(MetalType.palladium))
    }

    func testHowAMetalIsNamedToAHuman() {
        XCTAssertEqual(metalLabel("gold"), "Gold")
        XCTAssertEqual(metalLabel("palladium"), "Palladium")
        XCTAssertEqual(metalLabel("platinum"), "Platinum")
        XCTAssertEqual(metalLabel("silver"), "925 Sterling Silver")
        XCTAssertEqual(metalLabel("titanium"), "Titanium")
        XCTAssertEqual(metalLabel(""), "")
        XCTAssertEqual(metalLabel(nil as String?), "")
        XCTAssertEqual(metalLabel(MetalType.silver), "925 Sterling Silver")
    }

    func testKaratLabelsAreUpperCase() {
        XCTAssertEqual(karatLabel("21k"), "21K")
        XCTAssertEqual(karatLabel(""), "")
        XCTAssertEqual(karatLabel(nil as String?), "")
        XCTAssertEqual(karatLabel(KaratValue.k22), "22K")
    }

    func testDescribeMetalAsItsDocCommentSaysSilverIgnoringTheKarat() {
        XCTAssertEqual(describeMetal("gold", "21k"), "Gold (21K)")
        XCTAssertEqual(describeMetal("palladium", "18k"), "Palladium (18K)")
        XCTAssertEqual(describeMetal("silver", "21k"), "925 Sterling Silver")
        XCTAssertEqual(describeMetal("gold"), "Gold")
        XCTAssertEqual(describeMetal("gold", ""), "Gold")
        XCTAssertEqual(describeMetal("platinum", "24k"), "Platinum")
        XCTAssertEqual(describeMetal(nil as String?, "21k"), "")
        XCTAssertEqual(describeMetal(MetalType.gold, KaratValue.k21), "Gold (21K)")
        XCTAssertEqual(describeMetal(MetalType.silver, KaratValue.k21), "925 Sterling Silver")
    }

    func testTheFinishOnASilverPiece() {
        func plating(_ fields: [String: Any]) -> String? { describePlating(orderItem(fields)) }
        XCTAssertNil(plating(["metalType": "gold", "platingType": "White Rhodium"]))
        XCTAssertNil(plating(["metalType": "silver"]))
        XCTAssertEqual(plating(["metalType": "silver", "platingType": "White Rhodium", "nickelFree": true]), "White Rhodium · Nickel free")
        XCTAssertEqual(plating(["metalType": "silver", "platingType": "Other", "platingNote": "  matte black  "]), "matte black")
        // "Other" with no note says "Other".
        XCTAssertEqual(plating(["metalType": "silver", "platingType": "Other", "platingNote": "   "]), "Other")
        XCTAssertEqual(plating(["metalType": "silver", "platingType": "Other"]), "Other")
        XCTAssertEqual(plating(["metalType": "silver", "nickelFree": true]), "Nickel free")
        XCTAssertEqual(plating(["metalType": "silver", "platingType": "21K Gold Plating"]), "21K Gold Plating")
        // The three piece models read the same way.
        XCTAssertEqual(describePlating(invoiceItem(["metalType": "silver", "nickelFree": true])), "Nickel free")
        XCTAssertEqual(describePlating(ERPDecode.model(Product.self, from: ["sku": "A", "metalType": "silver", "platingType": "Black"])!), "Black")
    }

    func testWhatIsActuallySetIntoAPieceOnlyWhatWasRecorded() {
        func lines(_ fields: [String: Any]) -> [String] { describeSettings(orderItem(fields)) }
        XCTAssertEqual(
            lines(["metalType": "gold", "diamondDetails": " 1.12ct VVS2\n  round ", "stoneDetails": "4 rubies", "stoneWeightG": 0.456]),
            ["Diamonds: 1.12ct VVS2 · round", "Stones: 4 rubies", "Stone weight: 0.46g"]
        )
        XCTAssertEqual(lines(["metalType": "gold"]), [])
        XCTAssertEqual(
            lines(["metalType": "silver", "platingType": "White Rhodium", "nickelFree": true, "stoneWeightG": 1]),
            ["Stone weight: 1.00g", "Finish: White Rhodium · Nickel free"]
        )
        XCTAssertEqual(lines(["metalType": "gold", "stoneDetails": "a\r\n\r\n b", "stoneWeightG": 0.005]), ["Stones: a · b", "Stone weight: 0.01g"])
        // toFixed works on the double's exact value: 1.005 is a hair under, 0.125 and 12.345 round up.
        XCTAssertEqual(lines(["metalType": "gold", "stoneWeightG": 1.005]), ["Stone weight: 1.00g"])
        XCTAssertEqual(lines(["metalType": "gold", "stoneWeightG": 0.125]), ["Stone weight: 0.13g"])
        XCTAssertEqual(lines(["metalType": "gold", "stoneWeightG": 12.345]), ["Stone weight: 12.35g"])
        // A charge alone describes nothing.
        XCTAssertEqual(lines(["metalType": "gold", "diamondCharges": 45000, "stoneCharges": 1000]), [])
        XCTAssertEqual(describeSettings(invoiceItem(["metalType": "gold", "stoneDetails": "4 rubies"])), ["Stones: 4 rubies"])
    }

    func testTheDeliveryBlockIsEmptyUnlessTheSaleIsBeingDelivered() {
        XCTAssertEqual(describeDelivery(nil), [])
        XCTAssertEqual(describeDelivery(delivery(["required": false, "address": "x"])), [])
        XCTAssertEqual(describeDelivery(delivery(["required": true, "address": "  "])), [])
        XCTAssertEqual(describeDelivery(delivery(["required": true, "address": " 12 Example Road ", "city": " Karachi "])), ["12 Example Road, Karachi"])
        XCTAssertEqual(
            describeDelivery(delivery(["required": true, "address": "12 Example Road", "contactName": "Sana Example",
                                       "contactPhone": "0300 0000001", "notes": " Gate code 1234 "])),
            ["Sana Example · 0300 0000001", "12 Example Road", "Gate code 1234"]
        )
        XCTAssertEqual(
            describeDelivery(delivery(["required": true, "address": "12 Example Road", "contactPhone": "0300 0000001"])),
            ["0300 0000001", "12 Example Road"]
        )
    }

    func testTheExpectedDayIsPrintedAsKarachisDay() {
        XCTAssertEqual(
            describeDelivery(delivery(["required": true, "address": "12 Example Road", "expectedDate": "2026-10-05"])),
            ["12 Example Road", "Expected 5 Oct 2026"]
        )
        // 19:30 UTC is already the next day in Karachi.
        XCTAssertEqual(
            describeDelivery(delivery(["required": true, "address": "12 Example Road", "expectedDate": "2026-10-04T19:30:00.000Z"])),
            ["12 Example Road", "Expected 5 Oct 2026"]
        )
        // An unreadable day is left off, as the TS leaves off an invalid date.
        XCTAssertEqual(describeDelivery(delivery(["required": true, "address": "12 Example Road", "expectedDate": "soon"])), ["12 Example Road"])
    }
}
