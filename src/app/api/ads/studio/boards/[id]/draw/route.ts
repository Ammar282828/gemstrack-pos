/**
 * POST — lay out and draw on the server every design of a board whose drawing is missing or stale
 * (server-draw.ts), so a board changed without the page open (an agent, a script, the weekly routine)
 * is ready to look at. Body (optional): { ids?: string[] }. Answers what it did, design by design.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsGate, noStore } from '@/lib/ads/gate';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { settleBoard } from '@/lib/ads/studio/server-draw';
import { studioFail } from '@/lib/ads/studio/route-kit';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  if (!/^[\w-]{1,40}$/.test(id)) return NextResponse.json({ error: 'Which board?' }, { status: 400 });
  try {
    const body = await req.json().catch(() => ({})) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, 120) : undefined;
    const done = await settleBoard(id, { ids, by: who });
    return NextResponse.json({ done }, { headers: noStore });
  } catch (e) { return studioFail(e, 'board draw'); }
}
