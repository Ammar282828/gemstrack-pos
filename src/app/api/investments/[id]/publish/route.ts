/**
 * POST { target, post?, teaser?, force? } → send one part of a day's
 * Investments post where it goes:
 *
 *   group      the post, with the square card, to "Investments by Taheri"
 *              (the card carries the post as its caption when it fits
 *              WhatsApp's 1,024 characters; a longer post follows the card)
 *   teaser     the teaser, as text, to the community's announcements
 *   instagram  the story card, as the Instagram story
 *
 * Each target is sent once: a second press answers "already sent" unless
 * `force` is set, so a double tap cannot post twice to 469 people. Edited
 * words sent with the press are what go out, and are saved.
 */

import { NextRequest, NextResponse } from 'next/server';
import { postGate, mediaOrigin } from '@/lib/social/gate';
import { recordError } from '@/lib/social/errors';
import { getCard, getInvestmentPost, isDateId, markSent, type Target } from '@/lib/investments';
import { sendWhatsAppFileToGroup, sendWhatsAppTextToGroup } from '@/lib/whatsapp';
import { publishStory } from '@/lib/social/instagram';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const CAPTION_MAX = 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await postGate(req);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  if (!isDateId(id)) return NextResponse.json({ error: 'No such post.' }, { status: 404 });
  const b = await req.json().catch(() => null) as { target?: Target; post?: string; teaser?: string; force?: boolean } | null;
  const target = b?.target;
  if (target !== 'group' && target !== 'teaser' && target !== 'instagram') return NextResponse.json({ error: 'target must be group, teaser or instagram.' }, { status: 400 });

  const doc = await getInvestmentPost(id);
  if (!doc) return NextResponse.json({ error: 'That day’s post has not arrived.' }, { status: 404 });
  if (doc.sent[target] && !b?.force) return NextResponse.json({ error: 'Already sent.', sent: doc.sent[target] }, { status: 409 });

  const post = (b?.post ?? doc.post).trim();
  const teaser = (b?.teaser ?? doc.teaser).trim();
  const where = target === 'instagram' ? 'instagram' : 'whatsapp';
  try {
    let ref: string;
    if (target === 'group') {
      const chat = (process.env.INVESTMENTS_GROUP_CHAT_ID || '').trim();
      if (!chat) throw Object.assign(new Error('No Investments group is set (INVESTMENTS_GROUP_CHAT_ID).'), { status: 503 });
      const card = await getCard(id, 'square');
      if (card && post.length <= CAPTION_MAX) {
        ref = await sendWhatsAppFileToGroup(chat, new Blob([new Uint8Array(card)], { type: 'image/jpeg' }), `taheri-investments-${id}.jpg`, post);
      } else {
        // Too long for a caption (or no card): the card first, then the post under it.
        if (card) await sendWhatsAppFileToGroup(chat, new Blob([new Uint8Array(card)], { type: 'image/jpeg' }), `taheri-investments-${id}.jpg`);
        ref = await sendWhatsAppTextToGroup(chat, post);
      }
    } else if (target === 'teaser') {
      const chat = (process.env.WHATSAPP_COMMUNITY_CHAT_ID || '').trim();
      if (!chat) throw Object.assign(new Error('No community is set (WHATSAPP_COMMUNITY_CHAT_ID).'), { status: 503 });
      if (!teaser) throw Object.assign(new Error('This day has no teaser.'), { status: 400 });
      ref = await sendWhatsAppTextToGroup(chat, teaser);
    } else {
      if (!(await getCard(id, 'story'))) throw Object.assign(new Error('This day has no story card.'), { status: 400 });
      ref = await publishStory(`${mediaOrigin(req)}/api/public/investments/${id}/story`);
    }
    const sent = { at: new Date().toISOString(), by: who, ref };
    await markSent(id, target, sent, { ...(b?.post !== undefined ? { post } : {}), ...(b?.teaser !== undefined ? { teaser } : {}) });
    return NextResponse.json({ ok: true, sent });
  } catch (e) {
    await recordError(where, e, { by: who, investments: id, target });
    const status = typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : 502;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Send failed' }, { status });
  }
}
