import SwiftUI
import ERPCore

/// Delete the invoice (invoice-viewer.tsx's Delete; store `deleteInvoice(id, false)`, the shared write
/// lib/writes/invoice-delete.ts): a mistake, a sale entered twice. As on the web it goes straight to the delete
/// code, which says first what goes with it: its ledger rows, its pieces back in stock (only those no other
/// invoice sold, never one made for an order; ERPCore InvoiceActions.piecesBackInStock), its order's link, and
/// Shopify's copy. The invoice is gone after, so the page should leave (`removed`). An owner's.
struct InvoiceActionDeleteSheet: View {
    let invoice: Invoice
    let onDone: (InvoiceActionOutcome) -> Void

    @Environment(Book.self) private var book

    var body: some View {
        OwnerDeleteCodeSheet(deletion: deletion) {
            onDone(InvoiceActionOutcome(
                note: InvoiceNote(title: "Invoice \(invoice.id) deleted", detail: "Its ledger rows went with it, and pieces only it had sold are back in stock."),
                removed: true))
        }
        .task {
            book.invoices.need()
            book.hisaab.need()
        }
    }

    private var deletion: OwnerDeletion {
        let invoiceId = invoice.id
        return OwnerDeletion(what: InvoiceActionWords.deleteInvoiceWhat(invoiceId), detail: InvoiceActionDeleteSheet.detail(invoice, book: book)) { code in
            _ = try await ERPAPI.shared.write("deleteInvoice", ["invoiceId": invoiceId, "deleteCode": code])
        }
    }

    /// What goes with it, from the books as the phone has them: the ledger rows are counted once they are read.
    @MainActor
    static func detail(_ inv: Invoice, book: Book) -> String {
        let rows = book.hisaab.loaded ? book.hisaab.items.filter { $0.linkedInvoiceId == inv.id }.count : nil
        return InvoiceActionWords.deletion(inv, others: book.invoices.items, ledgerRows: rows)
    }
}
