package erp.app.screens.orders

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Diamond
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Hardware
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import erp.app.ui.Radius
import erp.app.ui.ShopDate
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.theme.TabularDigits
import erp.core.logic.Money
import erp.core.logic.describeMetal
import erp.core.logic.describePlating
import erp.core.models.MetalType
import erp.core.models.OrderItem

/**
 * One piece of an order, as the bench and the counter both need it (src/app/orders/[id]/page.tsx): what it is,
 * every specification the order captured (one line of facts, not a table), who has it and whether it has left the
 * shop, the instructions for the karigar, and its price. The tick is the web's "Mark as Complete".
 */
@Composable
fun OrderPieceRow(
    index: Int,
    item: OrderItem,
    /** The karigar's name; null when none is picked. */
    karigar: String?,
    /** Owners tick pieces off, until the order is invoiced. */
    canTick: Boolean,
    busy: Boolean,
    /** The price broken into metal, wastage, making, diamonds and stones: owners only. */
    showBreakdown: Boolean,
    onTick: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
        // A finished piece sits quieter than one still to make.
        Column(Modifier.weight(1f).alpha(if (item.isCompleted) 0.7f else 1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Heading(index, item)
            FactLine(item)
            KarigarLine(item, karigar)
            Notes(item)
            Price(item, showBreakdown)
        }
        Tick(item, canTick, busy, onTick)
    }
}

// MARK: What it is

@Composable
private fun Heading(index: Int, item: OrderItem) {
    Column(Modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        OrdersLogic.categorySingular(item.itemCategory)?.let { category ->
            Text(
                category.uppercase(),
                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.6.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            item.description.ifEmpty { "Piece ${index + 1}" },
            style = MaterialTheme.typography.titleMedium,
            color = if (item.isCompleted) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
        )
    }
}

/**
 * "21K Gold · Est. 12.5 g · 8% wastage · Size 14 · White Rhodium": what the order captured, in the order the bench
 * reads it. The percentage stays here and on the slip; an invoice shows grams (decision "Wastage in grams").
 */
internal fun pieceFacts(item: OrderItem): List<String> {
    val out = ArrayList<String>()
    val metal = describeMetal(item.metalType, item.karat)
    if (metal.isNotEmpty()) out.add(metal)
    if (!item.isManualPrice && item.estimatedWeightG > 0) {
        out.add("Est. " + OrdersLogic.grams(item.estimatedWeightG))
        if (item.metalType != MetalType.silver && item.wastagePercentage > 0) out.add(OrdersLogic.number(item.wastagePercentage, 2) + "% wastage")
    }
    val size = item.size?.trim().orEmpty()
    if (size.isNotEmpty()) out.add("Size $size")
    describePlating(item)?.let { out.add(it) }
    if (item.stoneWeightG > 0) out.add("Stones " + OrdersLogic.grams(item.stoneWeightG))
    if (!item.referenceSku.isNullOrEmpty()) out.add("Ref " + item.referenceSku)
    if (item.sampleGiven) out.add("Sample from the customer")
    if (item.isManualPrice) out.add("Fixed at " + Money.pkr(item.manualPrice ?: item.totalEstimate ?: 0.0))
    return out
}

@Composable
private fun FactLine(item: OrderItem) {
    val all = pieceFacts(item)
    if (all.isNotEmpty()) Text(all.joinToString(" · "), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

// MARK: Who has it

/** "given yesterday", "given Tue 6 Oct", or not yet: the gold leaving the shop is its own moment. */
internal fun givenWords(item: OrderItem): String {
    val given = item.givenAt
    if (given.isNullOrEmpty()) return "not given yet"
    val said = ShopDate.say(given)
    return "given " + (if (said in listOf("Today", "Yesterday", "Tomorrow")) said.lowercase() else said)
}

/** Amber while nobody has it: work to hand out, not a promise missed. A finished piece with no karigar (made in the shop) says nothing. */
@Composable
private fun KarigarLine(item: OrderItem, karigar: String?) {
    if (karigar == null && item.isCompleted) return
    val owed = Tone.owed.color()
    val quiet = MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        Modifier.semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.Hardware, null, Modifier.size(16.dp), tint = if (karigar == null) owed else quiet)
        if (karigar != null) {
            Text(karigar, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium))
            Text("· " + givenWords(item), style = MaterialTheme.typography.bodyMedium, color = if (item.givenAt == null) owed else quiet)
        } else {
            Text("Not given out", style = MaterialTheme.typography.bodyMedium, color = owed)
        }
    }
}

// MARK: Stones, diamonds and the instructions

@Composable
private fun Notes(item: OrderItem) {
    clean(item.diamondDetails)?.let { NoteBox("Diamonds", it, Icons.Filled.Diamond, MaterialTheme.colorScheme.onSurfaceVariant) }
    clean(item.stoneDetails)?.let { NoteBox("Stones", it, Icons.Filled.AutoAwesome, MaterialTheme.colorScheme.onSurfaceVariant) }
    // Owners only: the staff's copy of the order comes without it (roles.ts).
    clean(item.adminNote)?.let { NoteBox("Instructions for the karigar (never printed)", it, Icons.Filled.Lock, Tone.owed.color()) }
}

private fun clean(s: String?): String? = (s ?: "").trim().ifEmpty { null }

@Composable
private fun NoteBox(title: String, text: String, icon: ImageVector, tint: Color) {
    Column(
        Modifier.fillMaxWidth().clip(Radius.thumbShape).background(MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.12f)).padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, Modifier.size(14.dp), tint = tint)
            Text(title, style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold), color = tint)
        }
        Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// MARK: Price, last: subordinate to what the piece is

@Composable
private fun Price(item: OrderItem, showBreakdown: Boolean) {
    val total = item.totalEstimate ?: return
    var open by remember { mutableStateOf(false) }
    if (showBreakdown && !item.isManualPrice) {
        Row(
            Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp).clickable(onClickLabel = if (open) "Hide the breakdown" else "Show the breakdown") { open = !open },
            horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Item total", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(Money.pkr(total), style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits))
            Icon(if (open) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (open) Breakdown(item)
    } else {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Item total", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(Money.pkr(total), style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits))
        }
    }
}

@Composable
private fun Breakdown(item: OrderItem) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Line("Metal", item.metalCost ?: 0.0, always = true)
        Line("Wastage", item.wastageCost ?: 0.0)
        Line("Making", item.makingCharges)
        Line("Diamonds", item.diamondCharges)
        Line("Stones", item.stoneCharges)
    }
}

@Composable
private fun Line(label: String, amount: Double, always: Boolean = false) {
    if (always || amount > 0) {
        Row(Modifier.fillMaxWidth()) {
            Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(Money.pkr(amount), style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits))
        }
    }
}

// MARK: Done

/** The tick's hit area is a finger's (48 dp), whatever the glyph. */
@Composable
private fun Tick(item: OrderItem, canTick: Boolean, busy: Boolean, onTick: (Boolean) -> Unit) {
    when {
        busy -> Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) }
        canTick -> IconButton(
            onClick = { onTick(!item.isCompleted) },
            modifier = Modifier.semantics { contentDescription = if (item.isCompleted) "Done. Tap to mark not done." else "Mark as complete" },
        ) {
            Icon(
                if (item.isCompleted) Icons.Filled.CheckCircle else Icons.Outlined.RadioButtonUnchecked, null,
                Modifier.size(28.dp), tint = if (item.isCompleted) Tone.settled.color() else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        item.isCompleted -> Box(Modifier.size(48.dp).semantics { contentDescription = "Done" }, contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.CheckCircle, null, Modifier.size(28.dp).clearAndSetSemantics {}, tint = Tone.settled.color())
        }
    }
}
