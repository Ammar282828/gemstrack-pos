/**
 * The website pixel (the research of 2026-09-29: taheri.shop carries none, while at least nine
 * rival sites do — so Meta can't retarget someone who looked at a piece, build an audience of
 * them, or buy page views instead of clicks).
 *
 * The ad account's pixels (Meta calls them datasets) are listed or one is made here; the chosen
 * one is kept in `app_settings/meta_ads.pixelId`; taheri.shop loads it from `/api/public/pixel`.
 * Whether it works is what Meta says it last received (`last_fired_time`) — plus a look at the
 * pages of every site the house sells from (its website and its online shop) for the pixels
 * they already carry. House of Mina's Shopify store carries one through Shopify's Facebook &
 * Instagram app (a web pixel, not `fbq`): choosing that one, rather than making a second,
 * keeps every visit and order in one place. The events it received this week (`/stats`) say
 * whether "Online orders" has purchases to learn from.
 *
 * Server-only.
 */

import { graph, graphAll } from './meta';
import { requireAccount, loadAdsSettings } from './settings';
import { STORE_LINKS } from '@/lib/store-config';
import { eventCounts, firedRecently, hasLoader, pixelIdsIn } from './pixel-read';

export { eventCounts, firedRecently, hasLoader, pixelIdsIn } from './pixel-read';

export interface PixelRow { id: string; name: string; lastFired: string | null; unavailable: boolean }

export async function listPixels(): Promise<PixelRow[]> {
  const { act } = await requireAccount();
  const rows = await graphAll<{ id: string; name?: string; last_fired_time?: string; is_unavailable?: boolean }>(`${act}/adspixels`, { fields: 'id,name,last_fired_time,is_unavailable' }, 50);
  return rows.map(r => ({ id: r.id, name: r.name ?? r.id, lastFired: r.last_fired_time ?? null, unavailable: !!r.is_unavailable }));
}

export async function createPixel(name: string): Promise<string> {
  const { act } = await requireAccount();
  const d = await graph<{ id: string }>(`${act}/adspixels`, { method: 'POST', params: { name: name.slice(0, 100) } });
  return d.id;
}

/** A site the house sells from, and the pixels its front page carries (null: the page couldn't be read). */
export interface SitePixels { url: string; ids: string[] | null; loader: boolean }

export interface PixelState {
  id: string | null; lastFired: string | null; live: boolean;
  /** The chosen pixel is on one of the sites (by id or through the loader); null when no page could be read. */
  onSite: boolean | null;
  site: string | null;
  sites: SitePixels[];
  /** What the chosen pixel received in the last 7 days, by event name (Purchase, AddToCart…); null if Meta wouldn't say. */
  events: Record<string, number> | null;
}

/** The website and the online shop, once each. */
export const sellingSites = () => [...new Set([STORE_LINKS.shop, STORE_LINKS.website].map(u => (u || '').trim().replace(/\/+$/, '')).filter(Boolean))];

async function readSite(url: string): Promise<SitePixels> {
  const html = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store', headers: { 'user-agent': 'Mozilla/5.0 (compatible; ERP pixel check)' } })
    .then(r => (r.ok ? r.text() : null)).catch(() => null);
  return html === null ? { url, ids: null, loader: false } : { url, ids: pixelIdsIn(html), loader: hasLoader(html) };
}

/** The chosen pixel: when it last fired, what it received this week, and which sites carry which pixels. */
export async function pixelState(): Promise<PixelState> {
  const s = await loadAdsSettings();
  const urls = sellingSites();
  const sitesP = Promise.all(urls.map(readSite));
  if (!s.pixelId) {
    const sites = await sitesP;
    return { id: null, lastFired: null, live: false, onSite: null, site: urls[0] ?? null, sites, events: null };
  }
  const since = Math.floor(Date.now() / 1000) - 7 * 86_400;
  const [px, sites, events] = await Promise.all([
    graph<{ last_fired_time?: string }>(s.pixelId, { params: { fields: 'last_fired_time' } }).catch(() => ({} as { last_fired_time?: string })),
    sitesP,
    graphAll<{ data?: { value?: string; count?: number }[] }>(`${s.pixelId}/stats`, { aggregation: 'event', start_time: String(since) }, 400).then(eventCounts).catch(() => null),
  ]);
  const lastFired = px.last_fired_time ?? null;
  const read = sites.filter(x => x.ids !== null);
  const carrying = read.find(x => x.loader || x.ids!.includes(s.pixelId!));
  const onSite = read.length ? !!carrying : null;
  return { id: s.pixelId, lastFired, live: firedRecently(lastFired), onSite, site: carrying?.url ?? urls[0] ?? null, sites, events };
}
