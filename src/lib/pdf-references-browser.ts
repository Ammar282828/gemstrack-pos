/**
 * The reference pictures a bill or order estimate prints, fetched in the browser: a catalogue photo through the
 * server (/api/app/catalogue/image, which answers without CORS trouble), or the piece's own photo (inline, or its
 * order_photos document). A picture that cannot be had is left out; the PDF never waits on or breaks for one.
 */

import { authedFetch } from '@/lib/voice/authed-fetch';
import { itemPhotoRef, type ExtraPhoto } from '@/lib/order-photos';
import { wantedReferences, type ReferenceFields } from '@/lib/reference-image';
import type { PdfPicture } from '@/lib/pdf-inputs';

const MAX_SIDE = 320;

/** Any picture the browser can draw, as a small JPEG on white. */
function toPdfPicture(src: string): Promise<PdfPicture | null> {
  return new Promise(resolve => {
    const img = new window.Image();
    img.onload = () => {
      try {
        if (!img.naturalWidth || !img.naturalHeight) return resolve(null);
        const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.85), format: 'JPEG', aspect: w / h });
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function fromUrl(url: string): Promise<PdfPicture | null> {
  try {
    const res = await authedFetch(`/api/app/catalogue/image?src=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    try { return await toPdfPicture(obj); } finally { URL.revokeObjectURL(obj); }
  } catch { return null; }
}

type OwnPhoto = { sampleImageDataUri?: string; samplePhotoId?: string; extraPhotos?: ExtraPhoto[] };

/** key → picture for every piece that prints one; `own` for an order's pieces (an empty `referenceImage` = its own first photo). */
export async function browserReferenceImages(items: readonly (ReferenceFields & OwnPhoto)[], opts: { own?: boolean } = {}): Promise<Record<string, PdfPicture | null>> {
  const wanted = wantedReferences(items);
  const out: Record<string, PdfPicture | null> = {};
  await Promise.all(wanted.map(async w => {
    try {
      if (w.url) { out[w.key] = await fromUrl(w.url); return; }
      if (!opts.own) { out[w.key] = null; return; }
      const ref = itemPhotoRef(w.item);
      let src = ref.src;
      if (!src && ref.id) src = (await (await import('@/components/order/order-photo')).loadOrderPhoto(ref.id)) ?? undefined;
      out[w.key] = src ? await toPdfPicture(src) : null;
    } catch { out[w.key] = null; }
  }));
  return out;
}
