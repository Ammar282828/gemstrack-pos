/**
 * A design as the page drew it, kept for a connected agent to look at (board.ts):
 * POST multipart { frame, rev, image (JPEG) }; GET ?frame= returns the JPEG.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsGate, noStore } from '@/lib/ads/gate';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { getView, putView } from '@/lib/ads/studio/board';
import { studioFail } from '@/lib/ads/studio/route-kit';

export const dynamic = 'force-dynamic';
const ok = (id: string) => /^[\w-]{1,40}$/.test(id);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  try {
    const form = await req.formData().catch(() => null);
    const frame = String(form?.get('frame') ?? '');
    const rev = Number(form?.get('rev'));
    const file = form?.get('image');
    if (!ok(id) || !ok(frame) || !Number.isFinite(rev) || !(file instanceof File)) return NextResponse.json({ error: 'Which design, and its picture?' }, { status: 400 });
    await putView(id, frame, rev, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) { return studioFail(e, 'board view'); }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  const frame = req.nextUrl.searchParams.get('frame') || '';
  if (!ok(id) || !ok(frame)) return NextResponse.json({ error: 'Which design?' }, { status: 400 });
  try {
    const v = await getView(id, frame);
    if (!v) return NextResponse.json({ error: 'Not drawn yet.' }, { status: 404 });
    return new NextResponse(new Uint8Array(v.jpeg), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' } });
  } catch (e) { return studioFail(e, 'board view'); }
}
