/**
 * The Ad studio's library: every photograph the house can put in an ad, from both places
 * it keeps them, with what the vision model made of each.
 *
 *   site   the pieces on the house's website (getSitePieces: named, linked, hidden ones
 *          left out), shown from the site's own public thumbnails
 *   drive  every image in the Google Drive folders shared with the ERP (drive.ts), shown
 *          through this server (/api/ads/studio/image), since Drive keeps them private
 *
 *   upload photographs prepared outside (re-cropped, upscaled, a product shot cut out) and
 *          kept in Firestore `studio_uploads`, one JPEG of at most ~900 KB a document (uploads.ts)
 *
 * An asset's id is `site:<piece id>`, `drive:<file id>` or `up:<upload id>`. Assessments live in Firestore
 * `ad_assets`, one document per asset under a hash of its id (a site id holds slashes);
 * `ad_studio_creatives` records what the studio made from which assets, so a photograph
 * already in an ad goes after the rest in the picks.
 *
 * Server-only.
 */

import { createHash } from 'crypto';
import sharp from 'sharp';
import { adminDb } from '@/lib/firebase-admin';
import { getSitePieces, getSitePiece, siteOrigin } from '@/lib/website/site-pieces';
import { STORE_POST_METAL } from '@/lib/store-config';
import { driveJpeg, driveLibrary } from './drive';
import { normalizeAssessment, type AssetAssessment } from './assessment';
import { pieceSpecs } from './specs';
import { originalsByShot, shotKey } from './originals';
import { listUploads, uploadJpeg } from './uploads';

export type AssetSource = 'site' | 'drive' | 'upload';

export interface StudioAsset {
  id: string;
  source: AssetSource;
  /** The piece id on the site, or the Drive file id. */
  key: string;
  name: string;
  /** The site's collection, or the Drive folder the photo sits in. */
  collection: string;
  /** Small picture for the grid (a public site thumbnail, or this server's). */
  thumb: string;
  /** The piece's page on the website, when it has one. */
  page: string | null;
  added: number | null;
  /** What the ERP knows of the piece — "21K Yellow Gold · Ruby · 45.35g" (specs.ts); empty for a Drive photo. */
  specs: string;
  /** A website photo's unmarked original in Drive, by its camera name (originals.ts): its asset id and file name. */
  original: { id: string; name: string } | null;
}

export interface StoredAssessment { assessment: AssetAssessment; model: string; at: string }

export const ASSETS = 'ad_assets';
export const CREATIVES = 'ad_studio_creatives';

export const docIdOf = (id: string) => createHash('sha1').update(id).digest('hex');
const imageUrl = (id: string, size: number) => `/api/ads/studio/image?id=${encodeURIComponent(id)}&size=${size}`;
const stem = (name: string) => name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').trim();
const lastFolder = (path: string) => path.split(' / ').pop() || path;

export type DriveSummary =
  | { ok: true; account: string; roots: { id: string; name: string }[]; images: number; videos: number; brand: number }
  | { ok: false; account: string; reason: 'api-disabled' | 'nothing-shared' | 'no-access' | 'error'; message: string; enableUrl?: string };

export interface Library {
  assets: StudioAsset[];
  drive: DriveSummary;
  siteError: string | null;
}

/** Both sources, newest first. */
export async function listAssets(opts: { fresh?: boolean } = {}): Promise<Library> {
  const [site, drive, uploads] = await Promise.all([
    getSitePieces({ fresh: opts.fresh }).then(r => ({ ok: true as const, ...r })).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) })),
    driveLibrary({ fresh: opts.fresh }),
    listUploads({ fresh: opts.fresh }).catch(() => []),
  ]);
  const assets: StudioAsset[] = [];
  for (const u of uploads) {
    assets.push({
      id: `up:${u.id}`, source: 'upload', key: u.id, name: u.name, collection: u.collection || 'Uploads',
      thumb: imageUrl(`up:${u.id}`, 480), page: u.page, added: u.added, specs: u.specs, original: null,
    });
  }
  const originals = drive.ok ? originalsByShot(drive.images.filter(i => !i.brand).map(i => ({ id: i.id, name: i.name, created: i.created ?? null }))) : new Map<string, { id: string; name: string }>();
  if (site.ok) {
    for (const p of site.pieces) {
      if (!p.thumb) continue;
      assets.push({
        id: `site:${p.id}`, source: 'site', key: p.id, name: p.name, collection: p.collection || 'Website',
        thumb: p.thumb, page: p.url || null, added: p.added,
        // taheri.shop tags karat, metal and stone; the Mina catalogue lists facts (stones, plating) and is all sterling silver.
        specs: p.source === 'pieces'
          ? [STORE_POST_METAL, ...p.facts.slice(0, 2), p.weightGrams ? `${p.weightGrams}g` : ''].filter(Boolean).join(' · ')
          : pieceSpecs({ karat: p.words.karat, metal: p.words.metal, stone: p.words.stone, weightGrams: p.weightGrams }),
        // The unmarked original: a Drive shoot of the same frame, else the catalogue's own source from before it was marked.
        original: (() => {
          const k = shotKey(p.id); const o = k ? originals.get(k) : undefined;
          if (o) return { id: `drive:${o.id}`, name: o.name };
          return p.photoSource && !p.sourceMarked ? { id: `source:${p.id}`, name: 'the catalogue’s photo before its mark' } : null;
        })(),
      });
    }
  }
  if (drive.ok) {
    for (const f of drive.images) {
      if (f.brand) continue;
      assets.push({
        id: `drive:${f.id}`, source: 'drive', key: f.id, name: stem(f.name), collection: lastFolder(f.folder),
        thumb: imageUrl(`drive:${f.id}`, 480), page: null, added: f.created ? Date.parse(f.created) || null : null, specs: '', original: null,
      });
    }
  }
  assets.sort((a, b) => (b.added ?? 0) - (a.added ?? 0));
  const driveSummary: DriveSummary = drive.ok
    ? { ok: true, account: drive.account, roots: drive.roots, images: drive.images.filter(i => !i.brand).length, videos: drive.videos, brand: drive.images.filter(i => i.brand).length }
    : { ok: false, account: drive.account, reason: drive.reason, message: drive.message, ...(drive.enableUrl ? { enableUrl: drive.enableUrl } : {}) };
  return { assets, drive: driveSummary, siteError: site.ok ? null : site.error };
}

/** The brand marks in the shared Drive (logos, wordmarks, monograms), for the maker. */
export async function driveBrandMarks(): Promise<{ id: string; name: string; folder: string }[]> {
  const lib = await driveLibrary();
  return lib.ok ? lib.images.filter(i => i.brand).map(i => ({ id: `drive:${i.id}`, name: stem(i.name), folder: i.folder })) : [];
}

let assessed: { at: number; map: Map<string, StoredAssessment> } | null = null;

/** Every stored assessment by asset id (cached thirty seconds). */
export async function loadAssessments(fresh = false): Promise<Map<string, StoredAssessment>> {
  if (!fresh && assessed && Date.now() - assessed.at < 30_000) return assessed.map;
  const snap = await adminDb.collection(ASSETS).get();
  const map = new Map<string, StoredAssessment>();
  for (const d of snap.docs) {
    const x = d.data() as { id?: string; assessment?: unknown; model?: string; at?: string };
    const a = normalizeAssessment(x.assessment);
    if (x.id && a) map.set(x.id, { assessment: a, model: x.model || '', at: x.at || '' });
  }
  assessed = { at: Date.now(), map };
  return map;
}

export async function saveAssessment(asset: Pick<StudioAsset, 'id' | 'source' | 'key' | 'name' | 'collection'>, assessment: AssetAssessment, model: string) {
  const row = { ...asset, assessment, model, at: new Date().toISOString() };
  await adminDb.collection(ASSETS).doc(docIdOf(asset.id)).set(row);
  if (assessed) assessed.map.set(asset.id, { assessment, model, at: row.at });
}

/** Asset ids the studio has already made an ad creative from. */
export async function usedAssetIds(): Promise<Set<string>> {
  const snap = await adminDb.collection(CREATIVES).orderBy('at', 'desc').limit(500).get().catch(() => null);
  const ids = new Set<string>();
  snap?.docs.forEach(d => ((d.data().assets as string[] | undefined) ?? []).forEach(id => ids.add(id)));
  return ids;
}

export async function recordCreative(row: { assets: string[]; hash: string; url?: string | null; format: string; name?: string; by: string }) {
  await adminDb.collection(CREATIVES).add({ ...row, at: new Date().toISOString() });
}

/**
 * An asset's photograph as a JPEG no larger than `size`, from its own source. A site
 * piece must be one the site lists (the address is the site's, never the request's).
 */
const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return ''; } };

export async function assetJpeg(id: string, size: number): Promise<Buffer> {
  const [source, ...rest] = id.split(':');
  const key = rest.join(':');
  if (source === 'drive') return driveJpeg(key, size);
  if (source === 'up') return uploadJpeg(key, size);
  if (source !== 'site' && source !== 'source') throw Object.assign(new Error('Unknown source.'), { status: 400 });
  const piece = await getSitePiece(key);
  if (!piece || !piece.image.startsWith(`${siteOrigin()}/`)) throw Object.assign(new Error('No such piece on the website.'), { status: 404 });
  // `source:` — the catalogue's photo from before it was marked (Shopify's CDN or the site's own catalog-src/), never any other host.
  const own = source === 'source' && piece.photoSource && (piece.photoSource.startsWith(`${siteOrigin()}/`) || /^cdn\.shopify\.com$/.test(hostOf(piece.photoSource))) ? piece.photoSource : null;
  if (source === 'source' && !own) throw Object.assign(new Error('No unmarked source for this piece.'), { status: 404 });
  const src = own ?? (size <= 720 && piece.thumb ? piece.thumb : piece.image);
  const res = await fetch(src, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw Object.assign(new Error(`The website didn’t send the photograph (${res.status}).`), { status: 502 });
  return sharp(Buffer.from(await res.arrayBuffer()), { failOn: 'none' })
    .rotate().flatten({ background: '#ffffff' })
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}
