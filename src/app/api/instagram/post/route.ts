/**
 * POST multipart { file, caption?, … } → a feed post on the shop's Instagram (D4 of the Design plan).
 *
 * One `file` is one photo, as it always was. Several `file` entries, in order, are a carousel with the one
 * caption (the Posts hub's photos of a piece, 2026-10-23): Instagram takes ten, so only the first ten go
 * (album.ts) and the answer says how many were left out (`dropped`). Optional too: `fit=crop` cuts a photo
 * outside 4:5–1.91:1 to fit instead of refusing it (the hub's photos come as they were taken), and `sitePiece`,
 * logged so the hub's Today puts the post beside the piece's WhatsApp sends.
 *
 * Gated like the story route (postGate). Instagram fetches each image itself from a public URL, so each is held
 * for a few minutes in Firestore under an unguessable id and served by /api/public/social/[id] (the relay a story
 * uses, src/lib/social/story-post.ts), then deleted (src/lib/social/feed-post.ts). The caption is at most 2,200
 * characters.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { postGate, mediaOrigin } from '@/lib/social/gate';
import { FEED_CAPTION_MAX, InstagramError } from '@/lib/social/instagram';
import { postFeedImages } from '@/lib/social/feed-post';
import { carouselPlan } from '@/lib/social/album';
import { recordError } from '@/lib/social/errors';
import { dailyCap, INSTAGRAM_PER_DAY } from '@/lib/daily-cap';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_UPLOAD = 16 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const who = await postGate(req);
  if (who instanceof NextResponse) return who;
  const capped = await dailyCap('instagram', who, req, INSTAGRAM_PER_DAY);
  if (capped) return capped;
  const form = await req.formData().catch(() => null);
  const files = (form?.getAll('file') ?? []).filter((f): f is File => f instanceof File);
  const caption = String(form?.get('caption') || '').trim();
  const fit = String(form?.get('fit') || '') === 'crop' ? 'crop' : 'refuse';
  const sitePiece = String(form?.get('sitePiece') || '').slice(0, 300) || undefined;
  if (!files.length) return NextResponse.json({ error: 'No post image was received.' }, { status: 400 });
  if (files.some(f => f.size > MAX_UPLOAD)) return NextResponse.json({ error: 'That image is over 16 MB.' }, { status: 413 });
  if (caption.length > FEED_CAPTION_MAX) return NextResponse.json({ error: `Instagram takes captions up to ${FEED_CAPTION_MAX} characters; this one is ${caption.length}.` }, { status: 400 });
  const plan = carouselPlan(files.length);
  try {
    const inputs = await Promise.all(files.slice(0, plan.take).map(async f => Buffer.from(await f.arrayBuffer())));
    const mediaId = await postFeedImages(inputs, caption, mediaOrigin(req), fit);
    await adminDb.collection('social_posts').add({
      at: new Date().toISOString(), by: who, destination: 'instagram-post', mediaId, caption: caption.slice(0, 1024),
      ...(plan.carousel ? { photos: plan.take } : {}), ...(sitePiece ? { sitePiece } : {}),
    }).catch(e => console.warn('[instagram] could not log the post:', e instanceof Error ? e.message : e));
    return NextResponse.json({ ok: true, mediaId, ...(plan.carousel ? { photos: plan.take, dropped: plan.dropped } : {}) });
  } catch (e) {
    await recordError('instagram', e, { by: who, kind: plan.carousel ? 'carousel' : 'post' });
    const status = e instanceof InstagramError ? e.status : 502;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Instagram post failed' }, { status });
  }
}
