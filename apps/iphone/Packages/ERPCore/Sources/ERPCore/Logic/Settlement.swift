// Ported from src/lib/machines/settlement.ts (tests: SettlementTests, from settlement.test.ts).
//
// An invoice's settlement, derived in ONE place: due, partly paid, paid, in credit or refunded. Not a stored status: a pure
// function of the invoice's status, balanceDue and amountPaid. Its labels and tones come from machines.json (`derived`)
// where the file is loaded; the tables below are the Swift rule's own fallback (the same words as the server's).
//
// Rules, in order: status "Refunded" wins (nothing is owed or held on a refunded invoice, whatever its balance still says);
// then whole rupees as everywhere (a balance under 1 rupee either way is settled).

import Foundation

public enum SettlementState: String, CaseIterable, Sendable {
    case due, partly, paid, credit, refunded
}

public enum SettlementRule {
    public static let name = "Invoice settlement"

    /// SETTLEMENT_LABELS.
    public static func fallbackLabel(_ s: SettlementState) -> String {
        switch s {
        case .due, .partly: return "Balance due"
        case .paid: return "Paid in full"
        case .credit: return "Credit to customer"
        case .refunded: return "Refunded"
        }
    }

    /// SETTLEMENT_TONES (the words of Tone(word:)).
    public static func fallbackTone(_ s: SettlementState) -> String {
        switch s {
        case .due: return "late"
        case .partly: return "owed"
        case .paid: return "settled"
        case .credit: return "credit"
        case .refunded: return "quiet"
        }
    }
}

public struct Settlement: Equatable, Sendable {
    public let state: SettlementState
    public let label: String
    public let tone: String
    /// What the customer owes, as stored (0 unless due or partly).
    public let amountDue: Double
    /// What the shop holds for the customer, positive (0 unless credit).
    public let credit: Double

    public init(state: SettlementState, label: String, tone: String, amountDue: Double = 0, credit: Double = 0) {
        self.state = state
        self.label = label
        self.tone = tone
        self.amountDue = amountDue
        self.credit = credit
    }
}

/// `Number(x) || 0`.
private func settlementNumber(_ x: Double?) -> Double {
    guard let x, !x.isNaN else { return 0 }
    return x
}

/// `settlementOf`: labels and tones from `machines` ("Invoice settlement" under `derived`) where it has them, else the fallback.
public func settlementOf(status: String?, balanceDue: Double?, amountPaid: Double?, machines: Machines = Machines.shared) -> Settlement {
    func make(_ state: SettlementState, _ amountDue: Double = 0, _ credit: Double = 0) -> Settlement {
        let word = machines.derivedLabel(SettlementRule.name, state.rawValue) ?? SettlementRule.fallbackLabel(state)
        let tone = machines.derivedTone(SettlementRule.name, state.rawValue) ?? SettlementRule.fallbackTone(state)
        return Settlement(state: state, label: word, tone: tone, amountDue: amountDue, credit: credit)
    }
    if status == "Refunded" { return make(.refunded) }
    let b = settlementNumber(balanceDue)
    if owesMoney(b) { return make(settlementNumber(amountPaid) > 0 ? .partly : .due, b) }
    if isCredit(b) { return make(.credit, 0, -b) }
    return make(.paid)
}

public func settlementOf(_ inv: Invoice?, machines: Machines = Machines.shared) -> Settlement {
    settlementOf(status: inv?.status?.rawValue, balanceDue: inv?.balanceDue, amountPaid: inv?.amountPaid, machines: machines)
}
