package erp.core.models

import erp.core.Container
import erp.core.Decodable

/** The Firestore collection names, as `FIRESTORE_COLLECTIONS` in src/lib/store.ts spells them (plus the few other collections the store itself reads), and the two settings documents. */
object Collections {
    /** Holds `global` (the shop's rates and switches; `Settings`) and `website` (selling from taheri.shop). */
    const val settings = "app_settings"

    /** Document id of the shop's one settings document. */
    const val globalSettingsDoc = "global"

    /** Document id of the website's selling configuration. */
    const val websiteConfigDoc = "website"

    /** Doc id is the SKU. */
    const val products = "products"

    /** A piece leaves `products` for here when it is sold (same shape as `Product`). */
    const val soldProducts = "sold_products"
    const val customers = "customers"
    const val karigars = "karigars"
    const val invoices = "invoices"
    const val orders = "orders"
    const val categories = "categories"
    const val hisaab = "hisaab"
    const val expenses = "expenses"
    const val additionalRevenue = "additional_revenue"
    const val karigarBatches = "karigar_batches"
    const val activityLog = "activity_log"
    const val givenItems = "given_items"
    const val silverTransactions = "silver_transactions"
    const val voiceAliases = "voice_aliases"
    const val karigarJobs = "karigar_jobs"
    const val repairs = "repairs"

    /** Photos of an order's pieces, one document each (lib/order-photos.ts); they no longer ride in the order. */
    const val orderPhotos = "order_photos"

    /** Orders from taheri.shop before a person confirms them (website/types.ts). */
    const val onlineOrders = "online_orders"

    /** A partner's own books, written when an expense is fronted by that partner (`PaidBy`). */
    const val ammarLedger = "ammar_ledger"
    const val minaLedger = "mina_ledger"
}

/**
 * The shop's per-gram rates, PKR (`RATE_KEYS` in src/lib/rates.ts). What an invoice or order
 * keeps as `ratesApplied` (TypeScript `Partial<Settings>`): the rates the sale was priced at,
 * whichever of them it carried. A rate the sale did not carry is null, never 0.
 */
data class Rates(
    val goldRatePerGram24k: Double? = null,
    val goldRatePerGram22k: Double? = null,
    val goldRatePerGram21k: Double? = null,
    val goldRatePerGram18k: Double? = null,
    val palladiumRatePerGram: Double? = null,
    val palladiumRatePerGram18k: Double? = null,
    val palladiumRatePerGram12k: Double? = null,
    val platinumRatePerGram: Double? = null,
    val silverRatePerGram: Double? = null,
) {
    companion object : Decodable<Rates> {
        override fun fromMap(m: Map<String, Any?>): Rates {
            val c = Container(m)
            return Rates(
                goldRatePerGram24k = c.double("goldRatePerGram24k"),
                goldRatePerGram22k = c.double("goldRatePerGram22k"),
                goldRatePerGram21k = c.double("goldRatePerGram21k"),
                goldRatePerGram18k = c.double("goldRatePerGram18k"),
                palladiumRatePerGram = c.double("palladiumRatePerGram"),
                palladiumRatePerGram18k = c.double("palladiumRatePerGram18k"),
                palladiumRatePerGram12k = c.double("palladiumRatePerGram12k"),
                platinumRatePerGram = c.double("platinumRatePerGram"),
                silverRatePerGram = c.double("silverRatePerGram"),
            )
        }
    }
}

/**
 * One payment on an invoice's `paymentHistory`, or one of an order's `advances` (src/lib/store.ts
 * `Payment`). Nested in its document, never a document of its own.
 * Surprising: `method` is absent on records older than payment types, and an order's first
 * advance is not in `advances` at all (it is `advancePayment` less the list; lib/order-payment.ts).
 */
data class Payment(
    val amount: Double,
    /** ISO instant. */
    val date: String,
    val notes: String? = null,
    val method: PaymentType? = null,
    /** Cheque number, last four of the card, transfer reference. */
    val reference: String? = null,
    /** Gold handed over with an order's advance (alone when `amount` is 0). The same rows sit on the order's `exchanges`;
     *  this is what lets the advance list show, and deleting the advance take them (lib/order-payment.ts). */
    val exchanges: List<ExchangeEntry> = emptyList(),
    /** "credit-payback" on the negative line written when a customer's credit is handed back (lib/invoice-credit.ts). */
    val kind: String? = null,
) {
    companion object : Decodable<Payment> {
        override fun fromMap(m: Map<String, Any?>): Payment {
            val c = Container(m)
            return Payment(
                amount = c.double("amount", 0.0),
                date = c.string("date", ""),
                notes = c.string("notes"),
                method = c.word("method", PaymentType),
                reference = c.string("reference"),
                exchanges = c.list("exchanges", ExchangeEntry),
                kind = c.string("kind"),
            )
        }
    }
}

/**
 * Gold (or anything) taken in exchange, one row (src/lib/exchange.ts `ExchangeEntry`). An order's
 * rows are carried onto its invoice as they are. `value` is what comes off the bill, PKR.
 * Surprising: older orders hold one exchange as `advanceInExchangeDescription`/`Value`, and older
 * invoices one description with `exchangeAmount1`/`2`; `exchanges` is then empty, and the
 * ported rule that reads either belongs in logic (`orderExchanges`, `invoiceExchanges`).
 */
data class ExchangeEntry(
    /** "Old 22k ring", "Broken chain". */
    val description: String,
    /** Free text here ("22k"), not the `KaratValue` list. */
    val karat: String? = null,
    val weightG: Double? = null,
    /** The rate it was taken at, often below the day's. */
    val ratePerGram: Double? = null,
    val value: Double,
) {
    companion object : Decodable<ExchangeEntry> {
        override fun fromMap(m: Map<String, Any?>): ExchangeEntry {
            val c = Container(m)
            return ExchangeEntry(
                description = c.string("description", ""),
                karat = c.string("karat"),
                weightG = c.double("weightG"),
                ratePerGram = c.double("ratePerGram"),
                value = c.double("value", 0.0),
            )
        }
    }
}

/** Where a piece is going when it is not handed over at the counter (`DeliveryInfo`). Shared by orders and invoices, so a piece ordered for delivery keeps its address when invoiced. */
data class DeliveryInfo(
    val required: Boolean,
    val address: String,
    val city: String?,
    /** Only when the person receiving is not the customer on the bill. */
    val contactName: String?,
    val contactPhone: String?,
    /** Gate code, timing, landmark. */
    val notes: String?,
    /** ISO date the customer expects it. */
    val expectedDate: String?,
    /** Charged to the customer; 0 when delivery is free. */
    val charge: Double?,
) {
    companion object : Decodable<DeliveryInfo> {
        override fun fromMap(m: Map<String, Any?>): DeliveryInfo {
            val c = Container(m)
            return DeliveryInfo(
                required = c.bool("required", false),
                address = c.string("address", ""),
                city = c.string("city"),
                contactName = c.string("contactName"),
                contactPhone = c.string("contactPhone"),
                notes = c.string("notes"),
                expectedDate = c.string("expectedDate"),
                charge = c.double("charge"),
            )
        }
    }
}

/**
 * A shop expense: Firestore `expenses/<id>` (src/lib/store.ts `Expense`).
 * Surprising: `category` is free text. Each house has its own list (a variable,
 * lib/expense-categories.ts), and the form accepts a typed one, so an expense can carry a name
 * that is on no list. `paidBy` is absent on older rows and then means the business; a partner
 * (`ammar`, `mina`) who fronted the cash also has a matching row in that partner's ledger
 * collection (`ledgerEntryId`). 'Partner Drawings' and 'Partner Salary' are read by name
 * (lib/partnership.ts).
 */
data class Expense(
    val id: String,
    /** ISO instant. */
    val date: String,
    val category: String,
    val description: String,
    val amount: Double,
    /** Links this expense to a karigar payment. */
    val karigarId: String?,
    /** Links this expense to a karigar hisaab batch. */
    val batchId: String?,
    /** Who fronted the cash; `business` when the row has none. */
    val paidBy: PaidBy,
    /** Set on partner salary rows: which partner it paid. */
    val shareholderId: String?,
    /** The entry on `{paidBy}_ledger` created for a non-business `paidBy`. */
    val ledgerEntryId: String?,
) {
    companion object : Decodable<Expense> {
        override fun fromMap(m: Map<String, Any?>): Expense {
            val c = Container(m)
            return Expense(
                id = c.string("id") ?: "",
                date = c.string("date", ""),
                category = c.string("category", ""),
                description = c.string("description", ""),
                amount = c.double("amount", 0.0),
                karigarId = c.string("karigarId"),
                batchId = c.string("batchId"),
                paidBy = c.word("paidBy", PaidBy, PaidBy.business),
                shareholderId = c.string("shareholderId"),
                ledgerEntryId = c.string("ledgerEntryId"),
            )
        }
    }
}

/**
 * Money in that is not a sale: Firestore `additional_revenue/<id>` ("Extra revenue" in the ERP;
 * src/lib/store.ts `AdditionalRevenue`).
 * Surprising: repairs write their payments here (`repairId`), and so do website deliveries
 * (`WebsiteOrderMeta.deliveryRevenueId`), so the dashboard and Analytics count them without
 * knowing those exist.
 */
data class AdditionalRevenue(
    val id: String,
    /** ISO instant. */
    val date: String,
    val description: String,
    val amount: Double,
    /** Set when the money was taken for a repair (`Repair.payments`). */
    val repairId: String?,
) {
    companion object : Decodable<AdditionalRevenue> {
        override fun fromMap(m: Map<String, Any?>): AdditionalRevenue {
            val c = Container(m)
            return AdditionalRevenue(
                id = c.string("id") ?: "",
                date = c.string("date", ""),
                description = c.string("description", ""),
                amount = c.double("amount", 0.0),
                repairId = c.string("repairId"),
            )
        }
    }
}
