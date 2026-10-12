/**
 * Designs in the database (plan §5.5). Server-only, admin SDK like `ad_saved`.
 *
 *   designs/{id}                      a DesignRecord (words, pages, a thumbnail, how many parts each file has)
 *   design_media/{id}__{key}__{n}     the files ('doc:<page>', 'image:<page>', 'photo:<photoId>'), 900 KB parts
 *   ad_folders/{id}                   the folders, shared with Saved ads (lib/ads/studio/saved.ts)
 *
 * Legacy `ad_saved` ads read through as `saved:<id>` (saved-compat.ts) and are never copied: the first save of
 * one writes a design that supersedes it. Who may see a record is the routes' business (scope).
 */

import { adminDb } from '@/lib/firebase-admin';
import { deleteSaved, getSaved, listFolders, listSaved, moveSaved, readFile as readSavedFile, deleteFolder as deleteLegacyFolder, createFolder, renameFolder, type AdFolder } from '@/lib/ads/studio/saved';
import type { DesignInput, DesignRecord, PublishEntry } from './model';
import { FILE_KEY } from './model';
import { fromSaved, isLegacyId, legacyId, legacyKeyOf, mergeDesigns } from './saved-compat';

export const DESIGNS = 'designs';
const MEDIA = 'design_media';
const PART = 900 * 1024;
export { createFolder, renameFolder, listFolders, type AdFolder };

const mediaId = (id: string, key: string, n: number) => `${id}__${key}__${n}`;
const gone = () => Object.assign(new Error('That design is gone.'), { status: 404 });

/** Every design the caller may see: with `ads`, the ads-scope ones and the legacy saved ads too. */
export async function listDesigns(opts: { ads: boolean }): Promise<DesignRecord[]> {
  const [snap, saved] = await Promise.all([
    adminDb.collection(DESIGNS).orderBy('updated', 'desc').limit(500).get(),
    opts.ads ? listSaved() : Promise.resolve([]),
  ]);
  const designs = snap.docs.map(d => ({ ...(d.data() as Omit<DesignRecord, 'id'>), id: d.id })).filter(d => opts.ads || d.scope === 'shop');
  return mergeDesigns(designs, saved);
}

export async function getDesign(id: string): Promise<DesignRecord | null> {
  if (isLegacyId(id)) {
    const s = await getSaved(legacyId(id));
    return s ? fromSaved(s) : null;
  }
  const s = await adminDb.collection(DESIGNS).doc(id).get();
  return s.exists ? { ...(s.data() as Omit<DesignRecord, 'id'>), id: s.id } : null;
}

async function putFile(id: string, key: string, data: Buffer, old = 0): Promise<number> {
  const parts = Math.max(1, Math.ceil(data.length / PART));
  const batch = adminDb.batch();
  for (let i = 0; i < parts; i++) batch.set(adminDb.collection(MEDIA).doc(mediaId(id, key, i)), { data: data.subarray(i * PART, (i + 1) * PART) });
  for (let i = parts; i < old; i++) batch.delete(adminDb.collection(MEDIA).doc(mediaId(id, key, i)));
  await batch.commit();
  return parts;
}

/** One file of a design, or null. A legacy ad's files are its saved-ad files. */
export async function readDesignFile(item: DesignRecord, key: string): Promise<Buffer | null> {
  if (!FILE_KEY.test(key)) return null;
  if (isLegacyId(item.id)) {
    const k = legacyKeyOf(key);
    const s = k ? await getSaved(legacyId(item.id)) : null;
    return s && k ? readSavedFile(s, k) : null;
  }
  const parts = item.files[key];
  if (!parts) return null;
  const snaps = await adminDb.getAll(...Array.from({ length: parts }, (_, i) => adminDb.collection(MEDIA).doc(mediaId(item.id, key, i))));
  const bufs = snaps.map(s => (s.data() as { data?: Buffer } | undefined)?.data);
  if (bufs.some(b => !b)) return null;
  return Buffer.concat(bufs.map(b => Buffer.from(b!)));
}

/**
 * A new design, or (with `id`) the same one saved again over itself. Saving a legacy `saved:<id>` writes a
 * design that supersedes it (or, if one already does, saves over that).
 */
export async function saveDesign(input: DesignInput, files: Record<string, Buffer>, by: string, id?: string): Promise<DesignRecord> {
  const now = new Date().toISOString();
  let prior: DesignRecord | null = null;
  let legacy: DesignRecord['legacy'];
  if (id && isLegacyId(id)) {
    const savedId = legacyId(id);
    if (!(await getSaved(savedId))) throw gone();
    const had = await adminDb.collection(DESIGNS).where('legacy.savedAdId', '==', savedId).limit(1).get();
    if (had.empty) legacy = { savedAdId: savedId };
    else prior = { ...(had.docs[0].data() as Omit<DesignRecord, 'id'>), id: had.docs[0].id };
  } else if (id) {
    prior = await getDesign(id);
    if (!prior) throw gone();
  }
  const ref = prior ? adminDb.collection(DESIGNS).doc(prior.id) : adminDb.collection(DESIGNS).doc();
  const parts: Record<string, number> = { ...(prior?.files ?? {}) };
  for (const [key, data] of Object.entries(files)) {
    if (FILE_KEY.test(key) && data?.length) parts[key] = await putFile(ref.id, key, data, prior?.files[key] ?? 0);
  }
  const item: Omit<DesignRecord, 'id'> = {
    ...input,
    files: parts,
    published: prior?.published ?? [],
    ...((prior?.legacy ?? legacy) ? { legacy: prior?.legacy ?? legacy } : {}),
    at: prior?.at ?? now,
    updated: now,
    by,
    rev: (prior?.rev ?? 0) + 1,
  };
  await ref.set(item);
  return { id: ref.id, ...item };
}

/** Move to a folder and/or rename; a legacy ad is changed where it is. */
export async function moveDesign(id: string, change: { folder?: string | null; name?: string }): Promise<void> {
  if (isLegacyId(id)) return moveSaved(legacyId(id), change);
  const patch: Record<string, unknown> = { updated: new Date().toISOString() };
  if (change.folder !== undefined) patch.folder = change.folder;
  if (change.name !== undefined) {
    const n = change.name.trim().slice(0, 120);
    if (!n) throw Object.assign(new Error('A name, please.'), { status: 400 });
    patch.name = n;
  }
  const ref = adminDb.collection(DESIGNS).doc(id);
  if (!(await ref.get()).exists) throw gone();
  await ref.update(patch);
}

/** Note a send on the design (the last 20 are kept). Legacy ads keep none. */
export async function recordPublish(id: string, entry: PublishEntry): Promise<void> {
  if (isLegacyId(id)) return;
  const ref = adminDb.collection(DESIGNS).doc(id);
  await adminDb.runTransaction(async tx => {
    const s = await tx.get(ref);
    if (!s.exists) throw gone();
    const published = [entry, ...((s.data() as DesignRecord).published ?? [])].slice(0, 20);
    tx.update(ref, { published });
  });
}

export async function deleteDesign(id: string): Promise<void> {
  if (isLegacyId(id)) return deleteSaved(legacyId(id));
  const item = await getDesign(id);
  if (!item) return;
  const batch = adminDb.batch();
  for (const [key, n] of Object.entries(item.files)) for (let i = 0; i < n; i++) batch.delete(adminDb.collection(MEDIA).doc(mediaId(id, key, i)));
  batch.delete(adminDb.collection(DESIGNS).doc(id));
  await batch.commit();
}

/** The folder goes; the designs and saved ads in it stay, unfiled. */
export async function deleteFolder(id: string): Promise<void> {
  const inside = await adminDb.collection(DESIGNS).where('folder', '==', id).get();
  for (let i = 0; i < inside.docs.length; i += 400) {
    const batch = adminDb.batch();
    inside.docs.slice(i, i + 400).forEach(d => batch.update(d.ref, { folder: null }));
    await batch.commit();
  }
  await deleteLegacyFolder(id);
}
