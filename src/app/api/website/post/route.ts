/**
 * Post a Piece — the WhatsApp side.
 *
 *   GET   → where a post would go: the community's name and size, or that
 *           none is configured for this house; the groups a post may go to
 *           (WHATSAPP_POST_GROUPS) with their sizes; the channel
 *   POST  → one image (multipart: file, caption?, sitePiece?, targets?) to the
 *           community (+ the channel), or — with `targets`, a comma list of
 *           destination keys (src/lib/social/destinations.ts) — to exactly those,
 *           one after another, each reported
 *
 * The community is WHATSAPP_COMMUNITY_CHAT_ID — the announcements group of
 * the shop's community, which only admins can write to and which the shop's
 * WhatsApp line is an admin of. With WAHA, the same post then goes to the
 * shop's channel, WHATSAPP_CHANNEL_ID (…@newsletter), when one is set. It comes from configuration alone: nothing in a
 * request can point this route at another chat. A house without the variable
 * simply has no WhatsApp option on the page.
 *
 * Follows NEXT_PUBLIC_OPEN_ACCESS like the other website routes (the counter
 * posts without signing in). While open access is on, anyone who finds this
 * URL can post to the community, which is the same exposure Add Photos has
 * for the website, and closes with it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { STORE_POST_PIECE, STORE_SITE_POSTS } from '@/lib/store-config';
import { notInThisShop } from '@/lib/social/gate';
import { roleForEmail } from '@/lib/roles';
import { adminDb } from '@/lib/firebase-admin';
import { sendWhatsAppFileToGroup, whatsAppChannelInfo, whatsAppGroupInfo, whatsAppProvider, WhatsAppNotConfiguredError } from '@/lib/whatsapp';
import { recordError } from '@/lib/social/errors';
import { communityId, logName, postChannel, postGroups, type Destination } from '@/lib/social/destinations';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const OPEN_ACCESS = process.env.NEXT_PUBLIC_OPEN_ACCESS === '1';
const MAX_BYTES = 16 * 1024 * 1024;

async function gate(req: NextRequest): Promise<string | NextResponse> {
  // Post a Piece and Posts → From the website both send through here.
  if (!STORE_POST_PIECE && !STORE_SITE_POSTS) return notInThisShop();
  if (OPEN_ACCESS) return 'counter';
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = roleForEmail(email);
  if (role !== 'owner' && role !== 'staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return email;
}

/** The shop's WhatsApp channel (…@newsletter). Posts go there too, after the community — WAHA only. */
const channelId = () => (whatsAppProvider() === 'waha' ? (process.env.WHATSAPP_CHANNEL_ID || '').trim() : '');

export async function GET(req: NextRequest) {
  const who = await gate(req);
  if (who instanceof NextResponse) return who;
  const id = communityId();
  if (!id) return NextResponse.json({ community: null });
  const ch = channelId();
  const groups = postGroups();
  const [info, channel, sizes] = await Promise.all([
    whatsAppGroupInfo(id),
    ch ? whatsAppChannelInfo(ch) : Promise.resolve(null),
    Promise.all(groups.map(g => (g.chatId === id ? Promise.resolve(null) : whatsAppGroupInfo(g.chatId).catch(() => null)))),
  ]);
  return NextResponse.json({
    community: { name: info?.name || 'WhatsApp community', size: info?.size ?? null, reachable: !!info },
    channel: ch ? { name: channel?.name || 'WhatsApp channel', followers: channel?.followers ?? null, reachable: !!channel } : null,
    groups: groups.map((g, i) => {
      const gi = g.chatId === id ? info : sizes[i];
      return { key: g.key, label: g.label, name: gi?.name || g.label, size: gi?.size ?? null, reachable: !!gi };
    }),
  });
}

export async function POST(req: NextRequest) {
  const who = await gate(req);
  if (who instanceof NextResponse) return who;
  const id = communityId();
  if (!id) return NextResponse.json({ error: 'No WhatsApp community is set for this shop (WHATSAPP_COMMUNITY_CHAT_ID).' }, { status: 503 });

  let form: FormData;
  try { form = await req.formData(); }
  catch { return NextResponse.json({ error: 'Send the image as multipart/form-data.' }, { status: 400 }); }
  const file = form.get('file');
  const caption = String(form.get('caption') || '');
  // A piece from the website (Posts → From the website): logged, so a shuffle can skip what went out lately.
  const sitePiece = String(form.get('sitePiece') || '').slice(0, 300) || undefined;
  if (!(file instanceof File)) return NextResponse.json({ error: 'No image was received.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'That image is over 16 MB.' }, { status: 413 });
  if (!/^image\/(jpeg|png)$/i.test(file.type)) return NextResponse.json({ error: 'Send a JPEG or PNG.' }, { status: 415 });

  // Chosen destinations (Posts → From the website): each by its key, from configuration.
  const targets = form.get('targets');
  if (targets !== null) {
    const all = [...postGroups(), ...(postChannel() ? [postChannel()!] : [])];
    const keys = [...new Set(String(targets).split(',').map(k => k.trim()).filter(Boolean))];
    const chosen = keys.map(k => all.find(d => d.key === k));
    if (!keys.length || chosen.some(d => !d)) return NextResponse.json({ error: `Unknown destination. Choose from: ${all.map(d => d.key).join(', ')}.` }, { status: 400 });
    const name = file.name && /\.(jpe?g|png)$/i.test(file.name) ? file.name : 'piece.jpg';
    const results: { key: string; label: string; ok: boolean; idMessage?: string; error?: string }[] = [];
    // One after another; a failure is reported beside the others, never retried here (that would post twice).
    for (const d of chosen as Destination[]) {
      try {
        const idMessage = await sendWhatsAppFileToGroup(d.chatId, file, name, caption);
        await adminDb.collection('social_posts').add({
          at: new Date().toISOString(), by: who, destination: logName(d), chatId: d.chatId,
          idMessage, fileName: name, caption: caption.slice(0, 1024), ...(sitePiece ? { sitePiece } : {}),
        }).catch(e => console.warn('[post] could not log the send:', e instanceof Error ? e.message : e));
        results.push({ key: d.key, label: d.label, ok: true, idMessage });
      } catch (e) {
        await recordError('whatsapp', e, { by: who, destination: logName(d) });
        results.push({ key: d.key, label: d.label, ok: false, error: e instanceof Error ? e.message : 'Send failed' });
      }
    }
    const first = results.find(r => r.ok);
    if (!first) return NextResponse.json({ error: results[0]?.error || 'WhatsApp send failed', results }, { status: 502 });
    return NextResponse.json({ ok: true, idMessage: first.idMessage, results });
  }

  try {
    const name = file.name && /\.(jpe?g|png)$/i.test(file.name) ? file.name : 'piece.jpg';
    const idMessage = await sendWhatsAppFileToGroup(id, file, name, caption);
    // A record of what went out and when, for "did that post?" later.
    const log = (destination: string, chatId: string, messageId: string) => adminDb.collection('social_posts').add({
      at: new Date().toISOString(), by: who, destination, chatId,
      idMessage: messageId, fileName: name, caption: caption.slice(0, 1024), ...(sitePiece ? { sitePiece } : {}),
    }).catch(e => console.warn('[post] could not log the send:', e instanceof Error ? e.message : e));
    await log('whatsapp-community', id, idMessage);
    // Then the channel. The community post has already gone, so a channel failure
    // is reported beside it rather than failing the whole send (a retry would post
    // the community twice).
    const ch = channelId();
    let channel: { ok: true; idMessage: string } | { ok: false; error: string } | null = null;
    if (ch) {
      try {
        const chMessage = await sendWhatsAppFileToGroup(ch, file, name, caption);
        await log('whatsapp-channel', ch, chMessage);
        channel = { ok: true, idMessage: chMessage };
      } catch (e) {
        await recordError('whatsapp', e, { by: who, destination: 'whatsapp-channel' });
        channel = { ok: false, error: e instanceof Error ? e.message : 'Channel send failed' };
      }
    }
    return NextResponse.json({ ok: true, idMessage, channel });
  } catch (e) {
    await recordError('whatsapp', e, { by: who });
    if (e instanceof WhatsAppNotConfiguredError) return NextResponse.json({ error: e.message }, { status: 503 });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'WhatsApp send failed' }, { status: 502 });
  }
}
