/**
 * The Maisons' file names for a whole tray of photographs, as Add photos gives them
 * (src/app/website/photos/page.tsx `fileNameFor`): each photo is "<House> — <Model>",
 * and a second or third photo of the same piece in the tray is numbered " 2", " 3".
 * "The same piece" is the same house and the same name, ignoring case and spaces at
 * the ends, counted in the tray's order (photos already sent from it included, so a
 * photo added later still numbers after them).
 *
 * The phone sends its tray here (/api/website/photos/names) rather than keeping a copy
 * of the rule: the site reads the house and the name back out of the file name
 * (maisons.ts), so there is one way to write it.
 */

import { MAISON_HOUSES, maisonFileName } from '@/lib/website/maisons';

export interface MaisonItem { house: string; model: string; ext?: string }

/** Why a tray can't be named yet, or null when every photo has its house and its name. */
export function maisonTrayProblem(items: MaisonItem[]): string | null {
  const houses = MAISON_HOUSES as readonly string[];
  const unnamed = items.filter(i => !houses.includes(i.house) || !i.model.trim()).length;
  if (!unnamed) return null;
  return `${unnamed} photograph${unnamed === 1 ? '' : 's'} still need${unnamed === 1 ? 's' : ''} a house and the model’s official name.`;
}

const same = (a: MaisonItem, b: MaisonItem) =>
  a.house === b.house && a.model.trim().toLowerCase() === b.model.trim().toLowerCase();

/** Every photo's file name, in the tray's order. */
export function maisonBatchNames(items: MaisonItem[]): string[] {
  return items.map((item, i) => {
    const index = items.slice(0, i).filter(other => same(other, item)).length;
    const ext = (item.ext || 'jpg').replace(/^\./, '').toLowerCase() || 'jpg';
    return maisonFileName(item.house, item.model.trim(), index, ext);
  });
}
