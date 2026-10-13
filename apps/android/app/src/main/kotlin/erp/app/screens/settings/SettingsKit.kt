package erp.app.screens.settings

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.ErpApp
import erp.app.auth.LocalSession
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenTitle
import erp.app.ui.DividedColumn
import erp.app.ui.LedgerHeading
import erp.app.ui.NotAvailableState
import erp.app.ui.ShelfState
import erp.app.ui.Tone
import erp.app.ui.ToggleRow
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import erp.core.models.Settings
import java.io.File
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Saving from the settings screens: one call to the ERP (`updateSettings`), which keeps only the fields the phone may
 * change. A switch or a choice shows the new value at once and keeps it until the book answers with the change
 * ([settled]), so it never snaps back for the moment the round trip takes; a refusal puts it back and says why.
 */
@Stable
class SettingsWriter(private val scope: CoroutineScope) {
    var error by mutableStateOf<String?>(null)
    private val on = mutableStateMapOf<String, Boolean>()
    private val chosen = mutableStateMapOf<String, String>()

    /**
     * True when the ERP took it. `seq` is only here to make each save its own: the same switch turned on, off and on
     * again within half a minute must not look like one change sent twice (ErpApi names a write by its content).
     */
    suspend fun save(patch: Map<String, Any?>): Boolean {
        error = null
        return try {
            ErpApi.shared.write("updateSettings", payload(patch, UUID.randomUUID().toString()))
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message ?: e.toString()
            false
        }
    }

    fun isOn(key: String, stored: Boolean): Boolean = on[key] ?: stored

    fun set(key: String, value: Boolean) {
        on[key] = value
        scope.launch { if (!save(mapOf(key to value))) on.remove(key) }
    }

    fun pick(key: String, stored: String): String = chosen[key] ?: stored

    fun choose(key: String, value: String) {
        chosen[key] = value
        scope.launch { if (!save(mapOf(key to value))) chosen.remove(key) }
    }

    /** The book has answered: what it holds is true again. */
    fun settled() {
        on.clear()
        chosen.clear()
    }

    companion object {
        /** `updateSettings`'s fields, exactly the iPhone's `["patch": patch, "seq": uuid]`. */
        fun payload(patch: Map<String, Any?>, seq: String): Map<String, Any?> = mapOf("patch" to patch, "seq" to seq)
    }
}

@Composable
fun rememberSettingsWriter(): SettingsWriter = remember { SettingsWriter(ErpApp.scope) }

// The writer outlives the screen on purpose: a switch turned just before leaving is still sent (the app's scope).

/** A shop with no settings document yet reads as every field unset (the model is lenient: `{}` decodes). */
val BlankSettings: Settings by lazy { Settings.fromMap(emptyMap()) }

/**
 * The page every settings screen stands on: owners only, the settings document read live, the screen drawn from it once
 * it has arrived. A passing read error keeps the form that has already arrived; only no document at all is a failure.
 */
@Composable
fun SettingsGate(title: String, content: @Composable (Settings) -> Unit) {
    ScreenTitle(title)
    if (!LocalSession.current.isOwner) {
        NotAvailableState("Owners only", why = "Settings are the owners’.")
        return
    }
    val book = LocalBook.current
    LaunchedEffect(book) { book.settings.need() }
    val value by book.settings.value.collectAsStateWithLifecycle()
    val loaded by book.settings.loaded.collectAsStateWithLifecycle()
    val error by book.settings.error.collectAsStateWithLifecycle()
    ShelfState(loaded = loaded, error = if (value == null) error else null) {
        content(value ?: BlankSettings)
    }
}

/** A settings screen that is not drawn from the settings document: owners only, as every settings page is. */
@Composable
fun SettingsOwnersOnly(title: String, content: @Composable () -> Unit) {
    ScreenTitle(title)
    if (!LocalSession.current.isOwner) {
        NotAvailableState("Owners only", why = "Settings are the owners’.")
        return
    }
    content()
}

// MARK: Rows and sections

/** The scrolling page a settings form is: sections on the house ground. */
@Composable
fun SettingsPage(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
        content = content,
    )
}

/** A Form's Section: an optional heading, a card of rows with a hairline between them, an optional footnote. */
@Composable
fun SettingsSection(title: String? = null, footer: String? = null, content: @Composable () -> Unit) {
    SettingsSectionWith(title, footer?.let { { Text(it) } }, content)
}

@Composable
fun SettingsSectionWith(title: String? = null, footer: (@Composable () -> Unit)? = null, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (title != null) LedgerHeading(title, Modifier.padding(horizontal = 4.dp))
        Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(erp.app.ui.Radius.card)).background(ErpColors.card)) {
            DividedColumn(content = content)
        }
        if (footer != null) {
            androidx.compose.runtime.CompositionLocalProvider(
                androidx.compose.material3.LocalContentColor provides MaterialTheme.colorScheme.onSurfaceVariant,
            ) {
                androidx.compose.material3.ProvideTextStyle(MaterialTheme.typography.bodySmall) {
                    Column(Modifier.padding(horizontal = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) { footer() }
                }
            }
        }
    }
}

/** A row's icon the way the iPhone's Settings draws it: a white symbol on a small coloured square. */
@Composable
fun SettingsIcon(icon: ImageVector, color: Color, modifier: Modifier = Modifier) {
    Box(modifier.size(30.dp).clip(RoundedCornerShape(7.dp)).background(color), contentAlignment = Alignment.Center) {
        Icon(icon, contentDescription = null, Modifier.size(18.dp), tint = Color.White)
    }
}

/** The iPhone's system colours for the icons' squares. */
object SettingsColors {
    val blue = Color(0xFF007AFF)
    val red = Color(0xFFFF3B30)
    val green = Color(0xFF34C759)
    val purple = Color(0xFFAF52DE)
    val gray = Color(0xFF8E8E93)
    val indigo = Color(0xFF5856D6)
    val pink = Color(0xFFFF2D55)
    val teal = Color(0xFF30B0C7)
}

/** A row that opens another place, with its icon on a coloured square (the iPhone's `SettingsLinkRow`). */
@Composable
fun SettingsLinkRow(title: String, icon: ImageVector, color: Color, path: String) {
    val navigator = LocalNavigator.current
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button) { navigator.open(path) }.ledgerRow(),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SettingsIcon(icon, color)
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** A `NavigationLink` with a plain `Label`: an icon in the secondary ink, the words, and a chevron. */
@Composable
fun SettingsNavRow(title: String, icon: ImageVector? = null, path: String, sub: String? = null) {
    val navigator = LocalNavigator.current
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button) { navigator.open(path) }.ledgerRow(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) Icon(icon, contentDescription = null, Modifier.size(22.dp), tint = ErpColors.accent)
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (sub != null) Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** A switch that saves when it is turned. */
@Composable
fun SettingToggle(title: String, key: String, stored: Boolean, writer: SettingsWriter, detail: String? = null) {
    ToggleRow(title, writer.isOn(key, stored), { writer.set(key, it) }, sub = detail)
}

/** What went wrong with the last save, where the person is looking. */
@Composable
fun SettingsErrorSection(writer: SettingsWriter) {
    val message = writer.error ?: return
    SettingsSection { ErrorRow(message) }
}

@Composable
fun ErrorRow(message: String) {
    Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
        Icon(Icons.Filled.Warning, contentDescription = null, Modifier.size(20.dp), tint = Tone.problem.color())
        Text(message, style = MaterialTheme.typography.bodyMedium, color = Tone.problem.color())
    }
}

/** A line of explanation inside a card. */
@Composable
fun NoteRow(text: String, tone: Tone = Tone.quiet) {
    Text(
        text,
        Modifier.fillMaxWidth().ledgerRow(),
        style = MaterialTheme.typography.bodyMedium,
        color = if (tone == Tone.quiet) MaterialTheme.colorScheme.onSurfaceVariant else tone.color(),
    )
}

// MARK: Files

/** Files in and out of the settings screens: an import's file picked in the system's chooser, and a file the ERP made handed to the share sheet. */
object SettingsFiles {
    /** The picked file's text. */
    fun text(context: Context, uri: Uri): String =
        context.contentResolver.openInputStream(uri)?.use { String(it.readBytes(), Charsets.UTF_8) } ?: throw java.io.IOException("Could not open it.")

    /** The picked file's own name, else the last part of its address. */
    fun displayName(context: Context, uri: Uri): String {
        runCatching {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0)?.takeIf { it.isNotBlank() }?.let { return it }
            }
        }
        return uri.lastPathSegment?.substringAfterLast('/').orEmpty()
    }

    /** A file's name with no slashes or ".." in it, never empty (`save(_:named:)`). */
    fun safeName(name: String): String {
        val safe = name.replace("/", "-").replace("..", "-")
        return safe.ifEmpty { "file" }
    }

    /** The file written under its own name in the app's cache folder, for the share sheet. */
    fun save(context: Context, bytes: ByteArray, name: String): File {
        val dir = File(context.cacheDir, "erp-settings").apply { mkdirs() }
        return File(dir, safeName(name)).also { it.writeBytes(bytes) }
    }
}
