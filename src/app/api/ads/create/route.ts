/**
 * POST { plan: AdPlan } → a new campaign, ad set and ad in this house's ad
 * account (src/lib/ads/create.ts), paused or live as the plan says.
 *   → { campaignId, adsetId, creativeId, adId, live, warnings }
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsFail, adsGate } from '@/lib/ads/gate';
import { createAd } from '@/lib/ads/create';
import { planContext } from '@/lib/ads/context';
import { logAds } from '@/lib/ads/log';
import { GOALS, type AdPlan } from '@/lib/ads/plan';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Enough of a plan to hand to Meta — the rest is checked by planProblems and by Meta itself. */
function isPlan(p: unknown): p is AdPlan {
  const x = p as AdPlan;
  return !!x && typeof x === 'object'
    && GOALS.some(g => g.key === x.goal)
    && !!x.source && (x.source.kind === 'post' || (x.source.kind === 'photos' && Array.isArray(x.source.photos)))
    && typeof x.text === 'string' && typeof x.headline === 'string' && typeof x.link === 'string'
    && !!x.audience && Array.isArray(x.audience.places)
    && !!x.budget && typeof x.budget.amount === 'number'
    && (x.launch === 'paused' || x.launch === 'live')
    && typeof x.name === 'string' && x.name.trim().length > 0;
}

export async function POST(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const { plan } = (await req.json().catch(() => ({}))) as { plan?: unknown };
  if (!isPlan(plan)) return NextResponse.json({ error: 'The ad is missing something — reload the page and try again.' }, { status: 400 });
  try {
    const { act, ctx } = await planContext();
    const made = await createAd(act, { ...plan, name: plan.name.trim().slice(0, 200) }, ctx);
    await logAds({ by: who, action: made.live ? 'created live' : 'created paused', target: made.adId, name: plan.name, detail: { goal: plan.goal, budget: plan.budget, campaignId: made.campaignId } });
    return NextResponse.json(made);
  } catch (e) {
    return adsFail(e, 'create');
  }
}
