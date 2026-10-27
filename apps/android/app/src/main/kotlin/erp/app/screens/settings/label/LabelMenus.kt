package erp.app.screens.settings.label

import erp.app.ui.icons.Symbols
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import erp.app.ui.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import erp.app.ui.MinTouchTarget
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.theme.ErpColors
import erp.core.logic.LabelAlign
import erp.core.logic.LabelAxis
import erp.core.logic.LabelNewKind
import erp.core.logic.LabelOrder
import erp.core.logic.LabelUnits

// The designer's menus and its control bar (the iPhone's Add, Arrange and More menus, and controlBar). Compose menus do not
// nest, so a menu with a submenu swaps its own items for the submenu's, with a Back at the top.

// MARK: The phone's clipboard

fun copyToClipboard(context: Context, label: String, text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText(label, text))
}

fun clipboardText(context: Context): String? {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    return clipboard.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()
}

// MARK: A menu that swaps

private class Entry(val title: String, val enabled: Boolean = true, val danger: Boolean = false, val sub: List<Entry>? = null, val action: () -> Unit = {})

@Composable
private fun SwapMenu(open: Boolean, onClose: () -> Unit, entries: List<Entry>) {
    var path by remember(open) { mutableStateOf<List<Int>>(emptyList()) }
    var shown = entries
    for (i in path) shown = shown.getOrNull(i)?.sub ?: shown
    DropdownMenu(expanded = open, onDismissRequest = onClose) {
        if (path.isNotEmpty()) {
            DropdownMenuItem(text = { Text("‹ Back") }, onClick = { path = path.dropLast(1) })
            HorizontalDivider()
        }
        shown.forEachIndexed { i, e ->
            DropdownMenuItem(
                text = { Text(e.title + if (e.sub != null) "  ›" else "", color = if (e.danger) Tone.problem.color() else MaterialTheme.colorScheme.onSurface) },
                enabled = e.enabled,
                onClick = { if (e.sub != null) path = path + i else { onClose(); e.action() } },
            )
        }
    }
}

// MARK: Add

/** Text, variable text, QR, bar codes, shapes, a picture, the date and a counter. */
@Composable
fun AddMenu(state: DesignerState, addPicture: () -> Unit, addCounter: () -> Unit, pickVariable: () -> Unit) {
    val model = state.model
    var open by remember { mutableStateOf(false) }
    val entries = listOf(
        Entry("Text") { model.add(LabelNewKind.Text) },
        Entry("Variable text…", action = pickVariable),
        Entry("QR code") { model.add(LabelNewKind.Qr) },
        Entry("Bar code", sub = barcodeKinds.map { s -> Entry(symbologyName(s)) { model.add(LabelNewKind.Barcode(s)) } }),
        Entry("Line") { model.add(LabelNewKind.Line) },
        Entry("Box") { model.add(LabelNewKind.Box) },
        Entry("Ellipse") { model.add(LabelNewKind.Ellipse) },
        Entry("Picture…", action = addPicture),
        Entry(
            "Date and time",
            sub = listOf(
                Entry("24 Oct 2026  (d MMM yyyy)") { model.add(LabelNewKind.Date("d MMM yyyy")) },
                Entry("24/10/2026  (dd/MM/yyyy)") { model.add(LabelNewKind.Date("dd/MM/yyyy")) },
                Entry("Oct 2026  (MMM yyyy)") { model.add(LabelNewKind.Date("MMM yyyy")) },
                Entry("10/26  (MM/yy)") { model.add(LabelNewKind.Date("MM/yy")) },
                Entry("Time  (HH:mm)") { model.add(LabelNewKind.Variable("{time}")) },
            ),
        ),
        Entry("Counter…", action = addCounter),
    )
    Box {
        IconButton({ open = true }, enabled = !model.readOnly) { Icon(Symbols.Add, "Add a field to the tag") }
        SwapMenu(open, { open = false }, entries)
    }
}

// MARK: Arrange

@Composable
fun ArrangeMenu(state: DesignerState, requestDelete: () -> Unit) {
    val model = state.model
    val context = LocalContext.current
    var open by remember { mutableStateOf(false) }
    val has = model.selection.isNotEmpty()
    val entries = listOf(
        Entry("Duplicate", has) { model.duplicateSelection() },
        Entry("Copy", has) { model.copyText()?.let { copyToClipboard(context, "Tag fields", it) } },
        Entry("Paste", model.canPaste(clipboardText(context))) { model.paste(clipboardText(context)) },
        Entry("Select all") { model.selectAll() },
        Entry(
            "Align", has,
            sub = listOf(
                Entry("Left") { model.align(LabelAlign.left) }, Entry("Centre") { model.align(LabelAlign.centre) }, Entry("Right") { model.align(LabelAlign.right) },
                Entry("Top") { model.align(LabelAlign.top) }, Entry("Middle") { model.align(LabelAlign.middle) }, Entry("Bottom") { model.align(LabelAlign.bottom) },
            ),
        ),
        Entry("Distribute", model.selection.size >= 3, sub = listOf(Entry("Across") { model.distribute(LabelAxis.horizontal) }, Entry("Down") { model.distribute(LabelAxis.vertical) })),
        Entry(
            "Order", has,
            sub = listOf(
                Entry("Bring to front") { model.order(LabelOrder.front) }, Entry("Bring forward") { model.order(LabelOrder.forward) },
                Entry("Send backward") { model.order(LabelOrder.backward) }, Entry("Send to back") { model.order(LabelOrder.back) },
            ),
        ),
        Entry("Rotate 90°", has) { model.rotateSelection() },
        Entry("Remove", has, danger = true, action = requestDelete),
    )
    Box {
        IconButton({ open = true }, enabled = !model.readOnly) { Icon(Symbols.Tune, "Arrange: align, order, turn and copy the selected fields") }
        SwapMenu(open, { open = false }, entries)
    }
}

// MARK: File

@Composable
fun FileMenu(import: () -> Unit, copyZpl: () -> Unit, testPrint: () -> Unit, standard: () -> Unit, readOnly: Boolean, testing: Boolean) {
    var open by remember { mutableStateOf(false) }
    val entries = listOf(
        Entry("Import a Label LIVE design…", !readOnly, action = import),
        Entry("Copy ZPL", action = copyZpl),
        Entry("Test print", !testing, action = testPrint),
        Entry("Back to the standard tag", !readOnly, action = standard),
    )
    Box {
        IconButton({ open = true }) { Icon(Symbols.MoreVert, "More: import, copy ZPL, test print") }
        SwapMenu(open, { open = false }, entries)
    }
}

// MARK: The control bar

@Composable
fun LabelControlBar(state: DesignerState, saveState: String) {
    val model = state.model
    state.rev
    val l = model.layout
    var zoomOpen by remember { mutableStateOf(false) }
    var gridOpen by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(0.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton({ model.undo() }, enabled = model.canUndo) { Icon(Symbols.Undo, "Undo") }
        IconButton({ model.redo() }, enabled = model.canRedo) { Icon(Symbols.Redo, "Redo") }
        IconButton({ model.zoomOut() }) { Icon(Symbols.ZoomOut, "Zoom out") }
        Box {
            TextButton({ zoomOpen = true }, Modifier.widthIn(min = 56.dp)) { Text(model.zoomText, maxLines = 1) }
            DropdownMenu(expanded = zoomOpen, onDismissRequest = { zoomOpen = false }) {
                DropdownMenuItem(text = { Text("Fit to window") }, onClick = { zoomOpen = false; model.zoomFit() })
                listOf(50, 100, 200, 400, 800).forEach { p -> DropdownMenuItem(text = { Text("$p%") }, onClick = { zoomOpen = false; model.zoomPercent(p) }) }
            }
        }
        IconButton({ model.zoomIn() }) { Icon(Symbols.ZoomIn, "Zoom in") }
        Toggle(Symbols.GridOn, "Grid and snap", model.gridOn) { model.gridOn = it; model.redraw() }
        if (model.gridOn) Box {
            TextButton({ gridOpen = true }) { Text("${model.gridDots} dots", maxLines = 1) }
            DropdownMenu(expanded = gridOpen, onDismissRequest = { gridOpen = false }) {
                listOf(2, 4, 8, 16, 24).forEach { g -> DropdownMenuItem(text = { Text("$g dots") }, onClick = { gridOpen = false; model.gridDots = g; model.redraw() }) }
            }
        }
        Toggle(Symbols.Straighten, "Rulers in millimetres", model.showRulers) { model.showRulers = it; model.redraw() }
        Toggle(Symbols.PanTool, "Move the view", model.panMode) { model.panMode = it; model.redraw() }
        Toggle(if (model.multiSelect) Symbols.CheckBox else Symbols.CheckBoxOutlineBlank, "Select several", model.multiSelect) { model.multiSelect = it; model.redraw() }
        Text(
            "${LabelUnits.mmText(l.widthDots.toDouble(), l.dpi)} × ${LabelUnits.mmText(l.heightDots.toDouble(), l.dpi)} mm · ${l.widthDots} × ${l.heightDots} dots · ${l.dpi ?: 203} dpi",
            Modifier.padding(start = 8.dp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1,
        )
        Text(saveState, Modifier.padding(horizontal = 8.dp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
    }
}

@Composable
private fun Toggle(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, on: Boolean, onChange: (Boolean) -> Unit) {
    IconToggleButton(on, onChange, Modifier.size(MinTouchTarget).semantics { contentDescription = label }) {
        Icon(icon, label, tint = if (on) ErpColors.accent else MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// MARK: Asking first

/** The designer's "are you sure": a title, a sentence, and the word that does it. */
@Composable
fun LabelConfirm(title: String, message: String, action: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(message) },
        confirmButton = { TextButton({ onDismiss(); onConfirm() }) { Text(action, color = Tone.problem.color()) } },
        dismissButton = { TextButton(onDismiss) { Text("Cancel") } },
    )
}
