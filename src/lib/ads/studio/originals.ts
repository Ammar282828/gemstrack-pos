/**
 * taheri.shop's photographs have the wordmark (and often the weight) burned in — the site is
 * sent them marked. The shoots in Drive are the same frames unmarked, under the same camera
 * name: the site's "DSC09342.webp" is Drive's "DSC09342.JPG", and the owner's retouched
 * "DSC09342-retouched 2.png" (checked 2026-09-29). So a website photo's clean original is
 * found by that name, the retouched one first — no AI erasing needed. Pure (tested).
 */

/** The camera's name for a frame — "DSC09342", "IMG_1234" — or null for anything else. */
export function shotKey(fileName: string): string | null {
  const base = (fileName.split('/').pop() ?? '').replace(/\.[a-z0-9]{2,5}$/i, '');
  const m = base.match(/^([A-Za-z]{2,5})[_-]?(\d{3,6})(?=$|[^\d])/);
  return m ? `${m[1].toUpperCase()}${m[2]}` : null;
}

export interface OriginalCandidate { id: string; name: string; created: string | null }

/** The best clean original among Drive files of the same frame: a retouched one, then the newest. */
export function pickOriginal<T extends OriginalCandidate>(candidates: T[]): T | null {
  if (!candidates.length) return null;
  const retouched = (c: T) => /retouch|edit|final/i.test(c.name) ? 1 : 0;
  return [...candidates].sort((a, b) => retouched(b) - retouched(a) || (Date.parse(b.created ?? '') || 0) - (Date.parse(a.created ?? '') || 0))[0];
}

/** Every frame in Drive by its camera name. */
export function originalsByShot<T extends OriginalCandidate>(files: T[]): Map<string, T> {
  const groups = new Map<string, T[]>();
  for (const f of files) {
    const k = shotKey(f.name);
    if (k) groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  const out = new Map<string, T>();
  for (const [k, list] of groups) { const best = pickOriginal(list); if (best) out.set(k, best); }
  return out;
}
