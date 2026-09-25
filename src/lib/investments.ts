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
 *   post + square card  → the shop's WhatsApp channel (WHATSAPP_CHANNEL_ID, WAHA only)
 *   teaser              → the community's announcements (WHATSAPP_COMMUNITY_CHAT_ID)
 *   story card          → the Instagram story
 *
 * Each by a press on the page, or by the owner's schedule (investments-schedule.ts,
 * sent by /api/investments/tick; the schedule itself is app_settings/investments_schedule).
 *
 * One document per day in `investment_posts` (id = the date, so a re-run of the
 * routine replaces that day's words and cards but keeps what was already sent),
 * and the two cards as JPEGs in `investment_media` (a Firestore document holds
 * at most 1 MiB, so the cards are kept apart and compressed to fit).
 *
 * Server-only.
 */

import sharp from 'sharp';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { CLAIM_MS, normalizeSchedule, type DayState, type Schedule, type Target } from '@/lib/investments-schedule';

export type { Target } from '@/lib/investments-schedule';

export const POSTS = 'investment_posts';
export const MEDIA = 'investment_media';
export type CardKind = 'square' | 'story';

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
  /** Held back from the schedule for this day. */
  hold?: boolean;
  /** The owner's OK, when the schedule waits for one. */
  approved?: { at: string; by: string } | null;
  /** The schedule's bookkeeping per part (a send in progress; failures). */
  auto?: DayState['auto'];
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
    // A hold stays; an OK only stays for the words it was given to — new words need a new look.
    ...(prior?.hold ? { hold: true } : {}),
    ...(prior?.approved && prior.post === p.post && prior.teaser === p.teaser ? { approved: prior.approved } : {}),
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

// ── Sending by the schedule ────────────────────────────────────────────────

const scheduleDoc = () => adminDb.collection('app_settings').doc('investments_schedule');

export async function getSchedule(): Promise<Schedule> {
  return normalizeSchedule((await scheduleDoc().get()).data());
}

/** Save the owner's schedule; the scheduler's heartbeat is kept. */
export async function saveSchedule(next: Schedule, by: string): Promise<Schedule> {
  const { lastTick } = await getSchedule();
  const doc = normalizeSchedule({ ...next, updatedAt: new Date().toISOString(), updatedBy: by, lastTick });
  await scheduleDoc().set(doc);
  return doc;
}

/** The check ran: the page shows this so a stopped scheduler is noticed. */
export const touchTick = (at: string) => scheduleDoc().set({ lastTick: at }, { merge: true });

/**
 * Take a part for sending, so a second check (or a retry of this one) can't
 * send it too. False when it's already sent or another check has it.
 */
export async function claimAuto(id: string, target: Target, now = new Date()): Promise<boolean> {
  const ref = adminDb.collection(POSTS).doc(id);
  return adminDb.runTransaction(async tx => {
    const d = (await tx.get(ref)).data() as InvestmentPost | undefined;
    if (!d || d.sent?.[target]) return false;
    const claimed = d.auto?.[target]?.claimedAt;
    if (claimed && now.getTime() - Date.parse(claimed) < CLAIM_MS) return false;
    tx.update(ref, { [`auto.${target}.claimedAt`]: now.toISOString() });
    return true;
  });
}

export async function autoSucceeded(id: string, target: Target): Promise<void> {
  await adminDb.collection(POSTS).doc(id).update({ [`auto.${target}`]: FieldValue.delete() });
}

export async function autoFailed(id: string, target: Target, error: string): Promise<void> {
  await adminDb.collection(POSTS).doc(id).update({
    [`auto.${target}.tries`]: FieldValue.increment(1),
    [`auto.${target}.error`]: error.slice(0, 300),
    [`auto.${target}.lastTry`]: new Date().toISOString(),
    [`auto.${target}.claimedAt`]: FieldValue.delete(),
  });
}

/** The owner's say over one day: hold it back, give it the OK, or try a part that gave up once more. */
export async function setDayPlan(id: string, change: { hold?: boolean; approve?: boolean; retry?: Target }, by: string): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (change.hold !== undefined) patch.hold = change.hold;
  if (change.approve !== undefined) patch.approved = change.approve ? { at: new Date().toISOString(), by } : null;
  if (change.retry) patch[`auto.${change.retry}`] = FieldValue.delete();
  if (Object.keys(patch).length) await adminDb.collection(POSTS).doc(id).update(patch);
}
