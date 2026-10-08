import Foundation

/// One payment on an invoice's `paymentHistory`, or one of an order's `advances` (src/lib/store.ts
/// `Payment`). Nested in its document, never a document of its own.
/// Surprising: `method` is absent on records older than payment types, and an order's first
/// advance is not in `advances` at all (it is `advancePayment` less the list; lib/order-payment.ts).
public struct Payment: Decodable, Hashable {
    public let amount: Double
    /// ISO instant.
    public let date: String
    public let notes: String?
    public let method: PaymentType?
    /// Cheque number, last four of the card, transfer reference.
    public let reference: String?

    private enum K: String, CodingKey { case amount, date, notes, method, reference }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        amount = c.double(.amount, default: 0)
        date = c.string(.date, default: "")
        notes = c.string(.notes)
        method = c.word(.method)
        reference = c.string(.reference)
    }
}

/// Gold (or anything) taken in exchange, one row (src/lib/exchange.ts `ExchangeEntry`). An order's
/// rows are carried onto its invoice as they are. `value` is what comes off the bill, PKR.
/// Surprising: older orders hold one exchange as `advanceInExchangeDescription`/`Value`, and older
/// invoices one description with `exchangeAmount1`/`2`; `exchanges` is then empty, and the
/// ported rule that reads either belongs in Logic/ (`orderExchanges`, `invoiceExchanges`).
public struct ExchangeEntry: Decodable, Hashable {
    /// "Old 22k ring", "Broken chain".
    public let description: String
    /// Free text here ("22k"), not the `KaratValue` list.
    public let karat: String?
    public let weightG: Double?
    /// The rate it was taken at, often below the day's.
    public let ratePerGram: Double?
    public let value: Double

    private enum K: String, CodingKey { case description, karat, weightG, ratePerGram, value }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        description = c.string(.description, default: "")
        karat = c.string(.karat)
        weightG = c.double(.weightG)
        ratePerGram = c.double(.ratePerGram)
        value = c.double(.value, default: 0)
    }
}

/// Where a piece is going when it is not handed over at the counter (`DeliveryInfo`). Shared by
/// orders and invoices, so a piece ordered for delivery keeps its address when invoiced.
public struct DeliveryInfo: Decodable, Hashable {
    public let required: Bool
    public let address: String
    public let city: String?
    /// Only when the person receiving is not the customer on the bill.
    public let contactName: String?
    public let contactPhone: String?
    /// Gate code, timing, landmark.
    public let notes: String?
    /// ISO date the customer expects it.
    public let expectedDate: String?
    /// Charged to the customer; 0 when delivery is free.
    public let charge: Double?

    private enum K: String, CodingKey { case required, address, city, contactName, contactPhone, notes, expectedDate, charge }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        required = c.bool(.required, default: false)
        address = c.string(.address, default: "")
        city = c.string(.city)
        contactName = c.string(.contactName)
        contactPhone = c.string(.contactPhone)
        notes = c.string(.notes)
        expectedDate = c.string(.expectedDate)
        charge = c.double(.charge)
    }
}
