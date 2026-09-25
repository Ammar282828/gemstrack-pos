/**
 * A photograph to this house's website: forwarded to `<site>/api/upload.php`
 * with WEBSITE_UPLOAD_SECRET (the site trusts only this server). Used by Add
 * Photos' relay (/api/website/photos) and by Post a Piece's queue, which sends
 * a piece's photos when its time comes.
 *
 * Server-only.
 */

import { collectionOfKey } from '@/lib/website/pricing';

export const siteOrigin = () => (process.env.WEBSITE_ORIGIN || 'https://taheri.shop').replace(/\/+$/, '');

/** An upload refused or failed, with the HTTP status the route should answer with. */
export class SiteUploadError extends Error {
  constructor(message: string, public status: number, public detail?: string) { super(message); }
}

export interface SiteUpload { rel: string; bytes: unknown; thumb: string; collection: string }

/** `folder` is "Category/Collection"; `base` the file name as it should appear ("Bangle and Ring.jpg"). */
export async function uploadToSite(body: Blob, folder: string, base: string): Promise<SiteUpload> {
  const secret = process.env.WEBSITE_UPLOAD_SECRET;
  if (!secret) throw new SiteUploadError('Photo uploads are not configured. Set WEBSITE_UPLOAD_SECRET on both the POS and the website.', 503);
  const out = new FormData();
  out.set('rel', `${folder}/${base}`);
  out.set('file', body, base);
  let res: Response;
  try {
    res = await fetch(`${siteOrigin()}/api/upload.php`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      body: out,
      signal: AbortSignal.timeout(55_000),
    });
  } catch (e) {
    throw new SiteUploadError(e instanceof Error && e.name === 'TimeoutError'
      ? 'The website did not answer in time. The photograph may still have arrived — check the collection before retrying.'
      : e instanceof Error ? e.message : 'Upload failed', 504);
  }
  const text = await res.text();
  let data: Record<string, unknown>;
  try { data = JSON.parse(text); }
  catch { throw new SiteUploadError(`The website returned an unexpected reply (${res.status}).`, 502, text.slice(0, 200)); }
  if (!res.ok || data.ok !== true) {
    throw new SiteUploadError(String(data.error || `Upload refused (${res.status}).`), res.status === 401 ? 502 : res.status);
  }
  return { rel: String(data.rel), bytes: data.bytes, thumb: `${siteOrigin()}${data.thumb}`, collection: collectionOfKey(String(data.rel)) };
}
