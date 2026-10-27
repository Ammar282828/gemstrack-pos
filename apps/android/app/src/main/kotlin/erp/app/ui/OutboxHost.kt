package erp.app.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.data.Outbox

/**
 * At the root (AppShell): what the Outbox could not save, said once for the whole app with Retry, and a finished
 * post's words as the usual toast (Outbox.swift's OutboxPresenter). A save that left its screen at once is never
 * silently lost: if it fails for good, this is where the person learns of it.
 */
@Composable
fun OutboxHost(modifier: Modifier = Modifier) {
    val failure by Outbox.failure.collectAsStateWithLifecycle()
    val note = LocalNoteState.current
    LaunchedEffect(Unit) { Outbox.notices.collect { note.show(Note(it)) } }
    val motion = rememberErpMotion()
    val feel = rememberHaptics()
    LaunchedEffect(failure?.id) { if (failure != null) feel.warning() }
    // The banner leaves with its words, not an empty box.
    val shown = remember { arrayOfNulls<erp.app.data.OutboxEngine.Item>(1) }
    failure?.let { shown[0] = it }
    Box(modifier.navigationBarsPadding().padding(bottom = 72.dp), contentAlignment = Alignment.BottomCenter) {
        AnimatedVisibility(
            visible = failure != null,
            enter = motion.slideIn(fromTop = false),
            exit = motion.slideOut(toTop = false),
        ) {
            shown[0]?.let { f ->
                Row(
                    Modifier
                        .widthIn(max = 560.dp)
                        .padding(horizontal = 16.dp)
                        .clickable { Outbox.retry(f.id) }
                        .semantics { customActions = listOf(CustomAccessibilityAction("Retry") { Outbox.retry(f.id); true }) },
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    NoteBanner(
                        Note(
                            title = if (f.isPost) "${f.label} failed" else "Not saved: ${f.label}",
                            detail = if (f.message.isEmpty()) "Tap to retry." else "${f.message} Tap to retry.",
                            failed = true,
                        ),
                        Modifier.weight(1f, fill = false),
                    )
                    Button(onClick = { Outbox.retry(f.id) }) { Text("Retry") }
                }
            }
        }
    }
}
