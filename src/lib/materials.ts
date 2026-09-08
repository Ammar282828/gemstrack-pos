/**
 * Metals and karats — the single source of truth.
 *
 * These lists and labels were previously re-declared in the order form, the
 * product form and the order detail page, and the display string was
 * hand-built in nine different places. They had already drifted: silver read
 * as "925 Sterling Silver" on invoices, slips, the cart and the order form,
 * but as plain "Silver" in the product form.
 *
 * Kept free of Firebase/zustand imports so server code (the karigar API) can
 * use it too.
 */

export type MetalType = 'gold' | 'palladium' | 'platinum' | 'silver';
export type KaratValue = '12k' | '18k' | '21k' | '22k' | '24k';

export const METAL_TYPES: [MetalType, ...MetalType[]] = ['gold', 'palladium', 'platinum', 'silver'];
export const KARAT_VALUES: [KaratValue, ...KaratValue[]] = ['12k', '18k', '21k', '22k', '24k'];

/**
 * Which karats each metal is actually sold in here.
 *
 * A flat list offered 24k palladium and 22k platinum, neither of which this shop has
 * ever made, while palladium's real 12k and 18k were missing entirely. Platinum and
 * silver carry no karat at all -- silver is 925 by assay, and saying "21k silver" is
 * how a wrong rate gets picked.
 */
export const KARATS_BY_METAL: Record<MetalType, KaratValue[]> = {
  gold: ['18k', '21k', '22k', '24k'],
  palladium: ['12k', '18k'],
  platinum: [],
  silver: [],
};

/** The karats to offer for a metal; empty means the field should not be shown. */
export const karatsFor = (metalType: string | undefined | null): KaratValue[] =>
  KARATS_BY_METAL[(metalType as MetalType)] ?? [];

/** Does this metal carry a karat at all? */
export const metalHasKarat = (metalType: string | undefined | null): boolean =>
  karatsFor(metalType).length > 0;

/** How a metal is named to a human. Silver is always the full assay name. */
export function metalLabel(metalType: string | undefined | null): string {
  if (!metalType) return '';
  if (metalType === 'silver') return '925 Sterling Silver';
  return metalType.charAt(0).toUpperCase() + metalType.slice(1);
}

/** Karat means something for gold and palladium — see displayKarat in ./categories. */
export function karatLabel(karat: string | undefined | null): string {
  return karat ? String(karat).toUpperCase() : '';
}

/**
 * Full description of an item's material, e.g.
 *   describeMetal('gold', '21k')       → "Gold (21K)"
 *   describeMetal('palladium', '18k')  → "Palladium (18K)"
 *   describeMetal('silver', '21k')     → "925 Sterling Silver"   (karat ignored)
 */
export function describeMetal(metalType: string | undefined | null, karat?: string | null): string {
  const base = metalLabel(metalType);
  // Palladium is sold at 12k and 18k here, so it reads its karat the same as gold does.
  if (!karat || !metalHasKarat(metalType)) return base;
  return `${base} (${karatLabel(karat)})`;
}

/**
 * The finish on a 925 silver piece, e.g. "White Rhodium · Nickel free".
 * Returns undefined for non-silver or when nothing was specified.
 */
export function describePlating(item: {
  metalType?: string; platingType?: string; platingNote?: string; nickelFree?: boolean;
}): string | undefined {
  if (item.metalType !== 'silver') return undefined;
  const parts: string[] = [];
  if (item.platingType === 'Other' && item.platingNote?.trim()) parts.push(item.platingNote.trim());
  else if (item.platingType) parts.push(item.platingType);
  if (item.nickelFree) parts.push('Nickel free');
  return parts.length ? parts.join(' · ') : undefined;
}

/**
 * What is actually set into a piece, for the customer's copy.
 *
 * The invoice already prints what the stones *cost* — "+ Diamonds: PKR
 * 45,000" — but never what they are. A customer paying for a 1.12ct VVS2
 * stone should see that on the bill, not just its price; it is the part they
 * would take to a valuer.
 *
 * Only what was actually recorded is printed. Nothing is inferred from a
 * charge being present, because "there is a diamond charge" is not a
 * description of a diamond.
 */
export function describeSettings(item: {
  metalType?: string;
  diamondDetails?: string | null;
  stoneDetails?: string | null;
  stoneWeightG?: number | null;
  platingType?: string;
  platingNote?: string;
  nickelFree?: boolean;
}): string[] {
  const lines: string[] = [];
  const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, ' · ').trim();

  const diamonds = item.diamondDetails?.trim();
  if (diamonds) lines.push(`Diamonds: ${oneLine(diamonds)}`);

  const stones = item.stoneDetails?.trim();
  if (stones) lines.push(`Stones: ${oneLine(stones)}`);

  const sw = Number(item.stoneWeightG) || 0;
  if (sw > 0) lines.push(`Stone weight: ${sw.toFixed(2)}g`);

  const plating = describePlating(item);
  if (plating) lines.push(`Finish: ${plating}`);

  return lines;
}

/**
 * The delivery block for a printed invoice, as lines.
 *
 * Empty when the sale is not being delivered, so the caller can leave the
 * whole section off rather than printing an empty heading.
 */
export function describeDelivery(d?: {
  required?: boolean; address?: string; city?: string;
  contactName?: string; contactPhone?: string; notes?: string;
  expectedDate?: string; charge?: number;
} | null): string[] {
  if (!d?.required || !d.address?.trim()) return [];
  const lines: string[] = [];
  // The recipient only earns a line when it is not the person on the bill.
  if (d.contactName?.trim()) {
    lines.push(d.contactPhone?.trim() ? `${d.contactName.trim()} · ${d.contactPhone.trim()}` : d.contactName.trim());
  } else if (d.contactPhone?.trim()) {
    lines.push(d.contactPhone.trim());
  }
  lines.push([d.address.trim(), d.city?.trim()].filter(Boolean).join(', '));
  if (d.expectedDate) {
    const t = new Date(d.expectedDate);
    if (!Number.isNaN(t.getTime())) {
      lines.push(`Expected ${t.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`);
    }
  }
  if (d.notes?.trim()) lines.push(d.notes.trim());
  return lines;
}
