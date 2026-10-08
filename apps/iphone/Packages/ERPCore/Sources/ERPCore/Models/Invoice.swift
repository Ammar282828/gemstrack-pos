import Foundation

/// A sale: Firestore `invoices/<INV-000123>` (src/lib/store.ts `Invoice`).
/// Surprising: `items` is sometimes stored as a map keyed "0", "1" (the store rebuilds it with
/// Object.values), and `list` reads both. `ratesApplied` is the rates the sale was priced at,
/// not today's. `balanceDue` is stored, not derived, and is negative when the customer overpaid
/// (a named customer's credit; lib/invoice-credit.ts). Shopify imports have ids "SHOPIFY-…"
/// and carry the `shopify*` fields; `source` here is Shopify's, `acquisitionSource` the channel.
public struct Invoice: Decodable, Identifiable, Hashable {
    public let id: String
    public let delivery: DeliveryInfo?
    public let customerId: String?
    public let customerName: String
    public let customerContact: String?
    public let items: [InvoiceItem]
    public let subtotal: Double
    public let discountAmount: Double
    /// Exchange rows; empty on older invoices that keep only `exchangeDescription`/`exchangeAmount1`/`2`.
    public let exchanges: [ExchangeEntry]
    public let exchangeDescription: String?
    public let exchangeAmount1: Double?
    public let exchangeAmount2: Double?
    /// Shipping, taxes, or other adjustments beyond line items.
    public let adjustmentsAmount: Double?
    public let grandTotal: Double
    public let amountPaid: Double
    public let balanceDue: Double
    /// ISO instant.
    public let createdAt: String
    public let ratesApplied: Rates
    /// Print the bill without the per-gram rates (they are still applied and stored).
    public let hideRates: Bool
    /// Who wrote it (a name from the house's list).
    public let takenBy: String?
    /// For the shop only; never printed, never sent.
    public let internalNote: String?
    public let paymentHistory: [Payment]
    /// Set when the invoice was made from an order.
    public let sourceOrderId: String?
    /// "shopify_import" / "shopify" for imported or synced orders.
    public let source: String?
    /// Import provenance / fulfilment status for Shopify orders.
    public let notes: String?
    public let shopifyFulfillment: String?
    public let shopifyFinancialStatus: String?
    public let shopifyCancelledAt: String?
    public let shopifyTransactionIds: [String]
    public let shopifySyncedAt: String?
    public let shopifyOrderName: String?
    public let shopifyOrderId: String?
    public let shopifyOrderNumber: Int?
    public let shopifyDraftOrderId: String?
    public let shopifyCheckoutUrl: String?
    public let status: InvoiceStatus?
    public let refundedAt: String?
    /// The key in the customer's link to this invoice (lib/share-token.ts).
    public let shareToken: String?
    /// The 24k rate typed as the sale was made, for the shop's own margin; never the customer's.
    public let costRate24k: Double?
    public let sentOnWhatsApp: SentOnWhatsApp?
    public let acquisitionSource: CustomerSource?

    private enum K: String, CodingKey {
        case id, delivery, customerId, customerName, customerContact, items, subtotal, discountAmount
        case exchanges, exchangeDescription, exchangeAmount1, exchangeAmount2, adjustmentsAmount
        case grandTotal, amountPaid, balanceDue, createdAt, ratesApplied, hideRates, takenBy, internalNote
        case paymentHistory, sourceOrderId, source, notes
        case shopifyFulfillment, shopifyFinancialStatus, shopifyCancelledAt, shopifyTransactionIds
        case shopifySyncedAt, shopifyOrderName, shopifyOrderId, shopifyOrderNumber, shopifyDraftOrderId
        case shopifyCheckoutUrl, status, refundedAt, shareToken, costRate24k, sentOnWhatsApp, acquisitionSource
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? ""
        delivery = c.object(.delivery)
        customerId = c.string(.customerId)
        customerName = c.string(.customerName, default: "")
        customerContact = c.string(.customerContact)
        items = c.list(.items)
        subtotal = c.double(.subtotal, default: 0)
        discountAmount = c.double(.discountAmount, default: 0)
        exchanges = c.list(.exchanges)
        exchangeDescription = c.string(.exchangeDescription)
        exchangeAmount1 = c.double(.exchangeAmount1)
        exchangeAmount2 = c.double(.exchangeAmount2)
        adjustmentsAmount = c.double(.adjustmentsAmount)
        grandTotal = c.double(.grandTotal, default: 0)
        amountPaid = c.double(.amountPaid, default: 0)
        balanceDue = c.double(.balanceDue, default: 0)
        createdAt = c.string(.createdAt, default: "")
        ratesApplied = c.object(.ratesApplied) ?? Rates()
        hideRates = c.bool(.hideRates, default: false)
        takenBy = c.string(.takenBy)
        internalNote = c.string(.internalNote)
        paymentHistory = c.list(.paymentHistory)
        sourceOrderId = c.string(.sourceOrderId)
        source = c.string(.source)
        notes = c.string(.notes)
        shopifyFulfillment = c.string(.shopifyFulfillment)
        shopifyFinancialStatus = c.string(.shopifyFinancialStatus)
        shopifyCancelledAt = c.string(.shopifyCancelledAt)
        shopifyTransactionIds = c.strings(.shopifyTransactionIds)
        shopifySyncedAt = c.string(.shopifySyncedAt)
        shopifyOrderName = c.string(.shopifyOrderName)
        shopifyOrderId = c.string(.shopifyOrderId)
        shopifyOrderNumber = c.int(.shopifyOrderNumber)
        shopifyDraftOrderId = c.string(.shopifyDraftOrderId)
        shopifyCheckoutUrl = c.string(.shopifyCheckoutUrl)
        status = c.word(.status)
        refundedAt = c.string(.refundedAt)
        shareToken = c.string(.shareToken)
        costRate24k = c.double(.costRate24k)
        sentOnWhatsApp = c.object(.sentOnWhatsApp)
        acquisitionSource = c.word(.acquisitionSource)
    }
}

/// The last time an invoice's PDF went to the customer from the shop's WhatsApp line
/// (`Invoice.sentOnWhatsApp`). An edit drops it: that version was not sent.
public struct SentOnWhatsApp: Decodable, Hashable {
    public let at: String
    public let to: String
    public let by: String

    private enum K: String, CodingKey { case at, to, by }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        at = c.string(.at, default: "")
        to = c.string(.to, default: "")
        by = c.string(.by, default: "")
    }
}

/// One line of an invoice (src/lib/store.ts `InvoiceItem`), nested in `Invoice.items`.
/// Surprising: `quantity` is always 1 in the current model. A fixed-price line has its charges
/// at 0 and keeps `hasDiamonds`/`hasStones` so the margin knows there are stones in the price.
/// The workshop fields (`karigarId`, `isCompleted`, `givenAt`) are there because a sold piece
/// can still need bench work and Shopify sales arrive as invoices, not orders.
public struct InvoiceItem: Decodable, Hashable {
    public let sku: String
    /// A silver piece priced at its own all-in rate, kept so an edit prices it the same.
    public let silverRatePerGram: Double?
    public let name: String
    public let categoryId: String
    public let metalType: MetalType
    public let karat: KaratValue?
    public let metalWeightG: Double
    public let stoneWeightG: Double
    public let quantity: Double
    public let unitPrice: Double
    public let itemTotal: Double
    public let metalCost: Double
    public let wastageCost: Double
    public let wastagePercentage: Double
    public let makingCharges: Double
    public let diamondChargesIfAny: Double
    public let stoneChargesIfAny: Double
    public let miscChargesIfAny: Double
    public let stoneDetails: String?
    public let diamondDetails: String?
    public let isCustomPrice: Bool
    public let isManualPrice: Bool
    public let hasDiamonds: Bool
    public let hasStones: Bool
    public let itemCategory: String?
    /// Free text ("10 Indian / 5 US").
    public let size: String?
    /// 925 silver only.
    public let platingType: String?
    public let platingNote: String?
    public let nickelFree: Bool
    /// Internal only; never printed on estimates or invoices.
    public let adminNote: String?
    public let karigarId: String?
    public let isCompleted: Bool
    /// When the piece physically went to the karigar (ISO).
    public let givenAt: String?

    private enum K: String, CodingKey {
        case sku, silverRatePerGram, name, categoryId, metalType, karat, metalWeightG, stoneWeightG
        case quantity, unitPrice, itemTotal, metalCost, wastageCost, wastagePercentage, makingCharges
        case diamondChargesIfAny, stoneChargesIfAny, miscChargesIfAny, stoneDetails, diamondDetails
        case isCustomPrice, isManualPrice, hasDiamonds, hasStones, itemCategory, size
        case platingType, platingNote, nickelFree, adminNote, karigarId, isCompleted, givenAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        sku = c.string(.sku, default: "")
        silverRatePerGram = c.double(.silverRatePerGram)
        name = c.string(.name, default: "")
        categoryId = c.string(.categoryId, default: "")
        metalType = c.word(.metalType, default: .unknown(""))
        karat = c.word(.karat)
        metalWeightG = c.double(.metalWeightG, default: 0)
        stoneWeightG = c.double(.stoneWeightG, default: 0)
        quantity = c.double(.quantity, default: 1)
        unitPrice = c.double(.unitPrice, default: 0)
        itemTotal = c.double(.itemTotal, default: 0)
        metalCost = c.double(.metalCost, default: 0)
        wastageCost = c.double(.wastageCost, default: 0)
        wastagePercentage = c.double(.wastagePercentage, default: 0)
        makingCharges = c.double(.makingCharges, default: 0)
        diamondChargesIfAny = c.double(.diamondChargesIfAny, default: 0)
        stoneChargesIfAny = c.double(.stoneChargesIfAny, default: 0)
        miscChargesIfAny = c.double(.miscChargesIfAny, default: 0)
        stoneDetails = c.string(.stoneDetails)
        diamondDetails = c.string(.diamondDetails)
        isCustomPrice = c.bool(.isCustomPrice, default: false)
        isManualPrice = c.bool(.isManualPrice, default: false)
        hasDiamonds = c.bool(.hasDiamonds, default: false)
        hasStones = c.bool(.hasStones, default: false)
        itemCategory = c.string(.itemCategory)
        size = c.string(.size)
        platingType = c.string(.platingType)
        platingNote = c.string(.platingNote)
        nickelFree = c.bool(.nickelFree, default: false)
        adminNote = c.string(.adminNote)
        karigarId = c.string(.karigarId)
        isCompleted = c.bool(.isCompleted, default: false)
        givenAt = c.string(.givenAt)
    }
}
