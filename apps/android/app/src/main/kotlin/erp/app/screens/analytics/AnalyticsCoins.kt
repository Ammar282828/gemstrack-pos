package erp.app.screens.analytics

import erp.core.logic.CoinSummary
import erp.core.logic.Coins
import erp.core.models.Invoice
import erp.core.models.InvoiceItem

// lib/analytics/coins.ts (AnalyticsCoins.swift). The rules are core's (`Coins`, which the pure-Kotlin books use too);
// this keeps the names the pages and Home already call.

/**
 * Gold coins are not jewellery, and Analytics keeps them apart: a coin sells within a point or two of the metal price,
 * a ring carries making and margin. Invoices are split once, before anything counts them; the jewellery side feeds
 * every figure, the coin side its own card. See [Coins].
 */
object AnaCoins {
    /** The category id of "Gold Coins" (lib/categories.ts). */
    const val goldCoinCategory = Coins.goldCoinCategory

    fun isCoin(item: InvoiceItem): Boolean = Coins.isCoin(item)

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

    fun split(inv: Invoice): Split = Coins.split(inv).let { Split(it.jewellery, it.coins) }

    /** Every invoice split, in one pass, keeping order. */
    fun splitAll(invoices: List<Invoice>): Pair<List<Invoice>, List<Invoice>> = Coins.splitAll(invoices)

    fun summarise(invoices: List<Invoice>): Summary = of(Coins.summarise(invoices))

    fun of(s: CoinSummary): Summary = Summary(s.invoices, s.coins, s.grams, s.revenue, s.ratePerGram, s.outstanding)
}
