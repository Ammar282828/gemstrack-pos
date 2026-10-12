/**
 * A picture into the Studio's library from a design (uploads.ts addUpload): POST multipart { file, [name] }.
 * Answers { asset: { id: "up:<id>", name, w, h } } — a board design then holds it as its photo or as an
 * inset (`lib:up:<id>`), so it is drawn, saved and reopened like any library photo.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsGate, noStore } from '@/lib/ads/gate';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { addUpload } from '@/lib/ads/studio/uploads';
import { studioFail } from '@/lib/ads/studio/route-kit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX = 25 * 1024 * 1024;
/** The multipart envelope adds a little to the file; past this the body is not worth buffering. */
const MAX_BODY = 26 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  // Before formData(), which buffers the whole body.
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return NextResponse.json({ error: 'That picture is over 25 MB.' }, { status: 413 });
  try {
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File) || !file.size) return NextResponse.json({ error: 'Which picture?' }, { status: 400 });
    if (file.size > MAX) return NextResponse.json({ error: 'That picture is over 25 MB.' }, { status: 413 });
    const name = String(form?.get('name') ?? file.name ?? '');
    const u = await addUpload(Buffer.from(await file.arrayBuffer()), { name, by: who });
    return NextResponse.json({ asset: { id: `up:${u.id}`, name: u.name, w: u.w, h: u.h } }, { headers: noStore });
  } catch (e) { return studioFail(e, 'upload'); }
}
