package erp.app.screens.marketing

import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Redo
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import erp.app.device.shareBytes
import erp.app.ui.ActionRow
import erp.app.ui.FormSection
import erp.app.ui.SkeletonLoading
import erp.app.ui.SmallPrint
import erp.app.ui.Tone
import erp.app.ui.ToggleRow
import erp.app.ui.PickerRow
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import java.util.UUID
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Shared between designs so a copied layer can be carried from a story to a post (ArtworkClipboard). */
object ArtworkClipboard {
    var layers by mutableStateOf<List<MarketingValue>>(emptyList())
    var frame by mutableStateOf(MarketingValue.of(mapOf("w" to 1080, "h" to 1920)))
    var photos by mutableStateOf<Map<String, ByteArray>>(emptyMap())
}

/**
 * The designer, in full screen (ArtworkEditor.swift): the page drawn by the engine with a box over each layer to select
 * and drag, then menus to add, lay out and recolour, the chosen layer's properties, the background and its crop, and the
 * layers. Edits are written to the live design as they go ([onDoc]); Cancel puts back what came in. [ad] picks the ad
 * templates as the layouts. Pass the [engine] of the screen underneath to reuse its web view.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArtworkEditor(
    design: MarketingValue,
    onDoc: (MarketingValue) -> Unit,
    photos: Map<String, ByteArray>,
    fields: Map<String, String>,
    onClose: () -> Unit,
    ad: Boolean = false,
    engine: DesignEngine = rememberDesignEngine(),
    /**
     * The catalogue's list the Layout menu offers as square layouts, in place of the frame's own (Edit a piece: "siteSquares",
     * its website photo's layouts, in its own shape as well as square).
     */
    layoutGroup: String? = null,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val original = remember { design }
    var doc by remember { mutableStateOf(design) }
    var response by remember { mutableStateOf(MarketingValue.NULL) }
    var selected by remember { mutableStateOf(setOf<String>()) }
    var problem by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val history = remember { ArtworkHistory() }
    var tick by remember { mutableStateOf(0) }
    val allPhotos = remember(photos, ArtworkClipboard.photos) { ArtworkClipboard.photos + photos }
    val changed = doc != original

    fun change(next: MarketingValue, key: String? = null) {
        if (history.change(doc, next, key, System.currentTimeMillis())) { doc = next; onDoc(next); tick++ }
    }

    // The page is drawn again whenever the design or the words change; a draw begun for an older design is dropped.
    val renderKey = remember(doc, fields) { doc.text + fields.toSortedMap().toString() }
    LaunchedEffect(renderKey) {
        delay(30)
        try {
            val r = engine.run(doc, allPhotos, fields)
            response = r
            problem = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            problem = e.message
        }
    }

    // A move of the engine's own (a preset, a palette, align, scale…): the answer's design replaces ours.
    fun act(action: String, value: String, extra: Map<String, Any?> = emptyMap()) {
        scope.launch {
            try {
                val o = LinkedHashMap(extra)
                o["action"] = action; o["value"] = value; o["selected"] = selected.toList()
                val r = engine.run(doc, allPhotos, fields, o)
                change(r["doc"])
                response = r
                if (r["added"].array.isNotEmpty()) selected = r["added"].array.map { it.string }.toSet()
                problem = null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                problem = e.message
            }
        }
    }

    fun addLayer(layer: MarketingValue) { change(ArtworkOps.add(doc, layer)); selected = setOf(layer.s("id")); problem = null }
    val pageWidth = doc["frame"].n("w", 1080.0)
    val height = doc["frame"].n("h", 1920.0)
    val layers = ArtworkOps.layers(doc)
    val catalogue = response["catalogue"]

    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            try {
                val jpeg = withContext(Dispatchers.IO) {
                    val raw = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: throw IllegalStateException("Choose a readable photo.")
                    MarketingPhotos.jpegCopy(raw) ?: throw IllegalStateException("Choose a readable photo.")
                }
                val size = ArtworkPixels.size(jpeg) ?: throw IllegalStateException("Choose a readable photo.")
                val layer = MarketingValue.of(
                    mapOf(
                        "id" to UUID.randomUUID().toString(), "kind" to "image", "photoId" to "",
                        "src" to "data:image/jpeg;base64," + java.util.Base64.getEncoder().encodeToString(jpeg),
                        "x" to 240, "y" to height * 0.35, "w" to 600, "h" to 600 * size.second / size.first,
                        "radius" to 0, "rotate" to 0, "opacity" to 1, "shadow" to false, "name" to "Uploaded image",
                    ),
                )
                addLayer(layer)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                problem = e.message
            }
        }
    }
    val pickLogo = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            try {
                val raw = withContext(Dispatchers.IO) { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }
                val layer = raw?.let { ArtworkLogo.uploadLayer(it, pageWidth, height) } ?: throw IllegalStateException("Choose an SVG or PNG logo.")
                addLayer(layer)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                problem = e.message
            }
        }
    }

    fun export() {
        scope.launch {
            busy = true
            try {
                val r = engine.run(doc, allPhotos, fields, mapOf("px" to 1080))
                val bytes = DesignProtocol.imageBytes(r)
                if (bytes == null) problem = "The design could not be drawn."
                else shareBytes(context, bytes, "design-${UUID.randomUUID()}.jpg", "image/jpeg", "Design")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                problem = e.message
            } finally {
                busy = false
            }
        }
    }

    fun cancel() { onDoc(original); onClose() }

    val menus = ArtworkMenus(
        catalogue = catalogue, photoIds = photos.keys.toList(), ad = ad, layoutGroup = layoutGroup, height = height, selected = selected, doc = doc, layers = layers,
        act = ::act,
        change = { change(it) },
        addLayer = ::addLayer,
        chooseImage = { pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
        chooseLogo = { pickLogo.launch(arrayOf("image/svg+xml", "image/png")) },
        select = { selected = it },
        copy = { ArtworkClipboard.layers = layers.filter { it.s("id") in selected }; ArtworkClipboard.frame = doc["frame"]; ArtworkClipboard.photos = photos },
    )

    Dialog(
        // Not swiped away with changes in it: Cancel puts the design back, Done keeps it.
        onDismissRequest = { if (!changed) onClose() },
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false, dismissOnBackPress = !changed, dismissOnClickOutside = false),
    ) {
        Surface(Modifier.fillMaxSize(), color = ErpColors.ground) {
            Column(Modifier.fillMaxSize().safeDrawingPadding()) {
                TopAppBar(
                    title = { Text("Design") },
                    navigationIcon = { TextButton(onClick = ::cancel) { Text("Cancel") } },
                    actions = {
                        IconButton(onClick = { history.back(doc)?.let { doc = it; onDoc(it); tick++ } }, enabled = history.canUndo) { Icon(Icons.AutoMirrored.Filled.Undo, "Undo") }
                        IconButton(onClick = { history.forward(doc)?.let { doc = it; onDoc(it); tick++ } }, enabled = history.canRedo) { Icon(Icons.AutoMirrored.Filled.Redo, "Redo") }
                        IconButton(onClick = ::export, enabled = !busy) { Icon(Icons.Filled.Share, "Share") }
                        TextButton(onClick = onClose) { Text("Done") }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = ErpColors.ground),
                )
                // `tick` is read so the undo buttons follow the history (it is not state of its own).
                if (tick >= 0) BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                    val boxHeight = maxHeight
                    val wide = maxWidth >= 840.dp
                    val preview: @Composable (Modifier) -> Unit = { m ->
                        ArtworkPreview(
                            response = response, doc = doc, layers = layers, selected = selected, pageWidth = pageWidth, height = height, modifier = m,
                            onSelect = { id, multiple -> selected = ArtworkOps.select(layers, selected, id, multiple) },
                            onClear = { selected = emptySet() },
                            onDragStart = { id ->
                                selected = ArtworkOps.select(layers, selected, id, false)
                                if (response["doc"].isNull) doc else response["doc"]
                            },
                            onDrag = { start, dx, dy -> val d = ArtworkOps.dragged(start, selected, dx, dy); doc = d; onDoc(d) },
                            onDragEnd = { start -> history.gesture(start, doc); tick++ },
                        )
                    }
                    val controls: @Composable () -> Unit = {
                        ArtworkControlsPanel(
                            state = ControlsState(doc, fields, photos, catalogue, selected, layers, problem),
                            menus = menus,
                            change = ::change,
                            select = { id, multiple -> selected = ArtworkOps.select(layers, selected, id, multiple) },
                        )
                    }
                    if (wide) {
                        Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                            preview(Modifier.weight(1.1f).fillMaxSize().padding(16.dp))
                            Column(Modifier.weight(1f).fillMaxSize().verticalScroll(rememberScrollState()).padding(end = 16.dp, bottom = 24.dp)) { controls() }
                        }
                    } else {
                        Column(Modifier.fillMaxSize()) {
                            preview(Modifier.fillMaxWidth().heightIn(max = boxHeight * 0.42f).padding(horizontal = 16.dp, vertical = 8.dp))
                            Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 24.dp)) { controls() }
                        }
                    }
                    if (busy) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { SkeletonLoading(label = "Preparing…") }
                }
            }
        }
    }
}

/** The page as drawn, with a box over each layer to tap (select), long press (add to the selection) and drag (move). */
@Composable
private fun ArtworkPreview(
    response: MarketingValue,
    doc: MarketingValue,
    layers: List<MarketingValue>,
    selected: Set<String>,
    pageWidth: Double,
    height: Double,
    modifier: Modifier,
    onSelect: (String, Boolean) -> Unit,
    onClear: () -> Unit,
    onDragStart: (String) -> MarketingValue,
    onDrag: (MarketingValue, Double, Double) -> Unit,
    onDragEnd: (MarketingValue) -> Unit,
) {
    val picture by produceState<Bitmap?>(null, response) { value = withContext(Dispatchers.Default) { NativeArtwork.image(response) } ?: value }
    Box(modifier, contentAlignment = Alignment.Center) {
        BoxWithConstraints(Modifier.then(if (pageWidth / height > 0) Modifier else Modifier)) {
            val ratio = (pageWidth / height).toFloat()
            // The page fits the room, whichever way it is short of.
            val fitW = minOf(maxWidth, maxHeight * ratio)
            val fitH = fitW / ratio
            val density = LocalDensity.current
            val scale = with(density) { fitW.toPx() } / pageWidth.toFloat()
            Box(Modifier.width(fitW).height(fitH).border(0.5.dp, MaterialTheme.colorScheme.outlineVariant)) {
                val bitmap = picture
                if (bitmap != null) {
                    Image(bitmap.asImageBitmap(), contentDescription = "The design", Modifier.fillMaxSize().pointerInput(Unit) { detectTapGestures { onClear() } }, contentScale = ContentScale.FillBounds)
                } else {
                    SkeletonLoading(Modifier.fillMaxSize())
                }
                for (b in response["boxes"].array) {
                    val id = b.s("id")
                    val l = layers.firstOrNull { it.s("id") == id } ?: MarketingValue.NULL
                    if (l["hidden"].bool) continue
                    val w = with(density) { maxOf(24.dp, (b.n("w") * scale).toFloat().toDp()) }
                    val h = with(density) { maxOf(24.dp, (b.n("h") * scale).toFloat().toDp()) }
                    val locked = l["locked"].bool
                    var start by remember(id) { mutableStateOf<MarketingValue?>(null) }
                    var travelled by remember(id) { mutableStateOf(Offset.Zero) }
                    Box(
                        Modifier
                            .offset { IntOffset((b.n("x") * scale).toInt(), (b.n("y") * scale).toInt()) }
                            .size(w, h)
                            .rotate(l.n("rotate").toFloat())
                            .then(if (id in selected) Modifier.border(2.dp, ErpColors.accent) else Modifier)
                            .semantics { contentDescription = ArtworkOps.name(l) }
                            .pointerInput(id) { detectTapGestures(onTap = { onSelect(id, false) }, onLongPress = { onSelect(id, true) }) }
                            .pointerInput(id, locked) {
                                if (locked) return@pointerInput
                                detectDragGestures(
                                    onDragStart = { travelled = Offset.Zero; start = onDragStart(id) },
                                    onDrag = { change, amount ->
                                        change.consume()
                                        travelled += amount
                                        start?.let { s -> onDrag(s, (travelled.x / scale).toDouble(), (travelled.y / scale).toDouble()) }
                                    },
                                    onDragEnd = { start?.let(onDragEnd); start = null },
                                    onDragCancel = { start?.let(onDragEnd); start = null },
                                )
                            },
                    )
                }
            }
        }
    }
}

/** What the controls read, together (the editor's state as the panel needs it). */
private class ControlsState(
    val doc: MarketingValue,
    val fields: Map<String, String>,
    val photos: Map<String, ByteArray>,
    val catalogue: MarketingValue,
    val selected: Set<String>,
    val layers: List<MarketingValue>,
    val problem: String?,
)

/** The menus of the editor and the moves they make. */
private class ArtworkMenus(
    val catalogue: MarketingValue,
    val photoIds: List<String>,
    val ad: Boolean,
    val layoutGroup: String?,
    val height: Double,
    val selected: Set<String>,
    val doc: MarketingValue,
    val layers: List<MarketingValue>,
    val act: (String, String, Map<String, Any?>) -> Unit,
    val change: (MarketingValue) -> Unit,
    val addLayer: (MarketingValue) -> Unit,
    val chooseImage: () -> Unit,
    val chooseLogo: () -> Unit,
    val select: (Set<String>) -> Unit,
    val copy: () -> Unit,
) {
    private fun items(key: String) = catalogue[key].array
    private fun action(label: String, run: () -> Unit) = MenuNode.Action(label, run = run)

    val add: List<MenuNode>
        get() = listOf(
            MenuNode.Sub(
                "Text",
                listOf("heading", "subheading", "body").map { k -> action(ArtworkProperties.label(k)) { act("text", k, emptyMap()) } } +
                    items("textStyles").map { i -> action(i.s("label")) { act("textStyle", i.s("id"), emptyMap()) } },
            ),
            MenuNode.Sub(
                "Shapes and lines",
                listOf("arrow", "line", "rect", "circle").map { k -> action(ArtworkProperties.label(k)) { act("shape", k, emptyMap()) } } +
                    items("shapes").map { i -> action(i.s("label")) { act("shape", i.s("id"), emptyMap()) } } +
                    listOf("dash", "dot").map { k -> action(ArtworkProperties.label(k) + " line") { act("line", k, emptyMap()) } },
            ),
            MenuNode.Sub("Badges", items("badges").map { i -> action(i.s("label")) { act("badge", i.s("id"), emptyMap()) } }),
            MenuNode.Sub(
                "Full logo",
                listOf(
                    action("Top right") { act("mark", "top", emptyMap()) },
                    action("Bottom right") { act("mark", "bottom", emptyMap()) },
                    action("Monogram") { addLayer(ArtworkLogo.monogram(ArtworkLogo.ink(doc))) },
                ),
            ),
            MenuNode.Sub(
                "Photo inset",
                photoIds.sorted().map { key ->
                    MenuNode.Sub(
                        ArtworkOps.photoName(photoIds, key),
                        listOf(action("Rectangle") { act("image", "", mapOf("photoId" to key)) }) +
                            items("masks").map { m -> action(ArtworkProperties.label(m.string)) { act("image", m.string, mapOf("photoId" to key)) } },
                    )
                },
            ),
            action("Upload image", chooseImage),
            action("Logo file (SVG or PNG)", chooseLogo),
            action("Link pill") { act("link", "Ask us on WhatsApp", emptyMap()) },
        )

    val layout: List<MenuNode>
        get() {
            val group = layoutGroup ?: if (ad) "templates" else if (height < 1400) "squares" else "presets"
            val kind = if (layoutGroup != null) "square" else if (ad) "ad" else if (height < 1400) "square" else "preset"
            return items(group).map { i -> action(i.s("label")) { act(kind, i.s("id"), emptyMap()) } }
        }

    val colours: List<MenuNode>
        get() = items("palettes").map { p -> action(p.s("label")) { act("palette", "", mapOf("palette" to p.s("id"))) } }

    private fun align(page: Boolean): List<MenuNode> =
        listOf("left", "center", "right", "top", "middle", "bottom").map { k -> action(ArtworkProperties.label(k)) { act("align", k, mapOf("toPage" to page)) } }

    val arrange: List<MenuNode>
        get() = buildList {
            add(action("Select all") { select(layers.map { it.s("id") }.toSet()) })
            add(action("Bring to front") { change(ArtworkOps.reorder(doc, selected, true)) })
            add(action("Send to back") { change(ArtworkOps.reorder(doc, selected, false)) })
            add(action("Bring forward") { change(ArtworkOps.step(doc, selected, 1)) })
            add(action("Send backward") { change(ArtworkOps.step(doc, selected, -1)) })
            add(action("Group") { change(ArtworkOps.setSelected(doc, selected, mapOf("group" to MarketingValue.string(UUID.randomUUID().toString())))) })
            add(action("Ungroup") { change(ArtworkOps.setSelected(doc, selected, mapOf("group" to MarketingValue.NULL))) })
            add(action("Mirror across") { change(ArtworkOps.flip(doc, selected, "flipX")) })
            add(action("Mirror down") { change(ArtworkOps.flip(doc, selected, "flipY")) })
            add(MenuNode.Sub("Align to page", align(true)))
            if (selected.size > 1) add(MenuNode.Sub("Align selection", align(false)))
            if (selected.size >= 3) {
                add(action("Space evenly across") { act("distribute", "h", emptyMap()) })
                add(action("Space evenly down") { act("distribute", "v", emptyMap()) })
            }
            add(action("Larger") { act("scale", "", mapOf("factor" to 1.1)) })
            add(action("Smaller") { act("scale", "", mapOf("factor" to 0.9)) })
            add(action("Copy") { copy() })
            add(action("Duplicate") {
                val (d, ids) = ArtworkOps.duplicate(doc, layers.filter { it.s("id") in selected })
                change(d); select(ids)
            })
            add(action("Lock") { change(ArtworkOps.setSelected(doc, selected, mapOf("locked" to MarketingValue.bool(true)))) })
            add(MenuNode.Action("Remove", destructive = true) { change(ArtworkOps.remove(doc, selected)); select(emptySet()) })
        }
}

@Composable
private fun ArtworkControlsPanel(state: ControlsState, menus: ArtworkMenus, change: (MarketingValue, String?) -> Unit, select: (String, Boolean) -> Unit) {
    val doc = state.doc
    val catalogue = state.catalogue
    val layers = state.layers
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        state.problem?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = Tone.problem.color()) }
        FormSection("Make") {
            ArtworkMenuRow("Add", menus.add)
            ArtworkMenuRow("Layout", menus.layout)
            ArtworkMenuRow("Colours", menus.colours)
            if (state.selected.isNotEmpty()) ArtworkMenuRow("Arrange · ${state.selected.size} selected", menus.arrange)
            if (ArtworkClipboard.layers.isNotEmpty()) {
                ActionRow("Paste copied layers", { menus.act("carry", "", mapOf("layers" to ArtworkClipboard.layers.map { it.json }, "fromFrame" to ArtworkClipboard.frame.json)) })
            }
        }
        val single = if (state.selected.size == 1) layers.firstOrNull { it.s("id") == state.selected.first() } else null
        if (single != null) {
            FormSection(ArtworkOps.name(single)) {
                LayerControls(single, doc, state.fields, catalogue, change)
            }
        }
        FormSection("Background and crop") {
            BackgroundControls(doc, state.photos.keys, catalogue, change)
        }
        FormSection("Layers · ${layers.size}") {
            for (l in layers.reversed()) LayerRow(l, l.s("id") in state.selected, select) { id, fields -> change(ArtworkOps.patch(doc, id, fields), null) }
        }
    }
}

@Composable
private fun LayerRow(l: MarketingValue, chosen: Boolean, select: (String, Boolean) -> Unit, patch: (String, Map<String, MarketingValue>) -> Unit) {
    var menu by remember { mutableStateOf(false) }
    val id = l.s("id")
    Box {
        Row(
            Modifier.fillMaxWidth().clickable(role = Role.Button, onClickLabel = "Select") { select(id, false) }.ledgerRow(),
            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(if (chosen) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked, contentDescription = if (chosen) "Selected" else null, tint = if (chosen) ErpColors.accent else MaterialTheme.colorScheme.onSurfaceVariant)
            Text(ArtworkOps.name(l), Modifier.weight(1f), maxLines = 1, style = MaterialTheme.typography.bodyLarge)
            if (l["locked"].bool) Icon(Icons.Filled.Lock, contentDescription = "Locked", tint = MaterialTheme.colorScheme.onSurfaceVariant)
            if (l["hidden"].bool) Icon(Icons.Filled.VisibilityOff, contentDescription = "Hidden", tint = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = { menu = true }) { Text("More") }
        }
        androidx.compose.material3.DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            androidx.compose.material3.DropdownMenuItem(text = { Text("Select together") }, onClick = { menu = false; select(id, true) })
            androidx.compose.material3.DropdownMenuItem(text = { Text(if (l["locked"].bool) "Unlock" else "Lock") }, onClick = { menu = false; patch(id, mapOf("locked" to MarketingValue.bool(!l["locked"].bool))) })
            androidx.compose.material3.DropdownMenuItem(text = { Text(if (l["hidden"].bool) "Show" else "Hide") }, onClick = { menu = false; patch(id, mapOf("hidden" to MarketingValue.bool(!l["hidden"].bool))) })
        }
    }
}

@Composable
private fun BackgroundControls(doc: MarketingValue, photoIds: Set<String>, catalogue: MarketingValue, change: (MarketingValue, String?) -> Unit) {
    val bg = doc["bg"]
    val options = listOf("" to "No photo") + photoIds.sorted().map { it to ArtworkOps.photoName(photoIds, it) }
    PickerRow("Photo", bg.s("photoId"), options) { id -> change(doc.withPath(listOf("bg", "photoId"), if (id.isEmpty()) MarketingValue.NULL else MarketingValue.string(id)), null) }
    ArtworkPropertyRows(bg, listOf("color", "color2", "dim", "gradient")) { change(doc.with("bg", it), null) }
    ArtworkPropertyRows(ArtworkOps.placement(doc), listOf("mode", "zoom", "focusX", "focusY")) { change(ArtworkOps.withPlacement(doc, it), null) }
    if (bg.s("photoId").isNotEmpty()) {
        ArtworkShadeControls(bg["shade"], { v, key -> change(doc.withPath(listOf("bg", "shade"), v), key?.let { "bg-shade-$it" }) })
    }
    FilterControls(bg, catalogue) { change(doc.with("bg", it), null) }
    ActionRow("Add background gradient", { change(doc.withPath(listOf("bg", "color2"), MarketingValue.string("#111111")), null) })
}

/** Photo filters: a list to choose from, or the six sliders by hand (`adjust`). */
@Composable
private fun FilterControls(value: MarketingValue, catalogue: MarketingValue, onChange: (MarketingValue) -> Unit) {
    ArtworkMenuRow("Photo filters", listOf(MenuNode.Sub("Choose filter", catalogue["filters"].array.map { f -> MenuNode.Action(f.s("label")) { onChange(value.with("adjust", f["adjust"])) } })) +
        (if (value["adjust"].isNull) listOf(MenuNode.Action("Adjust by hand") { onChange(value.with("adjust", MarketingValue.of(mapOf("brightness" to 0, "contrast" to 0, "saturation" to 0, "warmth" to 0, "fade" to 0, "vignette" to 0)))) }) else emptyList()) +
        (if (!value["adjust"].isNull) listOf(MenuNode.Action("No filter") { onChange(value.with("adjust", MarketingValue.NULL)) }) else emptyList()))
    if (!value["adjust"].isNull) ArtworkPropertyRows(value["adjust"], listOf("brightness", "contrast", "saturation", "warmth", "fade", "vignette")) { onChange(value.with("adjust", it)) }
}

@Composable
private fun LayerControls(l: MarketingValue, doc: MarketingValue, fields: Map<String, String>, catalogue: MarketingValue, change: (MarketingValue, String?) -> Unit) {
    val id = l.s("id")
    fun set(next: MarketingValue, key: String? = null) {
        change(ArtworkOps.withLayers(doc, ArtworkOps.layers(doc).map { if (it.s("id") == id) next else it }), key)
    }
    if (l["locked"].bool) {
        ActionRow("Unlock", { set(l.with("locked", MarketingValue.bool(false))) })
        return
    }
    if (l.s("bind").isNotEmpty()) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) { SmallPrint("Uses the piece’s ${l.s("bind")}; edit it on the piece.") }
        ActionRow("Make independent text", { set(l.with("text", MarketingValue.string(fields[l.s("bind")] ?: "")).with("bind", MarketingValue.NULL)) })
    }
    val hidden = setOf("id", "kind", "bind", "photoId", "src", "mark", "flow", "group", "effect", "adjust", "box", "shade", "iz")
    ArtworkPropertyRows(l, l.obj.keys.filter { it !in hidden }.sorted()) { set(it) }
    val kind = l.s("kind")
    if (kind == "text") {
        val effects = catalogue["effects"].array.map { it.s("id") to it.s("label") }
        PickerRow("Text effect", l["effect"].s("kind", "none"), effects) { k ->
            set(l.with("effect", if (k == "none") MarketingValue.NULL else MarketingValue.of(mapOf("kind" to k, "color" to "#000000", "offset" to 30, "angle" to 45, "blur" to 20, "thickness" to 40, "transparency" to 50))))
        }
        ArtworkPropertyRows(l["effect"], listOf("color", "offset", "angle", "blur", "thickness", "transparency")) { set(l.with("effect", it)) }
        ToggleRow("Text box", l["box"].isNull.not(), onChange = { on -> set(l.with("box", if (on) MarketingValue.of(mapOf("color" to "#FFFFFF", "radius" to 24, "pad" to 20)) else MarketingValue.NULL)) })
        ArtworkPropertyRows(l, listOf("box")) { set(it) }
        ActionRow("Underline", { set(l.with("underline", MarketingValue.bool(!l["underline"].bool))) })
        if (l["curve"].isNull) ActionRow("Bend text", { set(l.with("curve", MarketingValue.number(20.0))) })
    }
    if (kind == "image") {
        FilterControls(l, catalogue) { set(it) }
        // Frames (a layer with a height) show the photo covering the frame; zoom goes past that.
        if (!l["h"].isNull) ArtworkSlider("Zoom in frame", l.n("iz", 1.0), 1.0..4.0, { set(l.with("iz", MarketingValue.number(it))) }, step = 0.05, format = { String.format(java.util.Locale.ROOT, "%.2f×", it) })
        ArtworkShadeControls(l["shade"], { v, key -> set(l.with("shade", v), key?.let { "shade-$id-$it" }) })
        val masks = listOf("" to "Rectangle") + catalogue["masks"].array.map { it.string to ArtworkProperties.label(it.string) }
        PickerRow("Frame", l.s("mask"), masks) { m -> set(l.with("mask", if (m.isEmpty()) MarketingValue.NULL else MarketingValue.string(m))) }
    }
    if (kind in listOf("shape", "rect", "circle")) {
        ToggleRow("Filled shape", !l["fill"].isNull, onChange = { on -> set(l.with("fill", if (on) MarketingValue.string("#FFFFFF") else MarketingValue.NULL)) })
        if (!l["fill"].isNull) ArtworkPropertyRows(l, listOf("fill")) { set(it) }
        ToggleRow("Gradient fill", !l["fill2"].isNull, onChange = { on -> set(l.with("fill2", if (on) MarketingValue.string("#111111") else MarketingValue.NULL)) })
    }
}
