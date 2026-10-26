package erp.app.screens.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Contacts
import androidx.compose.material.icons.filled.Engineering
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.NoteAdd
import androidx.compose.material.icons.filled.People
import erp.app.ui.Button
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import erp.app.data.ErpApi
import erp.app.ui.ActionRow
import erp.app.ui.FailureAlert
import erp.app.ui.FigureRow
import erp.app.ui.FigureTile
import erp.app.ui.LocalNoteState
import erp.app.ui.Note
import erp.app.ui.PickerRow
import erp.app.ui.Radius
import erp.app.ui.StatusBadge
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Settings → Import contacts (src/app/settings/contact-import/page.tsx): customers and karigars from a phone's address
 * book. The web reads an exported .vcf, and so does this (picked from the phone's files, the same file); on Android the
 * phone's own contacts can also be read directly (ContactsContract, after READ_CONTACTS is allowed) and sent as the
 * same text.
 *
 * Nothing is written until Import is pressed. The ERP reads the file first (/api/app/imports, lib/contacts/triage.ts)
 * and says what WOULD happen; the half-matches are the point of it: same name with a different number is usually one
 * person with a second phone, same number with a different name usually the same person written more fully. Both are
 * questions, answered here, and neither is safe to answer silently. Import sends the file again with the answers
 * (/api/app/write `importContacts`); the ERP reads it again against the book as it is then and refuses if anything the
 * answers were about has changed (the plan's fingerprint).
 *
 * The photos in an address book are left on the phone: the ERP reads only the names and numbers (lib/contacts/vcard.ts),
 * and a whole book's pictures would be megabytes to send for nothing.
 */
@Composable
fun ContactImportSettings() {
    SettingsOwnersOnly("Import contacts") { ContactImportPage() }
}

@Composable
internal fun ContactImportPage(initialAnswer: ContactPlanAnswer? = null) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val note = LocalNoteState.current

    var reading by remember { mutableStateOf(false) }
    var fileName by remember { mutableStateOf("") }
    var vcf by remember { mutableStateOf("") }
    var answer by remember { mutableStateOf(initialAnswer) }
    var error by remember { mutableStateOf<String?>(null) }
    var dropped by remember { mutableStateOf<Set<String>>(emptySet()) }
    var choices by remember { mutableStateOf(initialAnswer?.defaults ?: emptyMap()) }
    var importing by remember { mutableStateOf(false) }
    var stopped by remember { mutableStateOf<String?>(null) }

    val plan = answer?.plan
    val willAdd = plan?.let { ContactImportLogic.willAdd(it, dropped) } ?: 0
    val willResolve = plan?.let { ContactImportLogic.willResolve(it, choices) } ?: 0

    /** The plan for this text (a picked file's, or the phone's own contacts as one). */
    fun readText(label: String, text: String) {
        scope.launch {
            error = null; answer = null; dropped = emptySet(); choices = emptyMap()
            fileName = label
            reading = true
            try {
                if (!text.contains("BEGIN:VCARD")) {
                    error = "That does not look like a contacts file. Export a .vcf from your phone."
                    return@launch
                }
                val body = VCards.withoutMedia(text)
                val a = ContactPlanAnswer.from(ErpApi.shared.post("/api/app/imports", ContactImportLogic.planBody(body)))
                    ?: throw ErpApi.Failure(0, "The ERP's answer couldn't be read.")
                vcf = body
                choices = a.defaults
                answer = a
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.message ?: e.toString()
            } finally {
                reading = false
            }
        }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            val name = SettingsFiles.displayName(context, uri)
            val text = runCatching { SettingsFiles.text(context, uri) }.getOrNull()
            if (text == null) { error = "Could not read that file."; fileName = name } else readText(name, text)
        }
    }

    fun readPhone() {
        scope.launch {
            error = null
            if (!DeviceContacts.ensure(context)) {
                error = "Allow Contacts for this app in the phone's Settings to read them, or choose a .vcf file instead."
                return@launch
            }
            val text = try { DeviceContacts.vcf(context) } catch (e: CancellationException) { throw e } catch (e: Exception) { error = "Could not read this phone's contacts."; return@launch }
            readText("This phone's contacts", text)
        }
    }

    fun runImport() {
        val a = answer ?: return
        importing = true
        scope.launch {
            try {
                val out = ErpApi.shared.write("importContacts", ContactImportLogic.importBody(vcf, a.fingerprint, dropped, choices))
                val (title, detail) = ContactImportLogic.finished(out, a.plan.settled.size)
                note.show(Note(title, detail))
                answer = null; vcf = ""; fileName = ""; dropped = emptySet(); choices = emptyMap()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                stopped = e.message ?: e.toString()
            }
            importing = false
        }
    }

    Column(Modifier.fillMaxSize()) {
        SettingsPage(Modifier.weight(1f)) {
            SettingsSection(
                "Choose the file",
                "On Android: read this phone's contacts directly, or export a .vcf from Contacts and choose it here. Only entries marked TJ, HOM, TC or Karigar in the name are taken. The mark is stripped, so “Altaf TJ” is saved as Altaf. Nothing is written until you press Import.",
            ) {
                ActionRow("Read this phone's contacts", onClick = { readPhone() }, icon = Icons.Filled.Contacts, enabled = !reading && !importing)
                ActionRow(
                    if (fileName.isEmpty() || fileName == "This phone's contacts") "Choose a .vcf file" else fileName,
                    onClick = { picker.launch(arrayOf("text/x-vcard", "text/vcard", "text/directory", "text/plain", "application/octet-stream")) },
                    icon = Icons.Filled.NoteAdd, enabled = !reading && !importing,
                )
                if (reading) Column(Modifier.fillMaxWidth().ledgerRow()) { erp.app.ui.SkeletonLoading(compact = true) }
                error?.let { msg ->
                    Column(Modifier.fillMaxWidth().ledgerRow(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("Could not read that", style = MaterialTheme.typography.titleSmall, color = Tone.problem.color())
                        Text(msg, style = MaterialTheme.typography.bodyMedium, color = Tone.problem.color())
                    }
                }
            }

            if (plan != null) {
                // What would happen.
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    erp.app.ui.LedgerHeading("What would happen", Modifier.padding(horizontal = 16.dp))
                    FigureRow(spacing = 10.dp) {
                        FigureTile("Already saved", "${plan.summary.settled}", Modifier.share())
                        FigureTile("New", "$willAdd", Modifier.share())
                        FigureTile("Needs you", "${plan.summary.conflicts}", Modifier.share())
                    }
                    Text(ContactImportLogic.summaryLine(plan.summary), Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }

                if (plan.conflicts.isNotEmpty()) {
                    SettingsSection("Needs you", "Half-matches — the only kind that can go wrong. Anything you leave alone stays exactly as it is in the book.") {
                        plan.conflicts.forEach { c -> ConflictRow(c, choices[c.id] ?: "skip", !importing) { choices = choices + (c.id to it) } }
                    }
                }
                if (plan.fresh.isNotEmpty()) {
                    SettingsSection("New", "Nothing in the book matches these. Drop any you do not want.") {
                        plan.fresh.forEach { f ->
                            FreshRow(f, f.id in dropped, !importing) { dropped = if (f.id in dropped) dropped - f.id else dropped + f.id }
                        }
                    }
                }
                if (plan.settled.isNotEmpty()) {
                    SettingsSection("Already saved", "Name and number both match somebody you have. Skipped, no question asked.") {
                        NoteRow(ContactImportLogic.settledLine(plan.settled))
                    }
                }
            }
        }

        if (plan != null) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)
                    .background(ErpColors.card, RoundedCornerShape(Radius.card)).padding(horizontal = 16.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("$willAdd to add, $willResolve to resolve.", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Button(onClick = { runImport() }, enabled = !importing && (willAdd > 0 || willResolve > 0)) {
                    Icon(Icons.Filled.FileDownload, contentDescription = null, Modifier.size(18.dp))
                    Text("  Import")
                }
            }
        }
    }

    FailureAlert(stopped, onDismiss = { stopped = null }, title = "Import stopped")
}

@Composable
private fun ConflictRow(c: PendingContact, chosen: String, enabled: Boolean, onChoose: (String) -> Unit) {
    val target = c.matches[0]
    val opts = ContactImportLogic.options(c)
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("IN THE BOOK", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(target.name, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium))
                Text(ContactImportLogic.bookPhones(target), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("ON THE PHONE", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(c.name, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium))
                Text(c.phone ?: "no number", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Column(Modifier.alpha(if (enabled) 1f else 0.5f)) {
            PickerRow("Answer", chosen, opts.map { it.value to it.label }) { if (enabled) onChoose(it) }
        }
        opts.firstOrNull { it.value == chosen }?.let {
            Text(it.hint, Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun FreshRow(f: PendingContact, off: Boolean, enabled: Boolean, toggle: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().ledgerRow().alpha(if (off) 0.45f else 1f),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(if (f.kind == "karigar") Icons.Filled.Engineering else Icons.Filled.People, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                f.name, style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium, textDecoration = if (off) TextDecoration.LineThrough else null),
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Text(ContactImportLogic.freshPhones(f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        f.tags.forEach { StatusBadge(it.uppercase(), Tone.quiet) }
        IconButton(onClick = toggle, enabled = enabled) {
            Icon(if (off) Icons.Filled.Check else Icons.Filled.Close, if (off) "Put back" else "Drop", tint = if (off) Tone.settled.color() else MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
