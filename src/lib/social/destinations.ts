/**
 * Where a WhatsApp post may go, from configuration only — the page names a
 * destination by its key, never by a chat id, so nothing in a request can
 * point a send anywhere the shop hasn't named.
 *
 *   WHATSAPP_POST_GROUPS  "Announcements=…@g.us,Diamonds=…@g.us,…" — the groups of
 *                         the shop's community a post can go to, in the order the
 *                         page shows them; the first is the default. Without it,
 *                         the community's announcements (WHATSAPP_COMMUNITY_CHAT_ID) alone.
 *   WHATSAPP_CHANNEL_ID   the shop's channel (…@newsletter), WAHA only.
 *
 * Server-only.
 */

import { whatsAppProvider } from '@/lib/whatsapp';

export interface Destination { key: string; label: string; chatId: string; kind: 'group' | 'channel' }

export const destinationKey = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'group';
export const communityId = () => (process.env.WHATSAPP_COMMUNITY_CHAT_ID || '').trim();

export function postGroups(): Destination[] {
  const out: Destination[] = [];
  for (const part of (process.env.WHATSAPP_POST_GROUPS || '').split(',')) {
    const i = part.lastIndexOf('=');
    const label = part.slice(0, i).trim(), chatId = part.slice(i + 1).trim();
    if (i < 1 || !/^\d+@g\.us$/.test(chatId) || out.some(d => d.chatId === chatId)) continue;
    out.push({ key: destinationKey(label), label, chatId, kind: 'group' });
  }
  // The community's announcements are always there, first unless the list places them.
  const community = communityId();
  if (community && !out.some(d => d.chatId === community)) out.unshift({ key: 'announcements', label: 'Announcements', chatId: community, kind: 'group' });
  return out;
}

export function postChannel(): Destination | null {
  const id = whatsAppProvider() === 'waha' ? (process.env.WHATSAPP_CHANNEL_ID || '').trim() : '';
  return id ? { key: 'channel', label: 'Channel', chatId: id, kind: 'channel' } : null;
}

/** How the send log names a destination: the community and the channel keep their old names. */
export const logName = (d: Destination) => (d.kind === 'channel' ? 'whatsapp-channel' : d.chatId === communityId() ? 'whatsapp-community' : `whatsapp-group:${d.key}`);
