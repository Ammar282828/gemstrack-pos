package erp.app.screens.settings.label

import erp.app.ui.icons.Symbols
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.data.LocalBook
import erp.app.data.rememberShelfStatus
import erp.app.device.LabelLivePrinter
import erp.app.device.LabelPrintHistory
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.screens.settings.SettingsPage
import erp.app.screens.settings.SettingsSection
import erp.app.screens.settings.rememberSettingsWriter
import erp.app.ui.FailureAlert
import erp.app.ui.FieldRow
import erp.app.ui.LocalNoteState
import erp.app.ui.Note
import erp.app.ui.PickerRow
import erp.app.ui.Pill
import erp.app.ui.ShopDate
import erp.app.ui.TextRow
import erp.app.ui.ToggleRow
import erp.app.ui.Tone
import erp.core.logic.LabelLive
import erp.core.logic.LabelLiveConfig
import erp.core.logic.LabelValues
import erp.core.logic.labelLiveConfig
import kotlinx.coroutines.launch

// Settings > Labels > Label LIVE (the web's label-live-card.tsx, docs/features/label-live.md; the iPhone's
// LabelLiveSettingsScreen.swift): the link Label LIVE's Integrate > Copy URL gives for the design is pasted once; its design,
// printer, copies and variable names are read from it (core's `LabelLive.parseIntegrateURL`), each variable is paired with a
// piece's field, and the whole is saved in the shop's settings (`labelLive`, through /api/app/write `updateSettings`, the web
// card's shape), so every device prints the same tag. A test print, how this phone reaches Label LIVE, and what it printed
// lately.
//
// Label LIVE has no Android app (as it has none for the iPhone): a tag goes to it through its MQTT broker on the Mac at the
// counter, so this phone names that Mac. The `labellive://` link itself is only for a Mac; here it is carried in the message.

@Composable
fun LabelLiveSettings() = LabelLiveSettings(null)

/** [initial] is the set-up shown before the book has answered (the screenshots draw one). */
@Composable
internal fun LabelLiveSettings(initial: LabelLiveConfig?) {
    ScreenTitle("Label LIVE")
    val session = LocalSession.current
    val book = LocalBook.current
    val note = LocalNoteState.current
    val scope = rememberCoroutineScope()
    val writer = rememberSettingsWriter()
    LaunchedEffect(book) { book.settings.need() }
    val settings by book.settings.value.collectAsStateWithLifecycle()
    val products = rememberShelfStatus(book.products)
    val saved = settings?.labelLiveConfig
    var config by remember { mutableStateOf(initial) }
    var pasted by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var testing by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    var counterHost by remember { mutableStateOf(LabelLivePrinter.counterHost) }
    var history by remember { mutableStateOf(LabelPrintHistory.all()) }
    val owner = session.isOwner
    val changed = config != null && config != saved

    LaunchedEffect(saved) { if (config == null || !changed) config = saved }

    fun read() {
        val parsed = LabelLive.parseIntegrateURL(pasted)
        if (parsed == null) {
            problem = "That isn't a Label LIVE link. Copy it from the design's Data → Integrate."
            return
        }
        config = LabelLive.configFromIntegrate(parsed, config ?: saved)
        pasted = ""
        note.show(Note("Read ${parsed.variables.size} variable${if (parsed.variables.size == 1) "" else "s"} from ${parsed.design}"))
    }

    fun save() {
        val c = config ?: return
        saving = true
        scope.launch {
            val stored = LabelLive.toStored(c)
            val patch = mapOf(
                "labelLive" to mapOf(
                    "design" to stored.design, "printer" to stored.printer, "copies" to stored.copies.toInt(), "hideWindow" to stored.hideWindow,
                    "vars" to stored.vars.map { mapOf("name" to it.name, "field" to it.field) },
                ),
            )
            if (writer.save(patch)) note.show(Note("Label LIVE saved")) else problem = writer.error ?: "Not saved. Check the connection and try again."
            saving = false
        }
    }

    /** The newest piece in stock, or made-up values when the stock is empty: what the saved set-up prints. */
    fun testPrint() {
        val s = saved ?: return
        val cfg = settings ?: return
        testing = true
        scope.launch {
            val piece = products.items.lastOrNull()
            val outcome = if (piece != null) {
                LabelLivePrinter.print(listOf(piece), cfg, s, 1)
            } else {
                val sample: LabelValues = mapOf("sku" to "TEST-0001", "name" to "Test tag", "price" to "Rs 0", "qr" to "TEST-0001")
                LabelLivePrinter.send(LabelLive.printURL(s, listOf(sample), 1))
            }
            testing = false
            history = LabelPrintHistory.all()
            if (outcome.ok) note.show(Note(outcome.message)) else problem = outcome.message
        }
    }

    ScreenActions {
        if (owner) TextButton(onClick = ::save, enabled = changed && !saving && config?.design?.isNotBlank() == true) { Text(if (saving) "Saving…" else "Save") }
    }

    SettingsPage {
        SettingsSection(
            "The design's link",
            "In Label LIVE, open the tag's design, then Data → Integrate → Copy URL, and paste it here. The design must be pinned to Label LIVE's Home screen.",
        ) {
            FieldRow(
                "labellive://print?design=…", pasted, { pasted = it }, singleLine = false, minLines = 1, maxLines = 4, keyboard = KeyboardType.Uri, enabled = owner,
            )
            LabelTapRow("Read the link", ::read, enabled = pasted.isNotBlank() && owner)
        }
        val c = config
        if (c != null) {
            SettingsSection("Design", if (changed) "Save first: a test print prints what is saved, as every device will." else null) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Design", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                    Text(c.design, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Printer", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                    Text(c.printer.ifEmpty { "The design's last" }, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
                }
                LabelNumberRow("Copies", c.copies, { if (owner) config = c.copy(copies = it) }, range = 1..99)
                ToggleRow("Print without showing Label LIVE", c.hideWindow, { if (owner) config = c.copy(hideWindow = it) })
                val tags = LabelLive.tagsOf(c).count
                if (tags > 1) {
                    Text(
                        "$tags tags to a label: pieces fill them in turn, and a tag with no piece prints blank.",
                        Modifier.fillMaxWidth().padding(16.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                LabelTapRow(if (testing) "Printing…" else "Test print", ::testPrint, icon = Symbols.Print, enabled = !testing && !changed && saved != null)
            }
            SettingsSection(
                "Variables",
                "Each of the design's variables gets one of a piece's fields. A variable named after a tag CSV column gets exactly what the CSV writes.",
            ) {
                val options = listOf("" to "Nothing (blank)") + LabelLive.labelFields.map { it.key to "Piece: ${it.label}" } + LabelLive.csvFields.map { it.key to it.label }
                for (v in c.map.vars) {
                    PickerRow(v.name, v.field, options) { field -> if (owner) config = c.copy(map = c.map.with(v.name, field)) }
                }
            }
        }
        SettingsSection(
            "This phone",
            "Label LIVE has no Android app: tags go to it on the Mac at the counter. On that Mac, switch on MQTT in Label LIVE's settings; this phone must be on the same Wi-Fi. Use the Mac's address (like 192.168.1.20): a name ending in .local often does not resolve on Android.",
        ) {
            TextRow("Mac at the counter", counterHost, { counterHost = it; LabelLivePrinter.counterHost = it }, "192.168.1.20", keyboard = KeyboardType.Uri)
        }
        if (history.isNotEmpty()) {
            var confirming by remember { mutableStateOf(false) }
            SettingsSection("Printed on this phone") {
                history.take(20).forEach { e ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(e.sku, style = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace))
                            Text(e.message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            Text(ShopDate.say(e.timestamp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if (!e.ok) Pill("Not printed", tone = Tone.problem)
                        }
                    }
                }
                LabelTapRow("Clear the history", { confirming = true }, icon = Symbols.Delete, danger = true)
            }
            if (confirming) LabelConfirm(
                "Clear the print history?", "Only this phone's list of printed tags goes; nothing is printed or changed in the ERP.", "Clear",
                { LabelPrintHistory.clear(); history = emptyList() }, { confirming = false },
            )
        }
    }
    FailureAlert(problem, { problem = null })
}
