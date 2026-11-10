/**
 * GET ?src=<a photo on this shop's website> → { ink } — white or dark for the weight drawn on it (lib/website/label-ink.ts).
 * For Photo weights' preview: the browser cannot read the website's pixels across origins, so the server reads the
 * label's corner of the photo and answers with the ink the website itself will choose. Only the website's own photos.
 */

import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { LABEL_AREA, WHITE_INK, inkFor, meanLuminance } from '@/lib/website/label-ink';

export const dynamic = 'force-dynamic';

const site = () => (process.env.WEBSITE_ORIGIN || process.env.NEXT_PUBLIC_STORE_WEBSITE_URL || 'https://taheri.shop').replace(/\/+$/, '');

export async function GET(req: NextRequest) {
  const email = await verifyRequestEmail(req);
  if (!email || roleForEmail(email) === 'none') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const src = req.nextUrl.searchParams.get('src') || '';
  let url: URL;
  try { url = new URL(src); } catch { return NextResponse.json({ error: 'Send ?src=' }, { status: 400 }); }
  if (url.origin !== new URL(site()).origin) return NextResponse.json({ error: 'Only the website’s own photos' }, { status: 400 });
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(String(res.status));
    const img = sharp(Buffer.from(await res.arrayBuffer()));
    const { width = 0, height = 0 } = await img.metadata();
    const k = width / 3000;
    const left = Math.floor(LABEL_AREA.x * k), top = Math.floor(LABEL_AREA.y * k);
    const area = {
      left, top,
      width: Math.max(1, Math.min(Math.round(LABEL_AREA.w * k), width - left)),
      height: Math.max(1, Math.min(Math.round(LABEL_AREA.h * k), height - top)),
    };
    const px = await img.extract(area).removeAlpha().resize(48, 24, { fit: 'fill' }).raw().toBuffer();
    return NextResponse.json({ ink: inkFor(meanLuminance(px, 3)) }, { headers: { 'Cache-Control': 'private, max-age=86400' } });
  } catch {
    return NextResponse.json({ ink: WHITE_INK });
  }
}
