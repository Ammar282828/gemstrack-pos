package erp.core.models

import erp.core.Container
import erp.core.Decodable

/** What the three piece models (a sold line, an order's piece, a stocked product) share, which is all `describePlating` and `describeSettings` read (the TS takes the fields it needs). */
interface PieceMaterial {
    val metalType: MetalType
    val platingType: String?
    val platingNote: String?
    val nickelFree: Boolean
    val diamondDetails: String?
    val stoneDetails: String?
    val stoneWeightG: Double
}

/**
 * A sale: Firestore `invoices/<INV-000123>` (src/lib/store.ts `Invoice`).
 * Surprising: `items` is sometimes stored as a map keyed "0", "1" (the store rebuilds it with
 * Object.values), and `list` reads both. `ratesApplied` is the rates the sale was priced at,
 * not today's. `balanceDue` is stored, not derived, and is negative when the customer overpaid
 * (a named customer's credit; lib/invoice-credit.ts). Shopify imports have ids "SHOPIFY-…"
 * and carry the `shopify*` fields; `source` here is Shopify's, `acquisitionSource` the channel.
 */
data class Invoice(
    val id: String,
    val delivery: DeliveryInfo?,
    val customerId: String?,
    val customerName: String,
    val customerContact: String?,
    val items: List<InvoiceItem>,
    val subtotal: Double,
    val discountAmount: Double,
    /** Exchange rows; empty on older invoices that keep only `exchangeDescription`/`exchangeAmount1`/`2`. */
    val exchanges: List<ExchangeEntry>,
    val exchangeDescription: String?,
    val exchangeAmount1: Double?,
    val exchangeAmount2: Double?,
    /** Shipping, taxes, or other adjustments beyond line items. */
    val adjustmentsAmount: Double?,
    val grandTotal: Double,
    val amountPaid: Double,
    val balanceDue: Double,
    /** ISO instant. */
    val createdAt: String,
    val ratesApplied: Rates,
    /** Print the bill without the per-gram rates (they are still applied and stored). */
    val hideRates: Boolean,
    /** Who wrote it (a name from the house's list). */
    val takenBy: String?,
    /** For the shop only; never printed, never sent. */
    val internalNote: String?,
    val paymentHistory: List<Payment>,
    /** Set when the invoice was made from an order. */
    val sourceOrderId: String?,
    /** "shopify_import" / "shopify" for imported or synced orders. */
    val source: String?,
    /** Import provenance / fulfilment status for Shopify orders. */
    val notes: String?,
    val shopifyFulfillment: String?,
    val shopifyFinancialStatus: String?,
    val shopifyCancelledAt: String?,
    val shopifyTransactionIds: List<String>,
    val shopifySyncedAt: String?,
    val shopifyOrderName: String?,
    val shopifyOrderId: String?,
    val shopifyOrderNumber: Int?,
    val shopifyDraftOrderId: String?,
    val shopifyCheckoutUrl: String?,
    val status: InvoiceStatus?,
    val refundedAt: String?,
    /** The key in the customer's link to this invoice (lib/share-token.ts). */
    val shareToken: String?,
    /** The 24k rate typed as the sale was made, for the shop's own margin; never the customer's. */
    val costRate24k: Double?,
    val sentOnWhatsApp: SentOnWhatsApp?,
    val acquisitionSource: CustomerSource?,
) {
    companion object : Decodable<Invoice> {
        override fun fromMap(m: Map<String, Any?>): Invoice {
            val c = Container(m)
            return Invoice(
                id = c.string("id") ?: "",
                delivery = c.obj("delivery", DeliveryInfo),
                customerId = c.string("customerId"),
                customerName = c.string("customerName", ""),
                customerContact = c.string("customerContact"),
                items = c.list("items", InvoiceItem),
                subtotal = c.double("subtotal", 0.0),
                discountAmount = c.double("discountAmount", 0.0),
                exchanges = c.list("exchanges", ExchangeEntry),
                exchangeDescription = c.string("exchangeDescription"),
                exchangeAmount1 = c.double("exchangeAmount1"),
                exchangeAmount2 = c.double("exchangeAmount2"),
                adjustmentsAmount = c.double("adjustmentsAmount"),
                grandTotal = c.double("grandTotal", 0.0),
                amountPaid = c.double("amountPaid", 0.0),
                balanceDue = c.double("balanceDue", 0.0),
                createdAt = c.string("createdAt", ""),
                ratesApplied = c.obj("ratesApplied", Rates) ?: Rates(),
                hideRates = c.bool("hideRates", false),
                takenBy = c.string("takenBy"),
                internalNote = c.string("internalNote"),
                paymentHistory = c.list("paymentHistory", Payment),
                sourceOrderId = c.string("sourceOrderId"),
                source = c.string("source"),
                notes = c.string("notes"),
                shopifyFulfillment = c.string("shopifyFulfillment"),
                shopifyFinancialStatus = c.string("shopifyFinancialStatus"),
                shopifyCancelledAt = c.string("shopifyCancelledAt"),
                shopifyTransactionIds = c.strings("shopifyTransactionIds"),
                shopifySyncedAt = c.string("shopifySyncedAt"),
                shopifyOrderName = c.string("shopifyOrderName"),
                shopifyOrderId = c.string("shopifyOrderId"),
                shopifyOrderNumber = c.int("shopifyOrderNumber"),
                shopifyDraftOrderId = c.string("shopifyDraftOrderId"),
                shopifyCheckoutUrl = c.string("shopifyCheckoutUrl"),
                status = c.word("status", InvoiceStatus),
                refundedAt = c.string("refundedAt"),
                shareToken = c.string("shareToken"),
                costRate24k = c.double("costRate24k"),
                sentOnWhatsApp = c.obj("sentOnWhatsApp", SentOnWhatsApp),
                acquisitionSource = c.word("acquisitionSource", CustomerSource),
            )
        }
    }
}

/** The last time an invoice's PDF went to the customer from the shop's WhatsApp line (`Invoice.sentOnWhatsApp`). An edit drops it: that version was not sent. */
data class SentOnWhatsApp(val at: String, val to: String, val by: String) {
    companion object : Decodable<SentOnWhatsApp> {
        override fun fromMap(m: Map<String, Any?>): SentOnWhatsApp {
            val c = Container(m)
            return SentOnWhatsApp(at = c.string("at", ""), to = c.string("to", ""), by = c.string("by", ""))
        }
    }
}

/**
 * One line of an invoice (src/lib/store.ts `InvoiceItem`), nested in `Invoice.items`.
 * Surprising: `quantity` is always 1 in the current model. A fixed-price line has its charges
 * at 0 and keeps `hasDiamonds`/`hasStones` so the margin knows there are stones in the price.
 * The workshop fields (`karigarId`, `isCompleted`, `givenAt`) are there because a sold piece
 * can still need bench work and Shopify sales arrive as invoices, not orders.
 */
data class InvoiceItem(
    val sku: String,
    /** A silver piece priced at its own all-in rate, kept so an edit prices it the same. */
    val silverRatePerGram: Double?,
    val name: String,
    val categoryId: String,
    override val metalType: MetalType,
    val karat: KaratValue?,
    val metalWeightG: Double,
    override val stoneWeightG: Double,
    val quantity: Double,
    val unitPrice: Double,
    val itemTotal: Double,
    val metalCost: Double,
    val wastageCost: Double,
    val wastagePercentage: Double,
    val makingCharges: Double,
    val diamondChargesIfAny: Double,
    val stoneChargesIfAny: Double,
    val miscChargesIfAny: Double,
    override val stoneDetails: String?,
    override val diamondDetails: String?,
    val isCustomPrice: Boolean,
    val isManualPrice: Boolean,
    val hasDiamonds: Boolean,
    val hasStones: Boolean,
    val itemCategory: String?,
    /** Free text ("10 Indian / 5 US"). */
    val size: String?,
    /** 925 silver only. */
    override val platingType: String?,
    override val platingNote: String?,
    override val nickelFree: Boolean,
    /** Internal only; never printed on estimates or invoices. */
    val adminNote: String?,
    val karigarId: String?,
    val isCompleted: Boolean,
    /** When the piece physically went to the karigar (ISO). */
    val givenAt: String?,
) : PieceMaterial {
    companion object : Decodable<InvoiceItem> {
        override fun fromMap(m: Map<String, Any?>): InvoiceItem {
            val c = Container(m)
            return InvoiceItem(
                sku = c.string("sku", ""),
                silverRatePerGram = c.double("silverRatePerGram"),
                name = c.string("name", ""),
                categoryId = c.string("categoryId", ""),
                metalType = c.word("metalType", MetalType, MetalType.unknown("")),
                karat = c.word("karat", KaratValue),
                metalWeightG = c.double("metalWeightG", 0.0),
                stoneWeightG = c.double("stoneWeightG", 0.0),
                quantity = c.double("quantity", 1.0),
                unitPrice = c.double("unitPrice", 0.0),
                itemTotal = c.double("itemTotal", 0.0),
                metalCost = c.double("metalCost", 0.0),
                wastageCost = c.double("wastageCost", 0.0),
                wastagePercentage = c.double("wastagePercentage", 0.0),
                makingCharges = c.double("makingCharges", 0.0),
                diamondChargesIfAny = c.double("diamondChargesIfAny", 0.0),
                stoneChargesIfAny = c.double("stoneChargesIfAny", 0.0),
                miscChargesIfAny = c.double("miscChargesIfAny", 0.0),
                stoneDetails = c.string("stoneDetails"),
                diamondDetails = c.string("diamondDetails"),
                isCustomPrice = c.bool("isCustomPrice", false),
                isManualPrice = c.bool("isManualPrice", false),
                hasDiamonds = c.bool("hasDiamonds", false),
                hasStones = c.bool("hasStones", false),
                itemCategory = c.string("itemCategory"),
                size = c.string("size"),
                platingType = c.string("platingType"),
                platingNote = c.string("platingNote"),
                nickelFree = c.bool("nickelFree", false),
                adminNote = c.string("adminNote"),
                karigarId = c.string("karigarId"),
                isCompleted = c.bool("isCompleted", false),
                givenAt = c.string("givenAt"),
            )
        }
    }
}

/**
 * A customer order: Firestore `orders/<ORD-000123>` (src/lib/store.ts `Order`).
 * Surprising: `grandTotal` is stored NET of the discount, the advances and the exchange, so it
 * IS the balance still owed, not a gross total (lib/order-payment.ts). `advancePayment` is the
 * running total of every cash advance, the first included; `advances` lists only the ones
 * taken after the order was placed. Orders from taheri.shop carry `website` (and `leopards`
 * once booked); the status of a lapsed one is `Cancelled`. An order with `invoiceId` has been
 * finalised into an invoice.
 */
data class Order(
    val id: String,
    val delivery: DeliveryInfo?,
    /** ISO instant. */
    val createdAt: String,
    /** The date the piece was promised, a plain "yyyy-MM-dd"; absent on orders older than it. */
    val promisedDate: String?,
    val status: OrderStatus,
    val items: List<OrderItem>,
    /** All the rates at the time of the order. */
    val ratesApplied: Rates,
    val hideRates: Boolean,
    /** The 24k rate typed as the order was taken, for the shop's own margin; never the customer's. */
    val costRate24k: Double?,
    val takenBy: String?,
    val subtotal: Double,
    /** Agreed at order time and carried onto the invoice. */
    val discountAmount: Double?,
    val advancePayment: Double,
    /** How the first advance (taken with the order) was paid. */
    val advanceMethod: PaymentType?,
    /** Advances recorded after the order was placed, each with its date and method. */
    val advances: List<Payment>,
    val advanceGoldDetails: String?,
    val grandTotal: Double,
    val summary: String?,
    val customerId: String?,
    val customerName: String?,
    val customerContact: String?,
    /** Per-order acquisition channel; defaults to the customer's. */
    val source: CustomerSource?,
    /** Exchange rows; empty on older orders that keep only the one exchange below. */
    val exchanges: List<ExchangeEntry>,
    val advanceInExchangeDescription: String?,
    val advanceInExchangeValue: Double?,
    /** Set when the order is finalised into an invoice. */
    val invoiceId: String?,
    /** TCS courier consignment number. */
    val tcsConsignmentNo: String?,
    /** Set only on orders placed from taheri.shop. */
    val website: WebsiteOrderMeta?,
    val leopards: LeopardsMeta?,
    val notes: String?,
    val shopifyOrderId: String?,
    val shopifyOrderNumber: Int?,
    val shopifyDraftOrderId: String?,
    val shopifyDraftOrderName: String?,
) {
    companion object : Decodable<Order> {
        override fun fromMap(m: Map<String, Any?>): Order {
            val c = Container(m)
            return Order(
                id = c.string("id") ?: "",
                delivery = c.obj("delivery", DeliveryInfo),
                createdAt = c.string("createdAt", ""),
                promisedDate = c.string("promisedDate"),
                status = c.word("status", OrderStatus, OrderStatus.unknown("")),
                items = c.list("items", OrderItem),
                ratesApplied = c.obj("ratesApplied", Rates) ?: Rates(),
                hideRates = c.bool("hideRates", false),
                costRate24k = c.double("costRate24k"),
                takenBy = c.string("takenBy"),
                subtotal = c.double("subtotal", 0.0),
                discountAmount = c.double("discountAmount"),
                advancePayment = c.double("advancePayment", 0.0),
                advanceMethod = c.word("advanceMethod", PaymentType),
                advances = c.list("advances", Payment),
                advanceGoldDetails = c.string("advanceGoldDetails"),
                grandTotal = c.double("grandTotal", 0.0),
                summary = c.string("summary"),
                customerId = c.string("customerId"),
                customerName = c.string("customerName"),
                customerContact = c.string("customerContact"),
                source = c.word("source", CustomerSource),
                exchanges = c.list("exchanges", ExchangeEntry),
                advanceInExchangeDescription = c.string("advanceInExchangeDescription"),
                advanceInExchangeValue = c.double("advanceInExchangeValue"),
                invoiceId = c.string("invoiceId"),
                tcsConsignmentNo = c.string("tcsConsignmentNo"),
                website = c.obj("website", WebsiteOrderMeta),
                leopards = c.obj("leopards", LeopardsMeta),
                notes = c.string("notes"),
                shopifyOrderId = c.string("shopifyOrderId"),
                shopifyOrderNumber = c.int("shopifyOrderNumber"),
                shopifyDraftOrderId = c.string("shopifyDraftOrderId"),
                shopifyDraftOrderName = c.string("shopifyDraftOrderName"),
            )
        }
    }
}

/**
 * One piece of an order (src/lib/store.ts `OrderItem`), nested in `Order.items`.
 * Surprising: `sampleImageDataUri` was a whole base64 photo inside the order on older orders;
 * newer ones keep the photo in `order_photos/<samplePhotoId>` and leave this empty, so avoid
 * holding it in lists. `givenAt` (the gold actually left the shop) is deliberately separate
 * from `karigarId` (a name was picked). `metalCost`/`wastageCost`/`totalEstimate` are the
 * estimate as saved, absent on pieces not yet priced.
 */
data class OrderItem(
    val itemCategory: String?,
    val description: String,
    val karat: KaratValue?,
    val estimatedWeightG: Double,
    override val stoneWeightG: Double,
    val hasStones: Boolean,
    val wastagePercentage: Double,
    val makingCharges: Double,
    val diamondCharges: Double,
    val stoneCharges: Double,
    val sampleImageDataUri: String?,
    val samplePhotoId: String?,
    val referenceSku: String?,
    val sampleGiven: Boolean,
    val isCompleted: Boolean,
    /** ISO; when the piece physically went to the karigar. */
    val givenAt: String?,
    val hasDiamonds: Boolean,
    override val stoneDetails: String?,
    override val diamondDetails: String?,
    val metalCost: Double?,
    val wastageCost: Double?,
    val totalEstimate: Double?,
    override val metalType: MetalType,
    val karigarId: String?,
    val isManualPrice: Boolean,
    val manualPrice: Double?,
    val size: String?,
    /** 925 silver only: White Rhodium, 21K Gold Plating, … */
    override val platingType: String?,
    /** Free text when `platingType` is "Other". */
    override val platingNote: String?,
    override val nickelFree: Boolean,
    /** Internal only; never printed on estimates or invoices. */
    val adminNote: String?,
) : PieceMaterial {
    companion object : Decodable<OrderItem> {
        override fun fromMap(m: Map<String, Any?>): OrderItem {
            val c = Container(m)
            return OrderItem(
                itemCategory = c.string("itemCategory"),
                description = c.string("description", ""),
                karat = c.word("karat", KaratValue),
                estimatedWeightG = c.double("estimatedWeightG", 0.0),
                stoneWeightG = c.double("stoneWeightG", 0.0),
                hasStones = c.bool("hasStones", false),
                wastagePercentage = c.double("wastagePercentage", 0.0),
                makingCharges = c.double("makingCharges", 0.0),
                diamondCharges = c.double("diamondCharges", 0.0),
                stoneCharges = c.double("stoneCharges", 0.0),
                sampleImageDataUri = c.string("sampleImageDataUri"),
                samplePhotoId = c.string("samplePhotoId"),
                referenceSku = c.string("referenceSku"),
                sampleGiven = c.bool("sampleGiven", false),
                isCompleted = c.bool("isCompleted", false),
                givenAt = c.string("givenAt"),
                hasDiamonds = c.bool("hasDiamonds", false),
                stoneDetails = c.string("stoneDetails"),
                diamondDetails = c.string("diamondDetails"),
                metalCost = c.double("metalCost"),
                wastageCost = c.double("wastageCost"),
                totalEstimate = c.double("totalEstimate"),
                metalType = c.word("metalType", MetalType, MetalType.unknown("")),
                karigarId = c.string("karigarId"),
                isManualPrice = c.bool("isManualPrice", false),
                manualPrice = c.double("manualPrice"),
                size = c.string("size"),
                platingType = c.string("platingType"),
                platingNote = c.string("platingNote"),
                nickelFree = c.bool("nickelFree", false),
                adminNote = c.string("adminNote"),
            )
        }
    }
}

/**
 * What taheri.shop adds to an order it placed, under `Order.website` (src/lib/website/types.ts
 * `WebsiteOrderMeta`). The customer's status page presents `token`; it is not a password.
 * Surprising: `total` is what the customer pays (pieces plus delivery), while the order's own
 * `grandTotal` is the ERP's balance. Past `holdUntil` with no transfer and no slip, the order
 * lapses to `Cancelled`.
 */
data class WebsiteOrderMeta(
    val token: String,
    /** Always "bank_transfer" today. */
    val paymentMethod: String,
    val paymentStatus: WebsitePaymentStatus,
    /** Piece keys, in bag order. */
    val pieces: List<String>,
    val deliveryCharge: Double,
    /** When the quote was struck (ISO). */
    val quotedAt: String,
    val placedAt: String,
    val paidAt: String?,
    val customerPhone: String?,
    val customerEmail: String?,
    val customerUid: String?,
    /** Today's price is held until then for the transfer. */
    val holdUntil: String?,
    val remindedAt: String?,
    val expiredAt: String?,
    /** Slips the customer sent, newest last. */
    val slips: List<WebsiteSlip>,
    /** Ring or bangle size per piece key, as chosen on the site. */
    val sizes: Map<String, String>,
    /** The online order this was confirmed from (`online_orders/<ONL-…>`). */
    val onlineId: String?,
    val confirmedAt: String?,
    val confirmedBy: String?,
    val total: Double?,
    val holdEndedAt: String?,
    /** The delivery charge, booked as extra revenue when the transfer came in. */
    val deliveryRevenueId: String?,
    val lapsedBy: String?,
) {
    companion object : Decodable<WebsiteOrderMeta> {
        override fun fromMap(m: Map<String, Any?>): WebsiteOrderMeta {
            val c = Container(m)
            return WebsiteOrderMeta(
                token = c.string("token", ""),
                paymentMethod = c.string("paymentMethod", "bank_transfer"),
                paymentStatus = c.word("paymentStatus", WebsitePaymentStatus, WebsitePaymentStatus.unknown("")),
                pieces = c.strings("pieces"),
                deliveryCharge = c.double("deliveryCharge", 0.0),
                quotedAt = c.string("quotedAt", ""),
                placedAt = c.string("placedAt", ""),
                paidAt = c.string("paidAt"),
                customerPhone = c.string("customerPhone"),
                customerEmail = c.string("customerEmail"),
                customerUid = c.string("customerUid"),
                holdUntil = c.string("holdUntil"),
                remindedAt = c.string("remindedAt"),
                expiredAt = c.string("expiredAt"),
                slips = c.list("slips", WebsiteSlip),
                sizes = c.stringMap("sizes"),
                onlineId = c.string("onlineId"),
                confirmedAt = c.string("confirmedAt"),
                confirmedBy = c.string("confirmedBy"),
                total = c.double("total"),
                holdEndedAt = c.string("holdEndedAt"),
                deliveryRevenueId = c.string("deliveryRevenueId"),
                lapsedBy = c.string("lapsedBy"),
            )
        }
    }
}

/** A transfer slip the customer sent from their order page (`WebsiteSlip`); the file itself is in `website_slips/<id>`, never in the order. */
data class WebsiteSlip(
    val id: String,
    val at: String,
    val contentType: String,
    val bytes: Int,
    val reference: String?,
    val amount: Double?,
    val fromBank: String?,
) {
    companion object : Decodable<WebsiteSlip> {
        override fun fromMap(m: Map<String, Any?>): WebsiteSlip {
            val c = Container(m)
            return WebsiteSlip(
                id = c.string("id") ?: "",
                at = c.string("at", ""),
                contentType = c.string("contentType", ""),
                bytes = c.int("bytes") ?: 0,
                reference = c.string("reference"),
                amount = c.double("amount"),
                fromBank = c.string("fromBank"),
            )
        }
    }
}

/** The Leopards courier booking on a website order, under `Order.leopards` (`LeopardsMeta`). `manual` is true when the CN was typed in by hand rather than returned by the API. */
data class LeopardsMeta(
    val cn: String,
    val bookedAt: String,
    val trackingUrl: String,
    val manual: Boolean,
    val deliveredAt: String?,
) {
    companion object : Decodable<LeopardsMeta> {
        override fun fromMap(m: Map<String, Any?>): LeopardsMeta {
            val c = Container(m)
            return LeopardsMeta(
                cn = c.string("cn", ""),
                bookedAt = c.string("bookedAt", ""),
                trackingUrl = c.string("trackingUrl", ""),
                manual = c.bool("manual", false),
                deliveredAt = c.string("deliveredAt"),
            )
        }
    }
}
