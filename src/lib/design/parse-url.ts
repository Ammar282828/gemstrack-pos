/**
 * Smart input, links (plan §4.2): which kind of address was pasted, and what to read from it.
 * The router and the extractors are pure (tested); the two fetchers at the bottom are the only network,
 * and every hop of them goes through `publicUrl` (outside-image.ts) so the server is never a way into its
 * own network — redirects are followed by hand, each one checked.
 */

import { publicUrl, sharedImage } from '@/lib/ads/studio/outside-image';
import { folderIdOf } from '@/lib/ads/studio/drive-link';
import { pieceSpecs } from '@/lib/ads/studio/specs';
import { headlineOf } from '@/lib/website/site-photo';
import type { Fields } from '@/lib/social/editor';

export type UrlKind = 'house-site' | 'mina-catalogue' | 'shopify-product' | 'instagram' | 'drive' | 'generic' | 'invalid';

export interface UrlRoute { kind: UrlKind; url: URL | null; /** Shopify product handle. */ handle?: string; /** Drive folder id. */ folderId?: string }

const bare = (h: string) => h.toLowerCase().replace(/^www\./, '');
export const MINA_CATALOGUE_HOST = 'catalogue.houseofmina.store';

/** Where a pasted address goes. `siteUrl` is this house's website (NEXT_PUBLIC_STORE_WEBSITE_URL / WEBSITE_ORIGIN). */
export function classifyUrl(raw: string, siteUrl = ''): UrlRoute {
  const t = raw.trim();
  const u = publicUrl(/^[a-z]+:\/\//i.test(t) ? t : `https://${t}`);
  if (!u) return { kind: 'invalid', url: null };
  const host = bare(u.hostname);
  if (host === 'drive.google.com' || host === 'docs.google.com') {
    const folderId = folderIdOf(u.toString());
    if (folderId) return { kind: 'drive', url: u, folderId };
  }
  if (host === 'instagram.com' || host === 'instagr.am' || host.endsWith('.instagram.com')) return { kind: 'instagram', url: u };
  let site = '';
  try { site = siteUrl ? bare(new URL(siteUrl).hostname) : ''; } catch { /* none */ }
  if (host === MINA_CATALOGUE_HOST) return { kind: 'mina-catalogue', url: u };
  if (site && host === site) return { kind: 'house-site', url: u };
  const shop = u.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:collections\/[^/]+\/)?products\/([\w%.-]+?)(?:\.json|\.js)?\/?$/i);
  if (shop) return { kind: 'shopify-product', url: u, handle: shop[1] };
  return { kind: 'generic', url: u };
}

// ── Extractors ─────────────────────────────────────────────────────────────

const decode = (s: string) => s
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#x([\da-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/\s+/g, ' ').trim();

function metaContent(html: string, key: string): string {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (!new RegExp(`(?:property|name)=["']${key.replace(/:/g, '\\:')}["']`, 'i').test(tag)) continue;
    const c = tag.match(/content=("([^"]*)"|'([^']*)')/i);
    if (c) return decode(c[2] ?? c[3] ?? '');
  }
  return '';
}

export interface PageFacts { title: string; description: string; image: string | null }

/** og:title / og:description / og:image (the first of each the page has), else <title>. */
export function parseOg(html: string, base: URL): PageFacts {
  const title = metaContent(html, 'og:title') || metaContent(html, 'twitter:title') || decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const description = metaContent(html, 'og:description') || metaContent(html, 'twitter:description') || metaContent(html, 'description');
  return { title, description, image: sharedImage(html, base) };
}

/** An Instagram post's description is `123 likes, 4 comments - user on October 12, 2026: "the caption".`; the caption alone. */
export function instagramCaption(description: string): string {
  const m = description.match(/:\s*[“"]([\s\S]*?)[”"]\.?\s*$/);
  return (m ? m[1] : description).trim();
}

export interface ShopifyFacts { title: string; description: string; price: number | null; images: string[]; tags: string[]; vendor: string }

/** A Shopify product's `.json` (`{ product: { title, body_html, variants[], images[] } }`). */
export function parseShopifyProduct(json: unknown): ShopifyFacts | null {
  const p = (json as { product?: Record<string, unknown> } | null)?.product;
  if (!p || typeof p.title !== 'string') return null;
  const variants = Array.isArray(p.variants) ? p.variants as { price?: string }[] : [];
  const prices = variants.map(v => Number(v.price)).filter(n => Number.isFinite(n) && n > 0);
  const images = Array.isArray(p.images) ? (p.images as { src?: string }[]).map(i => i.src).filter((s): s is string => typeof s === 'string') : [];
  return {
    title: decode(p.title),
    description: decode(String(p.body_html ?? '').replace(/<\/(?:p|li|div|br)>/gi, '. ').replace(/<[^>]+>/g, ' ')),
    price: prices.length ? Math.min(...prices) : null,
    images,
    tags: typeof p.tags === 'string' ? p.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    vendor: typeof p.vendor === 'string' ? p.vendor : '',
  };
}

/** The part of a website address that names the piece, for matching against the site's own list. */
const keyOf = (s: string): string => { try { return new URL(s).pathname.replace(/\/+$/, '').toLowerCase(); } catch { return s.split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase(); } };

/** The listed website piece an address points to: by its page, or by the photograph's own path. */
export function matchSitePiece<P extends { id: string; url: string; image?: string }>(pieces: P[], address: string): P | null {
  const k = keyOf(address);
  if (!k || k === '') return null;
  return pieces.find(p => (p.url && keyOf(p.url) === k) || keyOf(p.id) === k || (p.image && keyOf(p.image) === k)) ?? null;
}

/** The fields of a listed website piece (the ERP's own facts, not guessed). */
export function pieceFields(p: { name: string; collection?: string; weightGrams: number | null; words?: { karat?: string; metal?: string; stone?: string } }): Partial<Fields> {
  const out: Partial<Fields> = {};
  const h = headlineOf(p.name);
  if (h) out.headline = h;
  const specs = pieceSpecs({ karat: p.words?.karat, metal: p.words?.metal, stone: p.words?.stone, weightGrams: p.weightGrams });
  if (specs) out.weight = specs;
  if (p.collection) out.kicker = p.collection;
  return out;
}

// ── The network (server only) ──────────────────────────────────────────────

const UA = 'Mozilla/5.0 (compatible; facebookexternalhit/1.1; +http://www.facebook.com/externalhit_uatext.php)';
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const HOPS = 4;

export class FetchError extends Error { constructor(message: string, public status = 502) { super(message); } }

/** GET with every redirect hop re-checked as a public address. */
async function guardedGet(start: URL, accept: string, timeoutMs: number): Promise<Response> {
  let u = start;
  for (let hop = 0; hop <= HOPS; hop++) {
    const res = await fetch(u, { headers: { 'User-Agent': UA, Accept: accept }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      let next: URL | null = null;
      try { next = loc ? publicUrl(new URL(loc, u).toString()) : null; } catch { next = null; }
      if (!next) throw new FetchError('That address sends to somewhere that can’t be read.', 422);
      u = next;
      continue;
    }
    return res;
  }
  throw new FetchError('That address redirects too many times.', 422);
}

async function readCapped(res: Response, max: number, what: string): Promise<Buffer> {
  const len = Number(res.headers.get('content-length') || 0);
  if (len > max) throw new FetchError(`${what} is over ${Math.round(max / 1048576)} MB.`, 413);
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => {}); throw new FetchError(`${what} is over ${Math.round(max / 1048576)} MB.`, 413); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** A page's text (at most 2 MB). */
export async function fetchPageText(u: URL): Promise<{ html: string; url: URL }> {
  const res = await guardedGet(u, 'text/html,application/json;q=0.9,*/*;q=0.5', 15_000);
  if (!res.ok) throw new FetchError(`That address answered ${res.status}.`, 502);
  return { html: (await readCapped(res, MAX_PAGE_BYTES, 'That page')).toString('utf8'), url: u };
}

/** One picture from an address: an image itself, or the picture the page shares. At most 25 MB; one at a time. */
export async function fetchPicture(u: URL): Promise<{ bytes: Buffer; type: string; from: URL }> {
  let res = await guardedGet(u, 'image/*,text/html;q=0.9,*/*;q=0.5', 20_000);
  if (!res.ok) throw new FetchError(`That address answered ${res.status}.`, 502);
  let from = u;
  let type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/')) {
    const html = (await readCapped(res, MAX_PAGE_BYTES, 'That page')).toString('utf8');
    const img = sharedImage(html, u);
    const iu = img ? publicUrl(img) : null;
    if (!iu) throw new FetchError('No picture found at that address. Instagram: open the post, Share, Copy link. Or save the photo and drop it in.', 422);
    res = await guardedGet(iu, 'image/*', 20_000);
    type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/')) throw new FetchError('The page’s picture could not be fetched. Save it and drop it in instead.', 502);
    from = iu;
  }
  return { bytes: await readCapped(res, MAX_IMAGE_BYTES, 'That picture'), type, from };
}
