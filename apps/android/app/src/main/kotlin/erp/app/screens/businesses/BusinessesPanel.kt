package erp.app.screens.businesses

import erp.app.ui.TextField
import erp.app.ui.icons.Symbols
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import erp.app.ui.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import erp.app.ui.OutlinedButton
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.config.Business
import erp.app.config.BusinessFailure
import erp.app.config.Businesses
import erp.app.config.House
import erp.app.nav.ScreenTitle
import erp.app.screens.settings.SettingsPage
import erp.app.screens.settings.SettingsSection
import erp.app.ui.theme.ErpType
import erp.app.ui.FailureAlert
import erp.app.ui.LocalNoteState
import erp.app.ui.Note
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.app.ui.ledgerRow
import erp.app.ui.rememberHaptics
import erp.app.ui.theme.ErpColors
import erp.app.ui.ToggleRow
import kotlinx.coroutines.launch

/**
 * Your businesses (`/app/businesses`, and the sheet the chip opens; BusinessesScreen.swift): the ones this phone holds, which is open,
 * who is signed in to each, and the way to add another by its ERP's address. One app, many businesses (config/Businesses.kt): Taheri
 * and House of Mina ship in it; a business is added by typing its address, and its ERP describes itself (`GET /api/app/business`).
 * Each keeps its own sign-in, books, drafts, alerts and widget on this phone.
 */
@Composable
fun BusinessesScreen() {
    ScreenTitle("Businesses")
    BusinessesPanel(inSheet = false)
}

/** The sheet the chip, the sign-in page and the cold-start picker open: over the screens, which a switch rebuilds underneath. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BusinessesSheetHost() {
    val open by Businesses.sheetOpen.collectAsStateWithLifecycle()
    if (!open) return
    ModalBottomSheet(
        onDismissRequest = Businesses::closeSheet,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.background,
    ) {
        BusinessesPanel(inSheet = true)
    }
}

private sealed interface Phase {
    data object Idle : Phase
    data object Looking : Phase
    data object Adding : Phase
    data class Failed(val why: String) : Phase
}

@Composable
fun BusinessesPanel(inSheet: Boolean, demo: Boolean = House.isDemo, initialPreview: Business? = null) {
    val list by Businesses.list.collectAsStateWithLifecycle()
    val open by Businesses.currentFlow.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val note = LocalNoteState.current

    var address by remember { mutableStateOf("") }
    var phase by remember { mutableStateOf<Phase>(Phase.Idle) }
    var preview by remember { mutableStateOf(initialPreview) }
    var removing by remember { mutableStateOf<Business?>(null) }
    var editing by remember { mutableStateOf(false) }
    var ask by remember { mutableStateOf(Businesses.askAtLaunch) }
    // The email signed in to each business, by id; read once the panel is up (it makes each business's Firebase app).
    var who by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    LaunchedEffect(list) { who = list.mapNotNull { b -> Businesses.signedInEmail(b)?.let { b.id to it } }.toMap() }

    fun choose(b: Business) {
        if (b.id == open.id) { if (inSheet) Businesses.closeSheet(); return }
        haptics.selection()
        Businesses.switchTo(b.id)
    }

    fun lookUp() {
        if (demo || phase == Phase.Looking || phase == Phase.Adding) return
        phase = Phase.Looking
        preview = null
        val typed = address
        scope.launch {
            try {
                preview = Businesses.describe(typed)
                phase = Phase.Idle
            } catch (e: BusinessFailure) {
                phase = Phase.Failed(e.message ?: "That address isn't an ERP this app can open.")
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                phase = Phase.Failed(e.message ?: "Couldn't reach that address.")
            }
        }
    }

    fun add() {
        if (preview == null || phase == Phase.Adding) return
        phase = Phase.Adding
        val typed = address
        scope.launch {
            try {
                val added = Businesses.add(typed)
                haptics.success()
                address = ""
                phase = Phase.Idle
                preview = null
                // Opened at once: the next step is signing in to it.
                Businesses.switchTo(added.id)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                phase = Phase.Failed(e.message ?: "Couldn't add that business.")
            }
        }
    }

    SettingsPage(Modifier.then(if (inSheet) Modifier.padding(bottom = 24.dp) else Modifier)) {
        if (inSheet) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Businesses", Modifier.weight(1f), style = ErpType.heading)
                IconButton(onClick = Businesses::closeSheet) { Icon(Symbols.Close, "Close") }
            }
        }

        SettingsSection(footer = "Each business keeps its own sign-in, books, drafts and alerts on this phone.") {
            for ((i, b) in list.withIndex()) {
                BusinessRow(
                    b, open = b.id == open.id, who = who[b.id], demo = demo, editing = editing && list.size > 1,
                    canUp = i > 0, canDown = i < list.size - 1,
                    onChoose = { choose(b) }, onUp = { Businesses.move(i, i - 1) }, onDown = { Businesses.move(i, i + 1) },
                    onRemove = { removing = b },
                )
            }
            if (list.size > 1 && !demo) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = { editing = !editing }) { Text(if (editing) "Done" else "Edit") }
                }
            }
        }

        if (list.size > 1 && !demo) {
            SettingsSection {
                ToggleRow("Ask which business at launch", ask, { ask = it; Businesses.askAtLaunch = it }, sub = "A picker opens first, with the last business's books loading underneath.")
            }
        }

        if (Businesses.canAdd || demo) {
            SettingsSection(
                title = "Add a business",
                footer = if (demo) "The demo can't add a business."
                else "Type the address of the business's ERP, like erp.houseofmina.store. You'll see its name, logo and colours before it is added, then sign in with the Gmail it has for you.",
            ) {
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    TextField(
                        value = address,
                        onValueChange = {
                            address = it
                            // Typing again withdraws a preview or an error that belonged to the old address.
                            if (phase != Phase.Looking && phase != Phase.Adding) { phase = Phase.Idle; preview = null }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !demo && phase != Phase.Looking && phase != Phase.Adding,
                        singleLine = true,
                        placeholder = { Text("erp.houseofmina.store") },
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                        keyboardActions = androidx.compose.foundation.text.KeyboardActions(onGo = { lookUp() }),
                    )
                    OutlinedButton(onClick = ::lookUp, enabled = !demo && address.isNotBlank() && phase != Phase.Looking && phase != Phase.Adding) {
                        Text(if (phase == Phase.Looking) "Looking…" else "Look up")
                    }
                }
            }
        } else {
            SettingsSection(footer = "Add businesses in the ERP app: this build is House of Mina's own.") {}
        }

        preview?.let { found -> PreviewCard(found, known = Businesses.business(found.id) != null, adding = phase == Phase.Adding, onAdd = ::add, onDrop = { preview = null }) }
    }

    FailureAlert((phase as? Phase.Failed)?.why, onDismiss = { phase = Phase.Idle }, title = "Couldn't add that business")

    removing?.let { b ->
        val hide = b.art != null
        AlertDialog(
            onDismissRequest = { removing = null },
            title = { Text((if (hide) "Hide " else "Remove ") + b.displayName + " on this phone?") },
            text = {
                Text(
                    "You are signed out of it here and its books are cleared from this phone. Nothing in the ERP itself changes." +
                        if (hide) " You can add it back by its address." else "",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    removing = null
                    scope.launch {
                        Businesses.remove(b.id)
                        note.show(Note(title = if (hide) "Hidden on this phone" else "Removed from this phone", detail = b.displayName))
                    }
                }) { Text(if (hide) "Hide on this phone" else "Remove from this phone", color = Tone.problem.color()) }
            },
            dismissButton = { TextButton(onClick = { removing = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun BusinessRow(
    b: Business, open: Boolean, who: String?, demo: Boolean, editing: Boolean, canUp: Boolean, canDown: Boolean,
    onChoose: () -> Unit, onUp: () -> Unit, onDown: () -> Unit, onRemove: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClickLabel = if (open) null else "Open this business", onClick = onChoose).ledgerRow()
            .semantics { contentDescription = "${b.displayName}, ${if (open) "open now" else "not open"}" },
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BusinessBadge(b, size = 44.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(b.displayName, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(b.host, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Status(b, who, demo)
        }
        if (editing) {
            IconButton(onClick = onUp, enabled = canUp) { Icon(Symbols.KeyboardArrowUp, "Move ${b.displayName} up") }
            IconButton(onClick = onDown, enabled = canDown) { Icon(Symbols.KeyboardArrowDown, "Move ${b.displayName} down") }
            IconButton(onClick = onRemove) { Icon(Symbols.Delete, (if (b.art != null) "Hide " else "Remove ") + b.displayName, tint = Tone.problem.color()) }
        } else if (open) {
            Icon(Symbols.CheckCircle, "Open now", tint = ErpColors.accent)
        }
    }
}

@Composable
private fun Status(b: Business, who: String?, demo: Boolean) {
    val quiet = MaterialTheme.colorScheme.onSurfaceVariant
    when {
        demo -> Text("Demo: made-up books", style = MaterialTheme.typography.bodySmall, color = quiet)
        !b.androidReady -> Text("Android sign-in not set up", style = MaterialTheme.typography.bodySmall, color = Tone.owed.color())
        // Signed in is the normal state: the email in quiet words, no tick.
        who != null -> Text(who, style = MaterialTheme.typography.bodySmall, color = quiet, maxLines = 1, overflow = TextOverflow.Ellipsis)
        else -> Text("Signed out", style = MaterialTheme.typography.bodySmall, color = quiet)
    }
}

@Composable
private fun PreviewCard(b: Business, known: Boolean, adding: Boolean, onAdd: () -> Unit, onDrop: () -> Unit) {
    val dark = ErpColors.dark
    Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Found", style = ErpType.heading)
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
            BusinessBadge(b, size = 52.dp)
            Column {
                Text(b.displayName, style = MaterialTheme.typography.titleMedium)
                Text(b.host, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        BusinessLogo(b, height = 40.dp)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            for (hex in listOf(b.palette.light.accent, b.palette.light.ground, b.palette.dark.accent, b.palette.dark.ground)) {
                Column(Modifier.size(22.dp).background(hexColor(hex), CircleShape).border(0.5.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.18f), CircleShape)) {}
            }
            Text("Its colours, light and dark", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (!b.androidReady) {
            NoticeRow("Not set up for this Android app yet: you can add it, but signing in waits until the owner registers the app in its Firebase project.")
        }
        if (known) NoticeRow("Already on this phone: adding it again refreshes how it looks.")
        Button(onClick = onAdd, enabled = !adding, modifier = Modifier.fillMaxWidth()) {
            Icon(Symbols.AddCircle, null, Modifier.size(18.dp))
            Text(if (adding) "Adding…" else if (known) "Refresh and open ${b.name}" else "Add ${b.name}", Modifier.padding(start = 8.dp))
        }
        TextButton(onClick = onDrop, enabled = !adding, modifier = Modifier.fillMaxWidth()) { Text("Not this one") }
    }
}

@Composable
private fun NoticeRow(text: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
        Icon(Symbols.Info, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
