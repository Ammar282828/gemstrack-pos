/**
 * The type and the stones of a catalogue piece, read from its collection, its key's folders, its name and the
 * site's words (owner, 2026-11-03: "I should be able to search by stone and type filters"). Pure: GET
 * /api/app/catalogue derives them and filters with them, and the web picker filters the loaded set with the same
 * functions, so the phones can port this file line for line.
 *
 * `type` is one id of TYPES (or `other`); `stones` are ids of STONES in the order below, plurals and spellings
 * folded ("rubies", "manik" -> ruby; "firoza" -> turquoise; "american diamond", "cz" -> zircon, not diamond).
 */

export interface FacetOption { id: string; label: string; count: number }
export interface Facets { types: FacetOption[]; stones: FacetOption[] }

/** What the derivation reads: the SitePiece fields it needs. */
export interface FacetPiece {
  collection?: string;
  id?: string;
  name?: string;
  facts?: string[];
  words?: { name?: string; stone?: string; cut?: string; style?: string; facts?: string[] };
}

export const OTHER_TYPE = 'other';

interface Kind { id: string; label: string; re: RegExp }

/** Order matters: the first that matches wins (a set of a ring and earrings is a set; ear rings are earrings, not rings). */
export const TYPES: Kind[] = [
  { id: 'set', label: 'Set', re: /\bsets?\b(?!\s+(with|in|on|by|of)\b)/i },
  { id: 'nosepin', label: 'Nose pin', re: /\b(nose\s*-?\s*(pins?|rings?|studs?)|nosepins?|nath|laung)\b/i },
  { id: 'earrings', label: 'Earrings', re: /\b(ear\s*-?\s*rings?|earrings?|studs?|tops?|jhum(k|ki|ka|kay)s?|jhumar|baal[iy]s?|balis?|hoops?|danglers?)\b/i },
  { id: 'bracelet', label: 'Bracelet', re: /\bbracelets?\b/i },
  { id: 'bangle', label: 'Bangle', re: /\b(bangles?|kara|kada|kangan|churi|churiyan)\b/i },
  { id: 'pendant', label: 'Pendant', re: /\b(pendants?|lockets?|taweez|tawiz|takhti|thakti)\b/i },
  { id: 'necklace', label: 'Necklace', re: /\b(necklaces?|chokers?|haar|mala|rani\s*haar)\b/i },
  { id: 'chain', label: 'Chain', re: /\bchains?\b/i },
  { id: 'anklet', label: 'Anklet', re: /\b(anklets?|payal|payals)\b/i },
  { id: 'tikka', label: 'Tikka', re: /\b(tikka|tika|matha\s*patti|jhoomar)\b/i },
  { id: 'coin', label: 'Coin', re: /\b(coins?|biscuits?|bars?)\b/i },
  { id: 'button', label: 'Button', re: /\b(buttons?|cufflinks?)\b/i },
  { id: 'ring', label: 'Ring', re: /\brings?\b/i },
  { id: 'band', label: 'Band', re: /\bbands?\b/i },
];

/** Stones, in the order a piece lists them. "american diamond" and "mother of pearl" are taken out first (see `clean`). */
export const STONES: Kind[] = [
  { id: 'diamond', label: 'Diamond', re: /\b(diamonds?|solitaires?|heera)\b/i },
  { id: 'ruby', label: 'Ruby', re: /\b(rub(y|ies)|manik|manak)\b/i },
  { id: 'emerald', label: 'Emerald', re: /\b(emeralds?|panna)\b/i },
  { id: 'sapphire', label: 'Sapphire', re: /\b(sapphires?|neelam|neelum)\b/i },
  { id: 'pearl', label: 'Pearl', re: /\b(pearls?|moti|motis)\b/i },
  { id: 'zircon', label: 'Zircon', re: /\b(zircons?|zirconias?|cz|american\s+diamonds?)\b/i },
  { id: 'polki', label: 'Polki', re: /\bpolki\b/i },
  { id: 'kundan', label: 'Kundan', re: /\bkundan\b/i },
  { id: 'turquoise', label: 'Turquoise', re: /\b(turquoise|feroza|firoza|ferozas|firozas)\b/i },
  { id: 'coral', label: 'Coral', re: /\b(corals?|marjan|moonga|munga)\b/i },
  { id: 'onyx', label: 'Onyx', re: /\bonyx\b/i },
  { id: 'moissanite', label: 'Moissanite', re: /\bmoissanites?\b/i },
  { id: 'amethyst', label: 'Amethyst', re: /\b(amethysts?|jamunia)\b/i },
  { id: 'garnet', label: 'Garnet', re: /\bgarnets?\b/i },
  { id: 'topaz', label: 'Topaz', re: /\btopaz(es)?\b/i },
  { id: 'opal', label: 'Opal', re: /\bopals?\b/i },
  { id: 'tanzanite', label: 'Tanzanite', re: /\btanzanites?\b/i },
  { id: 'aquamarine', label: 'Aquamarine', re: /\baquamarines?\b/i },
  { id: 'peridot', label: 'Peridot', re: /\bperidots?\b/i },
  { id: 'citrine', label: 'Citrine', re: /\bcitrines?\b/i },
  { id: 'tourmaline', label: 'Tourmaline', re: /\btourmalines?\b/i },
  { id: 'agate', label: 'Agate', re: /\b(agates?|aqeeq|aqiq|akik)\b/i },
  { id: 'jade', label: 'Jade', re: /\bjade\b/i },
  { id: 'lapis', label: 'Lapis', re: /\blapis(\s+lazuli)?\b/i },
  { id: 'mother-of-pearl', label: 'Mother of pearl', re: /\bmother[\s-]+of[\s-]+pearl\b/i },
];

/** The text with the phrases that would read as the wrong stone swapped for their own word. */
const clean = (s: string): string =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/mother[\s-]+of[\s-]+pearl/gi, ' mopstone ')
    .replace(/american\s+diamonds?/gi, ' zircon ')
    .replace(/[_/\\.\-–—|,;:()]+/g, ' ');

const hasStoneWord = (text: string, k: Kind): boolean =>
  k.id === 'mother-of-pearl' ? /\bmopstone\b/.test(text) : k.re.test(text);

const folderWords = (id?: string): string => String(id || '').split('/').slice(0, -1).join(' ');

/** The shop-given words, most reliable first: collection and folders, then the name, then what the site says about it. */
function tiers(p: FacetPiece): string[] {
  const w = p.words;
  return [
    [p.collection, folderWords(p.id)].filter(Boolean).join(' '),
    [p.name, w?.name].filter(Boolean).join(' '),
    [w?.style, w?.cut, ...(w?.facts ?? []), ...(p.facts ?? [])].filter(Boolean).join(' '),
  ].map(clean);
}

/** The piece's type id: from its collection, else its name, else the site's words; `other` when none says. */
export function pieceType(p: FacetPiece): string {
  for (const t of tiers(p)) {
    const hit = TYPES.find(k => k.re.test(t));
    if (hit) return hit.id;
  }
  return OTHER_TYPE;
}

/** The stones the piece is set with (ids, in STONES' order), from its collection, name, folders and the site's words. */
export function pieceStones(p: FacetPiece): string[] {
  const text = [...tiers(p), clean([p.words?.stone, p.words?.cut].filter(Boolean).join(' '))].join(' ');
  return STONES.filter(k => hasStoneWord(text, k)).map(k => k.id);
}

export const typeLabel = (id: string): string => TYPES.find(k => k.id === id)?.label ?? 'Other';
export const stoneLabel = (id: string): string => STONES.find(k => k.id === id)?.label ?? id;

/** A comma list from a query string or a chip row: lower-cased, trimmed, empty ones dropped, no duplicates. */
export function idList(v: string | string[] | undefined | null): string[] {
  const parts = (Array.isArray(v) ? v : String(v ?? '').split(',')).map(s => s.trim().toLowerCase()).filter(Boolean);
  return [...new Set(parts)];
}

/** Whether a typed word names a type / a stone (so "rubies" finds a ruby piece whose title never says it). */
const wordType = (w: string): string | undefined => TYPES.find(k => k.re.test(clean(w)))?.id;
const wordStone = (w: string): string | undefined => STONES.find(k => hasStoneWord(clean(w), k))?.id;

/** What `q` is matched against besides the folders and name: the site's words, the type and the stones. */
const wordsText = (p: FacetPiece): string => {
  const w = p.words;
  return [p.collection, p.name, w?.name, w?.stone, w?.cut, w?.style, ...(w?.facts ?? []), ...(p.facts ?? [])].filter(Boolean).join(' ');
};

export interface FacetedPiece extends FacetPiece { type?: string; stones?: string[] }

/** Every typed word is in the title, collection, key, words, stones or type (a stone or type word by its folded id). */
export function catalogueMatches(p: FacetedPiece, q: string | undefined | null): boolean {
  const words = (q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const type = p.type ?? pieceType(p);
  const stones = p.stones ?? pieceStones(p);
  const hay = `${wordsText(p)} ${p.id || ''} ${typeLabel(type)} ${stones.map(stoneLabel).join(' ')}`.toLowerCase();
  return words.every(w => hay.includes(w) || wordType(w) === type || stones.includes(wordStone(w) ?? '\0'));
}

/** Keeps the pieces of any of the types and having every one of the stones; an empty list asks nothing. */
export function matchesFacets(p: FacetedPiece, types: string[], stones: string[]): boolean {
  if (types.length && !types.includes(p.type ?? pieceType(p))) return false;
  if (stones.length) {
    const has = p.stones ?? pieceStones(p);
    if (!stones.every(s => has.includes(s))) return false;
  }
  return true;
}

/** The type and stone chips for these pieces, with counts: most pieces first, then by name. */
export function buildFacets(pieces: FacetedPiece[]): Facets {
  const types = new Map<string, number>();
  const stones = new Map<string, number>();
  for (const p of pieces) {
    const t = p.type ?? pieceType(p);
    types.set(t, (types.get(t) ?? 0) + 1);
    for (const s of p.stones ?? pieceStones(p)) stones.set(s, (stones.get(s) ?? 0) + 1);
  }
  const rank = (a: FacetOption, b: FacetOption) => b.count - a.count || a.label.localeCompare(b.label);
  return {
    types: [...types].map(([id, count]) => ({ id, label: typeLabel(id), count })).sort((a, b) => (a.id === OTHER_TYPE ? 1 : b.id === OTHER_TYPE ? -1 : rank(a, b))),
    stones: [...stones].map(([id, count]) => ({ id, label: stoneLabel(id), count })).sort(rank),
  };
}
