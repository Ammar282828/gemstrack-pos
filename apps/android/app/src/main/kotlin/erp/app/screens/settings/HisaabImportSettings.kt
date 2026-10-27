package erp.app.screens.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Engineering
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.NoteAdd
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import erp.app.ui.Button
import androidx.compose.material3.Icon
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.rememberShelf
import erp.app.screens.owner.OwnerText
import erp.app.ui.ActionRow
import erp.app.ui.FailureAlert
import erp.app.ui.FieldRow
import erp.app.ui.FullScreenSheet
import erp.app.ui.LocalNoteState
import erp.app.ui.Note
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.TabularDigits
import erp.core.logic.Money
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Settings → Import hisaab (src/app/settings/hisaab-import/page.tsx): one customer's or karigar's old ledger, from a CSV
 * such as Easy Khata exports, picked in the phone's files as the page takes the file.
 *
 * The ERP reads the file (/api/app/imports, lib/import/hisaab-csv.ts: the page's own columns, date formats and amounts)
 * and the rows are shown before anything is written. Import sends the file again for the person chosen (/api/app/write
 * `importHisaab`), and the ERP reads it again and refuses it while any row has a date that did not read or no amount, as
 * the page refuses it. The same file imported again for the same person writes over its own rows rather than adding the
 * ledger twice.
 */
@Composable
fun HisaabImportSettings() {
    SettingsOwnersOnly("Import hisaab") { HisaabImportPage() }
}

@Composable
internal fun HisaabImportPage(initialRead: HisaabRead? = null, initialPerson: HisaabPerson? = null, initialFile: String = "") {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val book = LocalBook.current
    val note = LocalNoteState.current
    val customers by rememberShelf(book.customers)
    val karigars by rememberShelf(book.karigars)
    val people = remember(customers, karigars) { HisaabImportLogic.people(customers, karigars) }

    var choosingPerson by remember { mutableStateOf(false) }
    var reading by remember { mutableStateOf(false) }
    var fileName by remember { mutableStateOf(initialFile) }
    var csv by remember { mutableStateOf(if (initialRead != null) "x" else "") }
    var read by remember { mutableStateOf(initialRead) }
    var error by remember { mutableStateOf<String?>(null) }
    var person by remember { mutableStateOf(initialPerson) }
    var importing by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    val rows = read?.rows.orEmpty()

    fun readText(name: String, text: String?) {
        error = null; read = null; csv = ""; fileName = name
        if (text == null) { error = "Could not read that file."; return }
        reading = true
        scope.launch {
            try {
                val r = HisaabRead.from(ErpApi.shared.post("/api/app/imports", HisaabImportLogic.planBody(text)))
                    ?: throw ErpApi.Failure(0, "The ERP's answer couldn't be read.")
                csv = text
                read = r
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.message ?: e.toString()
            }
            reading = false
        }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) readText(SettingsFiles.displayName(context, uri), runCatching { SettingsFiles.text(context, uri) }.getOrNull())
    }

    fun runImport() {
        val who = person
        if (who == null || rows.isEmpty() || csv.isEmpty()) { failure = "Please upload a valid file and select a person."; return }
        importing = true
        scope.launch {
            try {
                val out = ErpApi.shared.write("importHisaab", HisaabImportLogic.importBody(csv, who))
                note.show(Note("Import Complete", HisaabImportLogic.complete(out, rows.size)))
                read = null; csv = ""; fileName = ""; person = null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = e.message ?: e.toString()
            }
            importing = false
        }
    }

    SettingsPage {
        // MARK: Instructions & Required Format
        SettingsSection(
            "Instructions and required format",
            "Import historical transactions for a customer or karigar from a CSV file (e.g., exported from Easy Khata).",
        ) {
            Column(Modifier.fillMaxWidth().ledgerRow(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf(
                    "Your CSV file must contain the following exact column headers: Date, Details, Cash IN, Cash OUT.",
                    "The date format should be one of dd-MMM-yy, dd/MM/yyyy, or yyyy-MM-dd.",
                    "‘Cash IN’ represents money you received from the person.",
                    "‘Cash OUT’ represents money you gave to the person.",
                    "This tool does not support importing gold transactions. They must be added manually.",
                    "You can only import data for one person at a time. Upload a separate file for each person.",
                ).forEach { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }

        // MARK: 1. Upload CSV File
        SettingsSection("1. Upload the CSV file") {
            ActionRow(
                if (fileName.isEmpty()) "Choose File" else "Change File",
                onClick = { picker.launch(arrayOf("text/csv", "text/comma-separated-values", "application/csv", "text/plain", "application/vnd.ms-excel", "application/octet-stream")) },
                icon = Icons.Filled.NoteAdd, enabled = !reading && !importing,
            )
            if (reading) Column(Modifier.fillMaxWidth().ledgerRow()) { SkeletonLoading(compact = true) }
            if (fileName.isNotEmpty()) NoteRow(fileName)
        }

        // MARK: 2. Select Person to Import For
        SettingsSection("2. Choose who to import for") {
            Row(
                Modifier.fillMaxWidth().clickable(enabled = !importing, role = Role.Button) { choosingPerson = true }.ledgerRow(),
                horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
            ) {
                val p = person
                if (p != null) {
                    Icon(if (p.type == "karigar") Icons.Filled.Engineering else Icons.Filled.Person, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(p.name, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                } else {
                    Text("Select a customer or karigar...", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge, color = erp.app.ui.theme.ErpColors.accent)
                }
                Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }

        error?.let { msg ->
            SettingsSection {
                Column(Modifier.fillMaxWidth().ledgerRow(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Error Reading File", style = MaterialTheme.typography.titleSmall, color = Tone.problem.color())
                    Text(msg, style = MaterialTheme.typography.bodyMedium, color = Tone.problem.color())
                }
            }
        }

        // MARK: Preview Data
        if (rows.isNotEmpty()) {
            SettingsSection("Preview data (${rows.size} rows)") { rows.forEach { PreviewRow(it) } }
        }

        // MARK: Import
        SettingsSectionWith(
            footer = read?.refusal?.let { { Text(it, color = Tone.problem.color()) } },
        ) {
            Row(Modifier.fillMaxWidth().ledgerRow()) {
                Button(
                    onClick = { runImport() }, Modifier.fillMaxWidth(),
                    enabled = HisaabImportLogic.canImport(read, person, importing, error),
                ) {
                    Icon(Icons.Filled.FileDownload, contentDescription = null, Modifier.size(18.dp))
                    Text("  " + if (importing) "Importing ${rows.size} Transactions..." else "Import for ${person?.name ?: "..."}")
                }
            }
        }
    }

    if (choosingPerson) {
        PersonPicker(people, onCancel = { choosingPerson = false }) { person = it; choosingPerson = false }
    }
    FailureAlert(failure, onDismiss = { failure = null }, title = "Import stopped")
    LaunchedEffect(Unit) { book.customers.need(); book.karigars.need() }
}

@Composable
private fun PreviewRow(row: HisaabRow) {
    Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
        Icon(
            if (row.isValidDate) Icons.Filled.CheckCircle else Icons.Filled.Cancel, contentDescription = if (row.isValidDate) "Date read" else "Invalid date",
            Modifier.size(22.dp), tint = if (row.isValidDate) Tone.settled.color() else Tone.problem.color(),
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(row.description.ifEmpty { "—" }, style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(
                if (row.isValidDate) OwnerText.shortDate(row.date) else "Invalid Date", style = MaterialTheme.typography.bodySmall,
                color = if (row.isValidDate) MaterialTheme.colorScheme.onSurfaceVariant else Tone.problem.color(),
            )
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            if (row.cashIn != 0.0) Text("IN ${Money.pkr(row.cashIn)}", style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits))
            if (row.cashOut != 0.0) Text("OUT ${Money.pkr(row.cashOut)}", style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits))
            if (row.cashIn == 0.0 && row.cashOut == 0.0) Text("No amount", style = MaterialTheme.typography.bodySmall, color = Tone.problem.color())
        }
    }
}

/** The page's "Select a customer or karigar…", as a searchable list: a shop's book is too long for a menu. */
@Composable
private fun PersonPicker(people: List<HisaabPerson>, onCancel: () -> Unit, pick: (HisaabPerson) -> Unit) {
    var query by remember { mutableStateOf("") }
    val shown = remember(people, query) { HisaabImportLogic.shown(people, query) }
    FullScreenSheet(title = "Whose hisaab?", onCancel = onCancel) {
        Column(Modifier.fillMaxSize()) {
            FieldRow("Name", query, { query = it }, leading = Icons.Filled.Search)
            LazyColumn(Modifier.fillMaxSize()) {
                items(shown, key = { it.type + it.id }) { p ->
                    Row(
                        Modifier.animateItem().fillMaxWidth().clickable(role = Role.Button) { pick(p) }.ledgerRow(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(if (p.type == "karigar") Icons.Filled.Engineering else Icons.Filled.Person, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(p.name, Modifier.padding(0.dp), style = MaterialTheme.typography.bodyLarge)
                    }
                }
            }
        }
    }
}
