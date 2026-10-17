/**
 * POST (multipart) { sku, file } or { sku, remove: "1" }: a piece's photo, from the iPhone app.
 *
 * The browser uploads a piece's photo itself (product-form.tsx `handleImageUpload`: the client SDK's
 * uploadBytesResumable to `product_images/<now>-<name>`, then getDownloadURL into the form). The phone has no
 * Storage SDK (it links Auth and Firestore only), so it sends the photo here and this does the browser's part
 * on the Admin SDK: the same bucket, the same folder, an address of the same kind (a download token, so every
 * <img> and the app's AsyncImage show it as they show the web's), then lib/writes/products.ts
 * `setProductPhoto`, logged as the other changes to a piece are.
 *
 * A HEIC is made a JPEG first, as readablePhoto does in the browser (heic-convert, as /api/photo/convert), and
 * every photo is turned upright and brought down to a sensible size: a piece's photo is shown at most a few
 * hundred points wide, and the web's 5 MB cap is on what is stored, not on what a phone's camera takes.
 *
 * Owners only: Stock is the owners' place and the browser's photo is a direct Storage and Firestore write
 * (ops-stock.ts). The owner's database lock holds, as on /api/app/write. Removing a photo leaves the file in
 * Storage, as replacing one does on the web.
 */

import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import convertHeic from 'heic-convert';
import { adminBucket, adminDb } from '@/lib/firebase-admin';
import { adminPort } from '@/lib/db-admin-port';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { setProductPhoto } from '@/lib/writes/products';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** What a phone may send: a camera's HEIC or a full-size JPEG, as /api/photo/convert takes. */
const MAX_BYTES = 25 * 1024 * 1024;
/** The longest edge kept: sharp on a phone's screen and a printed page, far under the web's 5 MB. */
const LONGEST_EDGE = 2000;
const FOLDER = 'product_images';

const isHeic = (name: string, type: string) => /\.hei[cf]$/i.test(name) || /^image\/hei[cf]/i.test(type);

/** A SKU as one path piece: text, no slash, and not absurd (ops-stock.ts). */
const skuOf = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= 200 && !s.includes('/') ? s : '';
};

/** The file's own name, kept after the time as the web keeps it, made safe for a path and ending .jpg. */
const storedName = (name: string) => {
  const stem = name.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${stem || 'photo'}.jpg`;
};

/** Firebase's own download address for a file with this token: what getDownloadURL hands the browser. */
const downloadUrl = (bucket: string, path: string, token: string) =>
  `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;

export async function POST(req: NextRequest) {
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  if (roleForEmail(email) !== 'owner') return NextResponse.json({ error: 'Only an owner can change a piece\'s photo.' }, { status: 403 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  const sku = skuOf(form.get('sku'));
  if (!sku) return NextResponse.json({ error: 'A piece is needed.' }, { status: 400 });
  const remove = form.get('remove') === '1';
  const file = form.get('file');
  if (!remove && !(file instanceof File)) return NextResponse.json({ error: 'No photograph was received.' }, { status: 400 });
  if (file instanceof File && file.size > MAX_BYTES) return NextResponse.json({ error: 'That photograph is over 25 MB.' }, { status: 413 });

  const settings = await adminDb.collection('app_settings').doc('global').get();
  if (settings.exists && settings.data()?.databaseLocked) {
    return NextResponse.json({ error: 'The database is locked. Unlock it in Settings first.' }, { status: 423 });
  }

  // Checked before anything is uploaded: a sold piece's photo is not changed, and no file is left behind for it.
  if (!(await adminPort.get('products', sku))) {
    const sold = await adminPort.get('sold_products', sku);
    return NextResponse.json({ error: sold ? `${sku} has been sold: it is no longer in stock.` : `No piece ${sku} is in stock.` }, { status: 409 });
  }

  const log = async (action: string, title: string, detail: string, ref?: string) => {
    try {
      await adminDb.collection('activity_log').add({
        action, title, detail, relatedId: ref || null, by: email, at: new Date().toISOString(), via: 'iphone-app',
      });
    } catch (e) { console.error('[/api/app/product-photo] activity log', e); }
  };

  let imageUrl: string | null = null;
  if (!remove && file instanceof File) {
    let jpeg: Buffer;
    try {
      let raw: Buffer = Buffer.from(await file.arrayBuffer());
      if (isHeic(file.name, file.type)) {
        raw = Buffer.from(await convertHeic({ buffer: new Uint8Array(raw), format: 'JPEG', quality: 0.92 }));
      }
      jpeg = await sharp(raw)
        .rotate()
        .flatten({ background: '#ffffff' })
        .resize(LONGEST_EDGE, LONGEST_EDGE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 86, mozjpeg: true })
        .toBuffer();
    } catch (e) {
      console.warn('[/api/app/product-photo] could not read', e instanceof Error ? e.message : e);
      return NextResponse.json({ error: 'Could not read that photograph. Try another.' }, { status: 415 });
    }
    try {
      const bucket = adminBucket();
      const path = `${FOLDER}/${Date.now()}-${storedName(file.name)}`;
      const token = randomUUID();
      await bucket.file(path).save(jpeg, {
        resumable: false,
        contentType: 'image/jpeg',
        metadata: { metadata: { firebaseStorageDownloadTokens: token } },
      });
      imageUrl = downloadUrl(bucket.name, path, token);
    } catch (e) {
      console.error('[/api/app/product-photo] upload', e);
      return NextResponse.json({ error: 'The photo could not be stored. Try again.' }, { status: 502 });
    }
  }

  try {
    await setProductPhoto(adminPort, sku, imageUrl, { log });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Not saved.' }, { status: 409 });
  }
  const product = await adminPort.get('products', sku);
  return NextResponse.json({ ok: true, imageUrl: imageUrl ?? '', product });
}
