/**
 * The website pixel (the research of 2026-09-29: taheri.shop carries none, while at least nine
 * rival sites do — so Meta can't retarget someone who looked at a piece, build an audience of
 * them, or buy page views instead of clicks).
 *
 * The ad account's pixels (Meta calls them datasets) are listed or one is made here; the chosen
 * one is kept in `app_settings/meta_ads.pixelId`; the website loads it from `/api/public/pixel`.
 * Whether it works is what Meta says it last received (`last_fired_time`) — plus a look at the
 * site's own page for the loader.
 *
 * Server-only.
 */

import { graph, graphAll } from './meta';
import { requireAccount, loadAdsSettings } from './settings';
import { STORE_LINKS } from '@/lib/store-config';

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

/** Fired in the last week: website ads can buy page views and audiences can be built from visitors. */
export const firedRecently = (lastFired: string | null, now = Date.now()) => !!lastFired && now - Date.parse(lastFired) < 7 * 86_400_000;

export interface PixelState { id: string | null; lastFired: string | null; live: boolean; onSite: boolean | null; site: string | null }

/** The chosen pixel: when it last fired, and whether the website's page loads it. */
export async function pixelState(): Promise<PixelState> {
  const s = await loadAdsSettings();
  const site = STORE_LINKS.website || null;
  if (!s.pixelId) return { id: null, lastFired: null, live: false, onSite: null, site };
  const [px, html] = await Promise.all([
    graph<{ last_fired_time?: string }>(s.pixelId, { params: { fields: 'last_fired_time' } }).catch(() => ({} as { last_fired_time?: string })),
    site ? fetch(site, { signal: AbortSignal.timeout(8000), cache: 'no-store' }).then(r => (r.ok ? r.text() : '')).catch(() => '') : Promise.resolve(''),
  ]);
  const lastFired = px.last_fired_time ?? null;
  const onSite = html ? /connect\.facebook\.net|fbq\(|\/api\/public\/pixel/.test(html) : null;
  return { id: s.pixelId, lastFired, live: firedRecently(lastFired), onSite, site };
}
