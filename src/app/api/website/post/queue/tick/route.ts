/**
 * POST → send the queued pieces whose time has come (Post a Piece's "Spread
 * over the day"), each claimed first so an overlapping or retried check can't
 * send it twice; a piece that fails is tried again at the next check, three
 * times in all. Also clears drafts that never finished arriving.
 *
 * Called every five minutes by Cloud Scheduler (job `social-queue-tick`, in
 * each house's project) with `Authorization: Bearer <CRON_SECRET>`.
 * `?dry=1` answers what is due without sending anything.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/api-auth';
import { mediaOrigin, notInThisShop } from '@/lib/social/gate';
import { STORE_POST_PIECE } from '@/lib/store-config';
import { claimItem, dueItems, sendItem, sweep } from '@/lib/social/queue';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Stop taking new pieces after this long, so the last one finishes inside the request. */
const BUDGET_MS = 150_000;

export async function POST(req: NextRequest) {
  if (!STORE_POST_PIECE) return notInThisShop();
  if (!isCronAuthorized(req, { strict: true })) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const started = Date.now();
  const due = await dueItems(new Date(started));
  if (req.nextUrl.searchParams.get('dry') === '1') return NextResponse.json({ ok: true, dry: true, due: due.map(d => ({ id: d.id, headline: d.headline, dueAt: d.dueAt, status: d.status })) });
  const results: { id: string; headline: string; status: string }[] = [];
  for (const d of due) {
    if (Date.now() - started > BUDGET_MS) break;
    const item = await claimItem(d.id, new Date());
    if (!item) continue;
    const after = await sendItem(item, { by: 'schedule', origin: mediaOrigin(req) });
    results.push({ id: d.id, headline: d.headline, status: after.status });
  }
  const swept = await sweep().catch(() => 0);
  if (results.length) console.log(`[queue/tick] ${results.map(r => `${r.headline || r.id}:${r.status}`).join(' ')}`);
  return NextResponse.json({ ok: true, due: due.length, results, swept });
}
