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

export interface BillLine {
  description?: string | null;
  itemCategory?: string | null;
  metalType?: string | null;
  karat?: number | null;
  weightG?: number | null;
  /** Set when the slip was written in tola and weightG was converted. */
  weightWasTola?: boolean | null;
  stoneWeightG?: number | null;
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
    ...(karat ? { karat } : {}),
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
    stoneCharges: Number(line.stoneCharges) || 0,
    hasDiamonds: Number(line.diamondCharges) > 0,
    diamondCharges: Number(line.diamondCharges) || 0,
    makingCharges: Number(line.makingCharges) || 0,
    isCustomPrice: false,
    customPrice: 0,
  } as T;
}
