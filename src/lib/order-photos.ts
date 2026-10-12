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

export interface OrderPhotoDoc { dataUri: string; orderId?: string; createdAt: string; hash?: string }

/** A photo carried inline (base64), as opposed to a URL or nothing. */
export const isInlinePhoto = (v: unknown): v is string => typeof v === 'string' && v.startsWith('data:');

export const newPhotoId = () => `photo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type PhotoItem = { sampleImageDataUri?: string; samplePhotoId?: string; samplePhotoHash?: string };

/**
 * A fingerprint of a photo's bytes (two 53-bit cyrb53 passes and the length), synchronous so the
 * browser and the server compute the same one. It tells "the same picture sent again" from "a new
 * picture" without reading the stored document; it is not a security hash.
 */
export function photoHash(s: string): string {
  const pass = (seed: number) => {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  };
  return `${pass(0)}${pass(7)}-${s.length.toString(36)}`;
}

/**
 * Items with each inline photo swapped for the id of a document of its own, and those documents to
 * write — written with the order, in the same commit. Items without one are returned as they are.
 *
 * A save is idempotent: an item that already points at a photo document (`samplePhotoId`) and sends
 * the same picture again (`samplePhotoHash` matches — an old inline copy of it, the staff copy, a
 * phone that holds the picture) keeps its document and writes nothing. A different picture gets a
 * new document, and the id it replaced is returned in `replaced` for the caller to delete in the
 * same commit.
 */
export function splitItemPhotos<I extends PhotoItem>(items: readonly I[], makeId: () => string = newPhotoId): { items: I[]; photos: { id: string; dataUri: string; hash: string }[]; replaced: string[] } {
  const photos: { id: string; dataUri: string; hash: string }[] = [];
  const replaced: string[] = [];
  const out = items.map(item => {
    if (!item || !isInlinePhoto(item.sampleImageDataUri)) return item;
    const hash = photoHash(item.sampleImageDataUri);
    const { sampleImageDataUri: uri, ...rest } = item;
    if (item.samplePhotoId && item.samplePhotoHash === hash) return rest as unknown as I;
    if (item.samplePhotoId) replaced.push(item.samplePhotoId);
    const id = makeId();
    photos.push({ id, dataUri: uri as string, hash });
    return { ...rest, samplePhotoId: id, samplePhotoHash: hash } as unknown as I;
  });
  return { items: out, photos, replaced };
}

/**
 * Photo documents the order pointed at before an edit and no longer does (the picture was replaced
 * or taken off): delete them in the edit's commit so they do not pile up. Ids are minted per save
 * and never shared between orders, so an id an order let go of is nobody else's.
 */
export function droppedPhotoIds(before: readonly PhotoItem[] | null | undefined, after: readonly PhotoItem[]): string[] {
  const kept = new Set(after.map(i => i?.samplePhotoId).filter(Boolean));
  return [...new Set((before ?? []).map(i => i?.samplePhotoId).filter((id): id is string => !!id && !kept.has(id)))];
}

/** What to show for an item: its own image (URL, or a photo not yet moved), else its photo document's. */
export const itemPhotoRef = (item: PhotoItem | null | undefined): { src?: string; id?: string } =>
  !item ? {} : item.sampleImageDataUri ? { src: item.sampleImageDataUri } : item.samplePhotoId ? { id: item.samplePhotoId } : {};
