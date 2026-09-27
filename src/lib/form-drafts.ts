/**
 * The drafts this browser kept before Drafts moved to Firestore (2026-09-27; see lib/work-drafts.ts).
 *
 * Only read now, once per device, by components/drafts/use-work-drafts.ts: the ones worth keeping
 * go to Drafts and the rest are cleared. Most were orders and sales that had in fact been saved —
 * the old form went on writing after the save.
 */

const PREFIX = 'gemstrack:draft:';

export type DraftKind = 'order' | 'invoice';

export interface Draft<T = unknown> {
  kind: DraftKind;
  id: string;
  savedAt: string;
  data: T;
}

/** Every draft still held in this browser, newest first. */
export function listDrafts(): Draft[] {
  if (typeof window === 'undefined') return [];
  const out: Draft[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      try {
        const d = JSON.parse(raw) as Draft;
        if (d?.savedAt) out.push(d);
      } catch { /* skip anything unreadable */ }
    }
  } catch { return []; }
  return out.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
}

export function clearAllDrafts(): number {
  if (typeof window === 'undefined') return 0;
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
  } catch { /* nothing to do */ }
  return keys.length;
}
