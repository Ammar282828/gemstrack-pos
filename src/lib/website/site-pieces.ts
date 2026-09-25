/**
 * The pieces on this house's own website, for posting one to the WhatsApp
 * community with its link (Posts → From the website).
 *
 * Two shapes, whichever the site publishes:
 *   /catalog-pieces.json      House of Mina's catalogue: every piece with its page,
 *                             photograph, collection, stones, plating and paragraph
 *   /catalog-attributes.json  taheri.shop: every photograph's tagger output, which
 *                             since 2026-09-25 carries its piece page's `path`; the
 *                             counter's weights (website_pieces) are merged in
 *
 * Only pieces with a page are offered: a post always carries a working link.
 * Cached ten minutes per instance, like the attributes themselves.
 *
 * Server-only.
 */

import { adminDb } from '@/lib/firebase-admin';
import { getCatalogAttributes } from '@/lib/website/catalog-source';
import { getPosWeights, mergeWeights } from '@/lib/website/weights';
import { collectionOfKey } from '@/lib/website/pricing';

export interface SitePiece {
  /** The site's own key: a photograph's path on taheri.shop, mina/piece/<handle> on the catalogue. */
  id: string;
  name: string;
  /** The piece page, in full. */
  url: string;
  image: string;
  thumb: string;
  collection: string;
  weightGrams: number | null;
  /** The photograph already shows the weight (taheri.shop's burned-in label), so it isn't stamped again. */
  weightOnPhoto: boolean;
  facts: string[];
  about: string;
}

const TTL_MS = 10 * 60 * 1000;
let cache: { at: number; site: string; pieces: SitePiece[] } | null = null;

export const siteOrigin = () => (process.env.WEBSITE_ORIGIN || process.env.NEXT_PUBLIC_STORE_WEBSITE_URL || '').trim().replace(/\/+$/, '');

type Published = { site?: string; pieces?: { id: string; name: string; path: string; image: string; thumb?: string; collection?: string; stones?: string[]; plating?: string[]; about?: string }[] };

/** "Rhodium", "Gold" → "rhodium or gold plated". */
const plated = (p: string[] = []) => (p.length ? `${p.map(x => x.toLowerCase()).join(' or ')} plated` : '');

async function fromCatalogPieces(site: string): Promise<SitePiece[] | null> {
  const res = await fetch(`${site}/catalog-pieces.json`, { cache: 'no-store', signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!res?.ok) return null;
  const d = (await res.json().catch(() => null)) as Published | null;
  if (!d?.pieces?.length) return null;
  const abs = (u: string) => (/^https?:\/\//.test(u) ? u : `${site}${u.startsWith('/') ? '' : '/'}${u}`);
  return d.pieces.filter(p => p.id && p.name && p.path && p.image).map(p => ({
    id: p.id, name: p.name, url: abs(p.path), image: abs(p.image), thumb: abs(p.thumb || p.image),
    collection: p.collection || '', weightGrams: null, weightOnPhoto: false,
    facts: [...(p.stones ?? []), plated(p.plating)].filter(Boolean),
    about: (p.about || '').trim(),
  }));
}

async function fromAttributes(site: string): Promise<SitePiece[]> {
  const [catalog, pos] = await Promise.all([getCatalogAttributes(), getPosWeights(true).catch(() => ({}))]);
  const merged = mergeWeights(catalog, pos);
  return Object.entries(merged)
    .filter(([, a]) => typeof (a as { path?: unknown }).path === 'string')
    .map(([key, a]) => {
      const x = a as typeof a & { name?: string; path: string };
      return {
        id: key,
        name: x.name || key.split('/').pop()!.replace(/\.webp$/i, ''),
        url: `${site}${x.path}`,
        image: `${site}/catalog-full/${encodeURI(key)}`,
        thumb: `${site}/catalog-thumb/${encodeURI(key)}`,
        collection: collectionOfKey(key),
        weightGrams: x.weightGrams ?? null,
        weightOnPhoto: x.weightSource === 'label',
        facts: [x.stone, x.cut, x.style].filter((f): f is string => !!f && !/^none$/i.test(f)),
        about: '',
      };
    });
}

export async function getSitePieces(): Promise<{ site: string; pieces: SitePiece[] }> {
  const site = siteOrigin();
  if (!site) return { site: '', pieces: [] };
  if (cache && cache.site === site && Date.now() - cache.at < TTL_MS) return cache;
  const pieces = (await fromCatalogPieces(site)) ?? (await fromAttributes(site));
  pieces.sort((a, b) => a.collection.localeCompare(b.collection) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  cache = { at: Date.now(), site, pieces };
  return cache;
}

export async function getSitePiece(id: string): Promise<SitePiece | null> {
  return (await getSitePieces()).pieces.find(p => p.id === id) ?? null;
}

/** When each website piece last went to WhatsApp (any group or the channel, from the send log), so a shuffle can skip the recent ones. */
export async function lastPosted(): Promise<Record<string, string>> {
  const snap = await adminDb.collection('social_posts').orderBy('at', 'desc').limit(1500).get();
  const out: Record<string, string> = {};
  for (const d of snap.docs) {
    const x = d.data() as { sitePiece?: string; at?: string; destination?: string };
    if (x.sitePiece && x.at && x.destination?.startsWith('whatsapp') && !out[x.sitePiece]) out[x.sitePiece] = x.at;
  }
  return out;
}
