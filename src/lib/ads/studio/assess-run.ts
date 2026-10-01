/**
 * Assessing the library without anyone watching (the owner, 2026-09-29: "the assessment
 * feature should run in the background").
 *
 * One runner for both callers: the five-minute `social-queue-tick` (after its own queue work)
 * and the page's "Assess now". A lease in `app_settings/ad_studio_assess` lets only one slice run
 * at a time, so the tick and the page never pay twice for the same photographs. In the background
 * the slice is paced — a pause between batches — because the Vertex key's per-minute quota is
 * shared with Post a Piece and the counter's scanners, which must not be starved by it. A batch
 * that kills the server, or a photo that keeps failing, is set aside after two tries
 * (assess-strikes.ts) instead of being started again on every tick.
 *
 * Server-only.
 */

import { adminDb } from '@/lib/firebase-admin';
import { AiError } from '@/lib/social/ai';
import { rateLimit } from '@/lib/website/ratelimit';
import { listAssets, loadAssessments } from './assets';
import { assessBatch, ASSESS_BATCH } from './assess';
import { addStrikes, clearStrikes, readStrikes, setAside, type Strike } from './assess-strikes';

const DAILY_CAP = Number(process.env.AD_STUDIO_DAILY_CAP) || 400;
const stateDoc = () => adminDb.collection('app_settings').doc('ad_studio_assess');

export interface AssessState {
  /** On unless the owner paused it. */
  background: boolean;
  leaseUntil: number;
  lastRun: { at: string; by: 'background' | 'page'; done: number; failed: number; stopped: string | null; seconds: number } | null;
}

export async function loadAssessState(): Promise<AssessState> {
  const d = (await stateDoc().get().catch(() => null))?.data() as Partial<AssessState> | undefined;
  return { background: d?.background !== false, leaseUntil: d?.leaseUntil ?? 0, lastRun: d?.lastRun ?? null };
}

export const setBackground = (on: boolean) => stateDoc().set({ background: on }, { merge: true });

async function takeLease(ms: number): Promise<boolean> {
  return adminDb.runTransaction(async tx => {
    const snap = await tx.get(stateDoc());
    const until = (snap.data()?.leaseUntil as number | undefined) ?? 0;
    if (until > Date.now()) return false;
    tx.set(stateDoc(), { leaseUntil: Date.now() + ms }, { merge: true });
    return true;
  });
}

export interface SliceResult {
  done: string[]; failed: { id: string; error: string }[]; stopped: string | null; more: boolean;
  /** `remaining` leaves out the photos set aside; `setAside` counts them. */
  assessed: number; remaining: number; seconds: number; busy?: boolean; setAside?: number;
}

/**
 * Assess the newest photographs not yet assessed (or `ids`, or again with `force`) for up to
 * `budgetMs`. `paceMs` waits between batches. Returns `busy` when another slice holds the lease.
 */
export async function runAssessSlice(o: { budgetMs: number; by: 'background' | 'page'; ids?: string[]; force?: boolean; paceMs?: number }): Promise<SliceResult> {
  const started = Date.now();
  const whole = !o.ids?.length;
  if (whole && !(await takeLease(o.budgetMs + 60_000))) {
    return { done: [], failed: [], stopped: null, more: true, assessed: 0, remaining: 0, seconds: 0, busy: true };
  }
  const done: string[] = [];
  const failed: { id: string; error: string }[] = [];
  let stopped: string | null = null;
  // Only a lease holder keeps the strikes, so two writers never race on them.
  let strikes: Strike[] = [];
  try {
    if (whole) {
      const st = (await stateDoc().get()).data() ?? {};
      strikes = readStrikes(st.strikes);
      const died = Array.isArray(st.inFlight) ? (st.inFlight as unknown[]).filter((x): x is string => typeof x === 'string') : [];
      if (died.length) {
        console.warn(`[assess] the last slice stopped during a batch of ${died.length} — a strike each`);
        strikes = addStrikes(strikes, died, () => 'The server stopped while assessing it.');
        await stateDoc().set({ inFlight: null, strikes }, { merge: true });
      }
    }
    const aside = whole && !o.force ? setAside(strikes) : new Set<string>();
    const [lib, assessed] = await Promise.all([listAssets(), loadAssessments(true)]);
    const byId = new Map(lib.assets.map(a => [a.id, a]));
    const queue = (whole ? lib.assets.map(a => a.id) : o.ids!.filter(id => byId.has(id)))
      .filter(id => o.force || !assessed.has(id))
      .filter(id => !aside.has(id))
      .map(id => byId.get(id)!)
      .slice(0, whole ? 5000 : 60);
    for (let i = 0; i < queue.length; i += ASSESS_BATCH) {
      if (Date.now() - started > o.budgetMs) { stopped = 'time'; break; }
      if (i > 0 && o.paceMs) await new Promise(r => setTimeout(r, o.paceMs));
      const cap = await rateLimit('ad-assess-day', 'shop', DAILY_CAP, 86_400);
      if (!cap.ok) { stopped = `The day’s assessment limit is reached; it picks up again in about ${Math.ceil(cap.retryAfter / 3600)} hours.`; break; }
      const batch = queue.slice(i, i + ASSESS_BATCH);
      if (whole) await stateDoc().set({ inFlight: batch.map(a => a.id) }, { merge: true });
      try {
        const r = await assessBatch(batch);
        done.push(...r.done.map(d => d.id));
        failed.push(...r.failed);
        if (whole) {
          const why = new Map(r.failed.map(f => [f.id, f.error]));
          strikes = clearStrikes(addStrikes(strikes, r.failed.map(f => f.id), id => why.get(id) ?? ''), r.done.map(d => d.id));
          await stateDoc().set({ inFlight: null, strikes }, { merge: true });
        }
      } catch (e) {
        // A refused key or an empty quota will refuse the next batch too: stop and say so. Not the photos' fault.
        if (whole) await stateDoc().set({ inFlight: null }, { merge: true });
        stopped = e instanceof AiError || e instanceof Error ? e.message : 'The model did not answer.';
        break;
      }
    }
    const now = await loadAssessments();
    const left = lib.assets.filter(a => !now.has(a.id));
    const asideNow = whole ? setAside(strikes) : new Set<string>();
    const remaining = left.filter(a => !asideNow.has(a.id)).length;
    const seconds = Math.round((Date.now() - started) / 1000);
    const result: SliceResult = { done, failed, stopped: stopped === 'time' ? null : stopped, more: stopped === 'time', assessed: now.size, remaining, seconds, setAside: left.length - remaining };
    if (whole) await stateDoc().set({ leaseUntil: 0, lastRun: { at: new Date().toISOString(), by: o.by, done: done.length, failed: failed.length, stopped: result.stopped, seconds } }, { merge: true });
    return result;
  } catch (e) {
    if (whole) await stateDoc().set({ leaseUntil: 0, inFlight: null }, { merge: true }).catch(() => undefined);
    throw e;
  }
}
