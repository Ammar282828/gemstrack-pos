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

package erp.core.logic

import erp.core.models.KaratValue
import erp.core.models.MetalType
import erp.core.models.Order
import erp.core.models.OrderItem
import erp.core.models.Rates
import erp.core.models.Settings

/** What the dialog sends for one piece (TS `FinalizedItem`). */
data class FinalizedItem(
    var description: String,
    var metalType: MetalType,
    var karat: KaratValue? = null,
    var finalWeightG: Double,
    /** Absent: the order's own percentage. */
    var finalWastagePercentage: Double? = null,
    var finalMakingCharges: Double,
    var finalDiamondCharges: Double,
    var finalStoneCharges: Double,
    var isManualPrice: Boolean = false,
    var finalManualPrice: Double? = null,
)

/** The rate card an invoice is priced at (TS `InvoiceRates`: the pricing function's rates). */
typealias InvoiceRates = PricingRates

/**
 * The rates the order was booked at; an order from before they were kept takes today's.
 *
 * Today's, as the TS builds them here, are the seven the settings have always held: the two
 * per-karat palladium rates are not among them, so such an order prices palladium at the flat rate.
 * An order whose `ratesApplied` carries no rate at all is taken as one that never kept them (the
 * model reads a missing field and an empty one alike; the TS would price an empty one at nothing).
 */
fun orderInvoiceRates(order: Order, settings: Settings): InvoiceRates =
    orderInvoiceRates(ratesApplied = if (order.ratesApplied.values.isEmpty()) null else order.ratesApplied, settings = settings)

/** `orderInvoiceRates` for a `ratesApplied` that may be absent (the TS's `order.ratesApplied || …`). */
fun orderInvoiceRates(ratesApplied: Rates?, settings: Settings): InvoiceRates {
    if (ratesApplied != null) return InvoiceRates(ratesApplied)
    return InvoiceRates(settings).flatPalladiumOnly
}

/** Wastage is a percentage of the metal: the weight less the stones (pricing.ts). */
fun netMetalG(weightG: Double, stoneWeightG: Double = 0.0): Double = JS.atLeastZero(JS.orZero(weightG) - JS.orZero(stoneWeightG))

/** The grams a percentage stands for: what the invoice prints (invoice-item-cell.ts wastageGrams). */
fun wastageGramsFor(percent: Double, weightG: Double, stoneWeightG: Double = 0.0): Double =
    netMetalG(weightG, stoneWeightG) * JS.orZero(percent) / 100

/** The percentage that many grams is, as the karigar writes it ("6.500 + 0.650"); 0 with no weight yet. */
fun wastagePercentFor(grams: Double, weightG: Double, stoneWeightG: Double = 0.0): Double {
    val net = netMetalG(weightG, stoneWeightG)
    // Eight places: 2 g on 20.3 g is 9.85221675% and prices exactly 2 g; four places came to 12 paisa short.
    return if (net > 0) JS.round(JS.orZero(grams) / net * 100 * 1e8) / 1e8 else 0.0
}

/** Silver's rate per gram already holds its making and wastage (pricing.ts), so neither is asked for. */
fun takesWastageAndMaking(metalType: MetalType): Boolean = metalType != MetalType.silver

/** What one finalized piece comes to (TS `FinalizedCosts`). */
data class FinalizedCosts(
    var price: Double,
    var metalCost: Double,
    var wastageCost: Double,
    var wastagePercentage: Double,
    var makingCharges: Double,
    var diamondCharges: Double,
    var stoneCharges: Double,
)

/**
 * A piece of an order at the figures typed in the Finalize dialog, at the order's rates.
 * The metal, karat and stones are the order's; the weight, wastage, making and charges are what was typed.
 */
fun finalizedItemCosts(original: OrderItem, f: FinalizedItem, rates: InvoiceRates): FinalizedCosts {
    if (f.isManualPrice) {
        return FinalizedCosts(
            price = rupees(f.finalManualPrice),
            metalCost = 0.0, wastageCost = 0.0, wastagePercentage = JS.orZero(original.wastagePercentage),
            makingCharges = 0.0, diamondCharges = 0.0, stoneCharges = 0.0,
        )
    }
    val wastagePercentage = JS.orZero(f.finalWastagePercentage ?: original.wastagePercentage)
    val costs = calculateProductCosts(
        PricedPiece(
            metalType = original.metalType,
            karat = original.karat,
            metalWeightG = JS.orZero(f.finalWeightG),
            stoneWeightG = JS.orZero(original.stoneWeightG),
            wastagePercentage = wastagePercentage,
            makingCharges = JS.orZero(f.finalMakingCharges),
            // A diamond charge typed here counts even if the order never ticked "Has diamonds": it was
            // silently dropped before.
            hasDiamonds = original.hasDiamonds || JS.orZero(f.finalDiamondCharges) > 0,
            diamondCharges = JS.orZero(f.finalDiamondCharges),
            stoneCharges = JS.orZero(f.finalStoneCharges),
            miscCharges = 0.0,
        ),
        rates,
    )
    return FinalizedCosts(
        price = costs.totalPrice,
        metalCost = costs.metalCost,
        wastageCost = costs.wastageCost,
        wastagePercentage = wastagePercentage,
        makingCharges = costs.makingCharges,
        diamondCharges = costs.diamondCharges,
        stoneCharges = costs.stoneCharges,
    )
}
