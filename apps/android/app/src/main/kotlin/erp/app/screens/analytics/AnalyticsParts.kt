package erp.app.screens.analytics

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import erp.core.logic.ExpenseKind
import erp.core.logic.Money

// Parts of a whole with their key, and cards in a grid (the pieces of the Overview and the deep pages that are not charts).

/** The house's metal as a word: "Gold" or "Silver" (`STORE_METAL_WORD`). */
fun anaMetalWord(): String = erp.app.config.House.metal.replaceFirstChar { it.uppercase() }

/** One part of an [AnaLabelledStack]: coloured by its karat or expense kind where it has one, else by series slot 1 to 6. */
class AnaPartSpec(val label: String, val value: Double, val slot: Int = 1, val karat: String? = null, val kind: ExpenseKind? = null)

@Composable
/** The colour-resolved parts of a spec list (the bar draws these). */
internal fun partsOf(parts: List<AnaPartSpec>): List<AnaPart> = parts.map {
    AnaPart(
        it.label, it.value,
        when {
            it.karat != null -> anaKaratColor(it.karat)
            it.kind != null -> anaKindColor(it.kind)
            else -> anaColor(it.slot)
        },
    )
}

/** The key under a bar that has no room for a list: dots in a wrapping row. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AnaMiniLegend(parts: List<AnaPart>, format: (Double) -> String = { Money.lacCrore(it) }) {
    FlowRow(
        Modifier.fillMaxWidth().clearAndSetSemantics {},
        horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        for (p in parts.filter { it.value > 0 }) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(p.color))
                Text(p.label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(format(p.value), style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium))
            }
        }
    }
}

/** A caption, the bar, its key: one measure of a card that compares parts. Nothing to split says so rather than drawing an empty bar. */
@Composable
fun AnaLabelledStack(caption: String?, parts: List<AnaPartSpec>, format: (Double) -> String = { Money.pkrLac(it) }) {
    val colored = partsOf(parts)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (caption != null) Text(caption, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium))
        if (colored.none { it.value > 0 }) {
            AnaMuted("Nothing in this period.")
        } else {
            AnaStackBar100(colored, format = format, legend = false, height = 14.dp)
            AnaMiniLegend(colored, format)
        }
    }
}

/**
 * Cards in one column on a phone, in the order given; two columns where the window is wide (the iPad's room), filled
 * row by row so the order still reads left to right, as the web's grid does.
 */
@Composable
fun AnaCardGrid(cards: List<@Composable () -> Unit>) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        if (maxWidth >= 720.dp) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Top) {
                for (col in 0..1) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        cards.forEachIndexed { i, card -> if (i % 2 == col) card() }
                    }
                }
            }
        } else {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) { for (card in cards) card() }
        }
    }
}
