package erp.core.entry

import erp.core.Container
import erp.core.Decodable
import erp.core.Json
import erp.core.logic.metalHasKarat
import erp.core.logic.rupees
import erp.core.models.Customer
import java.time.Instant

// Read a written bill: what the ERP's reader (/api/vision/bill, the route the browser's "Read a written bill" calls)
// read off a handwritten bill or estimate, and those lines put on the sale. Ported from lib/vision/bill-draft.ts
// (`billLineToProduct`, `billRates`, `reconcile`) and sale-page.tsx `acceptScannedBill`, line for line.
// (SaleScanBill.swift.)
//
// The whole design is one distinction: whether a line shows its working. A line with a weight is an ordinary line
// priced from the rate (the bill's own rate, held in its box, and its own wastage), so it comes to the paper's figure
// and moves if the rate is changed. A line with only a figure is a fixed price at exactly that figure, with no weight
// invented to justify it. Nothing is invoiced here: the lines land on the sale for the person to check and save.

// What the reader answers

/** One line written on the bill (`BillLine`). Every field may be missing. */
data class SaleBillLine(
    var description: String? = null,
    /** The reader's word ("Ring", "Chain"), not a category id. */
    var itemCategory: String? = null,
    var metalType: String? = null,
    var karat: Double? = null,
    /** Grams, as weighed: before any stone weight comes off. */
    var weightG: Double? = null,
    var weightWasTola: Boolean? = null,
    var stoneWeightG: Double? = null,
    var wastageG: Double? = null,
    var wastagePercent: Double? = null,
    /** The rate this line was priced at, per gram: its own, or the one written at the top. */
    var ratePerGram: Double? = null,
    var rateWasPerTola: Boolean? = null,
    var makingCharges: Double? = null,
    var stoneCharges: Double? = null,
    var diamondCharges: Double? = null,
    /** The line's figure as written: the only one a bare line carries. */
    var lineTotal: Double? = null,
    /** The reader's own guess at whether the line showed its working: a hint only (`hasBreakdown` decides). */
    var brokenDown: Boolean? = null,
    var note: String? = null,
) {
    companion object : Decodable<SaleBillLine> {
        override fun fromMap(m: Map<String, Any?>): SaleBillLine {
            val c = Container(m)
            return SaleBillLine(
                description = c.string("description"),
                itemCategory = c.string("itemCategory"),
                metalType = c.string("metalType"),
                karat = c.double("karat"),
                weightG = c.double("weightG"),
                weightWasTola = c.bool("weightWasTola"),
                stoneWeightG = c.double("stoneWeightG"),
                wastageG = c.double("wastageG"),
                wastagePercent = c.double("wastagePercent"),
                ratePerGram = c.double("ratePerGram"),
                rateWasPerTola = c.bool("rateWasPerTola"),
                makingCharges = c.double("makingCharges"),
                stoneCharges = c.double("stoneCharges"),
                diamondCharges = c.double("diamondCharges"),
                lineTotal = c.double("lineTotal"),
                brokenDown = c.bool("brokenDown"),
                note = c.string("note"),
            )
        }
    }
}

/** The whole reading (`RawBillDraft`). */
data class SaleBillAnswer(
    var lines: List<SaleBillLine> = emptyList(),
    /** A rate written once for the whole bill ("Rate 34,000"), per gram. */
    var ratePerGram: Double? = null,
    var rateWasPerTola: Boolean? = null,
    var customerNameHeard: String? = null,
    var customerPhone: String? = null,
    /** The foot of the bill as written, for checking the sale against. */
    var subtotal: Double? = null,
    var discount: Double? = null,
    var grandTotal: Double? = null,
    var amountPaid: Double? = null,
    var date: String? = null,
    var unreadable: String? = null,
) {
    companion object : Decodable<SaleBillAnswer> {
        override fun fromMap(m: Map<String, Any?>): SaleBillAnswer {
            val c = Container(m)
            return SaleBillAnswer(
                lines = c.list("lines", SaleBillLine),
                ratePerGram = c.double("ratePerGram"),
                rateWasPerTola = c.bool("rateWasPerTola"),
                customerNameHeard = c.string("customerNameHeard"),
                customerPhone = c.string("customerPhone"),
                subtotal = c.double("subtotal"),
                discount = c.double("discount"),
                grandTotal = c.double("grandTotal"),
                amountPaid = c.double("amountPaid"),
                date = c.string("date"),
                unreadable = c.string("unreadable"),
            )
        }

        /** The route's JSON; null when it is not a reading at all. */
        fun read(json: String): SaleBillAnswer? = from(Json.parse(json))
    }
}

/** The reading with the customer matched against the book (`resolveBill`), and the lines the person keeps. */
data class SaleBillReading(
    var answer: SaleBillAnswer,
    var customer: PaperNameGuess?,
    /** Lines left off the sale, by position (the browser's unticked boxes). */
    var skipped: MutableSet<Int> = mutableSetOf(),
) {
    val kept: List<SaleBillLine> get() = answer.lines.withIndex().filter { !skipped.contains(it.index) }.map { it.value }

    companion object {
        fun resolve(answer: SaleBillAnswer, customers: List<Customer>): SaleBillReading {
            val people = NewOrderMath.people(customers).map { PaperPerson(it.id, it.name) }
            return SaleBillReading(answer, PaperNames.guess(answer.customerNameHeard, people))
        }
    }
}

// The bill's rules (bill-draft.ts)

object SaleBill {
    /** Can this line be priced from the rate? A weight is the whole question, judged from what arrived. */
    fun hasBreakdown(l: SaleBillLine): Boolean = (l.weightG ?: 0.0) > 0

    /** A line's figure as written. */
    fun writtenTotal(l: SaleBillLine): Double = if ((l.lineTotal ?: 0.0) > 0) l.lineTotal!! else 0.0

    fun wastagePercentOf(l: SaleBillLine): Double? =
        NewOrderSlip.wastagePercentOf(l.weightG, l.stoneWeightG, l.wastageG, l.wastagePercent)

    private val karatsByMetal: Map<String, List<Double>> = mapOf("gold" to listOf(18.0, 21.0, 22.0, 24.0), "palladium" to listOf(12.0, 18.0), "platinum" to emptyList(), "silver" to emptyList())

    /**
     * `billLineToProduct`: a line with a weight as an ordinary priced line (the bill's wastage when it wrote one, else
     * the blank line's); a bare line as a fixed price at its figure, weighing nothing, because nothing is the honest
     * answer to a question the bill did not ask. `blank` is `SaleLine.blankFor(metal, sku)`: the house's metal and
     * opening wastage. A gold line with no karat written is 21k. A karat on a metal that has none is left off (the
     * browser carries the blank's 21k onto a silver line, the phantom karat that prices nothing).
     */
    fun line(l: SaleBillLine, blank: SaleLine, fallbackMetal: String): SaleLine {
        val metalWord = l.metalType ?: ""
        val metal = if (metalWord.isEmpty()) fallbackMetal else metalWord
        val k = l.karat ?: 0.0
        val allowed = karatsByMetal[metal] ?: emptyList()
        val karat: String? = if (k > 0 && allowed.contains(k)) "${NewOrderSlip.jsNumber(k)}k" else null

        val out = blank.copy()
        val name = NewOrderFormat.trim(l.description ?: "")
        out.name = if (name.isEmpty()) "Item" else name
        out.categoryId = NewOrderSlip.categoryByWord[l.itemCategory ?: ""] ?: ""
        out.metalType = metal
        if (karat != null) {
            out.karat = karat
        } else if (metal == "gold") {
            out.karat = "21k"
        } else if (!metalHasKarat(metal)) {
            out.karat = null
        }
        val note = l.note
        if (note != null && note.isNotEmpty()) out.billDescription = note

        if (!hasBreakdown(l)) {
            out.metalWeightG = 0.0
            out.isCustomPrice = true
            out.customPrice = writtenTotal(l)
            return out
        }
        out.metalWeightG = l.weightG ?: 0.0
        out.hasStones = (l.stoneWeightG ?: 0.0) > 0 || (l.stoneCharges ?: 0.0) > 0
        out.stoneWeightG = l.stoneWeightG ?: 0.0
        wastagePercentOf(l)?.let { out.wastagePercentage = it }
        out.stoneCharges = l.stoneCharges ?: 0.0
        out.hasDiamonds = (l.diamondCharges ?: 0.0) > 0
        out.diamondCharges = l.diamondCharges ?: 0.0
        out.makingCharges = l.makingCharges ?: 0.0
        out.isCustomPrice = false
        out.customPrice = 0.0
        return out
    }

    /**
     * `billRates`: the rates the bill was priced at, by the sale's rate boxes ("gold21k": 34000). A broken-down line
     * priced at the bill's rate comes to the bill's figure; at today's it does not. Gold only (silver is all-in); a
     * karat priced at two rates on one bill sets nothing, since one box can't hold both.
     */
    fun rates(lines: List<SaleBillLine>, billRate: Double?, fallbackMetal: String): Map<String, Double> {
        val seen = HashMap<String, MutableSet<Double>>()
        val order = ArrayList<String>()
        for (l in lines) {
            if (!hasBreakdown(l)) continue
            val metalWord = l.metalType ?: ""
            val metal = if (metalWord.isEmpty()) fallbackMetal else metalWord
            if (metal != "gold") continue
            val rate = if ((l.ratePerGram ?: 0.0) > 0) l.ratePerGram!! else (if ((billRate ?: 0.0) > 0) billRate!! else 0.0)
            if (rate == 0.0) continue
            val k = if ((l.karat ?: 0.0) > 0 && karatsByMetal.getValue("gold").contains(l.karat!!)) l.karat!! else 21.0
            val key = "gold${NewOrderSlip.jsNumber(k)}k"
            if (seen[key] == null) {
                seen[key] = mutableSetOf()
                order.add(key)
            }
            seen.getValue(key).add(NewOrderSlip.jsRound(rate * 100) / 100)
        }
        val out = LinkedHashMap<String, Double>()
        for (key in order) if (seen.getValue(key).size == 1) out[key] = seen.getValue(key).first()
        return out
    }

    /** The figure at the foot of the bill (`reconcile`'s `written`): its total, else its subtotal. */
    fun writtenFigure(a: SaleBillAnswer): Double? {
        if ((a.grandTotal ?: 0.0) > 0) return a.grandTotal
        if ((a.subtotal ?: 0.0) > 0) return a.subtotal
        return null
    }

    /** A rupee of rounding is not a discrepancy; a missed line is. */
    fun differs(written: Double?, computed: Double): Boolean {
        if (written == null) return false
        return kotlin.math.abs(written - computed) > 1
    }

    /**
     * `BILL-` and the milliseconds since 1970 in base 36, then the line's number: a key for this bill only, never a
     * stock number (lib/sku.ts ONE_OFF_SKU_PREFIXES). One already on the sale moves the clock on.
     */
    fun skus(count: Int, now: Instant, avoiding: Set<String>): List<String> {
        var ms = maxOf(0L, now.toEpochMilli())
        while (true) {
            val stem = "BILL-" + java.lang.Long.toString(ms, 36).uppercase()
            val out = (0 until count).map { "$stem-${it + 1}" }
            if (out.all { !avoiding.contains(it) }) return out
            ms += 1
        }
    }
}

// Onto the sale (sale-page.tsx `acceptScannedBill`)

/**
 * The kept lines onto the sale, after what it holds; the customer only as the person picked them; the bill's rates
 * into their boxes (the paper's rate prices this bill); its discount unless one is typed; what it says was paid as one
 * cash row unless a payment is typed. Answers the rate boxes it set, as the sale now holds them: those are the bill's,
 * never the shop's rate for tomorrow (SaleScanHeld).
 */
fun SaleDraft.fillFromBill(reading: SaleBillReading, customer: Customer?, fallbackMetal: String, now: Instant = Instant.now()): Map<String, String> {
    val kept = reading.kept
    val skus = SaleBill.skus(kept.size, now, lines.map { it.sku }.toSet())
    for ((i, l) in kept.withIndex()) {
        val made = SaleBill.line(l, SaleLine.blankFor(fallbackMetal, skus[i]), fallbackMetal)
        if (lines.none { it.sku == made.sku }) lines.add(made)
    }
    if (customer != null) pick(customer)

    val held = LinkedHashMap<String, String>()
    for ((key, rate) in SaleBill.rates(kept, reading.answer.ratePerGram, fallbackMetal)) {
        if (rateInputKey(key) == null) continue
        val text = erp.core.logic.Money.fixed(rate, 2)
        rates[key] = text
        held[key] = text
    }

    val bill = reading.answer
    val d = bill.discount
    if (d != null && d > 0 && !((SaleNumber.parse(discount) ?: 0.0) > 0)) {
        discount = NewOrderSlip.jsNumber(rupees(d))
    }
    val paid = bill.amountPaid
    if (paid != null && paid > 0 && !payments.any { (SaleNumber.parse(it.amount) ?: 0.0) > 0 }) {
        payments = mutableListOf(SalePaymentRow(amount = NewOrderSlip.jsNumber(rupees(paid))))
    }
    return held
}

// The bill's rates are held, not typed

/**
 * A rate read off a bill prices that bill and is never the shop's rate for tomorrow (decisions.md "Rate chip",
 * lib/rates.ts `ratesToKeep`: the browser holds it, `heldRates`, and writes back only boxes typed by hand). The sale
 * keeps every box it sets as typed text (`SaleDraft.rates`), so the boxes a bill set are remembered here with the
 * figure it set, and a box still holding that figure is not written back. Typing a different figure over it makes it
 * the person's own again. Where they are kept ("erp.saleBillRates" on the iPhone) is the app's business.
 */
object SaleScanHeld {
    const val key = "erp.saleBillRates"

    /**
     * The boxes a bill just set, added to those an earlier bill on the same sale set (a sale with no bill lines before
     * this one starts the list afresh). `stored` is what was kept; the answer is what to keep now.
     */
    fun hold(set: Map<String, String>, before: SaleDraft, stored: Map<String, String>): Map<String, String> {
        val carried = if (before.lines.any { it.sku.startsWith("BILL-") }) stored else emptyMap()
        val out = LinkedHashMap(carried)
        out.putAll(set)
        return out
    }

    /** `kept` (the settings' rate names, as `ratesToWriteBack` answers) less every box still holding a bill's figure. */
    fun unheld(kept: Map<String, Double>?, draft: SaleDraft, held: Map<String, String>): Map<String, Double>? {
        if (kept == null) return null
        val out = LinkedHashMap(kept)
        for ((box, text) in held) {
            if (draft.rates[box] == text) {
                val input = rateInputKey(box)
                if (input != null) out.remove(input.rateKey.name)
            }
        }
        return if (out.isEmpty()) null else out
    }
}
