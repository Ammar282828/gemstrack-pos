import Foundation

/// TCS from the order (src/lib/tracking.ts, tcs-booking.ts, shipment-costs.ts; owner, 2026-11-09): where the parcel is, the
/// booking form's checks, and what the courier cost. The server reads TCS and Shopify; these are the words and rules the apps share.

/// `GET /api/app/tracking`'s `tracking`: one shape whoever answered (TCS's own scans, else Shopify's fulfilment events).
public struct ParcelTracking: Decodable, Hashable {
    public struct Event: Decodable, Hashable {
        public let at: String
        public let status: String
        public let location: String?

        private enum K: String, CodingKey { case at, status, location }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            at = c.string(.at, default: "")
            status = c.string(.status, default: "")
            location = c.string(.location)
        }
    }

    /// "tcs" or "shopify".
    public let source: String
    public let carrier: String
    public let cn: String?
    /// The server's words ("Out for delivery", "With TCS").
    public let status: String
    /// booked, shipped, in_transit, out_for_delivery, attempted, delivered, returned, cancelled or unfulfilled.
    public let state: String
    /// Newest first, as the server sends them.
    public let events: [Event]
    public let url: String?
    public let deliveredAt: String?
    public let receivedBy: String?
    public let checkedAt: String?

    private enum K: String, CodingKey { case source, carrier, cn, status, state, events, url, deliveredAt, receivedBy, checkedAt }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        source = c.string(.source, default: "")
        carrier = c.string(.carrier, default: "")
        cn = c.string(.cn)
        status = c.string(.status, default: "")
        state = c.string(.state, default: "")
        events = c.list(.events)
        url = c.string(.url)
        deliveredAt = c.string(.deliveredAt)
        receivedBy = c.string(.receivedBy)
        checkedAt = c.string(.checkedAt)
    }
}

/// The colour a state is read in (lib/tracking.ts `trackingTone`); the app maps each to its `Tone`.
public enum ParcelTone: String {
    case settled, late, owed, working, quiet
}

public enum TcsShipping {
    // MARK: Tracking

    /// The headline the card shows: the server's words, else the state's own (lib/tracking.ts `trackingLabel`).
    public static func headline(_ t: ParcelTracking) -> String {
        let said = t.status.trimmingCharacters(in: .whitespacesAndNewlines)
        return said.isEmpty ? stateLabel(t.state, carrier: t.carrier) : said
    }

    public static func stateLabel(_ state: String, carrier: String) -> String {
        let who = carrier.isEmpty ? "the courier" : carrier
        switch state {
        case "booked": return "Booked with \(who)"
        case "cancelled": return "Booking cancelled"
        case "unfulfilled": return "Not shipped yet"
        case "shipped": return "Shipped with \(who)"
        case "in_transit": return "In transit"
        case "out_for_delivery": return "Out for delivery"
        case "attempted": return "Delivery attempted"
        case "delivered": return "Delivered"
        case "returned": return "Returned"
        default: return "Shipped"
        }
    }

    public static func tone(_ state: String) -> ParcelTone {
        switch state {
        case "delivered": return .settled
        case "returned", "cancelled": return .late
        case "attempted": return .owed
        case "unfulfilled": return .quiet
        default: return .working
        }
    }

    /// The order has a parcel to ask about, as the page's `hasParcel` reads it: a TCS number, a booking made here that is not
    /// cancelled, Shopify having shipped it out (or had it come back), or Shopify's own tracking number.
    public static func hasParcel(consignmentNo: String?, bookingCN: String?, bookingCancelled: Bool,
                                 shopifyDelivery: String?, shopifyTrackingNumber: String?) -> Bool {
        func has(_ s: String?) -> Bool { !(s ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        let shippedOut = ["shipped", "in_transit", "out_for_delivery", "attempted", "delivered", "returned"].contains(shopifyDelivery ?? "")
        return has(consignmentNo) || (has(bookingCN) && !bookingCancelled) || shippedOut || has(shopifyTrackingNumber)
    }

    /// Cancel booking, as the card offers it: a booking made here and live, while the parcel has not moved on (no tracking
    /// yet, or booked / shipped / unfulfilled).
    public static func canCancelBooking(bookingCN: String?, bookingCancelled: Bool, state: String?) -> Bool {
        guard !(bookingCN ?? "").isEmpty, !bookingCancelled else { return false }
        guard let state else { return true }
        return ["booked", "shipped", "unfulfilled"].contains(state)
    }

    /// Book with TCS is offered on an order that is open and has no live TCS number or booking of its own.
    public static func canBook(isOpen: Bool, consignmentNo: String?, bookingCN: String?, bookingCancelled: Bool) -> Bool {
        func has(_ s: String?) -> Bool { !(s ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        return isOpen && !has(consignmentNo) && !(has(bookingCN) && !bookingCancelled)
    }

    /// "Received by Sara" for a delivered parcel that says who; nil otherwise.
    public static func deliveredLine(_ t: ParcelTracking) -> String? {
        guard t.state == "delivered" else { return nil }
        let by = (t.receivedBy ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return by.isEmpty ? nil : "Received by \(by)"
    }

    // MARK: Booking

    /// What the booking sheet sends and the server checks (lib/tcs-booking.ts, ops-courier.ts).
    public struct BookingForm: Equatable {
        public var name = ""
        public var address = ""
        public var mobile = ""
        public var email = ""
        public var city = ""
        public var weightText = "0.5"
        public var piecesText = "1"
        public var codText = ""
        public var remarks = ""
        public var fulfilShopify = true

        public init() {}

        public var weight: Double? { Self.number(weightText) }
        public var pieces: Int? { Self.number(piecesText).map { Int($0.rounded()) } }
        /// Whole rupees; empty is nothing to collect.
        public var cod: Double? {
            let t = codText.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? 0 : Self.number(t).map { $0.rounded() }
        }

        static func number(_ raw: String) -> Double? {
            let t = raw.replacingOccurrences(of: ",", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !t.isEmpty, let d = Double(t), d.isFinite else { return nil }
            return d
        }
    }

    /// The first thing wrong with the form, in words, or nil when it can go. A free-text city is allowed (the server matches it
    /// to TCS's list and refuses an unknown one).
    public static func bookingProblem(_ f: BookingForm) -> String? {
        func blank(_ s: String) -> Bool { s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        if blank(f.name) { return "Add the receiver's name." }
        if blank(f.address) { return "Add the delivery address." }
        if blank(f.mobile) { return "Add the receiver's mobile number." }
        if blank(f.city) { return "Pick the destination city." }
        guard let w = f.weight, w > 0, w <= 1000 else { return "Weight is in kg, more than 0." }
        guard let p = f.pieces, p >= 1, p <= 999 else { return "Pieces is 1 or more." }
        guard let c = f.cod, c >= 0, c <= 50_000_000 else { return "Cash to collect is in rupees, 0 or more." }
        return nil
    }

    /// Cities matching what was typed, for the picker's search; everything when nothing is typed.
    public static func filterCities(_ cities: [String], query: String) -> [String] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return cities }
        return cities.filter { $0.lowercased().contains(q) }
    }

    /// The booking's fields as the write takes them (op `bookTcs`, ops-courier.ts). Call only when `bookingProblem` is nil.
    public static func bookFields(orderId: String, form f: BookingForm) -> [String: Any] {
        func t(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }
        var consignee: [String: Any] = ["name": t(f.name), "address": t(f.address), "mobile": t(f.mobile)]
        if !t(f.email).isEmpty { consignee["email"] = t(f.email) }
        var out: [String: Any] = [
            "orderId": orderId,
            "consignee": consignee,
            "destinationCity": t(f.city),
            "weight": f.weight ?? 0,
            "pieces": f.pieces ?? 1,
            "codAmount": f.cod ?? 0,
            "fulfilShopify": f.fulfilShopify,
            "notifyCustomer": true,
        ]
        if !t(f.remarks).isEmpty { out["remarks"] = t(f.remarks) }
        return out
    }

    // MARK: Courier cost (owners only)

    /// `Order.shippingCost`: what TCS charged for the parcel (lib/shipment-costs.ts `ShippingCost`), whole rupees on show.
    public struct ShippingCost: Decodable, Hashable {
        public let cn: String
        public let total: Double
        public let delivery: Double
        public let tax: Double
        public let fuel: Double
        public let codFee: Double
        public let insurance: Double
        public let withholding: Double
        public let other: Double
        public let netReceived: Double?
        public let updatedAt: String?

        private enum K: String, CodingKey {
            case cn, total, delivery, tax, fuel, codFee, insurance, withholding, other, netReceived, updatedAt
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            cn = c.string(.cn, default: "")
            total = c.double(.total, default: 0)
            delivery = c.double(.delivery, default: 0)
            tax = c.double(.tax, default: 0)
            fuel = c.double(.fuel, default: 0)
            codFee = c.double(.codFee, default: 0)
            insurance = c.double(.insurance, default: 0)
            withholding = c.double(.withholding, default: 0)
            other = c.double(.other, default: 0)
            netReceived = c.double(.netReceived)
            updatedAt = c.string(.updatedAt)
        }
    }

    /// The card shows only where there is a cost to show (the page's `!(cost.total > 0)`).
    public static func showsCost(_ c: ShippingCost?) -> Bool { (c?.total ?? 0) > 0 }

    /// "delivery 250 · tax 40 · other 30": delivery, tax, then fuel, COD fee, insurance and the rest as one "other"; a
    /// part under 1 rupee is left out (lib/shipment-costs.ts `costBreakdown`).
    public static func costBreakdown(_ c: ShippingCost) -> String {
        let other = c.fuel + c.codFee + c.insurance + c.other
        let parts: [(String, Double)] = [("delivery", c.delivery), ("tax", c.tax), ("other", other)]
        return parts.filter { $0.1.rounded() >= 1 }.map { "\($0.0) \(rupeeText($0.1))" }.joined(separator: " \u{00B7} ")
    }

    /// "Withholding tax PKR 12 (taken from the payout)" when there is one.
    public static func withholdingLine(_ c: ShippingCost) -> String? {
        c.withholding > 0 ? "Withholding tax \(pkr(c.withholding)) (taken from the payout)" : nil
    }

    /// "Received from TCS PKR 4,100" once TCS has paid out.
    public static func receivedLine(_ c: ShippingCost) -> String? {
        c.netReceived.map { "Received from TCS \(pkr($0))" }
    }
}
