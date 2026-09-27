/**
 * A website piece's photograph re-made in the square editor: the layouts each
 * house's photos can take, the one a design starts on, and the small line under
 * the name. Shared by Website → Edit a piece and Posts → From the website (the
 * owner, 2026-09-27: "for post a piece from the website, add an ability to crop
 * the photo or redesign etc like the rest of the space").
 */

import type { SquarePresetId } from './editor';

export type House = 'taheri' | 'mina';
export interface SiteLayout { id: SquarePresetId; label: string }

/**
 * The layouts a house's website photo offers, each with the house's own mark:
 * taheri.shop's wordmark top right (rings) or bottom right (chains), and the t
 * where the house has one; the catalogue's MINA mark top right.
 */
export function siteLayouts(house: House, monogram: boolean): SiteLayout[] {
  return house === 'mina' ? [
    { id: 'clean', label: 'Nothing added' },
    { id: 'mark', label: 'MINA mark' },
    { id: 'catalogue-top', label: 'Weight + MINA' },
    { id: 'weight', label: 'Weight' },
    { id: 'name', label: 'Name, weight + mark' },
  ] : [
    { id: 'clean', label: 'Nothing added' },
    { id: 'weight', label: 'Weight' },
    { id: 'catalogue-top', label: 'Weight + logo, top' },
    { id: 'catalogue', label: 'Weight + logo, bottom' },
    ...(monogram ? [{ id: 'catalogue-t' as const, label: 'Weight + t' }] : []),
    { id: 'name', label: 'Name, weight + logo' },
  ];
}

/**
 * The layout a design starts on. The catalogue's photo comes to the editor from
 * before the catalogue marked it, so the MINA mark goes back on; any other photo
 * starts with nothing added, as taheri.shop's carry the house's marks already.
 * `weightOn`: the page was stamping the weight, so the design keeps it.
 */
export function siteStartLayout(house: House, p: { photoSource: string | null; sourceMarked: boolean }, weightOn = false): SquarePresetId {
  const mark = house === 'mina' && !!p.photoSource && !p.sourceMarked;
  if (mark) return weightOn ? 'catalogue-top' : 'mark';
  return weightOn ? 'weight' : 'clean';
}

/** The layouts that show the weight: a stamp, or in the line under the name (siteDetailsLine). */
export const showsWeight = (id: SquarePresetId) => id !== 'clean' && id !== 'mark';

/**
 * The small line under a website piece's name — "21K Yellow Gold | 12.4g": the
 * house's metal (none for The Maisons, the great houses' own pieces) and the weight.
 */
export function siteDetailsLine(collection: string, metal: string, weight: string): string {
  return [/maison/i.test(collection) ? '' : metal, weight].filter(Boolean).join(' | ');
}
