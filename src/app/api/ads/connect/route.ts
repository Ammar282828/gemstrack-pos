/**
 * POST → { url }: where to send the browser to approve this house's Meta ads
 * for the POS (a Facebook Login). A random state rides along in a short-lived
 * cookie and must come back unchanged to the callback, so a connection this
 * browser didn't start can't be completed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { publicOrigin } from '@/lib/social/gate';
import { adsGate } from '@/lib/ads/gate';
import { appSecret, authorizeUrl, META_APP_ID } from '@/lib/ads/meta';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  if (!META_APP_ID()) return NextResponse.json({ error: 'No Meta app is set for this shop (META_APP_ID).' }, { status: 503 });
  if (!(await appSecret())) return NextResponse.json({ error: 'The Meta app secret is not in this project yet — step 2 on this page.' }, { status: 503 });
  const state = randomBytes(18).toString('base64url');
  const res = NextResponse.json({ url: authorizeUrl(publicOrigin(req), state) });
  res.cookies.set('ads_state', state, { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/ads', maxAge: 600 });
  return res;
}
