package erp.app.screens.offline

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.config.Businesses
import erp.app.data.Connection
import erp.app.data.Outbox
import erp.app.data.OutboxEngine
import erp.app.data.OutboxEngine.Status
import erp.app.ui.AlertDialog
import erp.app.ui.LedgerHeading
import erp.app.ui.NotAvailableState
import erp.app.ui.OutlinedButton
import erp.app.ui.Pill
import erp.app.ui.TextButton
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.icons.Symbols
import erp.app.ui.ledgerCard
import erp.core.logic.Money
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

// Offline, said and kept (owner, 2026-11-03: "it should fully handle not being connected at all in any situation"). The pieces: the
// banner at the top of the app while the line is gone (or something is still to send), the sheet it opens (Waiting to send: every
// kept change with its state), the pending rows at the top of Orders and Invoices, and the row in Settings > This phone. The queue
// itself is `Outbox`; the line is `Connection`. (WaitingToSend.swift.)

/** Whether Waiting to send is open. Plain state, over the screens (a business switch rebuilds those, not this). */
object WaitingToSend {
    private val open = MutableStateFlow(false)
    val isOpen: StateFlow<Boolean> = open.asStateFlow()
    fun show() { open.value = true }
    fun hide() { open.value = false }
}

/** The banner's words: "Offline — changes will send when you're back", or how many are waiting; null when the line is there and nothing waits. */
fun offlineWords(offline: Boolean, waiting: Int): String? =
    if (offline) {
        if (waiting == 0) "Offline — changes will send when you're back" else "Offline — $waiting waiting to send"
    } else {
        if (waiting == 0) null else if (waiting == 1) "1 waiting to send" else "$waiting waiting to send"
    }

// MARK: The banner

/**
 * A slim band at the top of the app: "Offline — changes will send when you're back", or how many are waiting. Tap opens Waiting to
 * send. Nothing at all when the line is there and nothing waits. [showing] says whether it is on screen, so the app below it can
 * hand the status bar's inset to the band.
 */
@Composable
fun OfflineBanner(modifier: Modifier = Modifier) {
    val offline by Connection.isOffline.collectAsStateWithLifecycle()
    val business by Businesses.currentFlow.collectAsStateWithLifecycle()
    val items by Outbox.of(business).items.collectAsStateWithLifecycle()
    val waiting = items.count { it.status == Status.Waiting }
    val words = offlineWords(offline, waiting)
    AnimatedVisibility(
        visible = words != null, modifier = modifier,
        enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut(),
    ) {
        // The words stay while the band folds away.
        val shown = remember { arrayOfNulls<String>(1) }
        words?.let { shown[0] = it }
        Surface(
            Modifier.fillMaxWidth().clickable(role = Role.Button) { WaitingToSend.show() }
                .semantics { stateDescription = "Shows what is waiting to send" },
            color = MaterialTheme.colorScheme.secondaryContainer,
            contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
        ) {
            Row(
                Modifier.statusBarsPadding().padding(horizontal = 16.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(if (offline) Symbols.CloudOff else Symbols.Sync, null, Modifier.size(16.dp))
                Text(shown[0].orEmpty(), style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Medium), maxLines = 1)
            }
        }
    }
}

/** Whether the banner is up, so the app under it does not pad for the status bar twice. */
@Composable
fun rememberOfflineBannerShowing(): Boolean {
    val offline by Connection.isOffline.collectAsStateWithLifecycle()
    val business by Businesses.currentFlow.collectAsStateWithLifecycle()
    val items by Outbox.of(business).items.collectAsStateWithLifecycle()
    return offlineWords(offline, items.count { it.status == Status.Waiting }) != null
}

// MARK: Waiting to send

/** The sheet over the screens (AppShell): every change kept on this phone or on its way, with its state. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WaitingToSendHost() {
    val open by WaitingToSend.isOpen.collectAsStateWithLifecycle()
    if (!open) return
    ModalBottomSheet(
        onDismissRequest = WaitingToSend::hide,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.background,
    ) {
        WaitingToSendPanel(onDone = WaitingToSend::hide)
    }
}

/** A refused one is kept with its data: Retry sends it again, Discard (after asking) lets it go. */
@Composable
fun WaitingToSendPanel(onDone: () -> Unit) {
    val business by Businesses.currentFlow.collectAsStateWithLifecycle()
    val engine = Outbox.of(business)
    val items by engine.items.collectAsStateWithLifecycle()
    val offline by Connection.isOffline.collectAsStateWithLifecycle()
    var discarding by remember { mutableStateOf<OutboxEngine.Item?>(null) }
    val refused = items.filter { it.status == Status.Failed }
    val waiting = items.filter { it.status != Status.Failed }.sortedBy { it.createdAt }
    Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Waiting to send", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
            TextButton(onClick = onDone) { Text("Done") }
        }
        if (offline) {
            Row(Modifier.fillMaxWidth().ledgerCard(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Symbols.CloudOff, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(
                    "No connection. Everything here is kept on this phone and goes by itself when you're back online.",
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
        if (items.isEmpty()) {
            NotAvailableState("Nothing is waiting", why = "Everything you did is at the ERP.", icon = Symbols.CheckCircle)
        } else {
            LazyColumn(Modifier.heightIn(max = 560.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (refused.isNotEmpty()) {
                    item(key = "needs-you") { LedgerHeading("Needs you", count = refused.size, tone = Tone.late) }
                    items(refused, key = { it.id }) { WaitingRow(it, engine, onDiscard = { d -> discarding = d }) }
                    item(key = "needs-you-note") {
                        Text("The ERP refused these. Nothing is lost: what you entered is still here.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (waiting.isNotEmpty()) {
                    item(key = "waiting") { LedgerHeading("Waiting to send", count = waiting.size) }
                    items(waiting, key = { it.id }) { WaitingRow(it, engine, onDiscard = { d -> discarding = d }) }
                    item(key = "waiting-note") {
                        Text("Each goes once, in the order it was made, whatever happens to the connection or the app.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
    discarding?.let { d ->
        AlertDialog(
            onDismissRequest = { discarding = null },
            title = { Text("Discard ${d.label}?") },
            text = { Text("It has not reached the ERP. It will be gone from this phone.") },
            confirmButton = { TextButton(onClick = { engine.discard(d.id); discarding = null }) { Text("Discard", color = Tone.problem.color()) } },
            dismissButton = { TextButton(onClick = { discarding = null }) { Text("Keep it") } },
        )
    }
}

@Composable
private fun WaitingRow(item: OutboxEngine.Item, engine: OutboxEngine, onDiscard: (OutboxEngine.Item) -> Unit) {
    Column(Modifier.fillMaxWidth().ledgerCard(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(item.label, style = MaterialTheme.typography.titleMedium)
                item.summary?.let { s ->
                    val detail = listOf(s.detail, s.amount?.let { Money.pkr(it) } ?: "").filter { it.isNotEmpty() }.joinToString(" · ")
                    if (detail.isNotEmpty()) Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            PendingState(item)
        }
        if (item.status == Status.Failed) {
            if (item.message.isNotEmpty()) Text(item.message, style = MaterialTheme.typography.bodyMedium, color = Tone.problem.color())
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(onClick = { engine.retry(item.id) }) { Text("Retry") }
                if (!item.isPost) OutlinedButton(onClick = { onDiscard(item) }) { Text("Discard", color = Tone.problem.color()) }
            }
        } else if (item.durable) {
            TextButton(onClick = { onDiscard(item) }) { Text("Discard", color = Tone.problem.color()) }
        }
    }
}

/** A change's state in a capsule. */
@Composable
fun PendingState(item: OutboxEngine.Item) {
    when (item.status) {
        Status.Waiting -> Pill("Waiting to send", tone = Tone.owed, icon = Symbols.Schedule)
        Status.Saving -> Pill("Sending…", tone = Tone.working)
        Status.Retrying -> Pill("Trying again", tone = Tone.working)
        Status.Failed -> Pill("Not sent", tone = Tone.problem, icon = Symbols.ErrorOutline)
    }
}

// MARK: The pending rows of a list

/**
 * The state of the pending rows of one kind ("order" or "invoice") of a business: new orders and sales the ERP does not have yet. A list
 * puts them first as "Waiting to send", with "Pending" where the number will be, until the ERP numbers it and the real record takes its
 * place.
 */
@Composable
fun rememberPendingRecords(business: erp.app.config.Business, kind: String): List<OutboxEngine.Item> {
    val items by Outbox.of(business).items.collectAsStateWithLifecycle()
    return remember(items, kind) { items.filter { it.durable && it.summary?.kind == kind }.sortedByDescending { it.createdAt } }
}

/** The pending rows at the top of a grid list: a heading and one tile each; a tap opens Waiting to send. */
fun LazyGridScope.pendingRecords(rows: List<OutboxEngine.Item>) {
    if (rows.isEmpty()) return
    val full: androidx.compose.foundation.lazy.grid.LazyGridItemSpanScope.() -> androidx.compose.foundation.lazy.grid.GridItemSpan =
        { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }
    item(key = "pending-head", span = full) {
        LedgerHeading("Waiting to send", Modifier.padding(horizontal = 4.dp, vertical = 4.dp), count = rows.size)
    }
    items(rows.size, key = { "pending-" + rows[it].id }, span = { full() }) { i ->
        PendingRecordRow(rows[i], Modifier.padding(bottom = 2.dp))
    }
}

@Composable
private fun PendingRecordRow(item: OutboxEngine.Item, modifier: Modifier = Modifier) {
    val s = item.summary ?: erp.app.data.PendingSummary("record", item.label)
    val failed = item.status == Status.Failed
    Row(
        modifier.fillMaxWidth().ledgerCard().clickable(role = Role.Button) { WaitingToSend.show() },
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(s.title, style = MaterialTheme.typography.titleMedium, maxLines = 1)
            Text(
                listOf("Pending", s.detail).filter { it.isNotEmpty() }.joinToString(" · "),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1,
            )
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            s.amount?.let { Text(Money.pkr(it), style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold)) }
            if (failed) Pill("Not sent", tone = Tone.problem, icon = Symbols.ErrorOutline) else Pill("Waiting to send", tone = Tone.owed, icon = Symbols.Schedule)
        }
    }
}

// MARK: Settings

/** "Waiting to send (N)" in Settings > This phone: opens the sheet. Nothing when nothing is kept. */
@Composable
fun WaitingToSendSection() {
    val business by Businesses.currentFlow.collectAsStateWithLifecycle()
    val items by Outbox.of(business).items.collectAsStateWithLifecycle()
    if (items.isEmpty()) return
    erp.app.screens.settings.SettingsSection(footer = "Changes kept on this phone until the ERP has them.") {
        Row(
            Modifier.fillMaxWidth().clickable(role = Role.Button) { WaitingToSend.show() }.padding(horizontal = 16.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Symbols.Sync, null, Modifier.size(24.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Waiting to send", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
            Text("${items.size}", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
