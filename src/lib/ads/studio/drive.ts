/**
 * Taheri's photographs in the owner's Google Drive, for the Ad studio.
 *
 * No folder ids to keep in step: whatever is shared with this ERP's service account
 * (Viewer is enough) is the library — each shared folder and everything beneath it. The
 * owner shares "taheri content" (the shoots) and it appears; unshares it and it goes. Two
 * things have to be true once, and the studio's Setup card checks both live:
 *   1. the Google Drive API is enabled in the ERP's own project, and
 *   2. the folders are shared with the runtime service account.
 *
 * Files are read with the ERP's own credentials (application default: the App Hosting
 * runtime account in production), read-only scope. Logos and wordmarks (a file or folder
 * named like one) are kept apart as brand marks, not ad photographs. Listing is cached ten
 * minutes per instance; a photo is fetched on demand and resized with sharp (HEIC first
 * through heic-convert, as the other upload routes do).
 *
 * Server-only.
 */

import { GoogleAuth } from 'google-auth-library';
import sharp from 'sharp';
import convertHeic from 'heic-convert';

const gauth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
const API = 'https://www.googleapis.com/drive/v3';
const TTL_MS = 10 * 60 * 1000;
const MAX_FOLDERS = 400;
const MAX_FILES = 6000;

export interface DriveImage {
  id: string;
  name: string;
  /** The folder path under the shared root, e.g. "taheri content / Bangle and Ring Shoot". */
  folder: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  bytes: number;
  created: string | null;
  modified: string | null;
  /** A logo, wordmark or monogram: offered as a mark in the maker, never assessed as a photo. */
  brand: boolean;
}

export type DriveLibrary =
  | { ok: true; account: string; roots: { id: string; name: string }[]; images: DriveImage[]; videos: number; at: number }
  | { ok: false; account: string; reason: 'api-disabled' | 'nothing-shared' | 'no-access' | 'error'; message: string; enableUrl?: string; at: number };

class DriveError extends Error {
  constructor(message: string, public status: number, public reason: string, public enableUrl?: string) { super(message); }
}

let cache: DriveLibrary | null = null;

async function token(): Promise<string> {
  const t = (await (await gauth.getClient()).getAccessToken()).token;
  if (!t) throw new DriveError('No Google credentials on this server.', 500, 'no-access');
  return t;
}

/** The address to share folders with: the service account this server runs as. */
export async function driveAccount(): Promise<string> {
  try { return (await gauth.getCredentials()).client_email || ''; } catch { return ''; }
}

async function driveGet<T>(path: string, params: Record<string, string>, tok?: string): Promise<T> {
  const q = new URLSearchParams({ supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...params });
  const res = await fetch(`${API}${path}?${q}`, {
    headers: { Authorization: `Bearer ${tok ?? await token()}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.ok) return res.json() as Promise<T>;
  const body = await res.json().catch(() => ({})) as { error?: { message?: string; details?: { metadata?: { activationUrl?: string } }[]; errors?: { reason?: string }[] } };
  const msg = body.error?.message || `Drive answered ${res.status}`;
  if (res.status === 403 && /has not been used|is disabled/i.test(msg)) {
    const url = body.error?.details?.find(d => d.metadata?.activationUrl)?.metadata?.activationUrl
      || msg.match(/https:\/\/console\.developers\.google\.com\/\S+/)?.[0]?.replace(/[.,)]+$/, '');
    throw new DriveError(msg, 403, 'api-disabled', url);
  }
  throw new DriveError(msg, res.status, res.status === 404 || res.status === 403 ? 'no-access' : 'error');
}

type RawFile = {
  id: string; name: string; mimeType: string; size?: string; createdTime?: string; modifiedTime?: string;
  imageMediaMetadata?: { width?: number; height?: number };
};
const FILE_FIELDS = 'nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,imageMediaMetadata(width,height))';
const FOLDER = 'application/vnd.google-apps.folder';
const brandName = (s: string) => /\b(logo|logos|wordmark|monogram|lockup|brand ?kit)\b/i.test(s);

async function listAll(q: string, tok: string): Promise<RawFile[]> {
  const out: RawFile[] = [];
  let pageToken = '';
  do {
    const page = await driveGet<{ files?: RawFile[]; nextPageToken?: string }>('/files', {
      q, fields: FILE_FIELDS, pageSize: '1000', ...(pageToken ? { pageToken } : {}),
    }, tok);
    out.push(...(page.files ?? []));
    pageToken = page.nextPageToken ?? '';
  } while (pageToken && out.length < MAX_FILES);
  return out;
}

/** Every image in every folder shared with this server, newest first. */
export async function driveLibrary(opts: { fresh?: boolean } = {}): Promise<DriveLibrary> {
  if (!opts.fresh && cache && Date.now() - cache.at < TTL_MS) return cache;
  const account = await driveAccount();
  try {
    const tok = await token();
    const shared = await listAll('sharedWithMe = true and trashed = false', tok);
    const roots = shared.filter(f => f.mimeType === FOLDER);
    const images: DriveImage[] = [];
    let videos = 0;
    const take = (f: RawFile, folder: string, inBrand: boolean) => {
      if (f.mimeType.startsWith('video/')) { videos++; return; }
      if (!f.mimeType.startsWith('image/')) return;
      images.push({
        id: f.id, name: f.name, folder, mimeType: f.mimeType,
        width: f.imageMediaMetadata?.width ?? null, height: f.imageMediaMetadata?.height ?? null,
        bytes: Number(f.size) || 0, created: f.createdTime ?? null, modified: f.modifiedTime ?? null,
        brand: inBrand || brandName(f.name) || f.mimeType === 'image/svg+xml',
      });
    };
    shared.filter(f => f.mimeType !== FOLDER).forEach(f => take(f, 'Shared with the ERP', false));

    // Breadth first, a level at a time, so a deep tree cannot starve a wide one.
    let level = roots.map(r => ({ id: r.id, path: r.name, brand: brandName(r.name) }));
    const seen = new Set<string>();
    while (level.length && seen.size < MAX_FOLDERS && images.length < MAX_FILES) {
      const next: typeof level = [];
      for (let i = 0; i < level.length; i += 6) {
        const batch = level.slice(i, i + 6).filter(f => !seen.has(f.id));
        batch.forEach(f => seen.add(f.id));
        const lists = await Promise.all(batch.map(f => listAll(`'${f.id}' in parents and trashed = false`, tok)));
        lists.forEach((files, j) => {
          const parent = batch[j];
          for (const f of files) {
            if (f.mimeType === FOLDER) next.push({ id: f.id, path: `${parent.path} / ${f.name}`, brand: parent.brand || brandName(f.name) });
            else take(f, parent.path, parent.brand);
          }
        });
      }
      level = next;
    }
    images.sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''));
    cache = roots.length || images.length
      ? { ok: true, account, roots: roots.map(r => ({ id: r.id, name: r.name })), images, videos, at: Date.now() }
      : { ok: false, account, reason: 'nothing-shared', message: 'Nothing in Google Drive is shared with the ERP yet.', at: Date.now() };
    return cache;
  } catch (e) {
    const d = e instanceof DriveError ? e : null;
    cache = {
      ok: false, account,
      reason: (d?.reason as 'api-disabled' | 'no-access' | 'error') || 'error',
      message: e instanceof Error ? e.message : String(e),
      ...(d?.enableUrl ? { enableUrl: d.enableUrl } : {}),
      at: Date.now(),
    };
    return cache;
  }
}

/** One Drive image as a JPEG no wider or taller than `size`, for the studio's grid, the model and the canvas. */
export async function driveJpeg(fileId: string, size: number): Promise<Buffer> {
  const lib = await driveLibrary();
  const file = lib.ok ? lib.images.find(i => i.id === fileId) : undefined;
  if (!file) throw new DriveError('Not in the shared library.', 404, 'no-access');
  const res = await fetch(`${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${await token()}` },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new DriveError(`Drive answered ${res.status} for the photo.`, res.status, 'error');
  let buf = Buffer.from(await res.arrayBuffer());
  if (/heic|heif/i.test(file.mimeType) || /\.(heic|heif)$/i.test(file.name)) {
    buf = Buffer.from(await convertHeic({ buffer: buf, format: 'JPEG', quality: 0.92 }));
  }
  return sharp(buf, { failOn: 'none' })
    .rotate()
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();
}

export { DriveError };
