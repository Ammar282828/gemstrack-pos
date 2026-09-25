/**
 * GET → a day's Investments card (square or story) as a JPEG.
 *
 * Public because Instagram's servers fetch the story card from here and carry
 * no sign-in; the cards are made to be posted publicly anyway. The POS page
 * shows its previews from here too.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCard, isDateId, type CardKind } from '@/lib/investments';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await params;
  if (!isDateId(id) || (kind !== 'square' && kind !== 'story')) return new NextResponse('Not found', { status: 404 });
  const data = await getCard(id, kind as CardKind);
  if (!data) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(new Uint8Array(data), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' } });
}
