/**
 * Which addresses the catalogue image route may fetch: the website's own host only (WEBSITE_ORIGIN), https,
 * no credentials, no other port, under its catalogue folders or its CDN. Anything else is refused: the route
 * must not become a way to make the server fetch arbitrary addresses.
 */

export function catalogueImageUrl(src: string, siteOrigin: string): URL | null {
  let site: URL;
  let u: URL;
  try { site = new URL(siteOrigin); u = new URL(src); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  if (site.protocol !== 'https:' || u.host !== site.host) return null;
  // Not a path that climbs, and not a page: a picture's file name.
  if (/(^|\/)\.\.(\/|$)/.test(decodeURIComponent(u.pathname))) return null;
  if (!/\.(webp|jpe?g|png|gif|avif)$/i.test(u.pathname)) return null;
  return u;
}
