package erp.app.screens.work

import erp.app.ui.icons.Symbols
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.firebase.firestore.AggregateSource
import erp.app.auth.LocalSession
import erp.app.config.Businesses
import erp.app.config.House
import erp.app.nav.LocalNavigator
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.tasks.await

/**
 * How many drafts the shop has, counted by Firestore without reading them (a draft with photos weighs a megabyte).
 * Asked when a New order or New sale opens; the form reads it for its quiet line ([DraftsNote]). (DraftsCount.swift.)
 */
object DraftsCount {
    private val _count = MutableStateFlow(0)
    val count: StateFlow<Int> = _count.asStateFlow()

    /** The business the count is of: a count from the one left is not shown in the next. */
    @Volatile private var business = ""

    suspend fun refresh() {
        val biz = Businesses.current
        if (House.isDemo) return
        val db = Businesses.firestore(biz) ?: return
        try {
            val snap = db.collection("drafts").count().get(AggregateSource.SERVER).await()
            _count.value = snap.count.toInt()
            business = biz.id
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // No line: the note simply is not shown.
        }
    }

    /** What the open business may say. */
    fun shown(n: Int): Int = if (business == House.id) n else 0
}

/**
 * On a blank New sale or New order, when there are drafts: one quiet line to Drafts (owner, 2026-10-25: a new form is
 * blank, and the unfinished ones are in Drafts). No modal, no prompt; gone as soon as something is typed. Owners only:
 * staff have no Firestore to read the drafts from.
 */
@Composable
fun DraftsNote(modifier: Modifier = Modifier) {
    val owner = LocalSession.current.isOwner
    val n = DraftsCount.shown(DraftsCount.count.collectAsStateWithLifecycle().value)
    if (!owner || n <= 0) return
    val nav = LocalNavigator.current
    Row(
        modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp).clickable(role = Role.Button) { nav.open("/drafts") }.padding(horizontal = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Symbols.ContentCopy, contentDescription = null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(DraftsNoteWords.say(n), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** The line's words. */
object DraftsNoteWords {
    fun say(n: Int): String = if (n == 1) "1 draft" else "$n drafts"
}
