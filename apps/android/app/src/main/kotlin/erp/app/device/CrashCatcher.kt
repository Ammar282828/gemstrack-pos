package erp.app.device

import android.content.Context
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import erp.app.BuildConfig
import java.io.File

/**
 * When the app dies, the stack goes to `filesDir/last-crash.txt` and the next launch offers it (Share, Dismiss): a
 * crash on the owner's phone can then be read without a cable. It writes and then hands on to the system's handler,
 * so the process still ends as it would.
 */
object CrashCatcher {
    private const val FILE = "last-crash.txt"
    private const val LINES = 60

    /** The last screen drawn (ScreenRegistry sets it): "where were you" is half of every report. */
    @Volatile var route: String? = null

    fun install(context: Context) {
        val app = context.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try {
                File(app.filesDir, FILE).writeText(report(thread, error))
            } catch (_: Throwable) {
                // Nothing to do about a failure while failing: the system's handler still runs.
            }
            previous?.uncaughtException(thread, error)
        }
    }

    internal fun report(thread: Thread, error: Throwable, at: Long = System.currentTimeMillis()): String = buildString {
        append("ERP ${BuildConfig.HOUSE} ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}) ${if (BuildConfig.DEBUG) "debug" else "release"}\n")
        append("Android ${android.os.Build.VERSION.RELEASE} (API ${android.os.Build.VERSION.SDK_INT}), ${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}\n")
        append("At ${java.time.Instant.ofEpochMilli(at)} on thread ${thread.name}\n")
        append("Last screen: ${route ?: "none yet"}\n\n")
        append(error.stackTraceToString().lines().take(LINES).joinToString("\n"))
    }

    /** The saved report from the last run, if it ended in a crash. */
    fun pending(context: Context): String? =
        try {
            File(context.filesDir, FILE).takeIf { it.isFile }?.readText()?.takeIf { it.isNotBlank() }
        } catch (_: Throwable) {
            null
        }

    fun clear(context: Context) {
        try {
            File(context.filesDir, FILE).delete()
        } catch (_: Throwable) {
        }
    }
}

/** "The app closed unexpectedly": the saved stack, to share with whoever fixes it, or to dismiss. Shown once per crash. */
@Composable
fun CrashReportDialog() {
    val context = LocalContext.current
    var text by remember { mutableStateOf(CrashCatcher.pending(context)) }
    val shown = text ?: return
    AlertDialog(
        onDismissRequest = { CrashCatcher.clear(context); text = null },
        title = { Text("The app closed unexpectedly") },
        text = {
            Column(Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState())) {
                Text(shown, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace, fontSize = 10.sp))
            }
        },
        confirmButton = { TextButton(onClick = { shareText(context, "ERP crash report", shown) }) { Text("Share") } },
        dismissButton = { TextButton(onClick = { CrashCatcher.clear(context); text = null }) { Text("Dismiss") } },
    )
}
