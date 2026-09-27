/**
 * Retouching a jewellery photograph (the owner, 2026-09-26: "a photo retouching option … in both
 * pos using magnific api", then "magnific only"), in Post a Piece and Add Photos.
 *
 * Magnific's Precision upscaler: it keeps the piece as it is — no prompt, nothing redrawn — and
 * brings back crisp detail in the metal, prongs and stones, taking the photo to catalogue size
 * (up to 3000 px, like the website's photos). The route (/api/website/post/ai, op "retouch") then
 * compares the result with the original ("same piece?"), as it does for every AI edit.
 *
 * The key is read at runtime from Secret Manager — `magnific-api-key` in this house's project,
 * readable by its App Hosting account — so a missing key is a message on the page, never a failed
 * rollout. MAGNIFIC_API_KEY in the environment wins (local development). Server-only. Never logs
 * the key.
 */

import sharp from 'sharp';
import { readSecret } from '@/lib/secret-manager';
import { AiError, type InlineImage } from '@/lib/social/ai';

/** Magnific's input; its result (about twice this) is brought to at most CATALOGUE_EDGE. */
const MAGNIFIC_EDGE = 1536;
const CATALOGUE_EDGE = 3000;

export async function magnificKey(): Promise<string | null> {
  const fromEnv = process.env.MAGNIFIC_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  try { return (await readSecret('magnific-api-key'))?.trim() || null; } catch { return null; }
}

const MAGNIFIC = 'https://api.magnific.com/v1/ai/image-upscaler-precision';

async function magnificDetail(jpeg: Buffer, key: string): Promise<Buffer> {
  const input = await sharp(jpeg).resize({ width: MAGNIFIC_EDGE, height: MAGNIFIC_EDGE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
  const headers = { 'x-magnific-api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' };
  const start = await fetch(MAGNIFIC, {
    method: 'POST', headers, signal: AbortSignal.timeout(30_000),
    // Gentle: detail back without the grain or crunch a product photo doesn't want.
    body: JSON.stringify({ image: input.toString('base64'), sharpen: 35, smart_grain: 0, ultra_detail: 30 }),
  });
  const s = await start.json().catch(() => ({})) as { data?: { task_id?: string }; message?: string };
  if (!start.ok || !s.data?.task_id) {
    throw new AiError(`Magnific couldn't take it: ${s.message || `status ${start.status}`}`, start.status === 401 ? 503 : start.status === 429 ? 429 : 502);
  }
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3_000));
    const res = await fetch(`${MAGNIFIC}/${s.data.task_id}`, { headers, signal: AbortSignal.timeout(20_000) });
    const t = await res.json().catch(() => ({})) as { data?: { status?: string; generated?: string[] }; message?: string };
    const status = t.data?.status;
    if (status === 'COMPLETED' && t.data?.generated?.[0]) {
      const img = await fetch(t.data.generated[0], { signal: AbortSignal.timeout(60_000) });
      if (!img.ok) throw new AiError(`Magnific's result didn't download (${img.status}).`, 502);
      return Buffer.from(await img.arrayBuffer());
    }
    if (status === 'FAILED') throw new AiError('Magnific couldn’t finish this photo. Try again.', 502);
  }
  throw new AiError('Magnific is taking too long. Try again in a minute.', 504);
}

export interface Retouched { image: InlineImage; steps: string[] }

/** Retouch a photo with Magnific. */
export async function retouchPhoto(photo: Buffer): Promise<Retouched> {
  const key = await magnificKey();
  if (!key) throw new AiError('Retouching isn’t set up for this shop yet: add magnific-api-key in Secret Manager.', 503);
  const start = await sharp(photo).rotate().jpeg({ quality: 92 }).toBuffer();
  const out = await magnificDetail(start, key);
  const final = await sharp(out).resize({ width: CATALOGUE_EDGE, height: CATALOGUE_EDGE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  return { image: { mimeType: 'image/jpeg', data: final.toString('base64') }, steps: ['Magnific Precision'] };
}
