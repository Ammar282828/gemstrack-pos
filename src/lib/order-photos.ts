/**
 * Order sample photos live in their own documents (`order_photos/<id>`), and an order's item keeps
 * only `samplePhotoId` (2026-10-01, "why is every update so slow").
 *
 * They used to sit inside the order, base64: 2.65 MB of Taheri's 2.71 MB of orders were 23 photos,
 * the biggest order 471 KB. Every touch of an order — ticking a piece done, assigning a karigar, an
 * advance, an edit — rewrote its whole `items` array, photos and all, from the counter's phone to
 * Iowa, and every open device then pulled the whole document back. A photo is now written once,
 * when it is added, and read only where it is shown.
 *
 * `sampleImageDataUri` stays for what is not a photo upload (a stock piece's image URL) and for an
 * order not yet moved (scripts/move-order-photos.mjs); readers take either.
 */

export const ORDER_PHOTOS = 'order_photos';

export interface OrderPhotoDoc { dataUri: string; orderId?: string; createdAt: string }

/** A photo carried inline (base64), as opposed to a URL or nothing. */
export const isInlinePhoto = (v: unknown): v is string => typeof v === 'string' && v.startsWith('data:');

export const newPhotoId = () => `photo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type PhotoItem = { sampleImageDataUri?: string; samplePhotoId?: string };

/**
 * Items with each inline photo swapped for the id of a document of its own, and those documents to
 * write — written with the order, in the same commit. Items without one are returned as they are.
 */
export function splitItemPhotos<I extends PhotoItem>(items: readonly I[], makeId: () => string = newPhotoId): { items: I[]; photos: { id: string; dataUri: string }[] } {
  const photos: { id: string; dataUri: string }[] = [];
  const out = items.map(item => {
    if (!item || !isInlinePhoto(item.sampleImageDataUri)) return item;
    const id = makeId();
    photos.push({ id, dataUri: item.sampleImageDataUri });
    const { sampleImageDataUri: _moved, ...rest } = item;
    return { ...rest, samplePhotoId: id } as I;
  });
  return { items: out, photos };
}

/** What to show for an item: its own image (URL, or a photo not yet moved), else its photo document's. */
export const itemPhotoRef = (item: PhotoItem | null | undefined): { src?: string; id?: string } =>
  !item ? {} : item.sampleImageDataUri ? { src: item.sampleImageDataUri } : item.samplePhotoId ? { id: item.samplePhotoId } : {};
