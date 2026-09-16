/**
 * Product categories — the single source of truth.
 *
 * Kept in its own module (rather than inside store.ts) so server code such as
 * the karigar API routes can resolve category names without pulling in the
 * Firebase client SDK and zustand.
 */

export interface Category {
  id: string;
  /** The list name, plural: "Rings". What the pickers and filters show. */
  title: string;
  /**
   * One of them: "Ring". What a printed bill leads with, because a bill is for a
   * piece and not for a department. Written out rather than derived, since "Locket
   * Sets without Bangle" does not singularise by dropping an s, and neither does
   * "Men's Buttons".
   */
  singular: string;
}

export const staticCategories: Category[] = [
  { id: 'cat001', title: 'Rings', singular: 'Ring' },
  { id: 'cat002', title: 'Tops', singular: 'Top' },
  { id: 'cat003', title: 'Balis', singular: 'Bali' },
  { id: 'cat004', title: 'Lockets', singular: 'Locket' },
  { id: 'cat005', title: 'Bracelets', singular: 'Bracelet' },
  { id: 'cat006', title: 'Bracelet and Ring Set', singular: 'Bracelet and Ring Set' },
  { id: 'cat007', title: 'Bangles', singular: 'Bangle' },
  { id: 'cat008', title: 'Chains', singular: 'Chain' },
  { id: 'cat009', title: 'Bands', singular: 'Band' },
  { id: 'cat010', title: 'Locket Sets without Bangle', singular: 'Locket Set without Bangle' },
  { id: 'cat011', title: 'Locket Set with Bangle', singular: 'Locket Set with Bangle' },
  { id: 'cat012', title: 'String Sets', singular: 'String Set' },
  { id: 'cat013', title: 'Stone Necklace Sets without Bracelets', singular: 'Stone Necklace Set without Bracelets' },
  { id: 'cat014', title: 'Stone Necklace Sets with Bracelets', singular: 'Stone Necklace Set with Bracelets' },
  { id: 'cat015', title: 'Gold Necklace Sets with Bracelets', singular: 'Gold Necklace Set with Bracelets' },
  { id: 'cat016', title: 'Gold Necklace Sets without Bracelets', singular: 'Gold Necklace Set without Bracelets' },
  { id: 'cat017', title: 'Gold Coins', singular: 'Gold Coin' },
  { id: 'cat018', title: "Men's Rings", singular: "Men's Ring" },
  { id: 'cat019', title: 'Loose Bracelet', singular: 'Loose Bracelet' },
  { id: 'cat020', title: "Men's Buttons", singular: "Men's Button" },
];

/** Resolve a category id to its display name. Returns undefined when unknown. */
export function categoryTitle(id: string | undefined | null): string | undefined {
  if (!id) return undefined;
  return staticCategories.find(c => c.id === id)?.title;
}

/** One of them — "Ring" for cat001. Undefined when the id is unknown. */
export function categorySingular(id: string | undefined | null): string | undefined {
  if (!id) return undefined;
  return staticCategories.find(c => c.id === id)?.singular;
}

/**
 * Karat only means something for gold. Silver/platinum/palladium items carry a
 * leftover karat from the order form's defaults, so never surface it for them.
 */
export function displayKarat(metalType: string | undefined, karat: string | undefined): string | undefined {
  if (!karat) return undefined;
  return metalType === 'gold' ? karat : undefined;
}
