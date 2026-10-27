package erp.app.screens.design

import erp.app.ui.icons.Symbols
import erp.app.ui.SearchBarField
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import erp.app.config.House
import erp.app.device.shareBytes
import erp.app.screens.marketing.PostDraft
import erp.app.screens.marketing.MarketingPhotos
import erp.app.ui.ChipRow
import erp.app.ui.FilterChip
import erp.app.ui.FormSection
import erp.app.ui.FullScreenSheet
import erp.app.ui.ActionRow
import erp.app.ui.PickerRow
import erp.app.ui.RowAction
import erp.app.ui.SkeletonLoading
import erp.app.ui.SwipeActions
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.app.ui.NotAvailableState
import erp.app.ui.Radius
import erp.app.ui.theme.ErpColors
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** A device draft as a row: this screen's own, or an earlier Post a piece draft that opens as a design. */
class DesignDraftRow(
    val id: String,
    val title: String,
    val updated: Long,
    val thumb: ByteArray?,
    /** Set for an earlier Post a piece draft. */
    val old: PostDraft?,
)

/**
 * What the Saved shelf and the start screen read: the shop's designs (with the legacy saved ads through, for owner and marketing, as
 * the API sends them), their folders, and this phone's drafts.
 */
class DesignShelf {
    var items by mutableStateOf<List<DesignRecord>>(emptyList())
    var folders by mutableStateOf<List<DesignFolder>>(emptyList())
    var loaded by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var draftRows by mutableStateOf<List<DesignDraftRow>>(emptyList())

    suspend fun load() {
        if (House.isDemo) {
            val demo = DesignDemo.shelf()
            items = demo.items
            folders = demo.folders
            loaded = true
            return
        }
        try {
            val r = DesignRecords.list()
            items = r.items
            folders = r.folders
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (!loaded) error = e.message
        }
        loaded = true
    }

    suspend fun loadDrafts(context: Context) {
        val rows = withContext(Dispatchers.IO) {
            val out = ArrayList<DesignDraftRow>()
            for (d in runCatching { DesignDraftDisk.current(context).list() }.getOrDefault(emptyList())) {
                out.add(DesignDraftRow(d.id, d.title.ifEmpty { "Untitled design" }, d.updated, d.thumb, null))
            }
            for (o in runCatching { DesignDraftDisk.older(context).list() }.getOrDefault(emptyList())) {
                if (o.photos.isNotEmpty() || o.words.s("headline").isNotEmpty()) {
                    out.add(DesignDraftRow(o.id, o.title, o.updated, o.photos.firstOrNull()?.let { MarketingPhotos.decode(it.data, 120)?.let { b -> MarketingPhotos.jpeg(b, 120, 70) } }, o))
                }
            }
            out.sortedByDescending { it.updated }
        }
        draftRows = rows
    }

    suspend fun deleteDraft(context: Context, row: DesignDraftRow) {
        withContext(Dispatchers.IO) {
            if (row.old != null) DesignDraftDisk.older(context).remove(row.id) else DesignDraftDisk.current(context).remove(row.id)
        }
        loadDrafts(context)
    }

    fun folderName(id: String?): String? = folders.firstOrNull { it.id == id }?.name
}

// MARK: The shelf (saved-shelf.tsx)

private const val ALL = "__all"
private const val UNFILED = "__unfiled"
private const val DEVICE = "__device"
private const val ACCOUNT = "__account"

@Composable
fun DesignSavedView(
    shelf: DesignShelf,
    onOpen: (DesignRecord) -> Unit,
    onOpenDraft: (DesignDraftRow) -> Unit,
    /** Owner and marketing: the ads already in the ad account can be kept in a folder. */
    adsOk: Boolean = false,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var view by remember { mutableStateOf(ALL) }
    var q by remember { mutableStateOf("") }
    var detail by remember { mutableStateOf<DesignRecord?>(null) }
    var asking by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf<DesignFolder?>(null) }
    var folderText by remember { mutableStateOf("") }
    var deletingFolder by remember { mutableStateOf<DesignFolder?>(null) }
    var deletingDraft by remember { mutableStateOf<DesignDraftRow?>(null) }
    var deletingRecord by remember { mutableStateOf<DesignRecord?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { shelf.load(); shelf.loadDrafts(context) }

    val counts = shelf.items.groupingBy { it.folder ?: "" }.eachCount()
    val words = q.lowercase().split(' ').filter { it.isNotEmpty() }
    val shown = shelf.items.filter { i ->
        val inView = view == ALL || (if (view == UNFILED) i.folder == null else i.folder == view)
        val hay = "${i.name} ${i.fields["headline"] ?: ""} ${i.kind}".lowercase()
        inView && words.all { hay.contains(it) }
    }
    val folder = shelf.folders.firstOrNull { it.id == view }

    Column(Modifier.fillMaxSize()) {
        ChipRow {
            FilterChip("All", view == ALL, { view = ALL }, count = shelf.items.size)
            if ((counts[""] ?: 0) > 0) FilterChip("Unfiled", view == UNFILED, { view = UNFILED }, count = counts[""])
            for (f in shelf.folders) FilterChip(f.name, view == f.id, { view = f.id }, count = counts[f.id] ?: 0)
            FilterChip("On this phone", view == DEVICE, { view = DEVICE }, count = shelf.draftRows.size)
            if (adsOk) FilterChip("In the ad account", view == ACCOUNT, { view = ACCOUNT })
            FilterChip("New folder", false, { renaming = null; folderText = ""; asking = true })
        }
        SearchBarField(
            q, { q = it }, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), singleLine = true, placeholder = { Text("Find a design") },
            leadingIcon = { Icon(Symbols.Search, null) },
        )
        if (folder != null && view == folder.id) {
            Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { renaming = folder; folderText = folder.name; asking = true }) { Text("Rename folder") }
                TextButton(onClick = { deletingFolder = folder }) { Text("Delete folder", color = Tone.problem.color()) }
            }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                view == DEVICE -> {
                    if (shelf.draftRows.isEmpty()) NotAvailableState("No drafts on this phone", why = "A design is kept here as you make it, and for 30 days after.", icon = Symbols.Phone)
                    else LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(shelf.draftRows, key = { it.id }) { d ->
                            SwipeActions(
                                end = RowAction("Delete", Symbols.Delete, Tone.late) { deletingDraft = d },
                                onClick = { onOpenDraft(d) },
                            ) { Box(Modifier.fillMaxWidth().ledgerCard()) { DesignDraftLine(d) } }
                        }
                        item { Text("Earlier Post a piece drafts open here as designs.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                }
                view == ACCOUNT && adsOk -> DesignAccountAds(shelf.folders) { scope.launch { shelf.load() } }
                shelf.error != null -> NotAvailableState("Couldn’t read the shelf", why = shelf.error, icon = Symbols.Info)
                !shelf.loaded -> SkeletonLoading(Modifier.fillMaxSize(), label = "Opening the shelf")
                shown.isEmpty() -> NotAvailableState(
                    if (shelf.items.isEmpty()) "Nothing saved yet" else "Nothing here",
                    why = if (shelf.items.isEmpty()) "Save a design from the workspace and it waits here, in any folder you make." else "No design in this folder matches.",
                    icon = Symbols.Folder,
                )
                else -> BoxWithConstraints(Modifier.fillMaxSize()) {
                    val wide = maxWidth >= 840.dp
                    if (wide) {
                        // The iPad's shelf is a list; on a wide window the rows sit two to a line.
                        LazyVerticalGrid(
                            GridCells.Fixed(2), Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            gridItems(shown, key = { it.id }) { r -> RecordRow(r, onOpen = { detail = r }, onDelete = { deletingRecord = r }) }
                        }
                    } else {
                        LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            items(shown, key = { it.id }) { r -> RecordRow(r, onOpen = { detail = r }, onDelete = { deletingRecord = r }) }
                        }
                    }
                }
            }
        }
    }

    detail?.let { r ->
        DesignDetailSheet(r, shelf, onOpen = { rec -> detail = null; onOpen(rec) }, onChanged = { scope.launch { shelf.load() } }, onClose = { detail = null })
    }
    if (asking) {
        AlertDialog(
            onDismissRequest = { asking = false },
            title = { Text(if (renaming == null) "New folder" else "Rename folder") },
            text = { OutlinedTextField(folderText, { folderText = it }, label = { Text("Name") }, singleLine = true) },
            confirmButton = {
                TextButton(onClick = {
                    asking = false
                    val name = folderText.trim()
                    if (name.isNotEmpty()) scope.launch {
                        try {
                            val r = renaming
                            if (r != null) DesignRecords.renameFolder(r.id, name) else view = DesignRecords.createFolder(name).id
                            shelf.load()
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            problem = e.message
                        }
                    }
                }) { Text(if (renaming == null) "Make folder" else "Rename") }
            },
            dismissButton = { TextButton(onClick = { asking = false }) { Text("Cancel") } },
        )
    }
    deletingFolder?.let { f ->
        ConfirmDestructive("Delete the folder “${f.name}”?", "Its designs stay, unfiled.", "Delete folder", { deletingFolder = null }) {
            scope.launch {
                try { DesignRecords.deleteFolder(f.id); view = ALL; shelf.load() } catch (e: CancellationException) { throw e } catch (e: Exception) { problem = e.message }
            }
        }
    }
    deletingDraft?.let { d ->
        ConfirmDestructive("Delete this draft from this phone?", null, "Delete draft", { deletingDraft = null }) { scope.launch { shelf.deleteDraft(context, d) } }
    }
    deletingRecord?.let { r ->
        ConfirmDestructive("Delete “${r.name.ifEmpty { "this design" }}”?", "It is removed from the shop’s shelf.", "Delete", { deletingRecord = null }) {
            scope.launch {
                try { DesignRecords.delete(r.id); shelf.load() } catch (e: CancellationException) { throw e } catch (e: Exception) { problem = e.message }
            }
        }
    }
    erp.app.ui.FailureAlert(problem, onDismiss = { problem = null }, title = "Could not finish")
}

@Composable
private fun RecordRow(r: DesignRecord, onOpen: () -> Unit, onDelete: () -> Unit) {
    SwipeActions(
        end = RowAction("Delete", Symbols.Delete, Tone.late, onDelete),
        menu = listOf(RowAction("Details", Symbols.Info, Tone.quiet, onOpen)),
        onClick = onOpen,
    ) { Box(Modifier.fillMaxWidth().ledgerCard()) { DesignRecordLine(r) } }
}

/** A delete asks first (the iPhone's `confirmDestructive`): the words of what goes, and a red button. */
@Composable
fun ConfirmDestructive(title: String, message: String?, action: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = message?.let { { Text(it) } },
        confirmButton = { TextButton(onClick = { onDismiss(); onConfirm() }) { Text(action, color = Tone.problem.color()) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

// MARK: One design (saved-shelf.tsx DesignDialog)

@Composable
fun DesignDetailSheet(
    record: DesignRecord,
    shelf: DesignShelf,
    onOpen: (DesignRecord) -> Unit,
    onChanged: () -> Unit,
    onClose: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var picture by remember { mutableStateOf<ByteArray?>(null) }
    var name by remember { mutableStateOf(record.name) }
    var folder by remember { mutableStateOf(record.folder ?: "") }
    var problem by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf<String?>(null) }
    val thumb = rememberBitmap(remember(record.thumb) { DesignThumb.bytes(record.thumb) }, 400)
    val full = rememberBitmap(picture, 1200)

    LaunchedEffect(record.id) {
        picture = runCatching { DesignRecords.file(record.id, "image:" + record.master) }.getOrNull()
    }

    fun rename() {
        val clean = name.trim()
        if (clean.isEmpty() || clean == record.name) return
        scope.launch { try { DesignRecords.patch(record.id, name = clean); onChanged() } catch (e: CancellationException) { throw e } catch (e: Exception) { problem = e.message } }
    }

    FullScreenSheet(title = record.name, onCancel = { rename(); onClose() }, cancelText = "Done") {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Box(Modifier.fillMaxWidth().heightIn(min = 160.dp, max = 360.dp).clip(Radius.cardShape).background(ErpColors.card), contentAlignment = Alignment.Center) {
                when {
                    full != null -> DesignPicture(full, Modifier.fillMaxSize(), ContentScale.Fit, "The design")
                    thumb != null -> DesignPicture(thumb, Modifier.fillMaxSize(), ContentScale.Fit)
                    else -> SkeletonLoading(label = "Opening the picture")
                }
            }
            FormSection("Design") {
                OutlinedTextField(
                    name, { name = it }, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), label = { Text("Name") }, singleLine = true,
                )
                Text(
                    DesignKinds.label(record.kind) + " · " + record.pages.joinToString(", ") { it.label } + (if (record.scope == "ads") " · ads" else ""),
                    Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                PickerRow("Folder", folder, listOf("" to "Unfiled") + shelf.folders.map { it.id to it.name }) { now ->
                    folder = now
                    if (now != (record.folder ?: "")) scope.launch {
                        try { DesignRecords.patch(record.id, moveFolder = true, folder = now.ifEmpty { null }); onChanged() } catch (e: CancellationException) { throw e } catch (e: Exception) { problem = e.message }
                    }
                }
            }
            FormSection(
                "", footer = if (record.isLegacy) ({ Text("A saved ad from the earlier Studio. Saving it from the workspace keeps a design in its place.", Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }) else null,
            ) {
                if (record.canOpen) ActionRow("Open", { onClose(); onOpen(record) }, icon = Symbols.Folder)
                ActionRow("Share the picture", {
                    val data = picture ?: return@ActionRow
                    val safe = record.name.replace(Regex("[^A-Za-z0-9 _-]+"), "")
                    shareBytes(context, data, (safe.ifEmpty { "design" }) + ".jpg", "image/jpeg", record.name)
                }, icon = Symbols.Share, enabled = picture != null)
                ActionRow("Delete", { confirmDelete = true }, icon = Symbols.Delete, tone = Tone.problem)
            }
        }
        busy?.let { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { SkeletonLoading(label = it) } }
    }
    if (confirmDelete) {
        ConfirmDestructive("Delete “${record.name}”?", null, "Delete", { confirmDelete = false }) {
            busy = "Deleting…"
            scope.launch {
                try { DesignRecords.delete(record.id); onChanged(); onClose() } catch (e: CancellationException) { throw e } catch (e: Exception) { problem = e.message } finally { busy = null }
            }
        }
    }
    erp.app.ui.FailureAlert(problem, onDismiss = { problem = null }, title = "Could not finish")
}
