package erp.app.screens.settings.label

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.Troubleshoot
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.device.TagPrinter
import erp.app.device.ZebraTransport
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.screens.settings.SettingsPage
import erp.app.screens.settings.SettingsSection
import erp.app.ui.FailureAlert
import erp.app.ui.LocalNoteState
import erp.app.ui.Note
import erp.app.ui.PickerRow
import erp.app.ui.SkeletonLoading
import erp.app.ui.TextRow
import erp.app.ui.Tone
import erp.app.ui.color
import erp.core.logic.TagMethod
import erp.core.logic.TagPrint
import erp.core.logic.TagRoute
import erp.core.models.LabelLayout
import erp.core.models.LabelPrinterSettings
import kotlinx.coroutines.launch

// Settings > Labels > Printer: how the shop's own tag (core's `Zpl`) reaches a Zebra without Label LIVE, on this phone
// (`TagPrinter.method` / `.route`), and the printer options that travel with the tag (`layout.printer`: media, darkness, speed,
// offsets, the same on every device, saved through `saveLabelLayout` by owners; staff read them). The iPhone's
// TagPrinterSettingsScreen.swift.
//
// Android sends to a Zebra's network address (raw TCP, port 9100). Zebra Browser Print and a Mac's printers are the Mac's, and
// Android has no CUPS, so they are not offered; Label LIVE through the Mac at the counter is the other way.

@Composable
fun TagPrinterSettings() {
    ScreenTitle("Printer")
    val book = LocalBook.current
    val session = LocalSession.current
    val note = LocalNoteState.current
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    LaunchedEffect(book) { book.settings.need() }
    val settings by book.settings.value.collectAsStateWithLifecycle()
    val saved = settings?.labelLayout?.takeIf { it.hasSize } ?: LabelLayout.standard
    val canEdit = session.isOwner

    var method by remember { mutableStateOf(TagPrinter.method) }
    val route0 = remember { TagPrinter.route }
    var host by remember { mutableStateOf(route0?.host ?: "") }
    var port by remember { mutableStateOf((route0?.port ?: 9100).toString()) }
    var layout by remember { mutableStateOf<LabelLayout?>(null) }
    var edited by remember { mutableStateOf(false) }
    var testing by remember { mutableStateOf(false) }
    var checking by remember { mutableStateOf(false) }
    var statusLine by remember { mutableStateOf<String?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }

    // The saved layout arrives (or changes on another device): show it unless it is being edited here.
    LaunchedEffect(saved, edited) { if (!edited) layout = saved }

    fun currentRoute(): TagRoute? {
        val h = host.trim()
        return if (h.isEmpty()) null else TagRoute(h, port.toIntOrNull()?.takeIf { it in 1..65535 } ?: 9100)
    }
    fun storeRoute() { TagPrinter.route = currentRoute() }

    fun edit(change: (LabelPrinterSettings) -> LabelPrinterSettings) {
        if (!canEdit) return
        val next = layout ?: return
        val p = change(next.effectivePrinter)
        layout = next.copy(printer = if (p.isEmpty) null else p)
        edited = true
    }

    ScreenActions {
        if (canEdit) {
            TextButton(
                onClick = {
                    val l = layout ?: return@TextButton
                    // `seq` makes each save its own, as the designer's does.
                    ErpApi.shared.enqueue(LabelLayout.saveOp, l.saveFields(), "Label layout")
                    edited = false
                    note.show(Note("Printer settings saved"))
                },
                enabled = edited,
            ) { Text("Save") }
        }
    }

    run {
        SettingsPage {
            SettingsSection(
                "Print with",
                "Label LIVE prints its own design through the Mac at the counter. The Zebra way draws the shop's tag and sends it to a Zebra on the network. This applies to this phone only.",
            ) {
                LabelSegments(
                    listOf(TagMethod.labelLive.raw to "Label LIVE", TagMethod.zebra.raw to "Zebra: the shop's tag"), method.raw,
                    { v -> method = TagMethod.of(v); TagPrinter.method = method },
                )
                if (method == TagMethod.labelLive) LabelTapRow("Label LIVE", { navigator.open("/app/label-live") }, icon = Icons.Filled.Print)
            }
            if (method == TagMethod.zebra) {
                SettingsSection(
                    "The Zebra",
                    "The Zebra's address is on its configuration label (hold Feed while it starts) or in its web page. Port 9100 is Zebra's raw port. The phone must be on the same Wi-Fi as the printer. To print without an address, use Label LIVE through the Mac at the counter.",
                ) {
                    TextRow("Address", host, { host = it; storeRoute() }, "192.168.1.50", keyboard = androidx.compose.ui.text.input.KeyboardType.Uri)
                    TextRow("Port", port, { port = it.filter(Char::isDigit).take(5); storeRoute() }, "9100", keyboard = androidx.compose.ui.text.input.KeyboardType.Number)
                }
                SettingsSection(footer = "A small tag: the shop's name, today's date and a QR of TEST, on the tag's size and the printer options below.") {
                    LabelTapRow(
                        if (testing) "Printing…" else "Test print",
                        {
                            val r = currentRoute() ?: return@LabelTapRow
                            testing = true
                            scope.launch {
                                val outcome = ZebraTransport.send(TagPrint.testZpl(session.shop.name, layout ?: saved), r)
                                testing = false
                                if (outcome.ok) note.show(Note("Test tag sent", outcome.message)) else problem = outcome.message
                            }
                        },
                        icon = Icons.Filled.Print, enabled = !testing && currentRoute() != null,
                    )
                    LabelTapRow(
                        if (checking) "Asking…" else "Check the printer",
                        {
                            val r = currentRoute() ?: return@LabelTapRow
                            checking = true
                            scope.launch {
                                statusLine = ZebraTransport.status(r) ?: "The printer didn't say. Some Zebras answer only on the network, and some not at all."
                                checking = false
                            }
                        },
                        icon = Icons.Filled.Troubleshoot, enabled = !checking && currentRoute() != null,
                    )
                    statusLine?.let {
                        Text(it, Modifier.fillMaxWidth().padding(16.dp), style = MaterialTheme.typography.bodyMedium, color = if (it == "Ready.") MaterialTheme.colorScheme.onSurfaceVariant else Tone.owed.color())
                    }
                }
            }
            val l = layout
            if (l == null) SkeletonLoading() else PrinterOptions(l.effectivePrinter, canEdit, ::edit)
        }
    }
    FailureAlert(problem, { problem = null }, "Not printed")
}

/** The printer options that travel with the tag: every Label LIVE mode and number. */
@Composable
private fun PrinterOptions(p: LabelPrinterSettings, canEdit: Boolean, edit: ((LabelPrinterSettings) -> LabelPrinterSettings) -> Unit) {
    val own = "" to "The printer's own"
    SettingsSection(
        "Media",
        if (canEdit) "\"The printer's own\" leaves the setting to the Zebra. Saved with the shop's tag, so every device prints the same." else "Only an owner changes these.",
    ) {
        PickerRow("Printing", p.thermal ?: "", listOf(own, "transfer" to "Thermal transfer (ribbon)", "direct" to "Direct thermal")) { v -> if (canEdit) edit { it.copy(thermal = v.ifEmpty { null }) } }
        PickerRow(
            "After each label", p.mode ?: "",
            listOf(own, "tear" to "Tear off", "peel" to "Peel off", "cutter" to "Cut", "rewind" to "Rewind", "delayed-cut" to "Delayed cut"),
        ) { v -> if (canEdit) edit { it.copy(mode = v.ifEmpty { null }) } }
        PickerRow("Label stock", p.media ?: "", listOf(own, "gap" to "Labels with gaps", "mark" to "Black mark", "continuous" to "Continuous")) { v -> if (canEdit) edit { it.copy(media = v.ifEmpty { null }) } }
    }
    SettingsSection("Print quality") {
        PrinterNumber("Darkness", p.darkness, 0..30, 15, canEdit) { v -> edit { it.copy(darkness = v) } }
        PrinterNumber("Speed (inches a second)", p.speed, 2..14, 4, canEdit) { v -> edit { it.copy(speed = v) } }
    }
    SettingsSection("Position, in dots") {
        PrinterNumber("Label top", p.labelTop, -120..120, 0, canEdit) { v -> edit { it.copy(labelTop = v) } }
        PrinterNumber("Label shift", p.labelShift, -9999..9999, 0, canEdit) { v -> edit { it.copy(labelShift = v) } }
        PrinterNumber("Tear-off adjust", p.tearOff, -120..120, 0, canEdit) { v -> edit { it.copy(tearOff = v) } }
        PrinterNumber("Home x", p.homeX, 0..9999, 0, canEdit) { v -> edit { it.copy(homeX = v) } }
        PrinterNumber("Home y", p.homeY, 0..9999, 0, canEdit) { v -> edit { it.copy(homeY = v) } }
    }
    SettingsSection("Direction") {
        PickerRow("Orientation", p.orientation ?: "", listOf(own, "normal" to "Normal", "inverted" to "Upside down")) { v -> if (canEdit) edit { it.copy(orientation = v.ifEmpty { null }) } }
        PickerRow(
            "Mirror", if (p.mirror == null) "" else if (p.mirror == true) "yes" else "no",
            listOf(own, "no" to "Off", "yes" to "Mirrored"),
        ) { v -> if (canEdit) edit { it.copy(mirror = if (v.isEmpty()) null else v == "yes") } }
    }
}

/** A number the printer may keep to itself: set with a stepper, or "The printer's own". */
@Composable
private fun PrinterNumber(title: String, value: Int?, range: IntRange, start: Int, canEdit: Boolean, set: (Int?) -> Unit) {
    if (value != null) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { LabelNumberRow(title, value, { if (canEdit) set(it) }, range = range) }
            if (canEdit) TextButton({ set(null) }, Modifier.padding(end = 8.dp)) { Text("Printer's own", style = MaterialTheme.typography.labelMedium) }
        }
    } else {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
            if (canEdit) TextButton({ set(start) }) { Text("Set") }
            else Text("The printer's own", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
