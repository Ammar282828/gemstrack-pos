"use client";

/**
 * Drafts in Firestore `drafts`: the list for the Drafts section, and the hook a new order form or a
 * new sale uses to keep itself there as it is typed. The rules are in lib/work-drafts.ts.
 */

import React from 'react';
import { collection, deleteDoc, doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAppStore } from '@/lib/store';
import {
  deviceName, isExpired, isWorthKeeping, legacyAlreadySaved, newDraftId, summarizeOrder, summarizeSale, toStorable,
  type DraftSummary, type WorkDraft, type WorkDraftKind,
} from '@/lib/work-drafts';
import { listDrafts, clearAllDrafts } from '@/lib/form-drafts';

const COLL = 'drafts';
/** Quiet this long after the last keystroke, then write. */
const SAVE_AFTER_MS = 1000;

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
 *  - Written a second after typing stops, only when something changed, only when there is
 *    something worth keeping (`ignore`: fields a blank form already has). Emptied → removed.
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
  const lastJson = React.useRef<string>('');
  const finished = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // A draft being fetched to continue: nothing is written until it is on screen, or the blank
  // form it replaces would be taken for an emptied draft.
  const loading = React.useRef(false);
  const latest = React.useRef({ value, summary, ignore, onId });
  latest.current = { value, summary, ignore, onId };

  const setId = React.useCallback((next: string | null) => {
    idRef.current = next;
    setIdState(next);
    latest.current.onId?.(next);
  }, []);

  const cancel = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };

  // A form that stops being new (an invoice now on screen) stops writing; one that becomes new
  // again (the next sale) starts afresh.
  const wasActive = React.useRef(active);
  React.useEffect(() => {
    if (active && !wasActive.current) { finished.current = false; lastJson.current = ''; createdAt.current = null; }
    if (!active) cancel();
    wasActive.current = active;
  }, [active]);

  const writeNow = React.useCallback(async () => {
    timer.current = null;
    if (finished.current || loading.current) return;
    const { value: v, summary: sum, ignore: ign } = latest.current;
    const json = JSON.stringify(v ?? {});
    if (json === lastJson.current) return;
    if (!isWorthKeeping(v, ign)) {
      // Emptied: a draft of nothing is removed, not kept.
      lastJson.current = json;
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
    try {
      await setDoc(doc(db, COLL, target), {
        kind, data, ...sum(v), device: thisDevice(), createdAt: createdAt.current, updatedAt: now,
        ...(leftOut?.length ? { leftOut } : {}),
      });
      // Finished while the write was in flight: take it back out.
      if (finished.current) { await deleteWorkDraft(target); return; }
      lastJson.current = json;
      setSavedAt(now);
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }, [kind, setId]);

  // Every render may carry a new object for the same values (react-hook-form's watch()), so the
  // comparison is made when the timer fires, on the text, not on the object.
  React.useEffect(() => {
    if (!enabled || !active || finished.current) return;
    cancel();
    timer.current = setTimeout(() => { void writeNow(); }, SAVE_AFTER_MS);
    return cancel;
  });

  const load = React.useCallback(async (draftId: string) => {
    cancel();
    loading.current = true;
    let d: WorkDraft<T> | null = null;
    try { d = await readWorkDraft<T>(draftId); } finally { loading.current = false; }
    if (!d) return null;
    finished.current = false;
    createdAt.current = d.createdAt || new Date().toISOString();
    lastJson.current = JSON.stringify(d.data ?? {});
    setId(draftId);
    setSavedAt(d.updatedAt || null);
    setStatus('saved');
    return d;
  }, [setId]);

  /** The record is saved: the draft goes, for good. */
  const finish = React.useCallback(() => {
    finished.current = true;
    cancel();
    const gone = idRef.current;
    idRef.current = null;
    setIdState(null);
    latest.current.onId?.(null);
    setStatus('idle');
    if (gone) void deleteWorkDraft(gone);
  }, []);

  /** Thrown away on purpose. */
  const discard = React.useCallback(() => {
    cancel();
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
    cancel();
    // What is on screen is that draft's; it is not written again as a new one unless it changes.
    lastJson.current = JSON.stringify(latest.current.value ?? {});
    createdAt.current = null;
    setId(null);
    setStatus('idle');
  }, [setId]);

  return { id, status, savedAt, load, finish, discard, detach };
}
