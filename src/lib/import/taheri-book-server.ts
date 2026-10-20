/**
 * Taheri's old-app customer book, read on the server. It used to ship in the code (taheri-book.json, in a public
 * JS chunk); it now lives in Firestore `app_private/taheri_book` (field `book`), which only the Admin SDK reads.
 * Cached in memory: the book never changes. Null when this house has none (Mina).
 */
import { adminDb } from '@/lib/firebase-admin';
import type { TaheriBook } from '@/lib/import/taheri-book';

let cached: TaheriBook | null | undefined;

export async function loadTaheriBook(): Promise<TaheriBook | null> {
  if (cached !== undefined) return cached;
  const snap = await adminDb.collection('app_private').doc('taheri_book').get();
  const book = snap.exists ? (snap.get('book') as TaheriBook | undefined) : undefined;
  if (book) cached = book; // do not cache a miss: it may be uploaded later
  return book ?? null;
}
