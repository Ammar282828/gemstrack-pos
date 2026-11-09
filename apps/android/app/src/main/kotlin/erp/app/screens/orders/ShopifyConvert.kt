package erp.app.screens.orders

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.material3.Text
import erp.app.data.ErpApi
import erp.app.ui.AlertDialog
import erp.app.ui.LocalNoteState
import erp.app.ui.Note
import erp.app.ui.OwnerDeleteCodeSheet
import erp.app.ui.OwnerDeletion
import erp.app.ui.TextButton
import erp.core.logic.ShopifyOrders

/**
 * "Make them orders" (docs/decisions.md, Shopify section fix 2): an owner turns old Shopify invoices that are still open into
 * ERP orders. It explains first, then asks the delete code (the invoice is removed as a delete is), then sends the
 * `shopifyInvoicesToOrders` write. Money, so online only: a write that cannot reach the ERP fails with "Needs a connection" and is
 * never queued. The ERP's answer is said as a note; [onDone] gets it (the invoice page opens the order it made).
 */
@Composable
fun ShopifyConvertFlow(invoiceIds: List<String>, onDismiss: () -> Unit, onDone: (ShopifyOrders.Conversion) -> Unit = {}) {
    val note = LocalNoteState.current
    var asking by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<ShopifyOrders.Conversion?>(null) }
    val n = invoiceIds.size
    val what = if (n == 1) "Make Shopify sale ${invoiceIds[0]} an order" else "Make $n Shopify sales orders"
    if (!asking) {
        AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text(if (n == 1) "Make it an order?" else "Make $n sales orders?") },
            text = {
                Text(
                    "The pieces go to the workshop to be made. Their money becomes advances on the order. They count as sales again when you finalize the order. " +
                        "The invoice is removed, as a delete removes it. Only Shopify sales not yet fulfilled are changed.",
                )
            },
            confirmButton = { TextButton(onClick = { asking = true }) { Text("Continue") } },
            dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
        )
        return
    }
    val deletion = OwnerDeletion(
        what = what,
        detail = "Each invoice becomes an order in Pending, its payments become advances, and the invoice is removed.",
        final = false,
        run = { code ->
            val out = ErpApi.shared.write("shopifyInvoicesToOrders", mapOf("invoiceIds" to invoiceIds, "deleteCode" to code), queueOffline = false)
            result = ShopifyOrders.Conversion.parse(out)
        },
    )
    OwnerDeleteCodeSheet(deletion, onDismiss = onDismiss, onDone = {
        result?.let { r ->
            note.show(Note(if (r.converted.isEmpty()) "Nothing changed" else "Shopify sales made orders", r.summary, failed = r.converted.isEmpty()))
            onDone(r)
        }
    })
}
