/**
 * A piece from the house's website as an Instagram story (Posts → From the website;
 * the owner, 2026-09-26: "from the website should also let me send to instagram story").
 *
 * The site's photograph is square and already carries the house's marks, so the
 * story keeps it whole instead of cropping it to 9:16: the house's mark and the
 * piece's name above it, the metal and weight below, all inside Instagram's safe
 * area (the top ~250 px and bottom ~380 px sit under its own bars). The colours
 * follow the house: Taheri's forest green on cream, Mina's rose on near-black.
 *
 * Drawn by the story editor's own renderer (editor.ts), so fonts, marks and
 * lettering match the stories made in Post a Piece. Browser-only.
 */

import { type Assets, type Fields, type ImageLayer, type StoryDoc, emptyDoc, newLayerId, newWordmark, textLayer, renderDocTo } from '@/lib/social/editor';
import { canvasToJpeg } from '@/lib/social/story';

/** The id the site photo goes under in Assets.photos. */
export const SITE_STORY_PHOTO = 'site';

export interface HouseColours { ground: string; headline: string; body: string; mark: string }
export const HOUSE_STORY_COLOURS: Record<'taheri' | 'mina', HouseColours> = {
  taheri: { ground: '#EDE6DA', headline: '#1F4A2C', body: '#7A5A35', mark: '#111111' },
  mina: { ground: '#140B0B', headline: '#E8A5AE', body: '#F4EFE6', mark: '#FFFFFF' },
};

/** The story's layers: mark, name, the square photo whole, then metal · weight. `markRatio` is the mark's height / width (0 = no mark). */
export function siteStoryDoc(c: HouseColours, markRatio: number): StoryDoc {
  const photo: ImageLayer = {
    id: newLayerId('image'), kind: 'image', photoId: SITE_STORY_PHOTO,
    x: 90, y: 560, w: 900, h: 900, radius: 28, border: null, shadow: true, rotate: 0, opacity: 1,
  };
  // A wide wordmark is 300 wide; a squarer logo (Mina's) is held to 110 tall so the name still fits above the photo.
  const markW = markRatio > 0 ? Math.min(300, 110 / markRatio) : 0;
  const markBottom = markRatio > 0 ? 270 + markW * markRatio : 300;
  const mark = { ...newWordmark(c.mark), x: 540 - markW / 2, y: 270, width: markW };
  return {
    ...emptyDoc(null),
    bg: { ...emptyDoc(null).bg, color: c.ground },
    layers: [
      ...(markRatio > 0 ? [mark] : []),
      // Two lines of the name at most fit above the photo; fit shrinks a long one.
      textLayer({ bind: 'headline', x: 540, y: Math.round(markBottom + 30), size: 96, font: 'condensed', color: c.headline, align: 'center', width: 960, fit: true, lineHeight: 0.92 }),
      photo,
      textLayer({ bind: 'details', x: 540, y: 1500, size: 46, font: 'regular', color: c.body, align: 'center', width: 960, lineHeight: 1.2 }),
    ],
  };
}

/** The finished 1080 × 1920 JPEG. */
export async function siteStoryJpeg(photo: HTMLImageElement, fields: Pick<Fields, 'headline' | 'details'>, a: Omit<Assets, 'photos'>, c: HouseColours): Promise<Blob> {
  const assets: Assets = { ...a, photos: { [SITE_STORY_PHOTO]: photo } };
  const all: Fields = { kicker: '', weight: '', ...fields };
  const m = a.marks.wordmark;
  const ratio = m && m.naturalWidth ? m.naturalHeight / m.naturalWidth : 0;
  return canvasToJpeg(renderDocTo(siteStoryDoc(c, ratio), all, assets, 1080), 0.92);
}
