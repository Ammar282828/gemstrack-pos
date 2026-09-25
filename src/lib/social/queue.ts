/**
 * Post a Piece's queue — several pieces made at the counter, sent together or
 * spread over the day.
 *
 * The page makes each piece exactly as it would for Publish (the squares at
 * the website's and WhatsApp's sizes, the story) and hands the finished JPEGs
 * here, so a queued piece goes out as it looked on the screen: nothing is
 * redrawn on the server. A piece is a document in `social_queue`; its images
 * are in `social_queue_media`, split into parts because a Firestore document
 * holds at most 1 MiB and a 3000-px website square can be several.
 *
 * A piece is `draft` while its images arrive, `held` until the counter says
 * when, `scheduled` for a time (the tick sends it: /api/website/post/queue/tick,
 * every five minutes by Cloud Scheduler), `sending`, then `sent` or `failed`.
 * Every single send (one photo to one place) is recorded as it succeeds, so a
 * retry — the counter's, or the tick's, three tries in all — sends only what
 * didn't go, and never posts a group twice. A claim guards against two
 * senders at once.
 *
 * Server-only.
 */

import { adminDb } from '@/lib/firebase-admin';
import { sendWhatsAppFileToGroup } from '@/lib/whatsapp';
import { logName, postChannel, postGroups, type Destination } from '@/lib/social/destinations';
import { postStoryImage } from '@/lib/social/story-post';
import { recordError } from '@/lib/social/errors';
import { uploadToSite } from '@/lib/website/upload';
import { saveFeatured } from '@/lib/website/featured';
import type { Where } from '@/lib/social/diagnose';
import { queueMediaKeys, queueUnits, type QueueCounts, type QueueStatus, type QueueTargets } from './queue-plan';

export const QUEUE = 'social_queue';
export const QUEUE_MEDIA = 'social_queue_media';
const PART = 900 * 1024;
/** A send that has been "sending" this long has died; the piece can be claimed again. */
const CLAIM_MS = 10 * 60_000;
/** The tick tries a failed piece this many times in all; after that it waits for the counter. */
export const MAX_TRIES = 3;

export interface QueueItem extends QueueTargets {
  id: string;
  createdAt: string;
  by: string;
  status: QueueStatus;
  /** When the tick sends it; null while held. */
  dueAt: string | null;
  headline: string;
  caption: string;
  /** "bangle-and-ring" — WhatsApp's file names. */
  fileBase: string;
  counts: QueueCounts;
  /** A small JPEG for the list. */
  thumb?: Buffer;
  /** Media key → how many parts it was stored in. */
  stored: Record<string, number>;
  /** Unit → what came back (website path, message id, …), once it has gone. */
  done: Record<string, string>;
  /** The last error, per unit still to go. */
  errors: Record<string, { message: string; at: string }>;
  attempts: number;
  claimedAt: string | null;
  sentAt?: string;
}

/** What the page sees: everything but the images. */
export type QueueItemView = Omit<QueueItem, 'thumb' | 'stored'> & { thumb: string | null; units: string[] };

const col = () => adminDb.collection(QUEUE);
const mediaId = (id: string, key: string, part: number) => `${id}__${key}__${part}`;

export function toView(d: QueueItem): QueueItemView {
  const { thumb, stored: _stored, ...rest } = d;
  // A send that died part-way (the request timed out) shows as failed, so the counter can retry what didn't go.
  const stalled = d.status === 'sending' && (!d.claimedAt || Date.now() - Date.parse(d.claimedAt) >= CLAIM_MS);
  return {
    ...rest,
    ...(stalled ? { status: 'failed' as const, errors: { ...d.errors, stalled: { message: 'It stopped part-way', at: d.claimedAt || d.createdAt } } } : {}),
    thumb: thumb ? `data:image/jpeg;base64,${Buffer.from(thumb).toString('base64')}` : null,
    units: queueUnits(d, d.counts),
  };
}

// ── Making a piece ───────────────────────────────────────────────────────────

export async function createItem(p: Pick<QueueItem, 'by' | 'headline' | 'caption' | 'fileBase' | 'counts' | 'website' | 'instagram' | 'whatsapp'> & { thumb?: Buffer }): Promise<QueueItem> {
  const ref = col().doc();
  const item: QueueItem = {
    ...p, id: ref.id, createdAt: new Date().toISOString(), status: 'draft', dueAt: null,
    stored: {}, done: {}, errors: {}, attempts: 0, claimedAt: null,
  };
  if (!p.thumb) delete item.thumb;
  await ref.set(item);
  return item;
}

export async function getItem(id: string): Promise<QueueItem | null> {
  const snap = await col().doc(id).get();
  return snap.exists ? (snap.data() as QueueItem) : null;
}

/** One of a draft's images, in parts. */
export async function putMedia(id: string, key: string, data: Buffer): Promise<void> {
  const item = await getItem(id);
  if (!item) throw Object.assign(new Error('That piece is no longer in the queue.'), { status: 404 });
  if (item.status !== 'draft') throw Object.assign(new Error('That piece is already queued; its photos are fixed.'), { status: 409 });
  if (!queueMediaKeys(item, item.counts).includes(key)) throw Object.assign(new Error(`This piece has no image "${key}".`), { status: 400 });
  const parts = Math.max(1, Math.ceil(data.length / PART));
  const batch = adminDb.batch();
  for (let i = 0; i < parts; i++) batch.set(adminDb.collection(QUEUE_MEDIA).doc(mediaId(id, key, i)), { data: data.subarray(i * PART, (i + 1) * PART), at: new Date().toISOString() });
  batch.update(col().doc(id), { [`stored.${key}`]: parts });
  await batch.commit();
}

async function getMedia(item: QueueItem, key: string): Promise<Buffer> {
  const parts = item.stored[key];
  if (!parts) throw new Error(`The image "${key}" of this piece is missing.`);
  const snaps = await adminDb.getAll(...Array.from({ length: parts }, (_, i) => adminDb.collection(QUEUE_MEDIA).doc(mediaId(item.id, key, i))));
  return Buffer.concat(snaps.map(s => {
    const d = s.data() as { data?: Buffer } | undefined;
    if (!d?.data) throw new Error(`Part of the image "${key}" of this piece is missing.`);
    return Buffer.from(d.data);
  }));
}

async function deleteMedia(item: QueueItem): Promise<void> {
  const refs = Object.entries(item.stored ?? {}).flatMap(([key, parts]) => Array.from({ length: parts }, (_, i) => adminDb.collection(QUEUE_MEDIA).doc(mediaId(item.id, key, i))));
  for (let i = 0; i < refs.length; i += 400) {
    const batch = adminDb.batch();
    refs.slice(i, i + 400).forEach(r => batch.delete(r));
    await batch.commit();
  }
}

// ── The counter's say ────────────────────────────────────────────────────────

const statusError = (message: string, status: number) => Object.assign(new Error(message), { status });

/**
 * `ready`: every image has arrived, so the draft joins the queue (held).
 * `schedule`: send it at `dueAt` (the tick does). `hold`: keep it until told.
 */
export async function changeItem(id: string, change: { action: 'ready' } | { action: 'hold' } | { action: 'schedule'; dueAt: string }): Promise<QueueItem> {
  const ref = col().doc(id);
  return adminDb.runTransaction(async tx => {
    const d = (await tx.get(ref)).data() as QueueItem | undefined;
    if (!d) throw statusError('That piece is no longer in the queue.', 404);
    const live = d.status === 'sending' && !!d.claimedAt && Date.now() - Date.parse(d.claimedAt) < CLAIM_MS;
    if (live) throw statusError('That piece is being sent right now.', 409);
    if (d.status === 'sent') throw statusError('That piece has already gone out.', 409);
    let patch: Partial<QueueItem>;
    if (change.action === 'ready') {
      if (d.status !== 'draft') return d;
      const missing = queueMediaKeys(d, d.counts).filter(k => !d.stored?.[k]);
      if (missing.length) throw statusError(`Some of this piece's images did not arrive (${missing.join(', ')}). Queue it again.`, 400);
      patch = { status: 'held' };
    } else if (d.status === 'draft') {
      throw statusError('That piece has not finished arriving.', 409);
    } else if (change.action === 'hold') {
      // Something already went (or may have): it stays "failed" so the list says what is left.
      patch = { status: d.status === 'failed' || d.status === 'sending' ? 'failed' : 'held', dueAt: null, claimedAt: null };
    } else {
      if (!Number.isFinite(Date.parse(change.dueAt))) throw statusError('That time could not be read.', 400);
      // Scheduling again is also how the counter gives a failed piece its tries back.
      patch = { status: 'scheduled', dueAt: new Date(change.dueAt).toISOString(), attempts: 0, claimedAt: null };
    }
    tx.update(ref, patch);
    return { ...d, ...patch };
  });
}

export async function deleteItem(id: string): Promise<void> {
  const item = await getItem(id);
  if (!item) return;
  if (item.status === 'sending' && item.claimedAt && Date.now() - Date.parse(item.claimedAt) < CLAIM_MS) throw statusError('That piece is being sent right now.', 409);
  await deleteMedia(item);
  await col().doc(id).delete();
}

/** The queue as the page shows it: everything not yet gone, and what went in the last two days. */
export async function listItems(): Promise<QueueItem[]> {
  const snap = await col().orderBy('createdAt', 'desc').limit(150).get();
  const recent = Date.now() - 2 * 86_400_000;
  return snap.docs.map(d => d.data() as QueueItem)
    .filter(d => d.status !== 'draft' && (d.status !== 'sent' || Date.parse(d.sentAt || d.createdAt) > recent))
    .reverse();
}

// ── Sending ─────────────────────────────────────────────────────────────────

/**
 * Take a piece to send. `force` is the counter's "send now" — any held,
 * scheduled or failed piece; otherwise only one whose time has come and that
 * has tries left.
 */
export async function claimItem(id: string, now = new Date(), force = false): Promise<QueueItem | null> {
  const ref = col().doc(id);
  return adminDb.runTransaction(async tx => {
    const d = (await tx.get(ref)).data() as QueueItem | undefined;
    if (!d || d.status === 'draft' || d.status === 'sent') return null;
    if (d.status === 'sending' && d.claimedAt && now.getTime() - Date.parse(d.claimedAt) < CLAIM_MS) return null;
    if (!force) {
      if (!d.dueAt || Date.parse(d.dueAt) > now.getTime()) return null;
      if (d.status === 'held' || d.attempts >= MAX_TRIES) return null;
    }
    const patch = { status: 'sending' as const, claimedAt: now.toISOString(), attempts: (d.attempts || 0) + 1 };
    tx.update(ref, patch);
    return { ...d, ...patch };
  });
}

/** How one unit goes out; swapped in tests so nothing real is sent. */
export interface Senders {
  site(body: Blob, folder: string, name: string): Promise<string>;
  featured(rel: string, by: string): Promise<string>;
  story(jpeg: Buffer, origin: string): Promise<string>;
  whatsapp(d: Destination, body: Blob, name: string, caption: string): Promise<string>;
}

const realSenders: Senders = {
  site: async (body, folder, name) => (await uploadToSite(body, folder, name)).rel,
  featured: async (rel, by) => {
    const key = rel.endsWith('.webp') ? rel : rel.replace(/\.[^.]+$/, '') + '.webp';
    await saveFeatured({ key, note: '', at: new Date().toISOString(), by });
    return key;
  },
  story: (jpeg, origin) => postStoryImage(jpeg, origin),
  whatsapp: (d, body, name, caption) => sendWhatsAppFileToGroup(d.chatId, body, name, caption),
};

const whereOf = (unit: string): Where => (unit.startsWith('site-') ? 'website' : unit === 'featured' ? 'featured' : unit === 'instagram' ? 'instagram' : 'whatsapp');
const jpegBlob = (b: Buffer) => new Blob([new Uint8Array(b)], { type: 'image/jpeg' });

/**
 * Send what is left of a claimed piece, one unit at a time, recording each as
 * it goes. A WhatsApp destination that fails a photo stops there (its later
 * photos would arrive without the first); the other destinations carry on.
 */
export async function sendItem(item: QueueItem, opts: { by: string; origin: string; senders?: Partial<Senders> }): Promise<QueueItem> {
  const s = { ...realSenders, ...opts.senders };
  const ref = col().doc(item.id);
  const done = { ...item.done };
  const errors: QueueItem['errors'] = {};
  const destinations = new Map([...postGroups(), ...(postChannel() ? [postChannel()!] : [])].map(d => [d.key, d]));
  const blocked = new Set<string>();   // WhatsApp destinations that failed a photo this time
  const media = new Map<string, Buffer>();
  const image = async (key: string) => { if (!media.has(key)) media.set(key, await getMedia(item, key)); return media.get(key)!; };

  for (const unit of queueUnits(item, item.counts)) {
    if (done[unit]) continue;
    const wa = unit.match(/^wa:(.+):(\d+)$/);
    if (wa && blocked.has(wa[1])) continue;
    try {
      let ref_: string;
      if (unit.startsWith('site-')) {
        const i = Number(unit.slice(5));
        ref_ = await s.site(jpegBlob(await image(unit)), item.website!.folder, item.website!.names[i] || `${item.headline || 'Piece'} ${i + 1}.jpg`);
      } else if (unit === 'featured') {
        if (!done['site-0']) throw new Error('The first photo is not on the website yet.');
        ref_ = await s.featured(done['site-0'], opts.by);
      } else if (unit === 'instagram') {
        ref_ = await s.story(await image('story'), opts.origin);
        await adminDb.collection('social_posts').add({ at: new Date().toISOString(), by: opts.by, destination: 'instagram-story', mediaId: ref_, queue: item.id }).catch(() => undefined);
      } else if (wa) {
        const d = destinations.get(wa[1]);
        if (!d) throw new Error(`"${wa[1]}" is no longer one of this shop's WhatsApp destinations.`);
        const i = Number(wa[2]);
        const name = `${item.fileBase}${i ? `-${i + 1}` : ''}.jpg`;
        const caption = i === 0 ? item.caption : '';
        ref_ = await s.whatsapp(d, jpegBlob(await image(`wa-${i}`)), name, caption);
        await adminDb.collection('social_posts').add({
          at: new Date().toISOString(), by: opts.by, destination: logName(d), chatId: d.chatId,
          idMessage: ref_, fileName: name, caption: caption.slice(0, 1024), queue: item.id,
        }).catch(() => undefined);
      } else {
        continue;
      }
      done[unit] = ref_ || 'sent';
      await ref.update({ [`done.${unit}`]: done[unit] });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors[unit] = { message: message.slice(0, 400), at: new Date().toISOString() };
      if (wa) blocked.add(wa[1]);
      await recordError(whereOf(unit), e, { by: opts.by, queue: item.id, unit });
    }
  }

  const left = queueUnits(item, item.counts).filter(u => !done[u]);
  const finished = left.length === 0;
  const patch: Record<string, unknown> = {
    status: finished ? 'sent' : 'failed', claimedAt: null, errors,
    ...(finished ? { sentAt: new Date().toISOString() } : {}),
  };
  await ref.update(patch);
  if (finished) await deleteMedia(item).then(() => ref.update({ stored: {} })).catch(e => console.warn('[queue] could not clear the images:', e));
  return { ...item, ...(patch as Partial<QueueItem>), done };
}

/** Pieces whose time has come (the last two days; older ones are the counter's to look at). */
export async function dueItems(now = new Date()): Promise<QueueItem[]> {
  const snap = await col().where('dueAt', '<=', now.toISOString()).where('dueAt', '>=', new Date(now.getTime() - 2 * 86_400_000).toISOString()).orderBy('dueAt').get();
  return snap.docs.map(d => d.data() as QueueItem)
    .filter(d => (d.status === 'scheduled' || d.status === 'failed' || d.status === 'sending') && (d.attempts || 0) < MAX_TRIES);
}

/** Drafts that never finished arriving (the page closed mid-way), and pieces that went out over a week ago. */
export async function sweep(now = new Date()): Promise<number> {
  const [drafts, sent] = await Promise.all([
    col().where('status', '==', 'draft').limit(50).get(),
    col().where('status', '==', 'sent').limit(200).get(),
  ]);
  const stale = [
    ...drafts.docs.filter(d => Date.parse((d.data() as QueueItem).createdAt) < now.getTime() - 6 * 3_600_000),
    ...sent.docs.filter(d => { const x = d.data() as QueueItem; return Date.parse(x.sentAt || x.createdAt) < now.getTime() - 7 * 86_400_000; }),
  ];
  for (const doc of stale) {
    await deleteMedia(doc.data() as QueueItem).catch(() => undefined);
    await doc.ref.delete();
  }
  return stale.length;
}
