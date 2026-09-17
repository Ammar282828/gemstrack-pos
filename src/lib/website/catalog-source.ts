/**
 * The site publishes its tagger's output — metal, stone, cut, style, and the
 * weight read off each photograph — at /catalog-attributes.json. The POS reads
 * that file, never the values a browser sends in a request: a price must come
 * from what the shop published, not from what a customer's page claims.
 *
 * Cached in memory for ten minutes per instance. The file changes only when
 * the site is rebuilt, and a stale read costs at worst a quote at last week's
 * weight for a piece whose weight does not change.
 */

import type { PieceAttrs } from './types';

const TTL_MS = 10 * 60 * 1000;

let cache: { at: number; images: Record<string, PieceAttrs> } | null = null;

export function catalogUrl(): string {
  if (process.env.WEBSITE_CATALOG_URL) return process.env.WEBSITE_CATALOG_URL;
  const site = (process.env.WEBSITE_ORIGIN || 'https://taheri.shop').replace(/\/+$/, '');
  return `${site}/catalog-attributes.json`;
}

export async function getCatalogAttributes(): Promise<Record<string, PieceAttrs>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.images;
  const res = await fetch(catalogUrl(), { cache: 'no-store' });
  if (!res.ok) {
    if (cache) return cache.images;               // serve stale over serving nothing
    throw new Error(`catalog attributes unavailable: ${res.status} from ${catalogUrl()}`);
  }
  const data = (await res.json()) as { images?: Record<string, PieceAttrs> };
  cache = { at: Date.now(), images: data.images || {} };
  return cache.images;
}

/** For tests and for the settings screen's "reload" button. */
export function primeCatalogAttributes(images: Record<string, PieceAttrs>): void {
  cache = { at: Date.now(), images };
}

/** Normalise what the site sends to the key the manifest uses. */
export function normalisePieceKey(raw: string): string {
  let key = String(raw || '').trim();
  try { key = decodeURIComponent(key); } catch { /* already decoded */ }
  key = key.replace(/^https?:\/\/[^/]+/, '').replace(/^\/?catalog-(?:thumb|full)\//, '');
  return key.replace(/\.(avif|jpe?g|png)$/i, '.webp');
}
