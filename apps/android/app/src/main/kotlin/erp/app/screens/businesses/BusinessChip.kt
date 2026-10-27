package erp.app.screens.businesses

import erp.app.ui.icons.Symbols
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.config.Businesses
import erp.app.config.House
import erp.app.ui.Radius
import erp.app.ui.rememberHaptics

/**
 * The open business at the top of the app: its mark and name (BusinessChip.swift). Tap opens the Businesses sheet; touch and hold lists the
 * businesses to switch between at once. With only one business it stays, quietly (no arrows, the secondary colour): it is still the way
 * to add another. The wide navigation rail's header says the ERP's whole name.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun BusinessChip(modifier: Modifier = Modifier, wide: Boolean = false) {
    val list by Businesses.list.collectAsStateWithLifecycle()
    val open by Businesses.currentFlow.collectAsStateWithLifecycle()
    // The demo is one business, a launch flag, not something to switch from.
    val many = list.size > 1 && !House.isDemo
    var menu by remember { mutableStateOf(false) }
    val haptics = rememberHaptics()
    val tone = if (many) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant

    Box(modifier) {
        Row(
            Modifier
                .clip(Radius.chipShape)
                .heightIn(min = 48.dp)
                .then(if (wide) Modifier.fillMaxWidth() else Modifier)
                .combinedClickable(
                    role = Role.Button,
                    onClickLabel = if (many) "List the businesses" else "Add a business",
                    onLongClickLabel = if (many) "Switch business" else null,
                    onLongClick = { if (many) { haptics.selection(); menu = true } else Businesses.openSheet() },
                    onClick = { Businesses.openSheet() },
                )
                .padding(horizontal = if (wide) 16.dp else 6.dp)
                .semantics { contentDescription = "Business: ${open.displayName}" },
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BusinessBadge(open, size = if (wide) 32.dp else 30.dp)
            // In a tab's top bar the title already has little room (Home's is the shop's name): the mark carries the business there, and
            // its name is the chip's spoken label. The wide rail's header has room to say it.
            if (wide) {
                Text(
                    open.displayName, Modifier.weight(1f),
                    style = MaterialTheme.typography.titleMedium, color = tone, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            if (many) Icon(Symbols.UnfoldMore, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            for (b in list) {
                DropdownMenuItem(
                    text = { Text(b.displayName) },
                    leadingIcon = { if (b.id == open.id) Icon(Symbols.Check, "Open now") else BusinessBadge(b, size = 24.dp) },
                    onClick = { menu = false; if (b.id != open.id) { haptics.selection(); Businesses.switchTo(b.id) } },
                )
            }
            DropdownMenuItem(
                text = { Text("Businesses…") },
                leadingIcon = { Icon(Symbols.Domain, null) },
                onClick = { menu = false; Businesses.openSheet() },
            )
        }
    }
}
