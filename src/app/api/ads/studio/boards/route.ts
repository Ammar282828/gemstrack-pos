/**
 * The Studio's boards (board.ts): GET the list, POST { name } a new one.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsGate, noStore } from '@/lib/ads/gate';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { createBoard, listBoards } from '@/lib/ads/studio/board';
import { studioFail } from '@/lib/ads/studio/route-kit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  try {
    return NextResponse.json({ boards: await listBoards() }, { headers: noStore });
  } catch (e) { return studioFail(e, 'boards'); }
}

export async function POST(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  try {
    const body = await req.json().catch(() => ({}));
    return NextResponse.json({ board: await createBoard(String(body?.name ?? ''), who) }, { headers: noStore });
  } catch (e) { return studioFail(e, 'boards'); }
}
