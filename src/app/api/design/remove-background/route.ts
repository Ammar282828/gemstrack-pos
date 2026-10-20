/**
 * POST one picture (multipart `file`) -> the piece cut out of its background, as a PNG with alpha (Design,
 * "Remove background" on a picture layer). Magnific's remover through retouch.ts; no pixel is generated, so no
 * same-piece check. For everyone who may design ('post'). Fails with a plain message, never a faked result.
 */

import { NextRequest, NextResponse } from 'next/server';
import { mediaOrigin } from '@/lib/social/gate';
import { BACKGROUND_REMOVAL, removeBackground } from '@/lib/social/retouch';
import { designFail, designGate } from '@/lib/design/gate';
import { imageFromRequest } from '@/lib/design/image-in';
import { dailyCap, dailyCapForRequest, AI_PER_DAY, WHATSAPP_PER_DAY, INSTAGRAM_PER_DAY } from '@/lib/daily-cap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  if (!BACKGROUND_REMOVAL) return NextResponse.json({ error: 'Removing the background is off.' }, { status: 404 });
  const who = await designGate(req, 'post');
  if (who instanceof NextResponse) return who;
  const capped = await dailyCap('ai', who, req, AI_PER_DAY);
  if (capped) return capped;
  try {
    const img = await imageFromRequest(req);
    const out = await removeBackground(img.jpeg, mediaOrigin(req));
    return new NextResponse(new Uint8Array(Buffer.from(out.image.data, 'base64')), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
  } catch (e) {
    return designFail(e, 'remove-background');
  }
}
