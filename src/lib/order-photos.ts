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

/**
 * Several reference photos per piece (2026-10-30, owner: "more than one picture reference in orders").
 * The FIRST photo stays exactly where it always was (`sampleImageDataUri` / `samplePhotoId` /
 * `samplePhotoHash`), so every older app and reader keeps showing it; photos 2..n are `extraPhotos`,
 * each `{ id, hash }` pointing at a document of its own (one per photo: Firestore's 1 MiB limit).
 * Writers may send an extra inline as `{ dataUri }`; it is split out in the same commit.
 */
export const MAX_PIECE_PHOTOS = 8;
export interface ExtraPhoto { id?: string; dataUri?: string; hash?: string }

type PhotoItem = { sampleImageDataUri?: string; samplePhotoId?: string; samplePhotoHash?: string; extraPhotos?: ExtraPhoto[] };

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

export type SplitPhoto = { id: string; dataUri: string; hash: string };

/**
 * Items with each inline photo swapped for the id of a document of its own, and those documents to
 * write — written with the order, in the same commit. Items without one are returned as they are.
 *
 * A save is idempotent: an item that already points at a photo document (`samplePhotoId`) and sends
 * the same picture again (`samplePhotoHash` matches — an old inline copy of it, the staff copy, a
 * phone that holds the picture) keeps its document and writes nothing. A different picture gets a
 * new document, and the id it replaced is returned in `replaced` for the caller to delete in the
 * same commit. The same goes for each of `extraPhotos` (photos 2..n of the piece, at most
 * MAX_PIECE_PHOTOS in all; an empty entry is dropped).
 */
export function splitItemPhotos<I extends PhotoItem>(items: readonly I[], makeId: () => string = newPhotoId): { items: I[]; photos: SplitPhoto[]; replaced: string[] } {
  const photos: SplitPhoto[] = [];
  const replaced: string[] = [];
  const out = items.map(original => {
    if (!original) return original;
    // No first picture but others: the next one becomes the main one, which is where older readers look
    // (a phone takes the first off and sends only that).
    let item: I = original;
    const spare = (Array.isArray(original.extraPhotos) ? original.extraPhotos : []).filter(e => e && (e.id || e.dataUri));
    if (!original.sampleImageDataUri && !original.samplePhotoId && spare.length) {
      const [head, ...tail] = spare;
      item = { ...original, extraPhotos: tail, ...(head.id ? { sampleImageDataUri: undefined, samplePhotoId: head.id, samplePhotoHash: head.hash } : { sampleImageDataUri: head.dataUri, samplePhotoId: undefined, samplePhotoHash: undefined }) };
    }
    let next: PhotoItem = item;
    if (isInlinePhoto(item.sampleImageDataUri)) {
      const hash = photoHash(item.sampleImageDataUri);
      const { sampleImageDataUri: uri, ...rest } = item;
      if (item.samplePhotoId && item.samplePhotoHash === hash) next = rest;
      else {
        if (item.samplePhotoId) replaced.push(item.samplePhotoId);
        const id = makeId();
        photos.push({ id, dataUri: uri as string, hash });
        next = { ...rest, samplePhotoId: id, samplePhotoHash: hash };
      }
    }
    if (Array.isArray(item.extraPhotos)) {
      const extras: ExtraPhoto[] = [];
      for (const ex of item.extraPhotos) {
        if (!ex || extras.length >= MAX_PIECE_PHOTOS - 1) continue;
        if (isInlinePhoto(ex.dataUri)) {
          const hash = photoHash(ex.dataUri);
          if (ex.id && ex.hash === hash) { extras.push({ id: ex.id, hash }); continue; }
          if (ex.id) replaced.push(ex.id);
          const id = makeId();
          photos.push({ id, dataUri: ex.dataUri, hash });
          extras.push({ id, hash });
        } else if (ex.id) extras.push(ex.hash ? { id: ex.id, hash: ex.hash } : { id: ex.id });
        else if (typeof ex.dataUri === 'string' && ex.dataUri) extras.push({ dataUri: ex.dataUri }); // a URL (a stock piece's picture)
      }
      const { extraPhotos: _drop, ...rest } = next;
      next = extras.length ? { ...rest, extraPhotos: extras } : rest;
    }
    return next as unknown as I;
  });
  return { items: out, photos, replaced };
}

/** Every photo document an item points at: the first photo's, then the extras'. */
export const itemPhotoIds = (item: PhotoItem | null | undefined): string[] =>
  !item ? [] : [item.samplePhotoId, ...(Array.isArray(item.extraPhotos) ? item.extraPhotos.map(e => e?.id) : [])].filter((v): v is string => !!v);

/**
 * Photo documents the order pointed at before an edit and no longer does (the picture was replaced
 * or taken off): delete them in the edit's commit so they do not pile up. Ids are minted per save
 * and never shared between orders, so an id an order let go of is nobody else's.
 */
export function droppedPhotoIds(before: readonly PhotoItem[] | null | undefined, after: readonly PhotoItem[]): string[] {
  const kept = new Set(after.flatMap(itemPhotoIds));
  return [...new Set((before ?? []).flatMap(itemPhotoIds).filter(id => !kept.has(id)))];
}

/** What to show for an item: its own image (URL, or a photo not yet moved), else its photo document's. */
export const itemPhotoRef = (item: PhotoItem | null | undefined): { src?: string; id?: string } =>
  !item ? {} : item.sampleImageDataUri ? { src: item.sampleImageDataUri } : item.samplePhotoId ? { id: item.samplePhotoId } : {};

/**
 * All of a piece's reference photos, in order: the first as `itemPhotoRef` has it, then the extras.
 * An order with one photo (every order made before 2026-10-30) is a list of one.
 */
export const itemPhotoRefs = (item: PhotoItem | null | undefined): { src?: string; id?: string }[] => {
  if (!item) return [];
  const first = itemPhotoRef(item);
  const rest = (Array.isArray(item.extraPhotos) ? item.extraPhotos : [])
    .map((e): { src?: string; id?: string } => (e?.dataUri ? { src: e.dataUri } : e?.id ? { id: e.id } : {}))
    .filter(r => r.src || r.id);
  return [...(first.src || first.id ? [first] : []), ...rest].slice(0, MAX_PIECE_PHOTOS);
};
