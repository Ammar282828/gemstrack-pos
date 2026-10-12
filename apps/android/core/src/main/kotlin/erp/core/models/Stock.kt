package erp.core.models

import erp.core.Container
import erp.core.Decodable

/**
 * A piece in stock: Firestore `products/<SKU>`, and the same shape in `sold_products`
 * (src/lib/store.ts `Product`).
 * Surprising: the document id IS the SKU. Documents written by the store carry `sku` as a field
 * too, but an update strips it, so `sku` falls back to the injected `id`; `id` is the SKU.
 * `qrCodeDataUrl` is a whole base64 image kept in the document (heavy: keep it out of lists).
 * A custom-priced piece (`isCustomPrice`) is sold at `customPrice` whatever its weights say.
 * Prices are not stored: they are computed from weights, charges and today's rates
 * (lib/pricing.ts), so a model here carries the ingredients only.
 */
data class Product(
    val sku: String,
    val name: String,
    val categoryId: String,
    override val metalType: MetalType,
    val karat: KaratValue?,
    val metalWeightG: Double,
    val secondaryMetalType: MetalType?,
    val secondaryMetalKarat: KaratValue?,
    val secondaryMetalWeightG: Double?,
    val hasStones: Boolean,
    override val stoneWeightG: Double,
    val wastagePercentage: Double,
    val makingCharges: Double,
    val hasDiamonds: Boolean,
    val diamondCharges: Double,
    val stoneCharges: Double,
    val miscCharges: Double,
    val qrCodeDataUrl: String?,
    val imageUrl: String?,
    override val stoneDetails: String?,
    override val diamondDetails: String?,
    val isCustomPrice: Boolean,
    val customPrice: Double?,
    val description: String?,
    /** Free text ("10 Indian / 5 US"). */
    val size: String?,
    /** 925 silver only. */
    override val platingType: String?,
    override val platingNote: String?,
    override val nickelFree: Boolean,
    val silverRatePerGram: Double?,
    val shopifyProductId: String?,
    val shopifyVariantId: String?,
) : PieceMaterial {
    val id: String get() = sku

    companion object : Decodable<Product> {
        override fun fromMap(m: Map<String, Any?>): Product {
            val c = Container(m)
            return Product(
                sku = c.string("sku") ?: c.string("id") ?: "",
                name = c.string("name", ""),
                categoryId = c.string("categoryId", ""),
                metalType = c.word("metalType", MetalType, MetalType.unknown("")),
                karat = c.word("karat", KaratValue),
                metalWeightG = c.double("metalWeightG", 0.0),
                secondaryMetalType = c.word("secondaryMetalType", MetalType),
                secondaryMetalKarat = c.word("secondaryMetalKarat", KaratValue),
                secondaryMetalWeightG = c.double("secondaryMetalWeightG"),
                hasStones = c.bool("hasStones", false),
                stoneWeightG = c.double("stoneWeightG", 0.0),
                wastagePercentage = c.double("wastagePercentage", 0.0),
                makingCharges = c.double("makingCharges", 0.0),
                hasDiamonds = c.bool("hasDiamonds", false),
                diamondCharges = c.double("diamondCharges", 0.0),
                stoneCharges = c.double("stoneCharges", 0.0),
                miscCharges = c.double("miscCharges", 0.0),
                qrCodeDataUrl = c.string("qrCodeDataUrl"),
                imageUrl = c.string("imageUrl"),
                stoneDetails = c.string("stoneDetails"),
                diamondDetails = c.string("diamondDetails"),
                isCustomPrice = c.bool("isCustomPrice", false),
                customPrice = c.double("customPrice"),
                description = c.string("description"),
                size = c.string("size"),
                platingType = c.string("platingType"),
                platingNote = c.string("platingNote"),
                nickelFree = c.bool("nickelFree", false),
                silverRatePerGram = c.double("silverRatePerGram"),
                shopifyProductId = c.string("shopifyProductId"),
                shopifyVariantId = c.string("shopifyVariantId"),
            )
        }
    }
}

/**
 * A repair ticket: Firestore `repairs/<REP-000001>` (src/lib/store.ts `Repair`): one customer,
 * one visit, any number of pieces. Not an order (nothing is made or sold) and not a given item
 * (the pieces are the customer's).
 * Surprising: nothing is stored for the total, the paid sum or the balance: they are
 * computed from `pieces` and `payments` (`repairTotal`, `repairPaid`, `repairBalance`). Each
 * payment is also written to `additional_revenue` in the same transaction (its `revenueId`),
 * so Extra revenue counts repairs without knowing they exist. `promisedDate` is a plain
 * "yyyy-MM-dd". Status words: received (shown "In the shop"), ready, collected, cancelled.
 */
data class Repair(
    val id: String,
    val customerId: String?,
    val customerName: String,
    val customerContact: String?,
    val pieces: List<RepairPiece>,
    val payments: List<RepairPayment>,
    val status: RepairStatus,
    /** ISO instant. */
    val receivedAt: String,
    val promisedDate: String?,
    val readyAt: String?,
    val collectedAt: String?,
    val karigarId: String?,
    val karigarName: String?,
    val takenBy: String?,
    /** For the shop only; never printed, never sent. */
    val internalNote: String?,
) {
    companion object : Decodable<Repair> {
        override fun fromMap(m: Map<String, Any?>): Repair {
            val c = Container(m)
            return Repair(
                id = c.string("id") ?: "",
                customerId = c.string("customerId"),
                customerName = c.string("customerName", ""),
                customerContact = c.string("customerContact"),
                pieces = c.list("pieces", RepairPiece),
                payments = c.list("payments", RepairPayment),
                status = c.word("status", RepairStatus, RepairStatus.unknown("")),
                receivedAt = c.string("receivedAt", ""),
                promisedDate = c.string("promisedDate"),
                readyAt = c.string("readyAt"),
                collectedAt = c.string("collectedAt"),
                karigarId = c.string("karigarId"),
                karigarName = c.string("karigarName"),
                takenBy = c.string("takenBy"),
                internalNote = c.string("internalNote"),
            )
        }
    }
}

/** One piece on a repair ticket (`RepairPiece`), nested in `Repair.pieces`. */
data class RepairPiece(
    /** "Gold ring". */
    val item: String,
    /** "resize to 14". */
    val work: String,
    /** Weighed at the counter. */
    val weightG: Double?,
    /** What this piece's repair costs. */
    val price: Double?,
) {
    companion object : Decodable<RepairPiece> {
        override fun fromMap(m: Map<String, Any?>): RepairPiece {
            val c = Container(m)
            return RepairPiece(
                item = c.string("item", ""),
                work = c.string("work", ""),
                weightG = c.double("weightG"),
                price = c.double("price"),
            )
        }
    }
}

/** Money taken on a repair ticket (`RepairPayment`), nested in `Repair.payments`: an advance, or the balance on collection. Its note field is `note`, not the invoice payments' `notes`. */
data class RepairPayment(
    val amount: Double,
    /** ISO instant. */
    val date: String,
    val method: PaymentType?,
    /** The `additional_revenue` row this payment wrote. */
    val revenueId: String?,
    val note: String?,
) {
    companion object : Decodable<RepairPayment> {
        override fun fromMap(m: Map<String, Any?>): RepairPayment {
            val c = Container(m)
            return RepairPayment(
                amount = c.double("amount", 0.0),
                date = c.string("date", ""),
                method = c.word("method", PaymentType),
                revenueId = c.string("revenueId"),
                note = c.string("note"),
            )
        }
    }
}

/**
 * The shop's one settings document: Firestore `app_settings/global` (src/lib/store.ts `Settings`).
 * Surprising: the document id is the fixed "global" (`Collections.globalSettingsDoc`). The ERP
 * fills any missing field from placeholder seed values (a 240,000 24k rate, a sample phone
 * line); this model does not, so a missing rate is 0 and a missing text is "", honestly unset.
 * Left out on purpose: `shopifyAccessToken` (a secret that must never reach a phone),
 * `firebaseConfig`, `allowedDeviceIds`, `weprintApiSkus`, `labelLayout`, `overheadPlans` and
 * `monthlyOverheads` (web-only screens). Every `notif*` switch reads as off when absent, as the
 * server reads them (lib/notifications/schedule.ts); `autoDraftForms` defaults on. The times are
 * "HH:MM" in Karachi (defaults on the server: checklist 09:00, end of day 19:00, report 21:00).
 */
data class Settings(
    val id: String,

    // Rates, PKR per gram (lib/rates.ts RATE_KEYS).
    val goldRatePerGram24k: Double,
    val goldRatePerGram22k: Double,
    val goldRatePerGram21k: Double,
    val goldRatePerGram18k: Double,
    /** Palladium, flat: the fallback when a piece carries no karat. */
    val palladiumRatePerGram: Double,
    val palladiumRatePerGram18k: Double,
    val palladiumRatePerGram12k: Double,
    val platinumRatePerGram: Double,
    val silverRatePerGram: Double,

    /** When any rate last moved (ISO), stamped by every rate change and by "confirm rates". */
    val ratesUpdatedAt: String?,
    /** Who moved it: a name from lib/people.ts, else an email. */
    val ratesUpdatedBy: String?,
    /** When the rates were last auto-fetched from gold.pk (ISO). */
    val goldRatesLastFetchedAt: String?,

    val shopName: String,
    val shopAddress: String,
    val shopContact: String,
    val shopLogoUrl: String?,
    val shopLogoUrlBlack: String?,

    /** Counters: the next invoice is `lastInvoiceNumber + 1` (INV-000123). */
    val lastInvoiceNumber: Int,
    val lastOrderNumber: Int,
    /** REP-000001 onwards; missing until the first repair is written. */
    val lastRepairNumber: Int?,

    /** The shop's bank accounts, for the "pay to" lines. */
    val paymentMethods: List<PaymentMethod>,
    /** "default" or "taheri"; shops also hold retired colour words, all read as "taheri". */
    val theme: String,
    /** "standard" or "glass" (Settings > Appearance). */
    val uiStyle: String?,
    /** The kill switch: while true, the ERP writes nothing. */
    val databaseLocked: Boolean,
    /** Keep unfinished orders and invoices on this device and offer them back. */
    val autoDraftForms: Boolean,

    val shopifyStoreDomain: String?,
    val shopifyLastSyncedAt: String?,
    val shopifyGrantedScopes: String?,

    // WhatsApp notifications.
    val notifEnabled: Boolean,
    /** Recipient numbers, international format with no plus. Stored as text, and a number in places. */
    val notifPhones: List<String>,
    val notifNewOrder: Boolean,
    val notifOrderCompleted: Boolean,
    val notifOrderCancelled: Boolean,
    /** Real time: a new invoice was created. */
    val notifNewInvoice: Boolean,
    /** Real time: a payment was recorded on an invoice. */
    val notifPaymentReceived: Boolean,
    /** Nightly orders and invoices summary, at `notifDailyReportTime`. */
    val notifDailyReport: Boolean,
    val notifDailyChecklist: Boolean,
    val notifEndOfDay: Boolean,
    val notifWeeklyReport: Boolean,
    /** Daily 09:30: yesterday's ads. */
    val notifAdsDaily: Boolean,
    /** The 1st: the month before as a PDF. */
    val notifMonthlyReport: Boolean,
    /** Daily check: orders past their promised date. */
    val notifOrderOverdue: Boolean,
    /** Daily check: given items unreturned for 7+ days. */
    val notifGivenItems: Boolean,
    /** Weekly check: karigar balances. */
    val notifKarigarPayment: Boolean,
    val notifDailyChecklistTime: String?,
    val notifEndOfDayTime: String?,
    val notifDailyReportTime: String?,
) {
    companion object : Decodable<Settings> {
        override fun fromMap(m: Map<String, Any?>): Settings {
            val c = Container(m)
            return Settings(
                id = c.string("id") ?: Collections.globalSettingsDoc,
                goldRatePerGram24k = c.double("goldRatePerGram24k", 0.0),
                goldRatePerGram22k = c.double("goldRatePerGram22k", 0.0),
                goldRatePerGram21k = c.double("goldRatePerGram21k", 0.0),
                goldRatePerGram18k = c.double("goldRatePerGram18k", 0.0),
                palladiumRatePerGram = c.double("palladiumRatePerGram", 0.0),
                palladiumRatePerGram18k = c.double("palladiumRatePerGram18k", 0.0),
                palladiumRatePerGram12k = c.double("palladiumRatePerGram12k", 0.0),
                platinumRatePerGram = c.double("platinumRatePerGram", 0.0),
                silverRatePerGram = c.double("silverRatePerGram", 0.0),
                ratesUpdatedAt = c.string("ratesUpdatedAt"),
                ratesUpdatedBy = c.string("ratesUpdatedBy"),
                goldRatesLastFetchedAt = c.string("goldRatesLastFetchedAt"),
                shopName = c.string("shopName", ""),
                shopAddress = c.string("shopAddress", ""),
                shopContact = c.string("shopContact", ""),
                shopLogoUrl = c.string("shopLogoUrl"),
                shopLogoUrlBlack = c.string("shopLogoUrlBlack"),
                lastInvoiceNumber = c.int("lastInvoiceNumber") ?: 0,
                lastOrderNumber = c.int("lastOrderNumber") ?: 0,
                lastRepairNumber = c.int("lastRepairNumber"),
                paymentMethods = c.list("paymentMethods", PaymentMethod),
                theme = c.string("theme", "slate"),
                uiStyle = c.string("uiStyle"),
                databaseLocked = c.bool("databaseLocked", false),
                autoDraftForms = c.bool("autoDraftForms", true),
                shopifyStoreDomain = c.string("shopifyStoreDomain"),
                shopifyLastSyncedAt = c.string("shopifyLastSyncedAt"),
                shopifyGrantedScopes = c.string("shopifyGrantedScopes"),
                notifEnabled = c.bool("notifEnabled", false),
                notifPhones = c.strings("notifPhones"),
                notifNewOrder = c.bool("notifNewOrder", false),
                notifOrderCompleted = c.bool("notifOrderCompleted", false),
                notifOrderCancelled = c.bool("notifOrderCancelled", false),
                notifNewInvoice = c.bool("notifNewInvoice", false),
                notifPaymentReceived = c.bool("notifPaymentReceived", false),
                notifDailyReport = c.bool("notifDailyReport", false),
                notifDailyChecklist = c.bool("notifDailyChecklist", false),
                notifEndOfDay = c.bool("notifEndOfDay", false),
                notifWeeklyReport = c.bool("notifWeeklyReport", false),
                notifAdsDaily = c.bool("notifAdsDaily", false),
                notifMonthlyReport = c.bool("notifMonthlyReport", false),
                notifOrderOverdue = c.bool("notifOrderOverdue", false),
                notifGivenItems = c.bool("notifGivenItems", false),
                notifKarigarPayment = c.bool("notifKarigarPayment", false),
                notifDailyChecklistTime = c.string("notifDailyChecklistTime"),
                notifEndOfDayTime = c.string("notifEndOfDayTime"),
                notifDailyReportTime = c.string("notifDailyReportTime"),
            )
        }
    }
}

/** One of the shop's bank accounts, in `Settings.paymentMethods` (src/lib/store.ts `PaymentMethod`). Not to be confused with `PaymentType`, how a payment arrived. */
data class PaymentMethod(
    val id: String,
    val bankName: String,
    val accountName: String,
    val accountNumber: String,
    val iban: String?,
) {
    companion object : Decodable<PaymentMethod> {
        override fun fromMap(m: Map<String, Any?>): PaymentMethod {
            val c = Container(m)
            return PaymentMethod(
                id = c.string("id") ?: "",
                bankName = c.string("bankName", ""),
                accountName = c.string("accountName", ""),
                accountNumber = c.string("accountNumber", ""),
                iban = c.string("iban"),
            )
        }
    }
}
