package erp.app.screens.analytics

import androidx.compose.foundation.clickable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import erp.app.ui.DividedColumn
import erp.app.ui.LedgerSection
import erp.app.ui.Tone
import erp.app.ui.TwoLine
import erp.app.ui.color
import erp.app.ui.fill
import erp.app.ui.ledgerRow
import erp.core.logic.MonthRow
import erp.core.logic.Money

/**
 * Analytics → Cash (components/analytics/pages/cash.tsx): what actually moved? Money in against money out, month by
 * month, then this period's two sides taken apart. Revenue counts what was earned (open orders and unpaid bills
 * included); cash counts only what physically moved, and the gap between them is who still owes us, listed at the bottom
 * (the Overview's "Still to collect" opens here).
 */
@Composable
fun AnaCashPage(l: AnaLedger, period: AnaPeriodState) {
    val b = l.books
    val open = rememberAnaOpen()
    val months = l.months
    val best = months.fold(null as MonthRow?) { m, r -> if (r.cashIn - r.cashOut > (if (m != null) m.cashIn - m.cashOut else Double.NEGATIVE_INFINITY)) r else m }
    val heroTake = if (best != null && (best.cashIn > 0 || best.cashOut > 0)) "Most cash kept in the last 12 months: ${best.month}, ${anaSignedLac(best.cashIn - best.cashOut)}." else "No money moved in the last 12 months."
    val groups = remember(months) { months.map { AnaGroup(it.month, listOf(it.cashIn, it.cashOut), line = it.cashIn - it.cashOut) } }

    val gapLine = if (b.accrualVsCashGap > 0)
        "${Money.pkrLac(b.accrualVsCashGap)} of the revenue is not collected yet: it sits in unpaid invoices and open orders. That gap is revenue (what was earned) less cash in (what moved), gold taken off a bill left out."
    else "Everything earned in this period has been collected."

    AnaPage(period) {
        AnaChartCard("Money in and out", takeaway = heroTake) {
            AnaBarsChart(
                groups, listOf(AnaSeries("In", Tone.settled.fill()), AnaSeries("Out", Tone.late.fill())), lineName = "Net", height = 240.dp,
                hint = "Touch a month to read it.",
            )
        }

        AnaFigureRow(
            listOf(
                AnaFig("Cash in", Money.pkrLac(b.cashIn), tone = Tone.settled, number = b.cashIn),
                AnaFig("Cash out", Money.pkrLac(b.cashOut), tone = if (b.cashOut > 0) Tone.late else null, number = b.cashOut),
                AnaFig(
                    "Net cash", anaSignedLac(b.netCashFlow), if (b.netCashFlow >= 0) "Cash grew this period" else "More went out than came in",
                    tone = if (b.netCashFlow >= 0) Tone.settled else Tone.late, number = b.netCashFlow,
                ),
            ),
        )

        AnaColumns(
            left = {
                AnaChartCard("Where the cash came from", takeaway = if (b.cashIn > 0) "${Money.pkrLac(b.cashIn)} came in." else "No cash came in during this period.") {
                    if (b.cashIn > 0) AnaStackBar100(partsOf(anaCashInParts(l)))
                }
            },
            right = {
                AnaChartCard("Where the cash went", takeaway = if (b.cashOut > 0) "${Money.pkrLac(b.cashOut)} went out." else "No cash went out during this period.") {
                    if (b.cashOut > 0) AnaStackBar100(partsOf(anaCashOutParts(l)))
                }
            },
        )

        AnaMuted(gapLine)

        LedgerSection("Who still owes us", footer = {
            if (b.receivables.isNotEmpty()) {
                Text(
                    (if (b.receivables.size > 15) "Largest 15 of ${b.receivables.size} unpaid" else "${b.receivables.size} unpaid") + " · Total owed ${Money.pkrLac(b.receivablesTotal)}",
                )
            }
        }) {
            if (b.receivables.isEmpty()) {
                Text("Nobody owes anything on this period’s sales.", Modifier.ledgerRow(), color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                DividedColumn {
                    for (r in b.receivables.take(15)) {
                        val date = AnaDate.parseISO(r.date)?.let { AnaDate.dayMonthYear(it) } ?: r.date
                        TwoLine(
                            r.customerName, Modifier.clickable(role = Role.Button, onClickLabel = "Open invoice ${r.id}") { open(AnaPath.invoice(r.id)) }.ledgerRow(),
                            subtitle = date + if (r.coinDue > 0) " · ${Money.lacCrore(r.coinDue)} of it on coins" else "",
                            trailing = Money.lacCrore(r.balanceDue), trailingTint = Tone.owed.color(),
                        )
                    }
                }
            }
        }
    }
}
