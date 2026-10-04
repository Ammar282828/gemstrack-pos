/**
 * This week's board (the owner, 2026-10-04: a board made by itself every Monday from the week's new
 * pieces, for the WhatsApp channel and Instagram — "yes"). On Monday from 9:00, Karachi, the queue
 * tick (and "This week's board" on the page) starts a board: the week's new website pieces, topped
 * up with the best photos not yet used in an ad, six at most; each gets the art director's layout and
 * words (art-direct.ts) as a 4:5 feed design and a 9:16 story, side by side, a piece per row. The
 * page lays them out and draws them when the board is opened; the owner deletes what they don't want
 * and sends the rest from the board.
 *
 * One piece per AI call, paced (the Vertex key's per-minute quota is the counter's too), in slices
 * across ticks: `app_settings/studio_weekly` remembers where it is. Server-only.
 */

import { adminDb } from '@/lib/firebase-admin';
import { prepareImage } from '@/lib/social/ai';
import { listAssets, loadAssessments, usedAssetIds, assetJpeg, type StudioAsset } from './assets';
import { adScore } from './assessment';
import { artDirect } from './art-direct';
import { changeBoard, createBoard } from './board';
import { BOARD_SCALE, GAP, safeTemplate } from './board-shape';
import { AD_FORMATS } from './templates';

const STATE = 'app_settings/studio_weekly';
export const WEEKLY_PIECES = 6;
const PACE_MS = 8_000;
const by = 'agent:weekly';

export interface WeeklyState {
  week: string | null;
  board: string | null;
  pending: { id: string; name: string; collection: string; specs: string; photo: string; marked: boolean; tries?: number }[];
  done: number;
  failed: string[];
  startedAt: string | null;
  finishedAt: string | null;
  /** A slice running now (with its start), so the page and the tick never double up. */
  lease: string | null;
}

const EMPTY: WeeklyState = { week: null, board: null, pending: [], done: 0, failed: [], startedAt: null, finishedAt: null, lease: null };

/** Karachi's date parts (UTC+5, no summer time). */
function karachi(now: Date) {
  const k = new Date(now.getTime() + 5 * 3_600_000);
  return { day: k.getUTCDay(), hour: k.getUTCHours(), date: k };
}

/** The week a moment falls in, by its Monday in Karachi: "2026-10-05". */
export function weekOf(now: Date): string {
  const { date } = karachi(now);
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

/** Due: this week has no board yet, and it is Monday 9:00 or later in Karachi (or any later day). */
export function weeklyDue(state: Pick<WeeklyState, 'week'>, now: Date): boolean {
  if (state.week === weekOf(now)) return false;
  const { day, hour } = karachi(now);
  return !(day === 1 && hour < 9);
}

export async function loadWeekly(): Promise<WeeklyState> {
  const s = await adminDb.doc(STATE).get();
  return { ...EMPTY, ...(s.exists ? (s.data() as Partial<WeeklyState>) : {}) };
}
const saveWeekly = (s: Partial<WeeklyState>) => adminDb.doc(STATE).set(s, { merge: true });

const ms = (v: number | null) => (v == null ? 0 : v < 1e12 ? v * 1000 : v);

/** The pieces for this week: new on the website in the last eight days, then the best unused photos. */
export function choosePieces(assets: (StudioAsset & { score: number | null; used: boolean })[], now: Date, n = WEEKLY_PIECES): StudioAsset[] {
  // One row a piece: a piece's other photographs (taheri.shop's angleOf) are on the site under the
  // same name, so the newest photo of each name stands for the piece.
  const seen = new Set<string>();
  const site = assets.filter(a => a.source === 'site').sort((a, b) => ms(b.added) - ms(a.added)).filter(a => {
    const k = `${a.collection}|${a.name}`.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const since = now.getTime() - 8 * 86_400_000;
  const fresh = site.filter(a => ms(a.added) >= since).sort((a, b) => ms(b.added) - ms(a.added));
  const out: StudioAsset[] = fresh.slice(0, n);
  if (out.length < n) {
    const best = site.filter(a => !a.used && !out.includes(a) && (a.score ?? 0) >= 60).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    out.push(...best.slice(0, n - out.length));
  }
  return out;
}

/** Start this week's board (or another one now, `force`). */
export async function startWeekly(now: Date, force = false): Promise<WeeklyState> {
  const state = await loadWeekly();
  if (!force && !weeklyDue(state, now)) return state;
  const [lib, assessed, used] = await Promise.all([listAssets(), loadAssessments(), usedAssetIds()]);
  const rows = lib.assets.map(a => { const s = assessed.get(a.id)?.assessment; return { ...a, score: s ? adScore(s, 'portrait') : null, used: used.has(a.id) }; });
  const pieces = choosePieces(rows, now);
  const label = new Date(now.getTime() + 5 * 3_600_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const board = await createBoard(`This week · ${label}`, by);
  const fresh = pieces.filter(p => ms(p.added) >= now.getTime() - 8 * 86_400_000).length;
  await changeBoard(board.id, [{ op: 'note', note: { by: 'agent', x: -280, y: 0, text: pieces.length
    ? `This week's board: ${fresh} new piece${fresh === 1 ? '' : 's'} from the website${pieces.length > fresh ? `, and ${pieces.length - fresh} of the best photos not yet in an ad` : ''}. Each as a 4:5 for the feed and WhatsApp and a 9:16 story. Delete what you don't want; send the rest from each design's panel (Queue a post, New ad, Save).`
    : 'No new pieces on the website this week, and no unused photos scored well enough. Add some from the library.' } }], by);
  const next: WeeklyState = {
    week: weekOf(now), board: board.id, done: 0, failed: [], startedAt: now.toISOString(), finishedAt: pieces.length ? null : now.toISOString(), lease: null,
    pending: pieces.map(p => ({ id: p.id, name: p.name, collection: p.collection, specs: p.specs, photo: p.original?.id ?? p.id, marked: !p.original })),
  };
  await adminDb.doc(STATE).set(next);
  return next;
}

/** Design the next pieces within the budget. */
export async function runWeeklySlice(budgetMs: number): Promise<WeeklyState & { busy?: boolean }> {
  const started = Date.now();
  const leaseId = `${started}`;
  // A lease, so the page and the tick never design the same piece twice.
  const got = await adminDb.runTransaction(async tx => {
    const ref = adminDb.doc(STATE);
    const s = { ...EMPTY, ...((await tx.get(ref)).data() as Partial<WeeklyState> | undefined) };
    if (!s.board || !s.pending.length) return null;
    if (s.lease && started - Number(s.lease) < budgetMs + 60_000) return null;
    tx.set(ref, { lease: leaseId }, { merge: true });
    return s;
  });
  if (!got) return { ...(await loadWeekly()), busy: true };
  let state = got;
  try {
    let row = Math.floor(state.done);
    while (state.pending.length && Date.now() - started < budgetMs - 45_000) {
      const p = state.pending[0];
      try {
        const photo = await prepareImage(await assetJpeg(p.photo, 1024));
        const d = await artDirect(photo, { name: p.name, collection: p.collection, specs: p.specs, price: '', brief: 'This week’s new piece, for the WhatsApp channel and Instagram.', format: 'portrait (4:5)', destination: 'a WhatsApp chat with the shop' });
        const fields = { kicker: d.kicker || (p.collection !== 'Website' ? p.collection : ''), headline: d.headline, weight: p.specs, details: d.cta };
        const y = row * (AD_FORMATS.story.frame.h * BOARD_SCALE + GAP + 28);
        const common = { assetId: p.photo, marked: p.marked, fields, why: d.why, by: 'ai' as const, doc: null };
        await changeBoard(state.board!, [
          { op: 'add', frame: { ...common, template: safeTemplate(d.layout, { marked: p.marked, format: 'portrait' }), label: `${p.name} · 4:5`, format: 'portrait', x: 0, y } },
          { op: 'add', frame: { ...common, template: safeTemplate(d.layout, { marked: p.marked, format: 'story' }), label: `${p.name} · 9:16`, format: 'story', x: AD_FORMATS.portrait.frame.w * BOARD_SCALE + GAP, y } },
        ], by);
        state = { ...state, pending: state.pending.slice(1), done: state.done + 1 };
        row++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const status = (e as { status?: number })?.status;
        const tries = (p.tries ?? 0) + 1;
        // The AI's per-minute quota (shared with the counter): the piece waits for the next slice, three tries in all.
        if ((status === 429 || /quota|rate limit|resource.?exhausted/i.test(msg)) && tries < 3) {
          state = { ...state, pending: [{ ...p, tries }, ...state.pending.slice(1)] };
          await saveWeekly({ pending: state.pending });
          break;
        }
        state = { ...state, pending: state.pending.slice(1), failed: [...state.failed, `${p.name}: ${msg}`.slice(0, 200)] };
      }
      await saveWeekly({ pending: state.pending, done: state.done, failed: state.failed, ...(state.pending.length ? {} : { finishedAt: new Date().toISOString() }) });
      if (state.pending.length) await new Promise(r => setTimeout(r, PACE_MS));
    }
  } finally {
    await saveWeekly({ lease: null });
  }
  return { ...(await loadWeekly()) };
}

