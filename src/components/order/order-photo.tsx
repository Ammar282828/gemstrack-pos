"use client";

/**
 * A piece's sample photo, wherever it is kept: inline on the item (a stock piece's URL, or an order
 * not yet moved) or in its own document (`order_photos/<id>`, lib/order-photos.ts). Each photo is
 * read once a visit — from this device's Firestore cache when it is there — and never changes, so
 * it is kept in memory by id.
 */

import React, { useEffect, useState } from 'react';
import { doc, getDoc, getDocFromCache } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ORDER_PHOTOS, itemPhotoRef } from '@/lib/order-photos';

const cache = new Map<string, Promise<string | null>>();

export function loadOrderPhoto(id: string): Promise<string | null> {
  let hit = cache.get(id);
  if (!hit) {
    const ref = doc(db, ORDER_PHOTOS, id);
    hit = getDocFromCache(ref).catch(() => null)
      .then(snap => (snap?.exists() ? snap : getDoc(ref)))
      .then(snap => (snap.exists() ? String(snap.data().dataUri || '') || null : null))
      .catch(() => null);
    // A failed read (offline, signed out) is asked again next time rather than remembered.
    hit.then(v => { if (v === null) cache.delete(id); });
    cache.set(id, hit);
  }
  return hit;
}

type PhotoItem = { sampleImageDataUri?: string; samplePhotoId?: string } | null | undefined;

/** The image to show for an item, or null — undefined while a photo document is being read. */
export function useOrderPhoto(item: PhotoItem): string | null | undefined {
  const { src, id } = itemPhotoRef(item);
  const [loaded, setLoaded] = useState<{ id: string; src: string | null } | null>(null);
  useEffect(() => {
    if (src || !id) return;
    let live = true;
    void loadOrderPhoto(id).then(v => { if (live) setLoaded({ id, src: v }); });
    return () => { live = false; };
  }, [src, id]);
  if (src) return src;
  if (!id) return null;
  return loaded?.id === id ? loaded.src : undefined;
}

/** Renders `children(src)` once the photo is known; nothing when the piece has none. */
export function OrderPhoto({ item, children }: { item: PhotoItem; children: (src: string) => React.ReactNode }) {
  const src = useOrderPhoto(item);
  if (src === undefined) return <div className="h-28 w-full animate-pulse rounded-md bg-muted" aria-hidden />;
  return src ? <>{children(src)}</> : null;
}
