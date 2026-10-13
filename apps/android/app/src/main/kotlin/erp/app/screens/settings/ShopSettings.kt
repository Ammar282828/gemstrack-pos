package erp.app.screens.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import erp.app.ErpApp
import erp.app.ui.FieldRow
import erp.app.ui.PickerRow
import erp.app.ui.ValueInput
import erp.app.ui.ValueRow
import erp.core.models.Settings
import kotlinx.coroutines.launch

/**
 * Settings → Shop (src/app/settings/page.tsx): the details printed on every invoice and order slip, the shop's mode and
 * style, and the next numbers. The counters are read here and never written from the phone: moving them is for a
 * change of system, in the ERP.
 */
@Composable
fun ShopSettings() {
    SettingsGate("Shop") { ShopForm(it) }
}

@Composable
internal fun ShopForm(settings: Settings) {
    val writer = rememberSettingsWriter()
    var draft by remember { mutableStateOf(ShopDraft.of(settings)) }
    // What the book last held for each text, so only what was typed is sent.
    var base by remember { mutableStateOf(ShopDraft.of(settings)) }

    fun commit() {
        val result = ShopLogic.commit(draft, base)
        if (result.error != null) {
            writer.error = result.error
            draft = draft.copy(name = base.name)
        }
        if (result.patch.isEmpty()) return
        val before = base
        base = result.next
        draft = result.next
        ErpApp.scope.launch {
            // Not taken: what was typed stays, and the next time it is left it is sent again.
            if (!writer.save(result.patch)) base = before
        }
    }
    val leave by rememberUpdatedState { commit() }

    LaunchedEffect(settings) {
        val fresh = ShopDraft.of(settings)
        draft = ShopLogic.sync(draft, base, fresh)
        base = fresh
        writer.settled()
    }
    DisposableEffect(Unit) { onDispose { leave() } }

    SettingsPage {
        SettingsSection("Shop details", "Printed at the top of every invoice and order slip.") {
            LeavingRow("Shop name", draft.name, { draft = draft.copy(name = it) }, "Shop name", { leave() }, KeyboardCapitalization.Words)
            LeavingRow("Contact", draft.contact, { draft = draft.copy(contact = it) }, "Phone or email", { leave() })
            Column(Modifier.fillMaxWidth()) {
                Text("Address", Modifier.padding(start = 16.dp, top = 12.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                FieldRow(
                    label = "Address", value = draft.address, onChange = { draft = draft.copy(address = it) },
                    modifier = Modifier.onFocusChanged { if (!it.isFocused) leave() },
                    singleLine = false, minLines = 1, maxLines = 4, capitalization = KeyboardCapitalization.Sentences,
                )
            }
        }

        SettingsSection("Appearance", "For every device that has not chosen its own, on the ERP’s web pages.") {
            PickerRow(
                "Shop mode", writer.pick("theme", ShopLogic.mode(settings.theme)),
                listOf("default" to "Light", "taheri" to "Dark"),
            ) { writer.choose("theme", it) }
            PickerRow(
                "Interface style", writer.pick("uiStyle", ShopLogic.style(settings.uiStyle)),
                listOf("standard" to "Standard", "glass" to "Liquid Glass"),
            ) { writer.choose("uiStyle", it) }
        }

        SettingsSection("Document numbering", "Changed only when moving from another system, in the ERP.") {
            ValueRow("Next invoice") { ReadOnly(ShopLogic.next("INV", settings.lastInvoiceNumber)) }
            ValueRow("Next order") { ReadOnly(ShopLogic.next("ORD", settings.lastOrderNumber)) }
            ValueRow("Next repair") { ReadOnly(ShopLogic.next("REP", settings.lastRepairNumber ?: 0)) }
            SettingsNavRow("Change numbering", path = "/settings?web=1")
        }

        SettingsErrorSection(writer)
    }
}

@Composable
internal fun ReadOnly(text: String) {
    Text(text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** A label with its words typed at the right edge; leaving the box sends what was typed. */
@Composable
private fun LeavingRow(
    label: String, value: String, onChange: (String) -> Unit, prompt: String, leave: () -> Unit,
    capitalization: KeyboardCapitalization = KeyboardCapitalization.None,
) {
    var had by remember { mutableStateOf(false) }
    ValueRow(label) {
        ValueInput(
            value, onChange, prompt, label, capitalization = capitalization,
            modifier = Modifier.onFocusChanged { if (it.isFocused) had = true else if (had) { had = false; leave() } },
        )
    }
}
