/**
 * GET ?id= → a website piece's photograph as a JPEG (at most 2048 px), from this
 * server. The page needs it as a file to post, and the website doesn't let a
 * browser read its images across origins. Only a piece the website lists can be
 * fetched — the address is the site's own, never one from the request.
 */

import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { postGate } from '@/lib/social/gate';
import { STORE_SITE_POSTS } from '@/lib/store-config';
import { getSitePiece, siteOrigin } from '@/lib/website/site-pieces';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const who = await postGate(req, STORE_SITE_POSTS);
  if (who instanceof NextResponse) return who;
  const id = req.nextUrl.searchParams.get('id') || '';
  const piece = id ? await getSitePiece(id) : null;
  if (!piece || !piece.image.startsWith(`${siteOrigin()}/`)) return NextResponse.json({ error: 'No such piece on the website.' }, { status: 404 });
  const res = await fetch(piece.image, { cache: 'no-store', signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (!res?.ok) return NextResponse.json({ error: `The website didn’t send the photograph (${res?.status ?? 'no answer'}).` }, { status: 502 });
  const jpeg = await sharp(Buffer.from(await res.arrayBuffer())).rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  return new NextResponse(new Uint8Array(jpeg), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=600' } });
}
