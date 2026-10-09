import SwiftUI
import ERPCore

/// The order page's undoing moves, native (src/app/orders/[id]/page.tsx): the invoiced banner's Cancel invoice
/// and Unlock & edit, and the ⋯ menu's Refund order and Delete order. Each says what it will do in the page's
/// own words and asks for the delete code in the one sheet the owners' pages use (OwnerDeleteCodeSheet, Face ID
/// key `delete-code`); the ERP checks the code with the change itself (/api/app/write, ops-orders.ts), so
/// nothing moves unless it was right. Afterwards, as the page: a note, the edit form, or back to the list.
struct OrderUndoAsk: Identifiable {
    enum Then {
        /// The page's toast.
        case note(OwnerNote)
        /// Unlock & edit: the order's edit form, now that it is open again.
        case edit(String)
        /// Delete order: the order is gone, so its screen goes too (the page goes back to /orders).
        case leave
    }

    let id = UUID()
    let deletion: OwnerDeletion
    let then: Then
}

/// The four asks, each built from the order as the screen shows it. The invoice named is the one on screen:
/// the ERP refuses the undo if the order has been invoiced again since.
@MainActor
enum OrderUndo {
    /// Cancel invoice: the invoice and its hisaab rows go, its pieces stay sold, the order is open again.
    static func undoInvoice(_ order: Order) -> OrderUndoAsk {
        let invoiceId = order.invoiceId ?? ""
        let said = OrderActions.undoneNote(order, invoiceId: invoiceId)
        return OrderUndoAsk(
            deletion: OwnerDeletion(what: OrderActions.undoWhat(order), detail: OrderActions.undoDetail(order)) { code in
                _ = try await ERPAPI.shared.write("undoOrderInvoice", ["orderId": order.id, "invoiceId": invoiceId, "deleteCode": code])
            },
            then: .note(OwnerNote(title: said.title, detail: said.detail))
        )
    }

    /// Unlock & edit: the same write, then the edit form.
    static func unlockAndEdit(_ order: Order) -> OrderUndoAsk {
        let invoiceId = order.invoiceId ?? ""
        return OrderUndoAsk(
            deletion: OwnerDeletion(what: OrderActions.undoWhat(order), detail: OrderActions.unlockDetail(order)) { code in
                _ = try await ERPAPI.shared.write("undoOrderInvoice", ["orderId": order.id, "invoiceId": invoiceId, "deleteCode": code])
            },
            then: .edit(order.id)
        )
    }

    /// Refund order: Refunded; an invoice deleted with its pieces back in stock, its Shopify order refunded.
    static func refund(_ order: Order) -> OrderUndoAsk {
        let said = OrderActions.refundedNote(order)
        return OrderUndoAsk(
            deletion: OwnerDeletion(what: OrderActions.refundWhat(order), detail: OrderActions.refundDetail(order)) { code in
                // The invoice the screen showed (none: ""), so a refund never takes one it did not say.
                _ = try await ERPAPI.shared.write("refundOrder", ["orderId": order.id, "invoiceId": order.invoiceId ?? "", "deleteCode": code])
            },
            then: .note(OwnerNote(title: said.title, detail: said.detail))
        )
    }

    /// Delete order: with its sample photos; never an invoiced one (the menu says why instead).
    static func delete(_ order: Order) -> OrderUndoAsk {
        OrderUndoAsk(
            deletion: OwnerDeletion(what: OrderActions.deleteWhat(order), detail: OrderActions.deleteDetail(order)) { code in
                _ = try await ERPAPI.shared.write("deleteOrder", ["orderId": order.id, "deleteCode": code])
            },
            then: .leave
        )
    }
}

extension View {
    /// The undoing moves' code sheet and what follows each. `open` is the screen's own destination, for the
    /// edit form after Unlock & edit.
    func orderUndo(_ ask: Binding<OrderUndoAsk?>, open: Binding<OrdersWebTarget?>) -> some View {
        modifier(OrderUndoPresenter(ask: ask, open: open))
    }
}

private struct OrderUndoPresenter: ViewModifier {
    @Binding var ask: OrderUndoAsk?
    @Binding var open: OrdersWebTarget?

    @Environment(\.dismiss) private var dismiss
    /// What follows, once the sheet has gone: the edit form or going back never start under a closing sheet.
    @State private var then: OrderUndoAsk.Then?
    @State private var note: OwnerNote?

    func body(content: Content) -> some View {
        content
            .sheet(item: $ask, onDismiss: follow) { (a: OrderUndoAsk) in
                OwnerDeleteCodeSheet(deletion: a.deletion) { then = a.then }
            }
            .ownerNote($note)
    }

    private func follow() {
        guard let next = then else { return }
        then = nil
        switch next {
        case .note(let said): withAnimation { note = said }
        case .edit(let id): open = .edit(id)
        case .leave: dismiss()
        }
    }
}
