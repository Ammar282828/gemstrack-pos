import SwiftUI

enum InvoicesRoutes {
    static var all: [ScreenRoute] {
        // "/invoices/<id>" is an invoice, but "/invoices/new" is a new sale (the Sale group's, SaleRoutes):
        // `item` alone would take "new" for an id, so the match leaves it out.
        let invoice = ScreenRoute.item("/invoices/") { id in InvoiceScreen(id: id) }
        let invoiceNotNew = ScreenRoute(
            matches: { path in invoice.matches(path) && ScreenRoute.bare(path) != "/invoices/new" },
            make: invoice.make
        )
        #if os(macOS)
        // The Mac's Invoices is a place with a table and an inspector (MacInvoicesPlace); a saved list ("?list=unpaid")
        // is the same place narrowed, so the whole path is handed to it.
        let invoicesPlace = ScreenRoute(
            matches: { path in ScreenRoute.bare(path) == "/invoices" },
            make: { path in AnyView(MacInvoicesPlace(path: path)) }
        )
        return [
            invoicesPlace,
            invoiceNotNew,
        ]
        #else
        return [
            ScreenRoute.exact("/invoices") { InvoicesList() },
            invoiceNotNew,
        ]
        #endif
    }
}
