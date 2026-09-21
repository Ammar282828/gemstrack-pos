/**
 * What this browser picked last, per dropdown.
 *
 * A counter chooses the same few things over and over — the same category
 * for a run of bangles, the same month in a filter, the same ring sizes.
 * Every dropdown with enough options to scroll shows its last five picks
 * under a "Recent" heading, so the likely choice is the first thing seen.
 *
 * Per device, in localStorage: it is a convenience for the hands on this
 * tablet, not a record, and it must never be something that has to sync or
 * that a private window can break. Reads and writes are wrapped so a blocked
 * store just means no recents.
 *
 * Keyed by dropdown. A key is given explicitly where the option list changes
 * over time (categories, karigars) and derived from the option values
 * everywhere else, so two dropdowns offering the same list share one memory
 * — the karat picked on a product is the karat likely wanted on an order.
 */

import { useSyncExternalStore } from 'react';

const PREFIX = 'gemstrack:recents:';
export const MAX_RECENTS = 5;
/** Below this many options the list is scanned faster than a "Recent" row is read. */
export const MIN_OPTIONS_FOR_RECENTS = 7;

/** Sentinels and "everything" filters are not choices worth remembering. */
const SKIP = new Set(['', 'all', 'none', '__none__']);
export const isRememberable = (v: unknown): v is string =>
  typeof v === 'string' && !SKIP.has(v) && !v.startsWith('__');

const EMPTY: readonly string[] = Object.freeze([]);
const cache = new Map<string, readonly string[]>();
const listeners = new Set<() => void>();

function load(key: string): readonly string[] {
  const hit = cache.get(key);
  if (hit) return hit;
  let list: readonly string[] = EMPTY;
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) list = Object.freeze(parsed.filter((x): x is string => typeof x === 'string'));
    } catch { /* blocked or corrupt storage reads as nothing */ }
  }
  cache.set(key, list);
  return list;
}

/** Most recent first, at most MAX_RECENTS. */
export function readRecents(key: string | undefined): readonly string[] {
  return key ? load(key) : EMPTY;
}

/** Put `value` at the front of the list for `key`. Sentinels are ignored. */
export function rememberRecent(key: string | undefined, value: unknown): void {
  if (!key || !isRememberable(value)) return;
  const next = Object.freeze([value, ...load(key).filter(v => v !== value)].slice(0, MAX_RECENTS));
  cache.set(key, next);
  if (typeof window !== 'undefined') {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(next)); } catch { /* fine: it lives in memory for this tab */ }
  }
  listeners.forEach(l => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The recents for `key`, re-rendering when any dropdown remembers a pick. */
export function useRecents(key: string | undefined): readonly string[] {
  return useSyncExternalStore(subscribe, () => readRecents(key), () => EMPTY);
}

/**
 * A key derived from the option values themselves, for dropdowns that were
 * not given one. Order-insensitive, so a list that merely re-sorts keeps its
 * memory. djb2 — short enough for a storage key, unique enough for a few
 * dozen dropdowns.
 */
export function recentsKeyFor(values: readonly string[]): string {
  const joined = [...values].sort().join('');
  let h = 5381;
  for (let i = 0; i < joined.length; i++) h = ((h << 5) + h + joined.charCodeAt(i)) | 0;
  return `auto:${(h >>> 0).toString(36)}`;
}
