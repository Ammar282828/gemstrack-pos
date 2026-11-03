/**
 * GET /api/app/catalogue/image?src=<url> → the picture's bytes, with cache headers.
 *
 * Owners and staff. A server-side fetch of a catalogue picture so a browser (no CORS) and the PDF builders can
 * embed it. Only the website's own host is fetched (lib/website/catalogue-image.ts); no redirects; images only; 10 MB.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pdfViewer } from '@/lib/app-pdf';
import { siteOrigin } from '@/lib/website/site-pieces';
import { catalogueImageUrl } from '@/lib/website/catalogue-image';

export const dynamic = 'force-dynamic';
const MAX_BYTES = 10 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const who = await pdfViewer(req);
  if (who instanceof NextResponse) return who;
  const target = catalogueImageUrl(req.nextUrl.searchParams.get('src') || '', siteOrigin());
  if (!target) return NextResponse.json({ error: 'That picture is not one of the catalogue\'s.' }, { status: 403 });
  let res: Response;
  try {
    res = await fetch(target.toString(), { redirect: 'error', signal: AbortSignal.timeout(15000) });
  } catch {
    return NextResponse.json({ error: 'Could not fetch the picture.' }, { status: 502 });
  }
  if (!res.ok) return NextResponse.json({ error: 'Could not fetch the picture.' }, { status: res.status === 404 ? 404 : 502 });
  const type = res.headers.get('Content-Type') || '';
  if (!/^image\/(png|jpe?g|gif|webp|avif)\b/i.test(type)) return NextResponse.json({ error: 'Not a picture.' }, { status: 415 });
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: 'Picture too large.' }, { status: 413 });
  return new NextResponse(buf, {
    headers: {
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
      // Private: behind sign-in, but a catalogue photo changes rarely.
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
