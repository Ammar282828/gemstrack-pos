'use client';

/**
 * The ERP's side of online orders, in the browser: the staff routes (/api/website/online,
 * /api/website/orders/:id) with the signed-in account's token, and the count of orders waiting to
 * be confirmed, shared by the sidebar and the Orders hub so one poll serves both.
 */

import { useSyncExternalStore } from 'react';
import { getAuth } from 'firebase/auth';
import { STORE_WEBSITE_SELLING } from '@/lib/store-config';
import type { OnlineOrderRow } from './types';

export async function staffFetch<T = Record<string, unknown>>(path: string, body?: Record<string, unknown> | null): Promise<T> {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => undefined);
  // These move money and send WhatsApp from the shop's number: the server insists on a verified
  // owner or staff account (lib/website/staff-gate.ts), whatever is sent from here.
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('Sign in with Google to act on online orders.');
  if (res.status === 403) throw new Error('Only owner and staff accounts can act on online orders.');
  if (!res.ok) throw new Error((data as { error?: string }).error || `Failed (${res.status})`);
  return data as T;
}

export const listOnline = () => staffFetch<{ orders: OnlineOrderRow[] }>('/api/website/online').then(d => d.orders);

// ─── The waiting count ──────────────────────────────────────────────────────

const POLL_MS = 120_000;
let waiting = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let unauth: (() => void) | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Ask again now (after a confirm or a decline, or when the page comes back). */
export function refreshWaiting(): Promise<void> {
  if (!STORE_WEBSITE_SELLING || typeof window === 'undefined') return Promise.resolve();
  if (inflight) return inflight;
  inflight = staffFetch<{ waiting: number }>('/api/website/online?count=1')
    .then(d => { if (d.waiting !== waiting) { waiting = d.waiting; listeners.forEach(l => l()); } })
    .catch(() => undefined)
    .finally(() => { inflight = null; });
  return inflight;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (listeners.size === 1 && STORE_WEBSITE_SELLING) {
    // Asked now (the server decides who may know), and again once someone is signed in: on a fresh
    // load the account arrives after the first render.
    void refreshWaiting();
    try { unauth = getAuth().onAuthStateChanged(u => { if (u) void refreshWaiting(); }); } catch { /* no auth on this page */ }
    timer = setInterval(() => { if (document.visibilityState === 'visible') void refreshWaiting(); }, POLL_MS);
    window.addEventListener('focus', onFocus);
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size) { if (timer) clearInterval(timer); timer = null; unauth?.(); unauth = null; window.removeEventListener('focus', onFocus); }
  };
}
const onFocus = () => { void refreshWaiting(); };

/** Online orders waiting to be confirmed; 0 in a house that does not sell online. */
export function useOnlineWaiting(): number {
  return useSyncExternalStore(subscribe, () => waiting, () => 0);
}
