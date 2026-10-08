// Ported from src/lib/pricing.ts (tests: PricingTests; pricing.ts has no test of its own, so the
// expected figures there were taken from running the TypeScript itself).
//
// What a piece costs, and therefore what it sells for.
//
// The one function in the codebase where two versions quietly disagreeing would be worst
// (pricing.ts says so), so this is a line-for-line port and not a Swift-shaped rewrite: the same
// branches in the same order, and the same additions in the same order (a double's sum depends on
// it), so a price comes out to the last bit as the web ERP's. Pure: a piece and a rate card in,
// money out.
//
// JavaScript reads numbers more loosely than Swift does, and the TS leans on it everywhere:
// `Number(x) || 0` turns a NaN into 0, `a || b` takes the second when the first is 0 or NaN,
// and a rate that is missing, 0 or NaN fails `rate > 0` alike. `JS.orZero` / `JS.truthy` below
// are those, so a reader can see where the port is exact on purpose. The console logging is left out.

import Foundation

/// Gold with no karat recorded is priced as 21k, the shop's common case.
/// (TS `DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL`; store.ts re-exports it without the suffix.)
public let DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL: KaratValue = .k21

/// Coins are sold by metal weight alone, with no making or wastage.
/// (TS `GOLD_COIN_CATEGORY_ID_INTERNAL`.)
public let GOLD_COIN_CATEGORY_ID_INTERNAL = "cat017"

// MARK: What the function reads

/// The piece `calculateProductCosts` prices: exactly the fields pricing.ts reads off its
/// product-like argument, and nothing else (the TS also accepts `name`, which it reads only for a
/// console warning, so it is not here). A stocked `Product`, a sold `InvoiceItem` and an order's
/// `OrderItem` each turn into one; a piece being typed in the cart is built by hand.
public struct PricedPiece: Hashable {
    /// `cat017` with gold is a coin: metal weight alone.
    public var categoryId: String?
    public var metalType: MetalType
    /// Gold with none is 21k; palladium with none takes its flat rate.
    public var karat: KaratValue?
    public var metalWeightG: Double
    public var secondaryMetalType: MetalType?
    public var secondaryMetalKarat: KaratValue?
    public var secondaryMetalWeightG: Double?
    public var stoneWeightG: Double
    public var wastagePercentage: Double
    public var makingCharges: Double
    public var hasDiamonds: Bool
    public var diamondCharges: Double
    public var stoneCharges: Double
    public var miscCharges: Double
    /// Sold at `customPrice` whatever the weights say.
    public var isCustomPrice: Bool
    public var customPrice: Double?
    /// A silver piece's own all-in rate; the shop's silver rate when absent or 0.
    public var silverRatePerGram: Double?

    public init(
        categoryId: String? = nil,
        metalType: MetalType,
        karat: KaratValue? = nil,
        metalWeightG: Double,
        secondaryMetalType: MetalType? = nil,
        secondaryMetalKarat: KaratValue? = nil,
        secondaryMetalWeightG: Double? = nil,
        stoneWeightG: Double = 0,
        wastagePercentage: Double = 0,
        makingCharges: Double = 0,
        hasDiamonds: Bool = false,
        diamondCharges: Double = 0,
        stoneCharges: Double = 0,
        miscCharges: Double = 0,
        isCustomPrice: Bool = false,
        customPrice: Double? = nil,
        silverRatePerGram: Double? = nil
    ) {
        self.categoryId = categoryId
        self.metalType = metalType
        self.karat = karat
        self.metalWeightG = metalWeightG
        self.secondaryMetalType = secondaryMetalType
        self.secondaryMetalKarat = secondaryMetalKarat
        self.secondaryMetalWeightG = secondaryMetalWeightG
        self.stoneWeightG = stoneWeightG
        self.wastagePercentage = wastagePercentage
        self.makingCharges = makingCharges
        self.hasDiamonds = hasDiamonds
        self.diamondCharges = diamondCharges
        self.stoneCharges = stoneCharges
        self.miscCharges = miscCharges
        self.isCustomPrice = isCustomPrice
        self.customPrice = customPrice
        self.silverRatePerGram = silverRatePerGram
    }

    /// A piece in stock: what the products page prices (`calculateProductPrice(product, settings)`).
    public init(_ product: Product) {
        self.init(
            categoryId: product.categoryId, metalType: product.metalType, karat: product.karat,
            metalWeightG: product.metalWeightG,
            secondaryMetalType: product.secondaryMetalType, secondaryMetalKarat: product.secondaryMetalKarat,
            secondaryMetalWeightG: product.secondaryMetalWeightG,
            stoneWeightG: product.stoneWeightG, wastagePercentage: product.wastagePercentage,
            makingCharges: product.makingCharges, hasDiamonds: product.hasDiamonds,
            diamondCharges: product.diamondCharges, stoneCharges: product.stoneCharges,
            miscCharges: product.miscCharges, isCustomPrice: product.isCustomPrice,
            customPrice: product.customPrice, silverRatePerGram: product.silverRatePerGram
        )
    }

    /// A sold line, priced again as an edit of the invoice prices it: `loadCartFromInvoice`
    /// (store.ts) is the mapping. The invoice line has no second metal and no `customPrice`: a
    /// fixed-price line (`isCustomPrice`, or `isManualPrice` from an order) keeps its price as
    /// `unitPrice`. Its charges are 0 on such a line, so its flags and notes say what is set in it.
    public init(_ item: InvoiceItem) {
        let fixed = item.isCustomPrice || item.isManualPrice
        self.init(
            categoryId: item.categoryId, metalType: item.metalType, karat: item.karat,
            metalWeightG: item.metalWeightG,
            stoneWeightG: item.stoneWeightG, wastagePercentage: item.wastagePercentage,
            makingCharges: item.makingCharges,
            hasDiamonds: JS.truthy(item.diamondChargesIfAny) || item.hasDiamonds || JS.has(item.diamondDetails.map(JS.trim)),
            diamondCharges: item.diamondChargesIfAny, stoneCharges: item.stoneChargesIfAny,
            miscCharges: item.miscChargesIfAny,
            isCustomPrice: fixed, customPrice: fixed ? item.unitPrice : nil,
            silverRatePerGram: JS.truthy(item.silverRatePerGram) ? item.silverRatePerGram : nil
        )
    }

    /// An order's piece, priced the way the order form prices it (`priceOfItem`, `liveEstimate`):
    /// the estimated weight, no category (so never a coin), and no miscellaneous charge. The order
    /// form takes a fixed price (`isManualPrice`) before it asks pricing at all; here it is the
    /// custom price, which is the same figure (`manualPrice || 0`), as `loadCartFromInvoice` also
    /// treats the two as one.
    public init(_ item: OrderItem) {
        self.init(
            categoryId: nil, metalType: item.metalType, karat: item.karat,
            metalWeightG: item.estimatedWeightG,
            stoneWeightG: item.stoneWeightG, wastagePercentage: item.wastagePercentage,
            makingCharges: item.makingCharges, hasDiamonds: item.hasDiamonds,
            diamondCharges: item.diamondCharges, stoneCharges: item.stoneCharges, miscCharges: 0,
            isCustomPrice: item.isManualPrice, customPrice: item.manualPrice
        )
    }
}

/// The rate card the function reads, PKR per gram: the shop's `Settings` rates, or the ones a
/// sale or an order was priced at (`ratesApplied`). A rate that is absent, 0 or not a number
/// prices nothing, alike, so a rate never given is 0 here.
public struct PricingRates: Hashable {
    public var goldRatePerGram24k: Double
    public var goldRatePerGram22k: Double
    public var goldRatePerGram21k: Double
    public var goldRatePerGram18k: Double
    /// Palladium, flat: the fallback when a piece has no karat or its karat's rate is 0.
    public var palladiumRatePerGram: Double
    public var palladiumRatePerGram18k: Double
    public var palladiumRatePerGram12k: Double
    public var platinumRatePerGram: Double
    public var silverRatePerGram: Double

    public init(
        goldRatePerGram24k: Double = 0, goldRatePerGram22k: Double = 0,
        goldRatePerGram21k: Double = 0, goldRatePerGram18k: Double = 0,
        palladiumRatePerGram: Double = 0, palladiumRatePerGram18k: Double = 0, palladiumRatePerGram12k: Double = 0,
        platinumRatePerGram: Double = 0, silverRatePerGram: Double = 0
    ) {
        self.goldRatePerGram24k = goldRatePerGram24k
        self.goldRatePerGram22k = goldRatePerGram22k
        self.goldRatePerGram21k = goldRatePerGram21k
        self.goldRatePerGram18k = goldRatePerGram18k
        self.palladiumRatePerGram = palladiumRatePerGram
        self.palladiumRatePerGram18k = palladiumRatePerGram18k
        self.palladiumRatePerGram12k = palladiumRatePerGram12k
        self.platinumRatePerGram = platinumRatePerGram
        self.silverRatePerGram = silverRatePerGram
    }

    /// The rates a sale or an order was priced at; whichever it did not carry is 0.
    public init(_ rates: Rates) {
        self.init(
            goldRatePerGram24k: rates.goldRatePerGram24k ?? 0, goldRatePerGram22k: rates.goldRatePerGram22k ?? 0,
            goldRatePerGram21k: rates.goldRatePerGram21k ?? 0, goldRatePerGram18k: rates.goldRatePerGram18k ?? 0,
            palladiumRatePerGram: rates.palladiumRatePerGram ?? 0,
            palladiumRatePerGram18k: rates.palladiumRatePerGram18k ?? 0,
            palladiumRatePerGram12k: rates.palladiumRatePerGram12k ?? 0,
            platinumRatePerGram: rates.platinumRatePerGram ?? 0, silverRatePerGram: rates.silverRatePerGram ?? 0
        )
    }

    /// Today's rates, as the products page passes `settings` itself (per-karat palladium included).
    public init(_ settings: Settings) {
        self.init(
            goldRatePerGram24k: settings.goldRatePerGram24k, goldRatePerGram22k: settings.goldRatePerGram22k,
            goldRatePerGram21k: settings.goldRatePerGram21k, goldRatePerGram18k: settings.goldRatePerGram18k,
            palladiumRatePerGram: settings.palladiumRatePerGram,
            palladiumRatePerGram18k: settings.palladiumRatePerGram18k,
            palladiumRatePerGram12k: settings.palladiumRatePerGram12k,
            platinumRatePerGram: settings.platinumRatePerGram, silverRatePerGram: settings.silverRatePerGram
        )
    }

    /// The same card without the two per-karat palladium rates, as `orderInvoiceRates` (and the
    /// store's `calculateProductCosts` wrapper) build theirs from the settings: palladium is then
    /// priced at the flat rate whatever its karat.
    var flatPalladiumOnly: PricingRates {
        var flat = self
        flat.palladiumRatePerGram18k = 0
        flat.palladiumRatePerGram12k = 0
        return flat
    }
}

/// What `calculateProductCosts` answers: the pieces of the price, and the price.
public struct ProductCosts: Hashable {
    public var metalCost: Double
    public var wastageCost: Double
    public var makingCharges: Double
    public var diamondCharges: Double
    public var stoneCharges: Double
    public var miscCharges: Double
    public var totalPrice: Double

    public init(
        metalCost: Double = 0, wastageCost: Double = 0, makingCharges: Double = 0,
        diamondCharges: Double = 0, stoneCharges: Double = 0, miscCharges: Double = 0, totalPrice: Double = 0
    ) {
        self.metalCost = metalCost
        self.wastageCost = wastageCost
        self.makingCharges = makingCharges
        self.diamondCharges = diamondCharges
        self.stoneCharges = stoneCharges
        self.miscCharges = miscCharges
        self.totalPrice = totalPrice
    }

    /// Nothing: what a price that came out as NaN is turned into.
    static let zero = ProductCosts()
}

// MARK: JavaScript's number habits, as the three rule files here use them

extension JS {
    /// `Number(x) || 0` for a number in hand: a NaN (and a -0) is 0.
    static func orZero(_ x: Double) -> Double { x.isNaN || x == 0 ? 0 : x }

    /// `Number(x) || 0` for a field that may be absent (`Number(undefined)` is NaN).
    static func orZero(_ x: Double?) -> Double { x.map { orZero($0) } ?? 0 }

    /// JavaScript truthiness of a number: not 0, not NaN, and present.
    static func truthy(_ x: Double?) -> Bool { x.map { !($0.isNaN || $0 == 0) } ?? false }

    /// `Math.max(0, x)`: a NaN stays NaN (Swift's `max` would say 0).
    static func atLeastZero(_ x: Double) -> Double { x.isNaN ? x : (x > 0 ? x : 0) }
}

// MARK: Pricing

/// The rate of one gold karat (TS `_getRateForKarat`). No karat is the default one; a karat gold
/// is not sold in is worth nothing.
private func rateForKarat(_ karat: KaratValue?, _ rates: PricingRates) -> Double {
    let recorded = karat?.rawValue ?? ""
    let k = recorded.isEmpty ? DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL.rawValue : recorded
    switch k {
    case "24k": return rates.goldRatePerGram24k
    case "22k": return rates.goldRatePerGram22k
    case "21k": return rates.goldRatePerGram21k
    case "18k": return rates.goldRatePerGram18k
    default: return 0
    }
}

/// One metal's cost: its weight (never below 0) at its rate (TS `_calculateSingleMetalCost`).
private func calculateSingleMetalCost(_ metalType: MetalType, _ karat: KaratValue?, _ weightG: Double, _ rates: PricingRates) -> Double {
    var cost = 0.0
    let validWeightG = JS.atLeastZero(JS.orZero(weightG))

    if metalType == .gold {
        let rate = rateForKarat(karat, rates)
        if rate > 0 {
            cost = validWeightG * rate
        }
    } else if metalType == .palladium {
        // Per-karat first, flat rate second. The flat rate is what every palladium piece before
        // this was priced from, so it has to keep working -- and a shop that has not filled in
        // the two new figures yet must not silently price palladium at zero.
        let k = karat?.rawValue ?? ""
        let perKarat = k == "18k" ? rates.palladiumRatePerGram18k
            : k == "12k" ? rates.palladiumRatePerGram12k
            : 0
        let rate = perKarat > 0 ? perKarat : rates.palladiumRatePerGram
        if rate > 0 { cost = validWeightG * rate }
    } else if metalType == .platinum && rates.platinumRatePerGram > 0 {
        cost = validWeightG * rates.platinumRatePerGram
    } else if metalType == .silver && rates.silverRatePerGram > 0 {
        cost = validWeightG * rates.silverRatePerGram
    }
    return cost
}

/// What a piece costs, part by part, and what it sells for.
///
/// TS `_calculateProductCostsInternal`. In order: a custom price is the price; silver is its
/// weight at one all-in rate (making and wastage bundled in) plus the charges; everything else is
/// the metal less its stones, plus a second metal, plus wastage (a percentage of the metal), making,
/// diamonds (only if the piece has them), stones and sundries. A gold coin takes the metal alone.
/// A price that comes out as NaN is answered as all zeros, as the TS does.
public func calculateProductCosts(_ product: PricedPiece, _ rates: PricingRates) -> ProductCosts {
    // If manual price override is active, just return that price.
    if product.isCustomPrice {
        return ProductCosts(totalPrice: JS.orZero(product.customPrice))
    }

    // Special simplified calculation for silver.
    if product.metalType == .silver {
        // Prioritize the product-specific rate, fall back to the global rate.
        let silverRatePerGram = JS.truthy(product.silverRatePerGram) ? product.silverRatePerGram!
            : JS.truthy(rates.silverRatePerGram) ? rates.silverRatePerGram : 0

        // For silver, the provided rate is all-inclusive for metal, making, and wastage.
        let allInSilverCost = JS.orZero(product.metalWeightG) * silverRatePerGram

        let stoneChargesValue = JS.orZero(product.stoneCharges)
        let miscChargesValue = JS.orZero(product.miscCharges)
        let diamondChargesValue = JS.orZero(product.diamondCharges)

        let totalPrice = allInSilverCost + stoneChargesValue + diamondChargesValue + miscChargesValue

        if totalPrice.isNaN { return .zero }

        return ProductCosts(
            metalCost: allInSilverCost, // The (rate * grams) part.
            wastageCost: 0, // Considered bundled into the rate.
            makingCharges: 0, // Considered bundled into the rate.
            diamondCharges: diamondChargesValue,
            stoneCharges: stoneChargesValue,
            miscCharges: miscChargesValue,
            totalPrice: totalPrice
        )
    }

    // Gold, platinum, palladium.
    let primaryMetalNetWeightG = JS.atLeastZero(JS.orZero(product.metalWeightG) - JS.orZero(product.stoneWeightG))

    let primaryMetalCost = calculateSingleMetalCost(product.metalType, product.karat, primaryMetalNetWeightG, rates)

    var secondaryMetalCost = 0.0
    if let secondaryType = product.secondaryMetalType, JS.has(secondaryType.rawValue), JS.truthy(product.secondaryMetalWeightG) {
        secondaryMetalCost = calculateSingleMetalCost(secondaryType, product.secondaryMetalKarat, product.secondaryMetalWeightG!, rates)
    }

    let totalMetalCost = primaryMetalCost + secondaryMetalCost

    let isActualGoldCoin = product.categoryId == GOLD_COIN_CATEGORY_ID_INTERNAL && product.metalType == .gold
    // Exclude silver from wastage calculation.
    let applyWastage = product.metalType == .gold || product.metalType == .platinum || product.metalType == .palladium
    let wastagePercentage = isActualGoldCoin || !applyWastage ? 0 : JS.orZero(product.wastagePercentage)
    let makingCharges = isActualGoldCoin ? 0 : JS.orZero(product.makingCharges)
    let hasDiamondsValue = isActualGoldCoin ? false : product.hasDiamonds
    let diamondChargesValue = hasDiamondsValue ? JS.orZero(product.diamondCharges) : 0
    let stoneChargesValue = isActualGoldCoin ? 0 : JS.orZero(product.stoneCharges)
    let miscChargesValue = isActualGoldCoin ? 0 : JS.orZero(product.miscCharges)

    let wastageCost = totalMetalCost * (wastagePercentage / 100)
    let validWastageCost = JS.orZero(wastageCost)
    let totalPrice = totalMetalCost + validWastageCost + makingCharges + diamondChargesValue + stoneChargesValue + miscChargesValue

    if totalPrice.isNaN { return .zero }

    return ProductCosts(
        metalCost: totalMetalCost,
        wastageCost: validWastageCost,
        makingCharges: makingCharges,
        diamondCharges: diamondChargesValue,
        stoneCharges: stoneChargesValue,
        miscCharges: miscChargesValue,
        totalPrice: totalPrice
    )
}

/// Public helper: the selling price of a piece at the given rates (TS `calculateProductPrice`).
public func calculateProductPrice(_ product: PricedPiece, _ rates: PricingRates) -> Double {
    calculateProductCosts(product, rates).totalPrice
}
