/**
 * Unfinished orders and invoices, kept so leaving the page does not lose them.
 *
 * A custom order takes a while to enter — several items, weights, karats,
 * making charges, a customer. Navigating away, a reload, a phone locking
 * mid-entry, and all of it was gone with nothing to go back to.
 *
 * Deliberately local storage rather than Firestore: this is scratch state for
 * one half-finished form on one device. Writing it to the database would put
 * incomplete orders in the orders collection, where every list, count and
 * report would have to learn to ignore them.
 */

const PREFIX = 'gemstrack:draft:';
/** Older than this and it is stale enough to be a nuisance rather than a help. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type DraftKind = 'order' | 'invoice';

export interface Draft<T = unknown> {
  kind: DraftKind;
  /** Distinguishes a new form from editing an existing record. */
  id: string;
  savedAt: string;
  data: T;
}

const keyFor = (kind: DraftKind, id: string) => `${PREFIX}${kind}:${id}`;

export function saveDraft<T>(kind: DraftKind, id: string, data: T): void {
  if (typeof window === 'undefined') return;
  try {
    const draft: Draft<T> = { kind, id, savedAt: new Date().toISOString(), data };
    localStorage.setItem(keyFor(kind, id), JSON.stringify(draft));
  } catch { /* private mode, or the quota is full — losing a draft is not worth throwing over */ }
}

export function readDraft<T>(kind: DraftKind, id: string): Draft<T> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(keyFor(kind, id));
    if (!raw) return null;
    const draft = JSON.parse(raw) as Draft<T>;
    if (!draft?.savedAt) return null;
    if (Date.now() - new Date(draft.savedAt).getTime() > MAX_AGE_MS) {
      localStorage.removeItem(keyFor(kind, id));
      return null;
    }
    return draft;
  } catch { return null; }
}

export function clearDraft(kind: DraftKind, id: string): void {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(keyFor(kind, id)); } catch { /* nothing to do */ }
}

/** Every draft still held, newest first — for the settings screen. */
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

/**
 * Is there anything here worth keeping?
 *
 * A form mounts with defaults — empty strings, zeros, one blank item row —
 * and saving that means every visit to the page offers to restore nothing.
 */
export function isWorthSaving(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const meaningful = (v: unknown): boolean => {
    if (v === null || v === undefined || v === '') return false;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'boolean') return false;                 // a default checkbox says nothing
    if (Array.isArray(v)) return v.some(meaningful);
    if (typeof v === 'object') return Object.values(v as Record<string, unknown>).some(meaningful);
    return true;
  };
  return meaningful(data);
}

/** A draft rendered for a list: where it goes and what is in it. */
export interface DraftSummary {
  kind: DraftKind;
  id: string;
  savedAt: string;
  /** Where to go to pick it up. */
  href: string;
  /** What kind of thing it is, in the shop's words. */
  noun: string;
  /** Who it is for, when the form got that far. */
  title: string;
  /** What is in it. Empty when there is nothing worth saying. */
  detail: string;
}

const str = (o: Record<string, unknown>, k: string): string => {
  const v = o[k];
  return typeof v === 'string' ? v.trim() : '';
};
const num = (o: Record<string, unknown>, k: string): number => {
  const v = o[k];
  const n = typeof v === 'string' ? parseFloat(v.replace(/,/g, '')) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
};

/**
 * Describe a draft without trusting its shape. The payload is whatever the
 * form looked like when it was written, read back out of localStorage, so it
 * may predate any field this reads — every accessor falls back rather than
 * throwing. A drafts list that crashes on an old draft is worse than no list.
 */
export function summarizeDraft(draft: Draft): DraftSummary {
  const data = (draft.data && typeof draft.data === 'object' ? draft.data : {}) as Record<string, unknown>;
  const base = { kind: draft.kind, id: draft.id, savedAt: draft.savedAt };

  if (draft.kind === 'order') {
    const items = Array.isArray(data.items) ? data.items : [];
    const advance = num(data, 'advancePayment');
    const parts = [
      items.length ? `${items.length} item${items.length === 1 ? '' : 's'}` : 'No items yet',
      advance > 0 ? `advance PKR ${advance.toLocaleString()}` : '',
    ].filter(Boolean);
    return {
      ...base,
      // Only `new` is ever written today — both forms skip drafting while
      // editing — but an older draft keyed to a record still resolves.
      href: draft.id === 'new' ? '/orders/add' : `/orders/${draft.id}/edit`,
      noun: 'Custom order',
      title: str(data, 'customerName') || 'No customer entered',
      detail: parts.join(' · '),
    };
  }

  // The sale draft holds the customer and money fields only. The items live in
  // the cart itself, which is why this says "details" rather than promising a
  // basket that was never in here.
  const parts = [
    num(data, 'discountAmountInput') > 0 ? `discount PKR ${num(data, 'discountAmountInput').toLocaleString()}` : '',
    str(data, 'exchangeDescription') ? 'exchange noted' : '',
    str(data, 'walkInCustomerPhone') ? 'phone entered' : '',
  ].filter(Boolean);
  return {
    ...base,
    href: '/cart',
    noun: 'Sale',
    title: str(data, 'walkInCustomerName') || 'No customer entered',
    detail: parts.length ? parts.join(' · ') : 'Customer details only',
  };
}
