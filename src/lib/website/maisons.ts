/**
 * The Maisons — the great houses' own pieces the shop sells (Cartier, Van Cleef
 * & Arpels, Tiffany & Co. …), a collection of their own on taheri.shop
 * (Wristwear/The Maisons). A piece added from the counter carries its house and
 * official name in its file name, which is how the site reads them before the
 * catalogue is rebuilt:
 *
 *   "Cartier — LOVE Bracelet, Classic.jpg"
 *   "Tiffany and Co — Tiffany T Wire Bracelet 2.jpg"   (a second photo)
 *
 * "&" is written "and": an "&" never reaches a file name, because the site's
 * image URLs leave it unescaped. The site's side of this is maisonFromStem() in
 * taheri-site/src/lib/collections.js; the house list must match it.
 */

export const MAISON_HOUSES = [
  'Cartier', 'Van Cleef & Arpels', 'Tiffany & Co.', 'Chaumet', 'Bulgari', 'Louis Vuitton',
  'Dior', 'Chanel', 'Messika', 'Hermès', 'Graff', 'Boucheron', 'Piaget', 'Chopard',
] as const;

/** "Wristwear/The Maisons" — a folder whose collection is The Maisons. */
export const isMaisonFolder = (folder: string | undefined | null) => /(^|\/)The Maisons$/.test(String(folder || ''));

/** The house as a file name may carry it: "Tiffany & Co." → "Tiffany and Co". */
const houseForFile = (house: string) => house.replace(/&/g, 'and').replace(/[.#?%/\\]+/g, '').replace(/\s+/g, ' ').trim();

/** The model as a file name may carry it: no path characters, no & # ? %. */
const modelForFile = (model: string) => model.replace(/&/g, ' and ').replace(/[#?%/\\:*"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * A Maisons photograph's file name. `index` 0 is the piece's first photo;
 * later ones are numbered " 2", " 3"… (the site ignores the number).
 */
export function maisonFileName(house: string, model: string, index = 0, ext = 'jpg'): string {
  const base = `${houseForFile(house)} — ${modelForFile(model)}`;
  return `${base}${index > 0 ? ` ${index + 1}` : ''}.${ext.replace(/^\./, '') || 'jpg'}`;
}

/** The full name as the site shows it: "Cartier LOVE Bracelet, Classic" (the house said once). */
export const maisonFullName = (house: string, model: string) =>
  (model.trim().startsWith(house.split(' ')[0]) ? model.trim() : `${house} ${model.trim()}`);
