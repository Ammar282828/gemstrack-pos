// Ported from src/lib/invoice-credit.ts (tests: InvoiceCreditTests, from invoice-credit.test.ts).
//
// An invoice in credit: the customer has paid more than it comes to, and the shop holds the
// difference for them (owner, 2026-10-07: "allow invoices to go into credit").
//
// A balance below zero is that credit. It is held only for a named customer, on their hisaab,
// where it nets against what they owe and shows as owed to them; a walk-in has no hisaab, so
// money over the total from nobody in particular is change to hand back, not credit.

import Foundation

/// The ledger row that carries an invoice's credit.
public func creditDescription(_ invoiceId: String) -> String { "Credit held for Invoice \(invoiceId)" }

/// Written by the ledger sync before credit could be taken on purpose; still a credit row.
private func legacyCreditDescription(_ invoiceId: String) -> String { "Excess advance returned for Invoice \(invoiceId)" }

/// Whether a hisaab row is the credit row of `invoiceId` (the TS takes only description, cashCredit, cashDebit).
public func isCreditRow(_ row: HisaabEntry, _ invoiceId: String) -> Bool {
    row.cashCredit > 0 && (row.description == creditDescription(invoiceId) || row.description == legacyCreditDescription(invoiceId))
}

/// `Number(x) || 0`: a missing or unreadable balance is nothing.
private func balance(_ balanceDue: Double?) -> Double {
    guard let b = balanceDue, !b.isNaN else { return 0 }
    return b
}

/// Under one rupee either way is settled: money is whole rupees (2026-10-17), and a fraction left on a
/// bill from before is not a debt or a credit (MoneyRound.swift SETTLED_UNDER).
public func inCredit(_ balanceDue: Double?) -> Bool { isCredit(balanceDue) }

public func canHoldCredit(_ customerId: String?) -> Bool {
    guard let id = customerId, !id.isEmpty else { return false }
    return id != WALK_IN_ENTITY
}

public enum BalanceState: String, Hashable {
    case due, paid, credit
}

/// How an invoice's balance reads, everywhere it is shown, printed or sent.
public struct BalanceLine: Equatable {
    public let label: String
    public let amount: Double
    public let state: BalanceState
    /// True for a refunded invoice (balanceLine(_:status:)): `state` reads .paid, the label "Refunded", the amount 0, so no
    /// screen shows a balance or a credit on it. Screens that switch on `state` keep working; test this first.
    public let refunded: Bool

    public init(label: String, amount: Double, state: BalanceState, refunded: Bool = false) {
        self.label = label
        self.amount = amount
        self.state = state
        self.refunded = refunded
    }
}

/// Pass the invoice's `status` wherever it is known: a refunded invoice owes nothing and holds nothing, whatever its balance
/// still says (machines/settlement.ts). The words come from `settlementOf` (machines.json where loaded).
public func balanceLine(_ balanceDue: Double?, status: String? = nil) -> BalanceLine {
    let s = settlementOf(status: status, balanceDue: balanceDue, amountPaid: nil)
    switch s.state {
    case .refunded: return BalanceLine(label: s.label, amount: 0, state: .paid, refunded: true)
    case .credit: return BalanceLine(label: s.label, amount: s.credit, state: .credit)
    case .paid: return BalanceLine(label: s.label, amount: 0, state: .paid)
    case .due, .partly: return BalanceLine(label: s.label, amount: s.amountDue, state: .due)
    }
}

/// The same, from the invoice (`balanceLineOf`).
public func balanceLineOf(_ inv: Invoice) -> BalanceLine { balanceLine(inv.balanceDue, status: inv.status?.rawValue) }
