/**
 * Server side of lib/order-photos.ts: the portals that never read Firestore themselves (the
 * karigar's My work, staff) get each photo back inline, as before the photos moved out.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { ORDER_PHOTOS } from '@/lib/order-photos';

/** id → data URI for the photo documents that exist. One round trip for all of them. */
export async function readOrderPhotos(db: Firestore, ids: Iterable<string>): Promise<Map<string, string>> {
  const unique = [...new Set([...ids].filter(Boolean))];
  if (!unique.length) return new Map();
  const snaps = await db.getAll(...unique.map(id => db.collection(ORDER_PHOTOS).doc(id)));
  const out = new Map<string, string>();
  for (const s of snaps) if (s.exists) out.set(s.id, String(s.get('dataUri') || ''));
  return out;
}

/** Orders as they were before the move: each item's photo back in `sampleImageDataUri`. */
export async function withInlinePhotos<O extends { items?: unknown }>(db: Firestore, orders: O[]): Promise<O[]> {
  const ids: string[] = [];
  for (const o of orders) for (const it of (Array.isArray(o.items) ? o.items : []) as { samplePhotoId?: string; sampleImageDataUri?: string }[]) {
    if (it?.samplePhotoId && !it.sampleImageDataUri) ids.push(it.samplePhotoId);
  }
  const photos = await readOrderPhotos(db, ids);
  if (!photos.size) return orders;
  return orders.map(o => ({
    ...o,
    items: (Array.isArray(o.items) ? o.items : []).map((it: { samplePhotoId?: string; sampleImageDataUri?: string }) =>
      it?.samplePhotoId && !it.sampleImageDataUri && photos.has(it.samplePhotoId) ? { ...it, sampleImageDataUri: photos.get(it.samplePhotoId) } : it),
  }));
}
