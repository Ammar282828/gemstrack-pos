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

/**
 * A piece's category from its name, for a line that carries none (an old custom order's, or a bill typed by hand:
 * "Necklace", "Jhumki", "Cat's eye ring"). The more particular words first: "bangle & ring" is a set, not a ring.
 */
const NAME_RULES: [RegExp, string][] = [
  [/\b(men'?s|gents?)\b.*\bring|\bring\b.*\b(men'?s|gents?)\b/i, 'cat018'],
  [/\bbutton/i, 'cat020'],
  [/(bracelet|bangle|kara).*\bring|\bring\b.*(bracelet|bangle|kara)/i, 'cat006'],
  [/\b(locket|takhti|thakti)s? set\b.*bangle/i, 'cat011'],
  [/\b(locket|takhti|thakti)s? set/i, 'cat010'],
  [/\bstring set/i, 'cat012'],
  [/\b(necklace|full set|set)\b.*(bracelet)/i, 'cat014'],
  [/\b(coin|biscuit|bar)\b|\bary\b|\b\d+(\.\d+)?\s?g\b.*24k/i, 'cat017'],
  [/\b(necklace|neckless|full set|set|haar|choker)\b/i, 'cat013'],
  [/\bloose bracelet/i, 'cat019'],
  [/\b(bangle|kara|kangan|churi)/i, 'cat007'],
  [/\bbracelet/i, 'cat005'],
  [/\bchain/i, 'cat008'],
  [/\b(locket|takhti|thakti|taweez|tawiz|pendant)/i, 'cat004'],
  [/\b(bali|balis|hoop)/i, 'cat003'],
  [/\b(tops?|earrings?|studs?|jhum(k|ki|ka|kay))\b/i, 'cat002'],
  [/\bbands?\b/i, 'cat009'],
  [/\brings?\b/i, 'cat001'],
];
export function guessCategory(name: string | undefined | null): string | undefined {
  const n = (name || '').trim();
  return n ? NAME_RULES.find(([re]) => re.test(n))?.[1] : undefined;
}

/**
 * A sold line's category for the reports: its own, else the custom order's (an order's lines kept theirs in
 * `itemCategory`; until 2026-10-23 its invoice line left `categoryId` empty), else read from its name. The owner,
 * 2026-10-23, of Analytics → Categories: "so much is uncategorized why" — 39% of October's revenue was custom orders.
 */
export function lineCategory(item: { categoryId?: string | null; itemCategory?: string | null; name?: string | null }): string | undefined {
  return item.categoryId || item.itemCategory || guessCategory(item.name);
}

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
