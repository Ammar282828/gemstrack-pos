import XCTest
@testable import ERPCore

/// src/lib/tracking.ts (labels, tones), tcs-booking.ts's form and shipment-costs.ts `costBreakdown`. Made-up numbers only.
final class TcsShippingTests: XCTestCase {
    private func tracking(_ extra: [String: Any] = [:]) -> ParcelTracking {
        var o: [String: Any] = [
            "source": "tcs", "carrier": "TCS", "cn": "100000000001", "status": "Out for delivery", "state": "out_for_delivery",
            "events": [["at": "10 Nov 2026 09:00", "status": "Out for delivery", "location": "Karachi"],
                       ["at": "09 Nov 2026 18:00", "status": "Arrived"]],
            "url": "https://example.com/t", "checkedAt": "2026-11-10T04:00:00Z",
        ]
        for (k, v) in extra { o[k] = v }
        return ERPDecode.model(ParcelTracking.self, from: o)!
    }

    func testTrackingReadsEventsNewestFirstAsSent() {
        let t = tracking()
        XCTAssertEqual(t.events.count, 2)
        XCTAssertEqual(t.events[0].location, "Karachi")
        XCTAssertNil(t.events[1].location)
        XCTAssertEqual(t.cn, "100000000001")
    }

    func testAnOddAnswerDecodesToDefaults() {
        let t = ERPDecode.model(ParcelTracking.self, from: ["state": "booked"])!
        XCTAssertEqual(t.events.count, 0)
        XCTAssertEqual(TcsShipping.headline(t), "Booked with the courier")
    }

    func testHeadlineIsTheServersWordsElseTheStates() {
        XCTAssertEqual(TcsShipping.headline(tracking()), "Out for delivery")
        XCTAssertEqual(TcsShipping.headline(tracking(["status": " "])), "Out for delivery")
        XCTAssertEqual(TcsShipping.stateLabel("cancelled", carrier: "TCS"), "Booking cancelled")
        XCTAssertEqual(TcsShipping.stateLabel("unfulfilled", carrier: ""), "Not shipped yet")
        XCTAssertEqual(TcsShipping.stateLabel("shipped", carrier: "TCS"), "Shipped with TCS")
    }

    func testTonesFollowTheWeb() {
        XCTAssertEqual(TcsShipping.tone("delivered"), .settled)
        XCTAssertEqual(TcsShipping.tone("returned"), .late)
        XCTAssertEqual(TcsShipping.tone("cancelled"), .late)
        XCTAssertEqual(TcsShipping.tone("attempted"), .owed)
        XCTAssertEqual(TcsShipping.tone("unfulfilled"), .quiet)
        XCTAssertEqual(TcsShipping.tone("in_transit"), .working)
    }

    func testAParcelIsAskedAboutOnlyWhenTheOrderHasOne() {
        func has(_ cn: String? = nil, booking: String? = nil, cancelled: Bool = false, delivery: String? = nil, number: String? = nil) -> Bool {
            TcsShipping.hasParcel(consignmentNo: cn, bookingCN: booking, bookingCancelled: cancelled, shopifyDelivery: delivery, shopifyTrackingNumber: number)
        }
        XCTAssertTrue(has("1"))
        XCTAssertTrue(has(booking: "2"))
        XCTAssertFalse(has(booking: "2", cancelled: true))
        XCTAssertTrue(has(delivery: "in_transit"))
        XCTAssertTrue(has(delivery: "returned"))
        XCTAssertFalse(has(delivery: "unfulfilled"))
        XCTAssertTrue(has(number: "100000000001"))
        XCTAssertFalse(has(" "))
        XCTAssertFalse(has())
    }

    func testCancelIsOfferedForALiveBookingNotYetMoving() {
        XCTAssertTrue(TcsShipping.canCancelBooking(bookingCN: "1", bookingCancelled: false, state: nil))
        XCTAssertTrue(TcsShipping.canCancelBooking(bookingCN: "1", bookingCancelled: false, state: "booked"))
        XCTAssertFalse(TcsShipping.canCancelBooking(bookingCN: "1", bookingCancelled: false, state: "in_transit"))
        XCTAssertFalse(TcsShipping.canCancelBooking(bookingCN: "1", bookingCancelled: true, state: nil))
        XCTAssertFalse(TcsShipping.canCancelBooking(bookingCN: nil, bookingCancelled: false, state: nil))
    }

    func testBookingIsOfferedOnAnOpenOrderWithoutALiveNumber() {
        XCTAssertTrue(TcsShipping.canBook(isOpen: true, consignmentNo: nil, bookingCN: nil, bookingCancelled: false))
        XCTAssertTrue(TcsShipping.canBook(isOpen: true, consignmentNo: "", bookingCN: "9", bookingCancelled: true))
        XCTAssertFalse(TcsShipping.canBook(isOpen: true, consignmentNo: "1", bookingCN: nil, bookingCancelled: false))
        XCTAssertFalse(TcsShipping.canBook(isOpen: true, consignmentNo: nil, bookingCN: "9", bookingCancelled: false))
        XCTAssertFalse(TcsShipping.canBook(isOpen: false, consignmentNo: nil, bookingCN: nil, bookingCancelled: false))
    }

    private func form() -> TcsShipping.BookingForm {
        var f = TcsShipping.BookingForm()
        f.name = "Sara Test"; f.address = "House 1, Street 2"; f.mobile = "03001234567"; f.city = "Lahore"
        f.weightText = "0.5"; f.piecesText = "1"; f.codText = "12,500"
        return f
    }

    func testAFilledFormCanGo() {
        XCTAssertNil(TcsShipping.bookingProblem(form()))
        XCTAssertEqual(form().cod, 12_500)
    }

    func testEachMissingPartIsSaid() {
        var f = form(); f.name = " "
        XCTAssertEqual(TcsShipping.bookingProblem(f), "Add the receiver's name.")
        f = form(); f.address = ""
        XCTAssertEqual(TcsShipping.bookingProblem(f), "Add the delivery address.")
        f = form(); f.mobile = ""
        XCTAssertEqual(TcsShipping.bookingProblem(f), "Add the receiver's mobile number.")
        f = form(); f.city = ""
        XCTAssertEqual(TcsShipping.bookingProblem(f), "Pick the destination city.")
        f = form(); f.weightText = "0"
        XCTAssertNotNil(TcsShipping.bookingProblem(f))
        f = form(); f.weightText = "abc"
        XCTAssertNotNil(TcsShipping.bookingProblem(f))
        f = form(); f.piecesText = "0"
        XCTAssertNotNil(TcsShipping.bookingProblem(f))
        f = form(); f.codText = "-5"
        XCTAssertNotNil(TcsShipping.bookingProblem(f))
    }

    func testNothingToCollectIsZero() {
        var f = form(); f.codText = ""
        XCTAssertEqual(f.cod, 0)
        XCTAssertNil(TcsShipping.bookingProblem(f))
    }

    func testCitySearchIsCaseBlind() {
        let cities = ["Karachi", "Lahore", "Islamabad"]
        XCTAssertEqual(TcsShipping.filterCities(cities, query: "lah"), ["Lahore"])
        XCTAssertEqual(TcsShipping.filterCities(cities, query: " "), cities)
        XCTAssertEqual(TcsShipping.filterCities(cities, query: "zz"), [])
    }

    func testTheWriteCarriesWhatTheServerReads() {
        var f = form(); f.email = ""; f.remarks = " handle with care "
        let out = TcsShipping.bookFields(orderId: "ORD-000001", form: f)
        XCTAssertEqual(out["orderId"] as? String, "ORD-000001")
        XCTAssertEqual(out["destinationCity"] as? String, "Lahore")
        XCTAssertEqual(out["codAmount"] as? Double, 12_500)
        XCTAssertEqual(out["pieces"] as? Int, 1)
        XCTAssertEqual(out["fulfilShopify"] as? Bool, true)
        XCTAssertEqual(out["notifyCustomer"] as? Bool, true)
        XCTAssertEqual(out["remarks"] as? String, "handle with care")
        let c = out["consignee"] as? [String: Any]
        XCTAssertEqual(c?["name"] as? String, "Sara Test")
        XCTAssertNil(c?["email"])
    }

    private func cost(_ extra: [String: Any] = [:]) -> TcsShipping.ShippingCost {
        var o: [String: Any] = ["cn": "100000000001", "total": 320, "delivery": 250, "tax": 40, "fuel": 10, "codFee": 15,
                                "insurance": 0, "withholding": 5, "other": 5, "updatedAt": "2026-11-10T04:00:00Z"]
        for (k, v) in extra { o[k] = v }
        return ERPDecode.model(TcsShipping.ShippingCost.self, from: o)!
    }

    func testTheBreakdownFoldsTheSmallChargesIntoOther() {
        XCTAssertEqual(TcsShipping.costBreakdown(cost()), "delivery 250 \u{00B7} tax 40 \u{00B7} other 30")
        XCTAssertEqual(TcsShipping.costBreakdown(cost(["tax": 0.4, "fuel": 0, "codFee": 0, "other": 0])), "delivery 250")
    }

    func testWithholdingAndReceivedLinesAppearOnlyWhenThereIsOne() {
        XCTAssertEqual(TcsShipping.withholdingLine(cost()), "Withholding tax PKR 5 (taken from the payout)")
        XCTAssertNil(TcsShipping.withholdingLine(cost(["withholding": 0])))
        XCTAssertNil(TcsShipping.receivedLine(cost()))
        XCTAssertEqual(TcsShipping.receivedLine(cost(["netReceived": 4100])), "Received from TCS PKR 4,100")
    }

    func testTheCostShowsOnlyWithATotal() {
        XCTAssertTrue(TcsShipping.showsCost(cost()))
        XCTAssertFalse(TcsShipping.showsCost(cost(["total": 0])))
        XCTAssertFalse(TcsShipping.showsCost(nil))
    }
}
