/**
 * A story image to the shop's Instagram.
 *
 * Instagram will not take an upload; it fetches the image from a public URL.
 * This project has no public storage bucket, so the story is held for a few
 * minutes in Firestore (`social_media`, one document, under an unguessable id)
 * and served by /api/public/social/[id] while Instagram fetches it, then
 * deleted. A story is about to be public anyway; the id only has to keep it
 * from being found early.
 *
 * Used by /api/instagram/story (Publish on the page) and by the queue.
 * Server-only.
 */

import { randomBytes } from 'crypto';
import sharp from 'sharp';
import { adminDb } from '@/lib/firebase-admin';
import { InstagramError, publishStory } from '@/lib/social/instagram';

/** A Firestore document holds at most 1 MiB; the image must fit with room to spare. */
const MAX_STORED = 900 * 1024;

/** `origin` is where Instagram's servers fetch from (mediaOrigin). Returns Instagram's media id. */
export async function postStoryImage(input: Buffer, origin: string): Promise<string> {
  // Instagram takes JPEG only, and a story is 1080 × 1920.
  let jpeg: Buffer = Buffer.alloc(0);
  for (const quality of [90, 84, 76, 68]) {
    jpeg = await sharp(input).resize(1080, 1920, { fit: 'cover' }).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (jpeg.length <= MAX_STORED) break;
  }
  if (jpeg.length > MAX_STORED) throw new InstagramError('The story image is too detailed to send. Try again.', 413);

  return withPublicImage(jpeg, origin, publishStory);
}

/**
 * Hold a JPEG at a public address for the length of `use` (the `social_media` relay), then delete it. For
 * anything that has to be handed a URL rather than bytes: Instagram, and Magnific's background remover.
 * The picture must fit a Firestore document (MAX_STORED).
 */
export async function withPublicImage<T>(jpeg: Buffer, origin: string, use: (url: string) => Promise<T>): Promise<T> {
  if (jpeg.length > MAX_STORED) throw new InstagramError('The picture is too large to hold for sending.', 413);
  const id = randomBytes(24).toString('base64url');
  const ref = adminDb.collection('social_media').doc(id);
  await ref.set({ data: jpeg, contentType: 'image/jpeg', createdAt: new Date().toISOString() });
  try {
    return await use(`${origin}/api/public/social/${id}`);
  } finally {
    await ref.delete().catch(() => undefined);
  }
}

/** A JPEG small enough for the relay: at most `edge` px, quality stepped down until it fits. */
export async function relayJpeg(input: Buffer, edge = 1600): Promise<Buffer> {
  for (const quality of [88, 80, 70, 60]) {
    const out = await sharp(input).rotate().resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (out.length <= MAX_STORED) return out;
  }
  throw new InstagramError('The picture is too detailed to send. Try a smaller one.', 413);
}
