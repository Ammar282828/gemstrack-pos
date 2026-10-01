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
 * minutes per instance. A photo is fetched on demand **at the size asked for, resized by Drive**
 * (each file's `thumbnailLink` answers `=s<px>` up to the original's size, and renders HEIC
 * and Photoshop files too), so the server never holds a shoot's original: the "TC" folder's
 * 4000-px PNGs are 13–25 MB each, and ten of them decoded at once took a 512 MiB instance past
 * its limit on every five-minute tick of 2026-10-01, killing the counter's and the website's
 * requests that shared it. Only a file Drive has no preview for is downloaded whole (HEIC
 * through heic-convert, as the other upload routes do), and never one over 40 MB.
 *
 * Server-only.
 */

import { GoogleAuth } from 'google-auth-library';
import { adminDb } from '@/lib/firebase-admin';
import { folderIdOf } from './drive-link';
import sharp from 'sharp';
import convertHeic from 'heic-convert';

const gauth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
const API = 'https://www.googleapis.com/drive/v3';
const TTL_MS = 10 * 60 * 1000;
const MAX_FOLDERS = 400;
const MAX_FILES = 6000;
/** An original downloaded whole (no preview from Drive) is refused above this. */
const MAX_ORIGINAL_BYTES = 40 * 1024 * 1024;
/** What sharp (and heic-convert) can decode from an original; anything else needs Drive's preview. */
const DECODABLE = /^image\/(jpeg|pjpeg|png|webp|gif|tiff|avif|heic|heif|svg\+xml)$/i;

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
/** Each image's Drive preview link, server-side only (it opens a private file to anyone holding it). */
const previews = new Map<string, string>();
/** The next listing reads Drive afresh (a folder was added or taken away). */
export const forgetDrive = () => { cache = null; };

// ── Folders named by link (drive-link.ts): kept in app_settings/ad_studio_drive ──
const LINKED = () => adminDb.collection('app_settings').doc('ad_studio_drive');

export async function linkedFolders(): Promise<{ id: string; name: string }[]> {
  const d = (await LINKED().get()).data() as { folders?: { id: string; name: string }[] } | undefined;
  return d?.folders ?? [];
}

/** Add a folder by its link: it must be a folder this server can read (shared, or open to anyone with the link). */
export async function addLinkedFolder(link: string): Promise<{ id: string; name: string }> {
  const id = folderIdOf(link);
  if (!id) throw Object.assign(new Error('That isn’t a Drive folder link.'), { status: 400 });
  const f = await driveGet<{ id: string; name: string; mimeType: string }>(`/files/${encodeURIComponent(id)}`, { fields: 'id,name,mimeType' })
    .catch(e => { throw Object.assign(new Error(`Drive won’t let the ERP read that folder (${e instanceof Error ? e.message : e}). Share it with the ERP, or set it to “anyone with the link can view”.`), { status: 403 }); });
  if (f.mimeType !== FOLDER) throw Object.assign(new Error('That link is a file, not a folder.'), { status: 400 });
  const list = (await linkedFolders()).filter(x => x.id !== f.id);
  await LINKED().set({ folders: [...list, { id: f.id, name: f.name }].slice(0, 20) }, { merge: true });
  forgetDrive();
  return { id: f.id, name: f.name };
}

export async function removeLinkedFolder(id: string): Promise<void> {
  await LINKED().set({ folders: (await linkedFolders()).filter(x => x.id !== id) }, { merge: true });
  forgetDrive();
}

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
  imageMediaMetadata?: { width?: number; height?: number }; thumbnailLink?: string;
};
const FILE_FIELDS = 'nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,thumbnailLink,imageMediaMetadata(width,height))';
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
  // A failure is kept half a minute only: the owner fixes it (turns the API on, shares a folder) and looks again.
  if (!opts.fresh && cache && Date.now() - cache.at < (cache.ok ? TTL_MS : 30_000)) return cache;
  const account = await driveAccount();
  try {
    const tok = await token();
    const [shared, linked] = await Promise.all([listAll('sharedWithMe = true and trashed = false', tok), linkedFolders().catch(() => [])]);
    const roots: { id: string; name: string }[] = shared.filter(f => f.mimeType === FOLDER);
    for (const l of linked) if (!roots.some(r => r.id === l.id)) roots.push(l);
    const images: DriveImage[] = [];
    let videos = 0;
    const take = (f: RawFile, folder: string, inBrand: boolean) => {
      if (f.mimeType.startsWith('video/')) { videos++; return; }
      if (!f.mimeType.startsWith('image/')) return;
      // A file nothing here can draw (a camera's raw file with no preview yet) is left out, not retried forever.
      if (!f.thumbnailLink && !DECODABLE.test(f.mimeType)) return;
      if (f.thumbnailLink) previews.set(f.id, f.thumbnailLink);
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

/** Drive's preview of a file at `size` px on the long side, or null when it has none. */
async function preview(file: DriveImage, size: number): Promise<Buffer | null> {
  const at = (link: string) => link.replace(/=s\d+(-[a-z0-9-]+)?$/i, '') + `=s${size}`;
  for (let fresh = false; ; fresh = true) {
    let link = previews.get(file.id);
    // The listing's link expires after some hours: ask Drive for a new one once.
    if (!link || fresh) {
      const f = await driveGet<{ thumbnailLink?: string }>(`/files/${encodeURIComponent(file.id)}`, { fields: 'thumbnailLink' }).catch(() => null);
      if (!f?.thumbnailLink) return null;
      link = f.thumbnailLink;
      previews.set(file.id, link);
    }
    const res = await fetch(at(link), { signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (res?.ok && /^image\//.test(res.headers.get('content-type') || '')) return Buffer.from(await res.arrayBuffer());
    if (fresh) return null;
  }
}

/** One Drive image as a JPEG no wider or taller than `size`, for the studio's grid, the model and the canvas. */
export async function driveJpeg(fileId: string, size: number): Promise<Buffer> {
  const lib = await driveLibrary();
  const file = lib.ok ? lib.images.find(i => i.id === fileId) : undefined;
  if (!file) throw new DriveError('Not in the shared library.', 404, 'no-access');
  let buf = await preview(file, size);
  if (!buf) {
    if (!DECODABLE.test(file.mimeType)) throw new DriveError(`Drive has no preview of this ${file.mimeType} file yet.`, 415, 'error');
    if (file.bytes > MAX_ORIGINAL_BYTES) throw new DriveError(`Drive has no preview of this file, and at ${Math.round(file.bytes / 2 ** 20)} MB it is too big to open here.`, 413, 'error');
    const res = await fetch(`${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${await token()}` },
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new DriveError(`Drive answered ${res.status} for the photo.`, res.status, 'error');
    buf = Buffer.from(await res.arrayBuffer());
    if (/heic|heif/i.test(file.mimeType) || /\.(heic|heif)$/i.test(file.name)) {
      buf = Buffer.from(await convertHeic({ buffer: buf, format: 'JPEG', quality: 0.92 }));
    }
  }
  return sharp(buf, { failOn: 'none', sequentialRead: true })
    .rotate()
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();
}

export { DriveError };
