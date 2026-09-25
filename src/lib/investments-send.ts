/**
 * Sending one part of a day's Investments post where it goes — shared by the
 * Send buttons (/api/investments/[id]/publish) and the schedule
 * (/api/investments/tick), so both send exactly the same thing:
 *
 *   group      the post, with the square card, to "Investments by Taheri"
 *   channel    the same, to the shop's WhatsApp channel (WAHA only)
 *   teaser     the teaser, as text, to the community's announcements
 *   instagram  the story card, as the Instagram story
 *
 * The card carries the post as its caption when it fits WhatsApp's 1,024
 * characters; a longer post follows the card as its own message.
 *
 * Server-only.
 */

import { getCard, getInvestmentPost, markSent, type Sent, type Target } from '@/lib/investments';
import { sendWhatsAppFileToGroup, sendWhatsAppTextToGroup, whatsAppProvider } from '@/lib/whatsapp';
import { publishStory } from '@/lib/social/instagram';

const CAPTION_MAX = 1024;

export const statusError = (message: string, status: number) => Object.assign(new Error(message), { status });

/** Where each part goes, from configuration (never from a request). Null when this shop hasn't set it up. */
export function destinationOf(target: Target): string | null {
  switch (target) {
    case 'group': return (process.env.INVESTMENTS_GROUP_CHAT_ID || '').trim() || null;
    case 'channel': return whatsAppProvider() === 'waha' ? (process.env.WHATSAPP_CHANNEL_ID || '').trim() || null : null;
    case 'teaser': return (process.env.WHATSAPP_COMMUNITY_CHAT_ID || '').trim() || null;
    case 'instagram': return (process.env.INSTAGRAM_APP_ID || '').trim() ? 'instagram' : null;
  }
}

/**
 * Send one part and mark it sent. `post`/`teaser` are the words to send when
 * they were edited on the page (and are saved with the mark). `origin` is where
 * Instagram fetches the story card from.
 */
export async function sendInvestmentPart(id: string, target: Target, opts: { by: string; origin: string; post?: string; teaser?: string }): Promise<Sent> {
  const doc = await getInvestmentPost(id);
  if (!doc) throw statusError('That day’s post has not arrived.', 404);
  const post = (opts.post ?? doc.post).trim();
  const teaser = (opts.teaser ?? doc.teaser).trim();
  const chat = destinationOf(target);
  let ref: string;
  if (target === 'group' || target === 'channel') {
    if (!chat) throw statusError(target === 'group' ? 'No Investments group is set (INVESTMENTS_GROUP_CHAT_ID).' : 'No WhatsApp channel is set up (WHATSAPP_CHANNEL_ID, on WAHA).', 503);
    if (!post) throw statusError('This day has no post.', 400);
    const card = await getCard(id, 'square');
    const file = card ? new Blob([new Uint8Array(card)], { type: 'image/jpeg' }) : null;
    if (file && post.length <= CAPTION_MAX) {
      ref = await sendWhatsAppFileToGroup(chat, file, `taheri-investments-${id}.jpg`, post);
    } else {
      // Too long for a caption (or no card): the card first, then the post under it.
      if (file) await sendWhatsAppFileToGroup(chat, file, `taheri-investments-${id}.jpg`);
      ref = await sendWhatsAppTextToGroup(chat, post);
    }
  } else if (target === 'teaser') {
    if (!chat) throw statusError('No community is set (WHATSAPP_COMMUNITY_CHAT_ID).', 503);
    if (!teaser) throw statusError('This day has no teaser.', 400);
    ref = await sendWhatsAppTextToGroup(chat, teaser);
  } else {
    if (!(await getCard(id, 'story'))) throw statusError('This day has no story card.', 400);
    ref = await publishStory(`${opts.origin}/api/public/investments/${id}/story`);
  }
  const sent: Sent = { at: new Date().toISOString(), by: opts.by, ref };
  const edits = { ...(opts.post !== undefined ? { post } : {}), ...(opts.teaser !== undefined ? { teaser } : {}) };
  // It has gone out: the mark must land, or the next press or check would send it again.
  for (let i = 0; ; i++) {
    try { await markSent(id, target, sent, edits); break; }
    catch (e) { if (i >= 2) throw e; await new Promise(r => setTimeout(r, 500 * (i + 1))); }
  }
  return sent;
}
