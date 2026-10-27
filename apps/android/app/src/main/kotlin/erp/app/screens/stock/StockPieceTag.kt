package erp.app.screens.stock

import erp.app.ui.icons.Symbols
import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.device.LabelLivePrinter
import erp.app.device.TagPrinter
import erp.app.device.shareBytes
import erp.app.device.shareFile
import erp.app.nav.LocalNavigator
import erp.app.screens.settings.LabelLogic
import erp.app.screens.settings.SettingsFiles
import erp.app.screens.settings.SettingsSection
import erp.app.screens.settings.label.LabelNumberRow
import erp.app.screens.settings.label.LabelSymbols
import erp.app.screens.settings.label.LabelTagPreview
import erp.app.screens.settings.label.LabelTapRow
import erp.app.ui.FailureAlert
import erp.app.ui.FullScreenSheet
import erp.app.ui.LocalNoteState
import erp.app.ui.Note
import erp.app.ui.Radius
import erp.app.ui.SkeletonLoading
import erp.app.ui.ToggleRow
import erp.app.ui.ValueRow
import erp.core.logic.TagJob
import erp.core.logic.TagMethod
import erp.core.logic.TagPrint
import erp.core.logic.Zpl
import erp.core.logic.labelLiveConfig
import erp.core.models.LabelLayout
import erp.core.models.Product
import java.io.ByteArrayOutputStream
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

// A piece's Print tag: the piece page's "Export & QR Code" (src/app/products/[sku]/page.tsx), and the print job for a few
// pieces' tags (the iPhone's StockPieceTag.swift and TagPrintJobSheet.swift). The QR its tag carries (the SKU at the high
// error correction the page draws it with), the shop's tag sent to a Zebra on the network or through Label LIVE, and the piece
// as the CSV a label app like WEPrint imports (/api/app/labels, the same text as the page's `generateProductCsv`).

/** The SKU as a QR code, drawn crisp at twelve pixels to a module with the four-module quiet zone, correction level H. */
fun qrPng(text: String): ByteArray? {
    val m = LabelSymbols.qr(text, "H") ?: return null
    val quiet = 4
    val unit = 12
    val side = (m.cols + 2 * quiet) * unit
    val bmp = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888)
    bmp.eraseColor(android.graphics.Color.WHITE)
    for (r in 0 until m.rows) for (c in 0 until m.cols) if (m.isDark(c, r)) {
        for (y in 0 until unit) for (x in 0 until unit) bmp.setPixel((c + quiet) * unit + x, (r + quiet) * unit + y, android.graphics.Color.BLACK)
    }
    return ByteArrayOutputStream().use { out -> bmp.compress(Bitmap.CompressFormat.PNG, 100, out); out.toByteArray() }
}

@Composable
fun StockPieceTagSheet(product: Product, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val book = LocalBook.current
    val note = LocalNoteState.current
    val navigator = LocalNavigator.current
    LaunchedEffect(book) { book.settings.need() }
    val settings by book.settings.value.collectAsStateWithLifecycle()
    var printing by remember { mutableStateOf(false) }
    var making by remember { mutableStateOf(false) }
    var csv by remember { mutableStateOf<java.io.File?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var jobOpen by remember { mutableStateOf(false) }
    val method = remember(jobOpen) { TagPrinter.method }
    val qr = remember(product.sku) { LabelSymbols.qr(product.sku, "H") }

    FullScreenSheet(title = "Print tag", onCancel = onDismiss) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            SettingsSection("QR code", "The QR holds the SKU, as the tag's does: Scan finds the piece by it.") {
                Column(Modifier.fillMaxWidth().padding(vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (qr != null) {
                        // A QR reads dark on light, whatever the phone's own look.
                        Canvas(
                            Modifier.size(180.dp).clip(RoundedCornerShape(Radius.thumb)).background(Color.White).padding(10.dp)
                                .semantics { contentDescription = "QR Code for ${product.sku}" },
                        ) {
                            val u = size.width / qr.cols
                            for (r in 0 until qr.rows) {
                                var c = 0
                                while (c < qr.cols) {
                                    if (qr.isDark(c, r)) {
                                        var end = c
                                        while (end < qr.cols && qr.isDark(end, r)) end += 1
                                        drawRect(Color.Black, Offset(c * u, r * u), Size((end - c) * u + 0.25f, u + 0.25f))
                                        c = end
                                    } else c += 1
                                }
                            }
                        }
                    } else {
                        StockInitial(product.name)
                    }
                    if (product.name.isNotEmpty()) Text(product.name, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold), textAlign = TextAlign.Center)
                    Text(product.sku, style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                LabelTapRow("Save, send or print the QR", {
                    qrPng(product.sku)?.let { shareBytes(context, it, "${product.sku}-qr.png", "image/png", "QR code for ${product.sku}") }
                }, icon = Symbols.Share, enabled = qr != null)
            }

            if (method == TagMethod.zebra) {
                SettingsSection(footer = "Sends the shop's tag for this piece to the Zebra, at today's rates.") {
                    LabelTapRow("Print tag…", { jobOpen = true }, icon = Symbols.Print)
                    LabelTapRow("Printer", { onDismiss(); navigator.open("/app/tag-printer") }, icon = Symbols.Print)
                }
            } else if (settings?.labelLiveConfig != null) {
                SettingsSection(footer = "Sends this piece's tag to Label LIVE at the counter, at today's rates.") {
                    LabelTapRow(if (printing) "Printing…" else "Print with Label LIVE", {
                        val s = settings ?: return@LabelTapRow
                        val config = s.labelLiveConfig ?: return@LabelTapRow
                        printing = true
                        scope.launch {
                            val outcome = LabelLivePrinter.print(listOf(product), s, config)
                            printing = false
                            if (outcome.ok) note.show(Note("Tag sent", outcome.message)) else problem = outcome.message
                        }
                    }, icon = Symbols.Print, enabled = !printing)
                }
            } else {
                SettingsSection(footer = "Paste the design's link once in Settings, and tags print from here.") {
                    LabelTapRow("Set up Label LIVE", { onDismiss(); navigator.open("/app/label-live") }, icon = Symbols.Print)
                }
            }

            SettingsSection(footer = "Use CSV to import into a label printing app like WEPrint.") {
                LabelTapRow(if (making) "Making…" else "Export CSV for this piece", {
                    making = true
                    scope.launch {
                        try {
                            val text = ErpApi.shared.data("/api/app/labels", "POST", mapOf("sku" to product.sku))
                            csv = SettingsFiles.save(context, text.toByteArray(Charsets.UTF_8), LabelLogic.csvName(Instant.now()))
                            note.show(Note("CSV ready", "CSV file for ${product.name.ifEmpty { product.sku }} is ready."))
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            note.show(Note("The CSV wasn't made", e.message ?: e.toString(), failed = true))
                        }
                        making = false
                    }
                }, icon = Symbols.Download, enabled = !making)
                csv?.let { f -> LabelTapRow("Save or send the CSV", { shareFile(context, f, "text/csv", f.name) }, icon = Symbols.Share) }
            }
        }
    }
    if (jobOpen) TagPrintJobSheet(listOf(product), { jobOpen = false }) { message -> note.show(Note("Tag sent", message)) }
    FailureAlert(problem, { problem = null }, "The tag wasn't printed")
}

// MARK: The print job

/**
 * The print job for a few pieces' tags (Stock's selection, a piece's tag sheet): which pieces, how many copies of each, how
 * many blank labels to pass over on a part-used roll, where a `{counter}` starts, what that makes in labels, and where it goes
 * (Settings > Labels > Printer). Print hands the job to `TagPrinter.print`, which branches on this phone's method (Label LIVE,
 * or the shop's tag as ZPL straight to a Zebra).
 */
@Composable
fun TagPrintJobSheet(initial: List<Product>, onDismiss: () -> Unit, onPrinted: (String) -> Unit = {}) {
    val book = LocalBook.current
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    LaunchedEffect(book) { book.settings.need() }
    val settings by book.settings.value.collectAsStateWithLifecycle()
    var pieces by remember { mutableStateOf(initial) }
    var copies by remember { mutableStateOf(1) }
    var skip by remember { mutableStateOf(0) }
    var useCounter by remember { mutableStateOf(false) }
    var counterStart by remember { mutableStateOf(1) }
    var printing by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val method = remember { TagPrinter.method }
    val zebra = method == TagMethod.zebra
    val layout = settings?.labelLayout?.takeIf { it.hasSize } ?: LabelLayout.standard
    val usesCounter = layout.fields.any { (it.data ?: "").contains("{counter") }
    val labels = Zpl.labelCount(pieces.size, layout)

    FullScreenSheet(
        title = if (pieces.size == 1) "Print tag" else "Print ${pieces.size} tags", onCancel = onDismiss,
        confirmText = if (printing) "Printing…" else "Print", confirmEnabled = pieces.isNotEmpty() && !printing && settings != null,
        onConfirm = {
            val s = settings ?: return@FullScreenSheet
            printing = true
            scope.launch {
                val job = TagJob(copies, if (zebra) skip else 0, if (zebra && usesCounter && useCounter) counterStart else null)
                val outcome = TagPrinter.print(pieces, s, job)
                printing = false
                if (outcome.ok) { onPrinted(outcome.message); onDismiss() } else problem = outcome.message
            }
        },
    ) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            SettingsSection("Pieces · ${pieces.size}") {
                pieces.forEach { p ->
                    Row(Modifier.fillMaxWidth().padding(start = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f).padding(vertical = 10.dp)) {
                            Text(p.name.ifEmpty { p.sku }, maxLines = 1, style = MaterialTheme.typography.bodyLarge)
                            if (p.name.isNotEmpty()) Text(p.sku, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        IconButton({ pieces = pieces.filter { it.sku != p.sku } }) { Icon(Symbols.Close, "Remove ${p.sku}", tint = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                }
                if (pieces.isEmpty()) Text("No pieces left to print.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            SettingsSection(
                "How many",
                if (zebra) {
                    val per = layout.tagsPerLabel
                    "${labels * copies} label${if (labels * copies == 1) "" else "s"}${if (skip > 0) ", after $skip blank" else ""}" +
                        (if (per > 1) ". $per tags to a label: pieces fill them in turn." else ".")
                } else "Label LIVE counts the labels in its own design.",
            ) {
                LabelNumberRow("Copies of each", copies, { copies = it }, range = 1..(if (zebra) 9999 else 99))
                if (zebra) {
                    LabelNumberRow("Blank labels first", skip, { skip = it }, range = 0..999)
                    if (usesCounter) {
                        ToggleRow("Start the counter at a number", useCounter, { useCounter = it })
                        if (useCounter) LabelNumberRow("Counter starts at", counterStart, { counterStart = it }, range = 0..999_999)
                    }
                }
            }
            if (zebra && pieces.isNotEmpty()) {
                SettingsSection("First label", "A rough picture: fonts and the barcode are the printer's.") {
                    val s = settings
                    val group = pieces.take(layout.tagsPerLabel)
                    val values = remember(group, s) { if (s == null) emptyList() else TagPrint.values(group, s) }
                    Box(Modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) {
                        if (s == null) SkeletonLoading(compact = true)
                        else LabelTagPreview(layout, values, counterStart = if (useCounter && usesCounter) counterStart else null)
                    }
                }
            }
            SettingsSection("Printer") {
                ValueRow("Print with") { Text(methodWords(method), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, textAlign = TextAlign.End) }
                LabelTapRow("Printer settings", { onDismiss(); navigator.open("/app/tag-printer") }, icon = Symbols.Print)
            }
        }
    }
    FailureAlert(problem, { problem = null }, "The tags weren't printed")
}

private fun methodWords(method: TagMethod): String = when (method) {
    TagMethod.labelLive -> "Label LIVE"
    TagMethod.zebra -> TagPrinter.route?.host ?: "Zebra (not chosen yet)"
}
