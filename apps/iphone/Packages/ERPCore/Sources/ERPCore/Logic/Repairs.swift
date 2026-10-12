// Ported from src/lib/repairs.ts (a repair ticket's sums and its line). Nothing is stored for the total,
// the paid sum or the balance: they are read from `pieces` and `payments`, here, once, for every screen.

import Foundation

public func repairTotal(_ r: Repair) -> Double {
    // `Number(p.price) || 0`: a missing or NaN price counts as nothing.
    r.pieces.reduce(0) { sum, p in
        let price = p.price ?? 0
        return sum + (price.isNaN ? 0 : price)
    }
}

public func repairPaid(_ r: Repair) -> Double {
    r.payments.reduce(0) { sum, p in sum + (p.amount.isNaN ? 0 : p.amount) }
}

/// What the customer still owes on the ticket.
public func repairBalance(_ r: Repair) -> Double {
    max(0, JS.round((repairTotal(r) - repairPaid(r)) * 100) / 100)
}

/// "Gold ring" or "Gold ring + 2 more": a ticket in a line.
public func repairSummary(_ r: Repair) -> String {
    let named = r.pieces.filter { !$0.item.isEmpty }
    if named.isEmpty { return "Repair" }
    return named.count == 1 ? named[0].item : "\(named[0].item) + \(named.count - 1) more"
}
