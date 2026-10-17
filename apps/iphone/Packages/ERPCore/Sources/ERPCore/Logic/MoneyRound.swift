// Ported from src/lib/money-round.ts (tests: MoneyRoundTests, from money-round.test.ts and the whole-rupee
// cases of money.test.ts).
//
// Whole-rupee money: every rule, as pure functions, in this one module (owner, 2026-10-17: "there should be
// no decimals"; "offer discount options to round the bill for any amount under 5000"). The web, the
// server's /api/app/write ops and the shared writes (lib/writes/*) all call the TypeScript; the app calls this.
//
// ROUNDING RULE. A money amount is rounded with Math.round (half up: x.5 goes to x+1; -0 is 0) at the
// moment it is computed, never after summing:
//   - a piece's lines (metal = weight x rate, wastage = rounded metal x %, making, diamonds, stones,
//     misc) are each rounded, and the piece's total is the SUM of its rounded lines (Pricing.swift);
//   - a fixed price is rounded;
//   - the subtotal is the sum of the rounded piece totals; there is no per-line discount;
//   - the bill's discount, the exchange values, each payment/advance/refund are rounded integers;
//   - grand total = subtotal - discount - exchange; balance = grand total - paid. All integers.
// Weights (g), rates per gram and percentages keep their decimals; only money amounts are integers.
// Settled: a balance under 1 rupee either way (|b| < 1) is paid, so old bills with paise are not debts.
//
// ROUND-OFF OFFERS. From total T (after any discount already typed), round DOWN to the nearest
// 100, 500, 1,000, 5,000, 10,000: target = floor(T/step)*step, extra = T - target. Keep target > 0 and
// 0 < extra < 5,000, order by roundness (coarsest step first: 10,000, 5,000, 1,000, 500, 100), drop
// duplicate targets (the coarsest step's entry stays), give at most 3.
// SETTLE: after a payment, a remainder R with 0 < R < 5,000 may be given off by adding R to the discount.

import Foundation

/// A money amount as whole rupees (halves up, as JavaScript's Math.round: -2.5 is -2; never -0; anything
/// unreadable or infinite is 0).
public func rupees(_ n: Double?) -> Double {
    guard let n else { return 0 }
    let v = JS.round(n)
    return v.isFinite ? v + 0 : 0
}

/// `rupees(Number(x))` for a value of any kind, as the TypeScript's `unknown` reads it: a number, a
/// numeric text ("12500" — but "12,500" is NaN, so 0), a boolean; anything else is 0.
public func rupees(any n: Any?) -> Double {
    switch n {
    case nil: return 0
    case let d as Double: return rupees(d)
    case let i as Int: return rupees(Double(i))
    case let b as Bool: return b ? 1 : 0
    case let s as String: return rupees(JS.toNumber(s))
    case let x as NSNumber: return rupees(x.doubleValue)
    default: return 0
    }
}

/// What a typed amount means: digits only, so "12,500.75" and "12500.75" both read 12501.
public func wholeRupeesFromText(_ s: String?) -> Double {
    rupees(JS.toNumber((s ?? "").replacingOccurrences(of: ",", with: "")))
}

/// Under one rupee either way is settled: a balance left from before money was whole rupees is not a debt.
public let SETTLED_UNDER: Double = 1

/// `Number(x) || 0`: a missing or unreadable balance is nothing.
private func balanceOf(_ b: Double?) -> Double {
    guard let b, !b.isNaN else { return 0 }
    return b
}

public func isSettled(_ balanceDue: Double?) -> Bool { abs(balanceOf(balanceDue)) < SETTLED_UNDER }
public func owesMoney(_ balanceDue: Double?) -> Bool { balanceOf(balanceDue) >= SETTLED_UNDER }
public func isCredit(_ balanceDue: Double?) -> Bool { balanceOf(balanceDue) <= -SETTLED_UNDER }

/// 297,000 — grouped, never a decimal.
public func rupeeText(_ n: Double?) -> String { Money.grouped(rupees(n)) }

/// PKR 297,000 — the one way a bill, a message or a list shows money.
public func pkr(_ n: Double?) -> String { "PKR \(rupeeText(n))" }

/// Those of `obj`'s money fields that are present, as whole rupees (to spread over a document being written).
/// Absent, null (NSNull) and empty text are left out.
public func rupeesIn(_ obj: [String: Any], _ keys: [String]) -> [String: Double] {
    var out: [String: Double] = [:]
    for k in keys {
        guard let v = obj[k], !(v is NSNull) else { continue }
        if let s = v as? String, s.isEmpty { continue }
        out[k] = rupees(any: v)
    }
    return out
}

/// A piece's total from its lines: each line rounded, then summed (the printed bill adds up).
public func lineTotal(_ lines: [Double?]) -> Double { lines.reduce(0) { $0 + rupees($1) } }
/// A bill's subtotal: the sum of its pieces' (already rounded) totals.
public func totalOfLines(_ totals: [Double?]) -> Double { lineTotal(totals) }

/// The round numbers a bill is rounded down to.
public let ROUND_OFF_STEPS: [Double] = [100, 500, 1_000, 5_000, 10_000]
/// The same steps, coarsest first: the order the chips are offered in.
private let STEPS_COARSEST_FIRST: [Double] = ROUND_OFF_STEPS.reversed()
/// An extra discount must be under this to be offered (and a leftover under it can be settled).
public let ROUND_OFF_LIMIT: Double = 5_000
/// At most this many chips are shown.
public let ROUND_OFF_MAX_OFFERS = 3

public struct RoundOffOffer: Hashable {
    /// The bill's whole discount once taken: the one already typed plus `extra`.
    public var discount: Double?
    /// What the bill comes to once taken.
    public var target: Double
    /// The extra discount that gets it there (> 0, < ROUND_OFF_LIMIT).
    public var extra: Double

    public init(discount: Double? = nil, target: Double, extra: Double) {
        self.discount = discount
        self.target = target
        self.extra = extra
    }
}

/// The offers for a bill that comes to `total` (subtotal less the discount typed so far and the
/// exchange, before any round-off): round down to the nearest 100, 500, 1,000, 5,000 and 10,000,
/// keep those whose extra discount is more than 0 and under 5,000, and give the three roundest
/// (coarsest step first; a target two steps reach is listed once, under the coarser). Nothing when the
/// total is already round, is under 100 (rounding down would be free), or no step qualifies.
public func roundOffOffers(_ total: Double?, _ existingDiscount: Double? = 0) -> [RoundOffOffer] {
    let t = rupees(total) - rupees(existingDiscount)
    if !(t > 0) { return [] }
    var out: [RoundOffOffer] = []
    for step in STEPS_COARSEST_FIRST {
        let target = (t / step).rounded(.down) * step
        let extra = t - target
        if target > 0 && extra > 0 && extra < ROUND_OFF_LIMIT && !out.contains(where: { $0.target == target }) {
            out.append(RoundOffOffer(discount: rupees(existingDiscount) + extra, target: target, extra: extra))
        }
    }
    return Array(out.prefix(ROUND_OFF_MAX_OFFERS))
}

/// The discount once an offer is taken: whatever was already typed, plus the extra.
public func discountWithOffer(_ discount: Double?, _ offer: RoundOffOffer) -> Double { rupees(discount) + offer.extra }

/// What is left to pay after a payment, when it is small enough to give away: the leftover (> 0, under
/// 5,000) as an extra discount, so the balance becomes 0 without a payment that was never made.
/// Nil for a balance that is settled, overpaid (negative), or 5,000 and over.
public func settleRemainderOffer(_ remaining: Double?) -> Double? {
    let r = rupees(remaining)
    return r > 0 && r < ROUND_OFF_LIMIT ? r : nil
}

/// "Round to 270,000 · −2,340"
public func roundOffLabel(_ o: RoundOffOffer) -> String {
    "Round to \(Money.grouped(o.target)) · −\(Money.grouped(o.extra))"
}
