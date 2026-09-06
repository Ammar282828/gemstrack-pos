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
 */

import { rankNames, type RankedName, type RosterEntry } from '@/lib/voice/phonetics';

/** A tola is the unit an older slip is written in; the form wants grams. */
export const TOLA_G = 11.6638;

export const ORDER_CATEGORIES = [
  'Ring', 'Chain', 'Bangle', 'Kara', 'Bracelet', 'Earrings', 'Jhumka',
  'Pendant', 'Necklace', 'Set', 'Tops', 'Nose pin', 'Anklet', 'Other',
] as const;

/**
 * Nothing here is required. A photo of a bare ring says nothing about who is making it or
 * when it is due, and a schema that insists otherwise only teaches the model to invent an
 * answer. Every field is nullable and the prompt says to leave it null.
 */
export interface DraftItem {
  description?: string | null;
  itemCategory?: string | null;
  karat?: number | null;
  weightG?: number | null;
  /** Set when the slip was written in tola and the figure above was converted. */
  weightWasTola?: boolean | null;
  stoneWeightG?: number | null;
  makingCharges?: number | null;
  size?: string | null;
  stoneDetails?: string | null;
  note?: string | null;
}

export interface RawOrderDraft {
  items?: DraftItem[] | null;
  /** As written on the slip, however mangled. Never matched by the model itself. */
  karigarNameHeard?: string | null;
  customerNameHeard?: string | null;
  customerPhone?: string | null;
  advancePayment?: number | null;
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
