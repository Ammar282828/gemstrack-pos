/**
 * One competitor.
 *
 * GET (?fresh=1)   their public Instagram (Business Discovery), kept a day
 * POST             the model reads their best and weakest posts for the house
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsGate, noStore } from '@/lib/ads/gate';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { competitorProfile, readCompetitor } from '@/lib/ads/studio/research';
import { adLibraryUrl, engagementRate } from '@/lib/ads/studio/rivals';
import { studioAiGate, studioFail } from '@/lib/ads/studio/route-kit';
import type { Competitor } from '@/lib/ads/studio/research';

export const dynamic = 'force-dynamic';
export const maxDuration = 240;

const shaped = (c: Competitor) => ({
  ...c, adLibrary: adLibraryUrl(c.name || c.username, c.adPageId), instagram: `https://www.instagram.com/${c.username}/`,
  profile: c.profile ? { ...c.profile, posts: c.profile.posts.map(p => ({ ...p, rate: engagementRate(p, c.profile!.followers) })) } : null,
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  try {
    const { username } = await params;
    return NextResponse.json({ competitor: shaped(await competitorProfile(username, req.nextUrl.searchParams.get('fresh') === '1')) }, { headers: noStore });
  } catch (e) {
    return studioFail(e, 'competitor');
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  const blocked = await studioAiGate(req);
  if (blocked) return blocked;
  try {
    const { username } = await params;
    return NextResponse.json({ competitor: shaped(await readCompetitor(username)) }, { headers: noStore });
  } catch (e) {
    return studioFail(e, 'competitor/read');
  }
}
