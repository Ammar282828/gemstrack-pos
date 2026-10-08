import Foundation

/// A customer order: Firestore `orders/<ORD-000123>` (src/lib/store.ts `Order`).
/// Surprising: `grandTotal` is stored NET of the discount, the advances and the exchange, so it
/// IS the balance still owed, not a gross total (lib/order-payment.ts). `advancePayment` is the
/// running total of every cash advance, the first included; `advances` lists only the ones
/// taken after the order was placed. Orders from taheri.shop carry `website` (and `leopards`
/// once booked); the status of a lapsed one is `Cancelled`. An order with `invoiceId` has been
/// finalised into an invoice.
public struct Order: Decodable, Identifiable, Hashable {
    public let id: String
    public let delivery: DeliveryInfo?
    /// ISO instant.
    public let createdAt: String
    /// The date the piece was promised, a plain "yyyy-MM-dd"; absent on orders older than it.
    public let promisedDate: String?
    public let status: OrderStatus
    public let items: [OrderItem]
    /// All the rates at the time of the order.
    public let ratesApplied: Rates
    public let hideRates: Bool
    /// The 24k rate typed as the order was taken, for the shop's own margin; never the customer's.
    public let costRate24k: Double?
    public let takenBy: String?
    public let subtotal: Double
    /// Agreed at order time and carried onto the invoice.
    public let discountAmount: Double?
    public let advancePayment: Double
    /// How the first advance (taken with the order) was paid.
    public let advanceMethod: PaymentType?
    /// Advances recorded after the order was placed, each with its date and method.
    public let advances: [Payment]
    public let advanceGoldDetails: String?
    public let grandTotal: Double
    public let summary: String?
    public let customerId: String?
    public let customerName: String?
    public let customerContact: String?
    /// Per-order acquisition channel; defaults to the customer's.
    public let source: CustomerSource?
    /// Exchange rows; empty on older orders that keep only the one exchange below.
    public let exchanges: [ExchangeEntry]
    public let advanceInExchangeDescription: String?
    public let advanceInExchangeValue: Double?
    /// Set when the order is finalised into an invoice.
    public let invoiceId: String?
    /// TCS courier consignment number.
    public let tcsConsignmentNo: String?
    /// Set only on orders placed from taheri.shop.
    public let website: WebsiteOrderMeta?
    public let leopards: LeopardsMeta?
    public let notes: String?
    public let shopifyOrderId: String?
    public let shopifyOrderNumber: Int?
    public let shopifyDraftOrderId: String?
    public let shopifyDraftOrderName: String?

    private enum K: String, CodingKey {
        case id, delivery, createdAt, promisedDate, status, items, ratesApplied, hideRates, costRate24k
        case takenBy, subtotal, discountAmount, advancePayment, advanceMethod, advances, advanceGoldDetails
        case grandTotal, summary, customerId, customerName, customerContact, source
        case exchanges, advanceInExchangeDescription, advanceInExchangeValue, invoiceId, tcsConsignmentNo
        case website, leopards, notes, shopifyOrderId, shopifyOrderNumber, shopifyDraftOrderId, shopifyDraftOrderName
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? ""
        delivery = c.object(.delivery)
        createdAt = c.string(.createdAt, default: "")
        promisedDate = c.string(.promisedDate)
        status = c.word(.status, default: .unknown(""))
        items = c.list(.items)
        ratesApplied = c.object(.ratesApplied) ?? Rates()
        hideRates = c.bool(.hideRates, default: false)
        costRate24k = c.double(.costRate24k)
        takenBy = c.string(.takenBy)
        subtotal = c.double(.subtotal, default: 0)
        discountAmount = c.double(.discountAmount)
        advancePayment = c.double(.advancePayment, default: 0)
        advanceMethod = c.word(.advanceMethod)
        advances = c.list(.advances)
        advanceGoldDetails = c.string(.advanceGoldDetails)
        grandTotal = c.double(.grandTotal, default: 0)
        summary = c.string(.summary)
        customerId = c.string(.customerId)
        customerName = c.string(.customerName)
        customerContact = c.string(.customerContact)
        source = c.word(.source)
        exchanges = c.list(.exchanges)
        advanceInExchangeDescription = c.string(.advanceInExchangeDescription)
        advanceInExchangeValue = c.double(.advanceInExchangeValue)
        invoiceId = c.string(.invoiceId)
        tcsConsignmentNo = c.string(.tcsConsignmentNo)
        website = c.object(.website)
        leopards = c.object(.leopards)
        notes = c.string(.notes)
        shopifyOrderId = c.string(.shopifyOrderId)
        shopifyOrderNumber = c.int(.shopifyOrderNumber)
        shopifyDraftOrderId = c.string(.shopifyDraftOrderId)
        shopifyDraftOrderName = c.string(.shopifyDraftOrderName)
    }
}

/// One piece of an order (src/lib/store.ts `OrderItem`), nested in `Order.items`.
/// Surprising: `sampleImageDataUri` was a whole base64 photo inside the order on older orders;
/// newer ones keep the photo in `order_photos/<samplePhotoId>` and leave this empty, so avoid
/// holding it in lists. `givenAt` (the gold actually left the shop) is deliberately separate
/// from `karigarId` (a name was picked). `metalCost`/`wastageCost`/`totalEstimate` are the
/// estimate as saved, absent on pieces not yet priced.
public struct OrderItem: Decodable, Hashable {
    public let itemCategory: String?
    public let description: String
    public let karat: KaratValue?
    public let estimatedWeightG: Double
    public let stoneWeightG: Double
    public let hasStones: Bool
    public let wastagePercentage: Double
    public let makingCharges: Double
    public let diamondCharges: Double
    public let stoneCharges: Double
    public let sampleImageDataUri: String?
    public let samplePhotoId: String?
    public let referenceSku: String?
    public let sampleGiven: Bool
    public let isCompleted: Bool
    /// ISO; when the piece physically went to the karigar.
    public let givenAt: String?
    public let hasDiamonds: Bool
    public let stoneDetails: String?
    public let diamondDetails: String?
    public let metalCost: Double?
    public let wastageCost: Double?
    public let totalEstimate: Double?
    public let metalType: MetalType
    public let karigarId: String?
    public let isManualPrice: Bool
    public let manualPrice: Double?
    public let size: String?
    /// 925 silver only: White Rhodium, 21K Gold Plating, …
    public let platingType: String?
    /// Free text when `platingType` is "Other".
    public let platingNote: String?
    public let nickelFree: Bool
    /// Internal only; never printed on estimates or invoices.
    public let adminNote: String?

    private enum K: String, CodingKey {
        case itemCategory, description, karat, estimatedWeightG, stoneWeightG, hasStones, wastagePercentage
        case makingCharges, diamondCharges, stoneCharges, sampleImageDataUri, samplePhotoId, referenceSku
        case sampleGiven, isCompleted, givenAt, hasDiamonds, stoneDetails, diamondDetails
        case metalCost, wastageCost, totalEstimate, metalType, karigarId, isManualPrice, manualPrice
        case size, platingType, platingNote, nickelFree, adminNote
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        itemCategory = c.string(.itemCategory)
        description = c.string(.description, default: "")
        karat = c.word(.karat)
        estimatedWeightG = c.double(.estimatedWeightG, default: 0)
        stoneWeightG = c.double(.stoneWeightG, default: 0)
        hasStones = c.bool(.hasStones, default: false)
        wastagePercentage = c.double(.wastagePercentage, default: 0)
        makingCharges = c.double(.makingCharges, default: 0)
        diamondCharges = c.double(.diamondCharges, default: 0)
        stoneCharges = c.double(.stoneCharges, default: 0)
        sampleImageDataUri = c.string(.sampleImageDataUri)
        samplePhotoId = c.string(.samplePhotoId)
        referenceSku = c.string(.referenceSku)
        sampleGiven = c.bool(.sampleGiven, default: false)
        isCompleted = c.bool(.isCompleted, default: false)
        givenAt = c.string(.givenAt)
        hasDiamonds = c.bool(.hasDiamonds, default: false)
        stoneDetails = c.string(.stoneDetails)
        diamondDetails = c.string(.diamondDetails)
        metalCost = c.double(.metalCost)
        wastageCost = c.double(.wastageCost)
        totalEstimate = c.double(.totalEstimate)
        metalType = c.word(.metalType, default: .unknown(""))
        karigarId = c.string(.karigarId)
        isManualPrice = c.bool(.isManualPrice, default: false)
        manualPrice = c.double(.manualPrice)
        size = c.string(.size)
        platingType = c.string(.platingType)
        platingNote = c.string(.platingNote)
        nickelFree = c.bool(.nickelFree, default: false)
        adminNote = c.string(.adminNote)
    }
}

/// What taheri.shop adds to an order it placed, under `Order.website` (src/lib/website/types.ts
/// `WebsiteOrderMeta`). The customer's status page presents `token`; it is not a password.
/// Surprising: `total` is what the customer pays (pieces plus delivery), while the order's own
/// `grandTotal` is the ERP's balance. Past `holdUntil` with no transfer and no slip, the order
/// lapses to `Cancelled`.
public struct WebsiteOrderMeta: Decodable, Hashable {
    public let token: String
    /// Always "bank_transfer" today.
    public let paymentMethod: String
    public let paymentStatus: WebsitePaymentStatus
    /// Piece keys, in bag order.
    public let pieces: [String]
    public let deliveryCharge: Double
    /// When the quote was struck (ISO).
    public let quotedAt: String
    public let placedAt: String
    public let paidAt: String?
    public let customerPhone: String?
    public let customerEmail: String?
    public let customerUid: String?
    /// Today's price is held until then for the transfer.
    public let holdUntil: String?
    public let remindedAt: String?
    public let expiredAt: String?
    /// Slips the customer sent, newest last.
    public let slips: [WebsiteSlip]
    /// Ring or bangle size per piece key, as chosen on the site.
    public let sizes: [String: String]
    /// The online order this was confirmed from (`online_orders/<ONL-…>`).
    public let onlineId: String?
    public let confirmedAt: String?
    public let confirmedBy: String?
    public let total: Double?
    public let holdEndedAt: String?
    /// The delivery charge, booked as extra revenue when the transfer came in.
    public let deliveryRevenueId: String?
    public let lapsedBy: String?

    private enum K: String, CodingKey {
        case token, paymentMethod, paymentStatus, pieces, deliveryCharge, quotedAt, placedAt, paidAt
        case customerPhone, customerEmail, customerUid, holdUntil, remindedAt, expiredAt, slips, sizes
        case onlineId, confirmedAt, confirmedBy, total, holdEndedAt, deliveryRevenueId, lapsedBy
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        token = c.string(.token, default: "")
        paymentMethod = c.string(.paymentMethod, default: "bank_transfer")
        paymentStatus = c.word(.paymentStatus, default: .unknown(""))
        pieces = c.strings(.pieces)
        deliveryCharge = c.double(.deliveryCharge, default: 0)
        quotedAt = c.string(.quotedAt, default: "")
        placedAt = c.string(.placedAt, default: "")
        paidAt = c.string(.paidAt)
        customerPhone = c.string(.customerPhone)
        customerEmail = c.string(.customerEmail)
        customerUid = c.string(.customerUid)
        holdUntil = c.string(.holdUntil)
        remindedAt = c.string(.remindedAt)
        expiredAt = c.string(.expiredAt)
        slips = c.list(.slips)
        sizes = c.stringMap(.sizes)
        onlineId = c.string(.onlineId)
        confirmedAt = c.string(.confirmedAt)
        confirmedBy = c.string(.confirmedBy)
        total = c.double(.total)
        holdEndedAt = c.string(.holdEndedAt)
        deliveryRevenueId = c.string(.deliveryRevenueId)
        lapsedBy = c.string(.lapsedBy)
    }
}

/// A transfer slip the customer sent from their order page (`WebsiteSlip`); the file itself is
/// in `website_slips/<id>`, never in the order.
public struct WebsiteSlip: Decodable, Identifiable, Hashable {
    public let id: String
    public let at: String
    public let contentType: String
    public let bytes: Int
    public let reference: String?
    public let amount: Double?
    public let fromBank: String?

    private enum K: String, CodingKey { case id, at, contentType, bytes, reference, amount, fromBank }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? ""
        at = c.string(.at, default: "")
        contentType = c.string(.contentType, default: "")
        bytes = c.int(.bytes) ?? 0
        reference = c.string(.reference)
        amount = c.double(.amount)
        fromBank = c.string(.fromBank)
    }
}

/// The Leopards courier booking on a website order, under `Order.leopards` (`LeopardsMeta`).
/// `manual` is true when the CN was typed in by hand rather than returned by the API.
public struct LeopardsMeta: Decodable, Hashable {
    public let cn: String
    public let bookedAt: String
    public let trackingUrl: String
    public let manual: Bool
    public let deliveredAt: String?

    private enum K: String, CodingKey { case cn, bookedAt, trackingUrl, manual, deliveredAt }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        cn = c.string(.cn, default: "")
        bookedAt = c.string(.bookedAt, default: "")
        trackingUrl = c.string(.trackingUrl, default: "")
        manual = c.bool(.manual, default: false)
        deliveredAt = c.string(.deliveredAt)
    }
}
