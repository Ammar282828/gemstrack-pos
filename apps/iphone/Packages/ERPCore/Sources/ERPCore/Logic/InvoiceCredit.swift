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

/// Under half a rupee either way is settled: paise from rounding are not a debt or a credit.
private let SETTLED = 0.5

/// `Number(x) || 0`: a missing or unreadable balance is nothing.
private func balance(_ balanceDue: Double?) -> Double {
    guard let b = balanceDue, !b.isNaN else { return 0 }
    return b
}

public func inCredit(_ balanceDue: Double?) -> Bool { balance(balanceDue) < -SETTLED }

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

    public init(label: String, amount: Double, state: BalanceState) {
        self.label = label
        self.amount = amount
        self.state = state
    }
}

public func balanceLine(_ balanceDue: Double?) -> BalanceLine {
    let b = balance(balanceDue)
    if b > SETTLED { return BalanceLine(label: "Balance due", amount: b, state: .due) }
    if b < -SETTLED { return BalanceLine(label: "Credit to customer", amount: -b, state: .credit) }
    return BalanceLine(label: "Paid in full", amount: 0, state: .paid)
}
