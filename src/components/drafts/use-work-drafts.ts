"use client";

/**
 * Drafts in Firestore `drafts`: the list for the Drafts section, and the hook a new order form or a
 * new sale uses to keep itself there as it is typed. The rules are in lib/work-drafts.ts.
 */

import React from 'react';
import { collection, deleteDoc, doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { CoalescingWriter, draftAction, fitsBeacon } from '@/lib/draft-writer';
import { useAppStore } from '@/lib/store';
import {
  deviceName, isExpired, isWorthKeeping, legacyAlreadySaved, newDraftId, summarizeOrder, summarizeSale, toStorable,
  type DraftSummary, type WorkDraft, type WorkDraftKind,
} from '@/lib/work-drafts';
import { listDrafts, clearAllDrafts } from '@/lib/form-drafts';

const COLL = 'drafts';

const thisDevice = () => (typeof navigator === 'undefined' ? 'This device' : deviceName(navigator.userAgent));

export async function readWorkDraft<T>(id: string): Promise<WorkDraft<T> | null> {
  try {
    const snap = await getDoc(doc(db, COLL, id));
    return snap.exists() ? ({ ...(snap.data() as WorkDraft<T>), id: snap.id }) : null;
  } catch { return null; }
}

export async function deleteWorkDraft(id: string): Promise<void> {
  try { await deleteDoc(doc(db, COLL, id)); } catch { /* gone already, or offline: it expires on its own */ }
}

/**
 * A sale left in Drafts when a new one is opened (the owner, 2026-10-25: a New sale is blank and the unfinished one
 * stays in Drafts). It was written as it was typed; pieces put in the cart since (the scanner, the products page)
 * are added to it, so none is lost when the cart is emptied for the new sale.
 */
export async function parkSaleCart(id: string, cart: unknown[]): Promise<void> {
  try {
    const snap = await getDoc(doc(db, COLL, id));
    if (!snap.exists()) return;
    const had = (snap.data() as WorkDraft).data?.cart;
    const skus = (list: unknown) => (Array.isArray(list) ? list.map(p => (p as { sku?: string })?.sku ?? '').join('|') : '');
    if (skus(had) === skus(cart)) return;
    await setDoc(doc(db, COLL, id), { data: { cart: toStorable(cart).data }, items: cart.length, updatedAt: new Date().toISOString() }, { merge: true });
  } catch { /* it keeps the pieces it had */ }
}

// ── The list ────────────────────────────────────────────────────────────────

let legacyMoved = false;
/**
 * The drafts this browser kept before (gemstrack:draft:…) come across once — except the ones that
 * were in fact saved as an order or invoice afterwards, which is most of them — and are then cleared.
 */
async function moveLegacyDrafts(saved: { customerName?: string; createdAt: string }[]) {
  if (legacyMoved || typeof window === 'undefined') return;
  legacyMoved = true;
  try {
    if (localStorage.getItem('gemstrack:drafts-moved') === '1') return;
    for (const d of listDrafts()) {
      const data = (d.data && typeof d.data === 'object' ? d.data : {}) as Record<string, unknown>;
      if (legacyAlreadySaved({ kind: d.kind, savedAt: d.savedAt, data }, saved)) continue;
      const kind: WorkDraftKind = d.kind === 'order' ? 'order' : 'sale';
      if (!isWorthKeeping(data, ['id', 'promisedDate', 'goldRate18k', 'goldRate21k', 'goldRate22k', 'goldRate24k', 'discountAmountInput'])) continue;
      const summary = kind === 'order' ? summarizeOrder(data) : summarizeSale(data);
      const { data: storable, leftOut } = toStorable(data);
      await setDoc(doc(db, COLL, newDraftId(kind, Date.parse(d.savedAt) || Date.now())), {
        kind, data: storable, ...summary, device: thisDevice(), createdAt: d.savedAt, updatedAt: d.savedAt, ...(leftOut?.length ? { leftOut } : {}),
      });
    }
    clearAllDrafts();
    localStorage.setItem('gemstrack:drafts-moved', '1');
  } catch { legacyMoved = false; }
}

/** Every draft, newest first, live. Drafts a month old are removed as they are seen. */
export function useWorkDrafts(kind?: WorkDraftKind): { drafts: WorkDraft[]; ready: boolean } {
  const [drafts, setDrafts] = React.useState<WorkDraft[]>([]);
  const [ready, setReady] = React.useState(false);
  const orders = useAppStore(s => s.orders);
  const invoices = useAppStore(s => s.generatedInvoices);

  React.useEffect(() => {
    const unsub = onSnapshot(collection(db, COLL), snap => {
      const now = Date.now();
      const list: WorkDraft[] = [];
      snap.forEach(d => {
        const w = { ...(d.data() as WorkDraft), id: d.id };
        if (isExpired(w, now)) { void deleteWorkDraft(d.id); return; }
        list.push(w);
      });
      list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      setDrafts(list);
      setReady(true);
    }, () => setReady(true));
    return unsub;
  }, []);

  // Once the book has loaded, carry over what this browser still held.
  React.useEffect(() => {
    if (!orders.length && !invoices.length) return;
    void moveLegacyDrafts([...orders, ...invoices].map(r => ({ customerName: r.customerName, createdAt: r.createdAt })));
  }, [orders, invoices]);

  return { drafts: kind ? drafts.filter(d => d.kind === kind) : drafts, ready };
}

// ── One form keeping itself as a draft ─────────────────────────────────────

export type DraftStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Keep a NEW order or sale in Drafts as it is typed.
 *
 *  - `active` false (editing a record that exists, an invoice on screen) → nothing is written.
 *  - Saved at every moment (the owner, 2026-10-25: "auto save at every moment so even if I've just written the name a
 *    draft gets saved"): a change is written within SAVE_EVERY_MS, a burst of changes is one write of the newest work,
 *    and one write is on its way at a time (lib/draft-writer.ts). Only when something changed and there is something
 *    worth keeping (`ignore`: fields a blank form already has). Emptied → removed.
 *  - Written at once when the tab is hidden or the page closes (visibilitychange, pagehide: the Firestore write, which
 *    is queued on disk if there is no line, and a keepalive request to /api/app/drafts), and when the form goes.
 *  - Never opened on its own: a form is blank unless it is given a draft (`load`); `detach` lets go of the draft it
 *    holds so the next change is a new one.
 *  - `finish()` once the record is saved: the draft is removed and nothing is written after,
 *    however the page goes on re-rendering while it navigates away.
 *  - `load(id)` continues a draft: it becomes this form's draft, and what it held is returned.
 */
export function useWorkDraft<T>(opts: {
  kind: WorkDraftKind;
  enabled: boolean;
  active: boolean;
  value: T;
  summary: (value: T) => DraftSummary;
  ignore: readonly string[];
  /** Told the draft's id when it gets one (and null when it goes) — for the address, or this device's memory. */
  onId?: (id: string | null) => void;
}) {
  const { kind, enabled, active, value, summary, ignore, onId } = opts;
  // Set by the first write, or by load() — never assumed, so a blank form can't delete a draft it hasn't read.
  const [id, setIdState] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<DraftStatus>('idle');
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const idRef = React.useRef<string | null>(null);
  const createdAt = React.useRef<string | null>(null);
  /** The work as last written (or loaded, or left behind): unchanged work is not written again. */
  const lastJson = React.useRef<string>('');
  /** The work as the server last acknowledged it: the page-closing request is sent only for what is newer. */
  const landedJson = React.useRef<string>('');
  const finished = React.useRef(false);
  // A draft being fetched to continue: nothing is written until it is on screen, or the blank
  // form it replaces would be taken for an emptied draft.
  const loading = React.useRef(false);
  const token = React.useRef('');
  const latest = React.useRef({ value, summary, ignore, onId, enabled, active });
  latest.current = { value, summary, ignore, onId, enabled, active };

  const setId = React.useCallback((next: string | null) => {
    idRef.current = next;
    setIdState(next);
    latest.current.onId?.(next);
  }, []);

  const writeNow = React.useCallback(async () => {
    const { value: v, summary: sum, ignore: ign, enabled: on, active: live } = latest.current;
    if (!on || !live || finished.current || loading.current) return;
    const json = JSON.stringify(v ?? {});
    const worth = isWorthKeeping(v, ign);
    const act = draftAction({ json, lastJson: lastJson.current, worth, hasDraft: !!idRef.current });
    if (!worth) lastJson.current = json;
    if (act === 'skip') return;
    if (act === 'remove') {
      // Emptied: a draft of nothing is removed, not kept.
      const gone = idRef.current;
      if (gone) { setId(null); createdAt.current = null; setStatus('idle'); await deleteWorkDraft(gone); }
      return;
    }
    let target = idRef.current;
    if (!target) { target = newDraftId(kind); setId(target); }
    const now = new Date().toISOString();
    createdAt.current ??= now;
    const { data, leftOut } = toStorable(v);
    setStatus('saving');
    // Counted as written from here, so the page going twice (hidden, then closed) is one write; a failure undoes it.
    lastJson.current = json;
    // The token the page-closing request will carry (a promise cannot be waited for while the page goes).
    auth?.currentUser?.getIdToken().then(t => { token.current = t; }, () => undefined);
    try {
      await setDoc(doc(db, COLL, target), {
        kind, data, ...sum(v), device: thisDevice(), createdAt: createdAt.current, updatedAt: now,
        ...(leftOut?.length ? { leftOut } : {}),
      });
      // Finished while the write was in flight: take it back out.
      if (finished.current) { await deleteWorkDraft(target); return; }
      landedJson.current = json;
      setSavedAt(now);
      setStatus('saved');
    } catch {
      // Not written: the next change (or the page going) writes again.
      if (lastJson.current === json) lastJson.current = '';
      setStatus('error');
    }
  }, [kind, setId]);

  // One writer for the life of the form; it always runs the latest write.
  const runRef = React.useRef(writeNow);
  runRef.current = writeNow;
  const writerRef = React.useRef<CoalescingWriter | null>(null);
  if (!writerRef.current) writerRef.current = new CoalescingWriter(() => runRef.current());
  const writer = writerRef.current;

  // A form that stops being new (an invoice now on screen) stops writing; one that becomes new
  // again (the next sale) starts afresh.
  const wasActive = React.useRef(active);
  React.useEffect(() => {
    if (active && !wasActive.current) { finished.current = false; lastJson.current = ''; createdAt.current = null; }
    if (!active) writer.cancel();
    wasActive.current = active;
  }, [active]);

  // Every render may carry a new object for the same values (react-hook-form's watch()), so the
  // comparison is made when the write starts, on the text, not on the object.
  React.useEffect(() => {
    if (!enabled || !active || finished.current) return;
    writer.touch();
  });

  // Leaving: the tab hidden (the phone's home button, another app), the page closing, the form going.
  React.useEffect(() => {
    const leave = () => {
      const { value: v, summary: sum, ignore: ign, enabled: on, active: live } = latest.current;
      if (!on || !live || finished.current || loading.current) return;
      void writer.flush(true);
      // The write above is the SDK's, queued on disk; this one reaches the server even as the page goes.
      const target = idRef.current;
      if (!target || !token.current || !isWorthKeeping(v, ign)) return;
      const json = JSON.stringify(v ?? {});
      if (json === landedJson.current) return;
      const s = sum(v);
      const { data } = toStorable(v);
      const body = JSON.stringify({
        action: 'save', id: target, kind, data, total: s.total,
        customerName: kind === 'sale' && s.title !== 'No customer yet' ? s.title : '',
        device: thisDevice(), createdAt: createdAt.current ?? new Date().toISOString(),
      });
      if (!fitsBeacon(body)) return;
      try {
        void fetch('/api/app/drafts', {
          method: 'POST', keepalive: true, body,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.current}` },
        }).catch(() => undefined);
      } catch { /* the queued write carries it */ }
    };
    const onHidden = () => { if (document.visibilityState === 'hidden') leave(); };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', leave);
    // The token the page-closing request carries is kept fresh (they last an hour).
    const refresh = () => { auth?.currentUser?.getIdToken().then(t => { token.current = t; }, () => undefined); };
    refresh();
    const tokenTimer = setInterval(refresh, 20 * 60_000);
    return () => {
      clearInterval(tokenTimer);
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', leave);
      // The form going (a link inside the app): what was typed last is written now.
      void writer.flush(true);
    };
  }, [kind]);

  const load = React.useCallback(async (draftId: string) => {
    writer.cancel();
    loading.current = true;
    let d: WorkDraft<T> | null = null;
    try { d = await readWorkDraft<T>(draftId); } finally { loading.current = false; }
    if (!d) return null;
    finished.current = false;
    createdAt.current = d.createdAt || new Date().toISOString();
    lastJson.current = JSON.stringify(d.data ?? {});
    landedJson.current = lastJson.current;
    setId(draftId);
    setSavedAt(d.updatedAt || null);
    setStatus('saved');
    return d;
  }, [setId]);

  /** The record is saved: the draft goes, for good. */
  const finish = React.useCallback(() => {
    finished.current = true;
    writer.cancel();
    const gone = idRef.current;
    idRef.current = null;
    setIdState(null);
    latest.current.onId?.(null);
    setStatus('idle');
    if (gone) void deleteWorkDraft(gone);
  }, []);

  /** Thrown away on purpose. */
  const discard = React.useCallback(() => {
    writer.cancel();
    const gone = idRef.current;
    // What is still on screen is not written straight back; only a change makes it a draft again.
    lastJson.current = JSON.stringify(latest.current.value ?? {});
    createdAt.current = null;
    setId(null);
    setStatus('idle');
    if (gone) void deleteWorkDraft(gone);
  }, [setId]);

  /** Let go of this draft without removing it (it stays in Drafts); the form starts a new one. */
  const detach = React.useCallback(() => {
    writer.cancel();
    // What is on screen is that draft's; it is not written again as a new one unless it changes.
    lastJson.current = JSON.stringify(latest.current.value ?? {});
    createdAt.current = null;
    setId(null);
    setStatus('idle');
  }, [setId]);

  return { id, status, savedAt, load, finish, discard, detach };
}
