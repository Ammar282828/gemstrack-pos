package erp.core.models

import erp.core.Word
import erp.core.WordFactory
import erp.core.lenientString

// The ERP's fixed lists (src/lib/store.ts, materials.ts, website/types.ts) as words that never
// fail a document: see `Word`. The fallback is `.unknown(raw)` everywhere (not `.other`), because
// three of the lists have a real "other" of their own. Matching is exact, as the TypeScript
// compares (`'In Progress'`, not `'in progress'`).

/** `ORDER_STATUSES`. A refunded order is `Refunded`; a lapsed website order is `Cancelled`. */
class OrderStatus private constructor(raw: String) : Word(raw) {
    companion object : WordFactory<OrderStatus> {
        val pending = OrderStatus("Pending")
        val inProgress = OrderStatus("In Progress")
        val completed = OrderStatus("Completed")
        val cancelled = OrderStatus("Cancelled")
        val refunded = OrderStatus("Refunded")
        private val known = listOf(pending, inProgress, completed, cancelled, refunded).associateBy { it.rawValue }
        override fun of(raw: String): OrderStatus = known[raw] ?: OrderStatus(raw)
        fun unknown(raw: String): OrderStatus = OrderStatus(raw)
        /** A word from any JSON value: text or a number, else the empty unknown. */
        fun decode(v: Any?): OrderStatus = of(lenientString(v) ?: "")
    }
}

/** `PAYMENT_TYPES`: how the money actually arrived. Absent on records older than payment types. */
class PaymentType private constructor(raw: String) : Word(raw) {
    companion object : WordFactory<PaymentType> {
        val cash = PaymentType("Cash")
        val card = PaymentType("Card")
        val bankTransfer = PaymentType("Bank Transfer")
        val cheque = PaymentType("Cheque")
        private val known = listOf(cash, card, bankTransfer, cheque).associateBy { it.rawValue }
        override fun of(raw: String): PaymentType = known[raw] ?: PaymentType(raw)
        fun unknown(raw: String): PaymentType = PaymentType(raw)
        /** A word from any JSON value: text or a number, else the empty unknown. */
        fun decode(v: Any?): PaymentType = of(lenientString(v) ?: "")
    }
}

/** `MetalType` (materials.ts). */
class MetalType private constructor(raw: String) : Word(raw) {
    companion object : WordFactory<MetalType> {
        val gold = MetalType("gold")
        val palladium = MetalType("palladium")
        val platinum = MetalType("platinum")
        val silver = MetalType("silver")
        private val known = listOf(gold, palladium, platinum, silver).associateBy { it.rawValue }
        override fun of(raw: String): MetalType = known[raw] ?: MetalType(raw)
        fun unknown(raw: String): MetalType = MetalType(raw)
        /** A word from any JSON value: text or a number, else the empty unknown. */
        fun decode(v: Any?): MetalType = of(lenientString(v) ?: "")
    }
}

/** `KaratValue` (materials.ts). Platinum and silver carry none. */
class KaratValue private constructor(raw: String) : Word(raw) {
    companion object : WordFactory<KaratValue> {
        val k12 = KaratValue("12k")
        val k18 = KaratValue("18k")
        val k21 = KaratValue("21k")
        val k22 = KaratValue("22k")
        val k24 = KaratValue("24k")
        private val known = listOf(k12, k18, k21, k22, k24).associateBy { it.rawValue }
        override fun of(raw: String): KaratValue = known[raw] ?: KaratValue(raw)
        fun unknown(raw: String): KaratValue = KaratValue(raw)
        /** A word from any JSON value: text or a number, else the empty unknown. */
        fun decode(v: Any?): KaratValue = of(lenientString(v) ?: "")
    }
}

/** `CUSTOMER_SOURCES`: where a customer or sale came from. */
class CustomerSource private constructor(raw: String) : Word(raw) {
    companion object : WordFactory<CustomerSource> {
        val taheriSpillover = CustomerSource("taheri_spillover")
        val referral = CustomerSource("referral")
        val walkin = CustomerSource("walkin")
        val socialMedia = CustomerSource("social_media")
        val website = CustomerSource("website")
        val other = CustomerSource("other")
        private val known = listOf(taheriSpillover, referral, walkin, socialMedia, website, other).associateBy { it.rawValue }
        override fun of(raw: String): CustomerSource = known[raw] ?: CustomerSource(raw)
        fun unknown(raw: String): CustomerSource = CustomerSource(raw)
        /** A word from any JSON value: text or a number, else the empty unknown. */
        fun decode(v: Any?): CustomerSource = of(lenientString(v) ?: "")
    }
}

/** `HisaabEntityType`: whose ledger a hisaab row belongs to. */
class HisaabEntityType private constructor(raw: String) : Word(raw) {
    companion object : WordFactory<HisaabEntityType> {
        val customer = HisaabEntityType("customer")
        val karigar = HisaabEntityType("karigar")
        private val known = listOf(customer, karigar).associateBy { it.rawValue }
        override fun of(raw: String): HisaabEntityType = known[raw] ?: HisaabEntityType(raw)
        fun unknown(raw: String): HisaabEntityType = HisaabEntityType(raw)
        /** A word from any JSON value: text or a number, else the empty unknown. */
        fun decode(v: Any?): HisaabEntityType = of(lenientString(v) ?: "")
    }
}

/** `PaidBy`: who fronted the cash for an expense. Absent means the business. */
class PaidBy private constructor(raw: String) : Word(raw) {
    companion object : WordFactory<PaidBy> {
        val business = PaidBy("business")
        val ammar = PaidBy("ammar")
        val mina = PaidBy("mina")
        private val known = listOf(business, ammar, mina).associateBy { it.rawValue }
        override fun of(raw: String): PaidBy = known[raw] ?: PaidBy(raw)
        fun unknown(raw: String): PaidBy = PaidBy(raw)
        /** A word from any JSON value: text or a number, else the empty unknown. */
        fun decode(v: Any?): PaidBy = of(lenientString(v) ?: "")
    }
}

/** `KARIGAR_JOB_STATUSES` (lower-case, with a hyphen, unlike the order statuses). */
class KarigarJobStatus private constructor(raw: String) : Word(raw) {
    companion object : WordFactory<KarigarJobStatus> {
        val pending = KarigarJobStatus("pending")
        val inProgress = KarigarJobStatus("in-progress")
        val completed = KarigarJobStatus("completed")
        private val known = listOf(pending, inProgress, completed).associateBy { it.rawValue }
        override fun of(raw: String): KarigarJobStatus = known[raw] ?: KarigarJobStatus(raw)
        fun unknown(raw: String): KarigarJobStatus = KarigarJobStatus(raw)
        /** A word from any JSON value: text or a number, else the empty unknown. */
        fun decode(v: Any?): KarigarJobStatus = of(lenientString(v) ?: "")
    }
}

/** `REPAIR_STATUSES`: in the shop, ready, collected, cancelled. */
class RepairStatus private constructor(raw: String) : Word(raw) {
    companion object : WordFactory<RepairStatus> {
        val received = RepairStatus("received")
        val ready = RepairStatus("ready")
        val collected = RepairStatus("collected")
        val cancelled = RepairStatus("cancelled")
        private val known = listOf(received, ready, collected, cancelled).associateBy { it.rawValue }
        override fun of(raw: String): RepairStatus = known[raw] ?: RepairStatus(raw)
        fun unknown(raw: String): RepairStatus = RepairStatus(raw)
        /** A word from any JSON value: text or a number, else the empty unknown. */
        fun decode(v: Any?): RepairStatus = of(lenientString(v) ?: "")
    }
}

/** `GivenItemStatus`. */
class GivenItemStatus private constructor(raw: String) : Word(raw) {
    companion object : WordFactory<GivenItemStatus> {
        val out = GivenItemStatus("out")
        val returned = GivenItemStatus("returned")
        private val known = listOf(out, returned).associateBy { it.rawValue }
        override fun of(raw: String): GivenItemStatus = known[raw] ?: GivenItemStatus(raw)
        fun unknown(raw: String): GivenItemStatus = GivenItemStatus(raw)
        /** A word from any JSON value: text or a number, else the empty unknown. */
        fun decode(v: Any?): GivenItemStatus = of(lenientString(v) ?: "")
    }
}

/** `GivenItemRecipientType`. */
class GivenItemRecipientType private constructor(raw: String) : Word(raw) {
    companion object : WordFactory<GivenItemRecipientType> {
        val karigar = GivenItemRecipientType("karigar")
        val customer = GivenItemRecipientType("customer")
        val other = GivenItemRecipientType("other")
        private val known = listOf(karigar, customer, other).associateBy { it.rawValue }
        override fun of(raw: String): GivenItemRecipientType = known[raw] ?: GivenItemRecipientType(raw)
        fun unknown(raw: String): GivenItemRecipientType = GivenItemRecipientType(raw)
        /** A word from any JSON value: text or a number, else the empty unknown. */
        fun decode(v: Any?): GivenItemRecipientType = of(lenientString(v) ?: "")
    }
}

/** `WebsitePaymentStatus` (website/types.ts): where a taheri.shop order's transfer stands. */
class WebsitePaymentStatus private constructor(raw: String) : Word(raw) {
    companion object : WordFactory<WebsitePaymentStatus> {
        val awaitingTransfer = WebsitePaymentStatus("awaiting_transfer")
        val slipSent = WebsitePaymentStatus("slip_sent")
        val transferReceived = WebsitePaymentStatus("transfer_received")
        val refunded = WebsitePaymentStatus("refunded")
        val expired = WebsitePaymentStatus("expired")
        private val known = listOf(awaitingTransfer, slipSent, transferReceived, refunded, expired).associateBy { it.rawValue }
        override fun of(raw: String): WebsitePaymentStatus = known[raw] ?: WebsitePaymentStatus(raw)
        fun unknown(raw: String): WebsitePaymentStatus = WebsitePaymentStatus(raw)
        /** A word from any JSON value: text or a number, else the empty unknown. */
        fun decode(v: Any?): WebsitePaymentStatus = of(lenientString(v) ?: "")
    }
}

/** An invoice's `status`: only ever `Refunded`, and absent on every live invoice. */
class InvoiceStatus private constructor(raw: String) : Word(raw) {
    companion object : WordFactory<InvoiceStatus> {
        val refunded = InvoiceStatus("Refunded")
        private val known = listOf(refunded).associateBy { it.rawValue }
        override fun of(raw: String): InvoiceStatus = known[raw] ?: InvoiceStatus(raw)
        fun unknown(raw: String): InvoiceStatus = InvoiceStatus(raw)
        /** A word from any JSON value: text or a number, else the empty unknown. */
        fun decode(v: Any?): InvoiceStatus = of(lenientString(v) ?: "")
    }
}
