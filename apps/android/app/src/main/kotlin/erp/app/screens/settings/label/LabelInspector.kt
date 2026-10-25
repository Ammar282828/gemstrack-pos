package erp.app.screens.settings.label

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.AutoFixHigh
import androidx.compose.material.icons.filled.DataObject
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.RotateRight
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import erp.app.screens.settings.SettingsSection
import erp.app.ui.FieldRow
import erp.app.ui.MinTouchTarget
import erp.app.ui.TextRow
import erp.app.ui.ToggleRow
import erp.app.ui.PickerRow
import erp.app.ui.Tone
import erp.app.ui.ValueRow
import erp.app.ui.color
import erp.core.logic.Dither
import erp.core.logic.LabelGeometry
import erp.core.logic.LabelPlaceholders
import erp.core.models.LabelFieldType
import erp.core.models.LabelLayoutField

// Every property of the selected field (the iPhone's LabelInspector.swift): its name, whether it is hidden or locked, its
// place and size in dots and millimetres, and what its kind has: the text and its placeholders, a QR's magnification and
// correction, a bar code's symbology, height and modules, a box's thickness and rounding, a picture's dithering. With several
// fields selected a change reaches every one of the same kind as the last picked; a field's place can be set for all.

@Composable
fun LabelInspector(state: DesignerState, requestDelete: () -> Unit, replacePicture: () -> Unit) {
    val model = state.model
    state.rev
    val f = model.primary
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        if (f == null) {
            Text(
                "Tap a field on the tag to change it, or add one from the + menu.",
                Modifier.padding(vertical = 8.dp), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            return@Column
        }
        val ro = model.readOnly
        Header(state, f)
        PlaceSection(state, f)
        when (f.type) {
            LabelFieldType.text -> TextSections(state, f)
            LabelFieldType.qr -> QrSection(state, f)
            LabelFieldType.barcode -> BarcodeSection(state, f)
            LabelFieldType.line, LabelFieldType.box, LabelFieldType.ellipse -> ShapeSection(state, f)
            LabelFieldType.image -> ImageSection(state, f, replacePicture)
        }
        TurnSection(state, f)
        if (!ro) {
            SettingsSection {
                LabelTapRow("Remove ${if (model.selection.size > 1) "${model.selection.size} fields" else "field"}", requestDelete, icon = Icons.Filled.Delete, danger = true)
            }
        }
    }
}

@Composable
private fun Header(state: DesignerState, f: LabelLayoutField) {
    val model = state.model
    SettingsSection(if (model.selection.size > 1) "${model.selection.size} fields" else "Field") {
        ValueRow("Kind") { Text(kindName(f), color = MaterialTheme.colorScheme.onSurfaceVariant) }
        TextRow("Name", f.name ?: "", { v -> model.setProperty("name") { it.copy(name = v.ifEmpty { null }) } }, "Name for the layers list")
        ToggleRow("Hidden (not printed)", f.hidden, { v -> model.setProperty("hidden") { it.copy(hidden = v) } })
        ToggleRow("Locked", f.locked, { v -> model.setProperty("locked") { it.copy(locked = v) } })
    }
}

@Composable
private fun PlaceSection(state: DesignerState, f: LabelLayoutField) {
    val model = state.model
    val dpi = model.layout.dpi
    val box = model.boxOfPrimary()
    SettingsSection("Place and size", "From the tag’s top-left corner, in printer dots and millimetres.") {
        LabelDotRow("X", f.x, dpi, { model.setX(it) })
        LabelDotRow("Y", f.y, dpi, { model.setY(it) })
        if (model.selection.size == 1 && box != null) {
            LabelDotRow("Width", Math.round(box.w).toInt(), dpi, { model.setBoxSize(w = maxOf(1, it)) }, 1..32000)
            LabelDotRow("Height", Math.round(box.h).toInt(), dpi, { model.setBoxSize(h = maxOf(1, it)) }, 1..32000)
        }
        // Whole dots by hand, for a phone's thumb: the arrow keys of a keyboard.
        Box(Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
            androidx.compose.foundation.layout.Row(Modifier.align(Alignment.Center), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Nudge", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(end = 8.dp))
                NudgeButton(Icons.Filled.ArrowBack, "Left") { model.nudge(-1, 0) }
                NudgeButton(Icons.Filled.ArrowUpward, "Up") { model.nudge(0, -1) }
                NudgeButton(Icons.Filled.ArrowDownward, "Down") { model.nudge(0, 1) }
                NudgeButton(Icons.Filled.ArrowForward, "Right") { model.nudge(1, 0) }
            }
        }
    }
}

@Composable
private fun NudgeButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    IconButton(onClick, Modifier.size(MinTouchTarget)) { Icon(icon, "Nudge $label by a dot", tint = erp.app.ui.theme.ErpColors.accent) }
}

@Composable
private fun TurnSection(state: DesignerState, f: LabelLayoutField) {
    val model = state.model
    SettingsSection("Turn") {
        when (f.type) {
            LabelFieldType.text, LabelFieldType.qr, LabelFieldType.barcode -> {
                PickerRow("Rotation", f.rotation.toString(), listOf(0, 90, 180, 270).map { it.toString() to "$it°" }) { v -> model.rotateSelection(v.toInt() - f.rotation) }
                LabelTapRow("Rotate 90°", { model.rotateSelection() }, icon = Icons.Filled.RotateRight)
            }
            LabelFieldType.image -> ToggleRow("Upside down (180°)", f.rotation == 180, { model.rotateSelection() })
            LabelFieldType.line, LabelFieldType.box, LabelFieldType.ellipse -> LabelTapRow("Turn on its side", { model.rotateSelection() }, icon = Icons.Filled.RotateRight)
        }
    }
}

// MARK: Text

/** The `{token}` added to the end of the data of the selected texts, QRs and bar codes. */
private fun append(state: DesignerState, token: String) {
    val model = state.model
    val type = model.primary?.type ?: return
    val ids = model.selection
    model.edit("data-${model.primary?.id}") { l ->
        l.copy(fields = l.fields.map { f ->
            if (ids.contains(f.id) && (f.type == LabelFieldType.text || f.type == LabelFieldType.qr || f.type == LabelFieldType.barcode)) f.copy(data = LabelPlaceholders.appending(token, f.data ?: "")) else f
        })
    }
    if (type == LabelFieldType.line) return
}

@Composable
private fun PlaceholderRow(state: DesignerState) {
    var open by remember { mutableStateOf(false) }
    LabelTapRow("Add a piece field", { open = true }, icon = Icons.Filled.DataObject, enabled = !state.model.readOnly)
    if (open) PlaceholderSheet(state.model.layout.tagsPerLabel, "Add a piece field", { append(state, it) }, { open = false })
}

@Composable
private fun TransformRow(state: DesignerState, f: LabelLayoutField) {
    var open by remember { mutableStateOf(false) }
    Box {
        LabelTapRow("Change how a value reads", { open = true }, icon = Icons.Filled.AutoFixHigh, enabled = !state.model.readOnly)
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            LabelPlaceholders.transforms.forEach { t ->
                DropdownMenuItem(
                    text = { Column { Text(t.token, style = MaterialTheme.typography.bodyLarge); Text(t.help, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) } },
                    onClick = {
                        open = false
                        // `|upper` and the like go inside the last `{…}` of the text.
                        val text = f.data ?: return@DropdownMenuItem
                        val close = text.lastIndexOf('}')
                        if (close < 0) return@DropdownMenuItem
                        val next = text.substring(0, close) + t.token + text.substring(close)
                        state.model.edit("data-${f.id}") { l -> l.copy(fields = l.fields.map { if (it.id == f.id) it.copy(data = next) else it }) }
                    },
                )
            }
        }
    }
}

@Composable
private fun TextSections(state: DesignerState, f: LabelLayoutField) {
    val model = state.model
    var help by remember { mutableStateOf(false) }
    SettingsSection("Words", "{sku} is replaced by the piece’s SKU when the tag prints.") {
        FieldRow("Text", f.data ?: "", { v -> model.setProperty("data") { it.copy(data = v) } }, singleLine = false, minLines = 1, maxLines = 8, enabled = !model.readOnly)
        PlaceholderRow(state)
        TransformRow(state, f)
        LabelTapRow("How placeholders work", { help = !help }, sub = if (help) null else "Tap to read")
        if (help) Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            LabelPlaceholders.help.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
    SettingsSection("Look") {
        LabelNumberRow("Font size", f.fontSize ?: 20, { v -> model.setProperty("fs") { it.copy(fontSize = maxOf(1, v)) } }, "dots", 4..600)
        ToggleRow("Wrap in a block", (f.width ?: 0) >= 1, { v -> model.setProperty("block") { it.copy(width = if (v) 200 else null) } })
        if ((f.width ?: 0) >= 1) {
            LabelNumberRow("Block width", f.width ?: 200, { v -> model.setProperty("width") { it.copy(width = maxOf(1, v)) } }, "dots", 8..32000)
            LabelNumberRow("Lines", f.lines ?: 0, { v -> model.setProperty("lines") { it.copy(lines = if (v >= 1) v else null) } }, "0 = by line breaks", 0..99)
            LabelSegments(listOf("L" to "Left", "C" to "Centre", "R" to "Right"), f.align ?: "L", { v -> model.setProperty("align") { it.copy(align = if (v == "L") null else v) } }, enabled = !model.readOnly)
        }
        LabelNumberRow("Line spacing", f.lineSpacing ?: 0, { v -> model.setProperty("spacing") { it.copy(lineSpacing = if (v == 0) null else v) } }, "dots", -50..200)
        ToggleRow("Bold", f.bold ?: false, { v -> model.setProperty("bold") { it.copy(bold = if (v) true else null) } })
    }
}

// MARK: QR and bar codes

@Composable
private fun QrSection(state: DesignerState, f: LabelLayoutField) {
    val model = state.model
    SettingsSection("QR code") {
        FieldRow("Data", f.data ?: "", { v -> model.setProperty("data") { it.copy(data = v) } }, singleLine = false, minLines = 1, maxLines = 4, enabled = !model.readOnly)
        PlaceholderRow(state)
        LabelNumberRow("Magnification", LabelGeometry.qrMagnification(f), { v -> model.setProperty("mag") { it.copy(qrMagnification = minOf(10, maxOf(1, v))) } }, "dots a module", 1..10)
        PickerRow(
            "Error correction", LabelGeometry.correction(f),
            listOf("L" to "Low (7%)", "M" to "Medium (15%)", "Q" to "Quartile (25%)", "H" to "High (30%)"),
        ) { v -> model.setProperty("ec") { it.copy(errorCorrection = v) } }
    }
}

@Composable
private fun BarcodeSection(state: DesignerState, f: LabelLayoutField) {
    val model = state.model
    val sym = LabelGeometry.symbology(f)
    SettingsSection("Bar code", if (sym == "pdf417" || sym == "datamatrix") "Drawn as ZXing lays it out; the printer makes the real symbol." else null) {
        FieldRow("Data", f.data ?: "", { v -> model.setProperty("data") { it.copy(data = v) } }, singleLine = false, minLines = 1, maxLines = 4, enabled = !model.readOnly)
        PlaceholderRow(state)
        PickerRow("Symbology", sym, barcodeKinds.map { it to symbologyName(it) }) { v -> model.setProperty("sym") { it.copy(symbology = v) } }
        if (sym != "datamatrix") {
            LabelNumberRow(if (sym == "pdf417") "Row height" else "Bar height", LabelGeometry.barHeight(f), { v -> model.setProperty("bh") { it.copy(height = maxOf(1, v)) } }, "dots", 1..1000)
        }
        LabelNumberRow("Module width", LabelGeometry.moduleWidth(f), { v -> model.setProperty("mw") { it.copy(moduleWidth = minOf(10, maxOf(1, v))) } }, "dots", 1..10)
        if (LabelGeometry.isLinear(sym)) ToggleRow("Show the text under it", f.showText ?: false, { v -> model.setProperty("st") { it.copy(showText = v) } })
    }
}

val barcodeKinds = listOf("code128", "code39", "ean13", "upca", "datamatrix", "pdf417")

// MARK: Shapes and pictures

@Composable
private fun ShapeSection(state: DesignerState, f: LabelLayoutField) {
    val model = state.model
    SettingsSection(
        kindName(f),
        if (f.type == LabelFieldType.line) "A line is a solid bar: make it thin with its Height (or Width, on its side)." else null,
    ) {
        if (f.type != LabelFieldType.line) {
            LabelNumberRow("Thickness", f.thickness ?: 2, { v -> model.setProperty("th") { it.copy(thickness = maxOf(1, v)) } }, "dots", 1..200)
            ToggleRow("Filled", f.fill ?: false, { v -> model.setProperty("fill") { it.copy(fill = if (v) true else null) } })
        }
        if (f.type == LabelFieldType.box) {
            LabelNumberRow("Rounded corners", f.rounding ?: 0, { v -> model.setProperty("rd") { it.copy(rounding = if (v == 0) null else minOf(8, maxOf(0, v))) } }, "0 to 8", 0..8)
        }
    }
}

@Composable
private fun ImageSection(state: DesignerState, f: LabelLayoutField, replacePicture: () -> Unit) {
    val model = state.model
    val hasSource = f.source != null
    fun redo(dither: Dither?, threshold: Double?) {
        val d = dither ?: Dither.entries.firstOrNull { it.raw == f.dither } ?: Dither.threshold
        val t = threshold ?: f.threshold ?: 0.5
        val out = LabelPicture.redone(f, d, t) ?: return
        model.edit("dither-${f.id}") { l -> l.copy(fields = l.fields.map { if (it.id == f.id) out else it }) }
    }
    SettingsSection(
        "Picture",
        if (!hasSource) "This picture came without its original, so its dots can be scaled but not dithered again. Choose another picture to change that." else null,
    ) {
        LabelSegments(
            listOf("threshold" to "Threshold", "atkinson" to "Atkinson", "floyd" to "Floyd"), Dither.entries.firstOrNull { it.raw == f.dither }?.raw ?: "threshold",
            { v -> redo(Dither.entries.first { it.raw == v }, null) }, enabled = hasSource && !model.readOnly,
        )
        LabelSliderRow("Threshold ${Math.round((f.threshold ?: 0.5) * 100)}%", f.threshold ?: 0.5, 0.05..0.95, { redo(null, it) }, enabled = hasSource && !model.readOnly)
        LabelTapRow("Choose another picture…", replacePicture, icon = Icons.Filled.PhotoLibrary, enabled = !model.readOnly)
    }
}
