/**
 * GET ?id= → a website piece's photograph as a JPEG (at most 2048 px), from this
 * server. The page needs it as a file to post, and the website doesn't let a
 * browser read its images across origins. Only a piece the website lists can be
 * fetched — the address is the site's own, never one from the request.
 *
 * For Website → Edit a piece: `size` up to 3000 (the site's own full size), and
 * `original=1` for the photograph every edit starts from, so a stamp or a crop is
 * never made twice over: on the catalogue, the photo before it was framed and
 * marked (its Shopify or catalog-src/ original, as the site lists it); on
 * taheri.shop, the photo as the site built it, when the counter has replaced it.
 */

import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { postGate } from '@/lib/social/gate';
import { STORE_SITE_EDIT, STORE_SITE_POSTS } from '@/lib/store-config';
import { getSitePiece, siteOrigin } from '@/lib/website/site-pieces';
import { originalUrl } from '@/lib/website/site-edits';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Where a catalogue original may come from besides the site itself. */
const SOURCE_HOST = /^cdn\.shopify\.com$/;
const hostOf = (u: string) => { try { return new URL(u).host; } catch { return ''; } };
/** Shopify's CDN resizes on request: no bigger than the site's own full size. */
const withWidth = (u: string) => (/^https:\/\/cdn\.shopify\.com\//.test(u) ? `${u}${u.includes('?') ? '&' : '?'}width=3000` : u);

export async function GET(req: NextRequest) {
  const who = await postGate(req, STORE_SITE_POSTS || STORE_SITE_EDIT);
  if (who instanceof NextResponse) return who;
  const q = req.nextUrl.searchParams;
  const id = q.get('id') || '';
  const piece = id ? await getSitePiece(id, { all: STORE_SITE_EDIT }) : null;
  if (!piece || !piece.image.startsWith(`${siteOrigin()}/`)) return NextResponse.json({ error: 'No such piece on the website.' }, { status: 404 });
  const size = Math.min(3000, Math.max(256, Number(q.get('size')) || 2048));
  const replaced = !!piece.change?.photo?.edited && piece.change.photo.image === piece.imagePath && !!piece.imagePath;
  const source = piece.photoSource && (piece.photoSource.startsWith(`${siteOrigin()}/`) || SOURCE_HOST.test(hostOf(piece.photoSource))) ? piece.photoSource : null;
  const src = q.get('original') !== '1' ? piece.image
    : source ? withWidth(source)
      : replaced ? originalUrl(siteOrigin(), piece.imagePath!) : piece.image;
  const res = await fetch(src, { cache: 'no-store', signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (!res?.ok) return NextResponse.json({ error: `The website didn’t send the photograph (${res?.status ?? 'no answer'}).` }, { status: 502 });
  const jpeg = await sharp(Buffer.from(await res.arrayBuffer())).rotate().flatten({ background: '#ffffff' }).resize(size, size, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  return new NextResponse(new Uint8Array(jpeg), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=60' } });
}
