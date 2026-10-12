package erp.app.screens.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.config.House
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.rememberSingle
import erp.app.ui.LedgerHeading
import erp.app.ui.MinTouchTarget
import erp.app.ui.Radius
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import erp.app.ui.readableColumn
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.BreakIterator

/**
 * The team note (docs/decisions.md "Team note"; RootView.swift `TeamNotePresentation` / `TeamNoteEditor`): one
 * urgent note in `settings.teamNote`, at most 600 characters, that owners write through /api/app/write
 * (`updateSettings`) and everyone reads. It heads each tab's first screen and Search, never a pushed page.
 */
object TeamNote {
    const val LIMIT = 600

    /** `String.count`: characters as a reader counts them (an emoji or a letter with its accent is one). */
    fun count(text: String): Int {
        if (text.isEmpty()) return 0
        val it = BreakIterator.getCharacterInstance()
        it.setText(text)
        var n = 0
        while (it.next() != BreakIterator.DONE) n++
        return n
    }

    fun isOver(text: String): Boolean = count(text) > LIMIT

    /** What Save sends: the text with its outer whitespace and newlines gone. */
    fun trimmed(text: String): String = text.trim { it.isWhitespace() }

    fun canSave(text: String, loaded: Boolean, saving: Boolean, isOwner: Boolean): Boolean =
        loaded && !saving && isOwner && trimmed(text).isNotEmpty() && !isOver(text)

    /** The `updateSettings` write's fields: exactly the iPhone's `["patch": ["teamNote": value]]`. */
    fun payload(value: String): Map<String, Any?> = mapOf("patch" to mapOf("teamNote" to value))

    /** `(House.isDemo ? DemoTeamNote.text : nil) ?? settings.teamNote ?? ""`. */
    fun current(settingsNote: String?, demo: String?, isDemo: Boolean): String = (if (isDemo) demo else null) ?: settingsNote ?: ""
}

/** Demo edits stay on this phone; real notes always use the shared settings write. */
object DemoTeamNote {
    private val _text = MutableStateFlow<String?>(null)
    val text: StateFlow<String?> = _text.asStateFlow()
    fun set(value: String?) { _text.value = value }
}

/** The note as it stands now (the demo's own while it is the demo). */
@Composable
fun rememberTeamNote(): String {
    val book = LocalBook.current
    val settings by rememberSingle(book.settings)
    val demo by DemoTeamNote.text.collectAsStateWithLifecycle()
    return TeamNote.current(settings?.teamNote, demo, House.isDemo)
}

/**
 * The banner that heads a tab's first screen and Search: a pinned card of the note's first two lines, which opens
 * the whole note; an owner has a pencil to edit it. Draws nothing without a note. Place it above the screen's
 * content; a pushed page or a form never carries it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeamNoteBanner(modifier: Modifier = Modifier) {
    val session = LocalSession.current
    val text = rememberTeamNote()
    var reading by rememberSaveable { mutableStateOf(false) }
    var editing by rememberSaveable { mutableStateOf(false) }
    if (text.isNotEmpty()) {
        Row(
            modifier
                .fillMaxWidth()
                .background(ErpColors.ground)
                .padding(horizontal = 16.dp, vertical = 6.dp),
        ) {
            Row(
                Modifier.fillMaxWidth().height(IntrinsicSize.Min).clip(Radius.cardShape).background(ErpColors.card),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.width(3.dp).fillMaxHeight().padding(vertical = 12.dp).clip(CircleShape).background(ErpColors.accent))
                Column(
                    Modifier
                        .weight(1f)
                        .defaultMinSize(minHeight = MinTouchTarget)
                        .clickable(onClickLabel = "Opens the full team note", role = Role.Button) { reading = true }
                        .padding(start = 12.dp, top = 12.dp, bottom = 12.dp, end = if (session.isOwner) 0.dp else 12.dp),
                    verticalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.PushPin, contentDescription = null, Modifier.size(12.dp), tint = ErpColors.accent)
                        Text("Urgent note", style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold), color = ErpColors.accent)
                    }
                    Text(text, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                if (session.isOwner) {
                    IconButton(onClick = { editing = true }, Modifier.size(MinTouchTarget)) { Icon(Icons.Filled.Edit, "Edit note") }
                }
            }
        }
    }
    if (editing) TeamNoteEditor(onDismiss = { editing = false })
    if (reading) {
        ModalBottomSheet(onDismissRequest = { reading = false }, sheetState = rememberModalBottomSheetState(), containerColor = ErpColors.ground) {
            Column(Modifier.fillMaxWidth().padding(bottom = 16.dp)) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Urgent note", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                    TextButton(onClick = { reading = false }) { Text("Close") }
                }
                Text(
                    text,
                    Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).readableColumn().padding(20.dp),
                    style = MaterialTheme.typography.bodyLarge,
                )
            }
        }
    }
}

/** The owner's form for the note: write it, clear it. Anyone else can open it but not save (the server checks too). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeamNoteEditor(onDismiss: () -> Unit) {
    val book = LocalBook.current
    val session = LocalSession.current
    val settingsLoaded by book.settings.loaded.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { book.settings.need() }
    val current = rememberTeamNote()
    var text by rememberSaveable { mutableStateOf("") }
    var loaded by rememberSaveable { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    // Seed once the settings are in (the demo has none to wait for).
    LaunchedEffect(settingsLoaded, current) {
        if (!loaded && (House.isDemo || settingsLoaded)) {
            text = current
            loaded = true
        }
    }
    val count = TeamNote.count(text)
    val over = count > TeamNote.LIMIT

    fun save(value: String) {
        if (!session.isOwner || !loaded || saving) return
        saving = true
        failure = null
        scope.launch {
            try {
                if (House.isDemo) DemoTeamNote.set(value) else ErpApi.shared.write("updateSettings", TeamNote.payload(value))
                onDismiss()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = e.message ?: "Something went wrong. Try again."
            } finally {
                saving = false
            }
        }
    }

    Dialog(
        onDismissRequest = { if (!saving) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Surface(Modifier.fillMaxSize(), color = ErpColors.ground) {
            Column(Modifier.fillMaxSize().safeDrawingPadding()) {
                TopAppBar(
                    title = { Text("Urgent note") },
                    navigationIcon = { IconButton(onClick = onDismiss, enabled = !saving) { Icon(Icons.Filled.Close, "Cancel") } },
                    actions = {
                        TextButton(
                            onClick = { save(TeamNote.trimmed(text)) },
                            enabled = TeamNote.canSave(text, loaded, saving, session.isOwner),
                            modifier = Modifier.defaultMinSize(minHeight = MinTouchTarget),
                        ) { Text("Save") }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = ErpColors.ground),
                )
                Column(
                    Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().readableColumn().padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        LedgerHeading("Team note", Modifier.padding(horizontal = 4.dp))
                        OutlinedTextField(
                            value = text,
                            onValueChange = { text = it },
                            modifier = Modifier.fillMaxWidth(),
                            placeholder = { Text("What everyone needs to know") },
                            minLines = 4,
                            maxLines = 10,
                            enabled = !saving,
                        )
                        // The field never cuts the text; Save stays off until it fits, so say so rather than leave it grey.
                        Column(Modifier.padding(horizontal = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text("Visible to everyone until cleared.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(
                                if (over) "Keep it under ${TeamNote.LIMIT} characters: $count / ${TeamNote.LIMIT}" else "$count / ${TeamNote.LIMIT}",
                                style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits),
                                color = if (over) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    if (current.isNotEmpty()) {
                        Text(
                            "Clear note",
                            Modifier.fillMaxWidth().clip(Radius.cardShape).background(ErpColors.card)
                                .clickable(enabled = !saving, role = Role.Button) { save("") }
                                .defaultMinSize(minHeight = 56.dp).padding(horizontal = 16.dp, vertical = 16.dp),
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                    failure?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(horizontal = 4.dp)) }
                }
            }
        }
    }
}
