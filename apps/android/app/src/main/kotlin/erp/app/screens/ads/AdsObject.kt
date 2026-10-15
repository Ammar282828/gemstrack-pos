package erp.app.screens.ads

import androidx.compose.foundation.layout.Box
import erp.app.ui.zoomDestination
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.AttachMoney
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.People
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenTitle
import erp.app.ui.FieldRow
import erp.app.ui.LedgerSection
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.ToggleRow
import erp.app.ui.ledgerRow
import erp.app.ui.color
import erp.app.web.openOutside
import erp.core.ERPDate
import erp.core.Container
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** "ad_set" → "Ad Set": the key as a title (Swift `.capitalized` after underscores become spaces). */
fun adsTitleCase(key: String): String =
    key.replace("_", " ").split(' ').joinToString(" ") { w -> if (w.isEmpty()) w else w.take(1).uppercase() + w.drop(1).lowercase() }

/** A value of the object as Swift prints it (`String(describing:)`): a whole number without ".0". */
fun adsPrint(v: Any?): String = when (v) {
    is Double -> if (v == Math.rint(v) && Math.abs(v) < 9e15) v.toLong().toString() else v.toString()
    else -> v.toString()
}

/** A number from a number or numeric text (`number(_:)`). */
private fun number(v: Any?): Double = when (v) {
    is Number -> v.toDouble()
    is String -> v.toDoubleOrNull() ?: 0.0
    else -> 0.0
}

/**
 * The campaign menu and ad review (AdsObject.swift): a campaign, ad set or ad on the account-scoped routes the ERP uses
 * (`/api/ads/object/<id>?level=`): status, preview, name, budget and schedule, audience, make-from-this, Meta's review
 * notes, archive and delete.
 */
@Composable
fun AdsObjectScreen(path: String) {
    Box(Modifier.fillMaxSize().zoomDestination(path)) { AdsObjectBody(path) }
}

@Composable
private fun AdsObjectBody(path: String) {
    val backend = LocalAdsBackend.current
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val id = AdsQuery.value("id", path) ?: ""
    val level = AdsQuery.value("level", path) ?: "ad"

    var response by remember { mutableStateOf<Map<String, Any?>?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var hasEnd by remember { mutableStateOf(false) }
    var end by remember { mutableStateOf(Instant.now().plusSeconds(7 * 86_400)) }
    var confirming by remember { mutableStateOf<String?>(null) }
    var audience by remember { mutableStateOf<AdsAudience?>(null) }
    var audienceSheet by remember { mutableStateOf(false) }
    var budgeting by remember { mutableStateOf<AdsBudgetTarget?>(null) }
    var format by remember { mutableStateOf(0) }

    val obj: Map<String, Any?> = response?.obj(level) ?: emptyMap()
    val currency = response?.get("currency") as? String ?: "PKR"
    val previews: List<Map<String, Any?>> = (response?.get("previews") as? List<*>).orEmpty().mapNotNull {
        @Suppress("UNCHECKED_CAST")
        it as? Map<String, Any?>
    }
    val budget = response?.obj("budget")
    val totalBudget = number(budget?.get("lifetime")) > 0

    ScreenTitle(name.ifEmpty { "Ad details" })

    suspend fun load() {
        try {
            val r = backend.objectDetail(id, level)
            response = r
            val o = r.obj(level) ?: emptyMap()
            name = o["name"] as? String ?: ""
            val value = o[if (level == "campaign") "stop_time" else "end_time"] as? String
            hasEnd = AdsDays.parse(value) != null
            end = AdsDays.parse(value) ?: Instant.now().plusSeconds(7 * 86_400)
            r.obj("audience")?.let { audience = AdsAudience.fromMap(it) }
            failure = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failure = adsWords(e)
        }
    }

    suspend fun act(action: String, fields: Map<String, Any?>) {
        if (busy) return
        busy = true
        failure = null
        try {
            backend.objectAct(id, level, action, fields)
            // The pages under this one read the tree again.
            AdsChanges.bump()
            if (action == "delete" || action == "archive") navigator.back() else load()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failure = adsWords(e)
        } finally {
            busy = false
        }
    }

    LaunchedEffect(id, level) { load() }

    if (response == null) {
        if (failure != null) {
            AdsUnavailable("Couldn't load this $level", failure ?: "") {
                AdsProminentButton("Try again", { failure = null; scope.launch { load() } })
            }
        } else {
            SkeletonLoading(Modifier.fillMaxSize(), label = "Reading")
        }
    } else {
        AdsPage {
            AdsTwoPane(
                left = {
                    failure?.let { f -> AdsSection(null) { AdsRow { Text(f, color = Tone.problem.color()) } } }
                    if (busy) AdsSection(null) { AdsReading("Saving…") }
                    AdsSection("Status") {
                        AdsRow(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            AdsStatusBadge(obj["effective_status"] as? String ?: "")
                            val active = obj["status"] as? String == "ACTIVE"
                            AdsTonalButton(if (active) "Pause" else "Run", {
                                if (active) scope.launch { act("status", mapOf("status" to "PAUSED")) } else confirming = "activate"
                            }, enabled = !busy)
                        }
                    }
                    if (level == "ad") PreviewSection(obj, previews, name, id, format, { format = it }) { openOutside(context, android.net.Uri.parse(it)) }
                    AdsSection("Name") {
                        FieldRow("Name", name, { name = it }, singleLine = false, maxLines = 4)
                        val trimmed = name.trim()
                        AdsActionRow("Save name", { scope.launch { act("rename", mapOf("name" to trimmed)) } }, enabled = !busy && trimmed.isNotEmpty() && name != (obj["name"] as? String))
                    }
                    if (level != "ad") {
                        AdsSection("Budget and schedule") {
                            if (budget != null && (number(budget["daily"]) > 0 || number(budget["lifetime"]) > 0)) {
                                AdsActionRow("Change budget", {
                                    budgeting = AdsBudgetTarget(
                                        level, id, name,
                                        daily = number(budget["daily"]).takeIf { it > 0 }, lifetime = number(budget["lifetime"]).takeIf { it > 0 },
                                        end = obj[if (level == "campaign") "stop_time" else "end_time"] as? String, currency = currency,
                                    )
                                }, icon = Icons.Filled.AttachMoney)
                            }
                            ToggleRow("End date", hasEnd || totalBudget, { if (!totalBudget) hasEnd = it })
                            if (hasEnd || totalBudget) AdsDayTimeRow("Stops", end, min = Instant.now()) { end = it }
                            AdsActionRow("Save schedule", {
                                scope.launch { act("schedule", mapOf("end" to if (hasEnd || totalBudget) ERPDate.iso(end) else null)) }
                            }, enabled = !busy)
                            if (totalBudget) {
                                AdsRow { Text("A total budget needs an end date. Meta spreads the budget up to it.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            }
                        }
                    }
                },
                right = {
                    if (level == "adset") {
                        AdsSection("Audience and placements") {
                            AdsActionRow("Edit audience and placements", { audienceSheet = true }, icon = Icons.Filled.People, enabled = audience != null && !busy)
                            AdsDetails(obj.obj("targeting") ?: emptyMap())
                        }
                    }
                    AdsSection("Make from this") {
                        val q = AdsQuery.escape(id)
                        when (level) {
                            "ad" -> {
                                AdsNavRow("Make one like this", "/ads/new?from=$q")
                                AdsNavRow("Into new ad sets", "/ads/adset?ads=$q")
                            }
                            "campaign" -> AdsNavRow("Add ad sets", "/ads/adset?campaign=$q")
                            else -> AdsNavRow("Copy and change", "/ads/adset?from=$q")
                        }
                        AdsActionRow("Duplicate (paused)", { confirming = "duplicate" }, icon = Icons.Filled.ContentCopy, enabled = !busy)
                    }
                    LedgerSection("Details and review notes", collapsible = true) { AdsDetails(obj) }
                    AdsSection("Manage") {
                        AdsActionRow("Archive", { confirming = "archive" }, icon = Icons.Filled.Archive, enabled = !busy)
                        AdsActionRow("Delete permanently", { confirming = "delete" }, enabled = !busy, tone = Tone.problem)
                    }
                },
            )
        }
    }

    if (audienceSheet) {
        audience?.let { a ->
            AdsAudienceSheet(
                title = "Audience and placements", draft = a, goal = obj["optimization_goal"] as? String ?: "CONVERSATIONS", positions = emptyList(),
                onDismiss = { audienceSheet = false },
            ) { edited -> scope.launch { act("targeting", mapOf("draft" to edited.json)) } }
        }
    }
    budgeting?.let { t -> AdsBudgetSheet(t, onDismiss = { budgeting = null }, saved = { AdsChanges.bump(); load() }) }
    confirming?.let { action ->
        val title = mapOf("activate" to "Run it", "duplicate" to "Duplicate (paused)", "archive" to "Archive", "delete" to "Delete permanently")[action] ?: "Confirm"
        val message = when (action) {
            "activate" -> "$name will start spending its budget."
            "duplicate" -> "Make a paused copy, including everything under this $level."
            "archive" -> "Stop this $level and everything under it. It stays available under Show archived."
            "delete" -> "Stop this $level and everything under it permanently. This cannot be undone."
            else -> ""
        }
        AdsConfirm(
            title = title, message = message, confirm = title, destructive = action == "delete",
            onDismiss = { confirming = null },
            onConfirm = { scope.launch { act(if (action == "activate") "status" else action, if (action == "activate") mapOf("status" to "ACTIVE") else emptyMap()) } },
        )
    }
}

/** A row that opens another place. */
@Composable
fun AdsNavRow(title: String, path: String) {
    val navigator = LocalNavigator.current
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button) { navigator.open(path) }.ledgerRow(),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun PreviewSection(
    obj: Map<String, Any?>,
    previews: List<Map<String, Any?>>,
    name: String,
    id: String,
    format: Int,
    onFormat: (Int) -> Unit,
    openLink: (String) -> Unit,
) {
    AdsSection("Preview") {
        if (previews.isNotEmpty()) {
            erp.app.ui.PickerRow(
                "Placement", format.toString(),
                previews.mapIndexed { i, p -> i.toString() to adsTitleCase(p["format"] as? String ?: "Preview") },
            ) { onFormat(it.toInt()) }
            val p = previews.getOrNull(format)
            val html = p?.get("html") as? String
            val url = html?.let { AdsFrameRules.previewUrl(it) }
            if (url != null) {
                AdsFrame(url, Modifier.padding(8.dp), height = if ((p["format"] as? String ?: "").contains("STORY")) 620.dp else 520.dp)
            }
        } else {
            AdsRow { Text("Meta hasn't returned a preview yet.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        val creative = obj.obj("creative")
        if (creative != null) {
            val image = creative["image_url"] as? String ?: creative["thumbnail_url"] as? String
            AdsRow(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (image != null) AdsPicture(image, name, id, Modifier.fillMaxWidth().aspectRatio(1f))
                (creative["body"] as? String)?.let { Text(it) }
                (creative["title"] as? String)?.let { Text(it, style = MaterialTheme.typography.titleMedium) }
                (creative["instagram_permalink_url"] as? String)?.takeIf { it.startsWith("https://") }?.let { link ->
                    Text("On Instagram", color = erp.app.ui.theme.ErpColors.accent, modifier = Modifier.clickable(role = Role.Button) { openLink(link) })
                }
            }
        }
    }
}

/**
 * Full Meta feedback, readable without raw JSON or a browser page (MarketingDetails): every field by name, objects and
 * lists folded under their key. TODO(shared): MarketingKit.MarketingDetails when the marketing group lands it.
 */
@Composable
fun AdsDetails(fields: Map<String, Any?>) {
    Column(Modifier.fillMaxWidth()) {
        for (key in fields.keys.sorted()) AdsDetailItem(key, fields[key])
    }
}

@Composable
private fun AdsDetailItem(key: String, value: Any?) {
    val title = adsTitleCase(key)
    when (value) {
        null -> {}
        is Map<*, *> -> {
            var open by remember { mutableStateOf(false) }
            @Suppress("UNCHECKED_CAST")
            val m = value as Map<String, Any?>
            Fold(title, open, { open = it }) { AdsDetails(m) }
        }
        is List<*> -> {
            var open by remember { mutableStateOf(false) }
            Fold(title, open, { open = it }) {
                Column {
                    value.forEachIndexed { i, v -> AdsDetailItem("${i + 1}", v) }
                }
            }
        }
        else -> Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            SelectionContainer { Text(adsPrint(value)) }
        }
    }
}

@Composable
private fun Fold(title: String, open: Boolean, onOpen: (Boolean) -> Unit, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().clickable(role = Role.Button) { onOpen(!open) }.padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium))
            Icon(Icons.Filled.ExpandMore, contentDescription = if (open) "Fold" else "Unfold", Modifier.size(20.dp).rotate(if (open) 0f else -90f), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (open) Column(Modifier.padding(start = 12.dp)) { content() }
    }
}
