/**
 * Semi-automatic piece descriptions (owner, 2026-11-03: "make product description semi automatic since the
 * product is usually described as its stone, view all product history and add different stone combo to auto
 * complete description"). Pure: the history normaliser, the combos' validation and how a combo is written
 * for a category. The server reads the books and caches (lib/describe-server.ts, GET /api/app/describe).
 */

export interface DescribeEntry { text: string; count: number; lastAt: string; category: string }

export const MAX_COMBOS = 200;
export const MAX_COMBO_LENGTH = 60;
/** Longest description kept in the history (a pasted paragraph is not a description). */
const MAX_TEXT = 200;

/** Trimmed, spaces collapsed: what two descriptions are compared on (case aside). */
export const cleanText = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

export interface DescribeRow { text: unknown; category?: unknown; at?: unknown }

/**
 * Every distinct description with how often and when last: case-insensitive de-dup keeping the most common
 * casing (the later one on a tie), the asked category's first, then most-used, then newest.
 * A description is de-duplicated within its category: "Ruby ring" on rings and on tops are two lines.
 */
export function buildHistory(rows: DescribeRow[], category = ''): DescribeEntry[] {
  type Bucket = { key: string; category: string; count: number; lastAt: string; cases: Map<string, number> };
  const buckets = new Map<string, Bucket>();
  for (const r of rows) {
    const text = cleanText(r?.text);
    if (!text || text.length > MAX_TEXT) continue;
    const cat = cleanText(r?.category);
    const at = typeof r?.at === 'string' ? r.at : '';
    const key = `${cat}\u0000${text.toLowerCase()}`;
    let b = buckets.get(key);
    if (!b) { b = { key, category: cat, count: 0, lastAt: '', cases: new Map() }; buckets.set(key, b); }
    b.count++;
    if (at > b.lastAt) b.lastAt = at;
    b.cases.set(text, (b.cases.get(text) || 0) + 1);
  }
  const out: DescribeEntry[] = [];
  for (const b of buckets.values()) {
    let best = ''; let bestN = -1;
    for (const [t, n] of b.cases) if (n > bestN || (n === bestN && t > best)) { best = t; bestN = n; }
    out.push({ text: best, count: b.count, lastAt: b.lastAt, category: b.category });
  }
  const want = cleanText(category);
  const rank = (e: DescribeEntry) => (want && e.category === want ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || b.count - a.count || (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0) || a.text.localeCompare(b.text));
}

/** The saved combinations as they may be kept: trimmed, de-duplicated (case aside), at most 200 of at most 60 characters. */
export type CombosResult = { ok: true; combos: string[] } | { ok: false; error: string };
export function cleanCombos(input: unknown): CombosResult {
  if (!Array.isArray(input)) return { ok: false, error: 'combos must be a list of words.' };
  if (input.length > MAX_COMBOS * 5) return { ok: false, error: `At most ${MAX_COMBOS} stone combinations.` };
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') return { ok: false, error: 'Each combination is a few words.' };
    const t = cleanText(raw);
    if (!t) continue;
    if (t.length > MAX_COMBO_LENGTH) return { ok: false, error: `A combination is at most ${MAX_COMBO_LENGTH} characters ("${t.slice(0, 20)}…").` };
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  if (out.length > MAX_COMBOS) return { ok: false, error: `At most ${MAX_COMBOS} stone combinations.` };
  return { ok: true, combos: out };
}

/** "Ruby & diamond" for a ring → "Ruby & diamond ring"; a combo that already ends in the word is left as it is. */
export function composeCombo(combo: string, categoryWord: string): string {
  const c = cleanText(combo);
  const w = cleanText(categoryWord);
  if (!c) return w;
  if (!w) return c;
  return c.toLowerCase().endsWith(w.toLowerCase()) ? c : `${c} ${w.toLowerCase()}`;
}

/** What to suggest for the typed words: history first (the category's, then the rest), then combos composed with the category; at most `limit`. */
export function suggest(
  typed: string,
  history: DescribeEntry[],
  combos: string[],
  category: string,
  categoryWord: string,
  limit = 8,
): string[] {
  const q = cleanText(typed).toLowerCase();
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (t: string) => {
    const k = t.toLowerCase();
    if (!t || seen.has(k) || k === q) return;
    if (q && !k.includes(q)) return;
    seen.add(k); out.push(t);
  };
  for (const h of history) if (h.category === category) add(h.text);
  for (const c of combos) add(composeCombo(c, categoryWord));
  for (const h of history) if (h.category !== category) add(h.text);
  return out.slice(0, limit);
}
