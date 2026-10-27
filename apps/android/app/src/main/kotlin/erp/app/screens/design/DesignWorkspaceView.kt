package erp.app.screens.design

import erp.app.ui.TextField
import erp.app.ui.icons.Symbols
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import erp.app.ui.OutlinedButton
import erp.app.ui.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import erp.app.screens.marketing.ArtworkEditor
import erp.app.screens.marketing.MarketingPhotos
import erp.app.screens.marketing.SitePhotoPicker
import erp.app.screens.neworder.hasCamera
import erp.app.screens.neworder.rememberCameraCapture
import erp.app.ui.Pill
import erp.app.ui.Radius
import erp.app.ui.SectionCard
import erp.app.ui.ShopDate
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.app.ui.theme.ErpColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The workspace (src/app/design/workspace.tsx; DesignWorkspaceView.swift): the page strip (the master and its other sizes), the active
 * page drawn by the bundled engine and edited in the layer editor (ArtworkEditor), the piece card's words, the photograph, Save and
 * Publish. Resize, Publish and the smart input are the hooks (DesignHooks). On a tablet the page sits beside the words.
 */
@Composable
fun DesignWorkspaceView(
    model: DesignWorkspaceModel,
    access: DesignAccess,
    onClose: () -> Unit,
    /** To the Photos section, which hands a photograph back. */
    onChangePhoto: () -> Unit,
) {
    val w = model.work ?: return
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var editing by remember { mutableStateOf<String?>(null) }
    var sitePicker by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<DesignPageState?>(null) }
    var safe by remember { mutableStateOf(true) }

    val pickDevice = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch {
            val data = readUri(context, uri)
            if (data == null) model.error = "Choose a readable photo, or save it to Photos first."
            else model.replacePhoto(data, label = "Photo from this phone")
        }
    }
    val pickMore = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(8)) { uris ->
        if (uris.isNotEmpty()) scope.launch {
            for (uri in uris) readUri(context, uri)?.let { model.addMore(it) }
        }
    }
    val camera = rememberCameraCapture(onProblem = { model.error = it }) { bitmap ->
        if (bitmap != null) scope.launch {
            val bytes = withContext(Dispatchers.Default) { MarketingPhotos.jpeg(bitmap) }
            if (bytes != null) model.replacePhoto(bytes, label = "Camera photo")
        }
    }

    if (w.fresh) {
        SkeletonLoading(Modifier.fillMaxSize().padding(16.dp), label = "Laying it out")
        return
    }

    Column(Modifier.fillMaxSize()) {
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
            val wide = maxWidth >= 840.dp
            val left: @Composable () -> Unit = {
                Header(model, w, onClose)
                Strip(model, w) { removing = it }
                DesignCandidateBanner(model)
                Stage(model, w, safe, { safe = it }, onEdit = { model.beginEditing(it); editing = it })
            }
            val right: @Composable () -> Unit = {
                if (wide) Header(model, w, onClose)
                Words(model)
                Photograph(model, access, onChangePhoto, { sitePicker = true }, { pickDevice.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    if (hasCamera(context)) camera else null, { pickMore.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) })
                if (w.kind == "ad" || (w.copy["adText"] ?: "").isNotEmpty()) AdCopy(model)
            }
            if (wide) {
                // On a wide window the page is pinned beside the words: the strip above it, the page filling what is left, and only the words scroll.
                Row(Modifier.fillMaxSize().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    Column(Modifier.weight(1f).fillMaxSize().padding(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        Strip(model, w) { removing = it }
                        DesignCandidateBanner(model)
                        Stage(model, w, safe, { safe = it }, onEdit = { model.beginEditing(it); editing = it }, modifier = Modifier.weight(1f), fill = true)
                    }
                    Column(Modifier.weight(1f).fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) { right() }
                }
            } else {
                // The candidate scrolls into view when an AI picture waits for a look.
                val scroll = rememberScrollState()
                LaunchedEffect(model.candidate?.id) { if (model.candidate != null) scroll.animateScrollTo(0) }
                Column(Modifier.fillMaxSize().verticalScroll(scroll).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) { left(); right() }
            }
        }
        // The one primary action stays at the foot where it never scrolls away (rule 16): Publish, with Save beside it.
        DesignActionBar(
            DesignAction("Publish", Symbols.Send, disabled = model.saving) { DesignHooks.publish(model) },
            secondary = listOf(DesignAction("Save", Symbols.Save, busy = model.saving || model.uploading) { scope.launch { model.saveInBackground() } }),
            summary = if (w.dirty) "Not saved" else "Saved",
        )
    }

    editing?.let { pageId ->
        val page = model.work?.page(pageId)
        if (page == null) editing = null
        else ArtworkEditor(
            design = page.doc, onDoc = { model.editDoc(pageId, it) }, photos = model.photos, fields = model.work?.fields ?: emptyMap(),
            onClose = { editing = null; model.endEditing() }, ad = model.work?.kind == "ad", engine = model.engine,
        )
    }
    if (sitePicker) {
        SitePhotoPicker(onClose = { sitePicker = false }, picked = { piece, data ->
            sitePicker = false
            val p = DesignPhotoSources.site(piece, data)
            model.replacePhoto(data, label = p.label, fields = p.fields, source = p.source, isMarked = p.marked)
        })
    }
    removing?.let { p ->
        ConfirmDestructive("Take “${p.label}” out of this design?", "Its layout is removed; the other sizes stay.", "Take it out", { removing = null }) { model.removePage(p.id) }
    }
}

// MARK: Name and kind (Save and Publish are the action bar)

@Composable
private fun Header(model: DesignWorkspaceModel, w: DesignWork, onClose: () -> Unit) {
    Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = onClose) {
                Icon(Symbols.ArrowBack, null, Modifier.size(18.dp))
                Text("Designs", Modifier.padding(start = 6.dp), style = MaterialTheme.typography.titleSmall)
            }
            Pill(DesignKinds.label(w.kind), tone = Tone.house)
        }
        TextField(
            value = model.work?.name ?: "", onValueChange = { model.rename(it) }, modifier = Modifier.fillMaxWidth(), singleLine = true,
            placeholder = { Text((w.fields["headline"] ?: "").ifEmpty { "Name this design" }) }, textStyle = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
        )
        model.draftSaved?.let { Text("Draft kept on this phone " + ShopDate.stamp(java.time.Instant.ofEpochMilli(it), withTime = true), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

// MARK: The page strip

@Composable
private fun Strip(model: DesignWorkspaceModel, w: DesignWork, onRemove: (DesignPageState) -> Unit) {
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
        for (p in w.pages) PageCell(model, w, p, onRemove)
        Column(
            Modifier.width(84.dp).height(116.dp).border(BorderStroke(1.5.dp, MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)), Radius.chipShape).clip(Radius.chipShape)
                .clickable(onClickLabel = "Resize: add a size") { DesignHooks.resize(model) },
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
        ) {
            Icon(Symbols.Add, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Size", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** A page in the strip: a small picture, its label, where it stands against the master, and what can be done to it. */
@Composable
private fun PageCell(model: DesignWorkspaceModel, work: DesignWork, page: DesignPageState, onRemove: (DesignPageState) -> Unit) {
    val on = page.id == work.active
    val image = model.thumbs[page.id]
    var menu by remember { mutableStateOf(false) }
    LaunchedEffect(page.id, page.rev, model.tick) { model.refreshThumb(page.id) }
    val stale = page.id in work.stale
    Column(
        Modifier.clip(Radius.chipShape).background(if (on) ErpColors.accent.copy(alpha = 0.12f) else ErpColors.card)
            .border(BorderStroke(if (on) 1.5.dp else 1.dp, if (on) ErpColors.accent else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.18f)), Radius.chipShape)
            .padding(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(
            Modifier.width((76 * page.w / page.h).coerceIn(40.0, 96.0).dp).height(76.dp).clip(Radius.thumbShape).background(ErpColors.ground)
                .clickable(onClickLabel = "Show ${page.label}") { model.setActive(page.id) },
        ) { if (image != null) DesignPicture(image, Modifier.fillMaxSize(), ContentScale.Fit, page.label) }
        Text(page.label, Modifier.widthIn96(), maxLines = 1, style = MaterialTheme.typography.labelSmall)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            if (page.id == work.master) Icon(Symbols.Star, null, Modifier.size(12.dp), tint = if (stale) Tone.owed.color() else MaterialTheme.colorScheme.onSurfaceVariant)
            Text(work.stripNote(page), style = MaterialTheme.typography.labelSmall, color = if (stale) Tone.owed.color() else MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (on) {
            Box {
                IconButton(onClick = { menu = true }, Modifier.size(32.dp).semantics { contentDescription = "This size" }) { Icon(Symbols.MoreVert, null, Modifier.size(18.dp)) }
                DropdownMenu(menu, { menu = false }) {
                    if (stale) DropdownMenuItem(text = { Text("Re-do from the master") }, leadingIcon = { Icon(Symbols.Refresh, null) }, onClick = { menu = false; DesignHooks.redoFromMaster(model, page.id) })
                    if (page.id != work.master) DropdownMenuItem(text = { Text("Make this the master") }, leadingIcon = { Icon(Symbols.Star, null) }, onClick = { menu = false; model.setMaster(page.id) })
                    if (work.pages.size > 1) DropdownMenuItem(text = { Text("Take this size out", color = Tone.problem.color()) }, leadingIcon = { Icon(Symbols.Delete, null, tint = Tone.problem.color()) }, onClick = { menu = false; onRemove(page) })
                }
            }
        }
    }
}

private fun Modifier.widthIn96(): Modifier = this.then(Modifier.width(96.dp))

// MARK: The active page

@Composable
private fun Stage(model: DesignWorkspaceModel, w: DesignWork, safe: Boolean, onSafe: (Boolean) -> Unit, onEdit: (String) -> Unit, modifier: Modifier = Modifier, fill: Boolean = false) {
    val scope = rememberCoroutineScope()
    val page = w.activePage
    val zone = DesignSizes.safeZone(page.h)
    val image = model.previews[page.id]
    var layouts by remember { mutableStateOf(false) }
    LaunchedEffect(page.id, page.rev, model.tick) { model.refreshPreview(page.id) }
    Column(modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(page.label, style = MaterialTheme.typography.titleSmall)
            Text("${page.w.toInt()}×${page.h.toInt()}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Box(Modifier.weight(1f))
            if (zone.first > 0) {
                Text("Safe zones", style = MaterialTheme.typography.labelMedium)
                Switch(safe, onSafe, colors = SwitchDefaults.colors(checkedTrackColor = ErpColors.accent, checkedThumbColor = ErpColors.onAccent))
            }
        }
        if (fill) {
            // The page fits the room that is left, whichever way it is short of.
            BoxWithConstraints(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                val ratio = (page.w / page.h).toFloat()
                val fitW = minOf(maxWidth, maxHeight * ratio)
                if (image != null) {
                    Box(Modifier.width(fitW).height(fitW / ratio).clip(Radius.tileShape)) {
                        DesignPicture(image, Modifier.fillMaxSize(), ContentScale.Fit, "${page.label} as it will look")
                        if (safe && zone.first > 0) SafeZones(zone.first / page.h, zone.second / page.h)
                    }
                } else SkeletonLoading(Modifier.fillMaxSize(), label = "Drawing the page")
            }
        } else {
            Box(Modifier.fillMaxWidth().clip(Radius.tileShape), contentAlignment = Alignment.Center) {
                if (image != null) {
                    Box(Modifier.fillMaxWidth().heightIn(max = 520.dp).aspectRatio((page.w / page.h).toFloat()).clip(Radius.tileShape)) {
                        DesignPicture(image, Modifier.fillMaxSize(), ContentScale.Fit, "${page.label} as it will look")
                        if (safe && zone.first > 0) SafeZones(zone.first / page.h, zone.second / page.h)
                    }
                } else SkeletonLoading(Modifier.fillMaxWidth().defaultMinSize(minHeight = 220.dp), label = "Drawing the page")
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedButton(onClick = { onEdit(page.id) }, Modifier.weight(1f).defaultMinSize(minHeight = 48.dp)) {
                Icon(Symbols.Tune, null, Modifier.size(18.dp), tint = ErpColors.accent)
                Text("Edit design", Modifier.padding(start = 8.dp), color = ErpColors.accent)
            }
            Box(Modifier.weight(1f)) {
                OutlinedButton(onClick = { layouts = true }, Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp)) {
                    Icon(Symbols.ViewQuilt, null, Modifier.size(18.dp))
                    Text("Layout", Modifier.padding(start = 8.dp))
                }
                DropdownMenu(layouts, { layouts = false }) {
                    val list = model.templates
                    for (t in list) DropdownMenuItem(text = { Text(t.label) }, onClick = { layouts = false; scope.launch { model.applyTemplate(t.id) } })
                    if (list.isEmpty()) DropdownMenuItem(text = { Text("Layouts are loading") }, enabled = false, onClick = {})
                }
            }
        }
        if (page.id in w.stale) {
            Text("This size is behind the master. Re-do it from the master, or leave it as it is.", style = MaterialTheme.typography.bodySmall, color = Tone.owed.color())
        }
    }
}

// MARK: Words (design-piece.tsx WordsPanel)

@Composable
private fun Words(model: DesignWorkspaceModel) {
    val w = model.work ?: return
    SectionCard("Words") {
        DesignField("Kicker", w.fields["kicker"] ?: "", { model.setField("kicker", it.take(60)) }, prompt = "The Emerald Edit")
        DesignField("Headline", w.fields["headline"] ?: "", { model.setField("headline", it.take(140)) })
        DesignField("Specs", w.fields["weight"] ?: "", { model.setField("weight", it.take(120)) }, prompt = "21K Yellow Gold · Ruby · 45.35g")
        DesignField("Button line", w.fields["details"] ?: "", { model.setField("details", it.take(80)) })
        DesignField("Price (optional)", w.copy["price"] ?: "", { model.setCopy("price", it.take(40)) })
    }
}

@Composable
private fun AdCopy(model: DesignWorkspaceModel) {
    val w = model.work ?: return
    SectionCard("The ad’s words") {
        DesignField("Primary text", w.copy["adText"] ?: "", { model.setCopy("adText", it.take(2000)) }, minLines = 3, maxLines = 8)
        DesignField("Headline", w.copy["adHeadline"] ?: "", { model.setCopy("adHeadline", it.take(60)) })
    }
}

// MARK: The photograph (design-piece.tsx PicturesPanel, the choosing half)

@Composable
private fun Photograph(
    model: DesignWorkspaceModel,
    access: DesignAccess,
    onChangePhoto: () -> Unit,
    onSite: () -> Unit,
    onDevice: () -> Unit,
    onCamera: (() -> Unit)?,
    onMore: () -> Unit,
) {
    val thumb = rememberBitmap(model.photos["photo"], 160)
    var menu by remember { mutableStateOf(false) }
    val has = model.photos["photo"] != null
    SectionCard("The photograph") {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(64.dp).clip(Radius.thumbShape).background(ErpColors.ground), contentAlignment = Alignment.Center) {
                if (thumb != null) DesignPicture(thumb, Modifier.fillMaxSize()) else Icon(Symbols.PhotoLibrary, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(if (has) "The design’s photograph" else "No photograph", style = MaterialTheme.typography.titleSmall)
                Text("Your layouts stay; the new picture shows in them.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Box {
            OutlinedButton(onClick = { menu = true }, Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp)) {
                Icon(Symbols.PhotoLibrary, null, Modifier.size(18.dp))
                Text(if (has) "Change the photograph" else "Choose a photograph", Modifier.padding(start = 8.dp))
            }
            DropdownMenu(menu, { menu = false }) {
                DropdownMenuItem(text = { Text("Browse photos") }, leadingIcon = { Icon(Symbols.PhotoLibrary, null) }, onClick = { menu = false; onChangePhoto() })
                DropdownMenuItem(text = { Text("From the website") }, leadingIcon = { Icon(Symbols.Language, null) }, onClick = { menu = false; onSite() })
                DropdownMenuItem(text = { Text("This phone") }, leadingIcon = { Icon(Symbols.Phone, null) }, onClick = { menu = false; onDevice() })
                if (onCamera != null) DropdownMenuItem(text = { Text("Camera") }, leadingIcon = { Icon(Symbols.CameraAlt, null) }, onClick = { menu = false; onCamera() })
            }
        }
        MoreRow(model, onMore)
        DesignAITools(model, access)
    }
}

/** Other angles of the piece: they go out with it as squares of their own (publish.ts `more`). */
@Composable
private fun MoreRow(model: DesignWorkspaceModel, onAdd: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("More photos of this piece", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
            OutlinedButton(onClick = onAdd) { Icon(Symbols.Add, null, Modifier.size(16.dp)); Text("Add", Modifier.padding(start = 4.dp)) }
        }
        if (model.moreIds.isNotEmpty()) {
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(top = 5.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (id in model.moreIds) {
                    val bmp = rememberBitmap(model.photos[id], 160)
                    Box {
                        DesignPicture(bmp, Modifier.size(56.dp).clip(Radius.thumbShape))
                        IconButton(onClick = { model.removePhoto(id) }, Modifier.align(Alignment.TopEnd).size(32.dp).semantics { contentDescription = "Take this photo out" }) {
                            Icon(Symbols.Cancel, null, tint = androidx.compose.ui.graphics.Color.White, modifier = Modifier.background(androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.7f), androidx.compose.foundation.shape.CircleShape).size(20.dp))
                        }
                    }
                }
            }
        }
        Text(
            if (model.moreIds.isEmpty()) "Other angles of the same piece go out with it as squares of their own." else "Publish sends each to the website and WhatsApp as a square of its own, on the same page design.",
            style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
