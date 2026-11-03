/**
 * The reference pictures a bill or order estimate prints, fetched on the server (lib/app-pdf.ts): a catalogue
 * photo from the website's own host, or the piece's own first reference photo (order_photos). Every failure is
 * a missing picture, never a broken PDF. Server-only.
 */

import { createCanvas, loadImage } from '@napi-rs/canvas';
import { adminDb } from '@/lib/firebase-admin';
import { readOrderPhotos } from '@/lib/order-photos-server';
import { itemPhotoRef, type ExtraPhoto } from '@/lib/order-photos';
import { catalogueImageUrl } from '@/lib/website/catalogue-image';
import { siteOrigin } from '@/lib/website/site-pieces';
import { wantedReferences, type ReferenceFields } from '@/lib/reference-image';
import type { PdfPicture } from '@/lib/pdf-inputs';

/** Pictures are drawn 8 mm high: a few hundred pixels are plenty, and keep the PDF light. */
const MAX_SIDE = 320;

/** Any picture the canvas can read, as a small JPEG on white. */
export async function toPdfPicture(bytes: Buffer | Uint8Array): Promise<PdfPicture | null> {
  try {
    const img = await loadImage(Buffer.from(bytes));
    if (!img.width || !img.height) return null;
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return { dataUrl: `data:image/jpeg;base64,${canvas.toBuffer('image/jpeg', 85).toString('base64')}`, format: 'JPEG', aspect: w / h };
  } catch {
    return null;
  }
}

async function fromUrl(url: string): Promise<PdfPicture | null> {
  const u = catalogueImageUrl(url, siteOrigin());
  if (!u) return null;
  try {
    const res = await fetch(u.toString(), { redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!res.ok || !/^image\//i.test(res.headers.get('Content-Type') || '')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 10 * 1024 * 1024 ? null : await toPdfPicture(buf);
  } catch {
    return null;
  }
}

const fromDataUri = (src: string): Promise<PdfPicture | null> => {
  const m = /^data:[^;,]*(;base64)?,([\s\S]*)$/.exec(src);
  if (!m) return Promise.resolve(null);
  return toPdfPicture(m[1] ? Buffer.from(m[2], 'base64') : Buffer.from(decodeURIComponent(m[2])));
};

type OwnPhoto = { sampleImageDataUri?: string; samplePhotoId?: string; extraPhotos?: ExtraPhoto[] };

/**
 * key → picture for every piece that prints one. `own` is true for an order's pieces (an empty `referenceImage`
 * means the piece's own first photo); an invoice's line has no photo of its own.
 */
export async function serverReferenceImages(items: readonly (ReferenceFields & OwnPhoto)[], opts: { own?: boolean } = {}): Promise<Record<string, PdfPicture | null>> {
  const wanted = wantedReferences(items);
  const out: Record<string, PdfPicture | null> = {};
  if (!wanted.length) return out;
  try {
    const ids = wanted.filter(w => !w.url && opts.own).map(w => itemPhotoRef(w.item).id).filter((x): x is string => !!x);
    const photos = ids.length ? await readOrderPhotos(adminDb, ids).catch(() => new Map<string, string>()) : new Map<string, string>();
    await Promise.all(wanted.map(async w => {
      try {
        if (w.url) { out[w.key] = await fromUrl(w.url); return; }
        if (!opts.own) { out[w.key] = null; return; }
        const ref = itemPhotoRef(w.item);
        const src = ref.src || (ref.id ? photos.get(ref.id) : undefined);
        out[w.key] = src ? (/^https:\/\//.test(src) ? await fromUrl(src) : await fromDataUri(src)) : null;
      } catch { out[w.key] = null; }
    }));
  } catch (e) {
    console.warn('[pdf] reference pictures skipped', e);
  }
  return out;
}
