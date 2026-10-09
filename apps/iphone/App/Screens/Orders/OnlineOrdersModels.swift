import Foundation
import ERPCore

// The online orders' answers, read as leniently as the web reads them (src/lib/website/types.ts
// `OnlineOrderRow`, src/lib/website/online-preview.ts `MovePreview`): a missing or odd field gives a
// default, never an error that would empty the inbox (CONVENTIONS.md rule 2).

/// One order from the website before it is an order (`online_orders/<ONL-…>`, /api/website/online): waiting
/// to be confirmed, or confirmed or declined in the last fortnight.
struct OnlineOrderRow: Decodable, Identifiable, Hashable {
    let id: String
    /// to_confirm, confirming (someone pressed Confirm a moment ago), confirmed, declined.
    let state: String
    let placedAt: String
    let customer: OnlineCustomer
    let delivery: OnlineDelivery
    let lines: [OnlineOrderLine]
    let subtotal: Double
    let deliveryCharge: Double
    /// What the customer pays: the pieces and the delivery.
    let grandTotal: Double
    /// The same pieces at today's rate, while the site is selling; nil when not.
    let todayTotal: Double?
    /// The customer's own page for it.
    let statusUrl: String
    let claimedBy: String?
    let confirmedAt: String?
    let confirmedBy: String?
    /// The ORD- order confirming made.
    let orderId: String?
    let holdUntil: String?
    let declinedAt: String?
    let declineReason: String?

    private enum K: String, CodingKey {
        case id, state, placedAt, customer, delivery, lines, subtotal, deliveryCharge, grandTotal, todayTotal
        case statusUrl, claimedBy, confirmedAt, confirmedBy, orderId, holdUntil, declinedAt, declineReason
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        state = c.string(.state, default: "")
        placedAt = c.string(.placedAt, default: "")
        customer = c.object(.customer, of: OnlineCustomer.self) ?? OnlineCustomer()
        delivery = c.object(.delivery, of: OnlineDelivery.self) ?? OnlineDelivery()
        lines = c.list(.lines, of: OnlineOrderLine.self)
        subtotal = c.double(.subtotal, default: 0)
        deliveryCharge = c.double(.deliveryCharge, default: 0)
        grandTotal = c.double(.grandTotal, default: 0)
        todayTotal = c.double(.todayTotal)
        statusUrl = c.string(.statusUrl, default: "")
        claimedBy = c.string(.claimedBy)
        confirmedAt = c.string(.confirmedAt)
        confirmedBy = c.string(.confirmedBy)
        orderId = c.string(.orderId)
        holdUntil = c.string(.holdUntil)
        declinedAt = c.string(.declinedAt)
        declineReason = c.string(.declineReason)
    }
}

struct OnlineCustomer: Decodable, Hashable {
    var name = ""
    var phone = ""
    var email: String?

    private enum K: String, CodingKey { case name, phone, email }

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        name = c.string(.name, default: "")
        phone = c.string(.phone, default: "")
        email = c.string(.email)
    }
}

struct OnlineDelivery: Decodable, Hashable {
    var address = ""
    var city = ""
    var notes: String?

    private enum K: String, CodingKey { case address, city, notes }

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        address = c.string(.address, default: "")
        city = c.string(.city, default: "")
        notes = c.string(.notes)
    }
}

/// A piece as the customer ordered it: its photograph, the price they were quoted, the size they chose.
struct OnlineOrderLine: Decodable, Hashable {
    let key: String
    let description: String
    let price: Double
    let image: String
    let size: String?

    private enum K: String, CodingKey { case key, description, price, image, size }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        key = c.string(.key, default: "")
        description = c.string(.description, default: "")
        price = c.double(.price, default: 0)
        image = c.string(.image, default: "")
        let s = c.string(.size)?.trimmingCharacters(in: .whitespaces)
        size = (s ?? "").isEmpty ? nil : s
    }
}

/// /api/website/online: the waiting ones first, then the last fortnight's.
struct OnlineOrdersAnswer: Decodable {
    let orders: [OnlineOrderRow]

    private enum K: String, CodingKey { case orders }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        orders = c.list(.orders, of: OnlineOrderRow.self).filter { (r: OnlineOrderRow) in !r.id.isEmpty }
    }
}

/// What a move will send and to whom, in the server's own words (/api/website/online/<id>/preview,
/// /api/website/orders/<id>/preview: lib/website/online-preview.ts), shown before the move is made.
struct OnlinePreview: Decodable, Hashable {
    /// confirm, decline, transfer_received, lapse.
    let move: String
    /// The customer's reference: the ONL- number.
    let ref: String
    let name: String
    /// The number the WhatsApp goes to; empty when the order has none.
    let to: String
    /// The message, word for word.
    let text: String
    /// False when nothing will go: the ERP's WhatsApp is off, or there is no number.
    let sends: Bool
    /// Confirm: when the price hold would end, were it confirmed now.
    let holdUntil: String?
    /// Transfer received: what it books.
    let booking: OnlineBooking?

    private enum K: String, CodingKey { case move, ref, name, to, text, sends, holdUntil, booking }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        move = c.string(.move, default: "")
        ref = c.string(.ref, default: "")
        name = c.string(.name, default: "")
        to = c.string(.to, default: "")
        text = c.string(.text, default: "")
        sends = c.bool(.sends, default: true)
        holdUntil = c.string(.holdUntil)
        booking = c.object(.booking, of: OnlineBooking.self)
    }
}

/// What Transfer received books (fulfilment.ts markTransferReceived): the pieces' balance as one dated Bank
/// Transfer advance, the delivery as extra revenue.
struct OnlineBooking: Decodable, Hashable {
    let advance: Double
    let deliveryRevenue: Double
    let total: Double

    private enum K: String, CodingKey { case advance, deliveryRevenue, total }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        advance = c.double(.advance, default: 0)
        deliveryRevenue = c.double(.deliveryRevenue, default: 0)
        total = c.double(.total, default: 0)
    }
}
