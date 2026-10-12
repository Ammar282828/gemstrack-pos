package erp.core.entry

import erp.core.Json
import erp.core.logic.DEFAULT_PROMISE_DAYS
import erp.core.logic.ExchangeRow
import erp.core.logic.ExchangeRowPatch
import erp.core.logic.applyExchangeRowChange
import erp.core.logic.blankExchangeRow
import erp.core.logic.karatsFor
import erp.core.logic.newExchangeRowId
import erp.core.models.Customer
import erp.core.models.MetalType
import erp.core.models.Settings
import java.util.UUID

// The order in progress, as the phone keeps it. The web keeps an unfinished order in Firestore (Drafts,
// decisions.md "Drafts") so it can be finished on another device; the phone keeps its own copy, so closing the
// screen, or the app, loses nothing, and sends the same to Drafts (NewOrderWebDraft). Nothing here decides money:
// prices and totals come from the rules (NewOrderMath), and the order is built exactly as the web's order form
// builds it.
//
// Numbers stay text while they are typed (a box holding "5." must stay "5."). Words (metal, karat, source) stay
// the ERP's own words so the draft is plain JSON. (NewOrderDraft.swift.)

// One piece

class NewOrderPieceDraft(
    var id: UUID = UUID.randomUUID(),
    /** A category id ("cat001"), or "" for none. */
    var category: String = "",
    var description: String = "",
    /** "gold", "palladium", "platinum" or "silver": a new piece starts on the house's own metal. */
    var metal: String = EntryHouse.metal,
    var karat: String = "21k",
    var weight: String = "",
    /** A new piece is priced from the rate with stones counted: that is almost every piece here. */
    var hasStones: Boolean = true,
    var stoneWeight: String = "",
    var stoneDetails: String = "",
    var hasDiamonds: Boolean = false,
    var diamond: String = "",
    var diamondDetails: String = "",
    /** The percentage; the grams are worked out beside it (OrderFinalize). */
    var wastage: String = "10",
    var making: String = "",
    var stones: String = "",
    var size: String = "",
    var platingType: String = "",
    var platingNote: String = "",
    var nickelFree: Boolean = false,
    var karigarId: String = "",
    var referenceSku: String = "",
    var sampleGiven: Boolean = false,
    var isCompleted: Boolean = false,
    var samplePhotoId: String? = null,
    var sampleImageDataUri: String? = null,
    var removePhoto: Boolean = false,
    /** Fixed price instead of weight × rate (the web's `isManualPrice`). */
    var manual: Boolean = false,
    var manualPrice: String = "",
    /** Written by owners and staff; the ERP gives it back to owners only (roles.ts STAFF_HIDDEN_FIELDS). */
    var adminNote: String = "",
    /** The sample picture, JPEG, at most about 120 KB (NewOrderPhotoCodec). */
    var photo: ByteArray? = null,
) {
    /** A copy of this piece (Swift's struct copy), with its own id unless kept. */
    fun copy(): NewOrderPieceDraft = NewOrderPieceDraft(
        id, category, description, metal, karat, weight, hasStones, stoneWeight, stoneDetails, hasDiamonds, diamond,
        diamondDetails, wastage, making, stones, size, platingType, platingNote, nickelFree, karigarId, referenceSku,
        sampleGiven, isCompleted, samplePhotoId, sampleImageDataUri, removePhoto, manual, manualPrice, adminNote,
        photo?.copyOf(),
    )

    /**
     * The weight as typed, and the stones' weight while its box is ticked (a figure left in an unticked box is not in
     * the price). Pricing, the wastage grams and the payload all read these two.
     */
    val weightValue: Double get() = NewOrderFormat.num(weight)
    val stoneWeightValue: Double get() = if (hasStones) NewOrderFormat.num(stoneWeight) else 0.0

    /** Changing the metal moves the karat onto one that metal is sold in (24k palladium cannot be chosen). */
    @JvmName("changeMetal")
    fun setMetal(next: String) {
        metal = next
        val options = karatsFor(MetalType.of(next)).map { it.rawValue }
        if (options.isNotEmpty() && !options.contains(karat)) {
            karat = if (options.contains("21k")) "21k" else (options.lastOrNull() ?: "")
        }
    }

    /** The piece as the phone stores it (Codable's keys). */
    fun toMap(): Map<String, Any?> {
        val o = LinkedHashMap<String, Any?>()
        o["id"] = id.toString().uppercase()
        o["category"] = category
        o["description"] = description
        o["metal"] = metal
        o["karat"] = karat
        o["weight"] = weight
        o["hasStones"] = hasStones
        o["stoneWeight"] = stoneWeight
        o["stoneDetails"] = stoneDetails
        o["hasDiamonds"] = hasDiamonds
        o["diamond"] = diamond
        o["diamondDetails"] = diamondDetails
        o["wastage"] = wastage
        o["making"] = making
        o["stones"] = stones
        o["size"] = size
        o["platingType"] = platingType
        o["platingNote"] = platingNote
        o["nickelFree"] = nickelFree
        o["karigarId"] = karigarId
        o["referenceSku"] = referenceSku
        o["sampleGiven"] = sampleGiven
        o["isCompleted"] = isCompleted
        samplePhotoId?.let { o["samplePhotoId"] = it }
        sampleImageDataUri?.let { o["sampleImageDataUri"] = it }
        o["removePhoto"] = removePhoto
        o["manual"] = manual
        o["manualPrice"] = manualPrice
        o["adminNote"] = adminNote
        photo?.let { o["photo"] = base64(it) }
        return o
    }

    companion object {
        /**
         * A saved draft must open after an update that added a field: whatever is missing or odd takes its default
         * instead of throwing the whole order away.
         */
        fun fromMap(m: Map<String, Any?>): NewOrderPieceDraft {
            val c = DraftReader(m)
            return NewOrderPieceDraft(
                id = c.string("id")?.let { runCatching { UUID.fromString(it) }.getOrNull() } ?: UUID.randomUUID(),
                category = c.string("category", ""),
                description = c.string("description", ""),
                metal = c.string("metal", EntryHouse.metal),
                karat = c.string("karat", "21k"),
                weight = c.string("weight", ""),
                hasStones = c.bool("hasStones", true),
                stoneWeight = c.string("stoneWeight", ""),
                stoneDetails = c.string("stoneDetails", ""),
                hasDiamonds = c.bool("hasDiamonds", false),
                diamond = c.string("diamond", ""),
                diamondDetails = c.string("diamondDetails", ""),
                wastage = c.string("wastage", "10"),
                making = c.string("making", ""),
                stones = c.string("stones", ""),
                size = c.string("size", ""),
                platingType = c.string("platingType", ""),
                platingNote = c.string("platingNote", ""),
                nickelFree = c.bool("nickelFree", false),
                karigarId = c.string("karigarId", ""),
                referenceSku = c.string("referenceSku", ""),
                sampleGiven = c.bool("sampleGiven", false),
                isCompleted = c.bool("isCompleted", false),
                samplePhotoId = c.string("samplePhotoId"),
                sampleImageDataUri = c.string("sampleImageDataUri"),
                removePhoto = c.bool("removePhoto", false),
                manual = c.bool("manual", false),
                manualPrice = c.string("manualPrice", ""),
                adminNote = c.string("adminNote", ""),
                photo = c.bytes("photo"),
            )
        }
    }
}

// One exchange row

/** The rules' `ExchangeRow` as plain data the draft can keep. */
data class NewOrderExchangeDraft(
    val id: String,
    val description: String,
    val karat: String,
    val weightG: String,
    val ratePerGram: String,
    val value: String,
    val valueTyped: Boolean,
) {
    constructor(r: ExchangeRow) : this(r.id, r.description, r.karat, r.weightG, r.ratePerGram, r.value, r.valueTyped)

    val row: ExchangeRow
        get() = ExchangeRow(id = id, description = description, karat = karat, weightG = weightG, ratePerGram = ratePerGram, value = value, valueTyped = valueTyped)

    val isBlank: Boolean get() = description.isEmpty() && karat.isEmpty() && weightG.isEmpty() && ratePerGram.isEmpty() && value.isEmpty()

    fun toMap(): Map<String, Any?> = linkedMapOf(
        "id" to id, "description" to description, "karat" to karat, "weightG" to weightG,
        "ratePerGram" to ratePerGram, "value" to value, "valueTyped" to valueTyped,
    )

    companion object {
        fun blank(): NewOrderExchangeDraft = NewOrderExchangeDraft(blankExchangeRow())

        fun fromMap(m: Map<String, Any?>): NewOrderExchangeDraft {
            val c = DraftReader(m)
            return NewOrderExchangeDraft(
                id = c.string("id") ?: newExchangeRowId(),
                description = c.string("description", ""),
                karat = c.string("karat", ""),
                weightG = c.string("weightG", ""),
                ratePerGram = c.string("ratePerGram", ""),
                value = c.string("value", ""),
                valueTyped = c.bool("valueTyped", false),
            )
        }
    }
}

// The whole order

class NewOrderDraft(
    /** A customer picked from the book; "" when a name is being typed or none is given (a walk-in). */
    var customerId: String = "",
    var customerName: String = "",
    var customerPhone: String = "",
    /** A `CUSTOMER_SOURCES` word, or "" for not specified. */
    var source: String = "",
    var takenBy: String = "",
    /**
     * What "Taken by" was started on (the signed-in person), once; null until it has been. A name that is only this
     * default is not something typed, so it does not make the order worth keeping.
     */
    var takenByDefault: String? = null,
    /** yyyy-MM-dd in Karachi, or "" for no date. */
    var promised: String = "",
    var notes: String = "",
    var hideRates: Boolean = false,
    var pieces: MutableList<NewOrderPieceDraft> = mutableListOf(),
    /** The rates this order is priced at, by `RateKey` word, as typed. Seeded from today's once; a draft that is continued keeps the rates it was quoted at. */
    var rates: MutableMap<String, String> = LinkedHashMap(),
    var ratesSeeded: Boolean = false,
    var discount: String = "",
    var advance: String = "",
    /** A `PAYMENT_TYPES` word, or "" for not recorded. */
    var advanceMethod: String = "Cash",
    var exchanges: MutableList<NewOrderExchangeDraft> = mutableListOf(),
    var deliver: Boolean = false,
    var deliveryAddress: String = "",
    var deliveryCity: String = "",
    var deliveryName: String = "",
    var deliveryPhone: String = "",
    var deliveryNotes: String = "",
    var deliveryCharge: String = "",
    var deliveryExpected: String = "",
    /** The 24k rate now, per tola, for the shop's margin (owners and staff). */
    var costTola: String = "",
    /** The photos were too many to keep on the phone with the rest. */
    var photosLeftOut: Boolean = false,
    /**
     * The pieces came from the sale in progress ("Create order" on New sale); once this order is saved the sale's own
     * copy goes (the web clears the cart: leaving them behind would bill the same pieces twice).
     */
    var fromSale: Boolean = false,
) {
    /** A copy that shares nothing with this one (Swift's struct copy). */
    fun copy(): NewOrderDraft = NewOrderDraft(
        customerId, customerName, customerPhone, source, takenBy, takenByDefault, promised, notes, hideRates,
        pieces.map { it.copy() }.toMutableList(), LinkedHashMap(rates), ratesSeeded, discount, advance, advanceMethod,
        exchanges.toMutableList(), deliver, deliveryAddress, deliveryCity, deliveryName, deliveryPhone, deliveryNotes,
        deliveryCharge, deliveryExpected, costTola, photosLeftOut, fromSale,
    )

    /** Nothing typed yet: not worth keeping on the phone (the rates and the date are not typing). */
    val isBlank: Boolean
        get() {
            if (pieces.isNotEmpty() || deliver || hideRates) return false
            if (NewOrderFormat.trim(customerName).isNotEmpty() || customerPhone.isNotEmpty()) return false
            if (source.isNotEmpty() || notes.isNotEmpty()) return false
            if (takenBy.isNotEmpty() && takenBy != takenByDefault) return false
            if (discount.isNotEmpty() || advance.isNotEmpty() || costTola.isNotEmpty()) return false
            return exchanges.all { it.isBlank }
        }

    // What the form does to the draft
    //
    // These are what the form's controls do, kept here and not in the views so the contract cases
    // (core's erp.core.contract) fill a draft through the very same code the screen runs.

    /** The rates start as today's, once; a draft that is continued keeps the rates it was quoted at. */
    fun seedRates(settings: Settings) {
        rates = LinkedHashMap(NewOrderMath.todaysRates(settings))
        ratesSeeded = true
    }

    /** Typing makes it a new customer again (the web's autocomplete does the same): only a pick from the list is a customer on file. */
    fun typeCustomerName(typed: String) {
        if (typed == customerName) return
        customerName = typed
        customerId = ""
    }

    /** A pick from the list: their name and number, and the order's source starts as theirs if none was chosen. */
    fun choose(c: Customer) {
        customerName = c.name
        customerId = c.id
        val phone = c.phone
        if (!phone.isNullOrEmpty()) customerPhone = phone
        val s = c.source
        if (source.isEmpty() && s != null) source = s.rawValue
    }

    /** A change to one exchange row; grams × rate refills the amount unless it was typed. */
    fun patchExchange(id: String, patch: ExchangeRowPatch) {
        exchanges = exchanges.map { x -> if (x.id == id) NewOrderExchangeDraft(applyExchangeRowChange(x.row, patch)) else x }.toMutableList()
    }

    /**
     * "Taken by" starts on the signed-in person, once, for a new order (decisions.md "Signed-in defaults";
     * order-form.tsx `takenBy: me`): only a default, always shown and changeable. It is a name from the house's list,
     * and a name that is not on the list (an old draft's free text) is let go when the house has a list.
     */
    fun settleTakenBy(person: String?, list: List<String>) {
        if (list.isNotEmpty() && takenBy.isNotEmpty() && !list.contains(takenBy)) takenBy = ""
        if (takenByDefault != null) return
        var name = NewOrderFormat.trim(person ?: "")
        if (list.isNotEmpty() && !list.contains(name)) name = ""
        takenByDefault = name
        if (takenBy.isEmpty()) takenBy = name
    }

    fun duplicatePiece(id: UUID) {
        val i = pieces.indexOfFirst { it.id == id }
        if (i < 0) return
        val copy = pieces[i].copy()
        copy.id = UUID.randomUUID()
        pieces.add(i + 1, copy)
    }

    /** The draft as the phone stores it (Codable's keys). */
    fun toMap(): Map<String, Any?> {
        val o = LinkedHashMap<String, Any?>()
        o["customerId"] = customerId
        o["customerName"] = customerName
        o["customerPhone"] = customerPhone
        o["source"] = source
        o["takenBy"] = takenBy
        takenByDefault?.let { o["takenByDefault"] = it }
        o["promised"] = promised
        o["notes"] = notes
        o["hideRates"] = hideRates
        o["pieces"] = pieces.map { it.toMap() }
        o["rates"] = LinkedHashMap(rates)
        o["ratesSeeded"] = ratesSeeded
        o["discount"] = discount
        o["advance"] = advance
        o["advanceMethod"] = advanceMethod
        o["exchanges"] = exchanges.map { it.toMap() }
        o["deliver"] = deliver
        o["deliveryAddress"] = deliveryAddress
        o["deliveryCity"] = deliveryCity
        o["deliveryName"] = deliveryName
        o["deliveryPhone"] = deliveryPhone
        o["deliveryNotes"] = deliveryNotes
        o["deliveryCharge"] = deliveryCharge
        o["deliveryExpected"] = deliveryExpected
        o["costTola"] = costTola
        o["photosLeftOut"] = photosLeftOut
        o["fromSale"] = fromSale
        return o
    }

    companion object {
        /**
         * A new order: fourteen days unless something else is agreed (DEFAULT_PROMISE_DAYS: blank meant the order was
         * only chased once it was a week old), one empty exchange row, the advance in cash.
         */
        fun fresh(): NewOrderDraft {
            val d = NewOrderDraft()
            d.promised = NewOrderDay.after(DEFAULT_PROMISE_DAYS)
            d.exchanges = mutableListOf(NewOrderExchangeDraft.blank())
            return d
        }

        /** A saved draft must open after an update that added a field: whatever is missing or odd takes its default. */
        fun fromMap(m: Map<String, Any?>): NewOrderDraft {
            val c = DraftReader(m)
            val d = NewOrderDraft(
                customerId = c.string("customerId", ""),
                customerName = c.string("customerName", ""),
                customerPhone = c.string("customerPhone", ""),
                source = c.string("source", ""),
                takenBy = c.string("takenBy", ""),
                takenByDefault = c.string("takenByDefault"),
                promised = c.string("promised", ""),
                notes = c.string("notes", ""),
                hideRates = c.bool("hideRates", false),
                pieces = c.list("pieces", emptyList()) { NewOrderPieceDraft.fromMap(it) }.toMutableList(),
                rates = LinkedHashMap(c.stringMap("rates", emptyMap())),
                ratesSeeded = c.bool("ratesSeeded", false),
                discount = c.string("discount", ""),
                advance = c.string("advance", ""),
                advanceMethod = c.string("advanceMethod", "Cash"),
                exchanges = c.list("exchanges", emptyList()) { NewOrderExchangeDraft.fromMap(it) }.toMutableList(),
                deliver = c.bool("deliver", false),
                deliveryAddress = c.string("deliveryAddress", ""),
                deliveryCity = c.string("deliveryCity", ""),
                deliveryName = c.string("deliveryName", ""),
                deliveryPhone = c.string("deliveryPhone", ""),
                deliveryNotes = c.string("deliveryNotes", ""),
                deliveryCharge = c.string("deliveryCharge", ""),
                deliveryExpected = c.string("deliveryExpected", ""),
                costTola = c.string("costTola", ""),
                photosLeftOut = c.bool("photosLeftOut", false),
                fromSale = c.bool("fromSale", false),
            )
            if (d.exchanges.isEmpty()) d.exchanges = mutableListOf(NewOrderExchangeDraft.blank())
            return d
        }

        /** A new order from the sale in progress: its pieces and its customer, marked as from the sale. */
        fun seeded(sale: SaleDraft): NewOrderDraft {
            val d = fresh()
            d.pieces = sale.lines.map { NewOrderPieceDraft.fromSale(it) }.toMutableList()
            d.customerId = sale.customerId ?: ""
            d.customerName = sale.customerName
            d.customerPhone = sale.customerPhone
            d.fromSale = true
            return d
        }
    }
}

// From a sale

// "Create order" on the sale sends the same basket to the bench instead of the till (sale-page.tsx:
// /orders/add?fromCart=1; order-form.tsx `cartItemToOrderItem`): the pieces become the order's pieces, and the
// person it is for comes with them. What stays with the sale is the sale's own: its discount, exchange, payments,
// typed rates and notes (the web carries none of them either), and the piece's picture and miscellaneous charge,
// which an order has no place for.

/**
 * A line of the sale as a piece of the order. A fixed price keeps its weight. A piece described for one bill
 * (NEW-…) has no stock number, so it is no reference (lib/sku.ts stockSku). Palladium keeps its karat, which the
 * web's seed drops (and then prices at the flat rate).
 */
fun NewOrderPieceDraft.Companion.fromSale(line: SaleLine): NewOrderPieceDraft {
    val p = NewOrderPieceDraft()
    p.category = line.categoryId
    p.description = line.name
    p.metal = if (line.metalType.isEmpty()) EntryHouse.metal else line.metalType
    val karats = karatsFor(MetalType.of(p.metal)).map { it.rawValue }
    if (karats.isNotEmpty()) {
        val kept = line.karat ?: ""
        p.karat = if (karats.contains(kept)) kept else (if (p.metal == "gold") "21k" else (karats.lastOrNull() ?: ""))
    }
    p.weight = NewOrderFormat.boxText(line.metalWeightG, digits = 3)
    p.hasStones = line.hasStones
    p.stoneWeight = NewOrderFormat.boxText(line.stoneWeightG, digits = 3)
    p.stoneDetails = line.stoneDetails ?: ""
    p.hasDiamonds = line.hasDiamonds
    p.diamond = NewOrderFormat.boxText(line.diamondCharges)
    p.diamondDetails = line.diamondDetails ?: ""
    p.wastage = NewOrderFormat.boxText(line.wastagePercentage, digits = 4)
    p.making = NewOrderFormat.boxText(line.makingCharges)
    p.stones = NewOrderFormat.boxText(line.stoneCharges)
    p.size = line.size ?: ""
    p.platingType = line.platingType ?: ""
    p.platingNote = line.platingNote ?: ""
    p.nickelFree = line.nickelFree
    p.referenceSku = line.stockSku ?: ""
    p.sampleImageDataUri = line.imageUrl
    p.manual = line.isCustomPrice
    p.manualPrice = if (line.isCustomPrice) NewOrderFormat.boxText(line.customPrice ?: 0.0) else ""
    return p
}

// On the phone

/**
 * The phone's copy of the order in progress, as text: where it is kept ("erp.orderDraft" on the iPhone, a
 * preference or a file here) is the app's business. A blank order is not stored at all, and one over the ceiling
 * is stored without its photos, so the rest of the order is always kept. (NewOrderDraftStore.)
 */
object NewOrderDraftStore {
    const val key = "erp.orderDraft"

    /** More than this and the photos are left out, so the rest of the order is always kept. */
    private const val ceiling = 3_000_000

    /** The text to keep, or null when nothing should be kept (a blank order: remove what is there). */
    fun encode(draft: NewOrderDraft): String? {
        if (draft.isBlank) return null
        var text = EntryJson.write(draft.toMap())
        if (text.toByteArray(Charsets.UTF_8).size > ceiling) {
            val lite = draft.copy()
            lite.pieces.forEach { it.photo = null }
            lite.photosLeftOut = true
            text = EntryJson.write(lite.toMap())
        }
        return text
    }

    /** The draft kept as that text; null for text that is not a draft or one that is blank. */
    fun decode(text: String): NewOrderDraft? {
        @Suppress("UNCHECKED_CAST")
        val map = Json.parse(text) as? Map<String, Any?> ?: return null
        val draft = NewOrderDraft.fromMap(map)
        return if (draft.isBlank) null else draft
    }

    /** Seeds the phone's order draft from the sale (the New order screen takes it back as it opens): the text to keep. */
    fun startFromSale(sale: SaleDraft): String? = encode(NewOrderDraft.seeded(sale))

    /** An order of its own is half typed on this phone (not one already made from a sale), given what is kept. */
    fun orderInProgress(kept: String?): Boolean {
        val d = kept?.let { decode(it) } ?: return false
        return !d.fromSale
    }
}
