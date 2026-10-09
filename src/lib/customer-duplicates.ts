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
  const pairs: DuplicatePair<T>[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < customers.length; i++) {
    for (let j = i + 1; j < customers.length; j++) {
      const a = customers[i], b = customers[j];
      const key = [a.id, b.id].sort().join('|');
      if (seen.has(key)) continue;
      // Same phone
      if (a.phone && b.phone) {
        const pa = normalizePhone(a.phone), pb = normalizePhone(b.phone);
        if (pa && pb && pa === pb) {
          seen.add(key);
          pairs.push({ a, b, reason: 'Same phone number', score: 1 });
          continue;
        }
      }
      // Similar name
      const sim = nameSimilarity(a.name, b.name);
      if (sim >= NAME_MATCH_FLOOR) {
        seen.add(key);
        pairs.push({ a, b, reason: `Similar name (${Math.round(sim * 100)}% match)`, score: sim });
      }
    }
  }
  // The page's sort: best first; JavaScript's sort is stable, so equals keep their order.
  return pairs.sort((x, y) => y.score - x.score);
}
