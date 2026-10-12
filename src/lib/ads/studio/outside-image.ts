/** Fetching a picture from outside the shop for the Studio board (/api/ads/studio/fetch-image). */

/** A public web address: no local or private host (the server must not be a way into its own network). */
export function publicUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h.includes('.') || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return null;
  }
  if (h.includes(':')) return null; // IPv6 literals: none needed
  return u;
}

/** The picture a page shares: og:image, else twitter:image. */
export function sharedImage(html: string, base: URL): string | null {
  for (const key of ['og:image:secure_url', 'og:image', 'twitter:image']) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key.replace(/:/g, '\\:')}["'][^>]*>`, 'i');
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content=["']([^"']+)["']/i)?.[1];
    if (content) { try { return new URL(content.replace(/&amp;/g, '&'), base).toString(); } catch { /* next */ } }
  }
  return null;
}
