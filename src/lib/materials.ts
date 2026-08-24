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
export type KaratValue = '18k' | '21k' | '22k' | '24k';

export const METAL_TYPES: [MetalType, ...MetalType[]] = ['gold', 'palladium', 'platinum', 'silver'];
export const KARAT_VALUES: [KaratValue, ...KaratValue[]] = ['18k', '21k', '22k', '24k'];

/** How a metal is named to a human. Silver is always the full assay name. */
export function metalLabel(metalType: string | undefined | null): string {
  if (!metalType) return '';
  if (metalType === 'silver') return '925 Sterling Silver';
  return metalType.charAt(0).toUpperCase() + metalType.slice(1);
}

/** Karat only means something for gold — see displayKarat in ./categories. */
export function karatLabel(karat: string | undefined | null): string {
  return karat ? String(karat).toUpperCase() : '';
}

/**
 * Full description of an item's material, e.g.
 *   describeMetal('gold', '21k')  → "Gold (21K)"
 *   describeMetal('silver', '21k') → "925 Sterling Silver"   (karat ignored)
 */
export function describeMetal(metalType: string | undefined | null, karat?: string | null): string {
  const base = metalLabel(metalType);
  if (metalType !== 'gold' || !karat) return base;
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
