import SwiftUI
import ERPCore

/// The Sale group: the New chooser, a new sale, and Scan a tag.
///
/// "/invoices/new" is a path the Invoices group's item route already leaves out ("new" is not an
/// invoice id), so the two never meet. `?web=1` on any of these opens the ERP's own page instead
/// (ScreenRegistry.wantsWeb), which is how the phone links to what it does not do: editing an
/// invoice, the AI bill scanner, and billing a piece that was never in stock.
enum SaleRoutes {
    static var all: [ScreenRoute] {
        [
            .exact("/new") { NewChooser() },
            .exact("/invoices/new") { NewSale() },
            .exact("/scan") { ScanTag() },
            ScreenRoute(matches: { editId($0) != nil }, make: { p in AnyView(SaleEditLoader(id: editId(p) ?? "")) }),
        ]
    }

    /// "/invoices/<id>/edit" → the id (the invoice page's Edit, src/app/invoices/[id]/edit).
    static func editId(_ path: String) -> String? {
        let bare = ScreenRoute.bare(path)
        guard bare.hasPrefix("/invoices/"), bare.hasSuffix("/edit") else { return nil }
        let id = String(bare.dropFirst("/invoices/".count).dropLast("/edit".count))
        guard !id.isEmpty, !id.contains("/") else { return nil }
        return id.removingPercentEncoding ?? id
    }
}

/// Edit invoice: owners only (the ERP's write is), once the invoice and the shop's rates are on the shelf.
struct SaleEditLoader: View {
    let id: String

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @State private var edit: SaleEdit?

    var body: some View {
        Group {
            if !session.isOwner {
                ContentUnavailableView("Only an owner can change an invoice", systemImage: "lock", description: Text("Ask an owner to make the change."))
            } else if let edit {
                SaleForm(edit: edit)
            } else if book.invoices.loaded && book.invoices.item(id) == nil {
                ContentUnavailableView("No such invoice", systemImage: "questionmark.folder", description: Text("\(id) isn't in the book. It may have been deleted."))
            } else {
                ProgressView()
            }
        }
        .onAppear {
            book.invoices.need()
            book.settings.need()
            take()
        }
        .onChange(of: book.invoices.item(id)?.id) { _, _ in take() }
        .onChange(of: book.settings.loaded) { _, _ in take() }
    }

    private func take() {
        guard edit == nil, book.settings.loaded, let inv = book.invoices.item(id) else { return }
        edit = SaleEdit(inv, settings: book.settings.value)
    }
}
