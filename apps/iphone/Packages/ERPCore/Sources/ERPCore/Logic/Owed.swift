// Ported from src/lib/owed.ts (tests: OwedTests, from owed.test.ts).
//
// What customers owe the shop: one figure, read the same way on the dashboard ("Owed to you"),
// the customer list, Invoices' "Awaiting payment" and Hisaab (the audit of 2026-10-01 found four
// sums: the customer list dropped every walk-in and every invoice with only a typed name).
//
// The rule: every invoice not refunded, its `balanceDue` above zero. An order carries no debt
// until it is invoiced (its advance is the customer's money already paid, not owed).
//
// Walk-ins count. A walk-in sale left owing is still money the shop is owed, so it is in the
// total; it has no customer to belong to (walk-in.ts), so it is gathered under one key,
// WALK_IN_ENTITY (the same one Analytics and Hisaab use), and an invoice with only a typed name
// under `name:<name>` (saleCustomerKey). The customer list shows those two as their own lines
// rather than silently leaving them out of its total.
//
// And what the hisaab holds by hand (2026-10-03, the owner: "yes add dads"): a customer's own
// ledger rows (the old khata, an opening balance, udhaar written in Hisaab) that no invoice
// keeps. Given the ledger, each customer's hand-written balance is added when it is owed to the
// shop (a customer the shop owes does not lower anyone else's debt). Rows linked to an invoice are
// that invoice's balance again and are left out; karigars' rows are not customers' debt.

import Foundation

/// An invoice that is still owed money on.
public func isOwing(_ inv: Invoice?) -> Bool {
    guard let inv else { return false }
    return inv.status != .refunded && inv.balanceDue > 0.5
}

/// A customer's rows in the order they were first seen, so the sums below add in the order the
/// TS adds them (a JavaScript `Map` remembers insertion order; a Swift dictionary does not).
private func ledgerBalanceList(_ rows: [HisaabEntry]) -> [(key: String, balance: Double)] {
    var order: [String] = []
    var sums: [String: Double] = [:]
    for r in rows {
        if r.entityId.isEmpty || r.entityType != .customer || JS.has(r.linkedInvoiceId) { continue }
        if sums[r.entityId] == nil { order.append(r.entityId) }
        sums[r.entityId, default: 0] += r.cashDebit - r.cashCredit
    }
    return order.map { ($0, sums[$0]!) }
}

/// Each customer's hand-written hisaab balance (debit less credit), from rows no invoice keeps.
public func ledgerBalances(_ rows: [HisaabEntry]) -> [String: Double] {
    Dictionary(uniqueKeysWithValues: ledgerBalanceList(rows).map { ($0.key, $0.balance) })
}

public struct OwedAmount: Equatable {
    public var amount: Double
    /// Invoices; 0 for a customer only the ledger knows.
    public var count: Int

    public init(amount: Double, count: Int) {
        self.amount = amount
        self.count = count
    }
}

public struct Owed {
    /// Everything owed, walk-ins and the hisaab's hand-written balances included.
    public let total: Double
    /// The invoices owed on, oldest first: the one to chase.
    public let invoices: [Invoice]
    /// By customer: a customer id, WALK_IN_ENTITY, or `name:<typed name>`. `count` is invoices.
    public let byKey: [String: OwedAmount]
    /// What walk-in sales still owe (also in byKey under WALK_IN_ENTITY).
    public let walkIn: Double
    /// What invoices with only a typed name owe (under `name:` keys).
    public let nameOnly: Double
    /// What the hisaab holds by hand (also in total and byKey). 0 when no ledger was given.
    public let ledger: Double
}

public func owedToYou(
    _ invoices: [Invoice],
    currentName: ((String) -> String?)? = nil,
    ledgerRows: [HisaabEntry]? = nil
) -> Owed {
    let owing = invoices.filter { isOwing($0) }.jsSorted { Double(JS.localeCompare($0.createdAt, $1.createdAt)) }
    var byKey: [String: OwedAmount] = [:]
    var total = 0.0, walkIn = 0.0, nameOnly = 0.0, ledger = 0.0
    for inv in owing {
        let due = inv.balanceDue
        total += due
        let key = saleCustomerKey(inv, currentName: currentName)
        if key == WALK_IN_ENTITY { walkIn += due }
        else if key.hasPrefix("name:") { nameOnly += due }
        var cur = byKey[key] ?? OwedAmount(amount: 0, count: 0)
        cur.amount += due
        cur.count += 1
        byKey[key] = cur
    }
    if let ledgerRows {
        for (key, balance) in ledgerBalanceList(ledgerRows) {
            if balance <= 0.5 { continue }
            total += balance
            ledger += balance
            if key == WALK_IN_ENTITY { walkIn += balance }
            var cur = byKey[key] ?? OwedAmount(amount: 0, count: 0)
            cur.amount += balance
            byKey[key] = cur
        }
    }
    return Owed(total: total, invoices: owing, byKey: byKey, walkIn: walkIn, nameOnly: nameOnly, ledger: ledger)
}
