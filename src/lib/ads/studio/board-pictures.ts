/**
 * The pictures in a board design (2026-10-12, owner: "let me edit any present text and picture from any of
 * the ads"). A design draws its own photo (the frame's `assetId`, under the document's `photo` id) and any
 * number of library pictures — image layers, or the background, whose photo id is `lib:<asset id>` (a
 * website or Drive photo, or an upload `up:<id>`). A picture uploaded in the designer is an image layer with
 * a data URL in `src`, which a board can't keep (cleanDoc drops it): on Save it is uploaded and rewritten
 * to `lib:up:<id>`. Pure: the page uses it, and it is tested.
 */

import type { ImageLayer, Layer, StoryDoc } from '@/lib/social/editor';

export const LIB = 'lib:';
/** The document's id for the design's own photo (templates.ts PHOTO). */
export const MAIN = 'photo';

export const libRef = (assetId: string) => `${LIB}${assetId}`;
export const assetOfRef = (ref: string): string | null => (ref.startsWith(LIB) && ref.length > LIB.length ? ref.slice(LIB.length) : null);

const isImage = (l: Layer): l is ImageLayer => l.kind === 'image';

/** Every library picture the design draws besides its own photo: `lib:` image layers and a `lib:` background. */
export function extraIds(doc: StoryDoc | null | undefined): string[] {
  if (!doc) return [];
  const ids = (doc.layers ?? []).flatMap(l => (isImage(l) && !l.src && assetOfRef(l.photoId) ? [l.photoId] : []));
  if (doc.bg?.photoId && assetOfRef(doc.bg.photoId)) ids.unshift(doc.bg.photoId);
  return [...new Set(ids)];
}

/** The distinct pictures uploaded in the designer (data URLs), in the order they appear. */
export function uploadSrcs(doc: StoryDoc | null | undefined): string[] {
  return [...new Set((doc?.layers ?? []).flatMap(l => (isImage(l) && l.src ? [l.src] : [])))];
}

/**
 * Each designer upload as the library picture it was saved as: `map` is src → asset id (`up:<id>`).
 * A layer whose src is in the map keeps everything (place, size, frame, crop) but becomes `lib:<asset id>`
 * with no src. Throws if any upload is left without one — a picture is never dropped silently.
 */
export function rewriteUploads(doc: StoryDoc, map: Record<string, string>): StoryDoc {
  const missing = uploadSrcs(doc).filter(s => !map[s]);
  if (missing.length) throw new Error(`${missing.length} uploaded picture${missing.length === 1 ? ' was' : 's were'} not saved.`);
  let changed = false;
  const layers = doc.layers.map(l => {
    if (!isImage(l) || !l.src) return l;
    changed = true;
    const { src, ...rest } = l;
    return { ...rest, photoId: libRef(map[src]) } as ImageLayer;
  });
  return changed ? { ...doc, layers } : doc;
}

export interface PictureState { doc: StoryDoc; assetId: string | null; marked: boolean }
/** Which picture: the design's own photo, or an image layer by id. */
export type PictureTarget = typeof MAIN | string;

/**
 * Put another picture in place of one. The design's own photo: the frame's asset changes and the document
 * doesn't, so its crop (placement) and everything over it stay. An image layer (an inset of the design's
 * photo, a library picture or an upload): it shows `lib:<asset id>`, keeping its place, size, frame and crop.
 * A `lib:` background is replaced the same way, its crop moved to the new id.
 */
export function replacePicture(s: PictureState, target: PictureTarget, pick: { assetId: string; marked?: boolean }): PictureState {
  if (target === MAIN) return { ...s, assetId: pick.assetId, marked: !!pick.marked };
  const ref = libRef(pick.assetId);
  if (target === 'bg') {
    const old = s.doc.bg.photoId;
    if (!old || old === MAIN) return { ...s, assetId: pick.assetId, marked: !!pick.marked };
    const placements = s.doc.placements ? { ...s.doc.placements } : undefined;
    if (placements && placements[old]) { placements[ref] = placements[old]; delete placements[old]; }
    return { ...s, doc: { ...s.doc, bg: { ...s.doc.bg, photoId: ref }, ...(placements ? { placements } : {}) } };
  }
  const i = s.doc.layers.findIndex(l => l.id === target);
  const l = s.doc.layers[i];
  if (!l || !isImage(l)) throw new Error('That picture isn’t on the design any more.');
  const { src: _src, ...rest } = l;
  const layers = s.doc.layers.slice();
  layers[i] = { ...rest, photoId: ref } as ImageLayer;
  return { ...s, doc: { ...s.doc, layers } };
}

export interface PictureSlot { target: PictureTarget; label: string; /** What it draws: `photo`, `lib:<id>`, or a data URL. */ shows: string }

/** The pictures on a design, for the editor's list: its own photo first, then a library background, then each image layer, top first. */
export function pictureSlots(doc: StoryDoc, hasMain: boolean): PictureSlot[] {
  const out: PictureSlot[] = [];
  if (hasMain) out.push({ target: MAIN, label: 'The photo', shows: MAIN });
  if (doc.bg.photoId && assetOfRef(doc.bg.photoId)) out.push({ target: 'bg', label: 'Background', shows: doc.bg.photoId });
  const images = doc.layers.filter(isImage).reverse();
  images.forEach((l, k) => out.push({
    target: l.id,
    label: l.name || (l.src ? 'Uploaded picture' : l.photoId === MAIN ? 'Inset of the photo' : l.mask ? 'Picture in a frame' : 'Picture') + (images.length > 1 ? ` ${images.length - k}` : ''),
    shows: l.src || l.photoId,
  }));
  return out;
}
