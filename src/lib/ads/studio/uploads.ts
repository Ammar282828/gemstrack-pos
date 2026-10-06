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
