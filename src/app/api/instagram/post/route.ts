/**
 * POST multipart { file, caption? } → a feed post on the shop's Instagram (D4 of the Design plan).
 *
 * Gated like the story route (postGate). Instagram fetches the image itself from a public URL, so it is
 * held for a few minutes in Firestore under an unguessable id and served by /api/public/social/[id]
 * (the same relay a story uses, src/lib/social/story-post.ts), then deleted. A feed image must be
 * between 4:5 and 1.91:1; the caption is at most 2,200 characters.
 */

import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { adminDb } from '@/lib/firebase-admin';
import { postGate, mediaOrigin } from '@/lib/social/gate';
import { FEED_CAPTION_MAX, InstagramError, publishPhoto } from '@/lib/social/instagram';
import { recordError } from '@/lib/social/errors';
import { dailyCap, dailyCapForRequest, AI_PER_DAY, WHATSAPP_PER_DAY, INSTAGRAM_PER_DAY } from '@/lib/daily-cap';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** A Firestore document holds at most 1 MiB; the image must fit with room to spare. */
const MAX_STORED = 900 * 1024;
const MAX_UPLOAD = 16 * 1024 * 1024;
const MAX_WIDTH = 1440;
const MIN_RATIO = 0.8;     // 4:5
const MAX_RATIO = 1.91;    // 1.91:1

/** The picture as Instagram takes it: JPEG, at most 1440 wide, small enough to hold. */
async function feedJpeg(input: Buffer): Promise<Buffer> {
  const meta = await sharp(input).rotate().metadata();
  const ratio = (meta.width ?? 0) / (meta.height ?? 1);
  if (!(ratio >= MIN_RATIO - 0.005 && ratio <= MAX_RATIO + 0.005)) {
    throw new InstagramError('An Instagram post must be between 4:5 and 1.91:1. Use a square or a 4:5 page.', 422);
  }
  let jpeg: Buffer = Buffer.alloc(0);
  for (const quality of [90, 84, 76, 68]) {
    jpeg = await sharp(input).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (jpeg.length <= MAX_STORED) return jpeg;
  }
  throw new InstagramError('The post image is too detailed to send. Try again.', 413);
}

export async function POST(req: NextRequest) {
  const who = await postGate(req);
  if (who instanceof NextResponse) return who;
  const capped = await dailyCap('instagram', who, req, INSTAGRAM_PER_DAY);
  if (capped) return capped;
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const caption = String(form?.get('caption') || '').trim();
  if (!(file instanceof File)) return NextResponse.json({ error: 'No post image was received.' }, { status: 400 });
  if (file.size > MAX_UPLOAD) return NextResponse.json({ error: 'That image is over 16 MB.' }, { status: 413 });
  if (caption.length > FEED_CAPTION_MAX) return NextResponse.json({ error: `Instagram takes captions up to ${FEED_CAPTION_MAX} characters; this one is ${caption.length}.` }, { status: 400 });
  try {
    const jpeg = await feedJpeg(Buffer.from(await file.arrayBuffer()));
    const id = randomBytes(24).toString('base64url');
    const ref = adminDb.collection('social_media').doc(id);
    await ref.set({ data: jpeg, contentType: 'image/jpeg', createdAt: new Date().toISOString() });
    let mediaId: string;
    try {
      mediaId = await publishPhoto(`${mediaOrigin(req)}/api/public/social/${id}`, caption);
    } finally {
      await ref.delete().catch(() => undefined);
    }
    await adminDb.collection('social_posts').add({ at: new Date().toISOString(), by: who, destination: 'instagram-post', mediaId, caption: caption.slice(0, 1024) })
      .catch(e => console.warn('[instagram] could not log the post:', e instanceof Error ? e.message : e));
    return NextResponse.json({ ok: true, mediaId });
  } catch (e) {
    await recordError('instagram', e, { by: who, kind: 'post' });
    const status = e instanceof InstagramError ? e.status : 502;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Instagram post failed' }, { status });
  }
}
