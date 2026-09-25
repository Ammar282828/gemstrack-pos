/**
 * POST multipart { file } → the story, on the shop's Instagram
 * (src/lib/social/story-post.ts says how Instagram is made to fetch it).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { postGate, mediaOrigin } from '@/lib/social/gate';
import { InstagramError } from '@/lib/social/instagram';
import { postStoryImage } from '@/lib/social/story-post';
import { recordError } from '@/lib/social/errors';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const who = await postGate(req);
  if (who instanceof NextResponse) return who;
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No story image was received.' }, { status: 400 });
  try {
    const mediaId = await postStoryImage(Buffer.from(await file.arrayBuffer()), mediaOrigin(req));
    await adminDb.collection('social_posts').add({ at: new Date().toISOString(), by: who, destination: 'instagram-story', mediaId })
      .catch(e => console.warn('[instagram] could not log the post:', e instanceof Error ? e.message : e));
    return NextResponse.json({ ok: true, mediaId });
  } catch (e) {
    await recordError('instagram', e, { by: who });
    const status = e instanceof InstagramError ? e.status : 502;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Instagram post failed' }, { status });
  }
}
