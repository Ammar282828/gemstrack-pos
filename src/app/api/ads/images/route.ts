/**
 * A photo for a new ad, into this house's Meta ad account's image library.
 *
 * POST multipart { file }      → a photo from the phone (HEIC is turned into JPEG)
 * POST json { pieceId }        → a piece's photo from this house's website
 *   → { hash, url, width, height, piece? }
 *
 * Meta keeps the image and gives back a hash; the ad's creative names the hash.
 * Sent at up to 2048 px, which is more than any placement shows.
 */

import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import convertHeic from 'heic-convert';
import { adsFail, adsGate } from '@/lib/ads/gate';
import { graph, MetaAdsError } from '@/lib/ads/meta';
import { requireAccount } from '@/lib/ads/settings';
import { getSitePiece, siteOrigin } from '@/lib/website/site-pieces';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BYTES = 30 * 1024 * 1024;

async function toJpeg(buf: Buffer, heic: boolean): Promise<{ jpeg: Buffer; width: number; height: number }> {
  let input = buf;
  if (heic) input = Buffer.from(await convertHeic({ buffer: new Uint8Array(buf), format: 'JPEG', quality: 0.95 }));
  let img = sharp(input).rotate();
  try { await img.metadata(); } catch {
    // Some HEICs arrive without their type; try the converter before giving up.
    input = Buffer.from(await convertHeic({ buffer: new Uint8Array(buf), format: 'JPEG', quality: 0.95 }));
    img = sharp(input).rotate();
  }
  const { data, info } = await img.resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  return { jpeg: data, width: info.width, height: info.height };
}

export async function POST(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  try {
    const { act } = await requireAccount();
    let source: Buffer;
    let heic = false;
    let piece: { id: string; name: string; url: string; weightGrams: number | null } | undefined;
    if ((req.headers.get('content-type') || '').includes('application/json')) {
      const { pieceId } = (await req.json().catch(() => ({}))) as { pieceId?: string };
      const p = pieceId ? await getSitePiece(pieceId) : null;
      if (!p || !p.image.startsWith(`${siteOrigin()}/`)) return NextResponse.json({ error: 'No such piece on the website.' }, { status: 404 });
      const res = await fetch(p.image, { cache: 'no-store', signal: AbortSignal.timeout(20_000) }).catch(() => null);
      if (!res?.ok) return NextResponse.json({ error: `The website didn’t send the photograph (${res?.status ?? 'no answer'}).` }, { status: 502 });
      source = Buffer.from(await res.arrayBuffer());
      piece = { id: p.id, name: p.name, url: p.url, weightGrams: p.weightGrams ?? null };
    } else {
      const form = await req.formData().catch(() => null);
      const file = form?.get('file');
      if (!(file instanceof File)) return NextResponse.json({ error: 'No photo was received.' }, { status: 400 });
      if (file.size > MAX_BYTES) return NextResponse.json({ error: 'That photo is over 30 MB.' }, { status: 413 });
      source = Buffer.from(await file.arrayBuffer());
      heic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
    }
    const { jpeg, width, height } = await toJpeg(source, heic).catch(() => { throw new MetaAdsError('Could not read that photo. Try a JPEG or PNG.', 415); });
    const d = await graph<{ images?: Record<string, { hash: string; url?: string }> }>(`${act}/adimages`, {
      method: 'POST', params: { bytes: jpeg.toString('base64') }, timeoutMs: 55_000,
    });
    const img = Object.values(d.images ?? {})[0];
    if (!img?.hash) throw new MetaAdsError('Meta took the photo but gave no reference for it.', 502);
    return NextResponse.json({ hash: img.hash, url: img.url ?? null, width, height, piece });
  } catch (e) {
    return adsFail(e, 'image');
  }
}
