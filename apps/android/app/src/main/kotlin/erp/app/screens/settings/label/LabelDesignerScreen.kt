package erp.app.screens.settings.label

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LocalOffer
import erp.app.ui.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.ErpApp
import erp.app.auth.LocalSession
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.Outbox
import erp.app.device.TagPrinter
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.screens.settings.LabelLogic
import erp.app.screens.settings.SettingsFiles
import erp.app.screens.settings.SettingsSection
import erp.app.ui.FailureAlert
import erp.app.ui.LocalNoteState
import erp.app.ui.Note
import erp.app.ui.NotAvailableState
import erp.app.ui.SkeletonLoading
import erp.app.ui.theme.ErpColors
import erp.core.logic.LabelDesignerModel
import erp.core.logic.LabelLSC
import erp.core.logic.LabelNewKind
import erp.core.logic.Zpl
import erp.core.models.LabelLayout
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// Stock > Labels (src/app/settings/printer/page.tsx; its address is still /settings/printer): the shop's tag, designed on a
// canvas the way Label LIVE does, field by field, in the printer's dots (the iPhone's LabelDesignerScreen.swift).
//
// - The layout is the shop's (settings `labelLayout`, the same on every device). It is read live and saved a second after the
//   last change (/api/app/write `saveLabelLayout`, core's `LabelLayout.saveFields()`), owners only; staff see the tag but cannot
//   change it. One being edited is never replaced by the copy arriving from another device until it has been saved. The
//   printer options (`layout.printer`, edited at Printer settings) are always taken from the latest copy when saving, so a
//   save never writes them back stale.
// - With none saved the standard tag is shown, the ERP's own (/api/app/labels, else core's copy of it).
// - Wide screens: layers on the left, the canvas in the middle, the inspector on the right. Phones: the canvas with a panel
//   under it (Field, Layers, Label, Preview).

/** The designer's model, and a counter the screen reads so it is drawn again whenever the model says anything changed. */
@Stable
class DesignerState(val model: LabelDesignerModel) {
    var rev by mutableIntStateOf(0)

    init { model.onRevision = { rev += 1 } }
}

@Composable
fun LabelSettings() {
    ScreenTitle("Labels")
    LabelDesigner()
}

@Composable
private fun LabelDesigner() {
    val book = LocalBook.current
    val session = LocalSession.current
    LaunchedEffect(book) { book.settings.need() }
    val settings by book.settings.value.collectAsStateWithLifecycle()
    val loaded by book.settings.loaded.collectAsStateWithLifecycle()
    val error by book.settings.error.collectAsStateWithLifecycle()
    var standard by remember { mutableStateOf<LabelLayout?>(null) }
    var standardTried by remember { mutableStateOf(false) }
    var state by remember { mutableStateOf<DesignerState?>(null) }
    // On its way through the Outbox: the heading says "Saving…" until it is sent.
    val queued by Outbox.items.collectAsStateWithLifecycle()
    val saving = queued.any { it.label == "Label layout" }
    val saved = settings?.labelLayout?.takeIf { it.hasSize }

    fun adopt() {
        // A failed read is not "no saved layout": adopting the standard tag then would save it over the shop's own.
        if (!loaded || (error != null && settings == null)) return
        val incoming = saved ?: standard ?: (if (standardTried) LabelLayout.standard else null) ?: return
        val current = state
        if (current == null) {
            state = DesignerState(LabelDesignerModel(incoming, LabelMeasurer.measure)).also { it.model.readOnly = !session.isOwner }
            return
        }
        val m = current.model
        m.readOnly = !session.isOwner
        if (!m.edited) {
            if (m.layout != incoming) m.adopt(incoming)
        } else if (saved != null) {
            m.adoptPrinter(saved.printer)
        }
    }

    fun save(next: LabelLayout) {
        if (!session.isOwner) return
        // Printer settings are the Printer screen's: take the latest, never write a stale copy back.
        val out = if (saved != null) next.copy(printer = saved.printer) else next
        // `seq` (in saveFields) makes each save its own: a field moved and moved back is a new change, not one sent twice.
        ErpApi.shared.enqueue(LabelLayout.saveOp, out.saveFields(), "Label layout")
        val m = state?.model
        if (m != null && m.layout == next) m.edited = false
    }

    LaunchedEffect(Unit) {
        try {
            standard = LabelLogic.standard(ErpApi.shared.get("/api/app/labels"))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // The standard tag is core's own copy then.
        }
        standardTried = true
    }
    // Adopt the saved layout when it arrives (or changes on another device, or at Printer settings) unless one is being edited.
    LaunchedEffect(saved, loaded, error, standard, standardTried, session.isOwner) { adopt() }
    // Saved a second after the last change.
    val layoutNow = state?.let { s -> s.rev; s.model.layout }
    LaunchedEffect(layoutNow) {
        val m = state?.model ?: return@LaunchedEffect
        val l = layoutNow ?: return@LaunchedEffect
        if (!m.edited || m.readOnly) return@LaunchedEffect
        delay(1000)
        save(l)
    }
    // A change made in the last second before leaving is saved rather than dropped with the timer.
    val latestState by rememberUpdatedState(state)
    val latestSave by rememberUpdatedState(::save)
    DisposableEffect(Unit) {
        onDispose {
            val m = latestState?.model
            if (m != null && m.edited && !m.readOnly) latestSave(m.layout)
        }
    }

    val s = state
    when {
        s != null -> LabelDesignerContent(
            s, standard ?: LabelLayout.standard,
            when {
                s.model.readOnly -> "Read only"
                s.model.edited || saving -> "Saving…"
                saved != null -> "Saved"
                else -> ""
            },
        )
        loaded && error != null && settings == null -> Column(Modifier.fillMaxSize(), horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
            NotAvailableState("Couldn't load the tag", why = error, icon = Icons.Filled.LocalOffer)
            Button(onClick = { book.settings.reset(); book.settings.need() }) { Text("Try again") }
        }
        else -> SkeletonLoading()
    }
}

internal enum class Panel(val title: String) { Field("Field"), Layers("Layers"), Label("Label"), Preview("Preview") }

/** The designer drawn from a model: what the screen is, whether it has loaded its layout from the books or not (the screenshots draw it from a made-up one). */
@Composable
internal fun LabelDesignerContent(state: DesignerState, standard: LabelLayout, saveState: String, startPanel: Panel = Panel.Field) {
    val model = state.model
    state.rev
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val note = LocalNoteState.current
    var panel by remember { mutableStateOf(startPanel) }
    var confirmingDelete by remember { mutableStateOf(false) }
    var confirmingStandard by remember { mutableStateOf(false) }
    var pendingImport by remember { mutableStateOf<LabelLayout?>(null) }
    var addingPicture by remember { mutableStateOf(false) }
    var replacingPicture by remember { mutableStateOf(false) }
    var addingCounter by remember { mutableStateOf(false) }
    var pickingVariable by remember { mutableStateOf(false) }
    var testing by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }

    fun requestDelete() {
        if (!model.canEditSelection) return
        if (model.selection.size > 3) confirmingDelete = true else model.deleteSelection()
    }

    fun zpl() = Zpl.render(model.layout, model.pieces, counterStart = model.previewCounter, now = model.previewNow)

    val importer = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null || model.readOnly) return@rememberLauncherForActivityResult
        scope.launch {
            val bytes = withContext(Dispatchers.IO) { runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull() }
            if (bytes == null) { problem = "That file could not be read."; return@launch }
            val name = SettingsFiles.displayName(context, uri).substringBeforeLast('.').ifEmpty { null }
            val design = withContext(Dispatchers.Default) {
                LabelLSC.importDesign(bytes, model.layout.id.ifEmpty { null }, name, LabelPicture.importDecoder)
            }
            when {
                design == null || !design.hasSize -> problem = "That is not a Label LIVE design."
                design.fields.isEmpty() -> problem = "That design has nothing on it the tag can print."
                else -> pendingImport = design.copy(printer = model.layout.printer)
            }
        }
    }

    ScreenActions {
        AddMenu(state, addPicture = { addingPicture = true }, addCounter = { addingCounter = true }, pickVariable = { pickingVariable = true })
        ArrangeMenu(state, ::requestDelete)
        FileMenu(
            import = { importer.launch(arrayOf("*/*")) },
            copyZpl = {
                copyToClipboard(context, "ZPL", zpl())
                note.show(Note("ZPL copied", "The tag as the printer reads it."))
            },
            testPrint = {
                testing = true
                scope.launch {
                    val outcome = TagPrinter.send(zpl())
                    testing = false
                    if (outcome.ok) note.show(Note("Test tag sent", outcome.message)) else problem = outcome.message
                }
            },
            standard = { confirmingStandard = true },
            readOnly = model.readOnly, testing = testing,
        )
    }

    // The first field picked brings its panel forward.
    val selectedNow = model.selection.isNotEmpty()
    LaunchedEffect(selectedNow) { if (selectedNow && panel == Panel.Layers) panel = Panel.Field }

    Column(Modifier.fillMaxSize().background(ErpColors.ground)) {
        if (model.readOnly) {
            Text(
                "Only owners can change the tag. This is how it prints.",
                Modifier.fillMaxWidth().padding(8.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val wide = maxWidth >= 840.dp
            if (wide) {
                Row(Modifier.fillMaxSize()) {
                    Column(Modifier.width(230.dp).fillMaxHeight()) {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp)) {
                            Text("Layers", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                            Text("${model.layout.fields.size}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        LayersPanel(state)
                    }
                    VerticalRule()
                    Column(Modifier.weight(1f).fillMaxHeight()) {
                        LabelCanvas(state, Modifier.weight(1f), ::requestDelete)
                        HorizontalDivider()
                        LabelControlBar(state, saveState)
                    }
                    VerticalRule()
                    Column(Modifier.width(360.dp).fillMaxHeight()) {
                        LabelSegments(listOf("Field" to "Field", "Label" to "Label", "Preview" to "Preview"), if (panel == Panel.Layers) "Field" else panel.title, { v -> panel = Panel.entries.first { it.title == v } })
                        Box(Modifier.weight(1f)) { PanelBody(state, panel, standard, ::requestDelete, { replacingPicture = true }) { confirmingStandard = true } }
                    }
                }
            } else {
                Column(Modifier.fillMaxSize()) {
                    LabelCanvas(state, Modifier.weight(1f).heightIn(min = 230.dp), ::requestDelete)
                    HorizontalDivider()
                    LabelControlBar(state, saveState)
                    LabelSegments(Panel.entries.map { it.title to it.title }, panel.title, { v -> panel = Panel.entries.first { it.title == v } })
                    Box(Modifier.fillMaxWidth().height(300.dp)) { PanelBody(state, panel, standard, ::requestDelete, { replacingPicture = true }) { confirmingStandard = true } }
                }
            }
        }
    }

    if (addingPicture) {
        LabelPictureSheet(model.layout.widthDots, model.layout.dpi, { addingPicture = false }) { bitmap, w, h, dither, threshold, source ->
            addingPicture = false
            model.addPicture(erp.core.logic.LabelEditing.makePicture(bitmap, w, h, dither, threshold, source, model.layout, model.measure))
        }
    }
    if (replacingPicture) {
        LabelPictureSheet(model.layout.widthDots, model.layout.dpi, { replacingPicture = false }) { bitmap, w, h, dither, threshold, source ->
            replacingPicture = false
            val id = model.primary?.id ?: return@LabelPictureSheet
            model.edit { l -> l.copy(fields = l.fields.map { if (it.id == id) it.copy(bitmap = bitmap, width = w, height = h, dither = dither, threshold = threshold, source = source) else it }) }
        }
    }
    if (addingCounter) CounterSheet({ start, step, pad -> model.add(LabelNewKind.Counter(start, step, pad)) }, { addingCounter = false })
    if (pickingVariable) PlaceholderSheet(model.layout.tagsPerLabel, "Variable text", { model.add(LabelNewKind.Variable(it)) }, { pickingVariable = false })
    if (confirmingDelete) LabelConfirm("Remove ${model.selection.size} fields?", "They are taken off the tag. You can undo it.", "Remove fields", { model.deleteSelection() }, { confirmingDelete = false })
    if (confirmingStandard) {
        LabelConfirm("Back to the standard tag?", "The tag on screen is replaced by the ERP’s standard one. You can undo it.", "Use the standard tag", {
            val s = standard.copy(printer = model.layout.printer)
            model.edit { s }
            model.clearSelection(); model.zoomFit()
        }, { confirmingStandard = false })
    }
    pendingImport?.let { l ->
        LabelConfirm("Replace this tag?", "The imported design takes the place of the tag on screen. You can undo it.", "Replace tag", {
            model.edit { l }
            model.clearSelection(); model.zoomFit()
            note.show(Note("Design imported", "${l.fields.size} fields from Label LIVE."))
        }, { pendingImport = null })
    }
    FailureAlert(problem, { problem = null })
}

@Composable
private fun VerticalRule() {
    Box(Modifier.width(1.dp).fillMaxHeight().background(MaterialTheme.colorScheme.outlineVariant))
}

@Composable
private fun PanelBody(state: DesignerState, panel: Panel, standard: LabelLayout, requestDelete: () -> Unit, replacePicture: () -> Unit, toStandard: () -> Unit) {
    when (panel) {
        Panel.Field -> LabelInspector(state, requestDelete, replacePicture)
        Panel.Layers -> LayersPanel(state)
        Panel.Label -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(20.dp)) {
            LabelSettingsSections(state)
            SettingsSection {
                LabelTapRow("Back to the standard tag", toStandard, enabled = !state.model.readOnly, icon = Icons.Filled.LocalOffer)
            }
            LabelCsvSection()
        }
        Panel.Preview -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(20.dp)) {
            LabelPreviewSections(state)
        }
    }
}
