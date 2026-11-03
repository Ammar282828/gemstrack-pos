package erp.app.ui

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import erp.app.data.ErpApi
import erp.app.device.shareBytes
import erp.app.ui.icons.Symbols
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

// Share or print a PDF without opening it first (owner, 2026-11-02: "cant print pdf without opening the pdf first, like directly
// opening the share options"; PDFQuickShare.swift). One tap draws the PDF on the ERP and the system share sheet opens straight
// away (Print, WhatsApp, Save to Files); "View PDF" (PdfDocumentScreen) is still there for looking at it first.

/** What went wrong, in words the person can act on (PDFQuickShareFiles.said). */
fun quickPdfProblem(e: Exception): String = when {
    e is ErpApi.Failure && (e.status == 401 || e.status == 403) -> "This one is for the owners. Sign in as an owner to share it."
    e is java.io.InterruptedIOException -> "The ERP took too long to draw it. Check the connection and try again."
    else -> e.message?.takeIf { it.isNotBlank() } ?: "Try again."
}

/** A PDF starts with "%PDF"; an error page that came back as a 200 does not. */
fun looksLikePdf(bytes: ByteArray): Boolean =
    bytes.size > 4 && bytes[0] == '%'.code.toByte() && bytes[1] == 'P'.code.toByte() && bytes[2] == 'D'.code.toByte() && bytes[3] == 'F'.code.toByte()

/** What the ERP answered: the PDF's bytes, or the words for the Note. Pure, so the rule is tested on the JVM. */
sealed interface QuickPdfOutcome {
    class Ready(val bytes: ByteArray) : QuickPdfOutcome
    class Failed(val why: String) : QuickPdfOutcome
}

/** Draws the PDF with [fetch]; a non-PDF answer or a throw is a [QuickPdfOutcome.Failed]; a cancellation passes through. */
suspend fun prepareQuickPdf(fetch: suspend () -> ByteArray): QuickPdfOutcome =
    try {
        val bytes = fetch()
        if (looksLikePdf(bytes)) QuickPdfOutcome.Ready(bytes) else QuickPdfOutcome.Failed("The ERP's answer was not a PDF.")
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        QuickPdfOutcome.Failed(quickPdfProblem(e))
    }

/**
 * The one way every "Print or share" reaches the share sheet (`.pdfQuickShare`): [share] fetches the PDF at a path and hands it to the
 * system sheet at once. [preparing] is true while it is being drawn; a second [share] then is dropped, so a double tap draws one PDF.
 */
@Stable
class QuickPdf internal constructor(
    private val scope: CoroutineScope,
    private val context: Context,
    private val note: NoteState,
) {
    var preparing by mutableStateOf(false)
        private set

    fun share(path: String, fileName: String, title: String) {
        if (preparing) return
        preparing = true
        scope.launch {
            try {
                when (val out = prepareQuickPdf { ErpApi.shared.bytes(path) }) {
                    is QuickPdfOutcome.Ready -> shareBytes(context, out.bytes, fileName, "application/pdf", title)
                    is QuickPdfOutcome.Failed -> note.show(Note("Couldn't prepare the PDF", out.why, failed = true))
                }
            } finally {
                preparing = false
            }
        }
    }
}

@Composable
fun rememberQuickPdf(): QuickPdf {
    val context = LocalContext.current
    val note = LocalNoteState.current
    val scope = rememberCoroutineScope()
    return remember(context, note, scope) { QuickPdf(scope, context, note) }
}

/**
 * For a menu item or row that closes before the PDF is drawn (no control left to spin): a small "Preparing" card over the screen, the
 * iPhone's capsule, which also swallows a second tap. Draws nothing while [quick] is idle.
 */
@Composable
fun QuickPdfBusy(quick: QuickPdf) {
    if (!quick.preparing) return
    Dialog(onDismissRequest = {}, properties = DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false)) {
        Surface(shape = Radius.cardShape, color = MaterialTheme.colorScheme.surfaceContainerHigh) {
            Row(
                Modifier.padding(horizontal = 20.dp, vertical = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
            ) {
                Loading(Modifier.size(28.dp))
                Text("Preparing the PDF", style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
}

/**
 * The printer on every invoice and order card (owner, 2026-11-03: "quick print buttons on every order and an invoice card"; QuickPrintButton
 * in PDFQuickShare.swift): one tap fetches the PDF at [path] and opens the share sheet with it, named [fileName]. A second tap while it is
 * being drawn is dropped; a failure is said as the usual note.
 */
@Composable
fun QuickPrintButton(label: String, path: String, fileName: String, title: String, modifier: Modifier = Modifier) {
    val quick = rememberQuickPdf()
    IconButton(onClick = { quick.share(path, fileName, title) }, modifier = modifier) {
        if (quick.preparing) Loading(Modifier.size(22.dp))
        else Icon(Symbols.Print, contentDescription = label, tint = MaterialTheme.colorScheme.primary)
    }
}
