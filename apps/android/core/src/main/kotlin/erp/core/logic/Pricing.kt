// Ported from src/lib/pricing.ts (tests: PricingTests; pricing.ts has no test of its own, so the
// expected figures there were taken from running the TypeScript itself).
//
// What a piece costs, and therefore what it sells for.
//
// The one function in the codebase where two versions quietly disagreeing would be worst
// (pricing.ts says so), so this is a line-for-line port and not a Kotlin-shaped rewrite: the same
// branches in the same order, and the same additions in the same order (a double's sum depends on
// it), so a price comes out to the last bit as the web ERP's. Pure: a piece and a rate card in,
// money out.
//
// JavaScript reads numbers more loosely than Kotlin does, and the TS leans on it everywhere:
// `Number(x) || 0` turns a NaN into 0, `a || b` takes the second when the first is 0 or NaN,
// and a rate that is missing, 0 or NaN fails `rate > 0` alike. `JS.orZero` / `JS.truthy` are
// those, so a reader can see where the port is exact on purpose. The console logging is left out.

package erp.core.logic

import erp.core.models.InvoiceItem
import erp.core.models.KaratValue
import erp.core.models.MetalType
import erp.core.models.OrderItem
import erp.core.models.Product
import erp.core.models.Rates
import erp.core.models.Settings

/** Gold with no karat recorded is priced as 21k, the shop's common case. (TS `DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL`; store.ts re-exports it without the suffix.) */
val DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL: KaratValue = KaratValue.k21

/** Coins are sold by metal weight alone, with no making or wastage. (TS `GOLD_COIN_CATEGORY_ID_INTERNAL`.) */
const val GOLD_COIN_CATEGORY_ID_INTERNAL = "cat017"

// What the function reads

/**
 * The piece `calculateProductCosts` prices: exactly the fields pricing.ts reads off its
 * product-like argument, and nothing else (the TS also accepts `name`, which it reads only for a
 * console warning, so it is not here). A stocked `Product`, a sold `InvoiceItem` and an order's
 * `OrderItem` each turn into one; a piece being typed in the cart is built by hand.
 */
data class PricedPiece(
    /** `cat017` with gold is a coin: metal weight alone. */
    var categoryId: String? = null,
    var metalType: MetalType,
    /** Gold with none is 21k; palladium with none takes its flat rate. */
    var karat: KaratValue? = null,
    var metalWeightG: Double,
    var secondaryMetalType: MetalType? = null,
    var secondaryMetalKarat: KaratValue? = null,
    var secondaryMetalWeightG: Double? = null,
    var stoneWeightG: Double = 0.0,
    var wastagePercentage: Double = 0.0,
    var makingCharges: Double = 0.0,
    var hasDiamonds: Boolean = false,
    var diamondCharges: Double = 0.0,
    var stoneCharges: Double = 0.0,
    var miscCharges: Double = 0.0,
    /** Sold at `customPrice` whatever the weights say. */
    var isCustomPrice: Boolean = false,
    var customPrice: Double? = null,
    /** A silver piece's own all-in rate; the shop's silver rate when absent or 0. */
    var silverRatePerGram: Double? = null,
) {
    /** A piece in stock: what the products page prices (`calculateProductPrice(product, settings)`). */
    constructor(product: Product) : this(
        categoryId = product.categoryId, metalType = product.metalType, karat = product.karat,
        metalWeightG = product.metalWeightG,
        secondaryMetalType = product.secondaryMetalType, secondaryMetalKarat = product.secondaryMetalKarat,
        secondaryMetalWeightG = product.secondaryMetalWeightG,
        stoneWeightG = product.stoneWeightG, wastagePercentage = product.wastagePercentage,
        makingCharges = product.makingCharges, hasDiamonds = product.hasDiamonds,
        diamondCharges = product.diamondCharges, stoneCharges = product.stoneCharges,
        miscCharges = product.miscCharges, isCustomPrice = product.isCustomPrice,
        customPrice = product.customPrice, silverRatePerGram = product.silverRatePerGram,
    )

    /**
     * A sold line, priced again as an edit of the invoice prices it: `loadCartFromInvoice`
     * (store.ts) is the mapping. The invoice line has no second metal and no `customPrice`: a
     * fixed-price line (`isCustomPrice`, or `isManualPrice` from an order) keeps its price as
     * `unitPrice`. Its charges are 0 on such a line, so its flags and notes say what is set in it.
     */
    constructor(item: InvoiceItem) : this(
        categoryId = item.categoryId, metalType = item.metalType, karat = item.karat,
        metalWeightG = item.metalWeightG,
        stoneWeightG = item.stoneWeightG, wastagePercentage = item.wastagePercentage,
        makingCharges = item.makingCharges,
        hasDiamonds = JS.truthy(item.diamondChargesIfAny) || item.hasDiamonds || JS.has(item.diamondDetails?.let { JS.trim(it) }),
        diamondCharges = item.diamondChargesIfAny, stoneCharges = item.stoneChargesIfAny,
        miscCharges = item.miscChargesIfAny,
        isCustomPrice = item.isCustomPrice || item.isManualPrice,
        customPrice = if (item.isCustomPrice || item.isManualPrice) item.unitPrice else null,
        silverRatePerGram = if (JS.truthy(item.silverRatePerGram)) item.silverRatePerGram else null,
    )

    /**
     * An order's piece, priced the way the order form prices it (`priceOfItem`, `liveEstimate`):
     * the estimated weight, no category (so never a coin), and no miscellaneous charge. The order
     * form takes a fixed price (`isManualPrice`) before it asks pricing at all; here it is the
     * custom price, which is the same figure (`manualPrice || 0`), as `loadCartFromInvoice` also
     * treats the two as one.
     */
    constructor(item: OrderItem) : this(
        categoryId = null, metalType = item.metalType, karat = item.karat,
        metalWeightG = item.estimatedWeightG,
        stoneWeightG = item.stoneWeightG, wastagePercentage = item.wastagePercentage,
        makingCharges = item.makingCharges, hasDiamonds = item.hasDiamonds,
        diamondCharges = item.diamondCharges, stoneCharges = item.stoneCharges, miscCharges = 0.0,
        isCustomPrice = item.isManualPrice, customPrice = item.manualPrice,
    )
}

/**
 * The rate card the function reads, PKR per gram: the shop's `Settings` rates, or the ones a
 * sale or an order was priced at (`ratesApplied`). A rate that is absent, 0 or not a number
 * prices nothing, alike, so a rate never given is 0 here.
 */
data class PricingRates(
    var goldRatePerGram24k: Double = 0.0,
    var goldRatePerGram22k: Double = 0.0,
    var goldRatePerGram21k: Double = 0.0,
    var goldRatePerGram18k: Double = 0.0,
    /** Palladium, flat: the fallback when a piece has no karat or its karat's rate is 0. */
    var palladiumRatePerGram: Double = 0.0,
    var palladiumRatePerGram18k: Double = 0.0,
    var palladiumRatePerGram12k: Double = 0.0,
    var platinumRatePerGram: Double = 0.0,
    var silverRatePerGram: Double = 0.0,
) {
    /** The rates a sale or an order was priced at; whichever it did not carry is 0. */
    constructor(rates: Rates) : this(
        goldRatePerGram24k = rates.goldRatePerGram24k ?: 0.0, goldRatePerGram22k = rates.goldRatePerGram22k ?: 0.0,
        goldRatePerGram21k = rates.goldRatePerGram21k ?: 0.0, goldRatePerGram18k = rates.goldRatePerGram18k ?: 0.0,
        palladiumRatePerGram = rates.palladiumRatePerGram ?: 0.0,
        palladiumRatePerGram18k = rates.palladiumRatePerGram18k ?: 0.0,
        palladiumRatePerGram12k = rates.palladiumRatePerGram12k ?: 0.0,
        platinumRatePerGram = rates.platinumRatePerGram ?: 0.0, silverRatePerGram = rates.silverRatePerGram ?: 0.0,
    )

    /** Today's rates, as the products page passes `settings` itself (per-karat palladium included). */
    constructor(settings: Settings) : this(
        goldRatePerGram24k = settings.goldRatePerGram24k, goldRatePerGram22k = settings.goldRatePerGram22k,
        goldRatePerGram21k = settings.goldRatePerGram21k, goldRatePerGram18k = settings.goldRatePerGram18k,
        palladiumRatePerGram = settings.palladiumRatePerGram,
        palladiumRatePerGram18k = settings.palladiumRatePerGram18k,
        palladiumRatePerGram12k = settings.palladiumRatePerGram12k,
        platinumRatePerGram = settings.platinumRatePerGram, silverRatePerGram = settings.silverRatePerGram,
    )

    /**
     * The same card without the two per-karat palladium rates, as `orderInvoiceRates` (and the
     * store's `calculateProductCosts` wrapper) build theirs from the settings: palladium is then
     * priced at the flat rate whatever its karat.
     */
    internal val flatPalladiumOnly: PricingRates
        get() = copy(palladiumRatePerGram18k = 0.0, palladiumRatePerGram12k = 0.0)
}

/** What `calculateProductCosts` answers: the pieces of the price, and the price. */
data class ProductCosts(
    var metalCost: Double = 0.0,
    var wastageCost: Double = 0.0,
    var makingCharges: Double = 0.0,
    var diamondCharges: Double = 0.0,
    var stoneCharges: Double = 0.0,
    var miscCharges: Double = 0.0,
    var totalPrice: Double = 0.0,
)

// Pricing

/** The rate of one gold karat (TS `_getRateForKarat`). No karat is the default one; a karat gold is not sold in is worth nothing. */
private fun rateForKarat(karat: KaratValue?, rates: PricingRates): Double {
    val recorded = karat?.rawValue ?: ""
    val k = if (recorded.isEmpty()) DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL.rawValue else recorded
    return when (k) {
        "24k" -> rates.goldRatePerGram24k
        "22k" -> rates.goldRatePerGram22k
        "21k" -> rates.goldRatePerGram21k
        "18k" -> rates.goldRatePerGram18k
        else -> 0.0
    }
}

/** One metal's cost: its weight (never below 0) at its rate (TS `_calculateSingleMetalCost`). */
private fun calculateSingleMetalCost(metalType: MetalType, karat: KaratValue?, weightG: Double, rates: PricingRates): Double {
    var cost = 0.0
    val validWeightG = JS.atLeastZero(JS.orZero(weightG))

    if (metalType == MetalType.gold) {
        val rate = rateForKarat(karat, rates)
        if (rate > 0) {
            cost = validWeightG * rate
        }
    } else if (metalType == MetalType.palladium) {
        // Per-karat first, flat rate second. The flat rate is what every palladium piece before
        // this was priced from, so it has to keep working -- and a shop that has not filled in
        // the two new figures yet must not silently price palladium at zero.
        val k = karat?.rawValue ?: ""
        val perKarat = if (k == "18k") rates.palladiumRatePerGram18k else if (k == "12k") rates.palladiumRatePerGram12k else 0.0
        val rate = if (perKarat > 0) perKarat else rates.palladiumRatePerGram
        if (rate > 0) cost = validWeightG * rate
    } else if (metalType == MetalType.platinum && rates.platinumRatePerGram > 0) {
        cost = validWeightG * rates.platinumRatePerGram
    } else if (metalType == MetalType.silver && rates.silverRatePerGram > 0) {
        cost = validWeightG * rates.silverRatePerGram
    }
    return cost
}

/**
 * What a piece costs, part by part, and what it sells for.
 *
 * TS `_calculateProductCostsInternal`. In order: a custom price is the price; silver is its
 * weight at one all-in rate (making and wastage bundled in) plus the charges; everything else is
 * the metal less its stones, plus a second metal, plus wastage (a percentage of the metal), making,
 * diamonds (only if the piece has them), stones and sundries. A gold coin takes the metal alone.
 * A price that comes out as NaN is answered as all zeros, as the TS does.
 */
fun calculateProductCosts(product: PricedPiece, rates: PricingRates): ProductCosts {
    // If manual price override is active, just return that price.
    if (product.isCustomPrice) {
        return ProductCosts(totalPrice = JS.orZero(product.customPrice))
    }

    // Special simplified calculation for silver.
    if (product.metalType == MetalType.silver) {
        // Prioritize the product-specific rate, fall back to the global rate.
        val silverRatePerGram = if (JS.truthy(product.silverRatePerGram)) product.silverRatePerGram!!
        else if (JS.truthy(rates.silverRatePerGram)) rates.silverRatePerGram else 0.0

        // For silver, the provided rate is all-inclusive for metal, making, and wastage.
        val allInSilverCost = JS.orZero(product.metalWeightG) * silverRatePerGram

        val stoneChargesValue = JS.orZero(product.stoneCharges)
        val miscChargesValue = JS.orZero(product.miscCharges)
        val diamondChargesValue = JS.orZero(product.diamondCharges)

        val totalPrice = allInSilverCost + stoneChargesValue + diamondChargesValue + miscChargesValue

        if (totalPrice.isNaN()) return ProductCosts()

        return ProductCosts(
            metalCost = allInSilverCost, // The (rate * grams) part.
            wastageCost = 0.0, // Considered bundled into the rate.
            makingCharges = 0.0, // Considered bundled into the rate.
            diamondCharges = diamondChargesValue,
            stoneCharges = stoneChargesValue,
            miscCharges = miscChargesValue,
            totalPrice = totalPrice,
        )
    }

    // Gold, platinum, palladium.
    val primaryMetalNetWeightG = JS.atLeastZero(JS.orZero(product.metalWeightG) - JS.orZero(product.stoneWeightG))

    val primaryMetalCost = calculateSingleMetalCost(product.metalType, product.karat, primaryMetalNetWeightG, rates)

    var secondaryMetalCost = 0.0
    val secondaryType = product.secondaryMetalType
    if (secondaryType != null && JS.has(secondaryType.rawValue) && JS.truthy(product.secondaryMetalWeightG)) {
        secondaryMetalCost = calculateSingleMetalCost(secondaryType, product.secondaryMetalKarat, product.secondaryMetalWeightG!!, rates)
    }

    val totalMetalCost = primaryMetalCost + secondaryMetalCost

    val isActualGoldCoin = product.categoryId == GOLD_COIN_CATEGORY_ID_INTERNAL && product.metalType == MetalType.gold
    // Exclude silver from wastage calculation.
    val applyWastage = product.metalType == MetalType.gold || product.metalType == MetalType.platinum || product.metalType == MetalType.palladium
    val wastagePercentage = if (isActualGoldCoin || !applyWastage) 0.0 else JS.orZero(product.wastagePercentage)
    val makingCharges = if (isActualGoldCoin) 0.0 else JS.orZero(product.makingCharges)
    val hasDiamondsValue = if (isActualGoldCoin) false else product.hasDiamonds
    val diamondChargesValue = if (hasDiamondsValue) JS.orZero(product.diamondCharges) else 0.0
    val stoneChargesValue = if (isActualGoldCoin) 0.0 else JS.orZero(product.stoneCharges)
    val miscChargesValue = if (isActualGoldCoin) 0.0 else JS.orZero(product.miscCharges)

    val wastageCost = totalMetalCost * (wastagePercentage / 100)
    val validWastageCost = JS.orZero(wastageCost)
    val totalPrice = totalMetalCost + validWastageCost + makingCharges + diamondChargesValue + stoneChargesValue + miscChargesValue

    if (totalPrice.isNaN()) return ProductCosts()

    return ProductCosts(
        metalCost = totalMetalCost,
        wastageCost = validWastageCost,
        makingCharges = makingCharges,
        diamondCharges = diamondChargesValue,
        stoneCharges = stoneChargesValue,
        miscCharges = miscChargesValue,
        totalPrice = totalPrice,
    )
}

/** Public helper: the selling price of a piece at the given rates (TS `calculateProductPrice`). */
fun calculateProductPrice(product: PricedPiece, rates: PricingRates): Double = calculateProductCosts(product, rates).totalPrice
