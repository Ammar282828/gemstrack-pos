/**
 * Photographs the background assessor sets aside instead of retrying forever.
 *
 * A batch is written down as "in flight" before it starts and cleared when it ends. If the next
 * slice finds it still there, the server died during it (on 2026-10-01 the same ten 25 MB PNGs
 * took the instance past its memory every five minutes, all day, and each tick began with them
 * again because nothing was recorded). Each photo in it gets a strike, as does one that failed
 * to load or that the model skipped; at STRIKE_OUT it is left out of the background runs. A photo
 * that is assessed loses its strikes, and the page's own "Assess" on a photo still tries it.
 *
 * Pure.
 */

export interface Strike { id: string; n: number; why: string }

export const STRIKE_OUT = 2;

/** One more strike for each id, with the latest reason. */
export function addStrikes(list: Strike[], ids: string[], why: (id: string) => string): Strike[] {
  const out = list.map(s => ({ ...s }));
  for (const id of new Set(ids)) {
    const s = out.find(x => x.id === id);
    if (s) { s.n += 1; s.why = why(id); } else out.push({ id, n: 1, why: why(id) });
  }
  return out;
}

/** The ids that were assessed after all: their strikes go. */
export const clearStrikes = (list: Strike[], ids: string[]): Strike[] => {
  const gone = new Set(ids);
  return list.filter(s => !gone.has(s.id));
};

/** The ids the background leaves alone. */
export const setAside = (list: Strike[]): Set<string> => new Set(list.filter(s => s.n >= STRIKE_OUT).map(s => s.id));

/** Read back from Firestore, whatever is there. */
export function readStrikes(v: unknown): Strike[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap(x => {
    const s = x as Partial<Strike>;
    return typeof s?.id === 'string' && typeof s.n === 'number' ? [{ id: s.id, n: s.n, why: String(s.why ?? '') }] : [];
  });
}
