/**
 * Pictures into the Design routes, one at a time and small (the 2026-10-01 out-of-memory lesson, plan §7.6):
 * at most 25 MB in, decoded once, and resized with sharp to 1600 px on the long side before any model sees it.
 * Server only.
 */

import { NextRequest } from 'next/server';
import sharp from 'sharp';
import type { InlineImage } from '@/lib/social/ai';
import { publicUrl } from '@/lib/ads/studio/outside-image';
import { fetchPicture, MAX_IMAGE_BYTES } from './parse-url';

export const MODEL_EDGE = 1600;
export { MAX_IMAGE_BYTES };

export class ImageInError extends Error { constructor(message: string, public status = 400) { super(message); } }

export interface ModelImage { jpeg: Buffer; inline: InlineImage; width: number; height: number; name: string }

/** Decode once, upright, at most MODEL_EDGE on the long side, flattened on white (a PNG's alpha would otherwise go black). */
export async function toModelImage(bytes: Buffer, name = ''): Promise<ModelImage> {
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ImageInError('That picture is over 25 MB.', 413);
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: 120_000_000, sequentialRead: true })
      .rotate().flatten({ background: '#ffffff' })
      .resize({ width: MODEL_EDGE, height: MODEL_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
    return { jpeg: data, inline: { mimeType: 'image/jpeg', data: data.toString('base64') }, width: info.width, height: info.height, name };
  } catch (e) {
    if (e instanceof ImageInError) throw e;
    throw new ImageInError('That file isn’t a picture the ERP can read.', 415);
  }
}

/** The one picture of a request: a multipart `file`, or JSON `{ url }` (fetched here, SSRF-checked). */
export async function imageFromRequest(req: NextRequest): Promise<ModelImage> {
  const type = req.headers.get('content-type') || '';
  if (type.startsWith('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new ImageInError('Send one picture as "file".');
    if (file.size > MAX_IMAGE_BYTES) throw new ImageInError('That picture is over 25 MB.', 413);
    return toModelImage(Buffer.from(await file.arrayBuffer()), file.name);
  }
  const body = await req.json().catch(() => null) as { url?: unknown } | null;
  const u = typeof body?.url === 'string' ? publicUrl(body.url) : null;
  if (!u) throw new ImageInError('Send one picture as "file", or a web address as "url".');
  const pic = await fetchPicture(u);
  return toModelImage(pic.bytes, pic.from.pathname.split('/').pop() ?? '');
}

/** An AI call that gives up after `ms` (the key's quota can make a call wait a minute): null on timeout or any failure, never a throw. */
export async function bounded<T>(work: Promise<T>, ms = 25_000, label = 'ai'): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<null>(res => { timer = setTimeout(() => res(null), ms); })]);
  } catch (e) {
    console.warn(`[design] ${label} skipped:`, e instanceof Error ? e.message : e);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
