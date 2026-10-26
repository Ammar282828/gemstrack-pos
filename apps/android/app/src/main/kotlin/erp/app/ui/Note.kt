package erp.app.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// The toast said after a save or a refusal (Note.swift). The shell hosts it over every screen (AppRoot, and the
// create sheet's window), so a screen only says `LocalNoteState.current.show(Note("Saved"))`; it never hosts one.

/** What was said after a save, for a few seconds (the web's toast). */
data class Note(
    val title: String,
    val detail: String = "",
    /** Something that did not happen: an amber warning and a warning tap, never the green tick. */
    val failed: Boolean = false,
) {
    /** What TalkBack says when it appears. */
    val spoken: String get() = if (detail.isEmpty()) title else "$title. $detail"
}

/** How long a note stays. */
private const val NOTE_MILLIS = 4000L

/** The note on show, if any. It hides itself after four seconds; a newer note replaces it and restarts the wait. */
@Stable
class NoteState(private val scope: CoroutineScope?) {
    var note: Note? by mutableStateOf(null)
        private set

    /** The last note said, kept while the banner leaves so it fades out with its words. */
    internal var lastShown: Note? by mutableStateOf(null)
        private set

    private var hiding: Job? = null

    fun show(note: Note) {
        this.note = note
        lastShown = note
        hiding?.cancel()
        hiding = scope?.launch {
            delay(NOTE_MILLIS)
            this@NoteState.note = null
        }
    }

    fun hide() {
        hiding?.cancel()
        note = null
    }

    companion object {
        /** Where no host is set up: saying something does nothing. */
        val Inert = NoteState(null)
    }
}

@Composable
fun rememberNoteState(): NoteState {
    val scope = rememberCoroutineScope()
    return remember(scope) { NoteState(scope) }
}

/** The shell provides one; screens say `LocalNoteState.current.show(Note("Payment recorded"))`. */
val LocalNoteState = staticCompositionLocalOf { NoteState.Inert }

/**
 * The banner over the top of the screen (not a bottom snackbar: the floating menu and the bars live down there).
 * It rises in on the enter curve with a success tick (felt as well as seen), leaves on the exit curve; with
 * animations off it only fades. TalkBack is told in words. The shell places it (AppRoot, CreateSheet); [haptics] is
 * false for the second copy a dialog shows, so one note buzzes once.
 */
@Composable
fun NoteHost(state: NoteState, modifier: Modifier = Modifier, haptics: Boolean = true) {
    val reduce = reduceMotion()
    val feel = rememberHaptics()
    val shown = state.note
    LaunchedEffect(shown) {
        if (haptics && shown != null) if (shown.failed) feel.warning() else feel.success()
    }
    Box(modifier.fillMaxWidth().statusBarsPadding(), contentAlignment = Alignment.TopCenter) {
        AnimatedVisibility(
            visible = shown != null,
            enter = if (reduce) fadeIn(Motion.enter(true)) else slideInVertically(Motion.enter()) { -it } + fadeIn(Motion.enter()),
            exit = if (reduce) fadeOut(Motion.exit(true)) else slideOutVertically(Motion.exit()) { -it } + fadeOut(Motion.exit()),
        ) {
            state.lastShown?.let { NoteBanner(it, Modifier.widthIn(max = 560.dp).padding(horizontal = 16.dp, vertical = 8.dp)) }
        }
    }
}

@Composable
fun NoteBanner(note: Note, modifier: Modifier = Modifier) {
    Surface(
        modifier.semantics(mergeDescendants = true) {
            liveRegion = LiveRegionMode.Polite
            contentDescription = note.spoken
        },
        // Material's snackbar: the inverse surface, so it reads over any page in either mode, with no shadow to lift it.
        shape = Radius.chipShape,
        color = MaterialTheme.colorScheme.inverseSurface,
        contentColor = MaterialTheme.colorScheme.inverseOnSurface,
    ) {
        Row(
            Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                if (note.failed) Icons.Filled.Warning else Icons.Filled.CheckCircle,
                contentDescription = null,
                tint = if (note.failed) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.inversePrimary,
            )
            Column(Modifier.weight(1f)) {
                Text(note.title, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold))
                if (note.detail.isNotEmpty()) {
                    Text(note.detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.inverseOnSurface.copy(alpha = 0.8f))
                }
            }
        }
    }
}
