import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
import ERPCore

/// What both the list and a repair's sheet do to a ticket: Ready, Collected, a payment, Cancel. One
/// place for the writes (setRepairStatus, recordRepairPayment: owners only, the ERP refuses anyone
/// else), the questions they ask first, and the ERP's own words when it says no.
///
/// Collected while the ticket still owes asks first. The web's Hand back dialog always offers the
/// balance, and lets the amount go to nothing; here a ticket that owes asks "take it, or hand it
/// back as it is", and one that owes nothing is handed back at once.
@MainActor
@Observable
final class RepairsDesk {
    enum Ask: Identifiable {
        case collect(Repair)
        case cancel(Repair)

        var id: String {
            switch self {
            case .collect(let r): return "collect-" + r.id
            case .cancel(let r): return "cancel-" + r.id
            }
        }
    }

    /// The question on screen, if any.
    var asking: Ask?
    /// The ticket whose balance is being taken on the way out (Hand back).
    var paying: Repair?
    /// The ticket a payment is being taken on (Take payment).
    var taking: Repair?
    /// The ERP's words when a write was refused.
    var failure: String?
    private(set) var busy: Set<String> = []
    /// Statuses just chosen, by ticket: shown while the shelf's copy is still the old one.
    private var moved: [String: (from: RepairStatus, to: RepairStatus)] = [:]
    /// Bumped on each status move, so the screen can tap for it.
    private(set) var moves = 0
    /// Bumped as a payment lands, so the screen can tap for it (`moneyFeedback`).
    private(set) var paymentsTaken = 0
    /// Bumped when a write is refused, so the money tap can warn (`moneyFeedback`'s failure).
    private(set) var refusals = 0
    /// What was just done, said on the screen's toast (Ready, Collected, Cancelled).
    var note: Note?
    /// Tickets whose balance was taken on the way out but whose status write has not landed: a retry
    /// must not charge twice.
    @ObservationIgnored private var balanceTaken: Set<String> = []

    func isBusy(_ id: String) -> Bool { busy.contains(id) }

    // MARK: The steps

    func markReady(_ r: Repair) { setStatus(r, "ready") }

    func collect(_ r: Repair) {
        if busy.contains(r.id) { return }
        if RepairsKit.repairBalance(r) > 0 { asking = .collect(r) } else { setStatus(r, "collected") }
    }

    func askCancel(_ r: Repair) {
        if !busy.contains(r.id) { asking = .cancel(r) }
    }

    /// "received" | "ready" | "collected" | "cancelled".
    /// Not money: the ticket moves on the screen at once and the write goes through the Outbox.
    func setStatus(_ r: Repair, _ status: String) {
        let id = r.id
        moved[id] = (from: r.status, to: RepairStatus(rawValue: status))
        moves += 1
        say(Note(title: Self.words(id, status)))
        Outbox.shared.send(op: "setRepairStatus", fields: ["repairId": id, "status": status],
                           business: House.business, label: "\(id) status")
    }

    /// The status to show: the one just chosen until the shelf's copy has moved off the one it was.
    func status(_ r: Repair) -> RepairStatus {
        if let m = moved[r.id], m.from == r.status { return m.to }
        return r.status
    }

    /// The Outbox gave up on a change: show the shelf's copy again.
    func forgetMoves() { moved = [:] }

    /// "REP-000012 is ready".
    private static func words(_ id: String, _ status: String) -> String {
        switch status {
        case "ready": return "\(id) is ready"
        case "collected": return "\(id) is collected"
        case "cancelled": return "\(id) is cancelled"
        default: return "\(id) updated"
        }
    }

    private func say(_ n: Note) {
        Motion.run(Motion.enter, reduce: UIAccessibility.isReduceMotionEnabled) { note = n }
    }

    // MARK: Money

    /// A payment on the ticket (an advance later on, the balance after collection).
    func takePayment(_ r: Repair, amount: Double, method: String) async throws {
        _ = try await ERPAPI.shared.write("recordRepairPayment", ["repairId": r.id, "amount": amount, "method": method])
        paymentsTaken += 1
    }

    /// The page's Hand back: the money first (noted "On collection"), then Collected.
    func takeAndCollect(_ r: Repair, amount: Double, method: String) async throws {
        if !balanceTaken.contains(r.id) {
            _ = try await ERPAPI.shared.write("recordRepairPayment", [
                "repairId": r.id, "amount": amount, "method": method, "note": "On collection",
            ])
            balanceTaken.insert(r.id)
        }
        _ = try await ERPAPI.shared.write("setRepairStatus", ["repairId": r.id, "status": "collected"])
        balanceTaken.remove(r.id)
        paymentsTaken += 1
    }

    // MARK: One write at a time per ticket

    /// The shelf brings the change back within a second or so; until then the ticket stays busy, so a
    /// second tap cannot send the same step twice.
    private func run(_ id: String, _ work: @escaping @MainActor () async throws -> Void) {
        if busy.contains(id) { return }
        busy.insert(id)
        Task { @MainActor [self] in
            do {
                try await work()
                try? await Task.sleep(for: .seconds(1.5))
            } catch {
                self.failure = error.localizedDescription
                self.refusals += 1
            }
            self.busy.remove(id)
        }
    }
}

extension View {
    /// The questions, payment sheets and failure alert of a `RepairsDesk`.
    func repairsDesk(_ desk: RepairsDesk) -> some View {
        modifier(RepairsDeskModifier(desk: desk))
    }
}

private struct RepairsDeskModifier: ViewModifier {
    let desk: RepairsDesk

    func body(content: Content) -> some View {
        content
            .confirmationDialog(askTitle, isPresented: askShown, titleVisibility: .visible, presenting: desk.asking) { ask in
                askButtons(ask)
            } message: { ask in
                Text(askMessage(ask))
            }
            .sheet(item: payingBinding) { r in handBackSheet(r) }
            .sheet(item: takingBinding) { r in paymentSheet(r) }
            .failureAlert(failureBinding, title: "Not changed")
            .noteToast(noteBinding)
            .moneyFeedback(success: desk.paymentsTaken, failure: false)
            .savedFeedback(trigger: desk.moves)
            .onChange(of: Outbox.shared.failure?.id) { _, _ in desk.forgetMoves() }
    }

    // MARK: The questions

    private var askShown: Binding<Bool> {
        Binding(get: { desk.asking != nil }, set: { if !$0 { desk.asking = nil } })
    }

    private var askTitle: String {
        switch desk.asking {
        case .collect(let r): return "\(r.id) still owes \(Money.pkr(RepairsKit.repairBalance(r)))"
        case .cancel(let r): return "Cancel \(r.id)?"
        case nil: return ""
        }
    }

    private func askMessage(_ ask: RepairsDesk.Ask) -> String {
        switch ask {
        case .collect: return "Take it now, or hand the pieces back and leave it owing."
        case .cancel: return "Cancel keeps the record: the pieces are handed back unrepaired."
        }
    }

    @ViewBuilder
    private func askButtons(_ ask: RepairsDesk.Ask) -> some View {
        switch ask {
        case .collect(let r):
            Button("Take the balance") { desk.paying = r }
            Button("Hand back without it") { desk.setStatus(r, "collected") }
            Button("Not yet", role: .cancel) {}
        case .cancel(let r):
            Button("Cancel repair", role: .destructive) { desk.setStatus(r, "cancelled") }
            Button("Keep it", role: .cancel) {}
        }
    }

    // MARK: The sheets

    private var payingBinding: Binding<Repair?> {
        Binding(get: { desk.paying }, set: { desk.paying = $0 })
    }

    private var takingBinding: Binding<Repair?> {
        Binding(get: { desk.taking }, set: { desk.taking = $0 })
    }

    private var noteBinding: Binding<Note?> {
        Binding(get: { desk.note }, set: { desk.note = $0 })
    }

    private var failureBinding: Binding<String?> {
        Binding(get: { desk.failure }, set: { desk.failure = $0 })
    }

    private func handBackSheet(_ r: Repair) -> some View {
        PaymentSheet(title: "Hand back \(r.id)", owed: RepairsKit.repairBalance(r), askReference: false) { amount, method, _ in
            try await desk.takeAndCollect(r, amount: amount, method: method)
        }
        .houseForm()
    }

    private func paymentSheet(_ r: Repair) -> some View {
        let balance = RepairsKit.repairBalance(r)
        return PaymentSheet(title: "Payment on \(r.id)", owed: balance >= 1 ? balance : nil, askReference: false) { amount, method, _ in
            try await desk.takePayment(r, amount: amount, method: method)
        }
        .houseForm()
    }
}
