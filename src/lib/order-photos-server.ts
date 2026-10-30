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

type StoredItem = { samplePhotoId?: string; sampleImageDataUri?: string; extraPhotos?: { id?: string; dataUri?: string; hash?: string }[] };

/** Orders as they were before the move: each item's photos back inline (the first in `sampleImageDataUri`, the others in `extraPhotos[].dataUri`). */
export async function withInlinePhotos<O extends { items?: unknown }>(db: Firestore, orders: O[]): Promise<O[]> {
  const ids: string[] = [];
  for (const o of orders) for (const it of (Array.isArray(o.items) ? o.items : []) as StoredItem[]) {
    if (it?.samplePhotoId && !it.sampleImageDataUri) ids.push(it.samplePhotoId);
    for (const e of it?.extraPhotos ?? []) if (e?.id && !e.dataUri) ids.push(e.id);
  }
  const photos = await readOrderPhotos(db, ids);
  if (!photos.size) return orders;
  return orders.map(o => ({
    ...o,
    items: (Array.isArray(o.items) ? o.items : []).map((it: StoredItem) => {
      if (!it) return it;
      const first = it.samplePhotoId && !it.sampleImageDataUri && photos.has(it.samplePhotoId) ? { sampleImageDataUri: photos.get(it.samplePhotoId) } : {};
      const extras = it.extraPhotos?.length
        ? { extraPhotos: it.extraPhotos.map(e => (e?.id && !e.dataUri && photos.has(e.id) ? { ...e, dataUri: photos.get(e.id) } : e)) }
        : {};
      return { ...it, ...first, ...extras };
    }),
  }));
}
