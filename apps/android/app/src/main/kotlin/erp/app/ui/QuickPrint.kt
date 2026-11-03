package erp.app.ui

import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import erp.app.data.ErpApi
import erp.app.device.shareBytes
import erp.app.ui.icons.Symbols
import kotlinx.coroutines.CancellationException
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

/**
 * The printer on every invoice and order card (owner, 2026-11-03: "quick print buttons on every order and an invoice card"; QuickPrintButton
 * in PDFQuickShare.swift): one tap fetches the PDF at [path] and opens the share sheet with it, named [fileName]. A second tap while it is
 * being drawn is dropped; a failure is said as the usual note.
 */
@Composable
fun QuickPrintButton(label: String, path: String, fileName: String, title: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val note = LocalNoteState.current
    val scope = rememberCoroutineScope()
    var preparing by remember { mutableStateOf(false) }
    IconButton(
        onClick = {
            if (preparing) return@IconButton
            preparing = true
            scope.launch {
                try {
                    val bytes = ErpApi.shared.bytes(path)
                    if (!looksLikePdf(bytes)) {
                        note.show(Note("Couldn't prepare the PDF", "The ERP's answer was not a PDF.", failed = true))
                    } else {
                        shareBytes(context, bytes, fileName, "application/pdf", title)
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    note.show(Note("Couldn't prepare the PDF", quickPdfProblem(e), failed = true))
                } finally {
                    preparing = false
                }
            }
        },
        modifier = modifier,
    ) {
        BusyLabel(preparing) { Icon(Symbols.Print, contentDescription = label, tint = MaterialTheme.colorScheme.primary) }
    }
}
