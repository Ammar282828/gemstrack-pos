/**
 * POST multipart { file } → the story, on the shop's Instagram.
 *
 * Instagram will not take an upload; it fetches the image from a public URL.
 * This project has no public storage bucket, so the story is held for a few
 * minutes in Firestore (`social_media`, one document, under an unguessable id)
 * and served by /api/public/social/[id] while Instagram fetches it, then
 * deleted. A story is about to be public anyway; the id only has to keep it
 * from being found early.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import sharp from 'sharp';
import { adminDb } from '@/lib/firebase-admin';
import { postGate, publicOrigin } from '@/lib/social/gate';
import { InstagramError, publishStory } from '@/lib/social/instagram';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** A Firestore document holds at most 1 MiB; the image must fit with room to spare. */
const MAX_STORED = 900 * 1024;

export async function POST(req: NextRequest) {
  const who = await postGate(req);
  if (who instanceof NextResponse) return who;
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No story image was received.' }, { status: 400 });

  // Instagram takes JPEG only, and a story is 1080 × 1920.
  let jpeg: Buffer = Buffer.alloc(0);
  const input = Buffer.from(await file.arrayBuffer());
  for (const quality of [90, 84, 76, 68]) {
    jpeg = await sharp(input).resize(1080, 1920, { fit: 'cover' }).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (jpeg.length <= MAX_STORED) break;
  }
  if (jpeg.length > MAX_STORED) return NextResponse.json({ error: 'The story image is too detailed to send. Try again.' }, { status: 413 });

  const id = randomBytes(24).toString('base64url');
  const ref = adminDb.collection('social_media').doc(id);
  await ref.set({ data: jpeg, contentType: 'image/jpeg', createdAt: new Date().toISOString() });
  try {
    const mediaId = await publishStory(`${publicOrigin(req)}/api/public/social/${id}`);
    await adminDb.collection('social_posts').add({ at: new Date().toISOString(), by: who, destination: 'instagram-story', mediaId })
      .catch(e => console.warn('[instagram] could not log the post:', e instanceof Error ? e.message : e));
    return NextResponse.json({ ok: true, mediaId });
  } catch (e) {
    const status = e instanceof InstagramError ? e.status : 502;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Instagram post failed' }, { status });
  } finally {
    await ref.delete().catch(() => undefined);
  }
}
