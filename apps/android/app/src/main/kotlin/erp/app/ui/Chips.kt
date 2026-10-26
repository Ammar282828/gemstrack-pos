package erp.app.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
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

/**
 * Material 3's filter chip: the secondary container with a check when chosen, an outlined one otherwise; its count
 * beside its word. Material keeps the 48 dp touch target around the 32 dp chip.
 */
@Composable
fun FilterChip(
    title: String,
    chosen: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    count: Int? = null,
) {
    val haptics = rememberHaptics()
    // A light tick as a chip is chosen (never as the old one lets go).
    OnChange(chosen) { if (chosen) haptics.selection() }

    androidx.compose.material3.FilterChip(
        selected = chosen,
        onClick = onClick,
        modifier = modifier.semantics { role = Role.Tab },
        label = {
            Row(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(title, maxLines = 1)
                if (count != null) {
                    Text(
                        "$count",
                        style = MaterialTheme.typography.labelLarge.copy(fontFeatureSettings = TabularDigits),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                    )
                }
            }
        },
        leadingIcon = if (chosen) {
            { Icon(Icons.Filled.Check, contentDescription = null, Modifier.size(FilterChipDefaults.IconSize)) }
        } else null,
        shape = MaterialTheme.shapes.small,
    )
}
