package erp.app.screens.design

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Message
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Save
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.TouchApp
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import erp.app.device.openAddress
import erp.app.device.shareBytes
import erp.app.device.shareManyBytes
import erp.app.screens.marketing.KarachiTimeDialog
import erp.app.ui.FilterChip
import erp.app.ui.MoneyFeedback
import erp.app.ui.Radius
import erp.app.ui.SectionCard
import erp.app.ui.ShopDate
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.app.ui.theme.ErpColors
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.launch

/** The Publish sheet (publish-sheet.tsx): one list for everywhere a design can go. The engine is [DesignPublishModel]. */
@Composable
fun DesignPublishSheet(model: DesignWorkspaceModel, dismiss: () -> Unit) {
    val p = remember { DesignPublishModel(model) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val note = designSpeech({ model.speak }, { model.speak = it })
    var problem by remember { mutableStateOf<String?>(null) }
    var confirmingAgain by remember { mutableStateOf(false) }
    // A share the phone cannot report on: when the person comes back from it, ask whether the step went.
    var shared by remember { mutableStateOf<String?>(null) }
    var left by remember { mutableStateOf(false) }
    var asking by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { p.load() }
    LaunchedEffect(p.folder, p.waKeys) { p.remember() }
    val wordsKey = listOf(p.wa, p.ig, p.adText, p.adHeadline, "${p.waOn}", "${p.postOn}", "${p.metaOn}").joinToString("|")
    LaunchedEffect(wordsKey) {
        kotlinx.coroutines.delay(500)
        p.checkWords()
    }
    LifecycleEventEffect(Lifecycle.Event.ON_PAUSE) { if (shared != null) left = true }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { if (shared != null && left) { asking = shared; shared = null; left = false } }
    androidx.activity.compose.BackHandler(enabled = p.busy) {}

    val plan = p.plan()
    val problems = p.problems(plan)

    MoneyFeedback(success = p.sent, failure = p.failures)

    fun copyToClipboard(text: String) {
        (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Caption", text))
    }

    DesignSheetBody(note) {
        when {
            p.loadError != null -> erp.app.ui.NotAvailableState("Couldn’t look at where this can go", why = p.loadError, icon = Icons.Filled.ErrorOutline)
            !p.loaded -> SkeletonLoading(Modifier.fillMaxSize().padding(16.dp), label = "Looking at where this can go")
            else -> {
                BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                    val wide = maxWidth >= 840.dp
                    val left1: @Composable () -> Unit = {
                        Health(p, scope)
                        Places(p, scope, onConnect = { scope.launch { p.connectInstagram()?.let { openAddress(context, Intent.ACTION_VIEW, it) } } })
                    }
                    val right1: @Composable () -> Unit = {
                        if (p.waOn || p.postOn) Captions(p, scope)
                        if (p.metaOn && p.ok("meta-ad")) MetaWords(p)
                        Timing(p)
                        val issues = problems + p.wordIssues
                        if (issues.isNotEmpty()) {
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                for (i in issues) Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Top) {
                                    Icon(Icons.Filled.ErrorOutline, null, Modifier.size(16.dp), tint = Tone.problem.color())
                                    Text(i, style = MaterialTheme.typography.bodySmall, color = Tone.problem.color())
                                }
                            }
                        }
                        if (plan.steps.isNotEmpty()) Steps(p, plan, scope) { step ->
                            scope.launch {
                                try {
                                    val (name, data) = p.shareFile(step)
                                    if (step.id == "instagram-post" && p.ig.trim().isNotEmpty()) copyToClipboard(p.ig.trim())
                                    shared = step.id
                                    left = false
                                    shareBytes(context, data, name, "image/jpeg", name)
                                } catch (e: CancellationException) {
                                    throw e
                                } catch (e: Exception) {
                                    problem = e.message
                                }
                            }
                        }
                        val path = p.metaPath ?: p.ref("meta-ad")
                        if (path != null) {
                            OutlinedButton(onClick = { model.route = path; dismiss() }, Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp)) {
                                Icon(Icons.Filled.AutoAwesome, null, Modifier.size(18.dp)); Text("Open the new ad", Modifier.padding(start = 6.dp))
                            }
                        }
                        p.note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        Extras(p, onAgain = { confirmingAgain = true },
                            onAll = { scope.launch { try { shareManyBytes(context, p.allSizes().map { it.first to it.second }, "image/jpeg", "Every size") } catch (e: CancellationException) { throw e } catch (e: Exception) { problem = e.message } } },
                            onCaptioned = {
                                scope.launch {
                                    try {
                                        val (name, data) = p.captioned()
                                        if (p.wa.isNotEmpty()) { copyToClipboard(p.wa); p.note = "The caption is on the clipboard: paste it under the picture." }
                                        shareBytes(context, data, name, "image/jpeg", name)
                                    } catch (e: CancellationException) { throw e } catch (e: Exception) { problem = e.message }
                                }
                            },
                            onCopy = { copyToClipboard(p.wa); model.say("The caption is copied") },
                            onChannel = { openAddress(context, Intent.ACTION_VIEW, it) })
                    }
                    if (wide) {
                        Row(Modifier.fillMaxSize().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                            Column(Modifier.weight(1f).fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) { left1() }
                            Column(Modifier.weight(1f).fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) { right1() }
                        }
                    } else {
                        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) { left1(); right1() }
                    }
                }
                // Sending is the sheet's one job: it stays at the foot with what it will do (rule 16).
                val allDone = plan.steps.isNotEmpty() && plan.steps.all { p.ref(it.id) != null }
                val n = plan.steps.count { p.ref(it.id) == null }
                val summary = if (n > 0) "$n place${if (n == 1) "" else "s"}, ${if (p.whenKind == "now") "now" else if (p.whenKind == "hold") "held in the queue" else "scheduled"}" else null
                DesignActionBar(
                    DesignAction(
                        if (p.whenKind == "now") "Publish" else if (p.whenKind == "hold") "Hold in the queue" else "Schedule", Icons.AutoMirrored.Filled.Send, busy = p.busy,
                        disabled = problems.isNotEmpty() || p.wordIssues.isNotEmpty() || plan.steps.isEmpty() || allDone,
                    ) {
                        scope.launch {
                            p.checkWords()
                            if (problems.isNotEmpty() || p.wordIssues.isNotEmpty()) return@launch
                            val groups = p.failingGroups(plan)
                            if (p.whatsappChoice.isNotEmpty() || (p.igMode("instagram-story") == "api" && p.storyOn) || (p.igMode("instagram-post") == "api" && p.postOn) || groups.isNotEmpty()) p.confirming = true
                            else p.run()
                        }
                    },
                    summary = summary,
                )
            }
        }
    }

    if (p.confirming) {
        val n = plan.steps.count { p.ref(it.id) == null && !it.manual }
        val groups = p.failingGroups(plan)
        val whole = if (p.whatsappChoice.contains("announcements")) "This reaches the whole community: a thousand-odd customers. " else ""
        AlertDialog(
            onDismissRequest = { p.confirming = false },
            title = { Text("Send to $n place${if (n == 1) "" else "s"}?") },
            text = { Text(whole + (if (groups.isEmpty()) "A published post cannot be taken back." else "A check is failing for ${groups.joinToString(" and ")}; it may not go.")) },
            confirmButton = { TextButton(onClick = { scope.launch { p.run() } }) { Text("Yes, send") } },
            dismissButton = { TextButton(onClick = { p.confirming = false }) { Text("Not yet") } },
        )
    }
    if (confirmingAgain) {
        ConfirmDestructive("Send again from the start?", "What already went out is forgotten here, so every place can be sent to again.", "Send again from the start", { confirmingAgain = false }) { p.forgetAll() }
    }
    asking?.let { id ->
        AlertDialog(
            onDismissRequest = { asking = null },
            title = { Text("Did it go out?") },
            text = { Text("Say yes once you have posted it, and it is ticked off here.") },
            confirmButton = { TextButton(onClick = { asking = null; scope.launch { p.markDone(id) } }) { Text("Yes, it went") } },
            dismissButton = { TextButton(onClick = { asking = null }) { Text("Not yet") } },
        )
    }
    erp.app.ui.FailureAlert(problem, onDismiss = { problem = null }, title = "Could not finish")
}

// MARK: Connections (the health strip)

@Composable
private fun Health(p: DesignPublishModel, scope: kotlinx.coroutines.CoroutineScope) {
    val failing = p.checks.filter { it.s("status") == "fail" }
    SectionCard("Connections") {
        val f = p.healthFailed
        when {
            p.healthLoading && p.checks.isEmpty() -> SkeletonLoading(label = "Checking the connections", compact = true)
            f != null -> Text(f, style = MaterialTheme.typography.bodySmall, color = Tone.owed.color())
            failing.isEmpty() -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.CheckCircle, null, Modifier.size(18.dp), tint = Tone.settled.color())
                Text("Every connection is fine", style = MaterialTheme.typography.bodyMedium, color = Tone.settled.color())
            }
            else -> for (c in failing) Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Cancel, null, Modifier.size(18.dp), tint = Tone.problem.color())
                    Text(c.s("label"), style = MaterialTheme.typography.titleSmall, color = Tone.problem.color())
                }
                if (c.s("fix").isNotEmpty()) Text(c.s("fix"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (p.checks.isNotEmpty()) {
            var open by remember { mutableStateOf(false) }
            Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp).clickable(role = Role.Button) { open = !open }, verticalAlignment = Alignment.CenterVertically) {
                Text("Every check", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                Text(if (open) "Hide" else "Show", style = MaterialTheme.typography.bodyMedium, color = ErpColors.accent)
            }
            if (open) for (c in p.checks) Column(Modifier.padding(vertical = 2.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (c.s("status") == "ok") Icons.Filled.CheckCircle else Icons.Filled.Warning, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(c.s("label"), style = MaterialTheme.typography.bodySmall)
                }
                Text(c.s("detail"), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        TextButton(onClick = { scope.launch { p.refreshHealth() } }, enabled = !p.healthLoading) {
            Icon(Icons.Filled.Refresh, null, Modifier.size(16.dp)); Text("Check again", Modifier.padding(start = 6.dp))
        }
    }
}

// MARK: Where it goes

@Composable
private fun Places(p: DesignPublishModel, scope: kotlinx.coroutines.CoroutineScope, onConnect: () -> Unit) {
    SectionCard("Where it goes") {
        if (p.row("website") != null) WebsiteBlock(p, scope)
        if (p.row("whatsapp") != null || p.row("channel") != null) WhatsappBlock(p, scope)
        InstagramBlock(p, scope, "instagram-story", "Instagram story", Icons.Filled.CameraAlt, p.storyOn, { p.storyOn = it }, onConnect)
        InstagramBlock(p, scope, "instagram-post", "Instagram post", Icons.Filled.Image, p.postOn, { p.postOn = it }, onConnect)
        if (p.ok("meta-ad")) {
            val beside = if (DesignDestinations.storyPage(p.pages) != null) " and the 9:16 beside it" else ""
            PlaceToggle(p, scope, "Meta ad", Icons.Filled.Campaign, p.metaOn, { p.metaOn = it }, "meta-ad", if (p.metaOn) "Opens New ad with the picture$beside." else null)
        }
        if (p.ok("site-replace")) PlaceToggle(p, scope, "Replace the photo on the website", Icons.Filled.Sync, p.replaceOn, { p.replaceOn = it }, "site-replace", null)
        ToggleLine("Save the design", Icons.Filled.Save, p.saveOn, { p.saveOn = it })
    }
}

@Composable
private fun ToggleLine(title: String, icon: ImageVector, on: Boolean, onChange: (Boolean) -> Unit, enabled: Boolean = true) {
    Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(icon, null, Modifier.size(22.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Switch(on, onChange, enabled = enabled, colors = SwitchDefaults.colors(checkedTrackColor = ErpColors.accent, checkedThumbColor = ErpColors.onAccent))
    }
}

@Composable
private fun PlaceToggle(p: DesignPublishModel, scope: kotlinx.coroutines.CoroutineScope, title: String, icon: ImageVector, on: Boolean, onChange: (Boolean) -> Unit, dest: String, note: String?) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        ToggleLine(title, icon, on, onChange)
        if (on) PictureLine(p, scope, dest)
        if (note != null && on) Text(note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** The page a place takes, or the button that makes the one it lacks ("Make 1:1 from this"). */
@Composable
private fun PictureLine(p: DesignPublishModel, scope: kotlinx.coroutines.CoroutineScope, dest: String) {
    val pick = p.pick(dest)
    val page = pick.page
    val m = p.missing(dest)
    if (page != null) Text("Uses: ${page.label}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    else if (m != null) OutlinedButton(onClick = { scope.launch { p.make(m) } }) { Icon(Icons.Filled.AutoAwesome, null, Modifier.size(16.dp)); Text(m.label, Modifier.padding(start = 6.dp)) }
}

/** A choice from a short list, as a bordered row that opens its menu (a `Picker` in a card). */
@Composable
fun ChoiceField(label: String, value: String, options: List<Pair<String, String>>, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    val shown = options.firstOrNull { it.first == value }?.second ?: value
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Box {
            Row(
                Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp).border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)), Radius.tileShape)
                    .clickable(role = Role.DropdownList) { open = true }.padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(shown, Modifier.weight(1f), maxLines = 2, style = MaterialTheme.typography.bodyLarge)
                Icon(Icons.Filled.ArrowDropDown, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            DropdownMenu(open, { open = false }) {
                for ((v, title) in options) DropdownMenuItem(text = { Text(title) }, onClick = { open = false; onSelect(v) })
            }
        }
    }
}

@Composable
private fun WebsiteBlock(p: DesignPublishModel, scope: kotlinx.coroutines.CoroutineScope) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ToggleLine("Website", Icons.Filled.Public, p.websiteOn, { p.websiteOn = it }, enabled = p.ok("website"))
        val reason = p.row("website")?.reason
        if (reason != null && !p.ok("website")) Text(reason, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (p.websiteOn && p.ok("website")) {
            ChoiceField("Collection", p.folder, listOf("" to "Choose a collection…") + p.collections.map { it.folder to it.title }, { p.folder = it })
            if (p.ok("featured")) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Set of the day on the home page", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                    Switch(p.featured, { p.featured = it }, colors = SwitchDefaults.colors(checkedTrackColor = ErpColors.accent, checkedThumbColor = ErpColors.onAccent))
                }
                val now = p.featuredNow
                if (p.featured && now != null) Text("It replaces $now as the set of the day.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (p.isMaison) {
                ChoiceField("House", p.house, listOf("" to "The house: Cartier, Van Cleef & Arpels…") + p.model.catalogue["maisonHouses"].array.map { it.string }.map { it to it }, { p.house = it })
            }
            val headline = p.work?.fields?.get("headline")?.takeIf { it.isNotEmpty() } ?: p.work?.displayName ?: ""
            if (p.renaming || p.isMaison) {
                DesignField(if (p.isMaison) "Official name, as the house names it" else "Name on the website", p.siteName, { p.siteName = it }, prompt = headline, maxLines = 1)
                if (p.isMaison) Text("Shown under its house, in 18k, with no gold-rate price.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Named “${p.siteName.trim().ifEmpty { headline }}”", Modifier.weight(1f, fill = false), maxLines = 1, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    TextButton(onClick = { p.renaming = true }) { Text("Change") }
                }
            }
            PictureLine(p, scope, "website")
            val m = p.missing("website")
            if (p.pages.none { it.label == DesignSizes.website.label } && m != null) {
                OutlinedButton(onClick = { scope.launch { p.make(m) } }) { Icon(Icons.Filled.AutoAwesome, null, Modifier.size(16.dp)); Text("Make the catalogue photo (weight stamped)", Modifier.padding(start = 6.dp)) }
            }
        }
    }
}

@Composable
private fun WhatsappBlock(p: DesignPublishModel, scope: kotlinx.coroutines.CoroutineScope) {
    val wa = p.row("whatsapp")
    val ch = p.row("channel")
    val targets = ArrayList<DesignPublishModel.Target>()
    if (wa?.available == true) targets += wa.targets
    if (ch?.available == true) targets += ch.targets
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ToggleLine("WhatsApp", Icons.Filled.Message, p.waOn, { p.waOn = it }, enabled = targets.isNotEmpty())
        if (targets.isEmpty()) Text(wa?.reason ?: ch?.reason ?: "This shop has no WhatsApp community set.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (p.waOn && targets.isNotEmpty()) {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (t in targets) FilterChip(t.label + (if (t.key == "channel") " (channel)" else ""), chosen = t.key in p.waKeys, onClick = { p.waKeys = if (t.key in p.waKeys) p.waKeys - t.key else p.waKeys + t.key })
            }
            if (p.whatsappChoice.isNotEmpty()) PictureLine(p, scope, if (p.whatsappChoice.any { it != "channel" }) "whatsapp" else "channel")
        }
    }
}

@Composable
private fun InstagramBlock(p: DesignPublishModel, scope: kotlinx.coroutines.CoroutineScope, id: String, title: String, icon: ImageVector, on: Boolean, onChange: (Boolean) -> Unit, onConnect: () -> Unit) {
    val r = p.row(id)
    val share = p.igMode(id) == "share"
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        ToggleLine(title + (if (share) " (share sheet)" else ""), icon, on, onChange)
        r?.reason?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        if (on) {
            PictureLine(p, scope, id)
            if (r?.connectable == true) OutlinedButton(onClick = onConnect) { Icon(Icons.Filled.Link, null, Modifier.size(16.dp)); Text("Connect Instagram", Modifier.padding(start = 6.dp)) }
        }
    }
}

// MARK: Words

@Composable
private fun Captions(p: DesignPublishModel, scope: kotlinx.coroutines.CoroutineScope) {
    SectionCard("Captions") {
        OutlinedButton(onClick = { scope.launch { p.writeCaptions() } }, Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp), enabled = !p.aiBusy) {
            if (p.aiBusy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Icon(Icons.Filled.AutoAwesome, null, Modifier.size(18.dp))
            Text("Write with AI", Modifier.padding(start = 8.dp))
        }
        if (p.waOn) DesignField("WhatsApp caption", p.wa, { p.wa = it }, minLines = 3, maxLines = 8)
        if (p.postOn) DesignField("Instagram caption", p.ig, { p.ig = it }, minLines = 3, maxLines = 8)
    }
}

@Composable
private fun MetaWords(p: DesignPublishModel) {
    SectionCard("Meta ad words") {
        DesignField("Ad headline", p.adHeadline, { p.adHeadline = it }, minLines = 1, maxLines = 2)
        DesignField("Ad primary text", p.adText, { p.adText = it }, minLines = 3, maxLines = 8)
    }
}

@Composable
private fun Timing(p: DesignPublishModel) {
    var choosing by remember { mutableStateOf(false) }
    Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        val options = listOf("now" to "Send now", "hold" to "Hold in the queue", "schedule" to "Schedule")
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            options.forEachIndexed { i, (id, title) ->
                SegmentedButton(selected = p.whenKind == id, onClick = { p.whenKind = id }, shape = SegmentedButtonDefaults.itemShape(i, options.size)) { Text(title, maxLines = 1) }
            }
        }
        if (p.whenKind == "schedule") {
            Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp).clickable(role = Role.Button) { choosing = true }, verticalAlignment = Alignment.CenterVertically) {
                Text("Send at", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                Text(ShopDate.stamp(p.due, withTime = true), style = MaterialTheme.typography.bodyMedium, color = ErpColors.accent)
            }
        }
        if (p.queued && p.postOn) Text("The queue carries the website, WhatsApp and the story; the Instagram post goes out now, not from the queue.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if (choosing) KarachiTimeDialog(p.due, onDismiss = { choosing = false }, onPick = { p.due = it; choosing = false })
}

// MARK: What goes

@Composable
private fun Steps(p: DesignPublishModel, plan: DesignPublishModel.Plan, scope: kotlinx.coroutines.CoroutineScope, onShare: (DesignPublishModel.Step) -> Unit) {
    SectionCard("What goes") {
        for (s in plan.steps) {
            val st = p.state(s)
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    StatusIcon(st.status)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(s.label, style = MaterialTheme.typography.bodyMedium)
                        st.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Tone.problem.color()) }
                    }
                }
                if (st.status == DesignPublishModel.Status.Failed) {
                    OutlinedButton(onClick = { scope.launch { p.run(only = s.id) } }, enabled = !p.busy) { Icon(Icons.Filled.Refresh, null, Modifier.size(16.dp)); Text("Retry", Modifier.padding(start = 6.dp)) }
                }
                if (s.manual && st.status == DesignPublishModel.Status.Manual) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        OutlinedButton(onClick = { onShare(s) }) { Icon(Icons.Filled.Share, null, Modifier.size(16.dp)); Text("Share it", Modifier.padding(start = 6.dp)) }
                        TextButton(onClick = { scope.launch { p.markDone(s.id, "by hand") } }) { Text("Posted") }
                    }
                }
            }
        }
        if (plan.steps.any { p.state(it).status == DesignPublishModel.Status.Failed } && !p.busy) {
            OutlinedButton(onClick = { scope.launch { p.run() } }, Modifier.fillMaxWidth()) { Icon(Icons.Filled.Refresh, null, Modifier.size(16.dp)); Text("Retry what failed", Modifier.padding(start = 6.dp)) }
        }
    }
}

@Composable
private fun StatusIcon(s: DesignPublishModel.Status) {
    when (s) {
        DesignPublishModel.Status.Done -> Icon(Icons.Filled.CheckCircle, "Done", tint = Tone.settled.color())
        DesignPublishModel.Status.Failed -> Icon(Icons.Filled.Cancel, "Failed", tint = Tone.problem.color())
        DesignPublishModel.Status.Running -> CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
        DesignPublishModel.Status.Manual -> Icon(Icons.Filled.TouchApp, "Waiting for you", tint = Tone.owed.color())
        DesignPublishModel.Status.Waiting -> Icon(Icons.Filled.CheckCircle, "Waiting", tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.35f))
    }
}

// MARK: The rest

@Composable
private fun Extras(p: DesignPublishModel, onAgain: () -> Unit, onAll: () -> Unit, onCaptioned: () -> Unit, onCopy: () -> Unit, onChannel: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        androidx.compose.material3.HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
        ExtraLine("Share or save every size", Icons.Filled.Share, onAll)
        if (p.row("whatsapp") != null || p.row("channel") != null) ExtraLine("Share the picture with its caption", Icons.Filled.Share, onCaptioned)
        if (p.wa.trim().isNotEmpty()) ExtraLine("Copy the caption", Icons.Filled.ContentCopy, onCopy)
        val link = p.config["posting"]["links"].s("waChannel")
        if (link.startsWith("https://")) ExtraLine("Open the WhatsApp channel", Icons.AutoMirrored.Filled.OpenInNew) { onChannel(link) }
        if (p.memory.isNotEmpty()) TextButton(onClick = onAgain, enabled = !p.busy) { Text("Send again from the start") }
    }
}

@Composable
private fun ExtraLine(title: String, icon: ImageVector, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp).clickable(role = Role.Button, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, null, Modifier.size(20.dp), tint = ErpColors.accent)
        Text(title, style = MaterialTheme.typography.bodyMedium)
    }
}
