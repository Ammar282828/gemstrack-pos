/**
 * GET ?code&state → where Instagram sends the account holder back after they
 * approve. Swaps the code for a 60-day token (only for the shop's own account)
 * and returns to Post a Piece saying how it went.
 */

import { NextRequest, NextResponse } from 'next/server';
import { publicOrigin } from '@/lib/social/gate';
import { completeConnection } from '@/lib/social/instagram';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const origin = publicOrigin(req);
  const back = (q: Record<string, string>) => {
    const res = NextResponse.redirect(`${origin}/website/post?${new URLSearchParams(q)}`);
    res.cookies.delete({ name: 'ig_state', path: '/api/instagram' });
    return res;
  };
  const p = req.nextUrl.searchParams;
  if (p.get('error')) return back({ instagram: 'error', reason: p.get('error_description') || p.get('error') || 'Not approved' });
  const state = p.get('state') || '';
  if (!state || state !== req.cookies.get('ig_state')?.value) return back({ instagram: 'error', reason: 'The connection was not started from this browser. Press Connect again.' });
  const code = p.get('code');
  if (!code) return back({ instagram: 'error', reason: 'Instagram sent no code back.' });
  try {
    const conn = await completeConnection(origin, code);
    return back({ instagram: 'connected', username: conn.username });
  } catch (e) {
    return back({ instagram: 'error', reason: e instanceof Error ? e.message : 'Could not connect' });
  }
}
