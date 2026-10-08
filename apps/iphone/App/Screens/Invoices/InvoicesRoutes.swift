import SwiftUI

enum InvoicesRoutes {
    static var all: [ScreenRoute] {
        // "/invoices/<id>" is an invoice, but "/invoices/new" is a new sale and stays the ERP's page:
        // `item` alone would take "new" for an id, so the match leaves it out.
        let invoice = ScreenRoute.item("/invoices/") { id in InvoiceScreen(id: id) }
        let invoiceNotNew = ScreenRoute(
            matches: { path in invoice.matches(path) && ScreenRoute.bare(path) != "/invoices/new" },
            make: invoice.make
        )
        return [
            ScreenRoute.exact("/invoices") { InvoicesList() },
            invoiceNotNew,
        ]
    }
}
