package erp.app.screens.settings

import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.OpenInBrowser
import androidx.compose.material.icons.filled.RemoveCircleOutline
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import erp.app.ui.ErpPullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import erp.app.config.House
import erp.app.data.ErpApi
import erp.app.device.openAddress
import erp.app.ui.ActionRow
import erp.app.ui.AppClock
import erp.app.ui.Tone
import erp.app.ui.ShopDate
import erp.app.ui.SkeletonLoading
import erp.app.ui.ValueInput
import erp.app.ui.ValueRow
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import erp.core.ERPDate
import erp.core.logic.Money
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Settings → Shopify. Where the store connection stands, which permissions the token holds, and a selective, one-way
 * import of Shopify orders into the ERP. Nothing here pushes ERP data out to Shopify. The one action that writes to
 * Shopify, registering webhooks, only touches webhook settings and asks first.
 */
@Composable
fun ShopifySettings() {
    SettingsOwnersOnly("Shopify") { ShopifyInnerForm() }
}

private enum class Busy { Status, List, Importing, Webhooks }

private val outcomeTime: DateTimeFormatter = DateTimeFormatter.ofPattern("h:mm a", Locale.UK).withZone(ERPDate.karachi)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ShopifyInnerForm(initialStatus: ShopifyStatus? = null, initialOrders: List<PullOrder>? = null) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var status by remember { mutableStateOf(initialStatus) }
    var statusFailure by remember { mutableStateOf<String?>(null) }

    var orders by remember { mutableStateOf(initialOrders) }
    var since by remember { mutableStateOf<Int?>(null) }
    var olderSkipped by remember { mutableStateOf(0) }
    var listFailure by remember { mutableStateOf<String?>(null) }

    var picked by remember { mutableStateOf<Set<String>>(emptySet()) }
    var query by remember { mutableStateOf("") }
    var outcome by remember { mutableStateOf<ImportOutcome?>(null) }
    var importFailure by remember { mutableStateOf<String?>(null) }
    var webhookMessage by remember { mutableStateOf<String?>(null) }
    var webhookFailure by remember { mutableStateOf<String?>(null) }

    var busy by remember { mutableStateOf<Set<Busy>>(emptySet()) }
    var confirmImport by remember { mutableStateOf(false) }
    var confirmWebhooks by remember { mutableStateOf(false) }
    var permissionsOpen by remember { mutableStateOf(false) }
    var reviewOpen by remember { mutableStateOf(false) }

    // Writes are refused in the demo house; reads still work so the screen can be seen.
    val isDemo = House.isDemo
    val writing = Busy.Importing in busy || Busy.Webhooks in busy

    suspend fun loadStatus() {
        if (Busy.Status in busy) return
        busy = busy + Busy.Status
        try {
            status = ShopifyStatus.from(ErpApi.shared.get("/api/shopify/status"))
            statusFailure = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            statusFailure = e.message ?: e.toString()
        } finally {
            busy = busy - Busy.Status
        }
    }

    suspend fun loadOrders() {
        if (Busy.List in busy) return
        busy = busy + Busy.List
        try {
            @Suppress("UNCHECKED_CAST")
            val v = ErpApi.shared.get("/api/shopify/pull") as? Map<String, Any?> ?: emptyMap()
            (v["error"] as? String)?.takeIf { it.isNotEmpty() }?.let { throw ErpApi.Failure(0, it) }
            val list = ShopifyLogic.orders(v["orders"])
            orders = list
            since = (v["since"] as? Number)?.toInt()
            olderSkipped = (v["olderSkipped"] as? Number)?.toInt() ?: 0
            picked = picked.intersect(list.map { it.id }.toSet())
            listFailure = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Keep the previous list; only report the failure.
            listFailure = e.message ?: e.toString()
        } finally {
            busy = busy - Busy.List
        }
    }

    suspend fun load() { loadStatus(); if (status?.configured == true) loadOrders() }

    // A screenshot hands over what the ERP would have said: nothing is asked.
    LaunchedEffect(Unit) { if (initialStatus == null) load() }
    // Back from the browser's reauthorize: the store's permissions may have changed.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { if (initialStatus == null) scope.launch { loadStatus() } }

    fun runImport() {
        if (isDemo || writing || picked.isEmpty()) return
        val ids = picked.toList()
        busy = busy + Busy.Importing
        importFailure = null
        scope.launch {
            try {
                // POST { orderIds } → { success, imported: { orders, customers, products }, errors: [string] }.
                @Suppress("UNCHECKED_CAST")
                val v = ErpApi.shared.send("/api/shopify/pull", body = mapOf("orderIds" to ids))
                if (v["success"] != true && (v["error"] as? String).orEmpty().isNotEmpty()) throw ErpApi.Failure(0, v["error"] as String)
                val errors = (v["errors"] as? List<*>).orEmpty().map { it as? String ?: it.toString() }
                val imported = ((v["imported"] as? Map<*, *>)?.get("orders") as? Number)?.toInt() ?: 0
                outcome = ImportOutcome(ids.size, imported, errors, outcomeTime.format(AppClock.now()).replace(Regex("(?i)\\s*([ap])\\.?m\\.?$")) { " ${it.groupValues[1].lowercase()}m" })
                picked = picked - ids.toSet()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                importFailure = e.message ?: e.toString()
            }
            busy = busy - Busy.Importing
            loadOrders()
            loadStatus()
        }
    }

    fun registerWebhooks() {
        if (isDemo || writing) return
        busy = busy + Busy.Webhooks
        webhookMessage = null; webhookFailure = null
        scope.launch {
            try {
                // POST → { success, registered: [topic], skipped: [topic] } (orders/create and orders/updated).
                val v = ErpApi.shared.send("/api/shopify/register-webhooks")
                (v["error"] as? String)?.takeIf { it.isNotEmpty() }?.let { throw ErpApi.Failure(0, it) }
                val registered = (v["registered"] as? List<*>).orEmpty().mapNotNull { it as? String }.filter { it.isNotEmpty() }
                val skipped = (v["skipped"] as? List<*>).orEmpty().mapNotNull { it as? String }.filter { it.isNotEmpty() }
                webhookMessage = ShopifyLogic.webhookMessage(registered, skipped)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                webhookFailure = e.message ?: e.toString()
            }
            busy = busy - Busy.Webhooks
            loadStatus()
        }
    }

    val list = orders.orEmpty()
    val visible = remember(orders, query) { ShopifyLogic.visible(list, query) }
    val pickedOrders = list.filter { it.id in picked }
    val pickedTotal = pickedOrders.sumOf { it.amount }
    val allVisibleOn = visible.isNotEmpty() && visible.all { it.id in picked }

    ErpPullToRefreshBox(isRefreshing = false, onRefresh = { scope.launch { load() } }) {
        SettingsPage {
            // MARK: Status
            SettingsSection("Connection") {
                val s = status
                if (s != null) {
                    ValueRow("Status") {
                        val tone = if (!s.configured) Tone.quiet else if (s.connected == true) Tone.settled else Tone.owed
                        Icon(
                            if (!s.configured) Icons.Filled.RemoveCircleOutline else if (s.connected == true) Icons.Filled.CheckCircle else Icons.Filled.Warning,
                            contentDescription = null, Modifier.size(18.dp), tint = tone.color(),
                        )
                        Text("  " + ShopifyLogic.statusText(s), color = tone.color())
                    }
                    s.shopName?.takeIf { it.isNotEmpty() }?.let { n -> ValueRow("Store") { ReadOnly(n) } }
                    s.shop?.let { d -> ValueRow("Domain") { ReadOnly(d) } }
                    if (s.configured) ValueRow("Last import") { ReadOnly(s.lastSyncedAt?.let { ShopDate.say(it, withTime = true) } ?: "Not yet") }
                    s.error?.takeIf { it.isNotEmpty() }?.let { NoteRow(it, Tone.owed) }
                    if (!s.configured) NoteRow("This house has no Shopify store set up.")
                    statusFailure?.let { NoteRow("Couldn't refresh: $it") }
                    if (s.configured) ShopifyLogic.reauthorizeUrl(s, House.serverUrl)?.let { url ->
                        ActionRow(
                            if (s.connected == true) "Reauthorize in the browser" else "Connect in the browser",
                            onClick = { openAddress(context, Intent.ACTION_VIEW, url) }, icon = Icons.Filled.OpenInBrowser, enabled = !isDemo && !writing,
                        )
                    }
                } else if (statusFailure != null) {
                    NoteRow(statusFailure!!)
                    Retry("Check connection again", Busy.Status in busy, writing) { scope.launch { loadStatus() } }
                } else {
                    Column(Modifier.fillMaxWidth().ledgerRow()) { SkeletonLoading(compact = true) }
                }
                if (s != null) Retry("Check connection", Busy.Status in busy, writing) { scope.launch { loadStatus() } }
            }

            val s = status
            if (s != null && s.configured) {
                // MARK: Permissions
                val held = (s.scopes ?: emptyList()).toSet()
                val missing = ShopifyLogic.missing(held)
                SettingsSection("Permissions", "Write access includes read access.") {
                    if (s.connected != true || s.scopes == null) {
                        NoteRow("Permissions are shown once the store answers.")
                    } else {
                        ValueRow("Required") {
                            val tone = if (missing.isEmpty()) Tone.settled else Tone.owed
                            Icon(if (missing.isEmpty()) Icons.Filled.Verified else Icons.Filled.Warning, contentDescription = null, Modifier.size(18.dp), tint = tone.color())
                            Text("  " + if (missing.isEmpty()) "All granted" else "${missing.size} missing", color = tone.color())
                        }
                        Row(
                            Modifier.fillMaxWidth().clickable(role = Role.Button) { permissionsOpen = !permissionsOpen }.ledgerRow(),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text("Permissions", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                            Icon(Icons.Filled.ExpandMore, if (permissionsOpen) "Collapse" else "Expand", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (permissionsOpen) {
                            ShopifyLogic.scopeNeeds.forEach { need ->
                                val r = ShopifyLogic.holds(held, "read_${need.resource}")
                                val w = ShopifyLogic.holds(held, "write_${need.resource}")
                                Column(Modifier.fillMaxWidth().ledgerRow(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(need.label, style = MaterialTheme.typography.titleSmall)
                                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                        ScopeChip("Read", r)
                                        ScopeChip("Write", w)
                                    }
                                }
                            }
                            val extra = ShopifyLogic.extra(held)
                            if (extra.isNotEmpty()) {
                                Column(Modifier.fillMaxWidth().ledgerRow(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text("Also granted", style = MaterialTheme.typography.titleSmall)
                                    Text(extra.joinToString(", "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                        if (missing.isNotEmpty()) NoteRow("Reauthorize in the browser to grant: ${missing.joinToString(", ")}.")
                    }
                }

                // MARK: Webhooks
                SettingsSection("Order notices", if (isDemo) "Not available in the demo." else "Webhooks let Shopify tell the ERP about orders as they happen.") {
                    if (s.connected == true) {
                        ValueRow("Pointing at this ERP") { ReadOnly(s.webhooksHere?.toString() ?: "Unknown") }
                        ValueRow("On the store in all") { ReadOnly(s.webhooksTotal?.toString() ?: "Unknown") }
                        if (s.webhooksHere == 0) NoteRow("No webhooks point at this ERP, so new Shopify orders won't arrive by themselves.", Tone.owed)
                    }
                    webhookMessage?.let { NoteRow(it, Tone.settled) }
                    webhookFailure?.let { NoteRow(it, Tone.problem) }
                    ActionRow("Register webhooks", onClick = { confirmWebhooks = true }, enabled = !isDemo && !writing && s.connected == true)
                    if (Busy.Webhooks in busy) Column(Modifier.fillMaxWidth().ledgerRow()) { SkeletonLoading(compact = true) }
                }

                // MARK: Import
                SettingsSection("Import orders", "Shopify orders that aren't in the ERP yet. Import is one way: nothing is written back to Shopify.") {
                    outcome?.let { r -> OutcomeView(r) { outcome = null } }
                    importFailure?.let { NoteRow("Import failed: $it", Tone.problem) }
                    if (orders != null) {
                        listFailure?.let { NoteRow("Couldn't refresh the list: $it") }
                        if (olderSkipped > 0 && since != null) NoteRow(ShopifyLogic.olderSkipped(olderSkipped, since))
                        if (list.isEmpty()) {
                            NoteRow("Every Shopify order after #${since?.toString() ?: "the cutoff"} is already in the ERP.", Tone.settled)
                        } else {
                            ValueRow("Filter") { ValueInput(query, { query = it }, "Filter by order number or customer", "Filter by order number or customer") }
                            Row(Modifier.fillMaxWidth().ledgerRow(), verticalAlignment = Alignment.CenterVertically) {
                                TextButton(
                                    onClick = {
                                        picked = if (allVisibleOn) picked - visible.map { it.id }.toSet() else picked + visible.map { it.id }.toSet()
                                    },
                                    enabled = visible.isNotEmpty() && !writing,
                                ) { Text(if (allVisibleOn) "Clear all ${visible.size}" else "Select all ${visible.size}") }
                                Text("", Modifier.weight(1f))
                                Text("${list.size} not imported", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            if (visible.isEmpty()) NoteRow("Nothing matches that search.")
                            visible.forEach { o -> OrderRow(o, o.id in picked, !writing) { picked = if (o.id in picked) picked - o.id else picked + o.id } }
                        }
                    } else if (listFailure != null) {
                        NoteRow(listFailure!!)
                    } else {
                        Column(Modifier.fillMaxWidth().ledgerRow()) { SkeletonLoading(compact = true) }
                    }
                    Retry(if (orders == null) "Check for new orders" else "Re-check", Busy.List in busy, writing) { scope.launch { loadOrders() } }
                }

                if (list.isNotEmpty() || picked.isNotEmpty()) {
                    SettingsSection(footer = if (isDemo) "Importing is not available in the demo." else null) {
                        if (picked.isNotEmpty()) {
                            ValueRow("Selected") { ReadOnly("${picked.size}") }
                            ValueRow("Total") { ReadOnly(Money.pkr(pickedTotal)) }
                            val hidden = pickedOrders.count { o -> visible.none { it.id == o.id } }
                            if (hidden > 0) NoteRow("$hidden selected order${if (hidden == 1) " is" else "s are"} hidden by the filter and will still be imported.")
                            Row(
                                Modifier.fillMaxWidth().clickable(role = Role.Button) { reviewOpen = !reviewOpen }.ledgerRow(),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text("Review selection", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                                Icon(Icons.Filled.ExpandMore, if (reviewOpen) "Collapse" else "Expand", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            if (reviewOpen) pickedOrders.forEach { o ->
                                Row(Modifier.fillMaxWidth().ledgerRow(), verticalAlignment = Alignment.CenterVertically) {
                                    Text(o.title, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace))
                                    Text(Money.pkr(o.amount), style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits))
                                }
                            }
                        }
                        ActionRow(
                            if (picked.isEmpty()) "Select orders to import" else "Import ${picked.size} order${if (picked.size == 1) "" else "s"}",
                            onClick = { confirmImport = true }, icon = Icons.Filled.FileDownload,
                            enabled = !isDemo && picked.isNotEmpty() && !writing && Busy.List !in busy,
                        )
                        if (Busy.Importing in busy) Column(Modifier.fillMaxWidth().ledgerRow()) { SkeletonLoading(compact = true) }
                        if (picked.isNotEmpty()) ActionRow("Clear selection", onClick = { picked = emptySet() }, enabled = !writing, tone = Tone.problem)
                    }
                }
            }
        }
    }

    if (confirmImport) {
        AlertDialog(
            onDismissRequest = { confirmImport = false },
            title = { Text(ShopifyLogic.importTitle(picked.size, pickedTotal)) },
            text = { Text("They become ERP invoices with their Shopify payments. Nothing is written back to Shopify.") },
            confirmButton = { TextButton(onClick = { confirmImport = false; runImport() }) { Text("Import ${picked.size} order${if (picked.size == 1) "" else "s"}") } },
            dismissButton = { TextButton(onClick = { confirmImport = false }) { Text("Cancel") } },
        )
    }
    if (confirmWebhooks) {
        AlertDialog(
            onDismissRequest = { confirmWebhooks = false },
            title = { Text("Register webhooks on Shopify?") },
            text = { Text("This changes the store's webhook settings so Shopify notifies the ERP of new and updated orders. It does not change orders, customers or products.") },
            confirmButton = { TextButton(onClick = { confirmWebhooks = false; registerWebhooks() }) { Text("Register webhooks") } },
            dismissButton = { TextButton(onClick = { confirmWebhooks = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun Retry(title: String, busy: Boolean, writing: Boolean, onClick: () -> Unit) {
    ActionRow(title, onClick = onClick, icon = Icons.Filled.Refresh, enabled = !busy && !writing)
}

@Composable
private fun ScopeChip(title: String, ok: Boolean) {
    Row(
        Modifier.semantics { contentDescription = "$title ${if (ok) "granted" else "missing"}" },
        horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(if (ok) Icons.Filled.CheckCircle else Icons.Filled.Cancel, contentDescription = null, Modifier.size(16.dp), tint = (if (ok) Tone.settled else Tone.problem).color())
        Text(title, style = MaterialTheme.typography.bodySmall, color = (if (ok) Tone.settled else Tone.problem).color())
    }
}

@Composable
private fun OrderRow(o: PullOrder, on: Boolean, enabled: Boolean, toggle: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp)
            .clickable(enabled = enabled, role = Role.Checkbox, onClick = toggle)
            .semantics { selected = on }
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top,
    ) {
        Icon(if (on) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked, if (on) "Selected" else "Not selected", Modifier.size(24.dp), tint = if (on) ErpColors.accent else MaterialTheme.colorScheme.onSurfaceVariant)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(o.title, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Medium))
                if (o.amount > 0) Text(Money.pkr(o.amount), style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits))
            }
            if (o.subtitle.isNotEmpty()) Text(o.subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (o.date.isNotEmpty()) Text(ShopDate.say(o.date, withTime = false), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun OutcomeView(r: ImportOutcome, dismiss: () -> Unit) {
    val tone = if (r.clean) Tone.settled else Tone.owed
    Column(Modifier.fillMaxWidth().ledgerRow(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(if (r.clean) Icons.Filled.CheckCircle else Icons.Filled.Warning, contentDescription = null, Modifier.size(20.dp), tint = tone.color())
            Text("Imported ${r.imported} of ${r.requested} order${if (r.requested == 1) "" else "s"}", style = MaterialTheme.typography.bodyLarge, color = tone.color())
        }
        Text(r.whenText, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (r.errors.isNotEmpty()) {
            Text("${r.errors.size} problem${if (r.errors.size == 1) "" else "s"}:", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold))
            r.errors.forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium, color = Tone.problem.color()) }
        }
        TextButton(onClick = dismiss) { Text("Dismiss") }
    }
}
