/**
 * The ERP's item categories (lib/categories.ts: cat001 Rings …) against the website's collections ("Rings",
 * "Diamond Rings", "Bangles", Mina's collections), so the catalogue picker can show only a piece's own category
 * (owner, 2026-11-03). A piece matches on the words of its collection folder, its key's folders and its name.
 * Pure: GET /api/app/catalogue filters with it.
 */

import { staticCategories } from '@/lib/categories';

interface Rule { id: string; include: RegExp; exclude?: RegExp }

const GENTS = /\b(gents?|men'?s|mens)\b/i;

/** The more particular categories carry an `exclude` so a bangle-and-ring set is not also a ring. */
const RULES: Rule[] = [
  { id: 'cat001', include: /\brings?\b/i, exclude: new RegExp(`${GENTS.source}|(bracelet|bangle|kara).*\\bring|\\bring\\b.*(bracelet|bangle|kara)|\\bset\\b`, 'i') },
  { id: 'cat018', include: new RegExp(`(${GENTS.source}).*\\brings?\\b|\\brings?\\b.*(${GENTS.source})`, 'i') },
  { id: 'cat002', include: /\b(tops?|studs?|ear ?rings?|jhum(k|ki|ka|kay)s?)\b/i },
  { id: 'cat003', include: /\b(balis?|hoops?)\b/i },
  { id: 'cat004', include: /\b(lockets?|pendants?|taweez|tawiz|takhti|thakti)\b/i, exclude: /\bsets?\b/i },
  { id: 'cat005', include: /\bbracelets?\b/i, exclude: /\b(sets?|loose)\b|\bring\b/i },
  { id: 'cat006', include: /(bracelet|bangle|kara).*\bring|\bring\b.*(bracelet|bangle|kara)/i },
  { id: 'cat007', include: /\b(bangles?|kara|kangan|churi)\b/i, exclude: /\bsets?\b|\bring\b/i },
  { id: 'cat008', include: /\bchains?\b/i },
  { id: 'cat009', include: /\bbands?\b/i },
  { id: 'cat010', include: /\b(locket|takhti|thakti)s?\s+sets?\b/i },
  { id: 'cat011', include: /\b(locket|takhti|thakti)s?\s+sets?\b.*bangle/i },
  { id: 'cat012', include: /\bstring\s+sets?\b/i },
  { id: 'cat013', include: /\b(necklaces?|full\s+sets?|sets?|haar|chokers?)\b/i, exclude: /\b(locket|string|gold)\b/i },
  { id: 'cat014', include: /\b(necklaces?|full\s+sets?|sets?)\b.*bracelet/i, exclude: /\bgold\b/i },
  { id: 'cat015', include: /\bgold\b.*\b(necklaces?|sets?)\b.*bracelet/i },
  { id: 'cat016', include: /\bgold\b.*\b(necklaces?|sets?)\b/i, exclude: /bracelet/i },
  { id: 'cat017', include: /\b(coins?|biscuits?|bars?)\b/i },
  { id: 'cat019', include: /\bloose\s+bracelets?\b/i },
  { id: 'cat020', include: /\bbuttons?\b/i },
];

/** The category id for an itemCategory value: an id (cat001) or a title/singular ("Rings", "Ring"); undefined when unknown or empty. */
export function resolveCategoryId(category: string | undefined | null): string | undefined {
  const c = (category || '').trim().toLowerCase();
  if (!c) return undefined;
  return staticCategories.find(x => x.id === c || x.title.toLowerCase() === c || x.singular.toLowerCase() === c)?.id;
}

/** The words a piece is matched on: its collection, its key's folders (not the file's number) and its name. */
export const pieceHaystack = (p: { collection?: string; id?: string; name?: string }): string =>
  [p.collection || '', ...String(p.id || '').split('/').slice(0, -1), p.name || ''].join(' ');

/** Whether a piece belongs to the category; every piece belongs when the category is unknown or empty. */
export function pieceInCategory(p: { collection?: string; id?: string; name?: string }, category: string | undefined | null): boolean {
  const id = resolveCategoryId(category);
  if (!id) return true;
  const rule = RULES.find(r => r.id === id);
  if (!rule) return true;
  const hay = pieceHaystack(p);
  return rule.include.test(hay) && !(rule.exclude && rule.exclude.test(hay));
}

/** Whether a piece answers the typed words: every word is in its title, collection or key. */
export function pieceMatches(p: { collection?: string; id?: string; name?: string }, q: string | undefined | null): boolean {
  const words = (q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${pieceHaystack(p)} ${p.id || ''}`.toLowerCase();
  return words.every(w => hay.includes(w));
}

export const CATALOGUE_LIMIT = 500;
