/**
 * Website → Edit a piece: the counter's changes to a piece already on this
 * house's website — its photograph re-made (cropped, the weight and the mark
 * stamped on, enhanced), its name, its words, its facts, or the piece hidden.
 *
 * The site keeps them itself (api/override.php on taheri.shop and on the House of
 * Mina catalogue, the same file on both): the words in catalog-overrides.json,
 * applied the moment a page loads; a new photograph written over the old file,
 * so the piece keeps its address everywhere (favourites, bags, links), the
 * original kept once for going back. The site trusts only this server, with
 * WEBSITE_UPLOAD_SECRET, as for Add Photos.
 *
 * Here: reading the site's list (cached briefly, never throws), sending a change,
 * and the Firestore record — each piece's last design (`website_edits`, so the
 * editor re-opens it as it was, always over the original photograph) and a log
 * of who changed what (`website_edits_log`).
 *
 * Server-only.
 */

import { adminDb } from '@/lib/firebase-admin';
import { docIdFor } from '@/lib/website/weights';

/** What the site keeps for one piece (api/_overrides.php). */
export interface SiteOverride {
  name?: string;
  about?: string;
  facts?: string[];
  stone?: string;
  metal?: string;
  karat?: string;
  cut?: string;
  style?: string;
  weightGrams?: number;
  /** The photograph now shows the weight: the site doesn't draw it again. */
  weightOnPhoto?: boolean;
  hidden?: boolean;
  photo?: { image: string; v: string; edited: boolean; w?: number; h?: number };
  at?: string;
}

/** The words a change may carry, and how long each may be (the site's own limits). */
export const TEXT_LIMITS = { name: 160, about: 4000, stone: 80, metal: 80, karat: 8, cut: 80, style: 80 } as const;
export type TextField = keyof typeof TEXT_LIMITS;
/** A change as the page sends it: a value sets a field, null puts the site's own back. */
export type Fields = Partial<Record<TextField, string | null>> & {
  facts?: string[] | null;
  weightGrams?: number | null;
  weightOnPhoto?: boolean | null;
  hidden?: boolean | null;
};

/** A refusal or failure, with the status the route should answer with. */
export class SiteEditError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

// ── The site's list ─────────────────────────────────────────────────────────

const TTL_MS = 30 * 1000;
let cache: { at: number; site: string; all: Record<string, SiteOverride> } | null = null;

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/**
 * Every piece the counter has changed on `site`. A site without the endpoint
 * (not deployed yet) or one that doesn't answer gives the last list read, or
 * none — the pieces then show as the site built them.
 */
export async function getSiteOverrides(site: string, fresh = false): Promise<Record<string, SiteOverride>> {
  if (!site) return {};
  if (!fresh && cache && cache.site === site && Date.now() - cache.at < TTL_MS) return cache.all;
  // A failed read keeps what was last read and waits the same thirty seconds before
  // asking again: prices call this on every quote, and must not wait on a slow site each time.
  const keep = () => { cache = { at: Date.now(), site, all: cache?.site === site ? cache.all : {} }; return cache.all; };
  try {
    const res = await fetch(`${site}/api/override.php`, { cache: 'no-store', signal: AbortSignal.timeout(fresh ? 8000 : 4000) });
    const d = res.ok ? await res.json().catch(() => null) : null;
    if (!d?.ok || !isRecord(d.overrides)) return keep();
    cache = { at: Date.now(), site, all: d.overrides as Record<string, SiteOverride> };
    return cache.all;
  } catch {
    return keep();
  }
}

/** After a change: this instance shows it at once. */
function prime(site: string, key: string, entry: SiteOverride | null) {
  if (!cache || cache.site !== site) return;
  const all = { ...cache.all };
  if (entry) all[key] = entry; else delete all[key];
  cache = { ...cache, all };
}

// ── Addresses ───────────────────────────────────────────────────────────────

/** "https://taheri.shop/catalog-full/Rings%20%26%20Bands/Rings/Ring%2012.webp?v=3" → "Rings & Bands/Rings/Ring 12.webp". */
export function imagePathOf(url: string, site: string): string | null {
  let path = url.startsWith(site) ? url.slice(site.length) : url.replace(/^https?:\/\/[^/]+/, '');
  path = path.split(/[?#]/)[0];
  const m = path.match(/^\/catalog-full\/(.+\.webp)$/i);
  if (!m) return null;
  let rel = m[1];
  try { rel = decodeURIComponent(rel); } catch { /* already plain */ }
  return rel.split('/').some(p => !p || p === '.' || p === '..') ? null : rel;
}

const encodePath = (rel: string) => rel.split('/').map(encodeURIComponent).join('/');
/** The photograph as the site built it, kept when the counter first replaced it. */
export const originalUrl = (site: string, image: string) => `${site}/catalog-edit/originals/full/${encodePath(image)}`;

// ── Sending a change ────────────────────────────────────────────────────────

export interface Change {
  key: string;
  fields?: Fields;
  /** The photograph's path under catalog-full/, with `file` (its replacement) or `photo: 'revert'`. */
  image?: string | null;
  file?: Blob | null;
  photo?: 'revert';
  /** Undo every change to the piece, its photograph included. */
  action?: 'revert';
}

export async function sendChange(site: string, c: Change): Promise<SiteOverride | null> {
  const secret = process.env.WEBSITE_UPLOAD_SECRET;
  if (!secret) throw new SiteEditError('Changes to the website are not configured. Set WEBSITE_UPLOAD_SECRET on the POS (the same one Add Photos uses).', 503);
  const form = new FormData();
  form.set('key', c.key);
  if (c.fields && Object.keys(c.fields).length) form.set('fields', JSON.stringify(c.fields));
  if (c.image) form.set('image', c.image);
  if (c.file) form.set('file', c.file, 'photo.jpg');
  if (c.photo) form.set('photo', c.photo);
  if (c.action) form.set('action', c.action);
  let res: Response;
  try {
    res = await fetch(`${site}/api/override.php`, {
      method: 'POST', headers: { Authorization: `Bearer ${secret}` }, body: form,
      // A 3000-px photograph is re-made in two sizes on the shared host.
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    throw new SiteEditError(e instanceof Error && e.name === 'TimeoutError'
      ? 'The website did not answer in time. The change may still have arrived — reload before trying again.'
      : `The website could not be reached: ${e instanceof Error ? e.message : e}`, 504);
  }
  const text = await res.text();
  let d: { ok?: boolean; error?: string; override?: SiteOverride | null };
  try { d = JSON.parse(text); } catch {
    throw new SiteEditError(res.status === 404
      ? 'This website cannot take changes yet (no api/override.php). Deploy the site first.'
      : `The website answered unexpectedly (${res.status}).`, 502);
  }
  if (!res.ok || d.ok !== true) {
    // 401 is our secret not matching the site's: the counter can't fix that, the setup can.
    throw new SiteEditError(res.status === 401 ? 'The website refused the POS’s key (WEBSITE_UPLOAD_SECRET differs from the site’s).' : d.error || `The website refused the change (${res.status}).`,
      res.status === 401 ? 502 : res.status >= 400 && res.status < 600 ? res.status : 502);
  }
  const entry = d.override ?? null;
  prime(site, c.key, entry);
  return entry;
}

// ── The record ──────────────────────────────────────────────────────────────

export const EDITS = 'website_edits';
export const EDITS_LOG = 'website_edits_log';

/** A piece's last design, to re-open as it was: the editor's document, as JSON. */
export interface SavedDesign { design: string; shape: 'own' | 'square'; ai: string[]; at: string; by: string }

export async function getSavedDesign(key: string): Promise<SavedDesign | null> {
  const snap = await adminDb.collection(EDITS).doc(docIdFor(key)).get();
  const d = snap.data() as (SavedDesign & { key: string }) | undefined;
  return d?.design ? { design: d.design, shape: d.shape === 'square' ? 'square' : 'own', ai: Array.isArray(d.ai) ? d.ai : [], at: d.at, by: d.by } : null;
}

/** Firestore keeps a document under 1 MiB; a design with big uploaded pictures in it is not kept. */
const MAX_DESIGN = 800_000;

export async function saveDesign(key: string, site: string, design: SavedDesign | null): Promise<boolean> {
  const ref = adminDb.collection(EDITS).doc(docIdFor(key));
  if (!design) { await ref.delete(); return true; }
  if (design.design.length > MAX_DESIGN) { await ref.delete(); return false; }
  await ref.set({ key, site, ...design });
  return true;
}

export async function logChange(entry: { key: string; site: string; name: string; what: string[]; by: string }): Promise<void> {
  await adminDb.collection(EDITS_LOG).add({ ...entry, at: new Date().toISOString() });
}

/** The last changes made from the counter, newest first. */
export async function recentChanges(limit = 30): Promise<{ key: string; name: string; what: string[]; by: string; at: string }[]> {
  const snap = await adminDb.collection(EDITS_LOG).orderBy('at', 'desc').limit(limit).get();
  return snap.docs.map(d => d.data() as { key: string; name: string; what: string[]; by: string; at: string });
}
