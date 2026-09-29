/**
 * Reading a written bill into an invoice.
 *
 * The counterpart to the parchi scanner: that one drafts work to be made, this one
 * drafts a sale already agreed. Same rule at the end of it — nothing is created. The
 * lines land in the cart, priced and editable, and the shopkeeper generates the
 * invoice.
 *
 * THE WHOLE DESIGN IS IN ONE DISTINCTION: whether a line shows its working.
 *
 *   Broken down   "Chain 21k · 12.4g · making 3,500"  → a priced line. Weight, karat
 *                 and making go in, and the total is computed from the shop's rate,
 *                 the same arithmetic every other line in the book goes through.
 *
 *   Not broken    "Box chain ......... 45,000"        → a manual-price line at exactly
 *                 that figure. No weight is invented to justify it.
 *
 * That second case is why this is not just the order scanner pointed at a different
 * form. A bill written as a name and a number is a complete, agreed sale; back-solving
 * a weight from the total would put figures on a customer's invoice that nobody wrote
 * and nobody checked, and they would look exactly as authoritative as the real ones.
 */

import { rankNames, type RankedName, type RosterEntry } from '@/lib/voice/phonetics';
import { wastagePercentOf } from '@/lib/vision/wastage';

export interface BillLine {
  description?: string | null;
  itemCategory?: string | null;
  metalType?: string | null;
  karat?: number | null;
  weightG?: number | null;
  /** Set when the slip was written in tola and weightG was converted. */
  weightWasTola?: boolean | null;
  stoneWeightG?: number | null;
  /** Wastage as written: grams ("+ 0.650") or, less often, a percent. See vision/wastage.ts. */
  wastageG?: number | null;
  wastagePercent?: number | null;
  /** The rate this line was priced at, per gram (its own or the bill's), as written. */
  ratePerGram?: number | null;
  rateWasPerTola?: boolean | null;
  makingCharges?: number | null;
  stoneCharges?: number | null;
  diamondCharges?: number | null;
  /** The line's own total as written. The only figure a bare line carries. */
  lineTotal?: number | null;
  /**
   * The model's own answer to the question above: did this line show its working?
   * Trusted only as a hint — hasBreakdown() decides from the fields that arrived.
   */
  brokenDown?: boolean | null;
  note?: string | null;
}

export interface RawBillDraft {
  lines?: BillLine[] | null;
  /** A rate written once for the whole bill ("Rate 34,000"), per gram. */
  ratePerGram?: number | null;
  rateWasPerTola?: boolean | null;
  customerNameHeard?: string | null;
  customerPhone?: string | null;
  /** As written at the foot of the bill, for checking against what we compute. */
  subtotal?: number | null;
  discount?: number | null;
  grandTotal?: number | null;
  amountPaid?: number | null;
  date?: string | null;
  unreadable?: string | null;
}

export interface NameGuess {
  heard: string;
  pinned: RankedName | null;
  candidates: RankedName[];
}

export interface BillDraft extends Omit<RawBillDraft, 'customerNameHeard'> {
  customer: NameGuess | null;
}

/**
 * Does this line carry enough to be priced from the rate?
 *
 * A weight is the whole question. Making charges without a weight price nothing, and a
 * karat without a weight is a note. Judged from what actually arrived rather than from
 * the model's own `brokenDown` flag, which is a guess about its own output.
 */
export const hasBreakdown = (l: BillLine): boolean =>
  Number(l.weightG) > 0;

/** A line's figure as written, when it did not show its working. */
export const writtenTotal = (l: BillLine): number =>
  Number(l.lineTotal) > 0 ? Number(l.lineTotal) : 0;

/**
 * The customer, ranked but not decided.
 *
 * Same bar as the parchi scanner, and for the same reason: a name off handwriting is a
 * worse signal than a name off speech, and an invoice raised against the wrong person
 * is a debt on a stranger's account.
 */
export function guessCustomer(heard: string | null | undefined, pool: RosterEntry[]): NameGuess | null {
  const text = String(heard ?? '').trim();
  if (!text) return null;
  const ranked = rankNames(text, pool);
  const top = ranked[0];
  const next = ranked[1];
  const decisive = Boolean(top && top.score >= 0.88 && (!next || top.score - next.score >= 0.15));
  return {
    heard: text,
    pinned: decisive ? top : null,
    candidates: ranked.filter((r) => r.score > 0.45).slice(0, 5),
  };
}

export function resolveBill(raw: RawBillDraft, customers: RosterEntry[]): BillDraft {
  const { customerNameHeard, ...rest } = raw;
  return { ...rest, customer: guessCustomer(customerNameHeard, customers) };
}

/**
 * What the bill says it totals, against what its lines actually add up to.
 *
 * Worth surfacing rather than silently trusting either. A mismatch usually means a
 * line was missed on a crowded slip — which is exactly the failure the shopkeeper can
 * see in a second and the model cannot see at all.
 */
export function reconcile(draft: BillDraft, computed: number): {
  written: number | null; computed: number; differs: boolean;
} {
  const written = Number(draft.grandTotal) > 0 ? Number(draft.grandTotal)
    : Number(draft.subtotal) > 0 ? Number(draft.subtotal)
    : null;
  // A rupee of rounding is not a discrepancy; a missed line is.
  const differs = written !== null && Math.abs(written - computed) > 1;
  return { written, computed, differs };
}

/**
 * The shop's categories, for the handful of words a bill actually uses.
 *
 * Deliberately partial. "Set" could be any of seven set categories in the book and
 * "Necklace" is none of them exactly — those come through with no category, which the
 * form shows as an empty field somebody fills in. A category guessed wrong is quieter
 * than an empty one and therefore worse.
 */
const CATEGORY_BY_WORD: Record<string, string> = {
  Ring: 'cat001', Tops: 'cat002', Earrings: 'cat002', Jhumka: 'cat003',
  Pendant: 'cat004', Bracelet: 'cat005', Bangle: 'cat007', Kara: 'cat007',
  Chain: 'cat008',
};

const KARAT_BY_METAL: Record<string, number[]> = {
  gold: [18, 21, 22, 24],
  palladium: [12, 18],
  platinum: [],
  silver: [],
};

/**
 * One written line, as a cart item.
 *
 * The fork described at the top of this file lands here. A line that showed a weight is
 * built as an ordinary priced line and goes through the same arithmetic as anything
 * typed at the counter — change the rate later and it moves, as it should. A line that
 * showed only a figure is built as a manual price at exactly that figure, carrying a
 * weight of zero, because zero is the honest answer to a question the bill did not ask.
 */
export function billLineToProduct<T extends Record<string, unknown>>(
  line: BillLine,
  blank: T,
  fallbackMetal: string,
): T {
  const metal = String(line.metalType || fallbackMetal);
  const allowed = KARAT_BY_METAL[metal] ?? [];
  const karat = Number(line.karat) > 0 && allowed.includes(Number(line.karat))
    ? `${Number(line.karat)}k`
    : undefined;

  const base = {
    ...blank,
    name: String(line.description || '').trim() || 'Item',
    categoryId: CATEGORY_BY_WORD[String(line.itemCategory || '')] ?? '',
    metalType: metal,
    // A gold line with no karat written is 21k, the shop's default everywhere.
    ...(karat ? { karat } : metal === 'gold' ? { karat: '21k' } : {}),
    description: line.note ? String(line.note) : undefined,
  };

  if (!hasBreakdown(line)) {
    return { ...base, metalWeightG: 0, isCustomPrice: true, customPrice: writtenTotal(line) } as T;
  }

  return {
    ...base,
    metalWeightG: Number(line.weightG) || 0,
    hasStones: Number(line.stoneWeightG) > 0 || Number(line.stoneCharges) > 0,
    stoneWeightG: Number(line.stoneWeightG) || 0,
    // The bill's own wastage when it wrote one, so the line prices as the paper did.
    ...(wastagePercentOf(line) !== null ? { wastagePercentage: wastagePercentOf(line) } : {}),
    stoneCharges: Number(line.stoneCharges) || 0,
    hasDiamonds: Number(line.diamondCharges) > 0,
    diamondCharges: Number(line.diamondCharges) || 0,
    makingCharges: Number(line.makingCharges) || 0,
    isCustomPrice: false,
    customPrice: 0,
  } as T;
}

/**
 * The rates the bill was priced at, by the cart's rate boxes ("gold21k": 34000).
 *
 * A broken-down line priced at the bill's rate comes to the bill's figure; priced at today's
 * rate it doesn't, and the scanned total then disagrees with the paper for no reason anyone
 * can see. So a rate written on the bill — on the line, or once at the top — sets that karat's
 * box. Gold only (the other metals' boxes are not per karat the same way, and silver is all-in);
 * a karat priced at two different rates on one bill sets nothing, since one box can't hold both.
 */
export function billRates(lines: BillLine[], billRate: number | null | undefined, fallbackMetal: string): Record<string, number> {
  const seen = new Map<string, Set<number>>();
  for (const l of lines) {
    if (!hasBreakdown(l)) continue;
    const metal = String(l.metalType || fallbackMetal);
    if (metal !== 'gold') continue;
    const rate = Number(l.ratePerGram) > 0 ? Number(l.ratePerGram) : Number(billRate) > 0 ? Number(billRate) : 0;
    if (!rate) continue;
    const k = Number(l.karat) > 0 && KARAT_BY_METAL.gold.includes(Number(l.karat)) ? Number(l.karat) : 21;
    const key = `gold${k}k`;
    if (!seen.has(key)) seen.set(key, new Set());
    seen.get(key)!.add(Math.round(rate * 100) / 100);
  }
  const out: Record<string, number> = {};
  for (const [key, rates] of seen) if (rates.size === 1) out[key] = [...rates][0];
  return out;
}
