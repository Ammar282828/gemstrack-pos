package erp.app.screens.analytics

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import erp.core.logic.Books
import erp.core.logic.Bucket
import erp.core.logic.GoldApart
import erp.core.logic.Money
import erp.core.logic.silverGoldRows

// Gold apart from silver (owner, 2026-11-09, House of Mina: "I want gold revenue to be separate with a (est 10% profit
// margin) and silver revenue to be separate. So this takes effect in any place revenue is mentioned"). The split is core's
// (GoldApart, Books.goldRevenue / silverRevenue); this is only how a screen says it, as the iPhone's AnalyticsGoldApart.swift
// does. The total stays "Revenue" with the two parts under it; a business whose descriptor has no `goldApartMargin`
// (Taheri) gets null and nothing changes.

/** The revenue split of one set of books, with the words every place uses. */
class AnaSplit(
    val total: Double,
    val silver: Double,
    val gold: Double,
    val goldProfit: Double,
    val percent: Double,
) {
    val silverLabel: String get() = GoldApart.SILVER_REVENUE_LABEL
    val goldLabel: String get() = GoldApart.goldRevenueLabel(percent)

    /** "Profit est. at 10%: PKR 4,000" */
    val goldCaption: String get() = "Profit est. at ${GoldApart.percentText(percent)}%: ${Money.pkrLac(goldProfit)}"

    /** The two parts under the total, a line each, for a tile's small print. */
    val tileLines: String get() = "$silverLabel ${Money.pkrLac(silver)}\n$goldLabel ${Money.pkrLac(gold)}\n$goldCaption"

    /** "Silver PKR 6 lac · Gold PKR 4 lac (est. 10% margin)": one line of words. */
    val line: String get() = "Silver ${Money.pkrLac(silver)} · Gold ${Money.pkrLac(gold)} (est. ${GoldApart.percentText(percent)}% margin)"

    companion object {
        /** Null where gold is not apart ([percent] null: Taheri). */
        fun of(b: Books, percent: Double?): AnaSplit? =
            if (percent == null) null else AnaSplit(b.totalSales, b.silverRevenue, b.goldRevenue, b.goldProfit, percent)
    }
}

/** The split of this period's books; null where gold is not apart. */
val AnaLedger.split: AnaSplit? get() = AnaSplit.of(books, goldApartMargin)

/** "Revenue by metal": one bar, silver then gold, with the gold's estimated profit under it. */
@Composable
fun AnaMetalRevenue(split: AnaSplit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        AnaLabelledStack(
            "Revenue by metal",
            listOf(AnaPartSpec(split.silverLabel, split.silver, 1), AnaPartSpec(split.goldLabel, split.gold, 3)),
        )
        AnaMuted(split.goldCaption)
    }
}

/** Silver and gold per day, week or month, piled: the Sales page's picture of the split. */
@Composable
fun AnaMetalTrend(l: AnaLedger, split: AnaSplit, bucket: Bucket) {
    val groups = remember(l, bucket) {
        silverGoldRows(l.books.salesOverTime, bucket, l.range, l.now).map { AnaGroup(it.label, listOf(it.silver, it.gold)) }
    }
    AnaBarsChart(
        groups, listOf(AnaSeries(split.silverLabel, anaColor(1)), AnaSeries(split.goldLabel, anaColor(3))),
        Modifier, stacked = true, height = 200.dp,
    )
}
