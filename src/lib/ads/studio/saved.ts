/**
 * Saved ads (owner, 2026-09-29: "an ad container with folders etc where i can store ads and see existing ads
 * stored"): what the maker made, kept with everything needed to open it again — the finished picture, the
 * photo it was drawn on, the layout document and the words — in folders the owner names.
 *
 *   ad_folders/{id}        { name, at }
 *   ad_saved/{id}          the ad's words and settings, a small thumbnail, and how many parts each file has
 *   ad_saved_media/{id}__{key}__{n}   the files ('image', 'photo', 'doc'), split into 900 KB parts
 *                          (a Firestore document holds 1 MB; there is no public bucket)
 *
 * Nothing here is Meta's: the ads already in the ad account are read live beside these (the Saved tab).
 * Server-only.
 */

import { adminDb } from '@/lib/firebase-admin';
import type { AdFormat, AdTemplateId } from './templates';
import type { GoalKey } from '@/lib/ads/plan';

export const FOLDERS = 'ad_folders';
export const SAVED = 'ad_saved';
const MEDIA = 'ad_saved_media';
const PART = 900 * 1024;
export const SAVED_KEYS = ['image', 'photo', 'doc'] as const;
export type SavedKey = (typeof SAVED_KEYS)[number];

export interface AdFolder { id: string; name: string; at: string }

export interface SavedAd {
  id: string;
  folder: string | null;
  name: string;
  format: AdFormat;
  template: AdTemplateId;
  /** The layout's words (kicker, headline, specs line, call to action). */
  fields: Record<string, string>;
  price: string;
  /** Meta's fields: the primary text and the headline under the picture. */
  text: string;
  headline: string;
  goal: GoalKey;
  link: string;
  /** The library photo it was made from, when there was one. */
  asset: { id: string; name: string } | null;
  /** Kept from an ad already in the ad account (its id): only its picture and words, no layout to reopen. */
  fromAd?: string;
  /** A 200-px JPEG as a data URL, for the grid. */
  thumb: string;
  parts: Partial<Record<SavedKey, number>>;
  at: string;
  updated: string;
  by: string;
}

const mediaId = (id: string, key: string, n: number) => `${id}__${key}__${n}`;

export async function listFolders(): Promise<AdFolder[]> {
  const snap = await adminDb.collection(FOLDERS).orderBy('name').get();
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<AdFolder, 'id'>) }));
}

export async function createFolder(name: string): Promise<AdFolder> {
  const clean = name.trim().slice(0, 60);
  if (!clean) throw Object.assign(new Error('Name the folder.'), { status: 400 });
  const ref = await adminDb.collection(FOLDERS).add({ name: clean, at: new Date().toISOString() });
  return { id: ref.id, name: clean, at: new Date().toISOString() };
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const clean = name.trim().slice(0, 60);
  if (!clean) throw Object.assign(new Error('Name the folder.'), { status: 400 });
  await adminDb.collection(FOLDERS).doc(id).update({ name: clean });
}

/** The folder goes; what was in it stays, unfiled. */
export async function deleteFolder(id: string): Promise<void> {
  const inside = await adminDb.collection(SAVED).where('folder', '==', id).get();
  for (let i = 0; i < inside.docs.length; i += 400) {
    const batch = adminDb.batch();
    inside.docs.slice(i, i + 400).forEach(d => batch.update(d.ref, { folder: null }));
    await batch.commit();
  }
  await adminDb.collection(FOLDERS).doc(id).delete();
}

export async function listSaved(): Promise<SavedAd[]> {
  const snap = await adminDb.collection(SAVED).orderBy('updated', 'desc').limit(500).get();
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<SavedAd, 'id'>) }));
}

export async function getSaved(id: string): Promise<SavedAd | null> {
  const s = await adminDb.collection(SAVED).doc(id).get();
  return s.exists ? ({ id: s.id, ...(s.data() as Omit<SavedAd, 'id'>) }) : null;
}

async function putFile(id: string, key: SavedKey, data: Buffer, old = 0): Promise<number> {
  const parts = Math.max(1, Math.ceil(data.length / PART));
  const batch = adminDb.batch();
  for (let i = 0; i < parts; i++) batch.set(adminDb.collection(MEDIA).doc(mediaId(id, key, i)), { data: data.subarray(i * PART, (i + 1) * PART) });
  for (let i = parts; i < old; i++) batch.delete(adminDb.collection(MEDIA).doc(mediaId(id, key, i)));
  await batch.commit();
  return parts;
}

export async function readFile(item: SavedAd, key: SavedKey): Promise<Buffer | null> {
  const parts = item.parts[key];
  if (!parts) return null;
  const snaps = await adminDb.getAll(...Array.from({ length: parts }, (_, i) => adminDb.collection(MEDIA).doc(mediaId(item.id, key, i))));
  const bufs = snaps.map(s => (s.data() as { data?: Buffer } | undefined)?.data);
  if (bufs.some(b => !b)) return null;
  return Buffer.concat(bufs.map(b => Buffer.from(b!)));
}

export type SavedInput = Omit<SavedAd, 'id' | 'parts' | 'at' | 'updated' | 'by'>;

/** A new saved ad, or (with `id`) the same one saved again over itself. */
export async function saveAd(input: SavedInput, files: Partial<Record<SavedKey, Buffer>>, by: string, id?: string): Promise<SavedAd> {
  const now = new Date().toISOString();
  const prior = id ? await getSaved(id) : null;
  if (id && !prior) throw Object.assign(new Error('That saved ad is gone.'), { status: 404 });
  const ref = prior ? adminDb.collection(SAVED).doc(prior.id) : adminDb.collection(SAVED).doc();
  const parts: Partial<Record<SavedKey, number>> = { ...(prior?.parts ?? {}) };
  for (const key of SAVED_KEYS) {
    const data = files[key];
    if (data?.length) parts[key] = await putFile(ref.id, key, data, prior?.parts[key] ?? 0);
  }
  const item: Omit<SavedAd, 'id'> = { ...input, parts, at: prior?.at ?? now, updated: now, by };
  await ref.set(item);
  return { id: ref.id, ...item };
}

export async function moveSaved(id: string, change: { folder?: string | null; name?: string }): Promise<void> {
  const patch: Record<string, unknown> = { updated: new Date().toISOString() };
  if (change.folder !== undefined) patch.folder = change.folder;
  if (change.name !== undefined) {
    const n = change.name.trim().slice(0, 120);
    if (!n) throw Object.assign(new Error('A name, please.'), { status: 400 });
    patch.name = n;
  }
  await adminDb.collection(SAVED).doc(id).update(patch);
}

export async function deleteSaved(id: string): Promise<void> {
  const item = await getSaved(id);
  if (!item) return;
  const batch = adminDb.batch();
  for (const [key, n] of Object.entries(item.parts)) for (let i = 0; i < (n ?? 0); i++) batch.delete(adminDb.collection(MEDIA).doc(mediaId(id, key, i)));
  batch.delete(adminDb.collection(SAVED).doc(id));
  await batch.commit();
}
