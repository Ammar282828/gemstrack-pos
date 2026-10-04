/**
 * One board (board.ts): GET it (with the revs the page has drawn), PATCH { ops } to change it
 * (board-shape.ts's operations, applied in a transaction), DELETE it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsGate, noStore } from '@/lib/ads/gate';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { changeBoard, deleteBoard, getBoard, viewRevs } from '@/lib/ads/studio/board';
import type { BoardOp } from '@/lib/ads/studio/board-shape';
import { studioFail } from '@/lib/ads/studio/route-kit';

export const dynamic = 'force-dynamic';
const ok = (id: string) => /^[\w-]{1,40}$/.test(id);

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  if (!ok(id)) return NextResponse.json({ error: 'Which board?' }, { status: 400 });
  try {
    const since = Number(req.nextUrl.searchParams.get('since')) || 0;
    const board = await getBoard(id);
    if (!board) return NextResponse.json({ error: 'That board is gone.' }, { status: 404 });
    // Polling: nothing new since the page's rev, nothing sent.
    if (since && board.rev <= since) return NextResponse.json({ same: true, rev: board.rev }, { headers: noStore });
    return NextResponse.json({ board, drawn: await viewRevs(id) }, { headers: noStore });
  } catch (e) { return studioFail(e, 'board'); }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  if (!ok(id)) return NextResponse.json({ error: 'Which board?' }, { status: 400 });
  try {
    const body = await req.json().catch(() => null);
    const ops = (body?.ops ?? []) as BoardOp[];
    const { board, added } = await changeBoard(id, ops, who);
    return NextResponse.json({ board, added }, { headers: noStore });
  } catch (e) { return studioFail(e, 'board change'); }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  if (!ok(id)) return NextResponse.json({ error: 'Which board?' }, { status: 400 });
  try {
    await deleteBoard(id);
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) { return studioFail(e, 'board delete'); }
}
