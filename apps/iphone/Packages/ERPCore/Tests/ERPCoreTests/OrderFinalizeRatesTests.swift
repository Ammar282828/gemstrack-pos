import XCTest
@testable import ERPCore

/// The rates typed at Finalize (src/lib/order-finalize.test.ts, "finalizeRates" and "finalizeRateRows").
final class OrderFinalizeRatesTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ fields: [String: Any]) -> T { ERPDecode.model(type, from: fields)! }

    private lazy var settings: Settings = decode(Settings.self, [
        "goldRatePerGram21k": 30000, "goldRatePerGram24k": 35000, "silverRatePerGram": 500,
        "goldRatePerGram22k": 0, "goldRatePerGram18k": 0, "palladiumRatePerGram": 9000, "platinumRatePerGram": 0,
    ])
    private lazy var order: Order = decode(Order.self, ["ratesApplied": ["goldRatePerGram21k": 20000, "goldRatePerGram24k": 24000]])

    private func item(_ metal: String, _ karat: String? = nil) -> OrderItem {
        var f: [String: Any] = ["description": "Piece", "metalType": metal, "estimatedWeightG": 5, "stoneWeightG": 0]
        if let karat { f["karat"] = karat }
        return decode(OrderItem.self, f)
    }

    func testNoneTypedIsTheBookedRatesExactly() {
        XCTAssertEqual(finalizeRates(order, settings), orderInvoiceRates(order, settings))
        XCTAssertEqual(finalizeRates(order, settings, typed: [:]).goldRatePerGram21k, 20000)
    }

    func testPositiveFiguresWinAndOthersAreIgnored() {
        let r = finalizeRates(order, settings, typed: [.goldRatePerGram21k: 22500, .goldRatePerGram24k: 0, .silverRatePerGram: -3])
        XCTAssertEqual(r.goldRatePerGram21k, 22500)
        XCTAssertEqual(r.goldRatePerGram24k, 24000)
        XCTAssertEqual(r.silverRatePerGram, 0)
    }

    func testAMetalTheOrderWasNotBookedWithCanBeAdded() {
        XCTAssertEqual(finalizeRates(order, settings, typed: [.silverRatePerGram: 450]).silverRatePerGram, 450)
    }

    func testRowsAreOnlyWhatIsInUseGoldFirstSilverLast() {
        let rows = finalizeRateRows([
            item("silver"), item("gold", "18k"), item("gold", "21k"), item("gold", "21k"), item("palladium", "12k"), item("platinum"),
        ])
        XCTAssertEqual(rows.map { $0.field }, [.goldRatePerGram21k, .goldRatePerGram18k, .palladiumRatePerGram12k, .platinumRatePerGram, .silverRatePerGram])
        XCTAssertEqual(rows.last?.label, "Silver (all-in)")
    }

    func testAPalladiumKaratWithNoRateOfItsOwnIsShownAtTheFlatOne() {
        let flat = PricingRates(palladiumRatePerGram: 9000)
        XCTAssertEqual(rateShown(flat, .palladiumRatePerGram18k), 9000)
        var own = flat
        own.palladiumRatePerGram18k = 12000
        XCTAssertEqual(rateShown(own, .palladiumRatePerGram18k), 12000)
    }
}
