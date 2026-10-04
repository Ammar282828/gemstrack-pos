/**
 * Keys for an agent (Claude Code) to work on the Studio's boards over /api/studio/mcp (board.ts):
 * GET the keys (label, when made, last used, last four characters), POST { label } a new one —
 * answered once with the whole key — and DELETE ?tail= to revoke one. The owner only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsGate, noStore } from '@/lib/ads/gate';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { createAgentKey, listAgentKeys, revokeAgentKey } from '@/lib/ads/studio/board';
import { studioFail } from '@/lib/ads/studio/route-kit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  try { return NextResponse.json({ keys: await listAgentKeys() }, { headers: noStore }); } catch (e) { return studioFail(e, 'agent keys'); }
}

export async function POST(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  try {
    const body = await req.json().catch(() => ({}));
    return NextResponse.json({ key: await createAgentKey(String(body?.label ?? '')) }, { headers: noStore });
  } catch (e) { return studioFail(e, 'agent keys'); }
}

export async function DELETE(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  const tail = req.nextUrl.searchParams.get('tail') || '';
  if (!/^[\w-]{4}$/.test(tail)) return NextResponse.json({ error: 'Which key?' }, { status: 400 });
  try { await revokeAgentKey(tail); return NextResponse.json({ ok: true }, { headers: noStore }); } catch (e) { return studioFail(e, 'agent keys'); }
}
