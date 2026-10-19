package erp.app.screens.design

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ContentCut
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.Undo
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Brush
import androidx.compose.material.icons.filled.Crop
import androidx.compose.material.icons.filled.PhotoSizeSelectLarge
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.filled.GppMaybe
import androidx.compose.material.icons.filled.AutoFixHigh
import androidx.compose.material.icons.filled.Landscape
import androidx.compose.material.icons.filled.ClearAll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import erp.app.screens.marketing.MarketingValue
import erp.app.ui.Radius
import erp.app.ui.SectionCard
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.app.ui.theme.ErpColors
import kotlinx.coroutines.launch

// The AI picture tools' screens (DesignAI.swift): the photograph card's "With AI" group, the picture waiting for a look, New setting,
// Ask AI, Make the ad with AI and the review of a split picture. Their moves are DesignAIModel.kt.

@Composable
fun DesignAITools(model: DesignWorkspaceModel, access: DesignAccess) {
    val scope = rememberCoroutineScope()
    Column(Modifier.clip(Radius.tileShape).background(ErpColors.ground).padding(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.AutoFixHigh, null, Modifier.size(18.dp))
            Text("With AI: the piece stays as it is", style = MaterialTheme.typography.titleSmall)
        }
        model.photoCheck?.let { check ->
            val ok = DesignAIRules.checkOK(check)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(if (ok) Icons.Filled.Verified else Icons.Filled.GppMaybe, null, Modifier.size(16.dp), tint = if (ok) Tone.settled.color() else Tone.owed.color())
                Text(if (ok) "Same piece" else (check["differences"].array.firstOrNull()?.string ?: "Look closely"), style = MaterialTheme.typography.bodySmall, color = if (ok) Tone.settled.color() else Tone.owed.color())
            }
        }
        val off = model.aiBusy != null || model.photos["photo"] == null
        if (model.photos["photo"] == null) Text("Add a photograph first.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Tool("Enhance: clean, colour, sparkle", Icons.Filled.AutoAwesome, off) { scope.launch { model.photoTool(DesignPhotoOp.Enhance) } }
            Tool("Logo and labels off", Icons.Filled.ClearAll, off) { scope.launch { model.photoTool(DesignPhotoOp.Clean) } }
            Tool("Extend to this shape", Icons.Filled.PhotoSizeSelectLarge, off) { scope.launch { model.photoTool(DesignPhotoOp.Extend) } }
            Tool("Retouch: piece, background, light", Icons.Filled.Brush, off) { scope.launch { model.photoTool(DesignPhotoOp.Retouch) } }
            Tool("New setting…", Icons.Filled.Landscape, off) { model.sheet = DesignSheet("New setting", compact = true) { dismiss -> DesignSettingSheet(model, dismiss) } }
            Tool("Ask AI… (anything, in your words)", Icons.Filled.Chat, off) { model.sheet = DesignSheet("Ask AI", compact = true) { dismiss -> DesignAskSheet(model, dismiss) } }
            Tool("Remove background", Icons.Filled.ContentCut, off) { scope.launch { model.cutOut() } }
            if (access.ads) Tool("Flat image → layers", Icons.Filled.Layers, off) { scope.launch { model.splitLayers() } }
            if (access.ads && model.work?.kind == "ad") {
                Tool("Make the ad with AI…", Icons.Filled.Crop, off) { model.sheet = DesignSheet("Make it with AI", compact = true) { dismiss -> DesignMakeAdSheet(model, dismiss) } }
            }
            if (model.canUndoPhoto) {
                TextButton(onClick = { model.undoPhoto() }, enabled = model.aiBusy == null, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Filled.Undo, null, Modifier.size(18.dp)); Text("Back to the photo before", Modifier.weight(1f).padding(start = 8.dp))
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Also remove tags and strings", Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
            Switch(model.tidy, { model.useTidy(it) }, colors = SwitchDefaults.colors(checkedTrackColor = ErpColors.accent, checkedThumbColor = ErpColors.onAccent))
        }
        model.aiBusy?.let { busy ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Text("$busy…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Text("Every result is compared with your photo; one that changed the piece waits for your say.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun Tool(title: String, icon: ImageVector, off: Boolean, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, enabled = !off, modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp)) {
        Icon(icon, null, Modifier.size(18.dp))
        Text(title, Modifier.weight(1f).padding(start = 10.dp), style = MaterialTheme.typography.bodyMedium)
    }
}

/** An AI picture waiting for a look, between the page strip and the page: "Use it" puts it in; nothing the check doubted goes in on its own. */
@Composable
fun DesignCandidateBanner(model: DesignWorkspaceModel) {
    val c = model.candidate ?: return
    val same: Boolean? = c.check?.let { DesignAIRules.checkOK(it) }
    val bitmap = rememberBitmap(c.data, 900)
    val scope = rememberCoroutineScope()
    Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("${c.label}: to look at", style = MaterialTheme.typography.titleMedium)
        if (bitmap != null) DesignPicture(bitmap, Modifier.fillMaxWidth().heightIn(max = 280.dp).clip(Radius.tileShape), ContentScale.Fit, "An AI picture to look at")
        if (same == true) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Filled.Verified, null, Modifier.size(16.dp), tint = Tone.settled.color())
                Text("The same piece as the photograph.", style = MaterialTheme.typography.bodySmall, color = Tone.settled.color())
            }
        } else if (c.check != null) {
            val diffs = c.check["differences"].array.take(3).joinToString("; ") { it.string }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Filled.GppMaybe, null, Modifier.size(16.dp), tint = Tone.problem.color())
                Text("The piece may have changed: " + diffs.ifEmpty { "compare it with your photograph" } + ".", style = MaterialTheme.typography.bodySmall, color = Tone.problem.color())
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Filled.GppMaybe, null, Modifier.size(16.dp), tint = Tone.owed.color())
                Text("Not checked: compare the piece with your photograph.", style = MaterialTheme.typography.bodySmall, color = Tone.owed.color())
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedButton(onClick = { scope.launch { model.useCandidate() } }) { Text(if (same == true) "Use it" else "Use it anyway") }
            OutlinedButton(onClick = { model.candidate = null }) { Text("Discard") }
        }
    }
}

// MARK: New setting and Ask AI

@Composable
fun DesignSettingSheet(model: DesignWorkspaceModel, dismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val own = model.work?.let { DesignAspect.nearest(it.activePage.w, it.activePage.h) } ?: "1:1"
    val shapes = remember(own) { val s = mutableListOf("9:16", "4:5", "1:1"); if (own !in s) s.add(0, own); s.toList() }
    val scenes = model.catalogue["scenes"].array
    var sceneId by remember { mutableStateOf(scenes.firstOrNull()?.s("id") ?: "") }
    var custom by remember { mutableStateOf("") }
    var shape by remember { mutableStateOf(own) }
    fun shapeName(s: String) = when (s) { "9:16" -> "Story 9:16"; "4:5" -> "Portrait 4:5"; "1:1" -> "Square"; else -> s }

    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("New setting", style = MaterialTheme.typography.titleLarge)
        Text(
            "The piece stays exactly as photographed; AI photographs it again in the setting you choose, then checks it is still the same piece.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        SectionCard("A setting") {
            for (s in scenes) {
                val on = sceneId == s.s("id") && custom.isEmpty()
                Row(
                    Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp).clickable(role = Role.RadioButton) { sceneId = s.s("id"); custom = "" },
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(s.s("label"), style = MaterialTheme.typography.bodyLarge)
                        Text(s.s("suits"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (on) Icon(Icons.Filled.Check, "Chosen", tint = ErpColors.accent)
                }
            }
        }
        SectionCard("Or say it") {
            OutlinedTextField(custom, { custom = it }, Modifier.fillMaxWidth(), placeholder = { Text("A velvet tray in window light…") }, minLines = 1, maxLines = 4)
        }
        SectionCard("Shape") {
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                shapes.forEachIndexed { i, s -> SegmentedButton(selected = shape == s, onClick = { shape = s }, shape = SegmentedButtonDefaults.itemShape(i, shapes.size)) { Text(shapeName(s), maxLines = 1) } }
            }
        }
        DesignActionBarInline(DesignAction("Photograph it", Icons.Filled.Landscape, disabled = sceneId.isEmpty() && custom.isBlank()) {
            val text = custom.trim()
            val op = DesignPhotoOp.Setting(if (text.isEmpty()) sceneId else null, text.ifEmpty { null }, shape.ifEmpty { own })
            dismiss()
            scope.launch { model.photoTool(op) }
        })
    }
}

@Composable
fun DesignAskSheet(model: DesignWorkspaceModel, dismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf("") }
    var shape by remember { mutableStateOf("same") }
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Ask AI", style = MaterialTheme.typography.titleLarge)
        Text(
            "Say it the way you’d tell a photographer. The piece itself is protected, and the result is checked against the original.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedTextField(text, { text = it }, Modifier.fillMaxWidth(), label = { Text("What should change?") }, minLines = 2, maxLines = 6)
        SectionCard("Ideas") {
            for (idea in DesignAIRules.askIdeas) {
                Text(idea, Modifier.fillMaxWidth().defaultMinSize(minHeight = 40.dp).clickable(role = Role.Button) { text = idea }.padding(vertical = 8.dp), style = MaterialTheme.typography.bodyMedium)
            }
        }
        SectionCard("Shape") {
            val options = listOf("same" to "Same shape", "9:16" to "Story 9:16", "4:5" to "Portrait 4:5", "1:1" to "Square")
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                options.forEachIndexed { i, (id, title) -> SegmentedButton(selected = shape == id, onClick = { shape = id }, shape = SegmentedButtonDefaults.itemShape(i, options.size)) { Text(title, maxLines = 1) } }
            }
        }
        DesignActionBarInline(DesignAction("Do it", Icons.Filled.Chat, disabled = text.isBlank()) {
            val op = DesignPhotoOp.Ask(text, if (shape == "same") null else shape)
            dismiss()
            scope.launch { model.photoTool(op) }
        })
    }
}

/** "Make the ad with AI" (ai-tools.tsx, the make dialog for an ad): an aim, if there is one, then the art director. */
@Composable
fun DesignMakeAdSheet(model: DesignWorkspaceModel, dismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var brief by remember { mutableStateOf("") }
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Make the ad with AI", style = MaterialTheme.typography.titleLarge)
        OutlinedTextField(brief, { brief = it }, Modifier.fillMaxWidth(), label = { Text("Aim (optional), e.g. Eid gifting") }, minLines = 1, maxLines = 4)
        Text(
            "Lays the ad out from the photograph and its details: the layout, the words on the picture and the ad’s own text and headline, on every size. The photo is extended to the shape if it needs it. Then you look at it.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        DesignActionBarInline(DesignAction("Make it", Icons.Filled.Crop) {
            val aim = brief
            dismiss()
            scope.launch { model.makeAd(aim) }
        })
    }
}

/** The primary action of a small sheet, inside its own column (a bottom sheet has no foot of its own to pin it to). */
@Composable
fun DesignActionBarInline(action: DesignAction) {
    androidx.compose.material3.Button(
        onClick = action.onClick, enabled = !action.disabled && !action.busy, modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp),
        colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = ErpColors.accent, contentColor = ErpColors.onAccent),
    ) {
        action.icon?.let { Icon(it, null, Modifier.size(18.dp)) }
        Text(action.label, Modifier.padding(start = 6.dp))
    }
}

// MARK: Flat image → layers (flat-ad.ts)

/** The review of a split picture, in the smart input's sheet and in the workspace's own. */
@Composable
fun DesignLayerReviewCard(
    plan: MarketingValue,
    keep: Set<String>,
    onKeep: (Set<String>) -> Unit,
    onCancel: () -> Unit,
    onStart: () -> Unit,
    /** The sheet pins "Start a design from this" in its action bar; inline the card carries its own buttons. */
    showsActions: Boolean = true,
) {
    SectionCard("Rebuilt as layers") {
        Text(
            if (!plan["cutout"].isNull) "The piece is cut out and stands on the picture’s own colour. No part of it was redrawn." else "The photograph stays whole, with the lettering as layers above it.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        for (l in plan["layers"].array) {
            val id = l.s("id")
            Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f)) {
                    Text(l.s("text"), maxLines = 2, style = MaterialTheme.typography.bodyMedium)
                    Text(l.s("role"), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(id in keep, { on -> onKeep(if (on) keep + id else keep - id) }, colors = SwitchDefaults.colors(checkedTrackColor = ErpColors.accent, checkedThumbColor = ErpColors.onAccent))
            }
        }
        for (n in plan["notes"].array.map { it.string }) Text(n, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (showsActions) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(onClick = onCancel) { Text("Cancel") }
                OutlinedButton(onClick = onStart, Modifier.weight(1f)) { Icon(Icons.Filled.Layers, null, Modifier.size(18.dp)); Text("Start a design from this", Modifier.padding(start = 6.dp)) }
            }
        }
    }
}

/** From the workspace: the split picture reviewed, then a new design started from it (the open one stays as a draft on this phone). */
@Composable
fun DesignLayersSheet(model: DesignWorkspaceModel, plan: MarketingValue, photo: ByteArray, dismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var keep by remember { mutableStateOf(plan["layers"].array.map { it.s("id") }.toSet()) }
    fun start() {
        val req = DesignLayerPlan.request(plan, photo, model.work?.displayName ?: "Picture", keep)
        dismiss()
        scope.launch {
            model.flush()
            if (model.start(req)) model.say("A new design from the picture", "The one you had is kept as a draft on this phone.")
        }
    }
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp)) {
            DesignLayerReviewCard(plan, keep, { keep = it }, dismiss, ::start, showsActions = false)
        }
        DesignActionBar(DesignAction("Start a design from this", Icons.Filled.Layers, disabled = keep.isEmpty(), onClick = ::start))
    }
}
