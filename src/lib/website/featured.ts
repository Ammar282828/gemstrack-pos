/**
 * The set of the day — one piece the counter puts on the home page.
 *
 * The shop already does this on Instagram every morning; this is the same
 * gesture for the site. One document, one piece, one line of the counter's
 * own words. Cleared by writing null. The site reads it through
 * /api/public/featured and shows the chapter only while something is set.
 */

import { adminDb } from '@/lib/firebase-admin';

const DOC = adminDb.collection('app_settings').doc('website_featured');

export interface Featured {
  /** "Earrings/Jhumki/Jhumki 12.webp" — the same key the catalogue uses. */
  key: string;
  /** The counter's line about it, if any. */
  note: string;
  at: string;
  by: string;
}

export async function loadFeatured(): Promise<Featured | null> {
  const snap = await DOC.get();
  const d = snap.exists ? (snap.data() as Partial<Featured>) : null;
  if (!d || typeof d.key !== 'string' || !d.key) return null;
  return { key: d.key, note: typeof d.note === 'string' ? d.note : '', at: String(d.at || ''), by: String(d.by || '') };
}

export async function saveFeatured(f: Featured | null): Promise<void> {
  if (!f) { await DOC.set({ key: null, note: '', at: new Date().toISOString() }); return; }
  await DOC.set(f);
}
