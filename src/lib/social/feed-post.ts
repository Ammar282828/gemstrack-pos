/**
 * A feed post to the shop's Instagram — one photo, or a carousel of up to ten with one caption (album.ts) —
 * from JPEG/PNG bytes. Instagram fetches each picture itself from a public URL, so each is held for the length
 * of the post in Firestore (`social_media`, under an unguessable id, served by /api/public/social/[id]: the
 * story's relay, story-post.ts) and deleted after.
 *
 * Used by /api/instagram/post (Design's Publish, the Posts hub) and by the queue (a hub piece queued with
 * "Instagram post"). Server-only.
 */

import { randomBytes } from 'crypto';
import sharp from 'sharp';
import { adminDb } from '@/lib/firebase-admin';
import { InstagramError, publishCarousel } from '@/lib/social/instagram';
import { IG_CAROUSEL_MAX, FEED_MAX_RATIO, FEED_MIN_RATIO, feedCrop } from '@/lib/social/album';

/** A Firestore document holds at most 1 MiB; the image must fit with room to spare. */
const MAX_STORED = 900 * 1024;
const MAX_WIDTH = 1440;

/**
 * The picture as Instagram takes it: JPEG, at most 1440 wide, small enough to hold. A shape outside 4:5–1.91:1
 * is refused (Design's Publish draws its own pages to fit), or with `fit: 'crop'` cut to the nearest allowed shape
 * from the middle (the hub, whose photos come as they were taken).
 */
export async function feedJpeg(input: Buffer, fit: 'refuse' | 'crop' = 'refuse'): Promise<Buffer> {
  const rotated = await sharp(input).rotate().toBuffer();
  const meta = await sharp(rotated).metadata();
  const ratio = (meta.width ?? 0) / (meta.height ?? 1);
  let img = sharp(rotated);
  if (!(ratio >= FEED_MIN_RATIO - 0.005 && ratio <= FEED_MAX_RATIO + 0.005)) {
    if (fit !== 'crop') throw new InstagramError('An Instagram post must be between 4:5 and 1.91:1. Use a square or a 4:5 page.', 422);
    img = img.extract(feedCrop(meta.width ?? 1, meta.height ?? 1));
  }
  const cut = await img.toBuffer();
  for (const quality of [90, 84, 76, 68]) {
    const jpeg = await sharp(cut).resize({ width: MAX_WIDTH, withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (jpeg.length <= MAX_STORED) return jpeg;
  }
  throw new InstagramError('The post image is too detailed to send. Try again.', 413);
}

/** Hold every JPEG at a public address while `use` runs, then delete them all. */
async function withPublicImages<T>(jpegs: Buffer[], origin: string, use: (urls: string[]) => Promise<T>): Promise<T> {
  const refs = jpegs.map(() => adminDb.collection('social_media').doc(randomBytes(24).toString('base64url')));
  try {
    await Promise.all(refs.map((ref, i) => ref.set({ data: jpegs[i], contentType: 'image/jpeg', createdAt: new Date().toISOString() })));
    return await use(refs.map(ref => `${origin}/api/public/social/${ref.id}`));
  } finally {
    await Promise.all(refs.map(ref => ref.delete().catch(() => undefined)));
  }
}

/**
 * The photos, in order, as one Instagram post: a plain photo for one, a carousel for more. Only the first ten
 * are taken (Instagram's limit) — the caller has said so to the counter. Resolves to the new media's id.
 */
export async function postFeedImages(inputs: Buffer[], caption: string, origin: string, fit: 'refuse' | 'crop' = 'refuse'): Promise<string> {
  const take = inputs.slice(0, IG_CAROUSEL_MAX);
  if (!take.length) throw new InstagramError('No photos for the post.', 400);
  const jpegs: Buffer[] = [];
  for (let i = 0; i < take.length; i++) {
    try { jpegs.push(await feedJpeg(take[i], fit)); }
    catch (e) {
      if (take.length > 1 && e instanceof InstagramError) throw new InstagramError(`Photo ${i + 1}: ${e.message}`, e.status);
      throw e;
    }
  }
  return withPublicImages(jpegs, origin, urls => publishCarousel(urls, caption));
}
