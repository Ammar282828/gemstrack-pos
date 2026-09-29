/**
 * POST — the vision model assesses photographs for the Ad studio.
 *
 *   { ids: [...] }   these photographs (a page of the grid, one opened in the sheet)
 *   { next: true }   the newest photographs not yet assessed, as many as the time allows
 *   force: true      assess again even if already assessed
 *
 * Works in batches of ten (assess.ts) for up to about four minutes, then answers with
 * what it did and how many are left; the page calls again while the owner keeps it open,
 * and anything done is stored, so closing the page loses nothing. Capped per day
 * (AD_STUDIO_DAILY_CAP model calls, default 400 ≈ 4,000 photographs).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsGate, noStore } from '@/lib/ads/gate';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { aiConfigured, AiError } from '@/lib/social/ai';
import { rateLimit } from '@/lib/website/ratelimit';
import { listAssets, loadAssessments } from '@/lib/ads/studio/assets';
import { assessBatch, ASSESS_BATCH } from '@/lib/ads/studio/assess';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DAILY_CAP = Number(process.env.AD_STUDIO_DAILY_CAP) || 400;

export async function POST(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  if (!aiConfigured()) return NextResponse.json({ error: 'AI is not set up for this shop.' }, { status: 503 });

  const body = await req.json().catch(() => ({})) as { ids?: unknown; next?: boolean; force?: boolean; budgetMs?: number };
  const budget = Math.min(240_000, Math.max(20_000, Number(body.budgetMs) || 200_000));
  const started = Date.now();

  const [lib, assessed] = await Promise.all([listAssets(), loadAssessments()]);
  const byId = new Map(lib.assets.map(a => [a.id, a]));
  const asked = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string' && byId.has(x)) : [];
  const queue = (asked.length ? asked : body.next ? lib.assets.map(a => a.id) : [])
    .filter(id => body.force || !assessed.has(id))
    .map(id => byId.get(id)!)
    .slice(0, asked.length ? 60 : 5000);

  const done: string[] = [];
  const failed: { id: string; error: string }[] = [];
  let stopped: string | null = null;
  for (let i = 0; i < queue.length; i += ASSESS_BATCH) {
    if (Date.now() - started > budget) { stopped = 'time'; break; }
    const cap = await rateLimit('ad-assess-day', 'shop', DAILY_CAP, 86_400);
    if (!cap.ok) { stopped = `The day’s assessment limit is reached; it picks up again in about ${Math.ceil(cap.retryAfter / 3600)} hours.`; break; }
    try {
      const r = await assessBatch(queue.slice(i, i + ASSESS_BATCH));
      done.push(...r.done.map(d => d.id));
      failed.push(...r.failed);
    } catch (e) {
      // A refused key or an empty quota will refuse the next batch too: stop and say so.
      stopped = e instanceof AiError || e instanceof Error ? e.message : 'The model did not answer.';
      break;
    }
  }

  const now = await loadAssessments();
  const remaining = lib.assets.filter(a => !now.has(a.id)).length;
  return NextResponse.json({
    done, failed, stopped: stopped === 'time' ? null : stopped,
    // Only a call that ran out of time has more to do: photos that failed are not retried in a loop.
    more: stopped === 'time',
    assessed: now.size, remaining, seconds: Math.round((Date.now() - started) / 1000),
  }, { headers: noStore });
}
