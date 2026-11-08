/**
 * Which customers look like one person written twice: the Customers page's "Merge duplicates" list
 * (src/app/customers/page.tsx `detectDuplicates`), moved here so the iPhone app's copy
 * (apps/iphone/App/Screens/Customers/CustomerDuplicates.swift) has a tested source to follow.
 *
 * Two customers are a pair when they share a phone number (digits only, leading zeros dropped), or when
 * their names are 85% alike: equal after case and spaces, one inside the other (90%), or sharing most of
 * their words. Best matches first.
 *
 * One difference from the page, on purpose: a customer with no name at all is never paired by name. The
 * page reads "nothing" as inside every name (an empty string is in any string), so a single unnamed record
 * came up as a 90% duplicate of everyone.
 */

export type DuplicateCandidate = { id: string; name?: string | null; phone?: string | null };

export type DuplicatePair<T extends DuplicateCandidate = DuplicateCandidate> = {
  a: T;
  b: T;
  reason: string;
  score: number;
};

/** The least alike two names may be to be offered. */
export const NAME_MATCH_FLOOR = 0.85;

export const normalizeName = (name: string | null | undefined) =>
  String(name ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Digits only, leading zeros dropped: 0300 1234567 and +92 300 1234567 are not the same here, as on the page. */
export const normalizePhone = (phone: string | null | undefined) =>
  String(phone ?? '').replace(/\D/g, '').replace(/^0+/, '');

export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  // One name inside the other.
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  // Word overlap.
  const wa = new Set(na.split(' ')), wb = new Set(nb.split(' '));
  const inter = [...wa].filter((w) => wb.has(w)).length;
  return inter / Math.max(wa.size, wb.size);
}

export function detectDuplicates<T extends DuplicateCandidate>(customers: T[]): DuplicatePair<T>[] {
  // Each name and phone prepared once, not once per pair: the pairs loop is n²/2 (~630,000 pairs for
  // 1,124 customers), and running two regexes and two word sets inside it took ~7 s on a phone. Same rules
  // as nameSimilarity, on the prepared rows.
  const rows = customers.map((c) => {
    const name = normalizeName(c.name);
    return { c, name, words: new Set(name.split(' ')), phone: c.phone ? normalizePhone(c.phone) : '' };
  });
  const pairs: DuplicatePair<T>[] = [];
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    for (let j = i + 1; j < rows.length; j++) {
      const b = rows[j];
      // Same phone
      if (a.phone && a.phone === b.phone) {
        pairs.push({ a: a.c, b: b.c, reason: 'Same phone number', score: 1 });
        continue;
      }
      // Similar name
      if (!a.name || !b.name) continue;
      let sim: number;
      if (a.name === b.name) sim = 1;
      else if (a.name.includes(b.name) || b.name.includes(a.name)) sim = 0.9;
      else {
        const big = Math.max(a.words.size, b.words.size);
        // The shared words can't outnumber the smaller set: skip the count when it can't reach the floor.
        if (Math.min(a.words.size, b.words.size) < big * NAME_MATCH_FLOOR) continue;
        let inter = 0;
        for (const w of a.words) if (b.words.has(w)) inter++;
        sim = inter / big;
      }
      if (sim >= NAME_MATCH_FLOOR) {
        pairs.push({ a: a.c, b: b.c, reason: `Similar name (${Math.round(sim * 100)}% match)`, score: sim });
      }
    }
  }
  // The page's sort: best first; JavaScript's sort is stable, so equals keep their order.
  return pairs.sort((x, y) => y.score - x.score);
}
