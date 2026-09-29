/**
 * The pieces on this house's own website, for posting one to the WhatsApp
 * community with its link (Posts → From the website).
 *
 * Two shapes, whichever the site publishes:
 *   /catalog-pieces.json      House of Mina's catalogue: every piece with its page,
 *                             photograph, collection, stones, plating and paragraph
 *   /catalog-attributes.json  taheri.shop: every photograph's tagger output, which
 *                             since 2026-09-25 carries its piece page's `path`; the
 *                             counter's weights (website_pieces) are merged in; and
 *                             /api/catalog.php's drops not yet adopted (`drop`), whose
 *                             page taheri.shop's api/piece.php serves at dropPath()
 *
 * Only pieces with a page are offered: a post always carries a working link.
 * Newest first, each marked if it is one of the site's new arrivals (new-arrivals.ts),
 * which the page opens on.
 * Both lists carry the site's own words; the counter's changes to a piece
 * (Website → Edit a piece: site-edits.ts) are laid over them here, live, so a
 * renamed piece posts under its new name and a hidden one isn't offered.
 * The site's list is cached ten minutes per instance, like the attributes
 * themselves; the counter's changes thirty seconds.
 *
 * Server-only.
 */

import { adminDb } from '@/lib/firebase-admin';
import { getCatalogAttributes } from '@/lib/website/catalog-source';
import { getPosWeights, mergeWeights } from '@/lib/website/weights';
import { collectionOfKey } from '@/lib/website/pricing';
import { byNewest, newArrivalIds } from '@/lib/website/new-arrivals';
import { getSiteOverrides, imagePathOf, type SiteOverride } from '@/lib/website/site-edits';
import { dropPath } from '@/lib/website/drop-path';

/** What the site says about a piece, as the editor shows it: the catalogue's paragraphs and facts, or taheri.shop's tags. */
export interface PieceWords {
  name: string;
  about: string;
  facts: string[];
  stone?: string;
  metal?: string;
  karat?: string;
  cut?: string;
  style?: string;
}

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
  /** When it went on the site (epoch ms), if the site says. */
  added: number | null;
  newArrival: boolean;
  /** The photograph's path under catalog-full/ (or the drop folder's, same key), which a re-made one replaces. */
  imagePath: string | null;
  /** Still in taheri.shop's drop folder: on the site, not yet in its attributes; its page is served by the site's api/piece.php. */
  drop?: boolean;
  /** Which list it came from: the catalogue's pieces (paragraphs, facts) or taheri.shop's photographs (tags, counter weights). */
  source: 'pieces' | 'attributes';
  /**
   * The photograph before the site framed and marked it (the catalogue's Shopify or
   * catalog-src/ original), which the editor starts from; `sourceMarked` when that
   * already carries a mark of its own. None on taheri.shop, whose photos are uploaded as they are.
   */
  photoSource: string | null;
  sourceMarked: boolean;
  /** The site's own words, and the same with the counter's changes laid over. */
  own: PieceWords;
  words: PieceWords;
  /** The counter's change, if any (site-edits.ts). */
  change: SiteOverride | null;
  hidden: boolean;
}

const TTL_MS = 10 * 60 * 1000;
let cache: { at: number; site: string; pieces: Listed[] } | null = null;
/** A piece as the site lists it, before the counter's changes. */
type Listed = Omit<SitePiece, 'words' | 'change' | 'hidden'>;

export const siteOrigin = () => (process.env.WEBSITE_ORIGIN || process.env.NEXT_PUBLIC_STORE_WEBSITE_URL || '').trim().replace(/\/+$/, '');

type Published = { site?: string; pieces?: { id: string; name: string; path: string; image: string; thumb?: string; collection?: string; stones?: string[]; plating?: string[]; about?: string; story?: string[]; facts?: string[]; source?: string; marked?: boolean; added?: string | null; newArrival?: boolean }[] };

/** "Rhodium", "Gold" → "rhodium or gold plated". */
const plated = (p: string[] = []) => (p.length ? `${p.map(x => x.toLowerCase()).join(' or ')} plated` : '');

async function fromCatalogPieces(site: string): Promise<Listed[] | null> {
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
    added: p.added ? Date.parse(p.added) || null : null,
    newArrival: !!p.newArrival,
    imagePath: imagePathOf(abs(p.image), site),
    source: 'pieces' as const,
    photoSource: p.source ? abs(p.source) : null,
    sourceMarked: !!p.marked,
    // A catalogue built before 2026-09-27 lists one paragraph and no facts.
    own: { name: p.name, about: (p.story?.length ? p.story : [p.about || '']).join('\n\n').trim(), facts: p.facts ?? [] },
  }));
}

/** A tag worth showing: "None" is the tagger's word for nothing. */
const tag = (v: unknown) => (typeof v === 'string' && v.trim() && !/^none$/i.test(v.trim()) ? v.trim() : '');

type Drop = { p: string; t?: number; thumb: string; full: string };


/** taheri.shop's drop folder (api/catalog.php): photographs on the site that its attributes don't list until they are adopted. */
async function dropsOf(site: string): Promise<Drop[]> {
  const res = await fetch(`${site}/api/catalog.php`, { cache: 'no-store', signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!res?.ok) return [];
  const d = (await res.json().catch(() => null)) as { images?: Drop[] } | null;
  return (d?.images ?? []).filter(i => typeof i?.p === 'string' && typeof i.thumb === 'string' && typeof i.full === 'string');
}

async function fromAttributes(site: string): Promise<Listed[]> {
  // Never the counter's weights cached: a weight typed a moment ago shows at once.
  const [catalog, pos, drops] = await Promise.all([getCatalogAttributes({ own: true }), getPosWeights(true).catch(() => ({})), dropsOf(site)]);
  const merged = mergeWeights(catalog, pos);
  const abs = (u: string) => (/^https?:\/\//.test(u) ? u : `${site}${u.startsWith('/') ? '' : '/'}${u}`);
  // A drop is keyed like the photograph it becomes ("…/DSC09213.jpg" → "…/DSC09213.webp"); an adopted one is listed below.
  const dropped: Listed[] = drops.map(dr => ({ dr, key: dr.p.replace(/\.[^./]+$/, '.webp') }))
    .filter(({ key }) => !merged[key])
    .map(({ dr, key }) => {
      const name = key.split('/').pop()!.replace(/\.webp$/i, '');
      const path = dropPath(key);
      return {
        id: key, name, url: path ? `${site}${path}` : '', image: abs(dr.full), thumb: abs(dr.thumb), collection: collectionOfKey(key),
        weightGrams: null, weightOnPhoto: false, facts: [], about: '',
        added: typeof dr.t === 'number' && dr.t > 0 ? dr.t * 1000 : null, newArrival: false,
        imagePath: key, drop: true, source: 'attributes' as const, photoSource: null, sourceMarked: false,
        own: { name, about: '', facts: [], stone: '', metal: '', karat: '', cut: '', style: '' },
      };
    });
  // Every photograph, those without a page too (url ""): one hidden at the counter
  // has no page once the site is rebuilt, and must still be found to show it again.
  return [...dropped, ...Object.entries(merged).map(([key, a]) => {
    const x = a as typeof a & { name?: string; path?: string; added?: number; karat?: string };
    const name = x.name || key.split('/').pop()!.replace(/\.webp$/i, '');
    return {
      id: key,
      name,
      url: typeof x.path === 'string' ? `${site}${x.path}` : '',
      image: `${site}/catalog-full/${encodeURI(key)}`,
      thumb: `${site}/catalog-thumb/${encodeURI(key)}`,
      collection: collectionOfKey(key),
      weightGrams: x.weightGrams ?? null,
      weightOnPhoto: x.weightSource === 'label',
      facts: [x.stone, x.cut, x.style].map(tag).filter(Boolean),
      about: '',
      added: typeof x.added === 'number' ? x.added * 1000 : null,
      newArrival: false,
      imagePath: key,
      source: 'attributes' as const,
      photoSource: null,
      sourceMarked: false,
      own: { name, about: '', facts: [], stone: tag(x.stone), metal: tag(x.metal), karat: tag(x.karat), cut: tag(x.cut), style: tag(x.style) },
    };
  })];
}

/** A piece with the counter's change laid over what the site says. */
function withChange(p: Listed, o: SiteOverride | undefined): SitePiece {
  if (!o) return { ...p, words: p.own, change: null, hidden: false };
  const pick = (k: 'stone' | 'metal' | 'karat' | 'cut' | 'style') => (typeof o[k] === 'string' ? o[k] : p.own[k]);
  const words: PieceWords = {
    name: o.name?.trim() || p.own.name,
    about: typeof o.about === 'string' ? o.about : p.own.about,
    facts: Array.isArray(o.facts) ? o.facts : p.own.facts,
    ...(p.source === 'attributes' ? { stone: pick('stone'), metal: pick('metal'), karat: pick('karat'), cut: pick('cut'), style: pick('style') } : {}),
  };
  // A re-made photograph keeps its address; its version makes every browser fetch it again.
  const v = o.photo?.v && o.photo.image === p.imagePath ? o.photo.v : '';
  const bust = (u: string) => (v ? `${u}${u.includes('?') ? '&' : '?'}e=${v}` : u);
  return {
    ...p,
    name: words.name,
    // A caption takes the first paragraph.
    about: words.about.split(/\n\s*\n/)[0]?.trim() ?? '',
    facts: p.source === 'attributes' ? [words.stone, words.cut, words.style].map(tag).filter(Boolean) : p.facts,
    // Mina's weights live with its changes (the catalogue has none of its own).
    weightGrams: p.source === 'pieces' && typeof o.weightGrams === 'number' ? o.weightGrams : p.weightGrams,
    weightOnPhoto: p.weightOnPhoto || !!o.weightOnPhoto,
    image: bust(p.image),
    thumb: bust(p.thumb),
    words,
    change: o,
    hidden: !!o.hidden,
  };
}

/** After a weight is typed: the next read lists the site again. */
export function forgetSitePieces() { cache = null; }

async function listed(site: string): Promise<Listed[]> {
  if (cache && cache.site === site && Date.now() - cache.at < TTL_MS) return cache.pieces;
  const all = (await fromCatalogPieces(site)) ?? (await fromAttributes(site));
  const fresh = newArrivalIds(all.filter(p => p.url));
  const pieces = all.map(p => ({ ...p, newArrival: fresh.has(p.id) })).sort(byNewest);
  cache = { at: Date.now(), site, pieces };
  return pieces;
}

/**
 * The website's pieces with the counter's changes. Posting sees only what the
 * site shows (a page, not hidden); the editor (`all`) sees every piece, hidden
 * ones and those without a page included.
 */
export async function getSitePieces(opts: { all?: boolean; fresh?: boolean } = {}): Promise<{ site: string; pieces: SitePiece[] }> {
  const site = siteOrigin();
  if (!site) return { site: '', pieces: [] };
  const [list, changes] = await Promise.all([listed(site), getSiteOverrides(site, opts.fresh)]);
  const pieces = list.map(p => withChange(p, changes[p.id]))
    .filter(p => opts.all ? p.url || p.hidden || p.change || p.drop : p.url && !p.hidden);
  return { site, pieces };
}

export async function getSitePiece(id: string, opts: { all?: boolean; fresh?: boolean } = {}): Promise<SitePiece | null> {
  return (await getSitePieces(opts)).pieces.find(p => p.id === id) ?? null;
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
