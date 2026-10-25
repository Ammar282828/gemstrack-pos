#if os(macOS)
import SwiftUI
import ERPCore

// The Order menu (docs/features/mac-design.md, rule 3 and "Orders"): every action of an order declared once, as
// `MacAction`s, so the menu bar, the toolbar, the right-click menu and the inspector's buttons are drawn from the same
// list and never disagree about what can be done to an order, what it is called or which key does it. The rules for what
// an order offers are the iPhone's (OrderScreen's More menu and bar, OrderCard's menu): `OrderActions`, `OrdersLogic`.

/// What decides which of an order's actions are on offer. `order` is nil while nothing (or more than one) is picked:
/// every action is then there and shut, as Mail's Message menu is.
struct MacOrdersMenuInput {
    var order: Order?
    var stage: OrderStage = .new
    /// What the order's invoice still has owing.
    var invoiceOwed = 0.0
    /// The status as shown (the one just chosen first).
    var status = ""
    /// Pieces still without a karigar.
    var unassigned = 0
    var isOwner = false
    var role = "none"
}

/// What each action does, bound to the order by whoever builds it.
struct MacOrdersMenuRun {
    var nextStep: () -> Void = {}
    var advance: () -> Void = {}
    var giveOut: () -> Void = {}
    var markReady: () -> Void = {}
    var makeInvoice: () -> Void = {}
    var openInvoice: () -> Void = {}
    var printSlip: () -> Void = {}
    var message: () -> Void = {}
    var call: () -> Void = {}
    var whatsApp: () -> Void = {}
    var bookCourier: () -> Void = {}
    var track: () -> Void = {}
    var transfer: () -> Void = {}
    var lapse: () -> Void = {}
    var bankDetails: () -> Void = {}
    var leopards: () -> Void = {}
    var edit: () -> Void = {}
    var changeRate: () -> Void = {}
    var unlock: () -> Void = {}
    var setStatus: (String) -> Void = { _ in }
    var cancelInvoice: () -> Void = {}
    var cancelOrder: () -> Void = {}
    var refund: () -> Void = {}
    var delete: () -> Void = {}
}

enum MacOrdersMenu {
    /// The ids of the actions the toolbar carries (the ones used most), in order.
    static let toolbarIDs = ["next", "advance", "slip", "edit"]

    /// The order's one next step, as the iPhone's bar offers it: an invoice only while it is owed, the transfer only to
    /// the accounts the server lets move it, nothing for a cancelled or refunded order.
    static func step(_ i: MacOrdersMenuInput) -> OrderNextStep? {
        guard let o = i.order, i.stage != .closed,
              let step = OrdersLogic.nextStep(o, stage: i.stage, owed: i.invoiceOwed) else { return nil }
        switch step {
        case .invoice(_, let due): return due >= 1 ? step : nil
        case .checkTransfer: return i.role == "owner" || i.role == "staff" ? step : nil
        default: return step
        }
    }

    /// Every action of an order, in groups (a divider between groups).
    static func groups(_ i: MacOrdersMenuInput, run r: MacOrdersMenuRun) -> [[MacAction]] {
        let g1 = steps(i, r)
        let g2 = share(i, r)
        let g3 = online(i, r)
        let g4 = change(i, r)
        let g5 = status(i, r)
        let g6 = undo(i, r)
        return [g1, g2, g3, g4, g5, g6].filter { !$0.isEmpty }
    }

    /// The actions with these ids, in the order given (the toolbar's, the inspector's).
    static func pick(_ groups: [[MacAction]], _ ids: [String]) -> [MacAction] {
        let all = groups.flatMap { $0 }
        return ids.compactMap { id in all.first { $0.id == id } }
    }

    /// The groups without these ids: what a record window's More menu holds once its toolbar has the few.
    static func rest(_ groups: [[MacAction]], excluding ids: [String]) -> [[MacAction]] {
        groups.map { (g: [MacAction]) -> [MacAction] in g.filter { !ids.contains($0.id) } }.filter { !$0.isEmpty }
    }

    // MARK: The groups

    private static func steps(_ i: MacOrdersMenuInput, _ r: MacOrdersMenuRun) -> [MacAction] {
        let o = i.order
        let step = Self.step(i)
        let invoiced = o.map(OrdersLogic.hasInvoice) ?? false
        let closed = o.map(OrderActions.isClosed) ?? false
        let canAdvance = o.map { i.isOwner && OrdersLogic.canAdvance($0) } ?? false
        let canFinalize = o != nil && !invoiced && (i.status == "Completed" || i.status == "In Progress")
        let nextTitle = step.map { "Next Step: " + $0.title } ?? "Next Step"
        var out: [MacAction] = []
        out.append(MacAction(nextTitle, symbol: step?.symbol ?? "arrow.right.circle",
                             shortcut: KeyboardShortcut(.return, modifiers: .command),
                             enabled: step != nil, isDefault: true, id: "next", perform: r.nextStep))
        out.append(MacAction("Take Advance\u{2026}", symbol: "banknote",
                             shortcut: KeyboardShortcut("a", modifiers: [.command, .shift]),
                             enabled: canAdvance, id: "advance", perform: r.advance))
        out.append(MacAction("Give Out\u{2026}", symbol: "person.badge.plus",
                             enabled: o != nil && !invoiced && !closed && i.unassigned > 0, id: "giveOut", perform: r.giveOut))
        out.append(MacAction("Mark Ready", symbol: "checkmark.circle",
                             enabled: i.stage == .karigar, id: "ready", perform: r.markReady))
        out.append(MacAction("Make Invoice\u{2026}", symbol: "doc.text",
                             enabled: canFinalize, id: "invoice", perform: r.makeInvoice))
        out.append(MacAction("Open Invoice", symbol: "doc.text.magnifyingglass",
                             enabled: invoiced, id: "openInvoice", perform: r.openInvoice))
        return out
    }

    private static func share(_ i: MacOrdersMenuInput, _ r: MacOrdersMenuRun) -> [MacAction] {
        let o = i.order
        let hasPhone = !CustomerKit.dialable(o?.customerContact).isEmpty
        let cn = o.flatMap(OrderActions.tcsConsignment)
        let canBook = o.map { OrderActions.canBookCourier($0, isOwner: i.isOwner) } ?? false
        var out: [MacAction] = []
        out.append(MacAction("Print Slip", symbol: "printer", shortcut: KeyboardShortcut("p", modifiers: .command),
                             enabled: o != nil, id: "slip", perform: r.printSlip))
        out.append(MacAction("Message the Customer\u{2026}", symbol: "message", enabled: o != nil, id: "message", perform: r.message))
        out.append(MacAction("Call", symbol: "phone", enabled: hasPhone, id: "call", perform: r.call))
        out.append(MacAction("WhatsApp Chat", symbol: "bubble.left.and.text.bubble.right", enabled: hasPhone, id: "whatsapp", perform: r.whatsApp))
        out.append(MacAction("Book Courier\u{2026}", symbol: "truck.box", enabled: canBook, id: "courier", perform: r.bookCourier))
        out.append(MacAction(cn.map { "Track " + $0 } ?? "Track", symbol: "shippingbox", enabled: cn != nil, id: "track", perform: r.track))
        return out
    }

    /// An online order's own moves (the iPhone's panel on the order page): the transfer, the lapse, the bank details
    /// and Leopards. Owners and staff only, as the server's gate is.
    private static func online(_ i: MacOrdersMenuInput, _ r: MacOrdersMenuRun) -> [MacAction] {
        guard let o = i.order, OrdersLogic.isOnline(o), let w = o.website else { return [] }
        let mayAct = i.role == "owner" || i.role == "staff"
        let awaitingMoney = w.paymentStatus != .transferReceived && w.paymentStatus != .expired && o.status != .cancelled
        let paidNotDelivered = w.paymentStatus == .transferReceived && (o.leopards?.deliveredAt ?? "").isEmpty
        let shipped = !(o.leopards?.cn ?? "").isEmpty
        var out: [MacAction] = []
        out.append(MacAction("Transfer Received\u{2026}", symbol: "banknote", enabled: mayAct && awaitingMoney,
                             id: "transfer", perform: r.transfer))
        out.append(MacAction("Bank Details on WhatsApp", symbol: "paperplane", enabled: mayAct && awaitingMoney,
                             id: "bank", perform: r.bankDetails))
        out.append(MacAction(shipped ? "Leopards Tracking\u{2026}" : "Book With Leopards\u{2026}",
                             symbol: shipped ? "shippingbox" : "truck.box", enabled: mayAct && paidNotDelivered,
                             id: "leopards", perform: r.leopards))
        out.append(MacAction("Let It Lapse\u{2026}", symbol: "nosign", role: .destructive, enabled: mayAct && awaitingMoney,
                             id: "lapse", perform: r.lapse))
        return out
    }

    private static func change(_ i: MacOrdersMenuInput, _ r: MacOrdersMenuRun) -> [MacAction] {
        let o = i.order
        let invoiced = o.map(OrdersLogic.hasInvoice) ?? false
        let closed = o.map(OrderActions.isClosed) ?? false
        let canUndo = o.map { OrderActions.canUndoInvoice($0, isOwner: i.isOwner) } ?? false
        var out: [MacAction] = []
        out.append(MacAction("Edit", symbol: "pencil", shortcut: KeyboardShortcut("e", modifiers: .command),
                             enabled: o != nil && i.isOwner && !invoiced, id: "edit", perform: r.edit))
        out.append(MacAction("Change Rate\u{2026}", symbol: "percent", enabled: o != nil && i.isOwner && !closed,
                             id: "rate", perform: r.changeRate))
        out.append(MacAction("Unlock & Edit\u{2026}", symbol: "lock.open", enabled: canUndo, id: "unlock", perform: r.unlock))
        return out
    }

    /// The status, one action to each (a menu bar has no submenu in a record menu): the current one is ticked.
    private static func status(_ i: MacOrdersMenuInput, _ r: MacOrdersMenuRun) -> [MacAction] {
        let on = i.order != nil
        let rows: [(String, String, String)] = [
            ("Pending", "clock", "pending"),
            ("In Progress", "hammer", "progress"),
            ("Completed", "checkmark.circle", "completed"),
        ]
        return rows.map { (row: (String, String, String)) -> MacAction in
            let current = i.status == row.0
            return MacAction("Status: " + row.0, symbol: current ? "checkmark" : row.1, enabled: on && !current,
                             id: row.2, perform: { r.setStatus(row.0) })
        }
    }

    private static func undo(_ i: MacOrdersMenuInput, _ r: MacOrdersMenuRun) -> [MacAction] {
        let o = i.order
        let closed = o.map(OrderActions.isClosed) ?? false
        let canUndo = o.map { OrderActions.canUndoInvoice($0, isOwner: i.isOwner) } ?? false
        let canRefund = o.map { OrderActions.canRefund($0, isOwner: i.isOwner) } ?? false
        let canDelete = o.map { OrderActions.canDelete($0, isOwner: i.isOwner) } ?? false
        var out: [MacAction] = []
        out.append(MacAction("Cancel Invoice\u{2026}", symbol: "arrow.uturn.backward", role: .destructive,
                             enabled: canUndo, id: "cancelInvoice", perform: r.cancelInvoice))
        out.append(MacAction("Cancel Order\u{2026}", symbol: "xmark.circle", role: .destructive,
                             enabled: o != nil && !closed, id: "cancel", perform: r.cancelOrder))
        out.append(MacAction("Refund\u{2026}", symbol: "arrow.uturn.backward", role: .destructive,
                             enabled: canRefund, id: "refund", perform: r.refund))
        out.append(MacAction("Delete\u{2026}", symbol: "trash", shortcut: KeyboardShortcut(.delete, modifiers: .command),
                             role: .destructive, enabled: canDelete, id: "delete", perform: r.delete))
        return out
    }
}

/// A record window's More menu: the actions its toolbar has no room for. No keys are declared here (the Order menu in the
/// menu bar owns them); its label is the Label AppKit keeps.
struct MacOrdersMoreMenu: View {
    let groups: [[MacAction]]

    var body: some View {
        Menu {
            ForEach(Array(groups.enumerated()), id: \.offset) { (pair: (offset: Int, element: [MacAction])) in
                if pair.offset > 0 { Divider() }
                ForEach(pair.element) { (a: MacAction) in
                    Button(role: a.role, action: a.perform) {
                        Label(a.title, systemImage: a.symbol ?? "circle")
                    }
                    .disabled(!a.enabled)
                }
            }
        } label: {
            Label("More", systemImage: "ellipsis.circle")
        }
        .help("More things to do with this order")
    }
}
#endif
