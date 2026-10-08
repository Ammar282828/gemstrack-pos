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

import Foundation

/// Ratti in a tola: 24k is the whole of it.
public let RATTI_PER_TOLA = 96.0

/// The two variables a house sets for this file (NEXT_PUBLIC_STORE_COST_RATTI_LESS and
/// NEXT_PUBLIC_STORE_EST_MARGIN in apphosting.*.yaml), which the TS reads once from the environment.
/// The functions below take them as `settings:` and default to Taheri's, as the code's defaults are.
public struct MarginSettings: Equatable {
    /// How many ratti short of 24k the shop's jewellery costs it (COST_RATTI_LESS); nil when this house
    /// doesn't cost by gold (Mina's "none"): every figure is then the old estimate.
    public var rattiLess: Double?
    /// The figure used where there is no 24k rate to cost with: everything recorded before, and
    /// anything not gold (ASSUMED_MARGIN, STORE_EST_MARGIN).
    public var assumedMargin: Double

    public init(rattiLess: Double?, assumedMargin: Double) {
        self.rattiLess = rattiLess
        self.assumedMargin = assumedMargin
    }

    public static let taheri = MarginSettings(rattiLess: 6, assumedMargin: 0.10)
    /// Mina's silver is not costed by gold, and its estimate is 40% (apphosting.mina.yaml).
    public static let mina = MarginSettings(rattiLess: nil, assumedMargin: 0.40)
    public static let `default` = taheri

    /// The variables as text, read the way store-config.ts and margin.ts read them: empty is unset
    /// (the default: 6 ratti, 10%), and a figure outside its range (ratti 0 up to 96, a margin from
    /// 0 up to 1) or "none" is off for ratti and 10% for the margin.
    public static func parse(costRattiLess: String?, estMargin: String?) -> MarginSettings {
        // `(env || '6').trim()`: only a truly empty variable is unset; blanks trim to nothing, which is off.
        let rawRatti = JS.trim((costRattiLess ?? "").isEmpty ? "6" : costRattiLess!)
        let ratti = JS.toNumber(rawRatti)
        let rawMargin = JS.trim(estMargin ?? "")
        let margin = JS.toNumber(rawMargin)
        return MarginSettings(
            rattiLess: !rawRatti.isEmpty && ratti.isFinite && ratti >= 0 && ratti < RATTI_PER_TOLA ? ratti : nil,
            assumedMargin: !rawMargin.isEmpty && margin.isFinite && margin >= 0 && margin < 1 ? margin : 0.10
        )
    }
}

/// One gram of jewellery, to the shop, at this 24k rate.
public func goldCostPerGram(_ rate24k: Double, rattiLess: Double = MarginSettings.default.rattiLess ?? 0) -> Double {
    (rate24k.isNaN ? 0 : rate24k) * (RATTI_PER_TOLA - rattiLess) / RATTI_PER_TOLA
}

/// `typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0` for a number already in hand.
private func n(_ v: Double?) -> Double {
    guard let v, v.isFinite else { return 0 }
    return v
}

/// A piece, as any of the screens hold it. Weight, stones and charges are per piece; price is the line's.
public struct MarginLine: Equatable {
    public var metalType: String?
    public var karat: String?
    public var weightG: Double?
    public var stoneWeightG: Double?
    public var quantity: Double?
    /// What the line comes to (all its pieces).
    public var price: Double
    public var stoneCharges: Double?
    public var diamondCharges: Double?
    /// A gold coin is pure metal, sold near the 24k rate: costed at its own karat, not jewellery's.
    public var isCoin: Bool
    /// Sold at a fixed price rather than built from the rate.
    public var fixedPrice: Bool
    /// Diamonds or stones are set in it.
    public var setWithStones: Bool

    public init(metalType: String? = nil, karat: String? = nil, weightG: Double? = nil, stoneWeightG: Double? = nil,
                quantity: Double? = nil, price: Double, stoneCharges: Double? = nil, diamondCharges: Double? = nil,
                isCoin: Bool = false, fixedPrice: Bool = false, setWithStones: Bool = false) {
        self.metalType = metalType
        self.karat = karat
        self.weightG = weightG
        self.stoneWeightG = stoneWeightG
        self.quantity = quantity
        self.price = price
        self.stoneCharges = stoneCharges
        self.diamondCharges = diamondCharges
        self.isCoin = isCoin
        self.fixedPrice = fixedPrice
        self.setWithStones = setWithStones
    }
}

/// SHOP-ONLY: what the shop earns; never put it on anything a customer sees.
public struct Margin: Equatable {
    /// Earned, as a percentage of what the sale is worth.
    public let percent: Double
    /// What the sale is worth (pieces less discount) and what it cost, in rupees.
    public let revenue: Double
    public let cost: Double
    public let profit: Double
    /// True when no 24k rate was given (or this house doesn't cost by gold): the 10% assumption.
    public let assumed: Bool
    /// The share of the pieces' value that was costed from the gold; the rest was taken at 10%.
    public let costedShare: Double
}

public struct LineCost: Equatable {
    public let cost: Double
    public let costed: Bool
}

public func lineCost(_ l: MarginLine, rate24k: Double, settings: MarginSettings = .default) -> LineCost {
    let qty = n(l.quantity) == 0 ? 1 : n(l.quantity)
    let price = n(l.price)
    let weight = n(l.weightG)
    // A fixed price with diamonds or stones in it: their cost is inside the price and written nowhere, so
    // costing it from the gold alone would read a diamond ring as 90% profit. Taken at 10%, as before it
    // had a weight (2026-10-07: fixed-price pieces can carry their weight). Plain gold at a fixed price
    // is costed from its gold like any other.
    guard let rattiLess = settings.rattiLess, rate24k > 0, l.metalType == "gold", weight > 0, !(l.fixedPrice && l.setWithStones) else {
        return LineCost(cost: price * (1 - settings.assumedMargin), costed: false)
    }
    let net = max(0, weight - n(l.stoneWeightG))
    let karat = JS.parseInt(l.karat ?? "")
    let perGram = l.isCoin && karat > 0 ? n(rate24k) * min(24, karat) / 24 : goldCostPerGram(rate24k, rattiLess: rattiLess)
    return LineCost(cost: (net * perGram + n(l.stoneCharges) + n(l.diamondCharges)) * qty, costed: true)
}

/// SHOP-ONLY (a customer must never see a margin).
/// The margin on a set of pieces worth `revenue` (their total less any discount; an exchange is
/// payment, not a discount, so it stays in). No 24k rate: the assumed 10%.
public func marginOf(_ lines: [MarginLine], revenue: Double, rate24k: Double? = nil, settings: MarginSettings = .default) -> Margin {
    let worth = n(revenue)
    let r24 = n(rate24k)
    guard settings.rattiLess != nil, r24 > 0, !lines.isEmpty else {
        let profit = worth * settings.assumedMargin
        return Margin(percent: settings.assumedMargin * 100, revenue: worth, cost: worth - profit, profit: profit, assumed: true, costedShare: 0)
    }
    var cost = 0.0, costedValue = 0.0, value = 0.0
    for l in lines {
        let c = lineCost(l, rate24k: r24, settings: settings)
        cost += c.cost
        value += n(l.price)
        if c.costed { costedValue += n(l.price) }
    }
    let profit = worth - cost
    return Margin(
        percent: worth > 0 ? profit / worth * 100 : 0,
        revenue: worth, cost: cost, profit: profit, assumed: false,
        costedShare: value > 0 ? costedValue / value : 0
    )
}

// MARK: The shapes the ERP keeps

private let GOLD_COIN_CATEGORY = "cat017"

/// Diamonds or stones in a piece, as any of the shapes records it.
private func setWithStones(hasDiamonds: Bool, hasStones: Bool, stoneDetails: String?, diamondDetails: String?, stoneWeightG: Double) -> Bool {
    hasDiamonds || hasStones || !JS.trim(stoneDetails ?? "").isEmpty || !JS.trim(diamondDetails ?? "").isEmpty || n(stoneWeightG) > 0
}

/// SHOP-ONLY (a customer must never see a margin).
/// A sale: its pieces, worth their total less the discount.
public func invoiceMargin(_ inv: Invoice, settings: MarginSettings = .default) -> Margin {
    let lines = inv.items.map { it in
        MarginLine(
            metalType: it.metalType.rawValue, karat: it.karat?.rawValue, weightG: it.metalWeightG, stoneWeightG: it.stoneWeightG,
            quantity: it.quantity, price: n(it.itemTotal), stoneCharges: it.stoneChargesIfAny, diamondCharges: it.diamondChargesIfAny,
            isCoin: it.categoryId == GOLD_COIN_CATEGORY,
            fixedPrice: it.isCustomPrice || it.isManualPrice,
            setWithStones: setWithStones(hasDiamonds: it.hasDiamonds, hasStones: it.hasStones, stoneDetails: it.stoneDetails,
                                         diamondDetails: it.diamondDetails, stoneWeightG: it.stoneWeightG)
        )
    }
    let sum = lines.reduce(0) { $0 + $1.price }
    let value = n(inv.subtotal) == 0 ? sum : n(inv.subtotal)
    return marginOf(lines, revenue: value - n(inv.discountAmount), rate24k: inv.costRate24k, settings: settings)
}

/// SHOP-ONLY (a customer must never see a margin).
/// An order: each piece at its agreed or estimated price, less the discount. `prices` are the live
/// figures on the form, one per piece, in place of the saved ones.
public func orderMargin(_ order: Order, prices: [Double]? = nil, settings: MarginSettings = .default) -> Margin {
    let lines = order.items.enumerated().map { i, it in
        MarginLine(
            metalType: it.metalType.rawValue, karat: it.karat?.rawValue, weightG: it.estimatedWeightG, stoneWeightG: it.stoneWeightG,
            price: prices != nil ? (i < prices!.count ? n(prices![i]) : 0) : n(it.isManualPrice ? it.manualPrice : it.totalEstimate),
            // A fixed price holds whatever stones it has; the charges only exist when it is priced by weight.
            stoneCharges: it.isManualPrice ? 0 : it.stoneCharges,
            diamondCharges: it.isManualPrice || !it.hasDiamonds ? 0 : it.diamondCharges,
            fixedPrice: it.isManualPrice,
            setWithStones: setWithStones(hasDiamonds: it.hasDiamonds, hasStones: it.hasStones, stoneDetails: it.stoneDetails,
                                         diamondDetails: it.diamondDetails, stoneWeightG: it.stoneWeightG)
        )
    }
    let sum = lines.reduce(0) { $0 + $1.price }
    let value = prices != nil ? sum : (n(order.subtotal) == 0 ? sum : n(order.subtotal))
    return marginOf(lines, revenue: value - n(order.discountAmount), rate24k: order.costRate24k, settings: settings)
}

/// SHOP-ONLY (a customer must never see a margin).
/// "18.2%": one decimal under 10, none above, the way the counter reads it.
public func percentLabel(_ m: Margin) -> String {
    "\(abs(m.percent) < 10 ? JS.toFixed(m.percent, 1) : JS.number(JS.round(m.percent)))%"
}
