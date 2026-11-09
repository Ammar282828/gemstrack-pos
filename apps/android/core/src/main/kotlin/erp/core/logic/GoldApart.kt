// Ported from src/lib/analytics/gold-apart.ts (tests: GoldApartTests, from gold-apart.test.ts).
//
// Gold apart from silver (owner, 2026-11-09, House of Mina): each sale's value is split by its pieces' metal; gold's
// estimate at the house's margin is only a caption beside its revenue; profit is not changed. On by the business descriptor's
// `goldApartMargin` (a percent; null: one revenue, as Taheri keeps).

package erp.core.logic

import erp.core.models.Invoice
import erp.core.models.Order

object GoldApart {
    const val SILVER_REVENUE_LABEL = "Silver revenue"

    /** The share of a sale that is gold, by its lines' values (0 with no lines or no value). */
    fun goldShare(lines: List<Pair<String, Double>>): Double {
        var gold = 0.0
        var all = 0.0
        for ((metal, value) in lines) {
            val v = maxOf(0.0, if (value.isNaN()) 0.0 else value)
            all += v
            if (metal.lowercase() == "gold") gold += v
        }
        return if (all > 0) gold / all else 0.0
    }

    /** An invoice's gold part of [saleValue], by its lines' totals. */
    fun invoiceGoldPart(inv: Invoice, saleValue: Double): Double =
        saleValue * goldShare(inv.items.map { it.metalType.rawValue to it.itemTotal })

    /** An order's gold part of [amount], by its pieces' prices. */
    fun orderGoldPart(order: Order, amount: Double): Double =
        amount * goldShare(order.items.map { i ->
            val price = if (i.isManualPrice) (i.manualPrice ?: i.totalEstimate ?: 0.0) else (i.totalEstimate ?: 0.0)
            i.metalType.rawValue to price
        })

    /** "Gold revenue (est. 10% margin)": the gold figure always carries its estimated margin. */
    fun goldRevenueLabel(percent: Double): String = "Gold revenue (est. ${percentText(percent)}% margin)"

    /** 10 -> "10", 7.5 -> "7.5" (as JS prints the number). */
    fun percentText(percent: Double): String = if (percent == Math.rint(percent)) percent.toLong().toString() else percent.toString()
}

/** Gold per bucket, by the same grain and frame as [bucketSeries] (silver is each row's sales less this). */
fun goldBucketSeries(series: List<SalesDay>, bucket: Bucket, range: Period? = null, now: java.time.Instant = java.time.Instant.now()): List<BucketRow> =
    bucketSeries(series.map { it.copy(sales = it.gold) }, bucket, range, now)

/** One bucket of a stacked chart: silver then gold. */
data class SilverGoldRow(val key: String, val label: String, val tip: String, val silver: Double, val gold: Double)

fun silverGoldRows(series: List<SalesDay>, bucket: Bucket, range: Period? = null, now: java.time.Instant = java.time.Instant.now()): List<SilverGoldRow> {
    val all = bucketSeries(series, bucket, range, now)
    val gold = goldBucketSeries(series, bucket, range, now)
    return all.mapIndexed { i, r ->
        val g = minOf(r.sales, gold.getOrNull(i)?.sales ?: 0.0)
        SilverGoldRow(r.key, r.label, r.tip, maxOf(0.0, r.sales - g), g)
    }
}
