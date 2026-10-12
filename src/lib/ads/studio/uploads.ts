/**
 * Photographs prepared outside the studio — re-cropped, upscaled, a product shot cut out — kept in
 * Firestore `studio_uploads` so they join the library beside the website and Drive (2026-10-06, owner:
 * "use these … ai upscale, rescale, add the product shot in there"). The cloud session that makes them
 * cannot put full-size files in the owner's Drive, but it can write to Firestore.
 *
 * One document an upload: { name, collection, data (JPEG or PNG bytes, < 1 MiB), type ('image/png' when it keeps transparency; absent = JPEG), w, h, added, specs, page }.
 * The asset id is `up:<document id>`. Server-only.
 */

import sharp from 'sharp';
import { adminDb } from '@/lib/firebase-admin';

export const UPLOADS = 'studio_uploads';

export interface Upload { id: string; name: string; collection: string; w: number; h: number; added: number | null; specs: string; page: string | null }

let cached: { at: number; list: Upload[] } | null = null;

/** Every upload, newest first, without the pictures (cached half a minute). */
export async function listUploads(opts: { fresh?: boolean } = {}): Promise<Upload[]> {
  if (!opts.fresh && cached && Date.now() - cached.at < 30_000) return cached.list;
  const snap = await adminDb.collection(UPLOADS).select('name', 'collection', 'w', 'h', 'added', 'specs', 'page').get();
  const list: Upload[] = snap.docs.map(d => {
    const x = d.data() as Partial<Upload>;
    return {
      id: d.id, name: String(x.name || d.id), collection: String(x.collection || 'Uploads'),
      w: Number(x.w) || 0, h: Number(x.h) || 0, added: typeof x.added === 'number' ? x.added : null,
      specs: String(x.specs || ''), page: typeof x.page === 'string' ? x.page : null,
    };
  });
  list.sort((a, b) => (b.added ?? 0) - (a.added ?? 0));
  cached = { at: Date.now(), list };
  return list;
}

export type UploadType = 'image/jpeg' | 'image/png';
export interface UploadImage { data: Buffer; type: UploadType }

/**
 * An upload no larger than `size` on its long side. By default a JPEG on white (Meta, Instagram, WhatsApp, the
 * model and the PDFs all need one). With `keepAlpha`, a picture stored with transparency (`type: image/png`)
 * comes back as the PNG, transparency intact, for the designer's canvas; a stored JPEG is a JPEG either way.
 */
export async function uploadImage(id: string, size: number, o: { keepAlpha?: boolean } = {}): Promise<UploadImage> {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) throw Object.assign(new Error('No such upload.'), { status: 404 });
  const doc = await adminDb.collection(UPLOADS).doc(id).get();
  const raw = doc.exists ? (doc.get('data') as Buffer | Uint8Array | undefined) : undefined;
  if (!raw) throw Object.assign(new Error('No such upload.'), { status: 404 });
  const data = Buffer.from(raw);
  if (o.keepAlpha && doc.get('type') === 'image/png') {
    // Already small enough: the stored PNG goes out as it is (no decode, no memory).
    if (Math.max(Number(doc.get('w')) || Infinity, Number(doc.get('h')) || Infinity) <= size) return { data, type: 'image/png' };
    return { data: await sharp(data, { failOn: 'none', limitInputPixels: RASTER_PIXELS }).resize(size, size, { fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer(), type: 'image/png' };
  }
  return {
    data: await sharp(data, { failOn: 'none', limitInputPixels: RASTER_PIXELS })
      .rotate().flatten({ background: '#ffffff' })
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90, mozjpeg: true }).toBuffer(),
    type: 'image/jpeg',
  };
}

/** An upload as a JPEG no larger than `size` on its long side (transparency flattened onto white). */
export async function uploadJpeg(id: string, size: number): Promise<Buffer> {
  return (await uploadImage(id, size)).data;
}

/** Firestore keeps a document under 1 MiB: the picture stays well inside it, with room for its words. */
const MAX_BYTES = 900 * 1024;
/** Decoded pixels a raster upload may have (sharp's default is 268 M, ~1 GB of RGBA on a 1 GiB server). */
const RASTER_PIXELS = 100e6;
/** The long side an SVG is drawn at, before it is fitted (px). */
const SVG_LONG_SIDE = 2400;
/** Pixels an SVG may rasterise to: its long side is capped at 2400, so this is generous, and a bomb is refused. */
const SVG_PIXELS = 12e6;

/** sharp's density for an SVG whose size at 72 dpi has this long side: sharp enough for 2400 px, never past 300 dpi. */
export const svgDensity = (longSideAt72: number) =>
  Math.min(300, Math.max(72, Math.round(72 * SVG_LONG_SIDE / Math.max(1, longSideAt72))));

/**
 * A picture as an upload keeps it: upright, at most 2400 px on its long side, under 900 KB (the size steps
 * down until it fits). A picture with transparency (an alpha channel that isn't all opaque, or any SVG) is
 * kept as a PNG, transparency intact, so a logo laid on a photo stays a logo; everything else is a JPEG.
 * PNG rather than WebP: lossless and crisp on a logo's edges, and every consumer (browser canvas, UIImage,
 * Meta, WhatsApp) reads it; a `palette` PNG makes a flat logo tiny, and a cut-out photo falls through the ladder.
 * Throws (status 400) on anything that isn't a picture.
 */
export async function fitUpload(input: Buffer): Promise<{ data: Buffer; w: number; h: number; type: UploadType }> {
  let meta: sharp.Metadata;
  try { meta = await sharp(input, { failOn: 'none', limitInputPixels: RASTER_PIXELS }).metadata(); } catch { meta = {} as sharp.Metadata; }
  if (!meta.width || !meta.height) throw Object.assign(new Error('That file isn’t a picture.'), { status: 400 });
  const svg = meta.format === 'svg';
  const open = svg
    ? () => sharp(input, { failOn: 'none', density: svgDensity(Math.max(meta.width!, meta.height!)), limitInputPixels: SVG_PIXELS })
    : () => sharp(input, { failOn: 'none', limitInputPixels: RASTER_PIXELS });
  let alpha = svg;
  if (!svg && meta.hasAlpha) {
    try { alpha = !(await open().stats()).isOpaque; } catch { alpha = true; }
  }
  if (alpha) {
    for (const [side, palette] of [[2400, false], [2400, true], [1600, true], [1200, true], [800, true]] as const) {
      const { data, info } = await open()
        .rotate().ensureAlpha()
        .resize(side, side, { fit: 'inside', withoutEnlargement: !svg })
        .png({ compressionLevel: 9, effort: 7, ...(palette ? { palette: true, quality: 90 } : {}) })
        .toBuffer({ resolveWithObject: true });
      if (data.length <= MAX_BYTES) return { data, w: info.width, h: info.height, type: 'image/png' };
    }
    throw Object.assign(new Error('That picture is too big to keep, even made smaller.'), { status: 413 });
  }
  for (const [side, quality] of [[2400, 88], [2000, 82], [1600, 78], [1200, 72]] as const) {
    const { data, info } = await open()
      .rotate().flatten({ background: '#ffffff' })
      .resize(side, side, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    if (data.length <= MAX_BYTES) return { data, w: info.width, h: info.height, type: 'image/jpeg' };
  }
  throw Object.assign(new Error('That picture is too big to keep, even made smaller.'), { status: 413 });
}

/**
 * A picture put in the library from a design (2026-10-12, owner: "let me edit any present text and picture
 * from any of the ads"): a board design's photo or an inset replaced by one from the phone or computer.
 * It joins the library as `up:<id>`, so a board can hold it as `lib:up:<id>` like any library photo.
 */
export async function addUpload(input: Buffer, o: { name: string; by: string }): Promise<Upload> {
  const { data, w, h, type } = await fitUpload(input);
  const name = o.name.replace(/\.[a-z0-9]{2,5}$/i, '').trim().slice(0, 80) || 'Uploaded picture';
  const ref = adminDb.collection(UPLOADS).doc();
  const added = Date.now();
  await ref.set({ name, collection: 'Uploads', data, type, w, h, added, specs: '', page: null, by: o.by });
  cached = null;
  return { id: ref.id, name, collection: 'Uploads', w, h, added, specs: '', page: null };
}
