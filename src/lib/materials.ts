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
