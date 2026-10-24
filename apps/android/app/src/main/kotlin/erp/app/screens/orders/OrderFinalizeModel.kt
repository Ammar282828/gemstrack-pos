package erp.app.screens.orders

import erp.core.entry.NewOrderFormat
import erp.core.entry.NewOrderWords
import erp.core.logic.FinalizedItem
import erp.core.logic.RateField
import erp.core.logic.finalizeRateRows
import erp.core.logic.finalizeRates
import erp.core.logic.rateShown
import erp.core.logic.exchangeTotal
import erp.core.logic.finalizedItemCosts
import erp.core.logic.orderAdvancePayments
import erp.core.logic.orderExchanges
import erp.core.logic.orderInvoiceRates
import erp.core.logic.PricingRates
import erp.core.logic.rupees
import erp.core.logic.wastageGramsFor
import erp.core.models.Order
import erp.core.models.OrderItem
import erp.core.models.Settings

// Finalize & invoice (components/order/order-dialogs.tsx FinalizeOrderDialog), as the phone holds it: each piece's
// final figures as typed, starting from the order's own, priced by core's `finalizedItemCosts` at the rates the
// order was booked at, so what the screen shows is what the invoice will say (lib/writes/finalize-order.ts prices
// the same pieces the same way). Pure (OrderFinalizeModel.swift).

/** One piece's final figures, as text while they are typed. */
data class OrderFinalizeRow(
    val index: Int,
    val item: OrderItem,
    /** A fixed price instead of weight × rate. */
    val manual: Boolean,
    val price: String,
    val weight: String,
    /** The percentage (the grams are shown beside it). */
    val wastage: String,
    val making: String,
    val stones: String,
    val diamonds: String,
) {
    private fun n(s: String): Double = NewOrderFormat.num(s)

    /** What the order said this piece would come to. */
    val onOrder: Double get() = if (item.isManualPrice) (item.manualPrice ?: 0.0) else (item.totalEstimate ?: 0.0)

    val finalized: FinalizedItem
        get() = FinalizedItem(
            description = item.description, metalType = item.metalType, karat = item.karat,
            finalWeightG = n(weight), finalWastagePercentage = n(wastage), finalMakingCharges = n(making),
            finalDiamondCharges = n(diamonds), finalStoneCharges = n(stones),
            isManualPrice = manual, finalManualPrice = n(price),
        )

    /** The wastage's grams at this weight (the grams the karigar writes, and the invoice prints). */
    val wastageGrams: Double get() = wastageGramsFor(n(wastage), n(weight), item.stoneWeightG)

    /** The payload's piece, as the dialog sends it (`FinalizedItem`). */
    val payload: Map<String, Any?>
        get() {
            val o = linkedMapOf<String, Any?>(
                "description" to item.description, "metalType" to item.metalType.rawValue,
                "finalWeightG" to n(weight), "finalWastagePercentage" to n(wastage), "finalMakingCharges" to n(making),
                "finalDiamondCharges" to n(diamonds), "finalStoneCharges" to n(stones),
                "isManualPrice" to manual, "finalManualPrice" to rupees(n(price)),
            )
            val k = item.karat?.rawValue
            if (!k.isNullOrEmpty()) o["karat"] = k
            return o
        }

    companion object {
        /** The dialog's opening figures: the order's own (a fixed price, else what the order estimated). */
        fun of(item: OrderItem, index: Int): OrderFinalizeRow {
            val onOrder = if ((item.manualPrice ?: 0.0) > 0) item.manualPrice ?: 0.0 else item.totalEstimate ?: 0.0
            return OrderFinalizeRow(
                index = index, item = item, manual = item.isManualPrice,
                price = NewOrderFormat.rupeeBox(onOrder),
                weight = NewOrderFormat.boxText(item.estimatedWeightG, 3),
                wastage = NewOrderFormat.boxText(item.wastagePercentage, 4),
                making = NewOrderFormat.rupeeBox(item.makingCharges),
                stones = NewOrderFormat.rupeeBox(item.stoneCharges),
                diamonds = NewOrderFormat.rupeeBox(item.diamondCharges),
            )
        }
    }
}

/** The rates the screen shows in its boxes, as typed (text), by field. */
typealias RateTexts = Map<RateField, String>

object OrderFinalizeMath {
    data class Figures(
        val prices: List<Double> = emptyList(),
        val subtotal: Double = 0.0,
        val discount: Double = 0.0,
        val exchange: Double = 0.0,
        val advances: Double = 0.0,
        /** What the invoice still asks for once the advances are counted as paid. */
        val balance: Double = 0.0,
    ) {
        /** The invoice's total (before the advances). */
        val total: Double get() = subtotal - discount - exchange
    }

    /** A rate box's text for a figure: blank for none, no trailing zeros. */
    fun rateText(x: Double): String = NewOrderFormat.boxText(x, 2)

    /** The boxes' opening figures: the rates the order was booked at (a palladium karat at its own, else the flat). */
    fun bookedTexts(order: Order, settings: Settings): RateTexts {
        val booked = orderInvoiceRates(order, settings)
        return finalizeRateRows(order.items).associate { it.field to rateText(rateShown(booked, it.field)) }
    }

    /** "Use today's rates": the shop's own for every box where it has one. */
    fun todayTexts(order: Order, settings: Settings): RateTexts {
        val today = PricingRates(settings)
        return finalizeRateRows(order.items).mapNotNull { r -> rateShown(today, r.field).takeIf { it > 0 }?.let { r.field to rateText(it) } }.toMap()
    }

    /** Whether today's rates would change any box as it stands (the "Use today's rates" button shows then). */
    fun todayDiffers(order: Order, settings: Settings, texts: RateTexts): Boolean {
        val today = todayTexts(order, settings)
        return today.any { (f, t) -> NewOrderFormat.num(t) != NewOrderFormat.num(texts[f] ?: "") }
    }

    /** Only the boxes that differ from the booked figure, as numbers: what the server is sent, and what prices the pieces. */
    fun changedRates(order: Order, settings: Settings, texts: RateTexts): Map<RateField, Double> {
        val booked = orderInvoiceRates(order, settings)
        val out = linkedMapOf<RateField, Double>()
        for (row in finalizeRateRows(order.items)) {
            val v = NewOrderFormat.num(texts[row.field] ?: "")
            if (v > 0 && v != rateShown(booked, row.field)) out[row.field] = v
        }
        return out
    }

    fun figures(order: Order, rows: List<OrderFinalizeRow>, discount: String, settings: Settings, rateTexts: RateTexts = emptyMap()): Figures {
        val rates = finalizeRates(order, settings, changedRates(order, settings, rateTexts))
        val prices = rows.map { r -> finalizedItemCosts(r.item, r.finalized, rates).price }
        val subtotal = prices.fold(0.0) { a, b -> a + b }
        // Whole rupees, as lib/writes/finalize-order.ts rounds the discount and each advance carried over.
        val disc = rupees(NewOrderFormat.num(discount))
        val exchange = exchangeTotal(orderExchanges(order))
        val advances = orderAdvancePayments(order).fold(0.0) { a, p -> a + rupees(p.amount) }
        return Figures(prices, subtotal, disc, exchange, advances, subtotal - disc - exchange - advances)
    }

    /** The dialog's checks (`finalizeOrderSchema`): a priced piece needs a weight; nothing negative. */
    fun problem(rows: List<OrderFinalizeRow>, discount: String, order: Order? = null, rateTexts: RateTexts = emptyMap()): String? {
        if (order != null) {
            for (row in finalizeRateRows(order.items)) {
                val t = rateTexts[row.field] ?: ""
                if (NewOrderFormat.below0(t)) return "${row.label} rate cannot be negative."
                if (NewOrderFormat.unreadable(t)) return "The ${row.label} rate is not a number. Retype it, or clear it."
            }
        }
        for (r in rows) {
            if (!r.manual && NewOrderFormat.num(r.weight) <= 0) return "Piece ${r.index + 1}: weight must be a positive number."
            if (r.manual && NewOrderFormat.num(r.price) <= 0) return "Piece ${r.index + 1}: a fixed price needs the price."
        }
        if (NewOrderFormat.below0(discount)) return "Discount cannot be negative."
        if (NewOrderFormat.unreadable(discount)) return "The discount is not a number. Retype it, or clear it."
        return null
    }

    /** What `ErpApi.write("finalizeOrder", …)` takes. `costTola` is the 24k rate per tola, for the shop's margin. */
    fun request(orderId: String, rows: List<OrderFinalizeRow>, discount: String, costTola: String, changedRates: Map<RateField, Double> = emptyMap()): Map<String, Any?> {
        val out = linkedMapOf<String, Any?>(
            "orderId" to orderId,
            "items" to rows.map { it.payload },
            "additionalDiscount" to rupees(NewOrderFormat.num(discount)),
        )
        val tola = NewOrderFormat.num(costTola)
        if (tola > 0) out["costRate24k"] = tola / NewOrderWords.gramsPerTola
        // Only rates changed from the booked ones; none, and the server prices as booked.
        if (changedRates.isNotEmpty()) out["ratesApplied"] = changedRates.entries.associate { it.key.key to it.value }
        return out
    }
}
