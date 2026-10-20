/**
 * GET ?url= → a picture from outside the shop, for Design's smart input (plan §6, WP4). The same fetch as the
 * Studio board's /api/ads/studio/fetch-image — an image address as it is, a page (an Instagram post, a product
 * page) gives the picture it shares — widened from the Studio's gate to `designGate('post')`, and safer on
 * redirects: every hop is re-checked as a public address (parse-url.ts, over outside-image.ts). At most 25 MB,
 * one picture per request. The old route stays.
 */

import { NextRequest, NextResponse } from 'next/server';
import { designFail, designGate, noStore } from '@/lib/design/gate';
import { publicUrl } from '@/lib/ads/studio/outside-image';
import { fetchPicture } from '@/lib/design/parse-url';
import { dailyCap, dailyCapForRequest, AI_PER_DAY, WHATSAPP_PER_DAY, INSTAGRAM_PER_DAY } from '@/lib/daily-cap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 40;

export async function GET(req: NextRequest) {
  const who = await designGate(req, 'post');
  if (who instanceof NextResponse) return who;
  const capped = await dailyCap('ai', who, req, AI_PER_DAY);
  if (capped) return capped;
  const u = publicUrl(req.nextUrl.searchParams.get('url') || '');
  if (!u) return NextResponse.json({ error: 'Paste a web address (https://…).' }, { status: 400 });
  try {
    const pic = await fetchPicture(u);
    return new NextResponse(new Uint8Array(pic.bytes), { headers: { 'Content-Type': pic.type, ...noStore } });
  } catch (e) {
    return designFail(e, 'fetch');
  }
}
