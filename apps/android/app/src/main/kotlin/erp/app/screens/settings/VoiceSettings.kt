package erp.app.screens.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.data.Book
import erp.app.data.Outbox
import erp.app.data.ErpApi
import erp.app.data.Shelf
import erp.app.screens.owner.OwnerText
import erp.app.ui.FailureAlert
import erp.app.ui.LocalNoteState
import erp.app.ui.Note
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.core.Container
import erp.core.Decodable
import erp.core.models.Collections
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Settings → Voice (src/app/settings/voice/page.tsx): whether the shop can talk to the book at all, and every name the
 * assistant has been taught. The second is the point: a household's nicknames are private, occasionally wrong, and the
 * shop must be able to see the list and take one back.
 *
 * The state is the ERP's own answer (/api/voice/status: the key lives on the server, so asking is the only honest way to
 * know). The names are Firestore `voice_aliases`, read live while this screen is open; "Forget" is /api/app/write
 * `forgetVoiceAlias` (lib/writes/voice-aliases.ts), with no delete code: it is a settings list. The page's line about the
 * microphone needing https is the browser's; the app's microphone is the phone's own.
 */
@Composable
fun VoiceSettings() {
    SettingsOwnersOnly("Voice") { VoiceSettingsPage() }
}

/** One name learned (store.ts `VoiceAlias`): what was heard, and who it means now. */
data class SettingsVoiceAlias(
    val id: String,
    val heard: String,
    val refName: String,
    /** "customer" or "karigar". */
    val kind: String,
    val uses: Int,
    val createdAt: String,
) {
    companion object : Decodable<SettingsVoiceAlias> {
        override fun fromMap(m: Map<String, Any?>): SettingsVoiceAlias {
            val c = Container(m)
            return SettingsVoiceAlias(
                id = c.string("id") ?: "", heard = c.string("heard", ""), refName = c.string("refName", ""),
                kind = c.string("kind", "customer"), uses = c.int("uses") ?: 1, createdAt = c.string("createdAt", ""),
            )
        }
    }
}

/** /api/voice/status: `ready`, and when not, why (no_credit, no_permission, not_configured, unreachable). */
data class SettingsVoiceStatus(val ready: Boolean, val reason: String?) {
    companion object {
        fun from(value: Any?): SettingsVoiceStatus {
            val m = (value as? Map<*, *>)?.entries?.associate { it.key.toString() to it.value } ?: emptyMap()
            val c = Container(m)
            val ready = c.bool("ready", false)
            // A reply with neither is this app refusing the request, not Google failing to answer.
            val reason = c.string("reason") ?: if (c.string("error") != null) "refused" else if (ready) null else "unreachable"
            return SettingsVoiceStatus(ready, reason)
        }
    }
}

object VoiceWords {
    fun problemTitle(reason: String?): String = when (reason) {
        "no_credit" -> "The Google Cloud account is out of credit"
        "no_permission" -> "This deployment cannot reach Gemini"
        "not_configured" -> "Voice is not set up on this deployment"
        "refused" -> "This app would not let the request through"
        else -> "Could not reach Gemini"
    }

    fun problemDetail(reason: String?): String = when (reason) {
        "no_credit" -> "Voice and the scanner bill to this shop’s Google Cloud account, and it has nothing left. Top it up and both start working again with no change here — there is no key to replace."
        "no_permission" -> "The app’s own service account is not allowed to call Vertex AI on this project. It needs the Vertex AI User role."
        "not_configured" -> "No Google Cloud project is configured for this build."
        "refused" -> "The voice routes asked for a signed-in owner and got nobody. Google was never contacted, so this is not an outage — it is the gate in front of it."
        else -> "Google did not answer. This is usually the connection rather than the setup; it will be rechecked shortly."
    }

    /** "Customer · corrected 3 times · 1 Oct 2026". */
    fun rowSub(a: SettingsVoiceAlias): String {
        var sub = if (a.kind == "karigar") "Karigar" else "Customer"
        if (a.uses > 1) sub += " · corrected ${a.uses} times"
        val day = OwnerText.shortDate(a.createdAt)
        if (day.isNotEmpty()) sub += " · $day"
        return sub
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun VoiceSettingsPage() {
    val aliases = remember { Shelf(Collections.voiceAliases, SettingsVoiceAlias, { it.id }, Comparator<SettingsVoiceAlias> { a, b -> b.createdAt.compareTo(a.createdAt) }, Book.shared) }
    val scope = rememberCoroutineScope()
    val note = LocalNoteState.current
    // null while the ERP is being asked.
    var ready by remember { mutableStateOf<Boolean?>(null) }
    var reason by remember { mutableStateOf<String?>(null) }
    var forgotten by remember { mutableStateOf(setOf<String>()) }
    var failure by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    suspend fun check() {
        try {
            val s = SettingsVoiceStatus.from(ErpApi.shared.get("/api/voice/status"))
            ready = s.ready
            reason = s.reason
        } catch (e: CancellationException) {
            throw e
        } catch (e: ErpApi.Failure) {
            ready = false
            reason = if (e.status == 401 || e.status == 403) "refused" else "unreachable"
        } catch (e: Exception) {
            ready = false
            reason = "unreachable"
        }
    }
    LaunchedEffect(Unit) { check() }
    DisposableEffect(aliases) {
        aliases.need()
        onDispose { aliases.reset() }
    }
    val items by aliases.items.collectAsStateWithLifecycle()
    val loaded by aliases.loaded.collectAsStateWithLifecycle()
    val error by aliases.error.collectAsStateWithLifecycle()

    // Not money: the name leaves the list at once; the Outbox tells the ERP (a 409 there means it was already gone).
    fun forget(a: SettingsVoiceAlias) {
        forgotten = forgotten + a.id
        note.show(Note("Forgotten", "“${a.heard}” no longer means ${a.refName}."))
        ErpApi.shared.enqueue("forgetVoiceAlias", mapOf("aliasId" to a.id), "Forget “${a.heard}”")
    }

    // A forget that failed for good puts the name back: the list is the ERP's again.
    val outboxFailure by Outbox.failure.collectAsStateWithLifecycle()
    LaunchedEffect(outboxFailure?.id) { forgotten = emptySet() }

    ErpPullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = { scope.launch { refreshing = true; check(); refreshing = false } },
    ) {
        SettingsPage {
            SettingsSection(footer = "Billed to this shop’s own Google Cloud account. There is no API key to keep.") {
                Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (ready == true) Icons.Filled.Mic else Icons.Filled.MicOff, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        when (ready) { null -> "Checking…"; true -> "Voice is ready"; false -> "Voice is not set up" },
                        style = MaterialTheme.typography.titleMedium,
                    )
                }
                if (ready == false) {
                    Column(Modifier.fillMaxWidth().ledgerRow(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(VoiceWords.problemTitle(reason), style = MaterialTheme.typography.titleSmall)
                        Text(
                            VoiceWords.problemDetail(reason) + " Everything else works meanwhile — every entry voice could make can still be made from the ordinary forms.",
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                NoteRow("Nothing spoken is written down until it has been read back and confirmed. When two people sound alike, it asks which rather than choosing.")
            }

            SettingsSection("Names it has learned", "Each one is a time it picked the wrong person and was told which was meant. It gets that name right from then on.") {
                if (!loaded) {
                    Column(Modifier.fillMaxWidth().ledgerRow()) { SkeletonLoading(compact = true) }
                } else if (error != null && items.isEmpty()) {
                    Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.CloudOff, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(error!!, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                } else if (items.none { it.id !in forgotten }) {
                    Text("Nothing learned yet.", Modifier.fillMaxWidth().ledgerRow(), color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    items.filter { it.id !in forgotten }.forEach { a -> AliasRow(a, false, false) { forget(a) } }
                }
            }
        }
    }

    FailureAlert(failure, onDismiss = { failure = null }, title = "Could not forget that")
}

@Composable
private fun AliasRow(a: SettingsVoiceAlias, busy: Boolean, anyBusy: Boolean, forget: () -> Unit) {
    Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("“${a.heard}”", Modifier.weight(1f, fill = false), style = MaterialTheme.typography.bodyLarge.copy(fontStyle = FontStyle.Italic), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Icon(Icons.Filled.ArrowForward, contentDescription = null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(a.refName, Modifier.weight(1f, fill = false), style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(VoiceWords.rowSub(a), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (busy) {
            Column(Modifier.padding(horizontal = 8.dp)) { SkeletonLoading(compact = true) }
        } else {
            IconButton(onClick = forget, enabled = !anyBusy) {
                Icon(Icons.Filled.Delete, "Forget", Modifier.size(22.dp), tint = Tone.problem.color())
            }
        }
    }
}
