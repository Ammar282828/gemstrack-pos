package erp.app.screens.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Engineering
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.People
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import erp.app.data.ErpApi
import erp.app.screens.marketing.MarketingActionBar
import erp.app.screens.marketing.MarketingErrorState
import erp.app.screens.marketing.MarketingPinned
import erp.app.ui.ErpPullToRefreshBox
import erp.app.ui.FailureAlert
import erp.app.ui.FigureRow
import erp.app.ui.FigureTile
import erp.app.ui.LedgerHeading
import erp.app.ui.LocalNoteState
import erp.app.ui.Note
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.ToggleRow
import erp.app.ui.color
import erp.app.ui.ledgerRow
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Settings → Data → Import the Taheri Software book (src/app/settings/import-taheri/page.tsx): the one-off migration from
 * the shop's previous app. The book is the extracted file the ERP ships (lib/import/taheri-book.json), as the page reads
 * it, so there is nothing to pick.
 *
 * Nothing is written until Import is pressed. The ERP says what it WOULD do against the books as they are now
 * (/api/app/write `importTaheriBook` with `preview`, lib/writes/taheri-book-import.ts): who is new, who is already here,
 * and the half-matches, each with the ledger its namesake carries. Half-matches are left out unless the shop says to add
 * them as separate records, as on the page. Import plans again on the ERP and refuses if anything changed since the
 * preview (its fingerprint); run again, it adds nobody. (TaheriBookImportSettings.swift.)
 */
@Composable
fun TaheriBookImportSettings() {
    SettingsOwnersOnly("Import Taheri Software book") { TaheriBookImportPage() }
}

@Composable
internal fun TaheriBookImportPage(initial: BookPreview? = null, initialDone: Pair<Int, Int>? = null) {
    val scope = rememberCoroutineScope()
    val note = LocalNoteState.current
    var preview by remember { mutableStateOf(initial) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // Half-matches are opt-in. The safe default is to leave the live book alone.
    var takeHalfMatches by remember { mutableStateOf(false) }
    var importing by remember { mutableStateOf(false) }
    var done by remember { mutableStateOf(initialDone) }
    var stopped by remember { mutableStateOf<String?>(null) }
    var confirming by remember { mutableStateOf(false) }

    val willAdd = preview?.adds(takeHalfMatches) ?: 0

    suspend fun look() {
        loading = true
        try {
            preview = BookPreview(ErpApi.shared.write("importTaheriBook", TaheriBookImportLogic.previewBody(UUID.randomUUID().toString())))
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val words = e.message ?: e.toString()
            if (preview == null) error = words else stopped = words
        }
        loading = false
    }

    fun runImport() {
        val p = preview ?: return
        importing = true
        scope.launch {
            try {
                val out = ErpApi.shared.write("importTaheriBook", TaheriBookImportLogic.importBody(p.fingerprint, takeHalfMatches))
                val added = TaheriBookImportLogic.added(out)
                done = added
                note.show(Note("Import finished", "${added.first} customers and ${added.second} karigars added."))
                look()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                stopped = e.message ?: e.toString()
                // A book changed since the preview is refused: look again, so the next Import is about what is there now.
                look()
            }
            importing = false
        }
    }

    LaunchedEffect(Unit) { if (preview == null) look() }

    val shown = preview
    MarketingPinned(
        bar = if (shown != null && done == null) {
            {
                MarketingActionBar(
                    "Import $willAdd", Icons.Filled.FileDownload, onClick = { confirming = true }, busy = importing,
                    enabled = !loading && willAdd != 0, summary = "${TaheriBookImportLogic.records(willAdd)} would be added",
                )
            }
        } else null,
    ) {
        ErpPullToRefreshBox(isRefreshing = loading && shown != null, onRefresh = { scope.launch { look() } }) {
            val problem = error
            if (shown == null && problem != null) {
                MarketingErrorState(problem) { scope.launch { look() } }
            } else {
                SettingsPage {
                    if (shown != null) {
                        FileSection(shown)
                        if (shown.halfMatches.isNotEmpty()) {
                            HalfMatchSection(shown, takeHalfMatches, enabled = !importing && done == null) { takeHalfMatches = it }
                        }
                        done?.let { (customers, karigars) ->
                            SettingsSection("Imported", footer = "Re-running now adds nobody — they all count as already here.") {
                                Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Filled.CheckCircle, null, Modifier.size(22.dp), tint = Tone.settled.color())
                                    Text("$customers customers and $karigars karigars added", style = MaterialTheme.typography.bodyLarge, color = Tone.settled.color())
                                }
                            }
                        }
                    } else if (problem == null) {
                        SettingsSection { Column(Modifier.fillMaxWidth().ledgerRow()) { SkeletonLoading(label = "Reading the book") } }
                    }
                }
            }
        }
    }

    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text("Import ${TaheriBookImportLogic.records(willAdd)}?") },
            text = { Text("They go into the live book. Anyone already here is skipped, and running it again adds nobody.") },
            confirmButton = { TextButton(onClick = { confirming = false; runImport() }) { Text("Import") } },
            dismissButton = { TextButton(onClick = { confirming = false }) { Text("Cancel") } },
        )
    }
    FailureAlert(stopped, onDismiss = { stopped = null }, title = "Import stopped")
}

// MARK: What is in the file

@Composable
private fun FileSection(p: BookPreview) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LedgerHeading("What is in the file", Modifier.padding(horizontal = 4.dp), trailing = p.source.ifEmpty { null })
        Tallies("Customers", Icons.Filled.People, p.count("customersNew"), p.count("customersSettled"), p.count("customersConflict"))
        Tallies("Karigars", Icons.Filled.Engineering, p.count("karigarsNew"), p.count("karigarsSettled"), p.count("karigarsConflict"))
        Text(
            "${p.customersInFile} customers and ${p.karigarsInFile} karigars. These go into the live book; nothing is written until you press Import, and anyone already here is skipped.",
            Modifier.padding(horizontal = 4.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun Tallies(title: String, icon: ImageVector, new: Int, here: Int, half: Int) {
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(title, style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Medium))
        }
        FigureRow(spacing = 10.dp) {
            FigureTile("New", "$new", Modifier.share())
            FigureTile("Already here", "$here", Modifier.share())
            FigureTile("Half-matches", "$half", Modifier.share(), tint = if (half > 0) Tone.owed.color() else androidx.compose.ui.graphics.Color.Unspecified)
        }
    }
}

// MARK: Half-matches

@Composable
private fun HalfMatchSection(p: BookPreview, take: Boolean, enabled: Boolean, onTake: (Boolean) -> Unit) {
    SettingsSection(
        "Half-matches",
        footer = "The name or the number is already here, but not both: usually the same person. Adding them makes a second copy without the ledger the first one carries, and the copy looks newer in a list. Usually the wrong thing.",
    ) {
        p.halfMatches.forEach { h ->
            Column(Modifier.fillMaxWidth().ledgerRow(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(h.name, style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(h.line, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        ToggleRow("Add these as separate records too", take, onTake, enabled = enabled)
    }
}
