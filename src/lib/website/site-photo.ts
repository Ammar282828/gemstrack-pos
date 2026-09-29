/**
 * A photograph taken from the house's website into Post a Piece (owner, 2026-09-29: "for post a
 * piece let me add any pic from the website and then fix it up there").
 *
 * Pure: which photograph to fetch, what the piece's name and marks mean for the page. The page
 * does the fetching (through /api/website/site-pieces/image — the website doesn't let a browser
 * read its images across origins).
 */

/** What the page keeps about where a photo came from (and a draft keeps with it). */
export interface SiteFrom {
  /** The site's key for the piece (a photograph's path on taheri.shop, mina/piece/<handle> on the catalogue). */
  id: string;
  name: string;
  /** Its page, for the caption's link. Empty for a piece with no page. */
  url: string;
  /** The photograph already carries the house's marks (taheri.shop's wordmark and weight, the MINA mark). */
  marked: boolean;
}

/** The fields of a listed website piece this needs (SitePiece in site-pieces.ts). */
export interface SitePieceLike {
  id: string;
  name: string;
  url: string;
  photoSource: string | null;
  sourceMarked: boolean;
}

/**
 * The query for its photograph. Where the site keeps the photo from before it framed and marked
 * it (the Mina catalogue's Shopify or catalog-src/ original) that one comes, so the post's own
 * layout puts the mark on once; taheri.shop's photos are uploaded as they are, so its photo as
 * the site shows it. At the site's full size: the website square is made at up to 3000 px.
 */
export function sitePhotoQuery(p: SitePieceLike): string {
  const q = new URLSearchParams({ id: p.id, size: '3000' });
  if (p.photoSource) q.set('original', '1');
  return q.toString();
}

export function siteFrom(p: SitePieceLike): SiteFrom {
  return { id: p.id, name: p.name, url: p.url, marked: p.photoSource ? p.sourceMarked : true };
}

/**
 * The piece's name as a headline, or '' when it is only a camera file name (a new upload the
 * counter hasn't named yet is listed as "DSC09213").
 */
export function headlineOf(name: string): string {
  const n = name.trim();
  if (!n || /^(dsc|img|pxl|photo|image|mvimg|whatsapp image)[\s_-]*[\d_ -]*$/i.test(n) || /^[\d\s_-]+$/.test(n)) return '';
  return n;
}
