package erp.app.screens.analytics

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import erp.app.ui.DividedColumn
import erp.app.ui.LedgerSection
import erp.app.ui.Tone
import erp.app.ui.TwoLine
import erp.app.ui.ledgerRow
import erp.core.logic.Money
import erp.core.logic.karatsOf
import erp.core.logic.toTola

/**
 * Analytics → Gold / Silver (components/analytics/pages/metal.tsx): how much metal left the shop. Weight, not rupees: the
 * rate moves, the grams do not. Shown in tola (how the trade talks) with grams on a touch. Gold coins (Taheri) are kept
 * apart at the bottom.
 */
@Composable
fun AnaMetalPage(l: AnaLedger, period: AnaPeriodState) {
    val b = l.books
    val metal = anaMetalWord()
    val months = l.months
    val karats = remember(months) { karatsOf(months) }

    // Chart rows in tola; a touch says tola and grams.
    val groups = remember(months, karats) { months.map { m -> AnaGroup(m.month, karats.map { k -> toTola(m.metalByKarat[k] ?: 0.0) }) } }
    val hasWeight = months.any { it.metalGrams > 0 }
    val best = months.fold(null as erp.core.logic.MonthRow?) { m, r -> if (r.metalGrams > (m?.metalGrams ?: 0.0)) r else m }
    val monthsTake = if (hasWeight && best != null) "Most ${metal.lowercase()} left in ${best.month}: ${tola(best.metalGrams, 2)} tola (${grams(best.metalGrams)} g)."
    else "No ${metal.lowercase()} weighed in the last 12 months."

    val coin = b.coinSummary
    val coinGroups = remember(months) { months.map { AnaGroup(it.month, listOf(it.coinCount)) } }
    val coinMonths = months.any { it.coinCount > 0 }

    AnaPage(period) {
        AnaChartCard("$metal sold, month by month", takeaway = monthsTake) {
            if (hasWeight) {
                AnaBarsChart(
                    groups, karats.map { AnaSeries(it.uppercase(), anaKaratColor(it)) }, stacked = true, height = 240.dp,
                    format = { t -> "${tola(t * GRAMS_PER_TOLA, 2)} tola · ${grams(t * GRAMS_PER_TOLA)} g" },
                )
                AnaMuted("Tola; touch a month for grams. The last 12 months, whatever period is picked.")
            }
        }

        AnaFigureRow(
            listOf(
                AnaFig("Tola", tola(b.metalGrams, 3), "in this period"),
                AnaFig("Grams", grams(b.metalGrams)),
                AnaFig("Pieces weighed", AnaFormat.count(b.metalPieces)),
            ),
        )

        if (b.metalByKarat.isNotEmpty()) {
            LedgerSection("By karat") {
                DividedColumn {
                    for (k in b.metalByKarat) {
                        TwoLine(
                            k.karat.uppercase(), Modifier.ledgerRow(),
                            subtitle = "${grams(k.grams)} g · ${AnaFormat.count(k.pieces)} ${if (k.pieces == 1.0) "piece" else "pieces"}",
                            trailing = tola(k.grams, 3) + " tola",
                        )
                    }
                }
            }
        }

        if (b.hasCoins) {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                if (coin.invoices > 0) {
                    AnaFigureRow(
                        listOfNotNull(
                            AnaFig("Coin revenue", Money.pkrLac(coin.revenue), "${coin.invoices} ${AnaFormat.plural(coin.invoices, "bill", "bills")} in this period", number = coin.revenue),
                            AnaFig("Coins sold", AnaFormat.count(coin.coins), if (coin.grams > 0) AnaFormat.weight(coin.grams) else "no weight recorded"),
                            AnaFig("Realised / gram", if (coin.ratePerGram > 0) Money.pkrLac(coin.ratePerGram) else "—", "revenue over grams, all-in"),
                            if (coin.outstanding > 0) AnaFig("Outstanding", Money.pkrLac(coin.outstanding), "still owed on coin bills", Tone.owed, coin.outstanding) else null,
                        ),
                    )
                } else {
                    LedgerSection("$metal coins") {
                        Text("No coin bills in this period.", Modifier.ledgerRow(), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (coinMonths) {
                    AnaChartCard("Coins sold, month by month", takeaway = "Last 12 months, whatever period is picked.") {
                        AnaBarsChart(coinGroups, listOf(AnaSeries("Coins", anaColor(1))), height = 160.dp, format = { "${Math.round(it)}" })
                    }
                }
                AnaMuted("Coins are kept apart from sales and profit: a coin sells at the metal price plus a sliver, so counting it with jewellery would inflate revenue and give it a margin it never earned.")
            }
        }
    }
}

/** 11.664 g (units.ts GRAMS_PER_TOLA). */
private const val GRAMS_PER_TOLA = 11.664

private fun tola(g: Double, digits: Int): String = AnaFormat.number(AnaFormat.tola(g), digits)

private fun grams(g: Double): String = AnaFormat.number(g, 2)
