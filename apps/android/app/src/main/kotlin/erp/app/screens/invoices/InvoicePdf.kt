package erp.app.screens.invoices

import androidx.compose.runtime.Composable
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import erp.app.data.ErpApi
import erp.app.ui.PdfDocumentScreen

/**
 * The PDF over the screen, full window, with its own title bar, Back and Share (the iPhone pushes PDFDocumentScreen;
 * a screen here makes no stack of its own, so it is a dialog that fills the window). The invoice's PDF is drawn on
 * the ERP's server (/api/app/pdf/invoice, lib/invoice-pdf.ts, the one Print saves), fetched as the signed-in person
 * and handed to Android's share sheet (Print, Save, WhatsApp) by the kit.
 */
@Composable
fun InvoicePdfDialog(target: InvoicePdfTarget, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        PdfDocumentScreen(
            title = target.title,
            fileName = target.fileName,
            load = { ErpApi.shared.bytes(target.path) },
            onBack = onDismiss,
        )
    }
}
