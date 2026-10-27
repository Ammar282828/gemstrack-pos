package erp.app.screens.settings

import erp.app.ui.icons.Symbols
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import erp.app.ErpApp
import erp.app.nav.ScreenActions
import erp.app.ui.ActionRow
import erp.app.ui.FullScreenSheet
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.TextRow
import erp.app.ui.TwoLine
import erp.app.ui.ledgerRow
import erp.core.models.Settings
import kotlinx.coroutines.launch

/**
 * Settings → Bank accounts (src/app/settings/payment-methods): the accounts shared with customers who pay by transfer.
 * Added, changed and removed here; the web's QR code and "Send to customer" stay on its page. Saved as the whole list,
 * in the shape the web stores.
 */
@Composable
fun BankAccountSettings() {
    SettingsGate("Bank accounts") { BankAccountsForm(it) }
}

@Composable
internal fun BankAccountsForm(settings: Settings) {
    val writer = rememberSettingsWriter()
    var editing by remember { mutableStateOf<BankAccountDraft?>(null) }
    // A removal asks first: customers pay into these accounts.
    var removing by remember { mutableStateOf<BankAccountDraft?>(null) }
    // The list as the person has left it, until the book answers with it.
    var shown by remember { mutableStateOf<List<BankAccountDraft>?>(null) }
    val accounts = shown ?: settings.paymentMethods.map { BankAccountDraft.of(it) }

    LaunchedEffect(settings) { shown = null; writer.settled() }

    suspend fun write(next: List<BankAccountDraft>): String? {
        val before = shown
        shown = next
        if (writer.save(mapOf("paymentMethods" to next.map { it.stored }))) return null
        shown = before
        return writer.error ?: "Not saved."
    }

    ScreenActions {
        IconButton(onClick = { editing = BankAccountDraft.new() }) { Icon(Symbols.Add, "Add account") }
    }

    SettingsPage {
        SettingsSection(footer = "Shared with customers who pay by transfer.") {
            if (accounts.isEmpty()) {
                Text("No bank accounts yet", Modifier.fillMaxWidth().ledgerRow(), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            accounts.forEach { a ->
                Row(
                    Modifier.fillMaxWidth().clickable(role = Role.Button) { editing = a }.ledgerRow(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
                ) {
                    TwoLine(a.bankName, Modifier.weight(1f), subtitle = listOf(a.accountName, a.accountNumber).filter { it.isNotEmpty() }.joinToString(" · "))
                    IconButton(onClick = { removing = a }) {
                        Icon(Symbols.Delete, "Remove ${a.bankName.ifEmpty { "account" }}", Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        SettingsErrorSection(writer)
    }

    removing?.let { gone ->
        AlertDialog(
            onDismissRequest = { removing = null },
            title = { Text(BankAccountDraft.removingTitle(listOf(gone.bankName))) },
            text = { Text("Customers paying by transfer will no longer be shown it.") },
            confirmButton = {
                TextButton(onClick = {
                    removing = null
                    val next = accounts.filter { it.id != gone.id }
                    ErpApp.scope.launch { write(next) }
                }) { Text("Remove", color = Tone.problem.color()) }
            },
            dismissButton = { TextButton(onClick = { removing = null }) { Text("Cancel") } },
        )
    }

    editing?.let { draft ->
        BankAccountSheet(
            draft = draft, isNew = accounts.none { it.id == draft.id },
            onCancel = { editing = null },
            save = { saved ->
                val next = accounts.toMutableList()
                val i = next.indexOfFirst { it.id == saved.id }
                if (i >= 0) next[i] = saved else next.add(saved)
                write(next)
            },
            done = { editing = null },
        )
    }
}

@Composable
private fun BankAccountSheet(
    draft: BankAccountDraft, isNew: Boolean, onCancel: () -> Unit,
    save: suspend (BankAccountDraft) -> String?, done: () -> Unit,
) {
    var d by remember { mutableStateOf(draft) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var menu by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    FullScreenSheet(
        title = if (isNew) "New bank account" else "Bank account",
        onCancel = onCancel,
        confirmText = "Save",
        confirmEnabled = !saving && d.valid,
        onConfirm = {
            scope.launch {
                saving = true
                error = null
                val said = save(d)
                if (said != null) error = said else done()
                saving = false
            }
        },
    ) {
        SettingsPage {
            SettingsSection(footer = "The bank, the account name and the number are needed.") {
                TextRow("Bank", d.bankName, { d = d.copy(bankName = it) }, "Bank", KeyboardCapitalization.Words)
                Box {
                    ActionRow("Choose from the list", onClick = { menu = true })
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        BankAccountDraft.banks.forEach { b ->
                            DropdownMenuItem(text = { Text(b) }, onClick = { menu = false; d = d.copy(bankName = b) })
                        }
                    }
                }
                TextRow("Account name", d.accountName, { d = d.copy(accountName = it) }, "Account name", KeyboardCapitalization.Words)
                TextRow("Account number", d.accountNumber, { d = d.copy(accountNumber = it) }, "Account number", keyboard = KeyboardType.Text)
                TextRow("IBAN", d.iban, { d = d.copy(iban = it) }, "Optional", KeyboardCapitalization.Characters)
            }
            error?.let { SettingsSection { ErrorRow(it) } }
        }
    }
}
