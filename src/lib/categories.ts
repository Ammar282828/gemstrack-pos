/**
 * Product categories — the single source of truth.
 *
 * Kept in its own module (rather than inside store.ts) so server code such as
 * the karigar API routes can resolve category names without pulling in the
 * Firebase client SDK and zustand.
 */

export interface Category {
  id: string;
  title: string;
}

export const staticCategories: Category[] = [
  { id: 'cat001', title: 'Rings' }, { id: 'cat002', title: 'Tops' },
  { id: 'cat003', title: 'Balis' }, { id: 'cat004', title: 'Lockets' },
  { id: 'cat005', title: 'Bracelets' }, { id: 'cat006', title: 'Bracelet and Ring Set' },
  { id: 'cat007', title: 'Bangles' }, { id: 'cat008', title: 'Chains' },
  { id: 'cat009', title: 'Bands' }, { id: 'cat010', title: 'Locket Sets without Bangle' },
  { id: 'cat011', title: 'Locket Set with Bangle' }, { id: 'cat012', title: 'String Sets' },
  { id: 'cat013', title: 'Stone Necklace Sets without Bracelets' },
  { id: 'cat014', title: 'Stone Necklace Sets with Bracelets' },
  { id: 'cat015', title: 'Gold Necklace Sets with Bracelets' },
  { id: 'cat016', title: 'Gold Necklace Sets without Bracelets' },
  { id: 'cat017', title: 'Gold Coins' },
  { id: 'cat018', title: "Men's Rings" },
  { id: 'cat019', title: 'Loose Bracelet' },
  { id: 'cat020', title: "Men's Buttons" },
];

/** Resolve a category id to its display name. Returns undefined when unknown. */
export function categoryTitle(id: string | undefined | null): string | undefined {
  if (!id) return undefined;
  return staticCategories.find(c => c.id === id)?.title;
}

/**
 * Karat only means something for gold. Silver/platinum/palladium items carry a
 * leftover karat from the order form's defaults, so never surface it for them.
 */
export function displayKarat(metalType: string | undefined, karat: string | undefined): string | undefined {
  if (!karat) return undefined;
  return metalType === 'gold' ? karat : undefined;
}
