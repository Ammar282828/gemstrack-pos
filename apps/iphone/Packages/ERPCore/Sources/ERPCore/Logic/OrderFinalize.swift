// Ported from src/lib/order-finalize.ts (tests: OrderFinalizeTests, from order-finalize.test.ts).
//
// Finalize & invoice, priced: what each piece of an order comes to at the figures typed in the
// dialog (components/order/order-dialogs.tsx), at the rates the order was booked at. One
// calculation, used by the dialog as you type and by generateInvoiceFromOrder (store.ts) when it
// writes the invoice, so what the dialog shows is what the invoice says.
//
// The owner, 2026-10-05: "when making a final invoice for the order allow me to change the wastage
// and making … without having to re-edit it". Wastage was not in the dialog at all: the order's
// percentage went to the invoice as it was, and a different figure meant editing the invoice after.

import Foundation

/// What the dialog sends for one piece (TS `FinalizedItem`).
public struct FinalizedItem: Hashable {
    public var description: String
    public var metalType: MetalType
    public var karat: KaratValue?
    public var finalWeightG: Double
    /// Absent: the order's own percentage.
    public var finalWastagePercentage: Double?
    public var finalMakingCharges: Double
    public var finalDiamondCharges: Double
    public var finalStoneCharges: Double
    public var isManualPrice: Bool
    public var finalManualPrice: Double?

    public init(
        description: String, metalType: MetalType, karat: KaratValue? = nil, finalWeightG: Double,
        finalWastagePercentage: Double? = nil, finalMakingCharges: Double,
        finalDiamondCharges: Double, finalStoneCharges: Double,
        isManualPrice: Bool = false, finalManualPrice: Double? = nil
    ) {
        self.description = description
        self.metalType = metalType
        self.karat = karat
        self.finalWeightG = finalWeightG
        self.finalWastagePercentage = finalWastagePercentage
        self.finalMakingCharges = finalMakingCharges
        self.finalDiamondCharges = finalDiamondCharges
        self.finalStoneCharges = finalStoneCharges
        self.isManualPrice = isManualPrice
        self.finalManualPrice = finalManualPrice
    }
}

/// The rate card an invoice is priced at (TS `InvoiceRates`: the pricing function's rates).
public typealias InvoiceRates = PricingRates

/// The rates the order was booked at; an order from before they were kept takes today's.
///
/// Today's, as the TS builds them here, are the seven the settings have always held: the two
/// per-karat palladium rates are not among them, so such an order prices palladium at the flat rate.
/// An order whose `ratesApplied` carries no rate at all is taken as one that never kept them (the
/// model reads a missing field and an empty one alike; the TS would price an empty one at nothing).
public func orderInvoiceRates(_ order: Order, _ settings: Settings) -> InvoiceRates {
    orderInvoiceRates(ratesApplied: order.ratesApplied.values.isEmpty ? nil : order.ratesApplied, settings)
}

/// `orderInvoiceRates` for a `ratesApplied` that may be absent (the TS's `order.ratesApplied || …`).
public func orderInvoiceRates(ratesApplied: Rates?, _ settings: Settings) -> InvoiceRates {
    if let ratesApplied { return InvoiceRates(ratesApplied) }
    return InvoiceRates(settings).flatPalladiumOnly
}

/// A rate a counter can type, by the key the server's `ratesApplied` knows it as (TS `RATE_FIELDS`): the same nine
/// as the settings hold, so the rate key is the field.
public typealias RateField = RateKey

public extension PricingRates {
    /// The figure for one rate.
    func rate(_ field: RateField) -> Double {
        switch field {
        case .goldRatePerGram24k: return goldRatePerGram24k
        case .goldRatePerGram22k: return goldRatePerGram22k
        case .goldRatePerGram21k: return goldRatePerGram21k
        case .goldRatePerGram18k: return goldRatePerGram18k
        case .palladiumRatePerGram: return palladiumRatePerGram
        case .palladiumRatePerGram18k: return palladiumRatePerGram18k
        case .palladiumRatePerGram12k: return palladiumRatePerGram12k
        case .platinumRatePerGram: return platinumRatePerGram
        case .silverRatePerGram: return silverRatePerGram
        }
    }

    /// The card with one rate replaced.
    func setting(_ field: RateField, to value: Double) -> PricingRates {
        var out = self
        switch field {
        case .goldRatePerGram24k: out.goldRatePerGram24k = value
        case .goldRatePerGram22k: out.goldRatePerGram22k = value
        case .goldRatePerGram21k: out.goldRatePerGram21k = value
        case .goldRatePerGram18k: out.goldRatePerGram18k = value
        case .palladiumRatePerGram: out.palladiumRatePerGram = value
        case .palladiumRatePerGram18k: out.palladiumRatePerGram18k = value
        case .palladiumRatePerGram12k: out.palladiumRatePerGram12k = value
        case .platinumRatePerGram: out.platinumRatePerGram = value
        case .silverRatePerGram: out.silverRatePerGram = value
        }
        return out
    }
}

/// The booked rates with any typed at Finalize laid over them (TS `finalizeRates`): gold moves daily and an order is
/// delivered weeks after it was booked, so the counter may price it at today's. Only positive figures win; none is
/// the booked rates exactly.
public func finalizeRates(_ order: Order, _ settings: Settings, typed: [RateField: Double] = [:]) -> InvoiceRates {
    var out = orderInvoiceRates(order, settings)
    // RateKey order, so the result never depends on dictionary order.
    for field in RateField.allCases {
        if let v = typed[field], v.isFinite, v > 0 { out = out.setting(field, to: v) }
    }
    return out
}

/// One rate box: the field and the words above it (TS `RateRow`).
public struct RateRow: Hashable {
    public let field: RateField
    public let label: String

    public init(field: RateField, label: String) {
        self.field = field
        self.label = label
    }
}

/// The rate boxes an order's pieces need (TS `finalizeRateRows`): only the metals and karats in use, silver last.
public func finalizeRateRows(_ items: [OrderItem]) -> [RateRow] {
    var rows: [RateRow] = []
    func add(_ field: RateField, _ label: String) {
        if !rows.contains(where: { $0.field == field }) { rows.append(RateRow(field: field, label: label)) }
    }
    let gold = Set(items.filter { $0.metalType == .gold }.map { $0.karat?.rawValue ?? "" })
    let golds: [(String, RateField)] = [("24k", .goldRatePerGram24k), ("22k", .goldRatePerGram22k), ("21k", .goldRatePerGram21k), ("18k", .goldRatePerGram18k)]
    for (karat, field) in golds where gold.contains(karat) { add(field, "Gold " + karat) }
    for item in items where item.metalType == .palladium {
        switch item.karat?.rawValue ?? "" {
        case "18k": add(.palladiumRatePerGram18k, "Palladium 18k")
        case "12k": add(.palladiumRatePerGram12k, "Palladium 12k")
        default: add(.palladiumRatePerGram, "Palladium")
        }
    }
    if items.contains(where: { $0.metalType == .platinum }) { add(.platinumRatePerGram, "Platinum") }
    // Silver's rate is all-in: it holds the making and the wastage (pricing.ts), so only the number changes.
    if items.contains(where: { $0.metalType == .silver }) { add(.silverRatePerGram, "Silver (all-in)") }
    return rows
}

/// The figure a rate box holds (TS `rateShown`): a palladium karat with no rate of its own is priced at the flat one.
public func rateShown(_ rates: PricingRates, _ field: RateField) -> Double {
    let own = rates.rate(field)
    if own > 0 { return own }
    return field == .palladiumRatePerGram18k || field == .palladiumRatePerGram12k ? rates.palladiumRatePerGram : 0
}

/// Wastage is a percentage of the metal: the weight less the stones (pricing.ts).
public func netMetalG(_ weightG: Double, _ stoneWeightG: Double = 0) -> Double {
    JS.atLeastZero(JS.orZero(weightG) - JS.orZero(stoneWeightG))
}

/// The grams a percentage stands for: what the invoice prints (invoice-item-cell.ts wastageGrams).
public func wastageGramsFor(_ percent: Double, _ weightG: Double, _ stoneWeightG: Double = 0) -> Double {
    netMetalG(weightG, stoneWeightG) * JS.orZero(percent) / 100
}

/// The percentage that many grams is, as the karigar writes it ("6.500 + 0.650"); 0 with no weight yet.
public func wastagePercentFor(_ grams: Double, _ weightG: Double, _ stoneWeightG: Double = 0) -> Double {
    let net = netMetalG(weightG, stoneWeightG)
    // Eight places: 2 g on 20.3 g is 9.85221675% and prices exactly 2 g; four places came to 12 paisa short.
    return net > 0 ? JS.round(JS.orZero(grams) / net * 100 * 1e8) / 1e8 : 0
}

/// Silver's rate per gram already holds its making and wastage (pricing.ts), so neither is asked for.
public func takesWastageAndMaking(_ metalType: MetalType) -> Bool { metalType != .silver }

/// What one finalized piece comes to (TS `FinalizedCosts`).
public struct FinalizedCosts: Hashable {
    public var price: Double
    public var metalCost: Double
    public var wastageCost: Double
    public var wastagePercentage: Double
    public var makingCharges: Double
    public var diamondCharges: Double
    public var stoneCharges: Double

    public init(
        price: Double, metalCost: Double, wastageCost: Double, wastagePercentage: Double,
        makingCharges: Double, diamondCharges: Double, stoneCharges: Double
    ) {
        self.price = price
        self.metalCost = metalCost
        self.wastageCost = wastageCost
        self.wastagePercentage = wastagePercentage
        self.makingCharges = makingCharges
        self.diamondCharges = diamondCharges
        self.stoneCharges = stoneCharges
    }
}

/// A piece of an order at the figures typed in the Finalize dialog, at the order's rates.
/// The metal, karat and stones are the order's; the weight, wastage, making and charges are what was typed.
public func finalizedItemCosts(_ original: OrderItem, _ f: FinalizedItem, _ rates: InvoiceRates) -> FinalizedCosts {
    if f.isManualPrice {
        return FinalizedCosts(
            price: rupees(f.finalManualPrice),
            metalCost: 0, wastageCost: 0, wastagePercentage: JS.orZero(original.wastagePercentage),
            makingCharges: 0, diamondCharges: 0, stoneCharges: 0
        )
    }
    let wastagePercentage = JS.orZero(f.finalWastagePercentage ?? original.wastagePercentage)
    let costs = calculateProductCosts(PricedPiece(
        metalType: original.metalType,
        karat: original.karat,
        metalWeightG: JS.orZero(f.finalWeightG),
        stoneWeightG: JS.orZero(original.stoneWeightG),
        wastagePercentage: wastagePercentage,
        makingCharges: JS.orZero(f.finalMakingCharges),
        // A diamond charge typed here counts even if the order never ticked "Has diamonds": it was
        // silently dropped before.
        hasDiamonds: original.hasDiamonds || JS.orZero(f.finalDiamondCharges) > 0,
        diamondCharges: JS.orZero(f.finalDiamondCharges),
        stoneCharges: JS.orZero(f.finalStoneCharges),
        miscCharges: 0
    ), rates)
    return FinalizedCosts(
        price: costs.totalPrice,
        metalCost: costs.metalCost,
        wastageCost: costs.wastageCost,
        wastagePercentage: wastagePercentage,
        makingCharges: costs.makingCharges,
        diamondCharges: costs.diamondCharges,
        stoneCharges: costs.stoneCharges
    )
}
