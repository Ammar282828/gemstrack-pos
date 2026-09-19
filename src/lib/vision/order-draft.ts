/**
 * Reading an order off a photograph.
 *
 * A parchi comes across the counter, or a picture of the piece arrives on WhatsApp, and
 * the same details get typed into the order form by hand. This reads the photo and fills
 * that form in — and then stops. It never creates an order.
 *
 * That stopping point is the whole design. Everywhere else in this book a name is pinned
 * to a real row before anything is recorded, and the voice assistant refuses outright to
 * choose between two people called Alifya. A model reading somebody's handwriting is
 * guessing MORE, not less, than a model listening to speech: a 4 that is really a 9, a
 * karigar's name in Urdu shorthand, a weight in tola where the form wants grams. So the
 * result is a draft on screen with the photo beside it, and the shopkeeper presses Create.
 *
 * What it will not do is decide who the karigar is. Names are ranked with the same
 * phonetic matching the voice assistant uses, and anything short of a clear winner comes
 * back as candidates for a human to pick from.
 *
 * A PARCHI OFTEN CARRIES THE HISAAB AS WELL AS THE PIECE. "12.5 g × 24,500 = 306,250 +
 * making 8,000", then "less purana sona 5 g = 120,000", then a balance. Those figures are
 * copied, never recomputed: the rate goes into the form's rate box, the written amounts
 * are kept so reconcileSlip() can check the reading against the slip's own arithmetic,
 * and a mismatch is shown rather than resolved. A slip whose sums do not add up usually
 * means a digit was misread, and that is exactly the thing a person can see in a second
 * with the photo beside them and the model cannot see at all.
 */

import { rankNames, type RankedName, type RosterEntry } from '@/lib/voice/phonetics';

/** A tola is the unit an older slip is written in; the form wants grams. */
import { GRAMS_PER_TOLA } from '@/lib/units';
/** Kept as a name the scanners already import; the value lives in lib/units. */
export const TOLA_G = GRAMS_PER_TOLA;

export const ORDER_CATEGORIES = [
  'Ring', 'Chain', 'Bangle', 'Kara', 'Bracelet', 'Earrings', 'Jhumka',
  'Pendant', 'Necklace', 'Set', 'Tops', 'Nose pin', 'Anklet', 'Other',
] as const;

export const SLIP_METALS = ['gold', 'palladium', 'platinum', 'silver'] as const;
export type SlipMetal = typeof SLIP_METALS[number];

/**
 * Nothing here is required. A photo of a bare ring says nothing about who is making it or
 * when it is due, and a schema that insists otherwise only teaches the model to invent an
 * answer. Every field is nullable and the prompt says to leave it null.
 */
export interface DraftItem {
  description?: string | null;
  itemCategory?: string | null;
  metalType?: SlipMetal | string | null;
  karat?: number | null;
  weightG?: number | null;
  /** Set when the slip was written in tola and the figure above was converted. */
  weightWasTola?: boolean | null;
  stoneWeightG?: number | null;
  /** Total making for the piece, in rupees. Converted from per-gram if written that way. */
  makingCharges?: number | null;
  makingWasPerGram?: boolean | null;
  stoneCharges?: number | null;
  /** The metal rate written against this piece, PER GRAM. Converted if written per tola. */
  ratePerGram?: number | null;
  rateWasPerTola?: boolean | null;
  /** Wastage / kasar as a percentage, only if the slip's hisaab shows one. */
  wastagePercent?: number | null;
  /** The amount written against this piece — the result of its hisaab, or a bare figure. */
  lineTotal?: number | null;
  size?: string | null;
  stoneDetails?: string | null;
  /** 1-based: which of the photos is a picture of THIS piece, when one is. */
  photoIndex?: number | null;
  note?: string | null;
}

/**
 * Gold the customer handed over against the order — "purana sona", an old ring, a
 * broken chain — written on the slip as a deduction. Sometimes a full line of arithmetic
 * (weight × rate = value), sometimes just a weight, sometimes just "less 120,000".
 */
export interface DraftExchange {
  description?: string | null;
  weightG?: number | null;
  weightWasTola?: boolean | null;
  karat?: number | null;
  /** Rate written against the OLD gold, per gram. Old gold is often taken below the day's rate. */
  ratePerGram?: number | null;
  rateWasPerTola?: boolean | null;
  /** The deduction as written. Null when the slip gave a weight and no figure. */
  value?: number | null;
  note?: string | null;
}

export interface RawOrderDraft {
  items?: DraftItem[] | null;
  /** As written on the slip, however mangled. Never matched by the model itself. */
  karigarNameHeard?: string | null;
  customerNameHeard?: string | null;
  customerPhone?: string | null;
  advancePayment?: number | null;
  exchange?: DraftExchange | null;
  discount?: number | null;
  /** The foot of the slip as written. Never recomputed by the model. */
  subtotal?: number | null;
  balanceDue?: number | null;
  expectedDate?: string | null;
  notes?: string | null;
  /** What the model could not read at all. Shown to the shop rather than hidden. */
  unreadable?: string | null;
}

export interface NameGuess {
  heard: string;
  /** Non-null only when one candidate is a clear winner. */
  pinned: RankedName | null;
  candidates: RankedName[];
}

export interface OrderDraft extends Omit<RawOrderDraft, 'karigarNameHeard' | 'customerNameHeard'> {
  karigar: NameGuess | null;
  customer: NameGuess | null;
}

/**
 * A name read off handwriting, ranked but deliberately not decided.
 *
 * The bar is higher than the voice assistant's. Speech gives the matcher a whole spoken
 * sentence to work with; a slip gives it a few characters of somebody's shorthand, and a
 * wrong karigar on an order is gold leaving the shop in the wrong direction.
 */
export function guessName(heard: string | null | undefined, pool: RosterEntry[]): NameGuess | null {
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

export function resolveDraft(
  raw: RawOrderDraft,
  customers: RosterEntry[],
  karigars: RosterEntry[],
): OrderDraft {
  const { karigarNameHeard, customerNameHeard, ...rest } = raw;
  return {
    ...rest,
    karigar: guessName(karigarNameHeard, karigars),
    customer: guessName(customerNameHeard, customers),
  };
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Does this piece carry a weight — the one figure it takes to price it from a rate? */
export const hasWeight = (it: DraftItem): boolean => num(it.weightG) > 0;

/** Did the slip do the sum for this piece, rather than just naming it and a weight? */
export const hasHisaab = (it: DraftItem): boolean => hasWeight(it) && num(it.ratePerGram) > 0;

/**
 * The karats the form can take, per metal. A slip that says 20k or 916 gets no karat
 * rather than a wrong one: the form's default is visible, a silent substitution is not.
 */
const KARATS_BY_METAL: Record<string, number[]> = {
  gold: [18, 21, 22, 24],
  palladium: [12, 18],
  platinum: [],
  silver: [],
};

export function karatFor(it: Pick<DraftItem, 'karat' | 'metalType'>, fallbackMetal: string): string | null {
  const metal = metalFor(it, fallbackMetal);
  const k = Math.round(num(it.karat));
  return (KARATS_BY_METAL[metal] ?? []).includes(k) ? `${k}k` : null;
}

export function metalFor(it: Pick<DraftItem, 'metalType'>, fallbackMetal: string): string {
  const m = String(it.metalType ?? '').toLowerCase();
  return (SLIP_METALS as readonly string[]).includes(m) ? m : fallbackMetal;
}

/**
 * What one piece comes to by the slip's own arithmetic, when the slip showed it.
 *
 * Rate × weight, wastage on the metal if a percentage was written, plus making and stones.
 * This is the same shape the order form uses, deliberately: if the two disagree after the
 * form is filled, it is because a figure was read wrong, not because they count differently.
 * Null when the slip did not give a rate — a weight alone is not a price.
 */
export function slipLinePrice(it: DraftItem): number | null {
  if (!hasHisaab(it)) return null;
  const metal = num(it.weightG) * num(it.ratePerGram);
  const wastage = metal * (num(it.wastagePercent) / 100);
  return Math.round(metal + wastage + num(it.makingCharges) + num(it.stoneCharges));
}

/**
 * What the old gold is worth, by what the slip says.
 *
 * A written figure wins. Failing that, a weight AND a rate written against the exchange
 * line are multiplied — that is the slip's sum, not ours. A weight alone stays at zero:
 * old gold is often taken below the day's rate, and borrowing the new piece's rate would
 * quietly give the customer a price nobody agreed.
 */
export function exchangeValue(ex: DraftExchange | null | undefined): { value: number; from: 'written' | 'computed' | 'none' } {
  if (!ex) return { value: 0, from: 'none' };
  if (num(ex.value) > 0) return { value: num(ex.value), from: 'written' };
  if (num(ex.weightG) > 0 && num(ex.ratePerGram) > 0) {
    return { value: Math.round(num(ex.weightG) * num(ex.ratePerGram)), from: 'computed' };
  }
  return { value: 0, from: 'none' };
}

/** "Old gold ring 21k · 5.2 g (0.446 tola on the slip) · at 22,000/g" — for the form's text box. */
export function describeExchange(ex: DraftExchange | null | undefined): string {
  if (!ex) return '';
  const parts: string[] = [];
  const what = String(ex.description ?? '').trim();
  parts.push(what || 'Gold taken in exchange');
  if (num(ex.karat) > 0) parts.push(`${Math.round(num(ex.karat))}k`);
  if (num(ex.weightG) > 0) {
    parts.push(`${num(ex.weightG)} g${ex.weightWasTola ? ` (${(num(ex.weightG) / TOLA_G).toFixed(3)} tola on the slip)` : ''}`);
  }
  if (num(ex.ratePerGram) > 0) {
    parts.push(`at ${Math.round(num(ex.ratePerGram)).toLocaleString('en-PK')}/g${ex.rateWasPerTola ? ' (written per tola)' : ''}`);
  }
  const { from } = exchangeValue(ex);
  if (from === 'computed') parts.push('value is weight × rate off the slip');
  if (from === 'none' && num(ex.weightG) > 0) parts.push('no value written — enter what it was taken at');
  if (ex.note) parts.push(String(ex.note));
  return parts.join(' · ');
}

export interface SlipCheck {
  /** One line each, in the words the scanner shows. Empty when everything agrees. */
  warnings: string[];
  /** Items whose written amount disagrees with their own hisaab, by index. */
  itemsOff: number[];
  /** What the pieces come to, taking each piece's written amount first, then its hisaab. */
  subtotal: number;
  /** subtotal − discount − advance − exchange, or null when no piece could be priced. */
  balance: number | null;
}

const money = (n: number) => Math.round(n).toLocaleString('en-PK');

/**
 * Does the slip agree with itself, as read?
 *
 * Three things are checked, all against figures the slip wrote: each piece's amount
 * against its own rate × weight; the subtotal against the pieces; the balance against
 * subtotal less everything taken off. A rupee or two is rounding; more than that is a
 * misread digit or a line that was missed, and either is worth a look at the photo
 * before the form is filled. Nothing is corrected here — the warnings point, the
 * shopkeeper decides.
 */
export function reconcileSlip(draft: Pick<OrderDraft, 'items' | 'discount' | 'advancePayment' | 'exchange' | 'subtotal' | 'balanceDue'>): SlipCheck {
  const warnings: string[] = [];
  const itemsOff: number[] = [];
  const items = draft.items ?? [];

  let subtotal = 0;
  let priced = 0;
  items.forEach((it, i) => {
    const computed = slipLinePrice(it);
    const written = num(it.lineTotal);
    if (computed != null && written > 0 && Math.abs(computed - written) > 2) {
      itemsOff.push(i);
      warnings.push(
        `${it.description || `Piece ${i + 1}`}: the slip writes ${money(written)} but its own rate × weight comes to ${money(computed)}. One of those figures was probably misread.`,
      );
    }
    const line = written > 0 ? written : (computed ?? 0);
    if (line > 0) { subtotal += line; priced += 1; }
  });

  if (num(draft.subtotal) > 0 && priced > 0 && Math.abs(num(draft.subtotal) - subtotal) > 2) {
    warnings.push(
      `The slip's subtotal is ${money(num(draft.subtotal))}; the pieces as read come to ${money(subtotal)}. A line may have been missed or a digit misread.`,
    );
  }

  const ex = exchangeValue(draft.exchange);
  const off = num(draft.discount) + num(draft.advancePayment) + ex.value;
  const base = num(draft.subtotal) > 0 ? num(draft.subtotal) : subtotal;
  const balance = priced > 0 || num(draft.subtotal) > 0 ? base - off : null;

  if (num(draft.balanceDue) > 0 && balance != null && Math.abs(num(draft.balanceDue) - balance) > 2) {
    warnings.push(
      `The slip's balance is ${money(num(draft.balanceDue))}; total less what was taken off comes to ${money(balance)}. Check the advance and the exchange line.`,
    );
  }

  if (draft.exchange && ex.from === 'none' && num(draft.exchange.weightG) > 0) {
    warnings.push('Old gold was taken in exchange but the slip gives no figure for it. Its value is left for you to enter.');
  }

  return { warnings, itemsOff, subtotal, balance };
}
