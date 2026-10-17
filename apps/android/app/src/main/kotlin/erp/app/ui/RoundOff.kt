package erp.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import erp.core.logic.discountWithOffer
import erp.core.logic.pkr
import erp.core.logic.roundOffLabel
import erp.core.logic.roundOffOffers
import erp.core.logic.rupees

/**
 * The round-off offers under a discount field (owner, 2026-10-17: "automatically offer discount options to round
 * the bill for any amount under 5000"), as components/shared/round-off-chips.tsx shows them and the iPhone's
 * `RoundOffChips`: up to three small capsules, "Round to 270,000 · −2,340". The rule is core's (MoneyRound.kt,
 * lib/money-round.ts); this is only the chips.
 *
 * [payable] is what the bill comes to before any discount (the pieces less the exchange). The chips work from what
 * is left after the discount already typed. Tapping one adds its extra to that discount; tapping the lit one puts
 * the discount back as it was. Typing in the discount field afterwards simply stops it being lit.
 */
@Composable
fun RoundOffChips(
    payable: Double,
    /** The discount as typed, any text already read to a number. */
    discount: Double,
    modifier: Modifier = Modifier,
    /** Receives the bill's whole discount once a chip is tapped (or undone). */
    onDiscountChange: (Double) -> Unit,
) {
    // The discount before the tap, and the total the tap made: lit while the bill still comes to it.
    var applied by remember { mutableStateOf<Pair<Double, Double>?>(null) }
    val disc = rupees(discount)
    val whole = rupees(payable)
    val lit = applied?.takeIf { whole - disc == it.second }
    val base = lit?.first ?: disc
    val offers = roundOffOffers(whole, base)
    if (offers.isEmpty()) return
    FlowRow(
        modifier.fillMaxWidth().semantics { contentDescription = "Round the bill off" },
        horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.End),
    ) {
        for (o in offers) {
            val chosen = lit?.second == o.target
            FilterChip(roundOffLabel(o), chosen = chosen, onClick = {
                if (chosen) {
                    applied = null
                    onDiscountChange(base)
                } else {
                    applied = base to o.target
                    onDiscountChange(discountWithOffer(base, o))
                }
            })
        }
    }
}

/** "Settle — give the remaining PKR 2,340 off" (round-off-chips.tsx SettleOffer): the words of the offer made at payment time when what would be left is under 5,000. */
object SettleWords {
    fun offer(x: Double): String = "Settle — give the remaining ${pkr(x)} off"
}

/**
 * A Settle whose payment was taken but whose remainder was not given off (the discount write was refused): the
 * money is on the bill, so the sheet must not offer to take it again.
 */
class SettleNotGiven(val paid: Double, val remainder: Double, why: String) :
    Exception("${PaymentText.pkr(paid)} is recorded. The remaining ${PaymentText.pkr(remainder)} was not taken off: $why Change the discount to give it.")
