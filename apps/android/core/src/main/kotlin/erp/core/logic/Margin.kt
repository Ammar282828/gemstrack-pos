// Ported from src/lib/margin.ts (tests: MarginTests, from margin.test.ts).
//
// SHOP-ONLY: what the shop earns is for owners' and staff's own screens; a customer must never
// see a margin (not on an invoice, an estimate, a PDF, a WhatsApp message or a shared link).
//
// What the shop earns on a sale or an order, as a percentage — for the shop's own screens only
// (owners and staff: the owner, 2026-10-05, "just make sure the customer does not get any of this").
//
// The cost (the owner, 2026-10-05): "whatever the weight of the jewellery we're trying to sell is,
// we basically get that in 24 karat minus 6 ratti". A tola is 96 ratti, so a gram of jewellery
// costs the 24k rate × (96 − 6) / 96 = 93.75% of it. The 24k rate is the one typed when the order
// or sale was made (`costRate24k`) — "ask for the 24 karat rate at that point. If given … calculate
// the percentage. If it is not given, then assume a 10% profit. For all the previous recorded
// stuff keep the profit as 10 percent." So nothing here reads a stored selling rate: an order or
// sale without its own typed 24k rate is 10%, as everything before 2026-10-05 is.
//
// Per piece: gold with a weight is its metal (weight less stones) at that cost, plus its stone and
// diamond charges at what they were charged (no margin assumed on them). A piece that can't be
// costed that way (no weight, not gold) is taken at the 10% the rest of the sale isn't.

package erp.core.logic

import erp.core.models.Invoice
import erp.core.models.Order
import kotlin.math.abs

/** Ratti in a tola: 24k is the whole of it. */
const val RATTI_PER_TOLA = 96.0

/**
 * The two variables a house sets for this file (NEXT_PUBLIC_STORE_COST_RATTI_LESS and
 * NEXT_PUBLIC_STORE_EST_MARGIN in apphosting.*.yaml), which the TS reads once from the environment.
 * The functions below take them as `settings` and default to Taheri's, as the code's defaults are.
 */
data class MarginSettings(
    /** How many ratti short of 24k the shop's jewellery costs it (COST_RATTI_LESS); null when this house doesn't cost by gold (Mina's "none"): every figure is then the old estimate. */
    var rattiLess: Double?,
    /** The figure used where there is no 24k rate to cost with: everything recorded before, and anything not gold (ASSUMED_MARGIN, STORE_EST_MARGIN). */
    var assumedMargin: Double,
) {
    companion object {
        val taheri = MarginSettings(rattiLess = 6.0, assumedMargin = 0.10)

        /** Mina's silver is not costed by gold, and its estimate is 40% (apphosting.mina.yaml). */
        val mina = MarginSettings(rattiLess = null, assumedMargin = 0.40)
        val default = taheri

        /**
         * The variables as text, read the way store-config.ts and margin.ts read them: empty is unset
         * (the default: 6 ratti, 10%), and a figure outside its range (ratti 0 up to 96, a margin from
         * 0 up to 1) or "none" is off for ratti and 10% for the margin.
         */
        fun parse(costRattiLess: String?, estMargin: String?): MarginSettings {
            // `(env || '6').trim()`: only a truly empty variable is unset; blanks trim to nothing, which is off.
            val rawRatti = JS.trim(if ((costRattiLess ?: "").isEmpty()) "6" else costRattiLess!!)
            val ratti = JS.toNumber(rawRatti)
            val rawMargin = JS.trim(estMargin ?: "")
            val margin = JS.toNumber(rawMargin)
            return MarginSettings(
                rattiLess = if (rawRatti.isNotEmpty() && ratti.isFinite() && ratti >= 0 && ratti < RATTI_PER_TOLA) ratti else null,
                assumedMargin = if (rawMargin.isNotEmpty() && margin.isFinite() && margin >= 0 && margin < 1) margin else 0.10,
            )
        }
    }
}

/** One gram of jewellery, to the shop, at this 24k rate. */
fun goldCostPerGram(rate24k: Double, rattiLess: Double = MarginSettings.default.rattiLess ?: 0.0): Double =
    (if (rate24k.isNaN()) 0.0 else rate24k) * (RATTI_PER_TOLA - rattiLess) / RATTI_PER_TOLA

/** `typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0` for a number already in hand. */
private fun n(v: Double?): Double = if (v == null || !v.isFinite()) 0.0 else v

/** A piece, as any of the screens hold it. Weight, stones and charges are per piece; price is the line's. */
data class MarginLine(
    var metalType: String? = null,
    var karat: String? = null,
    var weightG: Double? = null,
    var stoneWeightG: Double? = null,
    var quantity: Double? = null,
    /** What the line comes to (all its pieces). */
    var price: Double,
    var stoneCharges: Double? = null,
    var diamondCharges: Double? = null,
    /** A gold coin is pure metal, sold near the 24k rate: costed at its own karat, not jewellery's. */
    var isCoin: Boolean = false,
    /** Sold at a fixed price rather than built from the rate. */
    var fixedPrice: Boolean = false,
    /** Diamonds or stones are set in it. */
    var setWithStones: Boolean = false,
)

/** SHOP-ONLY: what the shop earns; never put it on anything a customer sees. */
data class Margin(
    /** Earned, as a percentage of what the sale is worth. */
    val percent: Double,
    /** What the sale is worth (pieces less discount) and what it cost, in rupees. */
    val revenue: Double,
    val cost: Double,
    val profit: Double,
    /** True when no 24k rate was given (or this house doesn't cost by gold): the 10% assumption. */
    val assumed: Boolean,
    /** The share of the pieces' value that was costed from the gold; the rest was taken at 10%. */
    val costedShare: Double,
)

data class LineCost(val cost: Double, val costed: Boolean)

fun lineCost(l: MarginLine, rate24k: Double, settings: MarginSettings = MarginSettings.default): LineCost {
    val qty = if (n(l.quantity) == 0.0) 1.0 else n(l.quantity)
    val price = n(l.price)
    val weight = n(l.weightG)
    // A fixed price with diamonds or stones in it: their cost is inside the price and written nowhere, so
    // costing it from the gold alone would read a diamond ring as 90% profit. Taken at 10%, as before it
    // had a weight (2026-10-07: fixed-price pieces can carry their weight). Plain gold at a fixed price
    // is costed from its gold like any other.
    val rattiLess = settings.rattiLess
    if (rattiLess == null || !(rate24k > 0) || l.metalType != "gold" || !(weight > 0) || (l.fixedPrice && l.setWithStones)) {
        return LineCost(cost = price * (1 - settings.assumedMargin), costed = false)
    }
    val net = maxOf(0.0, weight - n(l.stoneWeightG))
    val karat = JS.parseInt(l.karat ?: "")
    val perGram = if (l.isCoin && karat > 0) n(rate24k) * minOf(24.0, karat) / 24 else goldCostPerGram(rate24k, rattiLess = rattiLess)
    return LineCost(cost = (net * perGram + n(l.stoneCharges) + n(l.diamondCharges)) * qty, costed = true)
}

/**
 * SHOP-ONLY (a customer must never see a margin).
 * The margin on a set of pieces worth `revenue` (their total less any discount; an exchange is
 * payment, not a discount, so it stays in). No 24k rate: the assumed 10%.
 */
fun marginOf(lines: List<MarginLine>, revenue: Double, rate24k: Double? = null, settings: MarginSettings = MarginSettings.default): Margin {
    val worth = n(revenue)
    val r24 = n(rate24k)
    if (settings.rattiLess == null || !(r24 > 0) || lines.isEmpty()) {
        val profit = worth * settings.assumedMargin
        return Margin(percent = settings.assumedMargin * 100, revenue = worth, cost = worth - profit, profit = profit, assumed = true, costedShare = 0.0)
    }
    var cost = 0.0
    var costedValue = 0.0
    var value = 0.0
    for (l in lines) {
        val c = lineCost(l, rate24k = r24, settings = settings)
        cost += c.cost
        value += n(l.price)
        if (c.costed) costedValue += n(l.price)
    }
    val profit = worth - cost
    return Margin(
        percent = if (worth > 0) profit / worth * 100 else 0.0,
        revenue = worth, cost = cost, profit = profit, assumed = false,
        costedShare = if (value > 0) costedValue / value else 0.0,
    )
}

// The shapes the ERP keeps

private const val GOLD_COIN_CATEGORY = "cat017"

/** Diamonds or stones in a piece, as any of the shapes records it. */
private fun setWithStones(hasDiamonds: Boolean, hasStones: Boolean, stoneDetails: String?, diamondDetails: String?, stoneWeightG: Double): Boolean =
    hasDiamonds || hasStones || JS.trim(stoneDetails ?: "").isNotEmpty() || JS.trim(diamondDetails ?: "").isNotEmpty() || n(stoneWeightG) > 0

/** SHOP-ONLY (a customer must never see a margin). A sale: its pieces, worth their total less the discount. */
fun invoiceMargin(inv: Invoice, settings: MarginSettings = MarginSettings.default): Margin {
    val lines = inv.items.map { it ->
        MarginLine(
            metalType = it.metalType.rawValue, karat = it.karat?.rawValue, weightG = it.metalWeightG, stoneWeightG = it.stoneWeightG,
            quantity = it.quantity, price = n(it.itemTotal), stoneCharges = it.stoneChargesIfAny, diamondCharges = it.diamondChargesIfAny,
            isCoin = it.categoryId == GOLD_COIN_CATEGORY,
            fixedPrice = it.isCustomPrice || it.isManualPrice,
            setWithStones = setWithStones(it.hasDiamonds, it.hasStones, it.stoneDetails, it.diamondDetails, it.stoneWeightG),
        )
    }
    val sum = lines.fold(0.0) { acc, l -> acc + l.price }
    val value = if (n(inv.subtotal) == 0.0) sum else n(inv.subtotal)
    return marginOf(lines, revenue = value - n(inv.discountAmount), rate24k = inv.costRate24k, settings = settings)
}

/**
 * SHOP-ONLY (a customer must never see a margin).
 * An order: each piece at its agreed or estimated price, less the discount. `prices` are the live
 * figures on the form, one per piece, in place of the saved ones.
 */
fun orderMargin(order: Order, prices: List<Double>? = null, settings: MarginSettings = MarginSettings.default): Margin {
    val lines = order.items.mapIndexed { i, it ->
        MarginLine(
            metalType = it.metalType.rawValue, karat = it.karat?.rawValue, weightG = it.estimatedWeightG, stoneWeightG = it.stoneWeightG,
            price = if (prices != null) (if (i < prices.size) n(prices[i]) else 0.0) else n(if (it.isManualPrice) it.manualPrice else it.totalEstimate),
            // A fixed price holds whatever stones it has; the charges only exist when it is priced by weight.
            stoneCharges = if (it.isManualPrice) 0.0 else it.stoneCharges,
            diamondCharges = if (it.isManualPrice || !it.hasDiamonds) 0.0 else it.diamondCharges,
            fixedPrice = it.isManualPrice,
            setWithStones = setWithStones(it.hasDiamonds, it.hasStones, it.stoneDetails, it.diamondDetails, it.stoneWeightG),
        )
    }
    val sum = lines.fold(0.0) { acc, l -> acc + l.price }
    val value = if (prices != null) sum else (if (n(order.subtotal) == 0.0) sum else n(order.subtotal))
    return marginOf(lines, revenue = value - n(order.discountAmount), rate24k = order.costRate24k, settings = settings)
}

/** SHOP-ONLY (a customer must never see a margin). "18.2%": one decimal under 10, none above, the way the counter reads it. */
fun percentLabel(m: Margin): String =
    "${if (abs(m.percent) < 10) JS.toFixed(m.percent, 1) else JS.number(JS.round(m.percent))}%"
