package erp.app.screens.stock

import erp.app.config.House
import erp.core.entry.NewOrderFormat
import erp.core.logic.PricedPiece
import erp.core.models.KaratValue
import erp.core.models.MetalType
import erp.core.models.Product
import java.util.UUID

/**
 * Everything the product form edits (product-form.tsx `ProductFormData`), held as text so the boxes stay editable
 * (StockPieceForm.swift `StockPieceFields`). [piece] is what goes to the ERP, which checks it again with the form's own
 * schema and shapes it as the form's `processAndSubmit` does (lib/writes/products.ts `cleanProductForm`).
 */
data class StockPieceFields(
    val name: String = "",
    val categoryId: String = "",
    /** The house's own metal: the silver house starts on silver, the gold house on gold. */
    val metalType: String = House.metal,
    /** A new piece opens on 21k, the karat the shop sells. */
    val karat: String = "21k",
    val weight: String = "",
    /** Silver's all-in rate for this piece; a fixed price's reference rate. */
    val silverRate: String = "",
    /** "" is no second metal (a men's ring only). */
    val secondMetal: String = "",
    val secondKarat: String = "",
    val secondWeight: String = "",
    val wastage: String = "10",
    val making: String = "",
    val hasDiamonds: Boolean = false,
    /** A new piece opens with the stone fields in play, as on the web. */
    val hasStones: Boolean = true,
    val stoneWeight: String = "",
    val diamondCharges: String = "",
    val stoneCharges: String = "",
    val miscCharges: String = "",
    val stoneDetails: String = "",
    val diamondDetails: String = "",
    /** `isCustomPrice`. */
    val fixed: Boolean = false,
    val customPrice: String = "",
    val description: String = "",
    val size: String = "",
    val platingType: String = "",
    val platingNote: String = "",
    val nickelFree: Boolean = false,
) {
    companion object {
        /** lib/pricing.ts GOLD_COIN_CATEGORY_ID; lib/writes/products.ts MENS_RING_CATEGORY. */
        const val goldCoin = "cat017"
        const val mensRing = "cat018"

        /** A number in its box: blank for 0 (decisions.md "Number fields"). */
        private fun box(x: Double, digits: Int): String = NewOrderFormat.boxText(x, digits)

        private fun num(s: String): Double = NewOrderFormat.num(s)
        private fun trim(s: String): String = NewOrderFormat.trim(s)

        /** A piece's own figures, as the web form opens on them (`getSafeDefaultValues(p)`). */
        fun of(p: Product) = StockPieceFields(
            name = p.name,
            categoryId = p.categoryId,
            metalType = p.metalType.rawValue.ifEmpty { House.metal },
            karat = p.karat?.rawValue ?: "",
            weight = box(p.metalWeightG, 3),
            silverRate = box(p.silverRatePerGram ?: 0.0, 2),
            secondMetal = p.secondaryMetalType?.rawValue ?: "",
            secondKarat = p.secondaryMetalKarat?.rawValue ?: "",
            secondWeight = box(p.secondaryMetalWeightG ?: 0.0, 3),
            wastage = NewOrderFormat.trimmed(p.wastagePercentage, 2),
            making = box(p.makingCharges, 2),
            hasDiamonds = p.hasDiamonds,
            hasStones = p.hasStones,
            stoneWeight = box(p.stoneWeightG, 3),
            diamondCharges = box(p.diamondCharges, 2),
            stoneCharges = box(p.stoneCharges, 2),
            miscCharges = box(p.miscCharges, 2),
            stoneDetails = p.stoneDetails ?: "",
            diamondDetails = p.diamondDetails ?: "",
            fixed = p.isCustomPrice,
            customPrice = box(p.customPrice ?: 0.0, 2),
            description = p.description ?: "",
            size = p.size ?: "",
            platingType = p.platingType ?: "",
            platingNote = p.platingNote ?: "",
            nickelFree = p.nickelFree,
        )
    }

    val isGoldCoin: Boolean get() = categoryId == goldCoin && metalType == "gold"
    val isMensRing: Boolean get() = categoryId == mensRing
    val silver: Boolean get() = metalType == "silver"

    /** What the web form's effect watches; any change runs `settle`. */
    data class RuleKey(val coin: Boolean, val diamonds: Boolean, val stones: Boolean, val mensRing: Boolean, val metal: String, val second: String)

    val ruleKey: RuleKey
        get() = RuleKey(isGoldCoin, hasDiamonds, hasStones, isMensRing, metalType, secondMetal)

    /**
     * The web form's effect, line for line: a gold coin carries nothing but its metal (and is 24k), silver has no
     * wastage or making, no diamonds means no diamond charge, no stones no stone weight; a karat for gold only, a second
     * metal on a men's ring only. `keepWastage` keeps a piece's own wastage as an edit opens.
     */
    fun settle(keepWastage: Boolean = false): StockPieceFields {
        var f = this
        if (isGoldCoin) {
            f = f.copy(
                hasDiamonds = false, hasStones = false, diamondCharges = "", wastage = "0", making = "", stoneCharges = "",
                miscCharges = "", stoneDetails = "", diamondDetails = "", stoneWeight = "", karat = "24k",
            )
        } else if (silver) {
            f = f.copy(wastage = "0", making = "")
        } else {
            if (hasDiamonds) {
                if (!keepWastage) f = f.copy(wastage = "25")
            } else {
                if (!keepWastage) f = f.copy(wastage = "10")
                f = f.copy(diamondCharges = "", diamondDetails = "")
            }
            if (!hasStones) f = f.copy(stoneWeight = "", stoneDetails = "")
        }

        if (f.metalType != "gold") f = f.copy(karat = "")
        else if (f.karat.isEmpty()) f = f.copy(karat = "21k")

        if (!f.isMensRing && (f.secondMetal.isNotEmpty() || num(f.secondWeight) != 0.0)) {
            f = f.copy(secondMetal = "", secondKarat = "", secondWeight = "")
        }
        if (f.secondMetal.isNotEmpty() && f.secondMetal != "gold") f = f.copy(secondKarat = "")
        return f
    }

    /** The first thing the web form would refuse (its zod schema, in its order), or null. */
    val problem: String?
        get() {
            if (categoryId.isEmpty()) return "Category is required"
            val amounts = listOf(
                "Metal weight" to weight, "Rate per gram" to silverRate, "Secondary metal weight" to secondWeight,
                "Wastage" to wastage, "Making charges" to making, "Stone weight" to stoneWeight,
                "Diamond charges" to diamondCharges, "Stone charges" to stoneCharges, "Misc charges" to miscCharges,
                "Price" to customPrice,
            )
            for ((label, text) in amounts) if (NewOrderFormat.below0(text)) return "$label must be non-negative"
            if (num(wastage) > 100) return "Wastage must be between 0 and 100"

            if (fixed) {
                if (trim(description).length < 3) return "Description is required for custom priced items."
                if (num(customPrice) <= 0) return "A positive price is required."
            }
            if (!fixed && num(weight) < 0.001) return "Metal weight must be a positive number"
            if (!fixed) {
                if (metalType == "gold" && karat.isEmpty()) return "Karat is required for gold items."
                if (secondMetal == "gold" && secondKarat.isEmpty()) return "Karat is required for secondary gold metal."
                if (secondMetal.isNotEmpty() && num(secondWeight) <= 0) return "A positive weight is required for secondary metal."
                if (num(stoneWeight) > num(weight) + num(secondWeight)) return "Stone weight cannot be greater than the total metal weight."
            }
            return null
        }

    /** The form's fields as the ERP's `piece`: every field it edits, numbers as numbers, a karat only when set. */
    val piece: Map<String, Any?>
        get() {
            val out = LinkedHashMap<String, Any?>()
            out["name"] = trim(name)
            out["categoryId"] = categoryId
            out["metalType"] = metalType
            out["metalWeightG"] = num(weight)
            out["silverRatePerGram"] = num(silverRate)
            out["secondaryMetalType"] = secondMetal
            out["secondaryMetalKarat"] = secondKarat
            out["secondaryMetalWeightG"] = num(secondWeight)
            out["wastagePercentage"] = num(wastage)
            out["makingCharges"] = num(making)
            out["hasDiamonds"] = hasDiamonds
            out["hasStones"] = hasStones
            out["stoneWeightG"] = num(stoneWeight)
            out["diamondCharges"] = num(diamondCharges)
            out["stoneCharges"] = num(stoneCharges)
            out["miscCharges"] = num(miscCharges)
            out["stoneDetails"] = trim(stoneDetails)
            out["diamondDetails"] = trim(diamondDetails)
            out["isCustomPrice"] = fixed
            out["customPrice"] = num(customPrice)
            out["description"] = trim(description)
            out["size"] = trim(size)
            out["platingType"] = platingType
            out["platingNote"] = trim(platingNote)
            out["nickelFree"] = nickelFree
            if (karat.isNotEmpty()) out["karat"] = karat
            return out
        }

    /**
     * The piece as the ERP will price it once saved: the store's rules applied (a coin's charges at nothing, gold
     * without a karat at 21k, a second metal on a men's ring only).
     */
    val priced: PricedPiece
        get() {
            val coin = isGoldCoin
            val second: MetalType? = if (isMensRing && secondMetal.isNotEmpty()) MetalType.of(secondMetal) else null
            val karatValue: KaratValue? = if (metalType == "gold") KaratValue.of(karat.ifEmpty { "21k" }) else null
            return PricedPiece(
                categoryId = categoryId,
                metalType = MetalType.of(metalType),
                karat = karatValue,
                metalWeightG = num(weight),
                secondaryMetalType = second,
                secondaryMetalKarat = if (second == MetalType.gold && secondKarat.isNotEmpty()) KaratValue.of(secondKarat) else null,
                secondaryMetalWeightG = if (second == null) null else num(secondWeight),
                stoneWeightG = num(stoneWeight),
                wastagePercentage = if (coin) 0.0 else num(wastage),
                makingCharges = if (coin) 0.0 else num(making),
                hasDiamonds = if (coin) false else hasDiamonds,
                diamondCharges = if (coin || !hasDiamonds) 0.0 else num(diamondCharges),
                stoneCharges = if (coin) 0.0 else num(stoneCharges),
                miscCharges = if (coin) 0.0 else num(miscCharges),
                isCustomPrice = fixed,
                customPrice = if (fixed) num(customPrice) else null,
                silverRatePerGram = num(silverRate),
            )
        }
}

// MARK: The rules the bulk page keeps to itself (lib/bulk-pieces.ts)

/** One weight to add: a row of the page's `items`. */
data class StockBulkRow(
    val id: String = UUID.randomUUID().toString(),
    val weight: String = "",
    /** Joins the shared prefix to name this piece. */
    val suffix: String = "",
)

object StockBulk {
    /** Pieces to a request: each is a trip to the database, and a request should not run for minutes. */
    const val perRequest = 20

    /**
     * The weights in a pasted list (lib/bulk-pieces.ts `pastedWeights`, the page's `handlePasteWeights`): every run of
     * digits and dots read as a number, those above 0 kept.
     */
    fun weights(text: String): List<Double> {
        val found = ArrayList<Double>()
        val run = StringBuilder()
        // The space at the end closes the last run.
        for (ch in "$text ") {
            if (ch in '0'..'9' || ch == '.') {
                run.append(ch)
                continue
            }
            val n = number(run.toString())
            if (n != null && n > 0) found += n
            run.setLength(0)
        }
        return found
    }

    /** JavaScript's `Number()` of a run of digits and dots: null where that is NaN (a lone dot, "1.2.3"). */
    private fun number(run: String): Double? {
        if (run.isEmpty()) return null
        val dots = run.count { it == '.' }
        if (dots > 1 || run.none { it != '.' }) return null
        var s = run
        if (s.startsWith(".")) s = "0$s"
        if (s.endsWith(".")) s += "0"
        return s.toDoubleOrNull()?.takeIf { it.isFinite() }
    }

    /**
     * The name a row's piece is given (lib/bulk-pieces.ts `bulkPieceName`): prefix and suffix, spaced, trimmed. Blank is
     * no name: the ERP makes one from the category and the SKU.
     */
    fun name(prefix: String, suffix: String): String =
        listOf(prefix, suffix).map { NewOrderFormat.trim(it) }.filter { it.isNotEmpty() }.joinToString(" ")

    /** The shared setup as the page opens it: the house's metal with no stones, wastage and making at nothing. */
    fun freshSetup(): StockPieceFields = StockPieceFields(wastage = "", hasStones = false).settle(keepWastage = true)

    /** One row's piece: the shared setup with this row's weight and name, as the single form would send it. */
    fun piece(shared: StockPieceFields, prefix: String, row: StockBulkRow): StockPieceFields =
        shared.copy(weight = row.weight, name = name(prefix, row.suffix))

    /** The first thing the ERP would refuse, in the words it uses, with the row it is in. */
    fun firstProblem(shared: StockPieceFields, prefix: String, rows: List<StockBulkRow>): String? {
        if (shared.categoryId.isEmpty()) return "Category is required"
        if (rows.isEmpty()) return "At least one item is required"
        for ((index, row) in rows.withIndex()) {
            piece(shared, prefix, row).problem?.let { return "Piece ${index + 1}: $it" }
        }
        return null
    }

    /** How a run of requests ended: what is in stock, where it stopped, and why. */
    class Outcome(val added: List<String>, val next: Int, val stopped: String?)

    /**
     * Sends the rows [perRequest] to a request (`addProducts`, ops-stock2.ts), stopping at the first refusal or
     * partial answer. [write] is `ErpApi.write`. All are checked before the first is written, so a mistake in row 9
     * leaves nothing half in stock; a failure partway leaves what went in, in stock.
     */
    suspend fun add(
        rows: List<StockBulkRow>,
        shared: StockPieceFields,
        prefix: String,
        batch: String,
        write: suspend (String, Map<String, Any?>) -> Map<String, Any?>,
    ): Outcome {
        val added = ArrayList<String>()
        var stopped: String? = null
        var next = 0
        while (next < rows.size) {
            val part = rows.subList(next, minOf(next + perRequest, rows.size))
            try {
                // "part" tells two requests of the same weights apart: the ERP records one request once.
                val out = write("addProducts", mapOf("pieces" to part.map { piece(shared, prefix, it).piece }, "part" to next, "batch" to batch))
                val made = (out["products"] as? List<*>).orEmpty().mapNotNull { it as? Map<*, *> }
                added += made.mapNotNull { it["sku"] as? String }
                if (out["partial"] == true) {
                    next = minOf(next + made.size, rows.size)
                    stopped = out["error"] as? String ?: "Not saved."
                    break
                }
                next += part.size
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                stopped = e.message ?: e.toString()
                break
            }
        }
        return Outcome(added, next, stopped)
    }
}
