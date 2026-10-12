package erp.app.screens.invoices

import erp.app.nav.ScreenRoute

/**
 * The Invoices group's routes. "/invoices/<id>" is an invoice, but "/invoices/new" is a new sale: `item` alone would
 * take "new" for an id, so the match leaves it out (the Sale group's `/invoices/new` comes first in NativeScreens,
 * and this stays correct without it).
 */
val InvoicesRoutes: List<ScreenRoute> = run {
    val invoice = ScreenRoute.item("/invoices/") { id -> InvoiceScreen(id) }
    val invoiceNotNew = ScreenRoute(
        matches = { path -> invoice.matches(path) && ScreenRoute.bare(path) != "/invoices/new" },
        make = invoice.make,
    )
    listOf(
        ScreenRoute.exact("/invoices") { InvoicesList() },
        invoiceNotNew,
    )
}
