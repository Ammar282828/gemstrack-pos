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
import { ORDER_PHOTOS, itemPhotoRef, itemPhotoRefs, type ExtraPhoto } from '@/lib/order-photos';
import { PhotoLightbox } from '@/components/order/photo-lightbox';

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

type PhotoItem = { sampleImageDataUri?: string; samplePhotoId?: string; extraPhotos?: ExtraPhoto[] } | null | undefined;

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

/** All of a piece's reference photos, as images, in order (those still being read are left out until they arrive). */
export function useItemPhotos(item: PhotoItem): string[] {
  const refs = itemPhotoRefs(item);
  const key = refs.map(r => r.src ? `s${r.src.length}:${r.src.slice(-24)}` : `i${r.id}`).join('|');
  const [loaded, setLoaded] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let live = true;
    for (const r of refs) {
      if (r.id && !r.src) void loadOrderPhoto(r.id).then(v => { if (live) setLoaded(m => (m[r.id!] === v ? m : { ...m, [r.id!]: v })); });
    }
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- key stands for refs
  return refs.map(r => r.src ?? (r.id ? loaded[r.id] : null)).filter((v): v is string => !!v);
}

/**
 * A piece's reference photos as a row of thumbnails; a tap opens the full-screen viewer on that one.
 * `size` is the thumbnail's edge in px; `cover` crops to fill (the bench card) instead of fitting.
 */
export function ItemPhotos({ item, size = 96, cover, title, className }: { item: PhotoItem; size?: number; cover?: boolean; title?: string; className?: string }) {
  const photos = useItemPhotos(item);
  const [open, setOpen] = useState<number | null>(null);
  const expected = itemPhotoRefs(item).length;
  if (!expected) return null;
  return (
    <>
      <div className={`flex flex-wrap gap-2 ${className ?? ''}`}>
        {photos.length === 0 && <div style={{ width: size, height: size }} className="animate-pulse rounded-md bg-muted" aria-hidden />}
        {photos.map((src, i) => (
          <button key={i} type="button" onClick={() => setOpen(i)} aria-label={`Open reference photo ${i + 1} of ${photos.length}`}
            style={{ width: size, height: size }} className="relative flex-shrink-0 overflow-hidden rounded-md border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element -- data: URI */}
            <img src={src} alt="" className={`h-full w-full ${cover ? 'object-cover' : 'object-contain'}`} loading="lazy" decoding="async" />
          </button>
        ))}
      </div>
      {open !== null && <PhotoLightbox photos={photos} index={open} onIndex={setOpen} onClose={() => setOpen(null)} title={title} />}
    </>
  );
}
