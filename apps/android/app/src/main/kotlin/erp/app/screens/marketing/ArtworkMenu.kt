package erp.app.screens.marketing

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerRow

/** A menu with menus inside it (the iPhone's `Menu` in a `Menu`): Compose's DropdownMenu has none, so a submenu replaces the list and offers Back. */
sealed interface MenuNode {
    class Action(val label: String, val destructive: Boolean = false, val enabled: Boolean = true, val run: () -> Unit) : MenuNode
    class Sub(val label: String, val items: List<MenuNode>) : MenuNode
}

/** The dropdown itself, to put inside a Box beside whatever opens it. Closing it forgets how deep it was. */
@Composable
fun NestedMenu(expanded: Boolean, onDismiss: () -> Unit, items: List<MenuNode>) {
    var path by remember { mutableStateOf(listOf<MenuNode.Sub>()) }
    DropdownMenu(expanded = expanded, onDismissRequest = { path = emptyList(); onDismiss() }) {
        val shown = path.lastOrNull()?.items ?: items
        if (path.isNotEmpty()) {
            DropdownMenuItem(
                text = { Text(path.last().label) },
                leadingIcon = { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") },
                onClick = { path = path.dropLast(1) },
            )
        }
        for (node in shown) {
            when (node) {
                is MenuNode.Action -> DropdownMenuItem(
                    text = { Text(node.label, color = if (node.destructive) Tone.problem.color() else MaterialTheme.colorScheme.onSurface) },
                    enabled = node.enabled,
                    onClick = { path = emptyList(); onDismiss(); node.run() },
                )
                is MenuNode.Sub -> DropdownMenuItem(
                    text = { Text(node.label) },
                    trailingIcon = { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null) },
                    onClick = { path = path + node },
                )
            }
        }
    }
}

/** A form row that opens [items] as a menu: its name at the left, a chevron at the right. */
@Composable
fun ArtworkMenuRow(label: String, items: List<MenuNode>, modifier: Modifier = Modifier, value: String? = null, enabled: Boolean = true) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        Row(
            Modifier.fillMaxWidth().clickable(enabled = enabled, role = Role.DropdownList) { open = true }.ledgerRow(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge, color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
            if (value != null) Text(value, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Icon(Icons.Filled.ExpandMore, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        NestedMenu(open, { open = false }, items)
    }
}

/** A small text button that opens a menu (a photo's tools). */
@Composable
fun MenuTextButton(label: String, items: List<MenuNode>, modifier: Modifier = Modifier, enabled: Boolean = true) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        TextButton(onClick = { open = true }, enabled = enabled) {
            Text(label)
            Icon(Icons.Filled.ArrowDropDown, contentDescription = null)
        }
        NestedMenu(open, { open = false }, items)
    }
}
