/**
 * Photographs prepared outside the studio — re-cropped, upscaled, a product shot cut out — kept in
 * Firestore `studio_uploads` so they join the library beside the website and Drive (2026-10-06, owner:
 * "use these … ai upscale, rescale, add the product shot in there"). The cloud session that makes them
 * cannot put full-size files in the owner's Drive, but it can write to Firestore.
 *
 * One document an upload: { name, collection, data (JPEG bytes, < 1 MiB), w, h, added, specs, page }.
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

/** An upload as a JPEG no larger than `size` on its long side. */
export async function uploadJpeg(id: string, size: number): Promise<Buffer> {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) throw Object.assign(new Error('No such upload.'), { status: 404 });
  const doc = await adminDb.collection(UPLOADS).doc(id).get();
  const data = doc.exists ? (doc.get('data') as Buffer | Uint8Array | undefined) : undefined;
  if (!data) throw Object.assign(new Error('No such upload.'), { status: 404 });
  return sharp(Buffer.from(data), { failOn: 'none' })
    .rotate().flatten({ background: '#ffffff' })
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

/** Firestore keeps a document under 1 MiB: the picture stays well inside it, with room for its words. */
const MAX_BYTES = 900 * 1024;

/**
 * A picture as an upload keeps it: upright, at most 2400 px on its long side, a JPEG under 900 KB (the
 * quality steps down until it fits). Throws (status 400) on anything that isn't a picture.
 */
export async function fitUpload(input: Buffer): Promise<{ data: Buffer; w: number; h: number }> {
  let meta: sharp.Metadata;
  try { meta = await sharp(input, { failOn: 'none' }).metadata(); } catch { meta = {} as sharp.Metadata; }
  if (!meta.width || !meta.height) throw Object.assign(new Error('That file isn’t a picture.'), { status: 400 });
  for (const [side, quality] of [[2400, 88], [2000, 82], [1600, 78], [1200, 72]] as const) {
    const { data, info } = await sharp(input, { failOn: 'none' })
      .rotate().flatten({ background: '#ffffff' })
      .resize(side, side, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    if (data.length <= MAX_BYTES) return { data, w: info.width, h: info.height };
  }
  throw Object.assign(new Error('That picture is too big to keep, even made smaller.'), { status: 413 });
}

/**
 * A picture put in the library from a design (2026-10-12, owner: "let me edit any present text and picture
 * from any of the ads"): a board design's photo or an inset replaced by one from the phone or computer.
 * It joins the library as `up:<id>`, so a board can hold it as `lib:up:<id>` like any library photo.
 */
export async function addUpload(input: Buffer, o: { name: string; by: string }): Promise<Upload> {
  const { data, w, h } = await fitUpload(input);
  const name = o.name.replace(/\.[a-z0-9]{2,5}$/i, '').trim().slice(0, 80) || 'Uploaded picture';
  const ref = adminDb.collection(UPLOADS).doc();
  const added = Date.now();
  await ref.set({ name, collection: 'Uploads', data, w, h, added, specs: '', page: null, by: o.by });
  cached = null;
  return { id: ref.id, name, collection: 'Uploads', w, h, added, specs: '', page: null };
}
