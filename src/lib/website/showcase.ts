/**
 * The few pieces the link page shows under "Just in" (links.taheri.shop,
 * links.houseofmina.store): the site's new arrivals, a spread of them.
 *
 * The site lists newest first, and a drop is usually one collection at a time — on
 * 2026-09-29 Taheri's newest fourteen were all stone sets, Mina's ten all sets. Eight
 * of one thing reads as a catalogue page, not a house, so the pick goes round the
 * collections: the newest of each in turn, then the next of each, until it has enough.
 * Only pieces with a page, a picture and a real name: an unnamed drop is still called
 * by its file's name ("DSC09342", "Untitled design").
 */

export interface ShowcasePiece {
  id: string;
  name: string;
  url: string;
  thumb: string;
  collection: string;
  newArrival: boolean;
}

/**
 * A file's name, not a piece's: the camera's ("DSC09342", "IMG_2041"), a design tool's
 * default ("Untitled design (3)" — taheri.shop had one in Diamond Sets on 2026-09-29),
 * a phone's ("Screenshot 2026-…", "WhatsApp Image …"). Better left out than shown.
 */
const cameraName = /^[a-z_]{0,4}\d{3,}$|^untitled(?:[\s-]+design)?(?:[\s-]*\(?\d+\)?)?$|^screenshot\b|^whatsapp image\b|^img[_-]?\d/i;

export function pickShowcase<T extends ShowcasePiece>(pieces: readonly T[], count = 8): T[] {
  const shown = pieces.filter(p => p.url && p.thumb && p.name.trim() && !cameraName.test(p.name.trim()));
  const fresh = shown.filter(p => p.newArrival);
  // A quiet month: the newest two dozen stand in for the new arrivals.
  const pool = fresh.length >= count ? fresh : shown.slice(0, Math.max(24, count));

  const byCollection = new Map<string, T[]>();
  for (const p of pool) {
    const key = p.collection || '';
    const list = byCollection.get(key);
    if (list) list.push(p);
    else byCollection.set(key, [p]);
  }
  const lists = [...byCollection.values()];
  const out: T[] = [];
  for (let round = 0; out.length < count; round++) {
    let took = false;
    for (const list of lists) {
      if (round < list.length && out.length < count) { out.push(list[round]); took = true; }
    }
    if (!took) break;
  }
  return out;
}
