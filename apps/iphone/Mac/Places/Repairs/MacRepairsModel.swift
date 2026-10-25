#if os(macOS)
import SwiftUI
import ERPCore

// Repairs on the Mac (docs/features/mac-design.md, "Repairs"): the one model the place and a ticket's own window share, so a
// ticket's actions are declared once (`groups`) and drawn in the menu bar's Repair menu, the toolbar, the right-click menu and
// the inspector alike. Every write is the phone's: `RepairsDesk` (setRepairStatus, recordRepairPayment through its Outbox and
// ERPAPI), `RepairsForm` (addRepair, updateRepair) and `deleteRepair` with the delete code.

@MainActor
@Observable
final class MacRepairsModel {
    /// The steps and the money, as the phone takes them.
    let desk = RepairsDesk()
    /// Edit (⌘E): the ticket in the form, in a sheet.
    var editing: Repair?
    /// Collected on a ticket that still owes: the one question.
    var collecting: Repair?
    /// Delete…: the delete code's sheet, which says what goes with the ticket.
    var deletion: OwnerDeletion?
    /// The ticket was deleted: a window of its own closes.
    var deleted = false
    /// Tickets whose balance is being taken on the way out, so a second click cannot take it twice.
    private var handing: Set<String> = []

    // MARK: The steps

    /// Collected: a ticket that owes asks once ("Take PKR x and Hand Back" / "Hand Back Without It" / Cancel); one that owes
    /// nothing is handed back at once. Under a rupee is settled (decisions.md "Whole rupees").
    func collect(_ r: Repair) {
        if RepairsKit.repairBalance(r) >= 1 { collecting = r } else { desk.setStatus(r, "collected") }
    }

    /// The balance taken (in cash, the counter's way) and the ticket handed back, or handed back as it is.
    func handBack(_ r: Repair, takingBalance: Bool) {
        guard takingBalance else {
            desk.setStatus(r, "collected")
            return
        }
        let id = r.id
        if handing.contains(id) { return }
        handing.insert(id)
        let owed = RepairsKit.repairBalance(r).rounded()
        Task { [self] in
            do {
                try await desk.takeAndCollect(r, amount: owed, method: "Cash")
            } catch {
                desk.failure = error.localizedDescription
            }
            handing.remove(id)
        }
    }

    /// The web's "cancel or delete?": Delete removes the ticket for good, and the money paid on it comes out of Extra revenue
    /// with it. Said in the code's sheet, which is the one thing asked.
    func askDelete(_ r: Repair) {
        let id = r.id
        let paid = RepairsKit.repairPaid(r)
        var detail = "\(RepairsKit.repairSummary(r)) \u{2014} \(RepairsKit.customer(r)). Delete removes it for good"
        detail += paid > 0 ? ", and the \(Money.pkr(paid)) paid comes out of Extra revenue with it." : "."
        let s = desk.status(r)
        if s == .received || s == .ready { detail += " Cancel Repair keeps the record instead." }
        deletion = OwnerDeletion(what: "Delete repair \(id)", detail: detail) { code in
            _ = try await ERPAPI.shared.write("deleteRepair", ["repairId": id, "deleteCode": code])
        }
    }

    // MARK: The actions, declared once

    /// What can be done to the tickets picked, in the menu bar's order: the steps, then the receipt and edit, then cancel and
    /// delete. Everything is disabled while nothing is picked, and what only an owner may do is off for anyone else. The
    /// next step carries ⌘↩.
    func groups(_ picked: [Repair], owner: Bool, shopName: String, open: @escaping (URL) -> Void) -> [[MacAction]] {
        let one: Repair? = picked.count == 1 ? picked.first : nil
        let states = picked.map { desk.status($0) }
        let allInShop = !picked.isEmpty && states.allSatisfy { $0 == .received }
        let allReady = !picked.isEmpty && states.allSatisfy { $0 == .ready }
        let owesNothing = picked.allSatisfy { RepairsKit.repairBalance($0) < 1 }
        let next = KeyboardShortcut(.return, modifiers: .command)

        let ready = MacAction("Mark Ready", symbol: "checkmark.circle", shortcut: allInShop ? next : nil,
                              enabled: owner && allInShop, isDefault: true, id: "ready") { [self] in
            for r in picked { desk.markReady(r) }
        }
        let collected = MacAction("Collected\u{2026}", symbol: "shippingbox", shortcut: allReady ? next : nil,
                                  enabled: owner && allReady && (one != nil || owesNothing), isDefault: true, id: "collected") { [self] in
            if let one {
                collect(one)
            } else {
                for r in picked { desk.setStatus(r, "collected") }
            }
        }
        let tellURL: URL? = one.flatMap { RepairsKit.whatsAppURL(for: $0, shopName: shopName) }
        let isReady: Bool = one.map { desk.status($0) == .ready } ?? false
        let tell = MacAction("Tell Them It's Ready", symbol: "message",
                             enabled: isReady && tellURL != nil, id: "tell") {
            if let tellURL { open(tellURL) }
        }
        let pays = one.map { desk.status($0) != .cancelled && RepairsKit.repairBalance($0) >= 1 } ?? false
        let pay = MacAction("Take Payment\u{2026}", symbol: "banknote", enabled: owner && pays, id: "pay") { [self] in
            if let one { desk.taking = one }
        }
        let printIt = MacAction("Print Receipt", symbol: "printer", shortcut: KeyboardShortcut("p", modifiers: .command),
                              enabled: one != nil, id: "print") {
            if let one { MacPrint.print(Route(path: repairsTicketPath(one.id))) }
        }
        let edit = MacAction("Edit", symbol: "pencil", shortcut: KeyboardShortcut("e", modifiers: .command),
                             enabled: owner && one != nil, id: "edit") { [self] in
            if let one { editing = one }
        }
        let cancellable = one.map { desk.status($0) == .received || desk.status($0) == .ready } ?? false
        let cancel = MacAction("Cancel Repair\u{2026}", symbol: "xmark.circle", role: .destructive,
                               enabled: owner && cancellable, id: "cancel") { [self] in
            if let one { desk.askCancel(one) }
        }
        let delete = MacAction("Delete\u{2026}", symbol: "trash", role: .destructive, enabled: owner && one != nil, id: "delete") { [self] in
            if let one { askDelete(one) }
        }
        return [[ready, collected, tell, pay], [printIt, edit], [cancel, delete]]
    }
}
#endif
