import XCTest
@testable import ERPCore

/// src/lib/rates.test.ts, case for case (the Swift file under test is Logic/RatesLogic.swift).
final class RatesTests: XCTestCase {
    private let current: RateValues = [.goldRatePerGram21k: 26_000, .goldRatePerGram18k: 22_000, .silverRatePerGram: 250]

    private func keep(isNew: Bool = true, typed: Set<RateInputKey> = [], inputs: [RateInputKey: String] = [:],
                      metals: Set<MetalType> = [.gold]) -> RateValues? {
        ratesToKeep(isNew: isNew, typed: typed, inputs: inputs, metals: metals, current: current)
    }

    // MARK: what a saved invoice writes back to the shop's rates

    func testAnEditedInvoiceWritesNothingItCarriesItsOwnOldRates() {
        XCTAssertNil(keep(isNew: false, typed: [.gold21k], inputs: [.gold21k: "24000"]))
    }

    func testANewInvoiceWritesOnlyTheBoxesTypedByHand() {
        XCTAssertEqual(
            keep(typed: [.gold21k], inputs: [.gold21k: "26250.00", .gold18k: "21000"]),
            [.goldRatePerGram21k: 26_250]
        )
    }

    func testNothingTypedWritesNothing() {
        XCTAssertNil(keep(inputs: [.gold21k: "24000"]))
    }

    func testSkipsAMetalTheSaleDoesNotCarryABlankOrZeroBoxAndAnUnchangedFigure() {
        XCTAssertNil(keep(typed: [.silver], inputs: [.silver: "260"]))
        XCTAssertNil(keep(typed: [.gold21k], inputs: [.gold21k: ""]))
        XCTAssertNil(keep(typed: [.gold21k], inputs: [.gold21k: "0"]))
        XCTAssertNil(keep(typed: [.gold21k], inputs: [.gold21k: "26000.00"]))
    }

    // Not in the TS tests: parseFloat reads the number a box starts with, and a rate with no
    // figure stored yet (nothing to differ from) counts as 0.
    func testABoxIsReadTheWayParseFloatReadsIt() {
        XCTAssertEqual(keep(typed: [.gold21k], inputs: [.gold21k: " 26300abc"]), [.goldRatePerGram21k: 26_300])
        XCTAssertNil(keep(typed: [.gold21k], inputs: [.gold21k: "abc"]))
        XCTAssertNil(keep(typed: [.gold21k], inputs: [.gold21k: "-5"]))
        XCTAssertEqual(keep(typed: [.gold22k], inputs: [.gold22k: "27000"]), [.goldRatePerGram22k: 27_000])
    }

    // MARK: the rate a house watches

    func testIs21KForGoldAndSilverForSilver() {
        XCTAssertEqual(mainRate(.gold), MainRate(key: .goldRatePerGram21k, label: "21K"))
        XCTAssertEqual(mainRate(.silver), MainRate(key: .silverRatePerGram, label: "Silver"))
    }

    func testAChangeCountsOnlyTheRatesThatMove() {
        XCTAssertEqual(changedRates([.goldRatePerGram21k: 26_000, .goldRatePerGram18k: 21_500], current), [.goldRatePerGram18k])
        XCTAssertEqual(changedRates([:], current), [])
        // Answered in RATE_KEYS' order, however the patch lists them.
        XCTAssertEqual(changedRates([.silverRatePerGram: 300, .goldRatePerGram24k: 1, .goldRatePerGram18k: 1], current),
                       [.goldRatePerGram24k, .goldRatePerGram18k, .silverRatePerGram])
    }

    func testTheRatesOfASaleAndOfTheSettingsAsKeyedValues() throws {
        let sale = ERPDecode.model(Rates.self, from: ["goldRatePerGram21k": 23_000, "silverRatePerGram": 250])!
        XCTAssertEqual(sale.values, [.goldRatePerGram21k: 23_000, .silverRatePerGram: 250])
        XCTAssertEqual(Rates().values, [:])
        let settings = ERPDecode.model(Settings.self, from: ["goldRatePerGram24k": 26_000])!
        XCTAssertEqual(settings.rates[.goldRatePerGram24k], 26_000)
        XCTAssertEqual(settings.rates[.silverRatePerGram], 0)
        XCTAssertEqual(RATE_KEYS.count, 9)
        XCTAssertEqual(RateKey.silverRatePerGram.metal, .silver)
        XCTAssertEqual(RateInputKey.palladium12k.rateKey, .palladiumRatePerGram12k)
    }

    // MARK: when the rate was set, in Karachi

    private let now = ERPDate.parse("2026-10-01T10:00:00Z")! // 15:00 in Karachi

    func testTodayIsKarachisTodayNotUTCs() {
        XCTAssertTrue(ratesSetToday("2026-09-30T19:30:00Z", now: now)) // 00:30 on the 1st in Karachi
        XCTAssertFalse(ratesSetToday("2026-09-30T18:30:00Z", now: now)) // 23:30 on the 30th
        XCTAssertFalse(ratesSetToday(nil, now: now))
        XCTAssertFalse(ratesSetToday("nonsense", now: now))
    }

    func testReadsAsATimeTodayAWeekdayThisWeekADateBefore() {
        XCTAssertEqual(whenSet("2026-10-01T04:40:00Z", now: now), "9:40") // 21K 26,250 · 9:40 by the owner
        XCTAssertEqual(whenSet("2026-09-29T04:40:00Z", now: now), "Tue 9:40")
        XCTAssertTrue(whenSet("2026-09-20T04:40:00Z", now: now).hasPrefix("20 Sep")) // the browser's ICU: Sep or Sept
        XCTAssertEqual(whenSet(nil, now: now), "not dated")
    }

    // Not in the TS tests: the 24-hour clock the browser prints, an unpadded hour, and the
    // edge of the week.
    func testTheClockIsTwentyFourHourWithAnUnpaddedHour() {
        XCTAssertEqual(whenSet("2026-09-30T19:30:00Z", now: now), "0:30")
        XCTAssertEqual(whenSet("2026-10-01T07:05:00Z", now: now), "12:05")
        XCTAssertEqual(whenSet("2026-10-01T05:59:00Z", now: now), "10:59")
        XCTAssertEqual(whenSet("2026-10-01T18:59:00Z", now: ERPDate.parse("2026-10-01T18:59:30Z")!), "23:59")
        XCTAssertEqual(whenSet("garbage", now: now), "not dated")
        // Within six days a weekday; the sixth day back is a date.
        XCTAssertEqual(whenSet("2026-09-26T04:40:00Z", now: now), "Sat 9:40")
        XCTAssertEqual(whenSet("2026-09-25T04:40:00Z", now: now), "25 Sept")
        XCTAssertEqual(whenSet("2026-06-05T04:40:00Z", now: now), "5 Jun")
    }
}
