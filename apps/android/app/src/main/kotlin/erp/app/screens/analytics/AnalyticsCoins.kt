package erp.app.screens.analytics

import erp.core.logic.invoiceSaleValue
import erp.core.models.Invoice
import erp.core.models.InvoiceItem
import erp.core.models.InvoiceStatus
import kotlin.math.floor
import kotlin.math.max

// lib/analytics/coins.ts (AnalyticsCoins.swift). Kotlin's `copy` is the TS spread: the split side keeps every other
// field of the bill, which is what the web does.

/**
 * Gold coins are not jewellery, and Analytics keeps them apart: a coin sells within a point or two of the metal price,
 * a ring carries making and margin. Invoices are split once, before anything counts them; the jewellery side feeds
 * every figure, the coin side its own card.
 *
 * A coin is almost always its own invoice, and then the whole document goes to one side. When a coin and a ring share a
 * bill the document's money (grand total, discount, what was paid, what is owed) is divided in proportion to the line
 * totals, as the web does.
 */
object AnaCoins {
    /** The category id of "Gold Coins" (lib/categories.ts). */
    const val goldCoinCategory = "cat017"

    fun isCoin(item: InvoiceItem): Boolean = item.categoryId == goldCoinCategory

    class Split(
        /** The invoice with its coins removed, or null if it was nothing but coins. */
        val jewellery: Invoice?,
        /** The invoice reduced to its coins, or null if it had none. */
        val coins: Invoice?,
    )

    /** What the coin card reports. Weight is what a coin buyer asks about first. */
    class Summary(
        val invoices: Int,
        val coins: Double,
        val grams: Double,
        val revenue: Double,
        /** Revenue over grams: what the shop actually realised per gram, all-in. */
        val ratePerGram: Double,
        val outstanding: Double,
    )

    private fun total(items: List<InvoiceItem>): Double = items.sumOf { if (it.itemTotal.isFinite()) it.itemTotal else 0.0 }

    fun split(inv: Invoice): Split {
        val items = inv.items
        val coinItems = items.filter { isCoin(it) }
        if (coinItems.isEmpty()) return Split(inv, null)
        val jewelItems = items.filter { !isCoin(it) }
        if (jewelItems.isEmpty()) return Split(null, inv)
        val coinTotal = total(coinItems)
        val all = coinTotal + total(jewelItems)
        // Lines with no money on them cannot be apportioned by money; fall back to a headcount.
        val coinShare = if (all > 0) coinTotal / all else coinItems.size.toDouble() / items.size
        return Split(side(inv, jewelItems, 1 - coinShare), side(inv, coinItems, coinShare))
    }

    /** Every invoice split, in one pass, keeping order. */
    fun splitAll(invoices: List<Invoice>): Pair<List<Invoice>, List<Invoice>> {
        val jewellery = ArrayList<Invoice>()
        val coins = ArrayList<Invoice>()
        for (inv in invoices) {
            val s = split(inv)
            s.jewellery?.let { jewellery.add(it) }
            s.coins?.let { coins.add(it) }
        }
        return jewellery to coins
    }

    fun summarise(invoices: List<Invoice>): Summary {
        var coins = 0.0
        var grams = 0.0
        var revenue = 0.0
        var outstanding = 0.0
        var bills = 0
        for (inv in invoices) {
            if (inv.status == InvoiceStatus.refunded) continue
            bills += 1
            revenue += invoiceSaleValue(inv)
            outstanding += max(0.0, inv.balanceDue)
            for (it in inv.items) {
                val q = if (it.quantity == 0.0) 1.0 else it.quantity
                coins += q
                grams += it.metalWeightG * q
            }
        }
        return Summary(bills, coins, grams, revenue, if (grams > 0) revenue / grams else 0.0, outstanding)
    }

    /** `Math.round(n * share * 100) / 100`. */
    private fun scale(n: Double, share: Double): Double {
        val v = if (n.isFinite()) n else 0.0
        return floor(v * share * 100 + 0.5) / 100
    }

    /** One side of a split invoice, with its money scaled to its share of the lines. */
    private fun side(inv: Invoice, items: List<InvoiceItem>, share: Double): Invoice {
        if (share >= 1) return inv
        return inv.copy(
            items = items,
            subtotal = scale(inv.subtotal, share),
            discountAmount = scale(inv.discountAmount, share),
            grandTotal = scale(inv.grandTotal, share),
            amountPaid = scale(inv.amountPaid, share),
            balanceDue = scale(inv.balanceDue, share),
            paymentHistory = inv.paymentHistory.map { it.copy(amount = scale(it.amount, share)) },
            exchanges = inv.exchanges.map { it.copy(value = scale(it.value, share)) },
            exchangeAmount1 = inv.exchangeAmount1?.let { scale(it, share) },
            exchangeAmount2 = inv.exchangeAmount2?.let { scale(it, share) },
        )
    }
}
