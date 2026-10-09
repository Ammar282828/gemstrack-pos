/**
 * For the iPhone's New ad and ad set screens (apps/iphone/App/Screens/Marketing/AdsNewAd.swift, AdsAdSets.swift),
 * which keep none of New ad's rules themselves (src/lib/ads/phone-plan.ts):
 *
 * GET              → { goals, buttons, igPositions, links, sitePieces, quiet }: what New ad offers in this house,
 *                    in the web's words, and the days ahead it keeps free of product ads
 * POST { plan }    → { problems, summary, name, audience }: what stops it, and planSummary's lines (what it will
 *                    do and cost), for the phone's confirm before /api/ads/create
 * POST { design }  → { problems, summary, count }: the same for /api/ads/adsets
 *
 * Nothing is made: a check reads only the account's currency and smallest daily budget (planContext).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsFail, adsGate, noStore } from '@/lib/ads/gate';
import { planContext } from '@/lib/ads/context';
import { STORE_AD_STUDIO, STORE_LINKS, STORE_SITE_POSTS } from '@/lib/store-config';
import { BRAND } from '@/lib/ads/studio/brand';
import { checkDesign, checkPlan, isDesignShape, isPlanShape, newAdLists } from '@/lib/ads/phone-plan';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const links = { website: STORE_LINKS.website || '', shop: STORE_LINKS.shop || '', waChannel: STORE_LINKS.waChannel || '' };
  return NextResponse.json(newAdLists(links, { sitePieces: STORE_SITE_POSTS, calendar: STORE_AD_STUDIO && BRAND.calendar }), { headers: noStore });
}

export async function POST(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const b = (await req.json().catch(() => ({}))) as { plan?: unknown; design?: unknown };
  if (b.plan === undefined && b.design === undefined) return NextResponse.json({ error: 'Nothing to check.' }, { status: 400 });
  if (b.plan !== undefined && !isPlanShape(b.plan)) return NextResponse.json({ error: 'The ad is missing something — open New ad again.' }, { status: 400 });
  if (b.design !== undefined && !isDesignShape(b.design)) return NextResponse.json({ error: 'The ad sets are missing something — open the page again.' }, { status: 400 });
  try {
    const { ctx } = await planContext();
    if (isPlanShape(b.plan)) return NextResponse.json(checkPlan(b.plan, ctx), { headers: noStore });
    return NextResponse.json(checkDesign(b.design as Parameters<typeof checkDesign>[0], ctx), { headers: noStore });
  } catch (e) {
    return adsFail(e, 'plan check');
  }
}
