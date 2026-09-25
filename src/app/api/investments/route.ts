/**
 * Investments by Taheri — the day's post, in and out of the POS.
 *
 *   GET   → the last fortnight's posts, newest first, with where each has been sent
 *   POST  multipart { date?, post, teaser, square?, story? } → file a day's post
 *
 * The POST is what the scheduled Claude routine calls as its last step, with
 * `Authorization: Bearer <INVESTMENTS_INGEST_TOKEN>` (the routine reads the
 * token from `.pos-ingest-token` in the taheri-post-kit folder it already has).
 * The Investments page posts here too, to add or replace a day by hand; that
 * path follows NEXT_PUBLIC_OPEN_ACCESS like the rest of the POS.
 *
 * Nothing is sent anywhere on receipt. Sending is the counter's press on the
 * page (/api/investments/[id]/publish).
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { postGate } from '@/lib/social/gate';
import { isDateId, karachiDate, listInvestmentPosts, saveInvestmentPost, toCardJpeg, type CardKind } from '@/lib/investments';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_TEXT = 8000;
const MAX_FILE = 20 * 1024 * 1024;

/** The routine's bearer token, compared in constant time. */
function hasIngestToken(req: NextRequest): boolean {
  const want = (process.env.INVESTMENTS_INGEST_TOKEN || '').trim();
  const got = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!want || !got || want.length !== got.length) return false;
  return timingSafeEqual(Buffer.from(want), Buffer.from(got));
}

export async function GET(req: NextRequest) {
  const who = await postGate(req);
  if (who instanceof NextResponse) return who;
  const posts = await listInvestmentPosts();
  return NextResponse.json({
    posts,
    today: karachiDate(),
    groupConfigured: !!process.env.INVESTMENTS_GROUP_CHAT_ID,
    communityConfigured: !!process.env.WHATSAPP_COMMUNITY_CHAT_ID,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  let source = 'routine';
  if (!hasIngestToken(req)) {
    const who = await postGate(req);
    if (who instanceof NextResponse) return NextResponse.json({ error: 'Send the routine’s token as a Bearer header.' }, { status: 401 });
    source = `pos:${who}`;
  }
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Send the post as multipart/form-data.' }, { status: 400 });

  const date = String(form.get('date') || '').trim() || karachiDate();
  if (!isDateId(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD.' }, { status: 400 });
  const post = String(form.get('post') || '').trim();
  const teaser = String(form.get('teaser') || '').trim();
  if (!post) return NextResponse.json({ error: 'The post text is missing (field "post").' }, { status: 400 });
  if (post.length > MAX_TEXT || teaser.length > MAX_TEXT) return NextResponse.json({ error: 'The post or teaser is too long.' }, { status: 413 });

  const cards: Partial<Record<CardKind, Buffer>> = {};
  for (const kind of ['square', 'story'] as CardKind[]) {
    const f = form.get(kind);
    if (!(f instanceof File) || !f.size) continue;
    if (f.size > MAX_FILE) return NextResponse.json({ error: `The ${kind} card is over 20 MB.` }, { status: 413 });
    try { cards[kind] = await toCardJpeg(Buffer.from(await f.arrayBuffer()), kind); }
    catch (e) { return NextResponse.json({ error: `Could not read the ${kind} card: ${e instanceof Error ? e.message : e}` }, { status: 415 }); }
  }

  const saved = await saveInvestmentPost({ date, post, teaser, cards, source });
  console.log(`[investments] ${date} filed by ${source} (${saved.cards.join(', ') || 'no cards'})`);
  return NextResponse.json({ ok: true, id: saved.id, cards: saved.cards, alreadySent: Object.keys(saved.sent) });
}
