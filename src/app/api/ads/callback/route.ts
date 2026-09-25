/**
 * GET ?code&state → where Facebook sends the owner back after approving. Swaps
 * the code for a long-lived token, saves it in this project's Secret Manager,
 * and returns to Ads → Setup saying how it went.
 */

import { NextRequest, NextResponse } from 'next/server';
import { publicOrigin } from '@/lib/social/gate';
import { STORE_META_ADS } from '@/lib/store-config';
import { completeConnection } from '@/lib/ads/meta';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!STORE_META_ADS) return NextResponse.json({ error: 'Not part of this shop.' }, { status: 404 });
  const origin = publicOrigin(req);
  const back = (q: Record<string, string>) => {
    const res = NextResponse.redirect(`${origin}/ads/setup?${new URLSearchParams(q)}`);
    res.cookies.delete({ name: 'ads_state', path: '/api/ads' });
    return res;
  };
  const p = req.nextUrl.searchParams;
  if (p.get('error')) return back({ meta: 'error', reason: p.get('error_description') || p.get('error_reason') || p.get('error') || 'Not approved' });
  const state = p.get('state') || '';
  if (!state || state !== req.cookies.get('ads_state')?.value) return back({ meta: 'error', reason: 'The connection was not started from this browser. Press Connect again.' });
  const code = p.get('code');
  if (!code) return back({ meta: 'error', reason: 'Facebook sent no code back.' });
  try {
    const conn = await completeConnection(origin, code);
    return back({ meta: 'connected', name: conn.userName });
  } catch (e) {
    console.warn('[ads] connect failed:', e instanceof Error ? e.message : e);
    return back({ meta: 'error', reason: e instanceof Error ? e.message : 'Could not connect' });
  }
}
