/** GET → is Instagram set up and connected for this shop, and as whom. */

import { NextRequest, NextResponse } from 'next/server';
import { postGate } from '@/lib/social/gate';
import { instagramConfigured, loadConnection } from '@/lib/social/instagram';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await postGate(req);
  if (who instanceof NextResponse) return who;
  if (!instagramConfigured()) return NextResponse.json({ configured: false, connected: false });
  try {
    const c = await loadConnection();
    return NextResponse.json({
      configured: true,
      connected: !!c && new Date(c.expiresAt).getTime() > Date.now(),
      username: c?.username ?? null,
      expiresAt: c?.expiresAt ?? null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ configured: true, connected: false, error: e instanceof Error ? e.message : 'Could not read the connection' });
  }
}
