import SwiftUI
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
    func setStatus(_ r: Repair, _ status: String) {
        let id = r.id
        run(id) {
            _ = try await ERPAPI.shared.write("setRepairStatus", ["repairId": id, "status": status])
        }
    }

    // MARK: Money

    /// A payment on the ticket (an advance later on, the balance after collection).
    func takePayment(_ r: Repair, amount: Double, method: String) async throws {
        _ = try await ERPAPI.shared.write("recordRepairPayment", ["repairId": r.id, "amount": amount, "method": method])
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
            .alert("Not changed", isPresented: failureShown) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(desk.failure ?? "")
            }
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

    private var failureShown: Binding<Bool> {
        Binding(get: { desk.failure != nil }, set: { if !$0 { desk.failure = nil } })
    }

    private func handBackSheet(_ r: Repair) -> some View {
        PaymentSheet(title: "Hand back \(r.id)", owed: RepairsKit.repairBalance(r), askReference: false) { amount, method, _ in
            try await desk.takeAndCollect(r, amount: amount, method: method)
        }
    }

    private func paymentSheet(_ r: Repair) -> some View {
        let balance = RepairsKit.repairBalance(r)
        return PaymentSheet(title: "Payment on \(r.id)", owed: balance > 0 ? balance : nil, askReference: false) { amount, method, _ in
            try await desk.takePayment(r, amount: amount, method: method)
        }
    }
}
