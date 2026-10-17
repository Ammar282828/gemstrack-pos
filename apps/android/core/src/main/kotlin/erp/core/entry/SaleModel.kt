package erp.core.entry

import erp.core.Json
import erp.core.logic.ExchangeRow
import erp.core.logic.ExchangeRowPatch
import erp.core.logic.PricedPiece
import erp.core.logic.applyExchangeRowChange
import erp.core.logic.blankExchangeRow
import erp.core.logic.gramsPerTola
import erp.core.logic.metalHasKarat
import erp.core.logic.newExchangeRowId
import erp.core.logic.rupees
import erp.core.models.Customer
import erp.core.models.KaratValue
import erp.core.models.MetalType
import erp.core.models.Product
import erp.core.shortestDigits
import erp.core.swiftDouble
import erp.core.swiftRounded
import erp.core.swiftTrim
import erp.core.swiftTrimNewlines
import java.math.BigDecimal
import java.math.RoundingMode
import kotlin.math.abs

// The sale in progress, as the phone keeps it. The web keeps an unfinished sale in Firestore (Drafts,
// components/drafts/use-work-drafts.ts) so it can be finished on another device; the phone keeps its own copy
// ("erp.saleDraft") and sends the same to Drafts (SaleWebDraft). Nothing here decides money: the prices, totals and
// credit come from the rules (Pricing, Exchange, WalkIn, InvoiceCredit) and the server prices the sale again when it
// is saved. (SaleModel.swift.)

/** Numbers as the sale's fields hold them: typed text in, a finite number out. */
object SaleNumber {
    /** Text to a number: commas are thousands, blank or unreadable is null. Never NaN or infinity. */
    fun parse(text: String): Double? {
        val t = swiftTrimNewlines(text).replace(",", "")
        if (t.isEmpty()) return null
        val v = swiftDouble(t) ?: return null
        return if (v.isFinite()) v else null
    }

    /** `Number(v) || 0`. */
    fun value(text: String): Double = parse(text) ?: 0.0

    /**
     * Every digit a figure has, as the web's String(n) keeps them: a piece opened in the line editor and applied
     * unchanged must not move (a weight of 3.45678 g is not 3.4568). ICU rounds the double's shortest digits, half to
     * even, at ten places; no grouping, no exponent.
     */
    private fun plain(v: Double): String {
        if (v.isNaN()) return "NaN"
        if (v.isInfinite()) return if (v < 0) "-∞" else "∞"
        val negative = v < 0 || (v == 0.0 && 1.0 / v < 0)
        if (v == 0.0) return if (negative) "-0" else "0"
        val (digits, n) = shortestDigits(abs(v))
        // 0.DIGITS × 10^n as a decimal.
        val exact = BigDecimal(java.math.BigInteger(digits), digits.length - n)
        val rounded = exact.setScale(10, RoundingMode.HALF_EVEN).stripTrailingZeros()
        val text = if (rounded.signum() == 0) "0" else rounded.toPlainString()
        return (if (negative) "-" else "") + text
    }

    /** A number back into a field: 0 and nothing are blank (decisions.md "Number fields"). */
    fun text(v: Double?): String {
        if (v == null || !v.isFinite() || v == 0.0) return ""
        return plain(v)
    }

    /** Grams the way the web prints them: 5.2, 12.35, never 5.2000. */
    fun grams(v: Double): String = plain(v)
}

// One piece on the bill

/**
 * A piece on the bill as the sale holds it: the stock record's fields, perhaps re-priced by hand (the web's cart
 * item, edit-cart-item-dialog.tsx). Words (metal, karat) stay text so the draft is plain JSON; `priced` turns it into
 * what the rules price.
 */
class SaleLine(
    var sku: String,
    var name: String = "",
    var categoryId: String = "",
    var metalType: String = "gold",
    var karat: String? = null,
    var metalWeightG: Double = 0.0,
    var secondaryMetalType: String? = null,
    var secondaryMetalKarat: String? = null,
    var secondaryMetalWeightG: Double? = null,
    var hasStones: Boolean = false,
    var stoneWeightG: Double = 0.0,
    var wastagePercentage: Double = 0.0,
    var makingCharges: Double = 0.0,
    var hasDiamonds: Boolean = false,
    var diamondCharges: Double = 0.0,
    var stoneCharges: Double = 0.0,
    var miscCharges: Double = 0.0,
    var imageUrl: String? = null,
    var stoneDetails: String? = null,
    var diamondDetails: String? = null,
    var isCustomPrice: Boolean = false,
    var customPrice: Double? = null,
    /** The product's "description": what prints on the bill under the piece. */
    var billDescription: String? = null,
    var size: String? = null,
    var platingType: String? = null,
    var platingNote: String? = null,
    var nickelFree: Boolean = false,
    var silverRatePerGram: Double? = null,
    var shopifyProductId: String? = null,
    var shopifyVariantId: String? = null,
) {
    val id: String get() = sku

    fun copy(): SaleLine = SaleLine(
        sku, name, categoryId, metalType, karat, metalWeightG, secondaryMetalType, secondaryMetalKarat,
        secondaryMetalWeightG, hasStones, stoneWeightG, wastagePercentage, makingCharges, hasDiamonds, diamondCharges,
        stoneCharges, miscCharges, imageUrl, stoneDetails, diamondDetails, isCustomPrice, customPrice, billDescription,
        size, platingType, platingNote, nickelFree, silverRatePerGram, shopifyProductId, shopifyVariantId,
    )

    /** What the rules price (`PricedPiece(product)` for a piece in stock, with this sale's edits). */
    val priced: PricedPiece
        get() = PricedPiece(
            categoryId = if (categoryId.isEmpty()) null else categoryId,
            metalType = MetalType.of(metalType),
            karat = word(karat)?.let { KaratValue.of(it) },
            metalWeightG = metalWeightG,
            secondaryMetalType = word(secondaryMetalType)?.let { MetalType.of(it) },
            secondaryMetalKarat = word(secondaryMetalKarat)?.let { KaratValue.of(it) },
            secondaryMetalWeightG = secondaryMetalWeightG,
            stoneWeightG = stoneWeightG,
            wastagePercentage = wastagePercentage,
            makingCharges = makingCharges,
            hasDiamonds = hasDiamonds,
            diamondCharges = diamondCharges,
            stoneCharges = stoneCharges,
            miscCharges = miscCharges,
            isCustomPrice = isCustomPrice,
            customPrice = customPrice,
            silverRatePerGram = silverRatePerGram,
        )

    /** A key made up for one bill (NEW-…, BILL-…), not a stock number (lib/sku.ts). */
    val isOneOff: Boolean get() = SaleLookup.isOneOff(sku)

    /** The SKU worth showing a person, or nothing (lib/sku.ts `stockSku`). */
    val stockSku: String? get() = if (isOneOff) null else sku

    /**
     * The piece as the ERP's createInvoice takes it: the full product document, plus this sale's edits
     * (`isCustomPrice` and the price fields), as the web's cart sends it. `qr` is the live piece's tag image, if the
     * shelf has it: sold_products keeps the whole document.
     */
    fun payload(qr: String? = null): MutableMap<String, Any?> {
        val o = LinkedHashMap<String, Any?>()
        o["sku"] = sku
        o["name"] = name
        o["categoryId"] = categoryId
        o["metalType"] = metalType
        o["metalWeightG"] = metalWeightG
        o["hasStones"] = hasStones
        o["stoneWeightG"] = stoneWeightG
        o["wastagePercentage"] = wastagePercentage
        o["makingCharges"] = makingCharges
        o["hasDiamonds"] = hasDiamonds
        o["diamondCharges"] = diamondCharges
        o["stoneCharges"] = stoneCharges
        o["miscCharges"] = miscCharges
        o["isCustomPrice"] = isCustomPrice
        o["nickelFree"] = nickelFree
        o["quantity"] = 1
        fun put(key: String, value: String?) {
            if (value != null && swiftTrim(value).isNotEmpty()) o[key] = value
        }
        put("karat", karat)
        put("secondaryMetalType", secondaryMetalType)
        put("secondaryMetalKarat", secondaryMetalKarat)
        secondaryMetalWeightG?.let { o["secondaryMetalWeightG"] = it }
        put("imageUrl", imageUrl)
        put("qrCodeDataUrl", qr)
        put("stoneDetails", stoneDetails)
        put("diamondDetails", diamondDetails)
        val price = customPrice
        if (isCustomPrice && price != null) o["customPrice"] = price
        put("description", billDescription)
        put("size", size)
        put("platingType", platingType)
        put("platingNote", platingNote)
        val rate = silverRatePerGram
        if (rate != null && rate > 0) o["silverRatePerGram"] = rate
        put("shopifyProductId", shopifyProductId)
        put("shopifyVariantId", shopifyVariantId)
        return o
    }

    /** The line as the phone stores it (Codable's keys; unset optionals are left out). */
    fun toMap(): Map<String, Any?> {
        val o = LinkedHashMap<String, Any?>()
        o["sku"] = sku
        o["name"] = name
        o["categoryId"] = categoryId
        o["metalType"] = metalType
        karat?.let { o["karat"] = it }
        o["metalWeightG"] = metalWeightG
        secondaryMetalType?.let { o["secondaryMetalType"] = it }
        secondaryMetalKarat?.let { o["secondaryMetalKarat"] = it }
        secondaryMetalWeightG?.let { o["secondaryMetalWeightG"] = it }
        o["hasStones"] = hasStones
        o["stoneWeightG"] = stoneWeightG
        o["wastagePercentage"] = wastagePercentage
        o["makingCharges"] = makingCharges
        o["hasDiamonds"] = hasDiamonds
        o["diamondCharges"] = diamondCharges
        o["stoneCharges"] = stoneCharges
        o["miscCharges"] = miscCharges
        imageUrl?.let { o["imageUrl"] = it }
        stoneDetails?.let { o["stoneDetails"] = it }
        diamondDetails?.let { o["diamondDetails"] = it }
        o["isCustomPrice"] = isCustomPrice
        customPrice?.let { o["customPrice"] = it }
        billDescription?.let { o["billDescription"] = it }
        size?.let { o["size"] = it }
        platingType?.let { o["platingType"] = it }
        platingNote?.let { o["platingNote"] = it }
        o["nickelFree"] = nickelFree
        silverRatePerGram?.let { o["silverRatePerGram"] = it }
        shopifyProductId?.let { o["shopifyProductId"] = it }
        shopifyVariantId?.let { o["shopifyVariantId"] = it }
        return o
    }

    companion object {
        private fun word(s: String?): String? = if (s == null || swiftTrim(s).isEmpty()) null else s

        /**
         * The piece as the shelf has it. The tag's QR image stays on the shelf: it is a whole base64 picture, too
         * heavy for a draft; the sale adds it back from the live piece when it is saved.
         */
        fun fromProduct(p: Product): SaleLine = SaleLine(
            sku = p.sku,
            name = p.name,
            categoryId = p.categoryId,
            metalType = p.metalType.rawValue,
            karat = p.karat?.rawValue,
            metalWeightG = p.metalWeightG,
            secondaryMetalType = p.secondaryMetalType?.rawValue,
            secondaryMetalKarat = p.secondaryMetalKarat?.rawValue,
            secondaryMetalWeightG = p.secondaryMetalWeightG,
            hasStones = p.hasStones,
            stoneWeightG = p.stoneWeightG,
            wastagePercentage = p.wastagePercentage,
            makingCharges = p.makingCharges,
            hasDiamonds = p.hasDiamonds,
            diamondCharges = p.diamondCharges,
            stoneCharges = p.stoneCharges,
            miscCharges = p.miscCharges,
            imageUrl = p.imageUrl,
            stoneDetails = p.stoneDetails,
            diamondDetails = p.diamondDetails,
            isCustomPrice = p.isCustomPrice,
            customPrice = p.customPrice,
            billDescription = p.description,
            size = p.size,
            platingType = p.platingType,
            platingNote = p.platingNote,
            nickelFree = p.nickelFree,
            silverRatePerGram = p.silverRatePerGram,
            shopifyProductId = p.shopifyProductId,
            shopifyVariantId = p.shopifyVariantId,
        )

        /**
         * A blank line, for billing a piece that was never in inventory (edit-cart-item-dialog.tsx `blankCartItem`):
         * the house's own metal, 21k when that is gold, and the opening wastage of the order and product forms (10%
         * on gold, nothing on silver). Priced from its weight and the rate unless somebody says otherwise.
         */
        fun blankFor(metal: String, sku: String): SaleLine = SaleLine(
            sku = sku,
            name = "",
            categoryId = "",
            metalType = metal,
            karat = if (metal == "gold") "21k" else null,
            metalWeightG = 0.0,
            hasStones = false,
            stoneWeightG = 0.0,
            wastagePercentage = if (metal == "silver") 0.0 else 10.0,
            makingCharges = 0.0,
            hasDiamonds = false,
            diamondCharges = 0.0,
            stoneCharges = 0.0,
            miscCharges = 0.0,
            isCustomPrice = false,
            customPrice = 0.0,
            nickelFree = false,
        )

        /**
         * `NEW-` plus `Date.now().toString(36).toUpperCase()`: the milliseconds since 1970 in base 36. The key tells
         * the sale's lines apart; it is not a stock number (lib/sku.ts). `avoiding` keeps two new items on one bill
         * from sharing a key.
         */
        fun newItemSku(nowSeconds: Double = System.currentTimeMillis() / 1000.0, avoiding: Set<String> = emptySet()): String {
            var ms = maxOf(0.0, Math.floor(nowSeconds * 1000)).toLong()
            var out = "NEW-" + java.lang.Long.toString(ms, 36).uppercase()
            while (avoiding.contains(out)) {
                ms += 1
                out = "NEW-" + java.lang.Long.toString(ms, 36).uppercase()
            }
            return out
        }

        /** A saved line must open after an update that added a field; a line without its `sku` is no line (null). */
        fun fromMap(m: Map<String, Any?>): SaleLine? {
            val c = DraftReader(m)
            val sku = c.string("sku") ?: return null
            return SaleLine(
                sku = sku,
                name = c.string("name", ""),
                categoryId = c.string("categoryId", ""),
                metalType = c.string("metalType", "gold"),
                karat = c.string("karat"),
                metalWeightG = c.double("metalWeightG", 0.0),
                secondaryMetalType = c.string("secondaryMetalType"),
                secondaryMetalKarat = c.string("secondaryMetalKarat"),
                secondaryMetalWeightG = c.double("secondaryMetalWeightG"),
                hasStones = c.bool("hasStones", false),
                stoneWeightG = c.double("stoneWeightG", 0.0),
                wastagePercentage = c.double("wastagePercentage", 0.0),
                makingCharges = c.double("makingCharges", 0.0),
                hasDiamonds = c.bool("hasDiamonds", false),
                diamondCharges = c.double("diamondCharges", 0.0),
                stoneCharges = c.double("stoneCharges", 0.0),
                miscCharges = c.double("miscCharges", 0.0),
                imageUrl = c.string("imageUrl"),
                stoneDetails = c.string("stoneDetails"),
                diamondDetails = c.string("diamondDetails"),
                isCustomPrice = c.bool("isCustomPrice", false),
                customPrice = c.double("customPrice"),
                billDescription = c.string("billDescription"),
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

// Rows

/**
 * An exchange row as the draft keeps it: the rules' `ExchangeRow` (components/shared/exchange-rows.tsx). The rules
 * (grams × rate fills the amount until one is typed) stay in the rules.
 */
data class SaleExchangeRow(
    val id: String,
    val description: String,
    val karat: String,
    val weightG: String,
    val ratePerGram: String,
    val value: String,
    val valueTyped: Boolean,
) {
    constructor(r: ExchangeRow) : this(r.id, r.description, r.karat, r.weightG, r.ratePerGram, r.value, r.valueTyped)

    val core: ExchangeRow
        get() = ExchangeRow(id = id, description = description, karat = karat, weightG = weightG, ratePerGram = ratePerGram, value = value, valueTyped = valueTyped)

    val hasDetails: Boolean get() = karat.isNotEmpty() || weightG.isNotEmpty() || ratePerGram.isNotEmpty()
    val isBlank: Boolean get() = swiftTrim(description).isEmpty() && value.isEmpty() && !hasDetails

    fun toMap(): Map<String, Any?> = linkedMapOf(
        "id" to id, "description" to description, "karat" to karat, "weightG" to weightG,
        "ratePerGram" to ratePerGram, "value" to value, "valueTyped" to valueTyped,
    )

    companion object {
        fun blank(): SaleExchangeRow = SaleExchangeRow(blankExchangeRow())

        /** A row needs every field (Swift's synthesized decoder); a row missing one is no row (null). */
        fun fromMap(m: Map<String, Any?>): SaleExchangeRow? {
            val c = DraftReader(m)
            return SaleExchangeRow(
                id = c.string("id") ?: return null,
                description = c.string("description") ?: return null,
                karat = c.string("karat") ?: return null,
                weightG = c.string("weightG") ?: return null,
                ratePerGram = c.string("ratePerGram") ?: return null,
                value = c.string("value") ?: return null,
                valueTyped = c.bool("valueTyped") ?: return null,
            )
        }
    }
}

/** One "Payment received" row as typed (the amount stays text until the sale is saved). */
data class SalePaymentRow(
    val id: String = newExchangeRowId(),
    var amount: String = "",
    var method: String = "Cash",
    var reference: String = "",
) {
    fun toMap(): Map<String, Any?> = linkedMapOf("id" to id, "amount" to amount, "method" to method, "reference" to reference)

    companion object {
        fun fromMap(m: Map<String, Any?>): SalePaymentRow? {
            val c = DraftReader(m)
            return SalePaymentRow(
                id = c.string("id") ?: return null,
                amount = c.string("amount") ?: return null,
                method = c.string("method") ?: return null,
                reference = c.string("reference") ?: return null,
            )
        }
    }
}

/** "Deliver this", as typed (DeliveryFields). The expected date is "yyyy-MM-dd" or blank. */
data class SaleDelivery(
    var required: Boolean = false,
    var address: String = "",
    var city: String = "",
    var expectedDate: String = "",
    var contactName: String = "",
    var contactPhone: String = "",
    var charge: String = "",
    var notes: String = "",
) {
    /**
     * What the ERP records: only when the piece is going out with an address (create-invoice.ts keeps `delivery` only
     * then), and only the fields filled in.
     */
    val payload: MutableMap<String, Any?>?
        get() {
            val place = swiftTrimNewlines(address)
            if (!required || place.isEmpty()) return null
            val o = LinkedHashMap<String, Any?>()
            o["required"] = true
            o["address"] = place
            fun put(key: String, value: String) {
                val t = swiftTrimNewlines(value)
                if (t.isNotEmpty()) o[key] = t
            }
            put("city", city)
            put("expectedDate", expectedDate)
            put("contactName", contactName)
            put("contactPhone", contactPhone)
            put("notes", notes)
            val v = SaleNumber.parse(charge)
            if (v != null && v > 0) o["charge"] = v
            return o
        }

    val isBlank: Boolean
        get() = !required && address.isEmpty() && city.isEmpty() && expectedDate.isEmpty() && contactName.isEmpty() &&
            contactPhone.isEmpty() && charge.isEmpty() && notes.isEmpty()

    fun toMap(): Map<String, Any?> = linkedMapOf(
        "required" to required, "address" to address, "city" to city, "expectedDate" to expectedDate,
        "contactName" to contactName, "contactPhone" to contactPhone, "charge" to charge, "notes" to notes,
    )

    companion object {
        fun fromMap(m: Map<String, Any?>): SaleDelivery {
            val c = DraftReader(m)
            return SaleDelivery(
                required = c.bool("required", false),
                address = c.string("address", ""),
                city = c.string("city", ""),
                expectedDate = c.string("expectedDate", ""),
                contactName = c.string("contactName", ""),
                contactPhone = c.string("contactPhone", ""),
                charge = c.string("charge", ""),
                notes = c.string("notes", ""),
            )
        }
    }
}

// The draft

/** The whole sale in progress. Everything a person types is text here, as in the web's form. */
class SaleDraft(
    var lines: MutableList<SaleLine> = mutableListOf(),
    /** The customer picked from the book; typing a different name lets go of it, as the web's box does. */
    var customerId: String? = null,
    var customerName: String = "",
    var customerPhone: String = "",
    /** Rate boxes typed in this sale, by `RateInputKey` name. A box not here follows today's rate. */
    var rates: MutableMap<String, String> = LinkedHashMap(),
    var discount: String = "",
    var exchanges: MutableList<SaleExchangeRow> = mutableListOf(SaleExchangeRow.blank()),
    var payments: MutableList<SalePaymentRow> = mutableListOf(SalePaymentRow()),
    var takenBy: String = "",
    var hideRates: Boolean = false,
    var internalNote: String = "",
    /** The 24k rate for the shop's margin, typed per tola the way the bazaar quotes it. */
    var costTola: String = "",
    var delivery: SaleDelivery = SaleDelivery(),
) {
    /** A copy that shares nothing with this one (Swift's struct copy). */
    fun copy(): SaleDraft = SaleDraft(
        lines.map { it.copy() }.toMutableList(), customerId, customerName, customerPhone, LinkedHashMap(rates), discount,
        exchanges.toMutableList(), payments.map { it.copy() }.toMutableList(), takenBy, hideRates, internalNote, costTola,
        delivery.copy(),
    )

    /**
     * Nothing worth keeping: a blank sale is not stored. Taken by alone does not count: it only starts on the
     * signed-in person (the web's drafts ignore their default fields too, SALE_DEFAULT_FIELDS).
     */
    val isBlank: Boolean
        get() {
            val blank = { s: String -> swiftTrimNewlines(s).isEmpty() }
            return lines.isEmpty() && customerId == null && blank(customerName) && blank(customerPhone) &&
                rates.isEmpty() && blank(discount) && exchanges.all { it.isBlank } &&
                payments.all { blank(it.amount) && blank(it.reference) } &&
                !hideRates && blank(internalNote) && blank(costTola) && delivery.isBlank
        }

    // What the screen does to the draft
    //
    // The draft's changes, as the screen makes them (pure, so the contract tests build a sale the way the screen does
    // and not by hand).

    /** A customer picked from the book, or null for a walk-in. A customer with no number keeps the one typed. */
    fun pick(c: Customer?) {
        if (c == null) {
            customerId = null
            customerName = ""
            customerPhone = ""
            return
        }
        customerId = c.id
        customerName = c.name
        val p = c.phone
        if (!p.isNullOrEmpty()) customerPhone = p
    }

    /** Typing a name lets go of a customer picked from the book, as the web's name box does. */
    fun typeName(text: String) {
        if (text == customerName) return
        customerName = text
        customerId = null
    }

    /** A change to one exchange row: the rules' rule (grams × rate refills the amount until one is typed). */
    fun changeExchange(id: String, patch: ExchangeRowPatch) {
        val i = exchanges.indexOfFirst { it.id == id }
        if (i < 0) return
        exchanges[i] = SaleExchangeRow(applyExchangeRowChange(exchanges[i].core, patch))
    }

    fun addExchange() {
        exchanges.add(SaleExchangeRow.blank())
    }

    fun removeExchange(id: String) {
        exchanges.removeAll { it.id == id }
        if (exchanges.isEmpty()) exchanges = mutableListOf(SaleExchangeRow.blank())
    }

    /** Another payment row: the other method from the last one, as the web offers. */
    fun addPayment() {
        payments.add(SalePaymentRow(method = if (payments.lastOrNull()?.method == "Cash") "Card" else "Cash"))
    }

    fun removePayment(id: String) {
        payments.removeAll { it.id == id }
        if (payments.isEmpty()) payments = mutableListOf(SalePaymentRow())
    }

    /**
     * "Paid in full" / "The rest": the row takes whatever the other rows leave outstanding of `total`, in whole rupees
     * (sale-page.tsx `payRestWith`).
     */
    fun payRest(id: String, total: Double) {
        val others = payments.filter { it.id != id }.fold(0.0) { acc, p -> acc + rupees(SaleNumber.value(p.amount)) }
        val rest = smax(0.0, swiftRounded(total - others))
        val i = payments.indexOfFirst { it.id == id }
        if (i >= 0) payments[i].amount = if (rest > 0) rest.toLong().toString() else ""
    }

    /** Puts a piece on the unfinished sale. False when it is already there (SaleDraftStore.add, on the draft in hand). */
    fun add(product: Product): Boolean {
        if (lines.any { it.sku == product.sku }) return false
        lines.add(SaleLine.fromProduct(product))
        return true
    }

    /** The draft as the phone stores it (Codable's keys). */
    fun toMap(): Map<String, Any?> {
        val o = LinkedHashMap<String, Any?>()
        o["lines"] = lines.map { it.toMap() }
        customerId?.let { o["customerId"] = it }
        o["customerName"] = customerName
        o["customerPhone"] = customerPhone
        o["rates"] = LinkedHashMap(rates)
        o["discount"] = discount
        o["exchanges"] = exchanges.map { it.toMap() }
        o["payments"] = payments.map { it.toMap() }
        o["takenBy"] = takenBy
        o["hideRates"] = hideRates
        o["internalNote"] = internalNote
        o["costTola"] = costTola
        o["delivery"] = delivery.toMap()
        return o
    }

    companion object {
        /** A saved draft must open after an update that added a field: whatever is missing or odd takes its default. */
        fun fromMap(m: Map<String, Any?>): SaleDraft {
            val c = DraftReader(m)
            val ex = c.list("exchanges", emptyList()) { SaleExchangeRow.fromMap(it) }
            val pay = c.list("payments", emptyList()) { SalePaymentRow.fromMap(it) }
            return SaleDraft(
                lines = c.list("lines", emptyList()) { SaleLine.fromMap(it) }.toMutableList(),
                customerId = c.string("customerId"),
                customerName = c.string("customerName", ""),
                customerPhone = c.string("customerPhone", ""),
                rates = LinkedHashMap(c.stringMap("rates", emptyMap())),
                discount = c.string("discount", ""),
                exchanges = if (ex.isEmpty()) mutableListOf(SaleExchangeRow.blank()) else ex.toMutableList(),
                payments = if (pay.isEmpty()) mutableListOf(SalePaymentRow()) else pay.toMutableList(),
                takenBy = c.string("takenBy", ""),
                hideRates = c.bool("hideRates", false),
                internalNote = c.string("internalNote", ""),
                costTola = c.string("costTola", ""),
                delivery = c.obj("delivery")?.let { SaleDelivery.fromMap(it) } ?: SaleDelivery(),
            )
        }
    }
}

/**
 * The phone's own unfinished sale ("erp.saleDraft") as text; where it is kept is the app's business. A blank sale is
 * not stored (remove what is there).
 */
object SaleDraftStore {
    const val key = "erp.saleDraft"

    /** The draft kept as that text; null for text that is not a draft. */
    fun decode(text: String): SaleDraft? {
        @Suppress("UNCHECKED_CAST")
        val map = Json.parse(text) as? Map<String, Any?> ?: return null
        return SaleDraft.fromMap(map)
    }

    /** The text to keep, or null when nothing should be kept (a blank sale). */
    fun encode(draft: SaleDraft): String? = if (draft.isBlank) null else EntryJson.write(draft.toMap())
}

/**
 * Everything the line editor edits, held as text so the fields stay editable (the web's `Draft` in
 * edit-cart-item-dialog.tsx), and the line with those edits applied (its `toPatch`). Pure, so the contract tests edit
 * a sale's lines through the very code the sheet runs.
 */
class SaleLineFields(l: SaleLine) {
    var name: String = l.name
    var categoryId: String = l.categoryId
    var size: String = l.size ?: ""
    var metalType: String = l.metalType
    var karat: String = l.karat ?: ""
    var weight: String = SaleNumber.text(l.metalWeightG)

    // The reveal opens whenever there is stone or diamond data to show, so a figure that is in the price can never sit
    // behind a closed switch.
    var hasStones: Boolean = l.hasStones || l.stoneWeightG > 0 || (l.stoneDetails ?: "").isNotEmpty()
    var stoneWeight: String = SaleNumber.text(l.stoneWeightG)
    var wastage: String = SaleNumber.text(l.wastagePercentage)
    var making: String = SaleNumber.text(l.makingCharges)
    var hasDiamonds: Boolean = l.hasDiamonds || l.diamondCharges > 0 || (l.diamondDetails ?: "").isNotEmpty()
    var diamondCharges: String = SaleNumber.text(l.diamondCharges)
    var stoneCharges: String = SaleNumber.text(l.stoneCharges)
    var miscCharges: String = SaleNumber.text(l.miscCharges)
    var stoneDetails: String = l.stoneDetails ?: ""
    var diamondDetails: String = l.diamondDetails ?: ""
    var billDescription: String = l.billDescription ?: ""
    var platingType: String = l.platingType ?: ""
    var platingNote: String = l.platingNote ?: ""
    var nickelFree: Boolean = l.nickelFree
    var silverRate: String = SaleNumber.text(l.silverRatePerGram)
    var fixed: Boolean = l.isCustomPrice
    var customPrice: String = SaleNumber.text(l.customPrice)

    private fun nilIfBlank(s: String): String? {
        val t = swiftTrimNewlines(s)
        return if (t.isEmpty()) null else t
    }

    /** The line with these edits (the web's `toPatch`). */
    fun applied(base: SaleLine): SaleLine {
        val out = base.copy()
        val silver = metalType == "silver"
        out.name = swiftTrimNewlines(name)
        out.categoryId = categoryId
        out.size = nilIfBlank(size)
        out.metalType = metalType
        // Karat only means something where the metal has one: a stray "21k" on silver is the phantom karat that used to print on 925 pieces.
        out.karat = if (metalHasKarat(metalType) && karat.isNotEmpty()) karat else null
        out.metalWeightG = SaleNumber.value(weight)
        out.hasStones = hasStones
        out.stoneWeightG = SaleNumber.value(stoneWeight)
        out.wastagePercentage = SaleNumber.value(wastage)
        out.makingCharges = SaleNumber.value(making)
        out.hasDiamonds = hasDiamonds
        out.diamondCharges = SaleNumber.value(diamondCharges)
        out.stoneCharges = SaleNumber.value(stoneCharges)
        out.miscCharges = SaleNumber.value(miscCharges)
        out.stoneDetails = nilIfBlank(stoneDetails)
        out.diamondDetails = nilIfBlank(diamondDetails)
        out.billDescription = nilIfBlank(billDescription)
        out.platingType = if (silver && platingType.isNotEmpty()) platingType else null
        out.platingNote = if (silver && platingType == "Other") nilIfBlank(platingNote) else null
        out.nickelFree = if (silver) nickelFree else false
        val rate = SaleNumber.value(silverRate)
        out.silverRatePerGram = if (silver && rate > 0) rate else null
        out.isCustomPrice = fixed
        out.customPrice = if (fixed) SaleNumber.value(customPrice) else null
        return out
    }
}

// Lists the sale offers

/** units.ts `GRAMS_PER_TOLA`: the figure the trade uses here. */
const val SALE_GRAMS_PER_TOLA: Double = gramsPerTola
