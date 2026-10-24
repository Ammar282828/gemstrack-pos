package erp.app.screens.sale

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.FolderOff
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.data.LocalBook
import erp.app.data.rememberSingle
import erp.app.nav.ScreenRoute
import erp.app.nav.ScreenTitle
import erp.app.ui.NotAvailableState
import erp.app.ui.SkeletonLoading
import erp.core.entry.SaleEdit

/**
 * The Sale group: the New chooser, a new sale, Scan a tag, and Edit invoice.
 *
 * "/invoices/new" is a path the Invoices group's item route would take for an invoice called "new", so this group
 * comes first in NativeScreens.all. `?web=1` on any of these opens the ERP's own page instead
 * (ScreenRegistry.wantsWeb). "/invoices/new?scan=bill" opens the AI bill reader over the new sale.
 */
val SaleRoutes: List<ScreenRoute> = listOf(
    ScreenRoute.exact("/new") { NewChooser() },
    // "?scan=bill" (the New chooser's Read a written bill) opens the bill reader over the new sale.
    ScreenRoute(matches = { ScreenRoute.bare(it) == "/invoices/new" }, make = { p -> NewSale(readsBill = SaleRouting.asks(p, "bill")) }),
    ScreenRoute.exact("/scan") { ScanTag() },
    ScreenRoute(matches = { SaleRouting.editId(it) != null }, // "?rates=1" (the invoice page's Change rate) opens the form on its rates.
    make = { p -> SaleEditLoader(SaleRouting.editId(p).orEmpty(), ratesFirst = SaleRouting.asks(p, "rates", "1")) }),
)

object SaleRouting {
    /** A path's `scan=` asking for one of the AI readers ("bill", "parchi"). */
    fun asks(path: String, scan: String): Boolean = asks(path, "scan", scan)

    /** The path's query asks for `key=value` (Change rate: "?rates=1"). */
    fun asks(path: String, key: String, value: String): Boolean {
        val query = path.substringBefore('#').substringAfter('?', "")
        return query.split('&').any { it.substringBefore('=') == key && it.substringAfter('=', "") == value }
    }

    /** "/invoices/<id>/edit" → the id (the invoice page's Edit, src/app/invoices/[id]/edit). */
    fun editId(path: String): String? {
        val bare = ScreenRoute.bare(path)
        if (!bare.startsWith("/invoices/") || !bare.endsWith("/edit")) return null
        if (bare.length < "/invoices/".length + "/edit".length) return null
        val id = bare.substring("/invoices/".length, bare.length - "/edit".length)
        if (id.isEmpty() || id.contains("/")) return null
        return ScreenRoute.percentDecode(id)
    }
}

/** Edit invoice: owners only (the ERP's write is), once the invoice and the shop's rates are on the shelf. */
@Composable
fun SaleEditLoader(id: String, ratesFirst: Boolean = false) {
    val book = LocalBook.current
    val session = LocalSession.current
    if (!session.isOwner) {
        ScreenTitle("Edit invoice")
        NotAvailableState("Only an owner can change an invoice", why = "Ask an owner to make the change.")
        return
    }
    val invoices by book.invoices.items.collectAsStateWithLifecycle()
    val loaded by book.invoices.loaded.collectAsStateWithLifecycle()
    val settings by rememberSingle(book.settings)
    val settingsLoaded by book.settings.loaded.collectAsStateWithLifecycle()
    var edit by remember { mutableStateOf<SaleEdit?>(null) }
    LaunchedEffect(Unit) { book.invoices.need() }
    val invoice = invoices.firstOrNull { it.id == id }
    LaunchedEffect(invoice?.id, settingsLoaded) {
        if (edit == null && settingsLoaded && invoice != null) edit = SaleEdit(invoice, settings)
    }
    val taken = edit
    when {
        taken != null -> SaleForm(edit = taken, ratesFirst = ratesFirst)
        loaded && invoice == null -> {
            ScreenTitle("Edit invoice")
            NotAvailableState("No such invoice", why = "$id isn't in the book. It may have been deleted.", icon = Icons.Filled.FolderOff)
        }
        else -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { SkeletonLoading() }
    }
}
