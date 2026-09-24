/**
 * POST → { url }: where to send the browser to approve posting for the shop's
 * Instagram. A fetch (not a link) so it carries the POS's sign-in when open
 * access is off; the page then navigates to the URL.
 *
 * A random state rides along in a short-lived cookie and must come back
 * unchanged to the callback, so a stranger cannot complete a connection that
 * this browser did not start.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { postGate, publicOrigin } from '@/lib/social/gate';
import { authorizeUrl, instagramConfigured } from '@/lib/social/instagram';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const who = await postGate(req);
  if (who instanceof NextResponse) return who;
  if (!instagramConfigured()) return NextResponse.json({ error: 'Instagram is not set up for this shop (INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET).' }, { status: 503 });
  const state = randomBytes(18).toString('base64url');
  const res = NextResponse.json({ url: authorizeUrl(publicOrigin(req), state) });
  res.cookies.set('ig_state', state, { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/instagram', maxAge: 600 });
  return res;
}
