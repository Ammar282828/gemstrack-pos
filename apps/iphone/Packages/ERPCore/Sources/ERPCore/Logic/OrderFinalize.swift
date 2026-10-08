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
            price: JS.orZero(f.finalManualPrice),
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
