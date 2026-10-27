package erp.app.screens.neworder

import erp.app.ui.icons.Symbols
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import erp.app.data.LocalBook
import erp.app.data.rememberShelfStatus
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenRoute
import erp.app.nav.ScreenTitle
import erp.app.screens.invoices.InvoicePdfDialog
import erp.app.screens.invoices.InvoicePdfTarget
import erp.app.ui.NotAvailableState
import erp.app.ui.SkeletonLoading
import erp.core.entry.NewOrderEdit

/**
 * The New order group: the order form (src/app/orders/add/page.tsx, components/order/order-form.tsx), and the same
 * form editing an order on file (src/app/orders/[id]/edit).
 *
 * "/orders/add" also matches the Orders group's `item("/orders/")`, which would hand "add" to the order page as if it
 * were an order id, so this group's term goes BEFORE OrdersRoutes in `NativeScreens.all`. The voice order stays on the
 * ERP's page. "/orders/<id>/slip" is the order's workshop slip, drawn by the ERP's server (the PDF screen); the ERP
 * itself has no page there. "/orders/<id>/finalize" is the Orders group's. (NewOrderRoutes.swift.)
 */
val NewOrderRoutes: List<ScreenRoute> = listOf(
    // "?scan=parchi" (the New chooser's Scan a parchi) opens the slip reader over the new order. "?resume=1" opens the order
    // kept on this phone (Drafts' Continue, a sale's Create order, the voice assistant); otherwise the form is blank.
    ScreenRoute(
        matches = { ScreenRoute.bare(it) == "/orders/add" },
        make = { path -> NewOrder(readsSlip = NewOrderLogic.asks(path, scan = "parchi"), resumes = NewOrderLogic.asks(path, "resume", "1")) },
    ),
    ScreenRoute(
        matches = { NewOrderLogic.editId(it) != null },
        // "?rates=1" (the order page's Change rate) opens the form on its rates.
        make = { path -> NewOrderEditLoader(NewOrderLogic.editId(path) ?: "", ratesFirst = NewOrderLogic.asks(path, "rates", "1")) },
    ),
    ScreenRoute(
        matches = { NewOrderLogic.slipId(it) != null },
        make = { path -> OrderSlipScreen(NewOrderLogic.slipId(path) ?: "") },
    ),
)

/**
 * The workshop slip as Print slip saves it (lib/order-slip-pdf.ts, drawn by /api/app/pdf/order-slip), to print or share
 * from the phone: "OrderSlip-<id>.pdf". Staff get their browser's slip, without the owner's notes.
 */
@Composable
private fun OrderSlipScreen(id: String) {
    val navigator = LocalNavigator.current
    ScreenTitle("Slip $id")
    InvoicePdfDialog(slipTarget(id), onDismiss = { navigator.back() })
}

internal fun slipTarget(id: String): InvoicePdfTarget =
    InvoicePdfTarget(
        path = "/api/app/pdf/order-slip/" + java.net.URLEncoder.encode(id, "UTF-8").replace("+", "%20"),
        fileName = "OrderSlip-$id.pdf",
        title = "Slip $id",
    )

/**
 * Edit order: waits for the order to be on the shelf, then opens New order's form on it, once (a change arriving
 * meanwhile must not throw away what is being typed).
 */
@Composable
internal fun NewOrderEditLoader(id: String, ratesFirst: Boolean = false) {
    val book = LocalBook.current
    val status = rememberShelfStatus(book.orders)
    val orders = status.items
    val loaded = status.loaded
    var edit by remember(id) { mutableStateOf<NewOrderEdit?>(null) }
    val order = orders.firstOrNull { it.id == id }
    LaunchedEffect(order?.id) {
        if (edit == null && order != null) edit = NewOrderEdit(order)
    }
    val opened = edit
    when {
        opened != null -> NewOrder(edit = opened, ratesFirst = ratesFirst)
        loaded && order == null -> {
            ScreenTitle("Edit $id")
            NotAvailableState("No such order", why = "$id isn't in the book. It may have been deleted.", icon = Symbols.FolderOff)
        }
        else -> {
            ScreenTitle("Edit $id")
            SkeletonLoading()
        }
    }
}
