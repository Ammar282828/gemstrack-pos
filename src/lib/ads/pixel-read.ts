/**
 * The website pixel, read without Meta: which pixels a site's page carries, and what a pixel's
 * weekly event counts mean. Pure (pixel.ts does the fetching), so it is tested.
 */

/** Fired in the last week: website ads can buy page views and audiences can be built from visitors. */
export const firedRecently = (lastFired: string | null, now = Date.now()) => !!lastFired && now - Date.parse(lastFired) < 7 * 86_400_000;

/**
 * Every Meta pixel id a page carries: the classic `fbq('init', '…')` snippet and Shopify's web-pixel
 * settings (`"pixel_id":"…"`, escaped inside the page's JSON).
 */
export function pixelIdsIn(html: string): string[] {
  const ids = new Set<string>();
  for (const m of html.matchAll(/fbq\(\s*['"]init['"]\s*,\s*['"](\d{8,20})['"]/g)) ids.add(m[1]);
  for (const m of html.matchAll(/pixel_?id\\*["']\s*:\s*\\*["'](\d{8,20})/gi)) ids.add(m[1]);
  return [...ids];
}

/** The page loads this ERP's pixel loader (taheri.shop reads the chosen id from /api/public/pixel). */
export const hasLoader = (html: string) => /\/api\/public\/pixel/.test(html);

/** Meta's `/stats?aggregation=event` buckets, summed per event name. */
export function eventCounts(buckets: { data?: { value?: string; count?: number }[] }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of buckets) for (const e of b.data ?? []) if (e.value) out[e.value] = (out[e.value] ?? 0) + (Number(e.count) || 0);
  return out;
}


/** Meta learns an ad set's delivery from about 50 of its results a week. */
export const LEARNS_FROM = 50;

/** Whether "Online orders" has purchases to learn from: none, few (it may stay in learning), enough. */
export function salesReadiness(events: Record<string, number> | null): { purchases: number | null; level: 'unknown' | 'none' | 'few' | 'enough' } {
  if (!events) return { purchases: null, level: 'unknown' };
  const purchases = events.Purchase ?? 0;
  return { purchases, level: purchases === 0 ? 'none' : purchases < LEARNS_FROM ? 'few' : 'enough' };
}
