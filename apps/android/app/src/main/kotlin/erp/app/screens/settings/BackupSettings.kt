package erp.app.screens.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.FileUpload
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import erp.app.ui.Switch
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import erp.app.ui.ErpPullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.config.House
import erp.app.config.Prefs
import erp.app.data.Book
import erp.app.data.ErpApi
import erp.app.data.Shelf
import erp.app.data.Sort
import erp.app.device.openAddress
import erp.app.device.shareFile
import erp.app.ui.ActionRow
import erp.app.ui.FailureAlert
import erp.app.ui.LocalNoteState
import erp.app.ui.Note
import erp.app.ui.OwnerDeleteCodeSheet
import erp.app.ui.OwnerDeletion
import erp.app.ui.ShopDate
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.TwoLine
import erp.app.ui.ValueInput
import erp.app.ui.ValueRow
import erp.app.ui.ledgerRow
import erp.app.ui.theme.TabularDigits
import erp.core.ERPDate
import erp.core.Registry
import erp.core.models.Collections
import erp.core.models.Product
import java.io.File
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Settings → Backups (src/app/settings/backups/page.tsx): export, restore, and manage the shop's data.
 *
 * - Export Backup: the collections the page copies, each with how many records it holds (/api/app/backup), read one at
 *   a time and put together here as the page's own file (`{ exportedAt, collections, data }`), which its Restore reads.
 *   The file goes to the share sheet, to be saved to Files or sent. When it was last made is this phone's, as the page
 *   keeps its own per browser.
 * - Restore from Backup stays the ERP's page: it writes every record in a file over the live books, across every
 *   collection the file names, with no shared write behind it and no way back. Moved to the server it would be an Admin
 *   write past the Firestore rules that bound the browser's copy, so it is opened there.
 * - Sold Product Recovery: a sold piece found by its SKU or name and re-added to stock under a new SKU (/api/app/write
 *   `reAddSoldProduct`). The sold pieces are read only once a search is typed.
 * - Cloud Database Backups (PITR): Google's, opened in the Cloud Console.
 * - Danger Zone: the latest pieces deleted, behind the delete code (`deleteLatestProducts`).
 */
@Composable
fun BackupSettings() {
    SettingsOwnersOnly("Backups") { BackupPage() }
}

private const val LAST_EXPORT_KEY = "settings.backup.lastExport"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BackupPage() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val note = LocalNoteState.current

    var lastExport by remember { mutableStateOf(Prefs.string(LAST_EXPORT_KEY).orEmpty()) }
    var list by remember { mutableStateOf<BackupList?>(null) }
    var listError by remember { mutableStateOf<String?>(null) }
    var selected by remember { mutableStateOf<Set<String>>(emptySet()) }
    var exporting by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf(0f) }
    var file by remember { mutableStateOf<File?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    val sold = remember { Shelf(Collections.soldProducts, Registry.decoder(Product::class), { it.sku }, Sort.standard<Product> { it.sku }, Book.shared) }
    var search by remember { mutableStateOf("") }
    var recovering by remember { mutableStateOf<String?>(null) }

    var deleteCountText by remember { mutableStateOf("1") }
    var deletion by remember { mutableStateOf<OwnerDeletion?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }

    suspend fun loadList() {
        try {
            val next = BackupList.from(ErpApi.shared.get("/api/app/backup"))
            // Everything is chosen to begin with, as on the page.
            if (list == null) selected = next.collections.map { it.id }.toSet()
            list = next
            listError = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            listError = e.message ?: e.toString()
        }
    }
    LaunchedEffect(Unit) { loadList() }
    // Leaving resets the search's shelf: coming back asks again.
    DisposableEffect(sold) { onDispose { sold.reset() } }
    LaunchedEffect(search) { if (search.trim().isNotEmpty()) sold.need() }
    val soldItems by sold.items.collectAsStateWithLifecycle()
    val soldLoaded by sold.loaded.collectAsStateWithLifecycle()
    val soldError by sold.error.collectAsStateWithLifecycle()

    /** The page's file, a collection at a time, written to a file as it arrives (a whole shop is megabytes). */
    fun export() {
        val l = list
        if (l == null || selected.isEmpty()) { failure = "Select at least one collection."; return }
        val cols = l.collections.map { it.id }.filter { it in selected }
        exporting = true
        progress = 0f
        file = null
        scope.launch {
            try {
                val now = ERPDate.iso(Instant.now())
                val target = withContext(Dispatchers.IO) { File(File(context.cacheDir, "erp-settings").apply { mkdirs() }, SettingsFiles.safeName(l.fileName)) }
                val tmp = File(target.path + ".part")
                val out = withContext(Dispatchers.IO) { tmp.outputStream().buffered() }
                try {
                    out.write(BackupLogic.fileHead(now, cols).toByteArray(Charsets.UTF_8))
                    cols.forEachIndexed { i, c ->
                        val docs = ErpApi.shared.data("/api/app/backup?collection=$c", timeoutMs = 300_000)
                        if (!docs.startsWith("{")) throw ErpApi.Failure(0, "The ERP sent something that is not $c.")
                        withContext(Dispatchers.IO) {
                            out.write(BackupLogic.entryHead(c, i == 0).toByteArray(Charsets.UTF_8))
                            out.write(docs.toByteArray(Charsets.UTF_8))
                        }
                        progress = (i + 1).toFloat() / cols.size
                    }
                    withContext(Dispatchers.IO) { out.write(BackupLogic.FILE_TAIL.toByteArray(Charsets.UTF_8)) }
                } finally {
                    withContext(Dispatchers.IO) { out.close() }
                }
                withContext(Dispatchers.IO) { tmp.renameTo(target) || tmp.copyTo(target, overwrite = true).let { tmp.delete() } }
                file = target
                lastExport = now
                Prefs.putString(LAST_EXPORT_KEY, now)
                val total = BackupLogic.totalDocs(l.collections, selected)
                note.show(Note("Backup Downloaded", "${BackupLogic.grouped(total)} records across ${cols.size} collections."))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = "Export Failed: ${e.message ?: e}"
            }
            exporting = false
            progress = 0f
        }
    }

    fun reAdd(p: Product) {
        recovering = p.sku
        scope.launch {
            try {
                val out = ErpApi.shared.write("reAddSoldProduct", BackupLogic.reAddPayload(p.sku))
                val sku = (out["product"] as? Map<*, *>)?.get("sku") as? String
                note.show(Note("Product Restored", BackupLogic.reAddDetail(p.name, sku)))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = "Failed to restore product: ${e.message ?: e}"
            }
            recovering = null
        }
    }

    fun askToDelete() {
        val count = BackupLogic.deleteCount(deleteCountText)
        if (count <= 0) { failure = "Please enter a positive number."; return }
        deletion = OwnerDeletion(
            what = "Delete the latest $count products",
            detail = "This will permanently delete the $count most recently added products.",
            run = { code ->
                val out = ErpApi.shared.write("deleteLatestProducts", BackupLogic.deletePayload(count, code))
                val gone = (out["deleted"] as? Number)?.toInt() ?: 0
                note.show(Note("Success", "$gone latest products deleted."))
            },
        )
    }

    ErpPullToRefreshBox(isRefreshing = refreshing, onRefresh = { scope.launch { refreshing = true; loadList(); refreshing = false } }) {
        SettingsPage {
            // MARK: Export Backup
            val l = list
            SettingsSectionWith(
                "Export backup",
                {
                    Text("Download all your data as a JSON file you can store locally or import later.")
                    if (l != null) Text("${BackupLogic.grouped(BackupLogic.totalDocs(l.collections, selected))} records selected")
                    if (lastExport.isNotEmpty()) Text("Last export: ${ShopDate.say(lastExport, withTime = true)}")
                },
            ) {
                if (l == null) {
                    if (listError != null) ErrorishRow(listError!!)
                    else Column(Modifier.fillMaxWidth().ledgerRow()) { SkeletonLoading(compact = true) }
                } else {
                    ActionRow(
                        if (selected.size == l.collections.size) "Deselect all" else "Select all",
                        onClick = { selected = if (selected.size == l.collections.size) emptySet() else l.collections.map { it.id }.toSet() },
                        enabled = !exporting,
                    )
                    l.collections.forEach { c ->
                        CollectionRow(c, c.id in selected, !exporting) { on -> selected = if (on) selected + c.id else selected - c.id }
                    }
                    if (exporting) LinearProgressIndicator(progress = { progress }, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp))
                    ActionRow(
                        if (exporting) "Exporting… ${(progress * 100).toInt()}%" else "Download Backup",
                        onClick = { export() }, icon = Icons.Filled.FileUpload, enabled = !exporting && selected.isNotEmpty(),
                    )
                    file?.let { f -> ActionRow("Save or send ${f.name}", onClick = { shareFile(context, f, "application/json", f.name) }, icon = Icons.Filled.Share) }
                }
            }

            // MARK: Restore from Backup
            SettingsSection(
                "Restore from backup",
                "Upload a previously exported JSON backup. Documents are merged — existing records are updated, nothing is deleted. It writes over the live books, so it is done on the ERP’s own page.",
            ) {
                SettingsNavRow("Restore from Backup in the ERP", Icons.Filled.Restore, "/settings/backups?web=1")
            }

            // MARK: Sold Product Recovery
            SettingsSection("Sold product recovery", "Search for a sold product by its original SKU or name to re-add it to active inventory.") {
                ValueRow("Search") { ValueInput(search, { search = it }, "Search SKU or name of a sold item…", "Search SKU or name of a sold item") }
                if (search.trim().isNotEmpty()) {
                    val hits = remember(soldItems, search) { BackupLogic.soldHits(soldItems, search) }
                    if (!soldLoaded) Column(Modifier.fillMaxWidth().ledgerRow()) { SkeletonLoading(compact = true) }
                    else if (soldError != null && soldItems.isEmpty()) ErrorishRow(soldError!!)
                    else if (hits.isEmpty()) NoteRow("No sold products found matching your search.")
                    else hits.forEach { p ->
                        Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            TwoLine(p.name, Modifier.weight(1f), subtitle = p.sku)
                            if (recovering == p.sku) Column { SkeletonLoading(compact = true) }
                            else TextButton(onClick = { reAdd(p) }, enabled = recovering == null) {
                                Icon(Icons.Filled.AddCircle, contentDescription = null)
                                Text("  Re-Add")
                            }
                        }
                    }
                }
            }

            // MARK: Cloud Database Backups (PITR)
            SettingsSection(
                "Cloud database backups (PITR)",
                "Firestore’s Point-in-Time Recovery lets you restore to any minute in the last 7 days via the Google Cloud Console. Managed by Google Cloud.",
            ) {
                NoteRow("PITR must be enabled in your Firebase project. Restoration overwrites your current data — consult a developer before using it.")
                ActionRow("Open Firestore Console", onClick = { openAddress(context, android.content.Intent.ACTION_VIEW, BackupLogic.consoleUrl(House.firebaseProjectId)) }, icon = Icons.Filled.OpenInNew)
            }

            // MARK: Danger Zone
            SettingsSection("Danger zone", "Destructive actions that cannot be undone.") {
                ValueRow("Delete the latest N pieces (by highest SKU)") {
                    ValueInput(deleteCountText, { deleteCountText = it }, "1", "Number of pieces", keyboard = KeyboardType.Number)
                }
                val count = BackupLogic.deleteCount(deleteCountText)
                ActionRow(BackupLogic.deleteLabel(count), onClick = { askToDelete() }, icon = Icons.Filled.Delete, enabled = count > 0, tone = Tone.problem)
            }
        }
    }

    FailureAlert(failure, onDismiss = { failure = null }, title = "Could not do that")
    deletion?.let { d -> OwnerDeleteCodeSheet(d, onDismiss = { deletion = null }, onDone = {}) }
}

@Composable
private fun ErrorishRow(message: String) {
    Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.CloudOff, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun CollectionRow(c: BackupCollection, on: Boolean, enabled: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = 56.dp)
            .toggleable(value = on, enabled = enabled, role = Role.Switch, onValueChange = onChange)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(c.label, style = MaterialTheme.typography.bodyLarge)
            Text(c.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(BackupLogic.countText(c.count), style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
        Switch(checked = on, onCheckedChange = null, enabled = enabled)
    }
}
