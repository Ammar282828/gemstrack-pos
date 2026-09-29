/**
 * The vision model assesses photographs for the Ad studio (assess.ts, ten a call).
 *
 * GET                        whether it runs in the background, and its last run
 * POST { ids: [...] }        these photographs now (one opened in the sheet, a page of the grid)
 * POST { next: true }        a slice of the newest not yet assessed, now (the page's "Assess now")
 * POST { background: bool }  run by itself on the five-minute tick, or pause
 * force: true                assess again even if already assessed
 *
 * The background work is done by `runAssessSlice` from `social-queue-tick` (assess-run.ts);
 * the page only starts or pauses it and shows the counts. Capped per day (AD_STUDIO_DAILY_CAP
 * model calls, default 400 ≈ 4,000 photographs).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsGate, noStore } from '@/lib/ads/gate';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { aiConfigured } from '@/lib/social/ai';
import { loadAssessState, runAssessSlice, setBackground } from '@/lib/ads/studio/assess-run';
import { studioFail } from '@/lib/ads/studio/route-kit';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  const s = await loadAssessState();
  return NextResponse.json({ background: s.background, running: s.leaseUntil > Date.now(), lastRun: s.lastRun }, { headers: noStore });
}

export async function POST(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  const body = await req.json().catch(() => ({})) as { ids?: unknown; next?: boolean; force?: boolean; budgetMs?: number; background?: boolean };
  try {
    if (typeof body.background === 'boolean') {
      await setBackground(body.background);
      return NextResponse.json({ background: body.background }, { headers: noStore });
    }
    if (!aiConfigured()) return NextResponse.json({ error: 'AI is not set up for this shop.' }, { status: 503 });
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : [];
    if (!ids.length && !body.next) return NextResponse.json({ error: 'Nothing asked for.' }, { status: 400 });
    const budgetMs = Math.min(240_000, Math.max(20_000, Number(body.budgetMs) || 200_000));
    return NextResponse.json(await runAssessSlice({ budgetMs, by: 'page', ids, force: !!body.force }), { headers: noStore });
  } catch (e) {
    return studioFail(e, 'assess');
  }
}
