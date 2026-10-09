import SwiftUI
import ERPCore

/// The New order group: the order form (src/app/orders/add/page.tsx, components/order/order-form.tsx), and the
/// same form editing an order on file (src/app/orders/[id]/edit).
///
/// "/orders/add" also matches the Orders group's `.item("/orders/")`, which would hand "add" to
/// OrderScreen as if it were an order id, so this group's term goes BEFORE OrdersRoutes in
/// `NativeScreens.all`. The AI slip reader and the voice order stay on the ERP's page (`?web=1`).
/// "/orders/<id>/slip" is the order's workshop slip, drawn by the ERP's server (PDFDocumentScreen); the
/// ERP itself has no page there.
enum NewOrderRoutes {
    static var all: [ScreenRoute] {
        let edit = ScreenRoute(
            matches: { p in editId(p) != nil },
            make: { p in AnyView(NewOrderEditLoader(id: editId(p) ?? "")) }
        )
        let finalize = ScreenRoute(
            matches: { p in finalizeId(p) != nil },
            make: { p in AnyView(OrderFinalizeScreen(id: finalizeId(p) ?? "")) }
        )
        let slip = ScreenRoute(
            matches: { p in slipId(p) != nil },
            make: { p in AnyView(slipScreen(slipId(p) ?? "")) }
        )
        return [
            // "?scan=parchi" (the New chooser's Scan a parchi) opens the slip reader over the new order.
            ScreenRoute(matches: { ScreenRoute.bare($0) == "/orders/add" }, make: { p in AnyView(NewOrder(readsSlip: SaleRoutes.asks(p, scan: "parchi"))) }),
            edit,
            finalize,
            slip,
        ]
    }

    /// The workshop slip as Print slip saves it (lib/order-slip-pdf.ts, drawn by /api/app/pdf/order-slip), to
    /// print or share from the phone: "OrderSlip-<id>.pdf". Staff get their browser's slip, without the
    /// owner's notes.
    static func slipScreen(_ id: String) -> PDFDocumentScreen {
        PDFDocumentScreen(path: "/api/app/pdf/order-slip/" + InvoiceFacts.encode(id),
                          fileName: "OrderSlip-\(id).pdf",
                          title: "Slip \(id)")
    }

    /// "/orders/<id>/slip" → the id.
    static func slipId(_ path: String) -> String? {
        let bare = ScreenRoute.bare(path)
        guard bare.hasPrefix("/orders/"), bare.hasSuffix("/slip") else { return nil }
        let id = String(bare.dropFirst("/orders/".count).dropLast("/slip".count))
        guard !id.isEmpty, !id.contains("/") else { return nil }
        return id.removingPercentEncoding ?? id
    }

    /// "/orders/<id>/finalize" → the id: Finalize & invoice (the web's ?do=finalize dialog), native.
    static func finalizeId(_ path: String) -> String? {
        let bare = ScreenRoute.bare(path)
        guard bare.hasPrefix("/orders/"), bare.hasSuffix("/finalize") else { return nil }
        let id = String(bare.dropFirst("/orders/".count).dropLast("/finalize".count))
        guard !id.isEmpty, !id.contains("/") else { return nil }
        return id.removingPercentEncoding ?? id
    }

    /// "/orders/<id>/edit" → the id.
    static func editId(_ path: String) -> String? {
        let bare = ScreenRoute.bare(path)
        guard bare.hasPrefix("/orders/"), bare.hasSuffix("/edit") else { return nil }
        let id = String(bare.dropFirst("/orders/".count).dropLast("/edit".count))
        guard !id.isEmpty, !id.contains("/") else { return nil }
        return id.removingPercentEncoding ?? id
    }
}

/// Edit order: waits for the order to be on the shelf, then opens New order's form on it, once (a change
/// arriving meanwhile must not throw away what is being typed).
struct NewOrderEditLoader: View {
    let id: String

    @Environment(Book.self) private var book
    @State private var edit: NewOrderEdit?

    var body: some View {
        Group {
            if let edit {
                NewOrder(edit: edit)
            } else if book.orders.loaded && book.orders.item(id) == nil {
                ContentUnavailableView("No such order", systemImage: "questionmark.folder", description: Text("\(id) isn't in the book. It may have been deleted."))
            } else {
                ProgressView()
            }
        }
        .onAppear {
            book.orders.need()
            take()
        }
        .onChange(of: book.orders.item(id)?.id) { _, _ in take() }
    }

    private func take() {
        guard edit == nil, let order = book.orders.item(id) else { return }
        edit = NewOrderEdit(order)
    }
}
