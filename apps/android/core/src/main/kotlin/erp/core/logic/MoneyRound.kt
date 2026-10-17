// Ported from src/lib/money-round.ts (and apps/iphone ERPCore MoneyRound.swift; tests: MoneyRoundTests, from
// money-round.test.ts and the whole-rupee cases of money.test.ts).
//
// Whole-rupee money: every rule, as pure functions, in this one module (owner, 2026-10-17: "there should be
// no decimals"; "offer discount options to round the bill for any amount under 5000"). The web, the
// server's /api/app/write ops and the shared writes (lib/writes/*) all call the TypeScript; the app calls this.
//
// ROUNDING RULE. A money amount is rounded with Math.round (half up: x.5 goes to x+1; -0 is 0) at the
// moment it is computed, never after summing:
//   - a piece's lines (metal = weight x rate, wastage = rounded metal x %, making, diamonds, stones,
//     misc) are each rounded, and the piece's total is the SUM of its rounded lines (Pricing.kt);
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

package erp.core.logic

import kotlin.math.abs
import kotlin.math.floor

/** A money amount as whole rupees (halves up, as JavaScript's Math.round: -2.5 is -2; never -0; anything unreadable or infinite is 0). */
fun rupees(n: Double?): Double {
    if (n == null) return 0.0
    val v = JS.round(n)
    return if (v.isFinite()) v + 0.0 else 0.0
}

/**
 * `rupees(Number(x))` for a value of any kind, as the TypeScript's `unknown` reads it: a number, a
 * numeric text ("12500" — but "12,500" is NaN, so 0), a boolean; anything else is 0. (Swift's `rupees(any:)`.)
 */
fun rupeesAny(n: Any?): Double = when (n) {
    null -> 0.0
    is Double -> rupees(n)
    is Number -> rupees(n.toDouble())
    is Boolean -> if (n) 1.0 else 0.0
    is String -> rupees(JS.toNumber(n))
    else -> 0.0
}

/** What a typed amount means: digits only, so "12,500.75" and "12500.75" both read 12501. */
fun wholeRupeesFromText(s: String?): Double = rupees(JS.toNumber((s ?: "").replace(",", "")))

/** Under one rupee either way is settled: a balance left from before money was whole rupees is not a debt. */
const val SETTLED_UNDER: Double = 1.0

/** `Number(x) || 0`: a missing or unreadable balance is nothing. */
private fun balanceOf(b: Double?): Double = if (b == null || b.isNaN()) 0.0 else b

fun isSettled(balanceDue: Double?): Boolean = abs(balanceOf(balanceDue)) < SETTLED_UNDER
fun owesMoney(balanceDue: Double?): Boolean = balanceOf(balanceDue) >= SETTLED_UNDER
fun isCredit(balanceDue: Double?): Boolean = balanceOf(balanceDue) <= -SETTLED_UNDER

/** 297,000 — grouped, never a decimal. */
fun rupeeText(n: Double?): String = Money.grouped(rupees(n))

/** PKR 297,000 — the one way a bill, a message or a list shows money. */
fun pkr(n: Double?): String = "PKR ${rupeeText(n)}"

/**
 * Those of `obj`'s money fields that are present, as whole rupees (to spread over a document being written).
 * Absent, null and empty text are left out.
 */
fun rupeesIn(obj: Map<String, Any?>, keys: List<String>): Map<String, Double> {
    val out = LinkedHashMap<String, Double>()
    for (k in keys) {
        val v = obj[k] ?: continue
        if (v is String && v.isEmpty()) continue
        out[k] = rupeesAny(v)
    }
    return out
}

/** A piece's total from its lines: each line rounded, then summed (the printed bill adds up). */
fun lineTotal(lines: List<Double?>): Double = lines.fold(0.0) { acc, l -> acc + rupees(l) }

/** A bill's subtotal: the sum of its pieces' (already rounded) totals. */
fun totalOfLines(totals: List<Double?>): Double = lineTotal(totals)

/** The round numbers a bill is rounded down to. */
val ROUND_OFF_STEPS: List<Double> = listOf(100.0, 500.0, 1_000.0, 5_000.0, 10_000.0)

/** The same steps, coarsest first: the order the chips are offered in. */
private val STEPS_COARSEST_FIRST: List<Double> = ROUND_OFF_STEPS.reversed()

/** An extra discount must be under this to be offered (and a leftover under it can be settled). */
const val ROUND_OFF_LIMIT: Double = 5_000.0

/** At most this many chips are shown. */
const val ROUND_OFF_MAX_OFFERS: Int = 3

data class RoundOffOffer(
    /** What the bill comes to once taken. */
    val target: Double,
    /** The extra discount that gets it there (> 0, < ROUND_OFF_LIMIT). */
    val extra: Double,
    /** The bill's whole discount once taken: the one already typed plus `extra`. */
    val discount: Double? = null,
)

/**
 * The offers for a bill that comes to `total` (subtotal less the discount typed so far and the
 * exchange, before any round-off): round down to the nearest 100, 500, 1,000, 5,000 and 10,000,
 * keep those whose extra discount is more than 0 and under 5,000, and give the three roundest
 * (coarsest step first; a target two steps reach is listed once, under the coarser). Nothing when the
 * total is already round, is under 100 (rounding down would be free), or no step qualifies.
 */
fun roundOffOffers(total: Double?, existingDiscount: Double? = 0.0): List<RoundOffOffer> {
    val t = rupees(total) - rupees(existingDiscount)
    if (!(t > 0)) return emptyList()
    val out = mutableListOf<RoundOffOffer>()
    for (step in STEPS_COARSEST_FIRST) {
        val target = floor(t / step) * step
        val extra = t - target
        if (target > 0 && extra > 0 && extra < ROUND_OFF_LIMIT && out.none { it.target == target }) {
            out.add(RoundOffOffer(target = target, extra = extra, discount = rupees(existingDiscount) + extra))
        }
    }
    return out.take(ROUND_OFF_MAX_OFFERS)
}

/** The discount once an offer is taken: whatever was already typed, plus the extra. */
fun discountWithOffer(discount: Double?, offer: RoundOffOffer): Double = rupees(discount) + offer.extra

/**
 * What is left to pay after a payment, when it is small enough to give away: the leftover (> 0, under
 * 5,000) as an extra discount, so the balance becomes 0 without a payment that was never made.
 * Null for a balance that is settled, overpaid (negative), or 5,000 and over.
 */
fun settleRemainderOffer(remaining: Double?): Double? {
    val r = rupees(remaining)
    return if (r > 0 && r < ROUND_OFF_LIMIT) r else null
}

/** "Round to 270,000 · −2,340" */
fun roundOffLabel(o: RoundOffOffer): String = "Round to ${Money.grouped(o.target)} · −${Money.grouped(o.extra)}"
