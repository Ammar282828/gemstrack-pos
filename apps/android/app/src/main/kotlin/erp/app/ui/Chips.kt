package erp.app.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits

/**
 * A row of filter chips that scrolls with the list rather than floating over it (a bar pinned under the top bar
 * sat over the title and greyed it out). Put it first in the page's column or as the first item of a lazy list.
 */
@Composable
fun ChipRow(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/** One chip: the accent filled when chosen, a quiet capsule otherwise; its count beside its word. */
@Composable
fun FilterChip(
    title: String,
    chosen: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    count: Int? = null,
) {
    val reduce = reduceMotion()
    val accent = ErpColors.accent
    val fill by animateColorAsState(if (chosen) accent else ErpColors.card, Motion.exit(reduce), label = "chipFill")
    val line by animateColorAsState(
        if (chosen) accent.copy(alpha = 0f) else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.18f),
        Motion.exit(reduce), label = "chipLine",
    )
    val ink = if (chosen) ErpColors.onAccent else MaterialTheme.colorScheme.onSurface
    val haptics = rememberHaptics()
    // A light tick as a chip is chosen (never as the old one lets go).
    OnChange(chosen) { if (chosen) haptics.selection() }

    // The touch target is 48 dp tall; the capsule inside it is the 36 dp the eye sees.
    Box(
        modifier
            .defaultMinSize(minHeight = MinTouchTarget)
            .selectable(selected = chosen, role = Role.Tab, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier
                .clip(CircleShape)
                .background(fill)
                .border(BorderStroke(1.dp, line), CircleShape)
                .defaultMinSize(minHeight = 36.dp)
                .padding(horizontal = 13.dp, vertical = 7.dp),
            horizontalArrangement = Arrangement.spacedBy(5.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                title,
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = if (chosen) FontWeight.SemiBold else FontWeight.Medium),
                color = ink,
                maxLines = 1,
            )
            if (count != null) {
                Text(
                    "$count",
                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = if (chosen) FontWeight.SemiBold else FontWeight.Medium, fontFeatureSettings = TabularDigits),
                    color = if (chosen) ErpColors.onAccent.copy(alpha = 0.8f) else MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
            }
        }
    }
}
