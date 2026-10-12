package erp.core.entry

import erp.core.Container
import erp.core.Decodable
import erp.core.Json
import erp.core.logic.ExchangeRowPatch
import erp.core.logic.JS
import erp.core.logic.Money
import erp.core.logic.RateKey
import erp.core.logic.blankExchangeRow
import erp.core.models.Customer
import erp.core.models.Karigar
import erp.core.models.Settings
import erp.core.swiftDescription
import java.math.BigDecimal
import java.math.RoundingMode
import kotlin.math.abs

// Read a slip: what the ERP's reader (/api/vision/order, the same route the browser's "Scan a parchi" calls) read
// off a parchi, and that reading laid into the order form. Ported from lib/vision/order-draft.ts (the slip's own
// arithmetic, `reconcileSlip`), lib/vision/wastage.ts (wastage in grams as the percent the ERP prices with) and
// order-form.tsx `applyScan` (what lands in which box), line for line. (NewOrderScanSlip.swift.)
//
// It fills the form and stops. Nothing is saved here: every figure lands as an ordinary, editable field, the pieces
// are added to whatever the order already has, and the person checks them against the paper and presses Save. The
// slip's own totals are never copied in as prices; they are checked against the reading, and a slip that does not
// add up is shown, never corrected.

// What the reader answers

/** One piece written on the slip (order-draft.ts `DraftItem`). Every field may be missing: the reader is told to leave a figure out rather than guess it. */
data class NewOrderScanItem(
    var description: String? = null,
    /** The reader's word for it ("Ring", "Chain": `ORDER_CATEGORIES`), not a category id. */
    var itemCategory: String? = null,
    var metalType: String? = null,
    var karat: Double? = null,
    /** Grams, as weighed: before any stone weight comes off. */
    var weightG: Double? = null,
    var weightWasTola: Boolean? = null,
    var stoneWeightG: Double? = null,
    var wastageG: Double? = null,
    /** The piece's whole making, in rupees (multiplied out when the slip wrote it per gram). */
    var makingCharges: Double? = null,
    var makingWasPerGram: Boolean? = null,
    var stoneCharges: Double? = null,
    /** The slip's metal rate for this piece, per gram (converted when written per tola). */
    var ratePerGram: Double? = null,
    var rateWasPerTola: Boolean? = null,
    var wastagePercent: Double? = null,
    /** The amount written against the piece: copied, never computed. */
    var lineTotal: Double? = null,
    var size: String? = null,
    var stoneDetails: String? = null,
    /** 1-based: which photo is a picture of this piece, when one is. */
    var photoIndex: Double? = null,
    var note: String? = null,
) {
    companion object : Decodable<NewOrderScanItem> {
        override fun fromMap(m: Map<String, Any?>): NewOrderScanItem {
            val c = Container(m)
            return NewOrderScanItem(
                description = c.string("description"),
                itemCategory = c.string("itemCategory"),
                metalType = c.string("metalType"),
                karat = c.double("karat"),
                weightG = c.double("weightG"),
                weightWasTola = c.bool("weightWasTola"),
                stoneWeightG = c.double("stoneWeightG"),
                wastageG = c.double("wastageG"),
                makingCharges = c.double("makingCharges"),
                makingWasPerGram = c.bool("makingWasPerGram"),
                stoneCharges = c.double("stoneCharges"),
                ratePerGram = c.double("ratePerGram"),
                rateWasPerTola = c.bool("rateWasPerTola"),
                wastagePercent = c.double("wastagePercent"),
                lineTotal = c.double("lineTotal"),
                size = c.string("size"),
                stoneDetails = c.string("stoneDetails"),
                photoIndex = c.double("photoIndex"),
                note = c.string("note"),
            )
        }
    }
}

/** Old gold or jewellery handed over against the order (`DraftExchange`). */
data class NewOrderScanExchange(
    var description: String? = null,
    var weightG: Double? = null,
    var weightWasTola: Boolean? = null,
    var karat: Double? = null,
    /** The rate written against the OLD gold, per gram: often below the day's. */
    var ratePerGram: Double? = null,
    var rateWasPerTola: Boolean? = null,
    /** The deduction as written; null when the slip gave only a weight. */
    var value: Double? = null,
    var note: String? = null,
) {
    companion object : Decodable<NewOrderScanExchange> {
        override fun fromMap(m: Map<String, Any?>): NewOrderScanExchange {
            val c = Container(m)
            return NewOrderScanExchange(
                description = c.string("description"),
                weightG = c.double("weightG"),
                weightWasTola = c.bool("weightWasTola"),
                karat = c.double("karat"),
                ratePerGram = c.double("ratePerGram"),
                rateWasPerTola = c.bool("rateWasPerTola"),
                value = c.double("value"),
                note = c.string("note"),
            )
        }
    }
}

/** The whole reading (`RawOrderDraft`). Names come back as written; the book is matched on the phone. */
data class NewOrderScanAnswer(
    var items: List<NewOrderScanItem> = emptyList(),
    var karigarNameHeard: String? = null,
    var customerNameHeard: String? = null,
    var customerPhone: String? = null,
    /** Cash advance. Gold handed over is the exchange, never this. */
    var advancePayment: Double? = null,
    var exchange: NewOrderScanExchange? = null,
    var discount: Double? = null,
    /** The foot of the slip as written: copied, never recomputed. */
    var subtotal: Double? = null,
    var balanceDue: Double? = null,
    var expectedDate: String? = null,
    var notes: String? = null,
    /** What the reader could not make out, shown rather than hidden. */
    var unreadable: String? = null,
) {
    companion object : Decodable<NewOrderScanAnswer> {
        override fun fromMap(m: Map<String, Any?>): NewOrderScanAnswer {
            val c = Container(m)
            return NewOrderScanAnswer(
                items = c.list("items", NewOrderScanItem),
                karigarNameHeard = c.string("karigarNameHeard"),
                customerNameHeard = c.string("customerNameHeard"),
                customerPhone = c.string("customerPhone"),
                advancePayment = c.double("advancePayment"),
                exchange = c.obj("exchange", NewOrderScanExchange),
                discount = c.double("discount"),
                subtotal = c.double("subtotal"),
                balanceDue = c.double("balanceDue"),
                expectedDate = c.string("expectedDate"),
                notes = c.string("notes"),
                unreadable = c.string("unreadable"),
            )
        }

        /** The route's JSON; null when it is not a reading at all. */
        fun read(json: String): NewOrderScanAnswer? = from(Json.parse(json))
    }
}

/** The reading with its names matched against the book (`resolveDraft`): the person picks from here. */
data class NewOrderScanReading(
    var answer: NewOrderScanAnswer,
    var karigar: PaperNameGuess?,
    var customer: PaperNameGuess?,
) {
    companion object {
        /** Customers who are people (removed ones and the old walk-in records are not), and karigars not removed. */
        fun resolve(answer: NewOrderScanAnswer, customers: List<Customer>, karigars: List<Karigar>): NewOrderScanReading {
            val people = NewOrderMath.people(customers).map { PaperPerson(it.id, it.name) }
            val makers = karigars.filter { (it.deletedAt ?: "").isEmpty() }.map { PaperPerson(it.id, it.name) }
            return NewOrderScanReading(
                answer = answer,
                karigar = PaperNames.guess(answer.karigarNameHeard, makers),
                customer = PaperNames.guess(answer.customerNameHeard, people),
            )
        }
    }
}

// The slip's own arithmetic (order-draft.ts)

object NewOrderSlip {
    /** `num`: a figure that is there and above nothing, else 0. */
    fun num(v: Double?): Double {
        if (v == null || !v.isFinite() || v <= 0) return 0.0
        return v
    }

    /** `Math.round`: a half goes up. */
    fun jsRound(x: Double): Double = JS.round(x)

    /** `String(n)` for the figures a slip carries (no exponents at these sizes): 5.2, 12, 0.65. */
    fun jsNumber(x: Double): String {
        if (!x.isFinite()) return "0"
        if (x == Math.rint(x) && abs(x) < 1e15) return x.toLong().toString()
        return swiftDescription(x)
    }

    /** A figure back into a box: the exact number the browser's form holds, blank for nothing (decision "Number fields"). */
    fun box(x: Double): String = if (x == 0.0) "" else jsNumber(x)

    /** `toLocaleString('en-PK')`: 245,000 and 2,958.333 (ICU's en_US decimal, three places at most, a half going up). */
    fun pkNumber(x: Double): String {
        if (!x.isFinite()) return jsNumber(x)
        val negative = x < 0 || (x == 0.0 && 1.0 / x < 0)
        val digits = BigDecimal(JS.number(abs(x))).setScale(3, RoundingMode.HALF_UP).stripTrailingZeros()
        val plain = digits.toPlainString()
        val whole = plain.substringBefore('.')
        val fraction = if (plain.contains('.')) "." + plain.substringAfter('.') else ""
        val out = StringBuilder()
        for ((i, ch) in whole.withIndex()) {
            if (i > 0 && (whole.length - i) % 3 == 0) out.append(',')
            out.append(ch)
        }
        return (if (negative) "-" else "") + out + fraction
    }

    /** `money`: whole rupees, grouped. */
    fun money(x: Double): String = pkNumber(jsRound(x))

    /** The trade's tola (lib/units.ts GRAMS_PER_TOLA, order-draft.ts TOLA_G). */
    const val tolaG: Double = NewOrderWords.gramsPerTola

    /**
     * lib/vision/wastage.ts `wastagePercentOf`: a percent written wins; grams written are a percent of the metal the
     * ERP prices (the weight less any stone weight taken off), to two places, so 0.650 on 6.500 is 10.
     */
    fun wastagePercentOf(weightG: Double?, stoneWeightG: Double?, wastageG: Double?, wastagePercent: Double?): Double? {
        val round2 = { n: Double -> jsRound(n * 100) / 100 }
        val pct = wastagePercent ?: Double.NaN
        if (pct > 0) return round2(pct)
        val grams = wastageG ?: Double.NaN
        val metal = (weightG ?: 0.0) - (stoneWeightG ?: 0.0)
        if (grams > 0 && metal > 0) return round2((grams / metal) * 100)
        return null
    }

    fun wastagePercentOf(it: NewOrderScanItem): Double? = wastagePercentOf(it.weightG, it.stoneWeightG, it.wastageG, it.wastagePercent)

    /** Does the piece carry a weight: the one figure it takes to price it from a rate? */
    fun hasWeight(it: NewOrderScanItem): Boolean = num(it.weightG) > 0

    /** Did the slip do the sum for this piece, rather than just name it and a weight? */
    fun hasHisaab(it: NewOrderScanItem): Boolean = hasWeight(it) && num(it.ratePerGram) > 0

    val slipMetals = listOf("gold", "palladium", "platinum", "silver")

    /** The karats the form takes per metal: a slip that says 20k or 916 gets none rather than a wrong one. */
    private val karatsByMetal: Map<String, List<Int>> = mapOf("gold" to listOf(18, 21, 22, 24), "palladium" to listOf(12, 18), "platinum" to emptyList(), "silver" to emptyList())

    fun metalFor(metalType: String?, fallbackMetal: String): String {
        val m = (metalType ?: "").lowercase()
        return if (slipMetals.contains(m)) m else fallbackMetal
    }

    fun karatFor(karat: Double?, metalType: String?, fallbackMetal: String): String? {
        val metal = metalFor(metalType, fallbackMetal)
        val k = jsRound(num(karat)).toInt()
        return if ((karatsByMetal[metal] ?: emptyList()).contains(k)) "${k}k" else null
    }

    /**
     * `slipLinePrice`: rate × the metal (weight less stones), wastage on it when one was written, plus making and
     * stones, the form's own shape. Null when the slip gave no rate: a weight alone is not a price.
     */
    fun linePrice(it: NewOrderScanItem): Double? {
        if (!hasHisaab(it)) return null
        val metal = smax(0.0, num(it.weightG) - num(it.stoneWeightG)) * num(it.ratePerGram)
        val wastage = metal * ((wastagePercentOf(it) ?: 0.0) / 100)
        return jsRound(metal + wastage + num(it.makingCharges) + num(it.stoneCharges))
    }

    enum class ExchangeFrom { written, computed, unpriced }

    data class ExchangeValue(val value: Double, val from: ExchangeFrom)

    /**
     * `exchangeValue`: a written figure wins; else a weight AND a rate written against the old gold, multiplied (the
     * slip's sum, not ours). A weight alone is nothing: borrowing the new piece's rate would give the customer a price
     * nobody agreed.
     */
    fun exchangeValue(ex: NewOrderScanExchange?): ExchangeValue {
        if (ex == null) return ExchangeValue(0.0, ExchangeFrom.unpriced)
        if (num(ex.value) > 0) return ExchangeValue(num(ex.value), ExchangeFrom.written)
        if (num(ex.weightG) > 0 && num(ex.ratePerGram) > 0) return ExchangeValue(jsRound(num(ex.weightG) * num(ex.ratePerGram)), ExchangeFrom.computed)
        return ExchangeValue(0.0, ExchangeFrom.unpriced)
    }

    /** `describeExchange`: "Old gold ring · 21k · 5.2 g · at 22,000/g", for the exchange row's words. */
    fun describeExchange(ex: NewOrderScanExchange?): String {
        if (ex == null) return ""
        val parts = ArrayList<String>()
        val what = NewOrderFormat.trim(ex.description ?: "")
        parts.add(if (what.isEmpty()) "Gold taken in exchange" else what)
        if (num(ex.karat) > 0) parts.add("${jsNumber(jsRound(num(ex.karat)))}k")
        if (num(ex.weightG) > 0) {
            val tola = if (ex.weightWasTola == true) " (${Money.fixed(num(ex.weightG) / tolaG, 3)} tola on the slip)" else ""
            parts.add("${jsNumber(num(ex.weightG))} g$tola")
        }
        if (num(ex.ratePerGram) > 0) {
            parts.add("at ${pkNumber(jsRound(num(ex.ratePerGram)))}/g${if (ex.rateWasPerTola == true) " (written per tola)" else ""}")
        }
        val from = exchangeValue(ex).from
        if (from == ExchangeFrom.computed) parts.add("value is weight × rate off the slip")
        if (from == ExchangeFrom.unpriced && num(ex.weightG) > 0) parts.add("no value written — enter what it was taken at")
        val note = ex.note
        if (note != null && note.isNotEmpty()) parts.add(note)
        return parts.joinToString(" · ")
    }

    class Check {
        /** One line each, in the reader's words. Empty when everything agrees. */
        val warnings: MutableList<String> = mutableListOf()

        /** Pieces whose written amount disagrees with their own hisaab, by position. */
        val itemsOff: MutableList<Int> = mutableListOf()

        /** The pieces, each at its written amount first, then its hisaab. */
        var subtotal = 0.0

        /** Subtotal less discount, advance and exchange; null when no piece could be priced. */
        var balance: Double? = null
    }

    /**
     * `reconcileSlip`: each piece's amount against its own rate × weight, the subtotal against the pieces, the balance
     * against the subtotal less everything taken off. A rupee or two is rounding; more is a misread digit or a missed
     * line. Nothing is corrected: the warnings point, the person decides.
     */
    fun check(a: NewOrderScanAnswer): Check {
        val out = Check()
        var priced = 0
        for ((i, it) in a.items.withIndex()) {
            val computed = linePrice(it)
            val written = num(it.lineTotal)
            if (computed != null && written > 0 && abs(computed - written) > 2) {
                out.itemsOff.add(i)
                val name = if ((it.description ?: "").isEmpty()) "Piece ${i + 1}" else it.description!!
                out.warnings.add("$name: the slip writes ${money(written)} but its own rate × weight comes to ${money(computed)}. One of those figures was probably misread.")
            }
            val line = if (written > 0) written else (computed ?: 0.0)
            if (line > 0) {
                out.subtotal += line
                priced += 1
            }
        }
        if (num(a.subtotal) > 0 && priced > 0 && abs(num(a.subtotal) - out.subtotal) > 2) {
            out.warnings.add("The slip's subtotal is ${money(num(a.subtotal))}; the pieces as read come to ${money(out.subtotal)}. A line may have been missed or a digit misread.")
        }
        val ex = exchangeValue(a.exchange)
        val off = num(a.discount) + num(a.advancePayment) + ex.value
        val base = if (num(a.subtotal) > 0) num(a.subtotal) else out.subtotal
        out.balance = if (priced > 0 || num(a.subtotal) > 0) base - off else null
        val balance = out.balance
        if (num(a.balanceDue) > 0 && balance != null && abs(num(a.balanceDue) - balance) > 2) {
            out.warnings.add("The slip's balance is ${money(num(a.balanceDue))}; total less what was taken off comes to ${money(balance)}. Check the advance and the exchange line.")
        }
        val x = a.exchange
        if (x != null && ex.from == ExchangeFrom.unpriced && num(x.weightG) > 0) {
            out.warnings.add("Old gold was taken in exchange but the slip gives no figure for it. Its value is left for you to enter.")
        }
        return out
    }

    /**
     * The reader's words for a piece as the ERP's categories (bill-draft.ts `CATEGORY_BY_WORD`, deliberately partial:
     * "Set" could be any of seven, so it comes through blank for a person to choose). The browser's order form puts the
     * bare word in its category box, which then saves a word where an id belongs.
     */
    val categoryByWord: Map<String, String> = mapOf(
        "Ring" to "cat001", "Tops" to "cat002", "Earrings" to "cat002", "Jhumka" to "cat003",
        "Pendant" to "cat004", "Bracelet" to "cat005", "Bangle" to "cat007", "Kara" to "cat007",
        "Chain" to "cat008",
    )

    /** The order's rate box for a metal and karat (order-form.tsx `RATE_FIELD`). */
    fun rateKey(metal: String, karat: String?): RateKey? = when (metal to (karat ?: "")) {
        "gold" to "18k" -> RateKey.goldRatePerGram18k
        "gold" to "21k" -> RateKey.goldRatePerGram21k
        "gold" to "22k" -> RateKey.goldRatePerGram22k
        "gold" to "24k" -> RateKey.goldRatePerGram24k
        "palladium" to "18k" -> RateKey.palladiumRatePerGram18k
        "palladium" to "12k" -> RateKey.palladiumRatePerGram12k
        else -> null
    }
}

// Into the form (order-form.tsx `applyScan`)

private val slipDay = Regex("^\\d{4}-\\d{2}-\\d{2}$")

/**
 * The reading laid into the order, as the browser's form lays it:
 *
 * - A piece with a weight is priced from the rate, like one typed at the counter; a rate on the slip goes in the
 *   order's box for that karat, so the form's arithmetic reproduces the slip's. Its wastage is what the slip's sum
 *   used (the percent, or the grams as a percent of the metal), else none; a bare weight with no rate takes the
 *   usual 10.
 * - A figure with no weight is a fixed price at exactly that figure: a weight back-solved from it would be one nobody
 *   wrote.
 * - Neither: priced from the rate, the weight left for the person to fill.
 *
 * The cash advance, the discount and the old gold land in their own boxes, the customer and karigar only as the
 * person picked them (`customer` pinned, else the name as written for a new customer). `photos` are the slip's photos
 * made small for an order (NewOrderPhotoCodec), in the order they were read: a piece the reader said is in a photo
 * takes that one, else the first piece takes the first, as the order's reference picture. `settings` seeds today's
 * rates first if the form has not yet, so the slip's rate is never overwritten.
 */
fun NewOrderDraft.fillFromSlip(
    scan: NewOrderScanAnswer,
    customer: Customer?,
    heardCustomer: String?,
    karigarId: String,
    photos: List<ByteArray>,
    fallbackMetal: String,
    settings: Settings?,
) {
    val s = NewOrderSlip
    if (!ratesSeeded && settings != null) seedRates(settings)

    if (customer != null) {
        choose(customer)
    } else if (!heardCustomer.isNullOrEmpty()) {
        // Nobody pinned: the name carries through as written rather than being lost.
        typeCustomerName(heardCustomer)
    }
    val phone = NewOrderFormat.trim(scan.customerPhone ?: "")
    if (phone.isNotEmpty()) customerPhone = phone
    if (s.num(scan.advancePayment) > 0) advance = s.box(s.num(scan.advancePayment))
    if (s.num(scan.discount) > 0) discount = s.box(s.num(scan.discount))
    val day = scan.expectedDate
    if (day != null && slipDay.containsMatchIn(day)) promised = day

    // Old gold against the order: the words carry everything the slip said about it, the value only what the slip priced it at.
    val x = scan.exchange
    if (x != null) {
        val ex = s.exchangeValue(x)
        val words = NewOrderFormat.trim(x.description ?: "")
        val row = blankExchangeRow().copy(
            description = if (words.isEmpty()) s.describeExchange(x) else words,
            karat = if (s.num(x.karat) > 0) "${s.jsNumber(s.jsRound(s.num(x.karat)))}k" else "",
            weightG = if (s.num(x.weightG) > 0) s.jsNumber(s.num(x.weightG)) else "",
            ratePerGram = if (s.num(x.ratePerGram) > 0) s.jsNumber(s.jsRound(s.num(x.ratePerGram))) else "",
            value = if (ex.value > 0) s.jsNumber(ex.value) else "",
            valueTyped = ex.from == NewOrderSlip.ExchangeFrom.written,
        )
        exchanges = mutableListOf(NewOrderExchangeDraft(row))
    }

    val check = s.check(scan)
    val lines = if (scan.items.isEmpty()) listOf(NewOrderScanItem()) else scan.items
    for ((i, it) in lines.withIndex()) {
        val metal = s.metalFor(it.metalType, fallbackMetal)
        val karat = s.karatFor(it.karat, it.metalType, fallbackMetal)
        val weight = s.num(it.weightG)
        val written = s.num(it.lineTotal)
        val fixed = weight <= 0 && written > 0
        val rate = s.num(it.ratePerGram)

        // The slip's rate becomes the order's rate for that karat. Silver has one all-in rate, the shop's, so it is noted instead.
        val rateKey = if (rate > 0) s.rateKey(metal, karat) else null
        if (rateKey != null) rates[rateKey.name] = s.box(rate)

        val p = NewOrderPieceDraft()
        p.category = s.categoryByWord[it.itemCategory ?: ""] ?: ""
        p.description = it.description ?: ""
        p.metal = metal
        // A gold piece with no karat written is 21k; a palladium one with none takes its flat rate, as in the browser.
        p.karat = karat ?: (if (metal == "gold") "21k" else "")
        p.weight = s.box(weight)
        p.wastage = s.box(if (s.hasHisaab(it)) (s.wastagePercentOf(it) ?: 0.0) else 10.0)
        p.making = s.box(s.num(it.makingCharges))
        p.stones = s.box(s.num(it.stoneCharges))
        p.hasStones = s.num(it.stoneWeightG) > 0 || s.num(it.stoneCharges) > 0
        p.stoneWeight = s.box(s.num(it.stoneWeightG))
        p.stoneDetails = it.stoneDetails ?: ""
        p.hasDiamonds = false
        p.karigarId = karigarId
        p.manual = fixed
        p.manualPrice = if (fixed) s.box(written) else ""
        p.size = it.size ?: ""

        // The photo the reader said shows this piece, else the first photo on the first piece.
        val idx = it.photoIndex ?: 0.0
        if (idx >= 1 && idx <= photos.size.toDouble()) {
            p.photo = if (idx == Math.rint(idx)) photos[idx.toInt() - 1] else null
        } else if (i == 0) {
            p.photo = photos.firstOrNull()
        }

        val karatWritten = it.karat?.let { k -> "${s.jsNumber(k)}k" }
        val notes: List<String?> = listOf(
            it.note,
            if (it.weightWasTola == true) "Weight converted from tola on the slip." else null,
            if (it.rateWasPerTola == true) "Rate converted from per tola on the slip." else null,
            if (it.makingWasPerGram == true) "Making was written per gram and multiplied by the weight." else null,
            if (rate > 0 && rateKey == null && metal == "silver") "Slip rate ${s.pkNumber(rate)}/g — silver is priced at the shop's rate in settings." else null,
            if (rate > 0 && rateKey == null && metal != "silver") "Slip rate ${s.pkNumber(rate)}/g could not be applied — no ${karatWritten ?: "karat"} rate box." else null,
            if (s.num(it.karat) > 0 && karat == null) "Slip says ${karatWritten ?: ""}, which the form does not offer." else null,
            if (written > 0 && !fixed) "Slip writes ${s.pkNumber(written)} for this piece." else null,
            if (check.itemsOff.contains(i)) "The slip's own sum for this piece does not match its written amount — check it." else null,
            if (i == 0 && !(scan.unreadable ?: "").isEmpty()) "Unread on the slip: ${scan.unreadable ?: ""}" else null,
            if (i == 0 && s.num(scan.balanceDue) > 0) "Slip says balance ${s.pkNumber(s.num(scan.balanceDue))}." else null,
            if (i == 0 && !(scan.expectedDate ?: "").isEmpty()) "Slip says wanted by ${scan.expectedDate ?: ""}." else null,
        )
        p.adminNote = notes.filterNotNull().filter { n -> n.isNotEmpty() }.joinToString(" ")
        pieces.add(p)
    }
}
