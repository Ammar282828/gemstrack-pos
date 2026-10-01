/**
 * Post a Piece's drafts: every piece being made, kept on this device as it is made, and picked up
 * where it was left (the owner, 2026-09-27: "post a piece should have proper memory and have drafts
 * and continue where left off").
 *
 * IndexedDB rather than Firestore: a piece is its photographs — camera files of several megabytes
 * each, and the AI's versions — which a Firestore document can't hold, and which never need to leave
 * the phone they were taken on. Two stores: `drafts` (the words, both designs, where it goes — small,
 * rewritten on every change) and `photos` (each photograph written once, by draft and photo id).
 * A draft leaves once it is published or queued, and after 30 days untouched.
 */

import type { SiteFrom } from '@/lib/website/site-photo';

const DB_NAME = 'taheri-post-drafts';
const DB_VERSION = 1;
export const POST_DRAFT_MAX_DAYS = 30;

export interface PostDraftPhoto {
  id: string;
  name: string;
  toSite: boolean;
  toWhatsApp: boolean;
  ai?: unknown;
  /** Taken from the house's website (Post a Piece → From the website). */
  from?: SiteFrom;
}

/** What the page knows about an AI-made story or post besides its image. */
export interface PaintedMeta {
  verified: boolean; missing: string[]; forId: string;
  kind?: 'letter' | 'paint';
  check?: { samePiece: boolean; confidence: number; differences: string[] } | null;
}

export interface PostDraft<S = Record<string, unknown>> {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** The headline, for the list. */
  title: string;
  photos: PostDraftPhoto[];
  /** The AI-lettered or painted story image, when there is one (its own photo, keyed `lettered`). */
  lettered?: PaintedMeta | null;
  /** The painted post (the square), when there is one (keyed `painted`). */
  painted?: PaintedMeta | null;
  /** A small JPEG of the lead photo, for the list. */
  thumb?: Blob | null;
  state: S;
}

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('No storage on this device'));
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});
const result = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const photoKey = (draftId: string, photoId: string) => `${draftId}:${photoId}`;

/** Save the draft; photographs not yet stored for it are written, ones no longer in it removed. */
export async function savePostDraft(d: PostDraft, blobs: Map<string, Blob>, stored: Set<string>): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['drafts', 'photos'], 'readwrite');
  const photos = tx.objectStore('photos');
  const keep = new Set([...d.photos.map(p => p.id), ...(d.lettered ? ['lettered'] : []), ...(d.painted ? ['painted'] : [])]);
  for (const [id, blob] of blobs) {
    if (!keep.has(id) || stored.has(id)) continue;
    photos.put(blob, photoKey(d.id, id));
    stored.add(id);
  }
  for (const id of [...stored]) {
    if (keep.has(id)) continue;
    photos.delete(photoKey(d.id, id));
    stored.delete(id);
  }
  tx.objectStore('drafts').put(d);
  await done(tx);
}

/** A draft and its photographs. */
export async function readPostDraft<S>(id: string): Promise<{ draft: PostDraft<S>; blobs: Map<string, Blob> } | null> {
  const db = await openDb();
  const tx = db.transaction(['drafts', 'photos'], 'readonly');
  const draft = await result(tx.objectStore('drafts').get(id)) as PostDraft<S> | undefined;
  if (!draft) return null;
  const blobs = new Map<string, Blob>();
  const ids = [...draft.photos.map(p => p.id), ...(draft.lettered ? ['lettered'] : []), ...(draft.painted ? ['painted'] : [])];
  await Promise.all(ids.map(async pid => {
    const b = await result(tx.objectStore('photos').get(photoKey(id, pid))) as Blob | undefined;
    if (b) blobs.set(pid, b);
  }));
  return { draft, blobs };
}

/** Every draft on this device, newest first (without their photographs). Old ones are cleared. */
export async function listPostDrafts(): Promise<PostDraft[]> {
  const db = await openDb();
  const all = await result(db.transaction('drafts', 'readonly').objectStore('drafts').getAll()) as PostDraft[];
  const cutoff = Date.now() - POST_DRAFT_MAX_DAYS * 864e5;
  const stale = all.filter(d => Date.parse(d.updatedAt) < cutoff);
  for (const d of stale) void deletePostDraft(d.id);
  return all.filter(d => !stale.includes(d)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deletePostDraft(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['drafts', 'photos'], 'readwrite');
  tx.objectStore('drafts').delete(id);
  tx.objectStore('photos').delete(IDBKeyRange.bound(`${id}:`, `${id}:￿`));
  await done(tx);
}

/** A small JPEG of a photograph for the drafts list. */
export async function thumbOf(img: HTMLImageElement, size = 160): Promise<Blob | null> {
  try {
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return null;
    const k = size / Math.min(w, h);
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    c.getContext('2d')!.drawImage(img, (size - w * k) / 2, (size - h * k) / 2, w * k, h * k);
    return await new Promise(res => c.toBlob(b => res(b), 'image/jpeg', 0.8));
  } catch { return null; }
}

// ── What this device remembers between pieces ──────────────────────────────

const CURRENT_KEY = 'taheri_post_draft';
const PREFS_KEY = 'taheri_post_prefs';

export const currentPostDraft = (): string | null => { try { return localStorage.getItem(CURRENT_KEY); } catch { return null; } };
export const setCurrentPostDraft = (id: string | null) => {
  try { if (id) localStorage.setItem(CURRENT_KEY, id); else localStorage.removeItem(CURRENT_KEY); } catch { /* private mode */ }
};

/** Where pieces usually go from this device, so a new one starts there. */
export interface PostPrefs { waTargets?: string[]; toWhatsApp?: boolean; toInstagram?: boolean; toWebsite?: boolean; weightOwnLine?: boolean }
export const readPostPrefs = (): PostPrefs => { try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') as PostPrefs; } catch { return {}; } };
export const writePostPrefs = (p: PostPrefs) => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode */ } };
