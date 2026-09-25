/**
 * Investments by Taheri — the daily gold post, received and sent from the POS.
 *
 * The post is written each morning by a scheduled Claude routine ("Investments
 * by Taheri — daily post", claude.ai Cowork): the WhatsApp post, a 1080² card,
 * a 1080×1920 story card and a teaser for the main community. Its last step
 * uploads all four here (POST /api/investments); the counter reads them on the
 * Investments page, edits if they like, and sends each where it goes:
 *
 *   post + square card  → the "Investments by Taheri" group (INVESTMENTS_GROUP_CHAT_ID)
 *   teaser              → the community's announcements (WHATSAPP_COMMUNITY_CHAT_ID)
 *   story card          → the Instagram story
 *
 * One document per day in `investment_posts` (id = the date, so a re-run of the
 * routine replaces that day's words and cards but keeps what was already sent),
 * and the two cards as JPEGs in `investment_media` (a Firestore document holds
 * at most 1 MiB, so the cards are kept apart and compressed to fit).
 *
 * Server-only.
 */

import sharp from 'sharp';
import { adminDb } from '@/lib/firebase-admin';

export const POSTS = 'investment_posts';
export const MEDIA = 'investment_media';
export type CardKind = 'square' | 'story';
export type Target = 'group' | 'teaser' | 'instagram';

export interface Sent { at: string; by: string; ref: string }
export interface InvestmentPost {
  id: string;
  date: string;
  post: string;
  teaser: string;
  cards: CardKind[];
  receivedAt: string;
  source: string;
  editedAt?: string;
  sent: Partial<Record<Target, Sent>>;
}

/** Today in Karachi, as the id a day's post is filed under. */
export const karachiDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(d);
export const isDateId = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

const SIZE: Record<CardKind, [number, number]> = { square: [1080, 1080], story: [1080, 1920] };
const MAX_STORED = 900 * 1024;

/** A card as a JPEG of its proper size, small enough for one Firestore document. */
export async function toCardJpeg(input: Buffer, kind: CardKind): Promise<Buffer> {
  const [w, h] = SIZE[kind];
  let out: Buffer = Buffer.alloc(0);
  for (const quality of [92, 86, 78, 70]) {
    out = await sharp(input).resize(w, h, { fit: 'cover' }).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (out.length <= MAX_STORED) return out;
  }
  if (out.length > MAX_STORED) throw new Error(`The ${kind} card is too large to keep.`);
  return out;
}

export async function saveInvestmentPost(p: { date: string; post: string; teaser: string; cards: Partial<Record<CardKind, Buffer>>; source: string }): Promise<InvestmentPost> {
  const ref = adminDb.collection(POSTS).doc(p.date);
  const prior = (await ref.get()).data() as InvestmentPost | undefined;
  const cards = (Object.keys(p.cards) as CardKind[]).filter(k => p.cards[k]);
  await Promise.all(cards.map(k => adminDb.collection(MEDIA).doc(`${p.date}__${k}`).set({ data: p.cards[k], contentType: 'image/jpeg', at: new Date().toISOString() })));
  const doc: InvestmentPost = {
    id: p.date,
    date: p.date,
    post: p.post,
    teaser: p.teaser,
    cards: [...new Set([...(prior?.cards ?? []), ...cards])],
    receivedAt: new Date().toISOString(),
    source: p.source,
    sent: prior?.sent ?? {},
  };
  await ref.set(doc);
  return doc;
}

export async function listInvestmentPosts(limit = 14): Promise<InvestmentPost[]> {
  const snap = await adminDb.collection(POSTS).orderBy('date', 'desc').limit(limit).get();
  return snap.docs.map(d => d.data() as InvestmentPost);
}

export async function getInvestmentPost(id: string): Promise<InvestmentPost | null> {
  const snap = await adminDb.collection(POSTS).doc(id).get();
  return snap.exists ? (snap.data() as InvestmentPost) : null;
}

export async function getCard(id: string, kind: CardKind): Promise<Buffer | null> {
  const snap = await adminDb.collection(MEDIA).doc(`${id}__${kind}`).get();
  const d = snap.data() as { data?: Buffer } | undefined;
  return d?.data ? Buffer.from(d.data) : null;
}

export async function markSent(id: string, target: Target, sent: Sent, edits: { post?: string; teaser?: string }): Promise<void> {
  await adminDb.collection(POSTS).doc(id).set({
    sent: { [target]: sent },
    ...(edits.post !== undefined ? { post: edits.post } : {}),
    ...(edits.teaser !== undefined ? { teaser: edits.teaser } : {}),
    ...(edits.post !== undefined || edits.teaser !== undefined ? { editedAt: new Date().toISOString() } : {}),
  }, { merge: true });
}
