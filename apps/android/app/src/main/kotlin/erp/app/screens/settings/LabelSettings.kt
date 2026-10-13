package erp.app.screens.settings

import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.Canvas
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.LocalOffer
import androidx.compose.material.icons.filled.QrCode
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.ErpApp
import erp.app.data.Book
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.Single
import erp.app.data.rememberShelfStatus
import erp.app.device.shareFile
import erp.app.ui.ActionRow
import erp.app.ui.LocalNoteState
import erp.app.ui.NotAvailableState
import erp.app.ui.Note
import erp.app.ui.PickerRow
import erp.app.ui.ReadableColumn
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.TwoLine
import erp.app.ui.ValueInput
import erp.app.ui.ValueRow
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import erp.core.models.Collections
import java.time.Instant
import java.util.UUID
import kotlin.math.max
import kotlin.math.roundToInt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Stock › Labels (src/app/settings/printer/page.tsx; its address is still under Settings): the shop's tag, drawn and
 * edited field by field, and a piece's tag as the CSV a label app like WEPrint imports. Nothing here talks to a printer:
 * the layout is the shop's (settings `labelLayout`, the same on every device) and the CSV goes out through the share
 * sheet, to Files or straight to the printing app.
 *
 * - The layout is read live from the settings document and saved a second after the last change, as the page saves it
 *   (/api/app/write `saveLabelLayout`, lib/writes/label-layout.ts). One being edited is never replaced by the copy
 *   arriving from another device until it has been saved.
 * - With none saved the standard tag is shown, the ERP's own (/api/app/labels), and "Back to the standard tag" puts it back.
 * - The CSV is the ERP's (/api/app/labels, lib/label-csv.ts): the page's columns, at today's rates.
 * The page keeps a list of the pieces it exported on that computer; nothing reads it, so the phone keeps none.
 */
@Composable
fun LabelSettings() {
    SettingsOwnersOnly("Labels") { LabelDesigner() }
}

@Composable
private fun LabelDesigner() {
    val book = LocalBook.current
    val note = LocalNoteState.current
    val doc = remember { Single(Collections.settings, Collections.globalSettingsDoc, LabelDoc, Book.shared) }
    var standard by remember { mutableStateOf<LabelLayout?>(null) }
    var layout by remember { mutableStateOf<LabelLayout?>(null) }
    // Changed here and not yet saved: the copy from the books does not replace it.
    var edited by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }

    val docValue by doc.value.collectAsStateWithLifecycle()
    val docLoaded by doc.loaded.collectAsStateWithLifecycle()
    val docError by doc.error.collectAsStateWithLifecycle()
    val saved = docValue?.labelLayout

    fun adopt(next: LabelLayout?) {
        // A failed read is not "no saved layout": adopting the standard tag then would save it over the shop's own.
        if (edited || !docLoaded || (docError != null && docValue == null)) return
        if (next != null) layout = next else if (standard != null) layout = standard
    }

    suspend fun loadStandard() {
        try {
            standard = LabelLogic.standard(ErpApi.shared.get("/api/app/labels"))
            adopt(saved)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failure = e.message ?: e.toString()
        }
    }

    suspend fun save(next: LabelLayout) {
        saving = true
        try {
            ErpApi.shared.write("saveLabelLayout", LabelLogic.savePayload(next, UUID.randomUUID().toString()))
            if (layout == next) edited = false
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            note.show(Note("Layout not saved", "Check the connection; it will try again on the next change. ${e.message ?: e}", failed = true))
        }
        saving = false
    }

    DisposableEffect(doc) {
        doc.need()
        onDispose { doc.reset() }
    }
    LaunchedEffect(Unit) { loadStandard() }
    // Adopt the saved layout when it arrives (or changes on another device) unless one is being edited.
    LaunchedEffect(saved, docLoaded, standard) { adopt(saved) }
    // Saved a second after the last change.
    LaunchedEffect(layout) {
        val l = layout ?: return@LaunchedEffect
        if (!edited) return@LaunchedEffect
        delay(1000)
        save(l)
    }
    // A change made in the last second before leaving is saved rather than dropped with the timer.
    val latestLayout by rememberUpdatedState(layout)
    val latestEdited by rememberUpdatedState(edited)
    DisposableEffect(Unit) { onDispose { val l = latestLayout; if (latestEdited && l != null) ErpApp.scope.launch { save(l) } } }

    val l = layout
    when {
        l != null -> LabelForm(
            l, saved, standard, edited || saving,
            change = { edit -> layout?.let { layout = edit(it); edited = true } },
            products = rememberShelfStatus(book.products),
        )
        failure != null && standard == null && docLoaded && saved == null -> Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            NotAvailableState("Couldn't load the tag", why = failure, icon = Icons.Filled.LocalOffer)
            Button(onClick = { failure = null; doc.need(); ErpApp.scope.launch { loadStandard() } }) { Text("Try again") }
        }
        else -> SkeletonLoading()
    }
}

@Composable
internal fun LabelForm(
    l: LabelLayout, saved: LabelLayout?, standard: LabelLayout?, working: Boolean,
    change: ((LabelLayout) -> LabelLayout) -> Unit,
    products: erp.app.data.ShelfStatus<erp.core.models.Product>,
) {
    ReadableColumn(maxWidth = 720.dp) {
        SettingsPage {
            SettingsSection(
                "Tag builder",
                "Design the tag and export pieces to CSV for a label printing app like WEPrint. ${LabelLogic.saveStateText(working, false, saved != null)}".trim(),
            ) {
                Box(Modifier.fillMaxWidth().padding(12.dp)) { TagPreview(l) }
                if (saved != null && standard != null) ActionRow("Back to the standard tag", onClick = { change { standard } })
            }

            ExportSection(products)

            l.fields.forEach { f -> FieldSection(f, change) }

            SettingsSection(footer = "${l.name} · ${l.widthDots} × ${l.heightDots} dots") {
                ActionRow("Add Text Field", onClick = { change { it.copy(fields = it.fields + LabelField.new()) } }, icon = Icons.Filled.AddCircle)
            }
        }
    }
}

// MARK: Test & Export

@Composable
private fun ExportSection(products: erp.app.data.ShelfStatus<erp.core.models.Product>) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val note = LocalNoteState.current
    var search by remember { mutableStateOf("") }
    var picked by remember { mutableStateOf<erp.core.models.Product?>(null) }
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
                note.show(Note("CSV Exported", "Product details for ${p.sku} exported."))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                note.show(Note("CSV not made", e.message ?: e.toString(), failed = true))
            }
            making = false
        }
    }

    SettingsSection("Test and export", "Select a product to preview and export its data.") {
        val p = picked
        if (p != null) {
            ValueRow(p.name) { ReadOnly(p.sku) }
            ActionRow("Choose another piece", onClick = { picked = null; csv = null })
        } else {
            ValueRow("Search") {
                ValueInput(search, { search = it }, "Search by name or SKU...", "Search by name or SKU")
            }
            if (search.trim().isNotEmpty()) {
                if (!products.loaded) Column(Modifier.fillMaxWidth().ledgerRow()) { SkeletonLoading(compact = true) }
                else if (hits.isEmpty()) NoteRow("No products found.")
                hits.forEach { h ->
                    Box(Modifier.fillMaxWidth().clickable { picked = h; search = ""; csv = null }.ledgerRow()) { TwoLine(h.name, subtitle = h.sku) }
                }
            }
        }
        ActionRow(if (making) "Making…" else "Download CSV for Selected Product", onClick = { makeCsv() }, icon = Icons.Filled.FileDownload, enabled = picked != null && !making)
        csv?.let { f ->
            ActionRow("Save or send ${f.name}", onClick = { shareFile(context, f, "text/csv", f.name) }, icon = Icons.Filled.Share)
        }
    }
}

// MARK: Field Editor

@Composable
private fun FieldSection(f: LabelField, change: ((LabelLayout) -> LabelLayout) -> Unit) {
    val id = f.id
    fun edit(apply: (LabelField) -> LabelField) = change { LabelLogic.edit(it, id, apply) }
    SettingsSection(id) {
        ValueRow("X") { ValueInput(f.x.toString(), { v -> edit { it.copy(x = LabelLogic.dots(v)) } }, "0", "X", keyboard = KeyboardType.Number) }
        ValueRow("Y") { ValueInput(f.y.toString(), { v -> edit { it.copy(y = LabelLogic.dots(v)) } }, "0", "Y", keyboard = KeyboardType.Number) }
        ValueRow("Data") { ValueInput(f.data, { v -> edit { it.copy(data = v) } }, "Data", "Data") }
        ValueRow("Font Size") {
            // The page's `parseInt(value) || 20`.
            ValueInput((f.fontSize ?: 20).toString(), { v -> edit { it.copy(fontSize = LabelLogic.fontSize(v)) } }, "20", "Font Size", keyboard = KeyboardType.Number)
        }
        PickerRow("Rotation", f.rotation.toString(), listOf(0, 90, 180, 270).map { it.toString() to "$it°" }) { v -> edit { it.copy(rotation = v.toInt()) } }
        ActionRow("Remove field", onClick = { change { l -> l.copy(fields = l.fields.filter { it.id != id }) } }, tone = Tone.problem)
    }
}

// MARK: The preview

/**
 * The tag as the page's builder draws it: the dumbbell tag's two heads and the strip between them, and each field where
 * its dots put it, turned as it prints. The text shows as written ("SKU: {sku}"); the QR as a mark.
 */
@Composable
fun TagPreview(layout: LabelLayout, modifier: Modifier = Modifier) {
    val w = max(layout.widthDots, 1).toFloat()
    val h = max(layout.heightDots, 1).toFloat()
    val accent = ErpColors.accent
    BoxWithConstraints(
        modifier.fillMaxWidth().aspectRatio(w / h).clipToBounds().background(ErpColors.card).semantics { contentDescription = "Tag preview" },
    ) {
        val widthPx = with(LocalDensity.current) { maxWidth.toPx() }
        val s = widthPx / w
        // The Zebra tag's shape: heads 240 dots wide on an 83 mm tag, the strip 64 dots tall on a 37 mm one, stretched to
        // the layout's size as the page's outline is.
        Canvas(Modifier.matchParentSize()) {
            val head = w * 240 / 664 * s
            val strip = h * 64 / 296 * s
            val shade = accent.copy(alpha = 0.07f)
            val edge = accent.copy(alpha = 0.3f)
            val dash = Stroke(width = 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx())))
            val full = h * s
            for (x in listOf(0f, (w * s) - head)) {
                drawRect(shade, Offset(x, 0f), Size(head, full))
                drawRect(edge, Offset(x, 0f), Size(head, full), style = dash)
            }
            drawRect(shade, Offset(head, (full - strip) / 2f), Size(max(0f, w * s - 2 * head), strip))
        }
        layout.fields.forEach { f ->
            Box(
                Modifier
                    .offset { IntOffset((f.x * s).roundToInt(), (f.y * s).roundToInt()) }
                    .graphicsLayer { rotationZ = f.rotation.toFloat(); transformOrigin = TransformOrigin(0f, 0f) },
            ) {
                if (f.type == "qr") {
                    Icon(
                        Icons.Filled.QrCode, contentDescription = null,
                        Modifier.border(BorderStroke(1.dp, Color(0xFFAF52DE).copy(alpha = 0.7f)), RoundedCornerShape(2.dp)).padding(2.dp).size(22.dp),
                        tint = MaterialTheme.colorScheme.onSurface,
                    )
                } else {
                    val size = with(LocalDensity.current) { max(4f, (f.fontSize ?: 20) * s).toSp() }
                    Text(
                        f.data,
                        Modifier.border(BorderStroke(1.dp, Color(0xFF007AFF).copy(alpha = 0.7f)), RoundedCornerShape(2.dp)).padding(2.dp),
                        fontSize = size, maxLines = 1, softWrap = false, color = MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
        }
    }
}

