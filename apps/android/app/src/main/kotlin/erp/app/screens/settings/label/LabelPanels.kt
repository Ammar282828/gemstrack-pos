package erp.app.screens.settings.label

import erp.app.ui.icons.Symbols
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.rememberShelfStatus
import erp.app.device.shareFile
import erp.app.nav.LocalNavigator
import erp.app.screens.settings.LabelLogic
import erp.app.screens.settings.SettingsFiles
import erp.app.screens.settings.SettingsSection
import erp.app.ui.ActionRow
import erp.app.ui.LocalNoteState
import erp.app.ui.MinTouchTarget
import erp.app.ui.Note
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.TwoLine
import erp.app.ui.ValueInput
import erp.app.ui.ValueRow
import erp.app.ui.PickerRow
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import erp.core.logic.LabelCSV
import erp.core.logic.LabelLive
import erp.core.logic.LabelPlaceholders
import erp.core.logic.LabelUnits
import erp.core.logic.TagPrint
import erp.core.logic.Zpl
import erp.core.models.LabelFieldType
import erp.core.models.LabelLayoutField
import erp.core.models.Product
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

// The designer's side panels: the placeholder picker, the counter, the layers list, the label's own settings, the preview
// piece and the CSV export (the iPhone's LabelDesignerPanels.swift).

// MARK: Placeholders

/**
 * The words a field's data takes: the piece's fields and the Tag CSV's columns (`_1`, `_2` for a double tag), the date, the
 * time and the counter. Tapping one hands its `{token}` back.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlaceholderSheet(tags: Int, title: String, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var tag by remember { mutableIntStateOf(1) }
    var group by remember { mutableStateOf("Piece") }
    fun pick(token: String) { onPick(token); scope.launch { state.hide(); onDismiss() } }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = state, containerColor = ErpColors.ground) {
        Column(Modifier.fillMaxSize().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { scope.launch { state.hide(); onDismiss() } }) { Text("Cancel") }
                Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                Box(Modifier.size(72.dp))
            }
            if (tags > 1) LabelSegments((1..minOf(12, tags)).map { it.toString() to "Tag $it" }, tag.toString(), { tag = it.toInt() })
            LabelSegments(listOf("Piece" to "Piece", "Tag CSV" to "Tag CSV", "Date" to "Date and counter"), group, { group = it })
            val chips = when (group) {
                "Piece" -> LabelLive.labelFields.map { f -> LabelPlaceholders.tokens(f.key, tags).getOrElse(tag - 1) { LabelPlaceholders.tokens(f.key, tags)[0] } to f.label }
                "Tag CSV" -> LabelCSV.baseHeaders.map { h -> LabelPlaceholders.tokens("csv:$h", tags).getOrElse(tag - 1) { LabelPlaceholders.tokens("csv:$h", tags)[0] } to h }
                else -> LabelPlaceholders.specials.map { it.token to it.label }
            }
            LazyColumn(Modifier.weight(1f).padding(horizontal = 16.dp)) {
                items(chips, key = { it.first }) { (token, label) ->
                    Row(Modifier.fillMaxWidth().clickable { pick(token) }.ledgerRow(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                        Text(token, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

/** `{counter:START:STEP:PAD}`: where it starts, how much it goes up by a label, and how many digits it fills. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CounterSheet(onAdd: (Int, Int, Int) -> Unit, onDismiss: () -> Unit) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var start by remember { mutableIntStateOf(1) }
    var step by remember { mutableIntStateOf(1) }
    var pad by remember { mutableIntStateOf(4) }
    fun sample(i: Int) = Zpl.resolveText("{counter:$start:$step:$pad}", emptyList(), i)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = state, containerColor = ErpColors.ground) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("Counter", style = MaterialTheme.typography.titleMedium)
            SettingsSection(footer = "Prints as ${sample(0)}, ${sample(1)}, ${sample(2)}…") {
                LabelNumberRow("Starts at", start, { start = it }, range = -999_999..999_999)
                LabelNumberRow("Goes up by", step, { step = it }, unit = "a label", range = -99..99)
                LabelNumberRow("Fills", pad, { pad = it }, unit = "digits", range = 0..12)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                TextButton(onClick = { scope.launch { state.hide(); onDismiss() } }) { Text("Cancel") }
                androidx.compose.material3.Button(onClick = { onAdd(start, step, pad); scope.launch { state.hide(); onDismiss() } }) { Text("Add") }
            }
        }
    }
}

// MARK: Layers

/** The fields top first: select, hide, lock, and move up or down. A tap selects (with "Select several" on, it adds). */
@Composable
fun LayersPanel(state: DesignerState) {
    val model = state.model
    state.rev
    val fields = model.layout.fields.reversed()
    if (fields.isEmpty()) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("No fields yet.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        return
    }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 8.dp)) {
        items(fields, key = { it.id }) { f ->
            val selected = model.selection.contains(f.id)
            val index = fields.indexOfFirst { it.id == f.id }
            Row(
                Modifier.fillMaxWidth().background(if (selected) ErpColors.accent.copy(alpha = 0.18f) else ErpColors.card)
                    .clickable { if (model.multiSelect) model.toggleSelected(f.id) else model.select(setOf(f.id)) }
                    .padding(horizontal = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(fieldGlyph(f.type), Modifier.size(22.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(layerTitle(f), Modifier.weight(1f).padding(vertical = 14.dp), maxLines = 1, color = MaterialTheme.colorScheme.onSurface.copy(alpha = if (f.hidden) 0.5f else 1f))
                IconButton({ model.setHidden(f.id, !f.hidden) }, Modifier.size(MinTouchTarget)) {
                    Icon(if (f.hidden) Symbols.VisibilityOff else Symbols.Visibility, if (f.hidden) "Show" else "Hide", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton({ model.setLocked(f.id, !f.locked) }, Modifier.size(MinTouchTarget)) {
                    Icon(if (f.locked) Symbols.Lock else Symbols.LockOpen, if (f.locked) "Unlock" else "Lock", tint = if (f.locked) Tone.owed.color() else MaterialTheme.colorScheme.onSurfaceVariant)
                }
                // The list shows the top field first: "up" in the list is "forward" on the tag.
                IconButton({ model.moveLayers(setOf(index), index - 1) }, Modifier.size(MinTouchTarget), enabled = !model.readOnly && index > 0) {
                    Icon(Symbols.ArrowUpward, "Move ${layerTitle(f)} up")
                }
                IconButton({ model.moveLayers(setOf(index), index + 2) }, Modifier.size(MinTouchTarget), enabled = !model.readOnly && index < fields.lastIndex) {
                    Icon(Symbols.ArrowDownward, "Move ${layerTitle(f)} down")
                }
            }
            androidx.compose.material3.HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
        }
    }
}

fun fieldGlyph(t: LabelFieldType): String = when (t) {
    LabelFieldType.text -> "T"
    LabelFieldType.qr -> "QR"
    LabelFieldType.barcode -> "|||"
    LabelFieldType.line -> "—"
    LabelFieldType.box -> "▢"
    LabelFieldType.ellipse -> "◯"
    LabelFieldType.image -> "▣"
}

fun kindName(f: LabelLayoutField): String = when (f.type) {
    LabelFieldType.text -> if ((f.data ?: "").contains("{")) "Variable text" else "Text"
    LabelFieldType.qr -> "QR code"
    LabelFieldType.barcode -> symbologyName(erp.core.logic.LabelGeometry.symbology(f))
    LabelFieldType.line -> "Line"
    LabelFieldType.box -> "Box"
    LabelFieldType.ellipse -> "Ellipse"
    LabelFieldType.image -> "Picture"
}

fun layerTitle(f: LabelLayoutField): String {
    f.name?.takeIf { it.isNotEmpty() }?.let { return it }
    return when (f.type) {
        LabelFieldType.text, LabelFieldType.qr, LabelFieldType.barcode -> (f.data ?: "").replace("\n", " ").ifEmpty { kindName(f) }
        else -> kindName(f)
    }
}

// MARK: The label itself

/**
 * The tag's name and size (millimetres and dots), its dpi, how many pieces share a label, and the way to the printer's
 * settings. The same on every device (`labelLayout`).
 */
@Composable
fun LabelSettingsSections(state: DesignerState) {
    val model = state.model
    state.rev
    val l = model.layout
    val navigator = LocalNavigator.current
    SettingsSection(
        "The tag",
        "${l.widthDots} × ${l.heightDots} dots. A double tag takes two pieces to a label: {sku_1} and {sku_2}. Changing the dpi does not move the fields; set the size in millimetres again.",
    ) {
        ValueRow("Name") { ValueInput(l.name, { v -> model.edit("label-name") { it.copy(name = v) } }, "Tag name", "Name", enabled = !model.readOnly) }
        LabelDotRow("Width", l.widthDots, l.dpi, { v -> if (!model.readOnly) model.edit("label-w") { it.copy(widthDots = maxOf(8, v)) } }, 8..8000)
        LabelDotRow("Height", l.heightDots, l.dpi, { v -> if (!model.readOnly) model.edit("label-h") { it.copy(heightDots = maxOf(8, v)) } }, 8..8000)
        PickerRow("Print quality", (l.dpi ?: 203).toString(), LabelUnits.dpiChoices.map { it.toString() to "$it dpi" }) { v ->
            if (!model.readOnly) model.edit { it.copy(dpi = if (v.toInt() == 203) null else v.toInt()) }
        }
        PickerRow(
            "Tags to a label", l.tagsPerLabel.toString(),
            buildList {
                add("1" to "One tag"); add("2" to "Two tags (double tag)")
                if (l.tagsPerLabel > 2) add(l.tagsPerLabel.toString() to "${l.tagsPerLabel} tags")
            },
        ) { v -> if (!model.readOnly) model.edit { it.copy(tags = if (v.toInt() <= 1) null else v.toInt()) } }
    }
    SettingsSection(footer = "Print tags straight to a Zebra on the network, or through Label LIVE on the Mac at the counter.") {
        LabelTapRow("Printer settings", { navigator.open("/app/tag-printer") }, icon = Symbols.Print)
        LabelTapRow("Label LIVE", { navigator.open("/app/label-live") }, icon = Symbols.Print)
    }
}

// MARK: The preview piece

/** Which pieces the canvas is filled from, the date and the counter it shows. With none chosen it shows made-up values. */
@Composable
fun LabelPreviewSections(state: DesignerState) {
    val model = state.model
    state.rev
    val book = LocalBook.current
    val products = rememberShelfStatus(book.products)
    val settings by erp.app.data.rememberSingle(book.settings)
    var search by remember { mutableStateOf("") }
    val tags = model.layout.tagsPerLabel
    val hits = remember(products.revision, search) { LabelLogic.hits(products.items, search).take(20) }
    SettingsSection(
        "Preview with",
        if (tags > 1) "Pick up to $tags pieces, one for each tag." else "Pick a piece to see its own words on the tag.",
    ) {
        for (i in 0 until tags) {
            ValueRow(if (tags > 1) "Tag ${i + 1}" else "Piece") {
                Text(model.previewProducts.getOrNull(i)?.sku ?: "Sample", color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
        }
        if (model.previewProducts.isNotEmpty()) ActionRow("Use made-up values", { model.setPreview(emptyList(), null) })
        ValueRow("Search") { ValueInput(search, { search = it }, "Name or SKU", "Search by name or SKU") }
        if (search.trim().isNotEmpty()) {
            if (!products.loaded) Column(Modifier.fillMaxWidth().ledgerRow()) { SkeletonLoading(compact = true) }
            else if (hits.isEmpty()) Text("No pieces found.", Modifier.fillMaxWidth().ledgerRow(), color = MaterialTheme.colorScheme.onSurfaceVariant)
            hits.forEach { p ->
                Box(Modifier.fillMaxWidth().clickable {
                    val chosen = model.previewProducts.toMutableList()
                    if (chosen.size >= tags) chosen.removeAt(chosen.lastIndex)
                    chosen.add(p)
                    model.setPreview(chosen, settings)
                    search = ""
                }.ledgerRow()) { TwoLine(p.name, subtitle = p.sku) }
            }
        }
    }
    SettingsSection("Date and counter") {
        LabelNumberRow("Counter starts at", model.previewCounter ?: 1, { model.previewCounter = it; model.redraw() }, range = -999_999..999_999)
        ActionRow("Date and time: now", { model.previewNow = Instant.now(); model.redraw() })
    }
}

// MARK: Export to CSV (the screen's older part)

/** A piece's tag as the CSV a label app like WEPrint imports (/api/app/labels). */
@Composable
fun LabelCsvSection() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val note = LocalNoteState.current
    val book = LocalBook.current
    val products = rememberShelfStatus(book.products)
    var search by remember { mutableStateOf("") }
    var picked by remember { mutableStateOf<Product?>(null) }
    var making by remember { mutableStateOf(false) }
    var csv by remember { mutableStateOf<java.io.File?>(null) }
    val hits = remember(products.revision, search) { LabelLogic.hits(products.items, search) }

    fun makeCsv() {
        val p = picked ?: return
        making = true
        scope.launch {
            try {
                val text = ErpApi.shared.data("/api/app/labels", "POST", mapOf("sku" to p.sku))
                csv = SettingsFiles.save(context, text.toByteArray(Charsets.UTF_8), LabelLogic.csvName(Instant.now()))
                note.show(Note("CSV exported", "Product details for ${p.sku} exported."))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                note.show(Note("The CSV was not made", e.message ?: e.toString(), failed = true))
            }
            making = false
        }
    }

    SettingsSection("Export to CSV") {
        val p = picked
        if (p != null) {
            ValueRow(p.name) { Text(p.sku, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            ActionRow("Choose another piece", onClick = { picked = null; csv = null })
        } else {
            ValueRow("Search") { ValueInput(search, { search = it }, "Name or SKU", "Search by name or SKU") }
            if (search.trim().isNotEmpty()) {
                if (!products.loaded) Column(Modifier.fillMaxWidth().ledgerRow()) { SkeletonLoading(compact = true) }
                else if (hits.isEmpty()) Text("No pieces found.", Modifier.fillMaxWidth().ledgerRow(), color = MaterialTheme.colorScheme.onSurfaceVariant)
                hits.forEach { h -> Box(Modifier.fillMaxWidth().clickable { picked = h; search = ""; csv = null }.ledgerRow()) { TwoLine(h.name, subtitle = h.sku) } }
            }
        }
        ActionRow(if (making) "Making…" else "Download CSV for this piece", onClick = { makeCsv() }, icon = Symbols.FileDownload, enabled = picked != null && !making)
        csv?.let { f -> ActionRow("Save or send ${f.name}", onClick = { shareFile(context, f, "text/csv", f.name) }, icon = Symbols.Share) }
    }
}
